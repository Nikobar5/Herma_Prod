const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs/promises');
const { shell } = require('electron');

const execAsync = util.promisify(exec);

// Define types for your IPC messages
interface ChatMessage {
  message: string;
}

interface FileUpload {
  filename: string;
  data: Buffer;
}

interface FileOperation {
  filename: string;
}

interface FileSelection {
  filenames: string[];
}

interface PythonMessage {
  requestId: string;
  chunk?: string;
  error?: string;
  done?: boolean;
  success?: boolean;
  files?: string[];
}

type MessageCallback = (message: PythonMessage) => void;

const STORAGE_DIR = path.join(__dirname, '../../storage');
const UPLOADS_DIR = path.join(STORAGE_DIR, 'uploads');
const PYTHON_DIR = path.join(__dirname, '../../python/scripts');

// Python process state
let pythonProcess: ReturnType<typeof spawn> | null = null;
let activeChatRequestId: string | null = null;
const messageCallbacks = new Map<string, MessageCallback>();
let requestCounter = 0;
let buffer = '';

async function initializePythonShell(): Promise<void> {
  if (pythonProcess) return;

  try {
    console.log('Initializing Python process...');
    pythonProcess = spawn('python', [path.join(PYTHON_DIR, 'main.py')], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    pythonProcess.stdout.on('data', (data: Buffer) => {
      buffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.trim().startsWith('{')) {
            try {
                const message = JSON.parse(line);
                if (message.requestId && messageCallbacks.has(message.requestId)) {
                      messageCallbacks.get(message.requestId)!(message);
                }
            } catch (err) {
                console.error('Error parsing Python output:', err);
            }
        } else {
            // Regular debug output, just log to console
            console.log('Python:', line);
        }
      }
    });

    pythonProcess.stderr.on('data', (data: Buffer) => {
      console.error('Python error:', data.toString());
    });

    pythonProcess.on('close', (code: number) => {
      console.log(`Python process exited with code ${code}`);
      messageCallbacks.forEach(callback => {
        callback({ requestId: '', error: 'Python process closed unexpectedly' });
      });
      messageCallbacks.clear();

      pythonProcess = null;
      setTimeout(initializePythonShell, 1000);
    });

    // Verify connection
    await new Promise<void>((resolve, reject) => {
      const testRequestId = 'test-connection';
      const timeout = setTimeout(() => {
        messageCallbacks.delete(testRequestId);
        reject(new Error('Python process initialization timeout'));
      }, 5000);

      messageCallbacks.set(testRequestId, (response) => {
        clearTimeout(timeout);
        messageCallbacks.delete(testRequestId);
        if (response.error) {
          reject(new Error(response.error));
        } else {
          resolve();
        }
      });

      pythonProcess.stdin.write(
        JSON.stringify({
          requestId: testRequestId,
          command: 'ping',
          data: {}
        }) + '\n'
      );
    });

    console.log('Python process initialized successfully');
  } catch (error) {
    console.error('Failed to initialize Python process:', error);
    if (pythonProcess) {
      pythonProcess.kill();
      pythonProcess = null;
    }
    throw error;
  }
}

async function ensurePythonShell(): Promise<void> {
  if (!pythonProcess) {
    await initializePythonShell();
  }
}

function killOllama(): Promise<void> {
  return new Promise((resolve) => {
    const platform = process.platform;
    const command = platform === 'win32' ? 'taskkill /F /IM ollama.exe' : 'killall ollama';

    exec(command, (error: Error | null) => {
      if (error && !error.message.includes('No matching processes')) {
        console.log('Note: No Ollama process was running');
      }
      resolve();
    });
  });
}

async function startOllama() {
  try {
    await killOllama();
    await new Promise(resolve => setTimeout(resolve, 1000));

    const ollama = spawn('ollama', ['serve']);

    ollama.stdout.on('data', (data: Buffer) => {
      console.log(`Ollama stdout: ${data}`);
    });

    ollama.stderr.on('data', (data: Buffer) => {
      console.error(`Ollama stderr: ${data}`);
    });

    ollama.on('close', (code: number) => {
      console.log(`Ollama process exited with code ${code}`);
    });

  } catch (error) {
    console.error('Error starting Ollama:', error);
  }
}

