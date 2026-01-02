/**
 * Chat Command - Interactive chat with Claude about the architecture model
 * Uses Claude Code CLI subprocess for OAuth-based authentication
 */

import ansis from 'ansis';
import { text, intro, outro } from '@clack/prompts';
import { Model } from '../core/model.js';

/**
 * Build system prompt with DR model context
 */
async function buildSystemPrompt(model: Model): Promise<string> {
  const parts: string[] = [];

  parts.push(`You are DrBot, an expert conversational assistant for Documentation Robotics (DR) models.

## Your Expertise

You understand the **full 12-layer DR architecture**:
1. Motivation (Layer 1) - WHY: goals, principles, requirements, constraints
2. Business (Layer 2) - WHAT: capabilities, processes, services, actors
3. Security (Layer 3) - WHO/PROTECTION: actors, roles, policies, threats
4. Application (Layer 4) - HOW: components, services, interfaces, events
5. Technology (Layer 5) - WITH: platforms, frameworks, infrastructure
6. API (Layer 6) - CONTRACTS: OpenAPI 3.0.3 specs
7. Data Model (Layer 7) - STRUCTURE: JSON Schema Draft 7
8. Datastore (Layer 8) - PERSISTENCE: SQL DDL
9. UX (Layer 9) - EXPERIENCE: Three-Tier Architecture
10. Navigation (Layer 10) - FLOW: Multi-Modal routing
11. APM (Layer 11) - OBSERVE: OpenTelemetry 1.0+
12. Testing (Layer 12) - VERIFY: ISP Coverage Model

## Your Tools

You can use Bash to run DR CLI commands:
- \`dr list <layer>\` - List elements in a layer
- \`dr find <id>\` - Find element by ID
- \`dr search <query>\` - Search for elements
- \`dr trace <id>\` - Trace dependencies

You can use Read to examine model files in the .dr directory.

## Guidelines

- Understand user intent through conversation
- Use DR CLI tools to get current model information
- Provide context from the model state
- Be conversational and helpful`);

  // Add model context
  parts.push('\n## Current Model Context\n');
  parts.push(`**Model**: ${model.manifest.name}`);
  parts.push(`**Spec Version**: ${model.manifest.specVersion}`);
  if (model.manifest.description) {
    parts.push(`**Description**: ${model.manifest.description}`);
  }

  // Add layer statistics
  parts.push('\n**Layer Statistics**:');
  const layerNames = model.getLayerNames();
  for (const layerName of layerNames) {
    const layer = await model.getLayer(layerName);
    if (layer) {
      const count = layer.listElements().length;
      if (count > 0) {
        parts.push(`- ${layerName}: ${count} elements`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Check if Claude Code CLI is available
 */
async function checkClaudeAvailable(): Promise<boolean> {
  try {
    const result = Bun.spawnSync({
      cmd: ['which', 'claude'],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Send a message to Claude Code CLI and stream response
 */
async function sendMessage(
  message: string,
  systemPrompt: string,
  modelPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = Bun.spawn({
      cmd: [
        'claude',
        '--print',
        '--dangerously-skip-permissions',
        '--verbose',
        '--system-prompt', systemPrompt,
        '--tools', 'Bash,Read',
        '--output-format', 'stream-json',
      ],
      cwd: modelPath,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Send message via stdin
    proc.stdin?.write(new TextEncoder().encode(message));
    proc.stdin?.end();

    // Stream stdout
    let buffer = '';
    const stdoutReader = proc.stdout.getReader();
    const decoder = new TextDecoder();

    const readLoop = async () => {
      try {
        while (true) {
          const { done, value } = await stdoutReader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
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
        }

        // Print any remaining buffer
        if (buffer.trim()) {
          process.stdout.write(buffer);
        }
      } catch (error) {
        reject(error);
      }
    };

    // Handle process completion
    proc.exited.then((exitCode) => {
      readLoop().then(() => {
        if (exitCode === 0) {
          resolve();
        } else {
          reject(new Error(`Claude process exited with code ${exitCode}`));
        }
      }).catch(reject);
    }).catch(reject);
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

    // Load the model
    const model = await Model.load(process.cwd());
    if (!model) {
      console.error(ansis.red('Error: Could not load architecture model'));
      process.exit(1);
    }

    // Build system prompt with model context
    const systemPrompt = await buildSystemPrompt(model);

    // Show intro
    intro(ansis.bold(ansis.cyan('Documentation Robotics Chat')));
    console.log(ansis.dim('Powered by Claude Code - Ask about your architecture model\n'));

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
        await sendMessage(userInput, systemPrompt, model.rootPath);
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
