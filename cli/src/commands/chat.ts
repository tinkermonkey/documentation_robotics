/**
 * Chat Command - Interactive chat with Claude about the architecture model
 * Uses Claude Code CLI subprocess with dr-architect agent
 */

import ansis from 'ansis';
import { text, intro, outro } from '@clack/prompts';
import { Model } from '../core/model.js';
import { spawnSync, spawn } from 'child_process';

/**
 * Check if Claude Code CLI is available
 */
async function checkClaudeAvailable(): Promise<boolean> {
  try {
    const result = spawnSync('which', ['claude'], {
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Send a message to Claude Code CLI and stream response using dr-architect agent
 */
async function sendMessage(
  message: string,
  modelPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      'claude',
      [
        '--agent', 'dr-architect',
        '--print',
        '--dangerously-skip-permissions',
        '--verbose',
        '--output-format', 'stream-json',
      ],
      {
        cwd: modelPath,
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Send message via stdin
    proc.stdin.write(message);
    proc.stdin.end();

    // Stream stdout
    let buffer = '';

    proc.stdout.on('data', (data: Buffer) => {
      const chunk = data.toString();
      buffer += chunk;

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const event = JSON.parse(line);

          if (event.type === 'assistant') {
            const content = event.message?.content || [];
            for (const block of content) {
              if (block.type === 'text') {
                process.stdout.write(block.text);
              } else if (block.type === 'tool_use') {
                process.stdout.write(ansis.dim(`\n[Using tool: ${block.name}]\n`));
              }
            }
          }
        } catch {
          // Non-JSON line, print as-is
          process.stdout.write(line + '\n');
        }
      }
    });

    proc.stderr.on('data', (_data: Buffer) => {
      // Optionally log errors
      // process.stderr.write(_data);
    });

    proc.on('error', (error) => {
      reject(error);
    });

    proc.on('close', (exitCode) => {
      // Print any remaining buffer
      if (buffer.trim()) {
        process.stdout.write(buffer);
      }

      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`Claude process exited with code ${exitCode}`));
      }
    });
  });
}

/**
 * Chat command implementation
 * Launches an interactive conversation with Claude Code CLI
 */
export async function chatCommand(): Promise<void> {
  try {
    // Check if Claude Code CLI is available
    const claudeAvailable = await checkClaudeAvailable();
    if (!claudeAvailable) {
      console.error(ansis.red('Error: Claude Code CLI not found.'));
      console.error(ansis.dim('Install Claude Code to enable chat functionality.'));
      console.error(ansis.dim('Visit: https://claude.ai'));
      process.exit(1);
    }

    // Load the model to verify it exists
    const model = await Model.load(process.cwd());
    if (!model) {
      console.error(ansis.red('Error: Could not load architecture model'));
      process.exit(1);
    }

    // Show intro
    intro(ansis.bold(ansis.cyan('Documentation Robotics Chat')));
    console.log(ansis.dim('Powered by Claude Code dr-architect agent\n'));

    // Start conversation loop
    while (true) {
      // Get user input
      let userInput: string;
      try {
        userInput = (await text({
          message: ansis.cyan('You:'),
          placeholder: 'Ask about the architecture (or "exit" to quit)',
        })) as string;
      } catch (e) {
        // Handle Ctrl+C or other input errors gracefully
        console.log('');
        outro(ansis.green('Goodbye!'));
        break;
      }

      // Check for exit
      if (
        userInput.toLowerCase() === 'exit' ||
        userInput.toLowerCase() === 'quit' ||
        userInput.toLowerCase() === 'q'
      ) {
        console.log('');
        outro(ansis.green('Goodbye!'));
        break;
      }

      if (!userInput.trim()) {
        continue;
      }

      try {
        // Stream the response
        process.stdout.write(ansis.cyan('Claude: '));
        await sendMessage(userInput, model.rootPath);
        console.log('\n');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(ansis.red(`Error: ${message}`));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));
    process.exit(1);
  }
}
