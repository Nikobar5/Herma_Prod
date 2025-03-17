import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// Determine platform-specific settings
const isPlatformWindows = process.platform === 'win32';
const pythonExeName = isPlatformWindows ? 'herma_python.exe' : 'herma_python';
const outputDir = path.join(__dirname, '..', 'python', 'dist');

console.log('Building Python executable with PyInstaller...');
console.log('Current directory:', process.cwd());

try {
  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Fix the path to the spec file - use path.join instead of path.resolve
  const specFilePath = path.join(process.cwd(), 'scripts', 'herma_python.spec');
  console.log('Using spec file at:', specFilePath);

  execSync(`pyinstaller --clean "${specFilePath}"`, {
    stdio: 'inherit',
    cwd: process.cwd()  // Run from project root
  });

  console.log(`Python executable built successfully: ${path.join(outputDir, pythonExeName)}`);
} catch (error) {
  console.error('Error building Python executable:', error);
  process.exit(1);
}