import * as path from 'path';
import { execSync } from 'child_process';
import * as fs from 'fs';

interface AfterPackContext {
  appOutDir?: string;
  projectDir?: string;
  platform?: {
    name: string;
  };
  arch?: string;
}

export default function(context: AfterPackContext): boolean {
  console.log('Running after-pack script to set up Python executable...');

  try {
    // Explicitly handle Python executable copying
    if (context.appOutDir && context.projectDir) {
      const pythonExeName = context.platform?.name === 'win32' ? 'herma_python.exe' : 'herma_python';

      // Source paths
      const sourcePythonDir = path.join(context.projectDir, 'dist');
      const sourceExecutable = path.join(sourcePythonDir, pythonExeName);

      // Target paths - IMPORTANT: Match Electron's expected path
      const targetPythonDir = context.platform?.name === 'darwin'
        ? path.join(context.appOutDir, 'Herma.app', 'Contents', 'Resources', 'python')
        : path.join(context.appOutDir, 'resources', 'python');

      const targetExecutable = path.join(targetPythonDir, pythonExeName);

      // Ensure target directory exists
      if (!fs.existsSync(targetPythonDir)) {
        fs.mkdirSync(targetPythonDir, { recursive: true });
      }

      // Copy Python executable
      if (fs.existsSync(sourceExecutable)) {
        console.log(`Copying Python executable from ${sourceExecutable} to ${targetExecutable}`);
        fs.copyFileSync(sourceExecutable, targetExecutable);

        // Set executable permissions for non-Windows platforms
        if (context.platform?.name !== 'win32') {
          fs.chmodSync(targetExecutable, 0o755);
        }

        console.log('Python executable copied successfully');
      } else {
        console.warn(`Python executable not found at ${sourceExecutable}`);
        return false;
      }
    }
  } catch (error) {
    console.error('Error in after-pack script:', error);
    return false;
  }

  return true;
}