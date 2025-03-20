const { app, BrowserWindow, ipcMain } = require('electron');
const { spawn, exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs/promises');
const { shell } = require('electron');

const execAsync = util.promisify(exec);

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

let pythonProcess: ReturnType<typeof spawn> | null = null;
let activeChatRequestId: string | null = null;
let ollamaProcess: ReturnType<typeof spawn> | null = null;
const messageCallbacks = new Map<string, MessageCallback>();
let requestCounter = 0;
let buffer = '';

async function initializePythonShell(): Promise<void> {
  if (pythonProcess) return;

  try {
    console.log('Initializing Python process...');
    console.time('Python Process Initialization');

    // Determine which Python executable to use based on environment
    let pythonExePath: string;
    let pythonArgs: string[] = [];

    if (process.env.NODE_ENV === 'development') {
      // In development, use Python interpreter and script
      pythonExePath = 'python';
      pythonArgs = [path.join(PYTHON_DIR, 'main.py')];
    } else {
      // In production, use PyInstaller executable
      if (process.platform === 'darwin') {
        // Specific handling for macOS
        pythonExePath = path.join(process.resourcesPath, 'python', 'herma_python');
      } else if (process.platform === 'win32') {
        pythonExePath = path.join(process.resourcesPath, 'python', 'herma_python.exe');
      } else {
        // Linux or other platforms
        pythonExePath = path.join(process.resourcesPath, 'python', 'herma_python');
      }

      // Ensure the executable has proper permissions on Unix-like systems
      if (process.platform !== 'win32') {
        try {
          await execAsync(`chmod +x "${pythonExePath}"`);
          console.log(`Set executable permissions for ${pythonExePath}`);
        } catch (error) {
          console.error('Error setting executable permissions:', error);
        }
      }
    }

    console.log(`Using Python executable: ${pythonExePath}`);
    console.log(`Python arguments: ${pythonArgs.join(' ')}`);

    // Enhanced process spawning with more detailed error handling
    pythonProcess = spawn(pythonExePath, pythonArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',  // Ensure unbuffered output
        PYTHONDEVMODE: '1'      // Enable development mode for more warnings
      }
    });

    // Comprehensive stdout handling
    pythonProcess.stdout.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      lines.forEach(line => {
        if (line.trim()) {
          console.log(`[Python STDOUT]: ${line}`);
        }
      });

      buffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        try {
          if (line.trim().startsWith('{')) {
            const message = JSON.parse(line);
            if (message.requestId && messageCallbacks.has(message.requestId)) {
              messageCallbacks.get(message.requestId)!(message);
            }
          }
        } catch (err) {
          console.error('Error parsing Python output:', err);
          console.error('Problematic line:', line);
        }
      }
    });

    // Enhanced stderr handling
    pythonProcess.stderr.on('data', (data: Buffer) => {
      const errorMessage = data.toString().trim();
      console.error('Python stderr:', errorMessage);

      // Log specific error patterns
      if (errorMessage.includes('ImportError') ||
          errorMessage.includes('ModuleNotFoundError')) {
        console.error('Potential import or module loading issue detected');
      }
    });

    // Comprehensive process lifecycle tracking
    pythonProcess.on('error', (err: Error) => {
      console.error('Python process spawn error:', err);
    });

    pythonProcess.on('close', (code: number, signal: string) => {
      console.timeEnd('Python Process Initialization');
      console.log(`Python process exited with code ${code}, signal: ${signal}`);

      messageCallbacks.forEach(callback => {
        callback({
          requestId: '',
          error: `Python process closed unexpectedly (code: ${code}, signal: ${signal})`
        });
      });
      messageCallbacks.clear();

      pythonProcess = null;

      // Implement exponential backoff for restart attempts
      setTimeout(initializePythonShell, 1000);
    });

    // Connection test with increased timeout and detailed error handling
    await new Promise<void>((resolve, reject) => {
      const testRequestId = 'test-connection';

      // Increased timeout to 10 seconds
      const timeout = setTimeout(() => {
        messageCallbacks.delete(testRequestId);
        console.error('Python process initialization timeout');
        reject(new Error('Python process initialization timeout'));
      }, 30000);

      messageCallbacks.set(testRequestId, (response) => {
        clearTimeout(timeout);
        messageCallbacks.delete(testRequestId);

        if (response.error) {
          console.error('Test connection failed:', response.error);
          reject(new Error(response.error));
        } else {
          console.log('Python process connection test successful');
          console.timeEnd('Python Process Initialization');
          resolve();
        }
      });

      console.log("Sending ping to Python process...");
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
    console.error('Comprehensive error during Python process initialization:', error);

    // Detailed error logging
    if (error instanceof Error) {
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      console.error('Error stack:', error.stack);
    }

    if (pythonProcess) {
      try {
        pythonProcess.kill();
      } catch (killError) {
        console.error('Error killing Python process:', killError);
      }
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
    // First try to kill our managed Ollama process
    if (ollamaProcess) {
      try {
        ollamaProcess.kill();
      } catch (err) {
        console.error("Error killing managed Ollama process:", err);
      }
      ollamaProcess = null;
    }

    // As a fallback, use system commands to kill any Ollama processes
    const platform = process.platform;
    const command = platform === 'win32'
      ? 'taskkill /F /IM ollama.exe'
      : 'pkill -9 ollama || killall -9 ollama || true';

    exec(command, (error: Error | null) => {
      if (error && !error.message.includes('No matching processes')) {
        console.log('Note: Error killing Ollama process:', error.message);
      }
      resolve();
    });
  });
}

