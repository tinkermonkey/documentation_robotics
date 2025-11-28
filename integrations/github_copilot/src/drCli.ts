import * as cp from 'child_process';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface DrExecutionInfo {
    command: string;
    env?: NodeJS.ProcessEnv;
}

async function getDrExecutionInfo(cwd: string): Promise<DrExecutionInfo> {
    // 1. Check configuration setting
    const config = vscode.workspace.getConfiguration('documentation-robotics');
    const configPath = config.get<string>('drPath');
    if (configPath && configPath.trim().length > 0) {
        return { command: configPath };
    }

    // 2. Check common virtual environment locations
    const venvNames = ['.venv', 'venv', 'env'];

    for (const venvName of venvNames) {
        const venvPath = path.join(cwd, venvName);
        const binDir = path.join(venvPath, 'bin');
        const drPath = path.join(binDir, 'dr');

        if (fs.existsSync(drPath)) {
            // Found virtual environment
            const newEnv = { ...process.env };

            // Update PATH to include venv/bin
            newEnv.PATH = `${binDir}${path.delimiter}${newEnv.PATH}`;

            // Set VIRTUAL_ENV
            newEnv.VIRTUAL_ENV = venvPath;

            // Unset PYTHONHOME if it's set
            delete newEnv.PYTHONHOME;

            return {
                command: drPath,
                env: newEnv
            };
        }
    }

    // 3. Fallback to system PATH
    return { command: 'dr' };
}

export function runDrCli(args: string): Promise<string> {
    return new Promise(async (resolve, reject) => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            reject("No workspace folder open.");
            return;
        }
        const cwd = workspaceFolders[0].uri.fsPath;

        try {
            const { command, env } = await getDrExecutionInfo(cwd);

            cp.exec(`${command} ${args}`, { cwd, env }, (err, stdout, stderr) => {
                if (err) {
                    // If the command failed (non-zero exit code), we still might want stdout (e.g. validation errors)
                    // But usually stderr contains the error.
                    // For 'dr validate', it might exit with 1 if issues are found, but stdout is JSON.
                    // We need to handle this gracefully.
                    if (stdout) {
                        resolve(stdout);
                    } else {
                        reject(stderr || err.message);
                    }
                } else {
                    resolve(stdout);
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}
