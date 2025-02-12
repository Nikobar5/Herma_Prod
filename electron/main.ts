const { app, BrowserWindow, ipcMain } = require('electron');
const { PythonShell } = require('python-shell');
const { spawn, exec } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs/promises');

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

const STORAGE_DIR = path.join(app.getPath('userData'), 'storage');
const PYTHON_DIR = path.join(__dirname, '../../python/scripts');

function killOllama(): Promise<void> {
  return new Promise((resolve) => {
    const platform = process.platform;
    const command = platform === 'win32' ? 'taskkill /F /IM ollama.exe' : 'killall ollama';

    exec(command, (error: Error | null) => {  // Added type annotation here
      // Process not found is an expected condition, not an error
      if (error && !error.message.includes('No matching processes')) {
        console.log('Note: No Ollama process was running');
      }
      resolve();
    });
  });
}


async function startOllama() {
  try {
    // First try to kill any existing Ollama process
    await killOllama();

    // Wait a moment for the port to be freed
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

    // Also handle application quit
    app.on('before-quit', async () => {
      try {
        await killOllama();
      } catch (error) {
        console.error('Error shutting down Ollama:', error);
      }
    });

  } catch (error) {
    console.error('Error starting Ollama:', error);
  }
}


async function setupIPC() {
  // Chat handler
  ipcMain.handle('start-chat', async (event: Electron.IpcMainInvokeEvent, { message }: ChatMessage) => {
    return new Promise((resolve, reject) => {
      const pyshell = new PythonShell(path.join(PYTHON_DIR, 'main.py'), {
        mode: 'json',
        args: [JSON.stringify({
            command: 'chat',
            data: {message }
            })]
      });

      pyshell.on('message', (message: any) => {
        event.sender.send('chat-response', message.chunk);
      });

      pyshell.end((err: Error | null) => {
        if (err) reject(err);
        else resolve(null);
      });
    });
  });

  // File upload handler
  ipcMain.handle('upload-file', async (_event: Electron.IpcMainInvokeEvent, { filename, data }: FileUpload) => {
    const uploadPath = path.join(STORAGE_DIR, 'uploads');
    await fs.mkdir(uploadPath, { recursive: true });
    const filePath = path.join(uploadPath, filename);
    await fs.writeFile(filePath, data);

    const pyshell = new PythonShell(path.join(PYTHON_DIR, 'main.py'), {
      mode: 'json',
      args: [JSON.stringify({
        operation: 'upload',
        data: { filename, path: filePath }
      })]
    });

    return new Promise((resolve, reject) => {
      pyshell.on('message', (message: any) => {
        resolve(message);
      });

      pyshell.end((err: Error | null) => {
        if (err) reject(err);
      });
    });
  });

  // Get files handler
  ipcMain.handle('get-files', async () => {
    const uploadPath = path.join(STORAGE_DIR, 'uploads');
    await fs.mkdir(uploadPath, { recursive: true });
    const files = await fs.readdir(uploadPath);
    return files;
  });

  // Delete file handler
  ipcMain.handle('delete-file', async (_event: Electron.IpcMainInvokeEvent, { filename }: FileOperation) => {
    const pyshell = new PythonShell(path.join(PYTHON_DIR, 'main.py'), {
      mode: 'json',
      args: [JSON.stringify({
        operation: 'delete',
        data: { filename }
      })]
    });

    return new Promise((resolve, reject) => {
      pyshell.on('message', (message: any) => {
        resolve(message);
      });

      pyshell.end((err: Error | null) => {
        if (err) reject(err);
      });
    });
  });

  // Select files handler
  ipcMain.handle('select-files', async (_event: Electron.IpcMainInvokeEvent, { filenames }: FileSelection) => {
    const pyshell = new PythonShell(path.join(PYTHON_DIR, 'main.py'), {
      mode: 'json',
      args: [JSON.stringify({
        operation: 'select',
        data: { filenames }
      })]
    });

    return new Promise((resolve, reject) => {
      pyshell.on('message', (message: any) => {
        resolve(message);
      });

      pyshell.end((err: Error | null) => {
        if (err) reject(err);
      });
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

    // Open DevTools by default during development
    win.webContents.openDevTools();
  } catch (err) {
    console.error('Failed to load Vite dev server:', err);
    // Fallback to file loading if dev server fails
    console.log('Attempting to load file...');
    win.loadFile(path.join(__dirname, '../../frontend/dist/index.html'));
  }
}

app.whenReady().then(async () => {
  startOllama();
  await setupIPC();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});