async function startOllama() {
  try {
    await killOllama();
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Get the platform-specific Ollama path
    let ollamaPath;
    const platform = process.platform;

    if (process.env.NODE_ENV === 'development') {
      // Use system ollama in development
      ollamaPath = 'ollama';
    } else {
      // In production, use bundled binaries
      if (platform === 'darwin') {
        ollamaPath = path.join(process.resourcesPath, 'ollama', 'darwin', 'ollama');
      } else if (platform === 'win32') {
        ollamaPath = path.join(process.resourcesPath, 'ollama', 'win32', 'ollama.exe');
      } else {
        // Linux
        ollamaPath = path.join(process.resourcesPath, 'ollama', 'linux', 'bin', 'ollama');
      }
    }

    console.log("Starting Ollama service from:", ollamaPath);

    // Ensure the binary is executable (for macOS and Linux)
    if (platform !== 'win32' && process.env.NODE_ENV !== 'development') {
      try {
        await execAsync(`chmod +x "${ollamaPath}"`);
        console.log("Made Ollama executable");
      } catch (error) {
        console.error('Error making Ollama executable:', error);
      }
    }

    // Create custom models directory in user data folder
    const modelsDir = path.join(app.getPath('userData'), 'ollama-models');
    await fs.mkdir(modelsDir, { recursive: true });

    // Set up environment variables for Ollama
    const env = {
      ...process.env,
      OLLAMA_MODELS: modelsDir
    };

    // Start Ollama with platform-specific settings
    const ollama = spawn(ollamaPath, ['serve'], { env });

    ollama.stdout.on('data', (data: Buffer) => {
      console.log(`Ollama stdout: ${data}`);
    });

    ollama.stderr.on('data', (data: Buffer) => {
      console.error(`Ollama stderr: ${data}`);
    });

    ollama.on('close', (code: number | null) => {
      console.log(`Ollama process exited with code ${code}`);
    });

    await new Promise(resolve => setTimeout(resolve, 2000));
    console.log("Ollama should be ready now");

  } catch (error) {
    console.error('Error starting Ollama:', error);
  }
}

