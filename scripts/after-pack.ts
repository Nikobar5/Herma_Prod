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
  console.log('Running after-pack script to set up model...');

  // Log safe, non-circular context information
  console.log('Context details:', {
    appOutDir: context.appOutDir,
    projectDir: context.projectDir,
    platform: context.platform?.name,
    arch: context.arch
  });

  try {
    // Verify context has expected properties
    if (!context) {
      console.error('No context provided to after-pack script');
      return false;
    }

    // Add the current working directory as a fallback location
    const projectRoot = process.cwd();

    // Potential script locations
    const possibleScriptPaths = [
      context.appOutDir && path.join(context.appOutDir, 'scripts', 'postinstall.js'),
      context.projectDir && path.join(context.projectDir, 'scripts', 'dist', 'postinstall.js'),
      path.join(projectRoot, 'scripts', 'dist', 'postinstall.js') // Add project root as fallback
    ].filter(Boolean); // Remove any undefined paths

    console.log('Possible script paths:', possibleScriptPaths);

    let scriptPath: string | null = null;

    // Find the first existing script path
    for (const potential of possibleScriptPaths as string[]) {
      if (potential && fs.existsSync(potential)) {
        scriptPath = potential;
        break;
      }
    }

    if (scriptPath) {
      console.log(`Executing postinstall script from: ${scriptPath}`);
      execSync(`node "${scriptPath}"`, {
        stdio: 'inherit',
        cwd: context.projectDir || process.cwd()
      });
      console.log('Model installation complete!');
    } else {
      console.warn('Postinstall script not found in expected locations.');
      console.warn('Checked paths:', possibleScriptPaths);

      // Try to copy the script from source to target location if available
      if (context.appOutDir) {
        const sourceScript = path.join(projectRoot, 'scripts', 'dist', 'postinstall.js');
        if (fs.existsSync(sourceScript)) {
          console.log('Found source script at:', sourceScript);

          // Create target directory
          const targetDir = path.join(context.appOutDir, 'scripts');
          if (!fs.existsSync(targetDir)) {
            console.log('Creating target directory:', targetDir);
            fs.mkdirSync(targetDir, { recursive: true });
          }

          // Copy the script
          const targetScript = path.join(targetDir, 'postinstall.js');
          console.log('Copying script to:', targetScript);
          fs.copyFileSync(sourceScript, targetScript);

          // Execute the copied script
          console.log('Executing copied script');
          execSync(`node "${targetScript}"`, {
            stdio: 'inherit',
            cwd: context.appOutDir
          });
          console.log('Model installation complete!');
        } else {
          console.error('Source script not found at:', sourceScript);
          // Continue without failing the build
          console.warn('Skipping model installation');
        }
      } else {
        console.error('No appOutDir provided, cannot copy script');
        // Continue without failing the build
        console.warn('Skipping model installation');
      }
    }
  } catch (error) {
    console.error('Error executing post-install script:', error);
    // Log but don't fail the build
    console.warn('Continuing despite script error');
  }

  return true;
}