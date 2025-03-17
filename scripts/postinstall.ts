import { spawn, execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

function getOllamaPath(): string {
  const platform = process.platform;
  let ollamaPath: string;

  // Check multiple locations in order of priority
  const possiblePaths = [
    // 1. Try project resources first (development)
    path.join(process.cwd(), 'resources', 'ollama'),
    // 2. Try packaged app resources
    process.env.RESOURCES_PATH && path.join(process.env.RESOURCES_PATH, 'ollama'),
    // 3. Try user home config directory (production)
    path.join(os.homedir(), '.herma', 'resources', 'ollama')
  ].filter(Boolean) as string[]; // Type assertion to tell TypeScript these are all strings

  console.log('Checking these paths for Ollama:', possiblePaths);

  let basePath: string | null = null;
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      console.log(`Found Ollama resources at: ${possiblePath}`);
      basePath = possiblePath;
      break;
    } else {
      console.log(`Path not found: ${possiblePath}`);
    }
  }

  if (!basePath) {
    console.error('Could not find Ollama resources in any expected location');
    // Use project path as fallback
    basePath = path.join(process.cwd(), 'resources', 'ollama');
  }

  if (platform === 'darwin') {
    ollamaPath = path.join(basePath, 'darwin', 'ollama');
  } else if (platform === 'win32') {
    ollamaPath = path.join(basePath, 'win32', 'ollama.exe');
  } else {
    // Linux
    ollamaPath = path.join(basePath, 'linux', 'bin', 'ollama');
  }

  console.log(`Using Ollama executable at: ${ollamaPath}`);
  return ollamaPath;
}

function pullModel(modelName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${modelName} model...`);
    const pull = spawn(getOllamaPath(), ['pull', modelName]);

    pull.stdout.on('data', (data: Buffer) => {
      console.log(`${modelName} download progress: ${data.toString()}`);
    });

    pull.stderr.on('data', (data: Buffer) => {
      console.error(`${modelName} error: ${data.toString()}`);
    });

    pull.on('close', (code: number | null) => {
      if (code === 0) {
        console.log(`${modelName} download finished successfully`);
        resolve();
      } else {
        console.error(`${modelName} download failed with code ${code}`);
        reject(new Error(`Download failed with code ${code}`));
      }
    });
  });
}

async function installModels(): Promise<void> {
  console.log("Starting Ollama service...");

  const ollamaPath = getOllamaPath();

  // Make sure the executable is executable
  if (process.platform !== 'win32') {
    try {
      execSync(`chmod +x "${ollamaPath}"`);
    } catch (error) {
      console.error('Error making Ollama executable:', error);
    }
  }

  // Check if the Ollama executable exists
  if (!fs.existsSync(ollamaPath)) {
    console.error(`Ollama executable not found at path: ${ollamaPath}`);
    console.error('Skipping model installation...');
    process.exit(0); // Exit gracefully without failing
    return;
  }

  // Start Ollama service
  console.log(`Starting Ollama service with path: ${ollamaPath}`);
  const ollama = spawn(ollamaPath, ['serve']);

  // Handle ollama process errors
  ollama.on('error', (err) => {
    console.error('Failed to start Ollama service:', err);
    process.exit(0); // Exit gracefully without failing
  });

  // Wait for Ollama to start
  await new Promise(resolve => setTimeout(resolve, 3000));

  try {
    // Pull the first model
    await pullModel('all-minilm');

    // Pull the second model
    await pullModel('llama3.2:1b');

    console.log("All models downloaded successfully");
  } catch (error) {
    console.error("Error downloading models:", error);
  } finally {
    // Shut down Ollama when done
    try {
      ollama.kill();
    } catch (e) {
      console.error("Error shutting down Ollama:", e);
    }
    process.exit(0);
  }
}

// Add more error handling to prevent build failures
installModels().catch(err => {
  console.error('Error in post-install script:', err);
  console.warn('Continuing with build despite errors in model installation');
  process.exit(0); // Exit with success code to not fail the build
});