/**
 * Chat Command - Interactive chat with AI about the architecture model
 * Supports Claude Code CLI and GitHub Copilot CLI with auto-detection
 */

import ansis from 'ansis';
import { text, intro, outro, select } from '@clack/prompts';
import { Model } from '../core/model.js';
import { BaseChatClient } from '../ai/base-chat-client.js';
import { ClaudeCodeClient } from '../ai/claude-code-client.js';
import { CopilotClient } from '../ai/copilot-client.js';

/**
 * Detect available AI chat clients
 * Checks for Claude Code CLI and GitHub Copilot CLI
 * @returns Array of available client instances
 */
async function detectAvailableClients(): Promise<BaseChatClient[]> {
  const clients: BaseChatClient[] = [];
  
  const claudeClient = new ClaudeCodeClient();
  if (await claudeClient.isAvailable()) {
    clients.push(claudeClient);
  }
  
  const copilotClient = new CopilotClient();
  if (await copilotClient.isAvailable()) {
    clients.push(copilotClient);
  }
  
  return clients;
}

/**
 * Get the preferred chat client from manifest metadata
 * @param model The model instance
 * @returns The preferred client name or null
 */
function getPreferredClient(model: Model): string | null {
  return model.manifest.preferred_chat_client || null;
}

/**
 * Set the preferred chat client in manifest metadata
 * @param model The model instance
 * @param clientName The client name to set as preferred
 */
async function setPreferredClient(model: Model, clientName: string): Promise<void> {
  model.manifest.preferred_chat_client = clientName;
  await model.save();
}

/**
 * Chat command implementation
 * Launches an interactive conversation with an AI chat client
 * Supports Claude Code CLI and GitHub Copilot CLI with auto-detection
 */
export async function chatCommand(): Promise<void> {
  try {
    // Load the model to verify it exists
    const model = await Model.load(process.cwd());
    if (!model) {
      console.error(ansis.red('Error: Could not load architecture model'));
      process.exit(1);
    }

    // Detect available clients
    const availableClients = await detectAvailableClients();
    
    if (availableClients.length === 0) {
      console.error(ansis.red('Error: No AI chat CLI available.'));
      console.error(ansis.dim('Install one of the following:'));
      console.error(ansis.dim('  - Claude Code: https://claude.ai'));
      console.error(ansis.dim('  - GitHub Copilot: gh extension install github/gh-copilot'));
      process.exit(1);
    }

    // Select the client to use
    let selectedClient: BaseChatClient;
    const preferredClientName = getPreferredClient(model);
    
    if (availableClients.length === 1) {
      selectedClient = availableClients[0];
    } else {
      // Multiple clients available - check for preference
      const preferredClient = availableClients.find(
        c => c.getClientName() === preferredClientName
      );
      
      if (preferredClient) {
        selectedClient = preferredClient;
      } else {
        // Ask user to choose
        const choice = await select({
          message: 'Select AI chat client:',
          options: availableClients.map(c => ({
            value: c.getClientName(),
            label: c.getClientName(),
          })),
        });
        
        if (typeof choice !== 'string') {
          console.log('');
          outro(ansis.yellow('Chat cancelled'));
          process.exit(0);
        }
        
        selectedClient = availableClients.find(c => c.getClientName() === choice)!;
        
        // Save preference
        await setPreferredClient(model, selectedClient.getClientName());
      }
    }

    // Show intro
    intro(ansis.bold(ansis.cyan('Documentation Robotics Chat')));
    console.log(ansis.dim(`Powered by ${selectedClient.getClientName()}\n`));

    // Determine agent name based on client
    const agentName = selectedClient instanceof ClaudeCodeClient ? 'dr-architect' : undefined;

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
        process.stdout.write(ansis.cyan(`${selectedClient.getClientName()}: `));
        await selectedClient.sendMessage(userInput, {
          workingDirectory: model.rootPath,
          agent: agentName,
        });
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