async function firstRunSetup() {
  // Check if this is first run by looking for a marker file
  const setupCompletePath = path.join(app.getPath('userData'), '.setup-complete');

  try {
    await fs.access(setupCompletePath);
    console.log('Setup already completed');
    return;
  } catch (err) {
    // File doesn't exist, this is first run
    console.log('First run detected, setting up models...');

    // Wait for Ollama to be ready before showing the setup window
    console.log('Waiting for Ollama to initialize...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Check if Ollama is ready by trying to list available models
    let ollama_ready = false;
    for (let i = 0; i < 10; i++) {
      try {
        const response = await fetch('http://localhost:11434/api/tags');
        if (response.ok) {
          ollama_ready = true;
          console.log('Ollama is ready to accept connections');
          break;
        }
      } catch (e) {
        console.log(`Attempt ${i+1}: Ollama not ready yet, waiting...`);
      }
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    if (!ollama_ready) {
      console.error('Ollama failed to start properly within timeout');
      return;
    }

    // Load the HTML content directly
    const setupWin = new BrowserWindow({
      width: 500,
      height: 300,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    // Add error event handler
    setupWin.webContents.on('did-fail-load', (_event: Electron.Event, errorCode: number, errorDescription: string) => {
      console.error(`Setup window failed to load: ${errorDescription} (${errorCode})`);
    });

    // Load a simpler HTML content
    setupWin.loadURL(`data:text/html,
    <html>
    <head><title>Herma Setup</title></head>
    <body style="font-family:Arial; padding:20px; text-align:center">
      <h2>Herma Initial Setup</h2>
      <p>Setting up language model for first use...</p>
      <div id="status">Initializing...</div>
      <script>
        try {
          const { ipcRenderer } = require('electron');
          ipcRenderer.on('status', (event, message) => {
            document.getElementById('status').textContent = message;
          });
        } catch(e) {
          document.getElementById('status').textContent = 'Error: ' + e.message;
        }
      </script>
    </body>
    </html>`);

    // Pull the model
    try {
      setupWin.webContents.send('status', 'Downloading models. This may take several minutes...');

      // Pull the first model (llama3.2:1b)
      setupWin.webContents.send('status', 'Downloading llama3.2:1b model...');
      let response = await fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: 'llama3.2:1b'})
      });

      if (!response.ok) {
        throw new Error(`Failed to pull llama3.2:1b model: ${response.status} ${response.statusText}`);
      }

      // Pull the second model (all-minilm)
      setupWin.webContents.send('status', 'Downloading all-minilm model...');
      response = await fetch('http://localhost:11434/api/pull', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({name: 'all-minilm'})
      });

      if (!response.ok) {
        throw new Error(`Failed to pull all-minilm model: ${response.status} ${response.statusText}`);
      }

      // Create marker file when downloads are complete
      await fs.writeFile(setupCompletePath, 'setup completed');

      setupWin.webContents.send('status', 'Downloads started! You can close this window and start using the app while the models download in the background.');
      setTimeout(() => setupWin.close(), 5000);
    } catch (error: unknown) {
      console.error('Error during setup:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setupWin.webContents.send('status', `Error: ${errorMessage}`);
    }
  }
}

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