// Add a proper quit method that can be called from anywhere
function quitApplication() {
  if (pythonProcess) {
    pythonProcess.stdin.write(
      JSON.stringify({
        requestId: 'shutdown',
        command: 'shutdown',
        data: {}
      }) + '\n'
    );
  }
  setTimeout(() => {
    app.quit();
  }, 1000);
}

async function setupIPC() {
  await initializePythonShell();

  // Chat handler
ipcMain.handle('start-chat', async (event: Electron.IpcMainInvokeEvent, { message }: ChatMessage) => {
  await ensurePythonShell();
  const requestId = (++requestCounter).toString();

  // Store the active chat request ID
  activeChatRequestId = requestId;

  return new Promise((resolve, reject) => {
    messageCallbacks.set(requestId, (response: PythonMessage) => {
      if (response.error) {
        messageCallbacks.delete(requestId);
        activeChatRequestId = null; // Clear active request on error
        reject(new Error(response.error));
      } else if (response.chunk) {
        event.sender.send('chat-response', response.chunk);
      } else if (response.done) {
        messageCallbacks.delete(requestId);
        activeChatRequestId = null; // Clear active request when done
        resolve(null);
      }
    });

    if (!pythonProcess) {
      reject(new Error('Python process not available'));
      return;
    }

    pythonProcess.stdin.write(
      JSON.stringify({
        requestId,
        command: 'chat',
        data: { message }
      }) + '\n'
    );
  });
});

  // File upload handler
  ipcMain.handle('upload-file', async (_event: Electron.IpcMainInvokeEvent, { filename, data }: FileUpload) => {
    await ensurePythonShell();
    const requestId = (++requestCounter).toString();
    const uploadPath = path.join(STORAGE_DIR, 'uploads');
    await fs.mkdir(uploadPath, { recursive: true });
    const tempPath = path.join(uploadPath, `temp_${filename}`);
    await fs.writeFile(tempPath, data);

    return new Promise((resolve, reject) => {
      messageCallbacks.set(requestId, (response: PythonMessage) => {
        messageCallbacks.delete(requestId);
        if (response.error) reject(new Error(response.error));
        else resolve(response);
      });

      if (!pythonProcess) {
        reject(new Error('Python process not available'));
        return;
      }

      pythonProcess.stdin.write(
        JSON.stringify({
          requestId,
          command: 'upload',
          data: { filename, filepath: tempPath }
        }) + '\n'
      );
    });
  });
    ipcMain.handle('new-session', async () => {
    await ensurePythonShell();
    const requestId = (++requestCounter).toString();

    return new Promise((resolve, reject) => {
      messageCallbacks.set(requestId, (response: PythonMessage) => {
        messageCallbacks.delete(requestId);
        if (response.error) reject(new Error(response.error));
        else resolve(response);
      });

      if (!pythonProcess) {
        reject(new Error('Python process not available'));
        return;
      }

      pythonProcess.stdin.write(
        JSON.stringify({
          requestId,
          command: 'new_session',
          data: {}
        }) + '\n'
      );
    });
    });

    ipcMain.handle('get-files', async () => {
      await ensurePythonShell();
      const requestId = (++requestCounter).toString();

      return new Promise((resolve, reject) => {
        messageCallbacks.set(requestId, (response: PythonMessage) => {
          messageCallbacks.delete(requestId);
          if (response.error) reject(new Error(response.error));
          else resolve(response.files || []);
        });

        if (!pythonProcess) {
          reject(new Error('Python process not available'));
          return;
        }

        pythonProcess.stdin.write(
          JSON.stringify({
            requestId,
            command: 'get_files',
            data: {}
          }) + '\n'
        );
      });
    });

  // Delete file handler
  ipcMain.handle('delete-file', async (_event: Electron.IpcMainInvokeEvent, { filename }: FileOperation) => {
    await ensurePythonShell();
    const requestId = (++requestCounter).toString();

    return new Promise((resolve, reject) => {
      messageCallbacks.set(requestId, (response: PythonMessage) => {
        messageCallbacks.delete(requestId);
        if (response.error) reject(new Error(response.error));
        else resolve(response);
      });

      if (!pythonProcess) {
        reject(new Error('Python process not available'));
        return;
      }

      pythonProcess.stdin.write(
        JSON.stringify({
          requestId,
          command: 'delete',
          data: { filename }
        }) + '\n'
      );
    });
  });

  ipcMain.handle('interrupt-chat', async () => {
  if (!activeChatRequestId || !pythonProcess) {
    return { success: false, message: 'No active chat to interrupt' };
  }

  try {
    // Send an interrupt signal to Python
    pythonProcess.stdin.write(
      JSON.stringify({
        requestId: 'interrupt-' + activeChatRequestId,
        command: 'interrupt',
        data: { requestId: activeChatRequestId }
      }) + '\n'
    );

    // Mark the request as done
    const callback = messageCallbacks.get(activeChatRequestId);
    if (callback) {
      callback({
        requestId: activeChatRequestId,
        done: true
      });
      messageCallbacks.delete(activeChatRequestId);
    }

    // Send a [DONE] message to the renderer
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((window: Electron.BrowserWindow) => {
      window.webContents.send('chat-response', '[DONE]');
    });

    activeChatRequestId = null;
    return { success: true };
  } catch (error) {
    console.error('Error interrupting chat:', error);
    return { success: false, message: String(error) };
  }
});

  ipcMain.handle('open-file', async (_event: Electron.IpcMainInvokeEvent, { filename }: { filename: string }) => {
    try {
      const filePath = path.join(UPLOADS_DIR, filename);

      // Check if file exists
      await fs.access(filePath);

      // Open file with default system application
      await shell.openPath(filePath);

      return { success: true };
    } catch (error: unknown) {
      console.error('Error opening file:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to open file: ${errorMessage}`);
    }
  });

  // Select files handler
  ipcMain.handle('select-files', async (_event: Electron.IpcMainInvokeEvent, { filenames }: FileSelection) => {
    await ensurePythonShell();
    const requestId = (++requestCounter).toString();

    return new Promise((resolve, reject) => {
      messageCallbacks.set(requestId, (response: PythonMessage) => {
        messageCallbacks.delete(requestId);
        if (response.error) reject(new Error(response.error));
        else resolve(response);
      });

      if (!pythonProcess) {
        reject(new Error('Python process not available'));
        return;
      }

      pythonProcess.stdin.write(
        JSON.stringify({
          requestId,
          command: 'select',
          data: { filenames }
        }) + '\n'
      );
    });
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  console.log('NODE_ENV:', process.env.NODE_ENV);

  try {
    console.log('Attempting to load Vite dev server...');
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } catch (err) {
    console.error('Failed to load Vite dev server:', err);
    console.log('Attempting to load file...');
    win.loadFile(path.join(__dirname, '../../frontend/dist/index.html'));
  }
}

app.whenReady().then(async () => {
  startOllama();
  await setupIPC();
  createWindow();
});

// Handle window close events properly
app.on('window-all-closed', () => {
  // On macOS applications keep running unless user explicitly quits
  if (process.platform !== 'darwin') {
    app.quit();
  } else {
    // For macOS, we still need to tell Python to save data
    if (pythonProcess) {
      pythonProcess.stdin.write(
        JSON.stringify({
          requestId: 'save',
          command: 'shutdown',
          data: {}
        }) + '\n'
      );
    }
  }
});

// Properly typed before-quit handler
app.on('before-quit', async (event: Electron.Event) => {
  // If we haven't cleaned up yet, prevent immediate quit to allow cleanup
  if (pythonProcess) {
    // Only prevent default if this is the first time
    event.preventDefault();

    try {
      // Send shutdown to Python
      pythonProcess.stdin.write(
        JSON.stringify({
          requestId: 'shutdown',
          command: 'shutdown',
          data: {}
        }) + '\n'
      );

      // Give Python time to save
      await new Promise(resolve => setTimeout(resolve, 1000));
      if (pythonProcess) {
        pythonProcess.kill();
        pythonProcess = null;
      }

      // Then kill Ollama
      await killOllama();

      // Now quit for real
      app.quit();
    } catch (error) {
      console.error('Error during shutdown:', error);
      app.quit(); // Try to quit anyway
    }
  }
});