ipcMain.handle('start-chat', async (event: Electron.IpcMainInvokeEvent, { message }: ChatMessage) => {
  await ensurePythonShell();
  const requestId = (++requestCounter).toString();

  activeChatRequestId = requestId;

  return new Promise((resolve, reject) => {
    messageCallbacks.set(requestId, (response: PythonMessage) => {
      console.log("Electron received from Python:", response);
      if (response.error) {
        messageCallbacks.delete(requestId);
        activeChatRequestId = null;
        reject(new Error(response.error));
      } else if (response.chunk) {
        event.sender.send('chat-response', response.chunk);
      } else if (response.done) {
        console.log("Electron received 'done' signal, sending [DONE] to frontend");
        event.sender.send('chat-response', '[DONE]');
        messageCallbacks.delete(requestId);
        activeChatRequestId = null;
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
    console.log("Interrupting chat:", activeChatRequestId);

    await killOllama();

    pythonProcess.stdin.write(
      JSON.stringify({
        requestId: 'interrupt-' + activeChatRequestId,
        command: 'interrupt',
        data: { requestId: activeChatRequestId }
      }) + '\n'
    );

    const callback = messageCallbacks.get(activeChatRequestId);
    if (callback) {
      callback({
        requestId: activeChatRequestId,
        done: true
      });
      messageCallbacks.delete(activeChatRequestId);
    }

    const windows = BrowserWindow.getAllWindows();
     windows.forEach((window: Electron.BrowserWindow) => {
      window.webContents.send('chat-response', '[DONE]');
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    startOllama();

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

      await fs.access(filePath);

      await shell.openPath(filePath);

      return { success: true };
    } catch (error: unknown) {
      console.error('Error opening file:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new Error(`Failed to open file: ${errorMessage}`);
    }
  });

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
      contextIsolation: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../../frontend/public/Herma.png')
  });

  win.webContents.on('did-fail-load', (
    _event: Electron.Event,
    errorCode: number,
    errorDescription: string
  ) => {
    console.error(`Page failed to load: ${errorDescription} (${errorCode})`);
  });

  win.webContents.on('crashed', (
    _event: Electron.Event
  ) => {
    console.error('Renderer process crashed');
  });

win.webContents.on('console-message', (
  _event: Electron.Event,
  level: number,
  message: string,
  _line: number,
  _sourceId: string
) => {
  const levels = ['debug', 'info', 'warning', 'error'];
  console.log(`[Renderer ${levels[level] || level}]: ${message}`);
});

  console.log('NODE_ENV:', process.env.NODE_ENV);
  console.log('Current directory:', __dirname);

  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    try {
      console.log('Running in development mode, loading from Vite server...');
      await win.loadURL('http://localhost:5173');
    } catch (err) {
      console.error('Failed to load Vite dev server:', err);
      try {
        console.log('Attempting to load built file as fallback...');
        await win.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
      } catch (loadErr) {
        console.error('Failed to load built file:', loadErr);
      }
    }
  } else {
    try {
      console.log('Running in production mode, loading diagnostic page...');

      const debugPath = path.join(__dirname, '../../frontend/dist/debug.html');

      try {
        await fs.access(debugPath);
        console.log('Found debug.html at:', debugPath);

        await win.loadFile(debugPath);
        console.log('Successfully loaded diagnostic page');

      } catch (debugErr) {
        console.error('Diagnostic page not found, falling back to normal loading:', debugErr);

        const possiblePaths = [
          path.join(__dirname, '../frontend/dist/index.html'),
          path.join(__dirname, '../../frontend/dist/index.html'),
          path.join(process.cwd(), 'frontend/dist/index.html'),
          path.join(app.getAppPath(), 'frontend/dist/index.html')
        ];

        let indexPath = null;
        let foundPath = false;

        for (const testPath of possiblePaths) {
          try {
            await fs.access(testPath);
            console.log('Found index.html at:', testPath);
            indexPath = testPath;
            foundPath = true;
            break;
          } catch (accessErr) {
            console.error('index.html not found at:', testPath);
          }
        }

        if (!foundPath) {

          console.error('Could not find index.html in any expected location');
          try {
            const appDir = app.getAppPath();
            console.log('App directory:', appDir);

            const files = await fs.readdir(appDir);
            console.log('Files in app directory:', files);

            if (files.includes('frontend')) {
              const frontendFiles = await fs.readdir(path.join(appDir, 'frontend'));
              console.log('Files in frontend directory:', frontendFiles);

              if (frontendFiles.includes('dist')) {
                const distFiles = await fs.readdir(path.join(appDir, 'frontend', 'dist'));
                console.log('Files in dist directory:', distFiles);
              }
            }
          } catch (listErr) {
            console.error('Error listing directory contents:', listErr);
          }

          throw new Error('Could not find index.html in any expected location');
        }

        console.log('About to load file:', indexPath);
        await win.loadFile(indexPath);
        console.log('Successfully loaded index.html');
      }
    } catch (err) {
      console.error('Failed to load built file:', err);

      win.webContents.loadURL(`data:text/html;charset=utf-8,
        <html>
          <head><title>Error Loading App</title></head>
          <body>
            <h2>Error Loading Application</h2>
            <pre style="background:#f0f0f0;padding:10px;border-radius:5px;overflow:auto;">${err}</pre>
            <p>Check the console logs for more details (Ctrl+Shift+I).</p>
          </body>
        </html>
      `);
    }
  }

}

app.whenReady().then(async () => {
  startOllama();
  await firstRunSetup();
  await setupIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  } else {
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


app.on('before-quit', async (event: Electron.Event) => {
  if (pythonProcess) {
    event.preventDefault();

    try {
      pythonProcess.stdin.write(
        JSON.stringify({
          requestId: 'shutdown',
          command: 'shutdown',
          data: {}
        }) + '\n'
      );


      await new Promise(resolve => setTimeout(resolve, 1000));
      if (pythonProcess) {
        pythonProcess.kill();
        pythonProcess = null;
      }

      await killOllama();

      app.quit();
    } catch (error) {
      console.error('Error during shutdown:', error);
      app.quit();
    }
  }
});