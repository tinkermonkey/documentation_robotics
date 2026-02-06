/**
 * Chat Command - Interactive chat with AI about the architecture model
 * Supports Claude Code CLI and GitHub Copilot CLI with auto-detection
 */

import ansis from 'ansis';
import { text, intro, outro, select } from '@clack/prompts';
import { Model } from '../core/model.js';
import { BaseChatClient } from '../coding-agents/base-chat-client.js';
import { detectAvailableClients } from '../coding-agents/chat-utils.js';
import { initializeChatLogger, getChatLogger } from '../utils/chat-logger.js';
import { isTelemetryEnabled, startSpan, endSpan, emitLog, SeverityNumber } from '../telemetry/index.js';

/**
 * Get the preferred chat client from manifest metadata
 * @param model The model instance
 * @returns The preferred client name or null
 */
function getPreferredClient(model: Model): string | null {
  return model.manifest.getCodingAgent() || null;
}

/**
 * Set the preferred chat client in manifest metadata
 * @param model The model instance
 * @param clientName The client name to set as preferred
 */
async function setPreferredClient(model: Model, clientName: string): Promise<void> {
  model.manifest.setCodingAgent(clientName);
  await model.save();
}

/**
 * Map CLI-friendly client names to internal client names
 * @param cliName The CLI-friendly name (e.g., "github-copilot", "claude-code")
 * @returns The internal client name (e.g., "GitHub Copilot", "Claude Code")
 */
function mapCliNameToClientName(cliName: string): string {
  const mapping: Record<string, string> = {
    'github-copilot': 'GitHub Copilot',
    'copilot': 'GitHub Copilot',
    'claude-code': 'Claude Code',
    'claude': 'Claude Code',
  };
  return mapping[cliName.toLowerCase()] || cliName;
}

/**
 * Chat command implementation
 * Launches an interactive conversation with an AI chat client
 * Supports Claude Code CLI and GitHub Copilot CLI with auto-detection
 *
 * @param explicitClient Optional client name explicitly specified by user
 * @param withDanger Optional flag to enable dangerous mode (skip permissions)
 */
export async function chatCommand(explicitClient?: string, withDanger?: boolean): Promise<void> {
  const span = isTelemetryEnabled ? startSpan('chat.session', {
    'chat.hasExplicitClient': !!explicitClient,
    'chat.explicitClient': explicitClient,
    'chat.dangerMode': withDanger === true,
  }) : null;

  try {
    // Load the model to verify it exists
    const model = await Model.load(process.cwd());
    if (!model) {
      console.error(ansis.red('Error: Could not load architecture model'));
      process.exit(1);
    }

    // Initialize chat logger
    const logger = initializeChatLogger(model.rootPath);
    await logger.ensureLogDirectory();
    await logger.logEvent('chat_session_started', {
      workingDirectory: model.rootPath,
      withDanger,
    });

    // Detect available clients
    const availableClients = await detectAvailableClients();

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute('chat.availableClients', availableClients.length);
      (span as any).setAttribute('chat.clientNames', availableClients.map(c => c.getClientName()).join(','));
    }

    if (availableClients.length === 0) {
      const errorMsg = 'No AI chat CLI available.';
      if (isTelemetryEnabled && span) {
        emitLog(SeverityNumber.ERROR, 'No AI chat clients available');
      }
      await logger.logError(errorMsg);
      console.error(ansis.red(`Error: ${errorMsg}`));
      console.error(ansis.dim('Install one of the following:'));
      console.error(ansis.dim('  - Claude Code: https://claude.ai'));
      console.error(ansis.dim('  - GitHub Copilot: gh extension install github/gh-copilot'));
      process.exit(1);
    }

    // Select the client to use
    let selectedClient: BaseChatClient;

    // If user explicitly specified a client
    if (explicitClient) {
      const requestedClientName = mapCliNameToClientName(explicitClient);
      const requestedClient = availableClients.find(
        c => c.getClientName() === requestedClientName
      );

      if (!requestedClient) {
        const errorMsg = `Requested client "${requestedClientName}" is not available.`;
        await logger.logError(errorMsg);
        console.error(ansis.red(`Error: ${errorMsg}`));
        console.error(ansis.dim('Available clients:'));
        availableClients.forEach(c => {
          console.error(ansis.dim(`  - ${c.getClientName()}`));
        });
        process.exit(1);
      }

      selectedClient = requestedClient;

      // Save as preference
      await setPreferredClient(model, selectedClient.getClientName());
    } else {
      // Auto-select based on preference or availability
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
            await logger.logEvent('chat_session_cancelled');
            outro(ansis.yellow('Chat cancelled'));
            process.exit(0);
          }

          selectedClient = availableClients.find(c => c.getClientName() === choice)!;

          // Save preference
          await setPreferredClient(model, selectedClient.getClientName());
        }
      }
    }

    // Log client selection
    await logger.logEvent('client_selected', {
      client: selectedClient.getClientName(),
      sessionId: logger.getSessionId(),
    });

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute('chat.selectedClient', selectedClient.getClientName());
      (span as any).setAttribute('chat.sessionId', logger.getSessionId());
    }

    // Show intro
    intro(ansis.bold(ansis.cyan('Documentation Robotics Chat')));
    console.log(ansis.dim(`Powered by ${selectedClient.getClientName()}`));
    console.log(ansis.dim(`Session ID: ${logger.getSessionId()}`));
    console.log(ansis.dim(`Logs: ${logger.getSessionLogPath()}`));
    if (withDanger) {
      console.log(ansis.yellow('⚠️  Danger mode enabled - permissions will be skipped\n'));
    } else {
      console.log('');
    }

    // Use dr-architect agent for all clients
    const agentName = 'dr-architect';

    // Start conversation loop
    let messageCount = 0;
    while (true) {
      // Periodic telemetry flush at message boundaries (safe idle time)
      // This ensures long-running chat sessions don't lose spans if crashed
      // Flush happens BEFORE user input prompt, so it's non-blocking
      if (isTelemetryEnabled && messageCount > 0) {
        // Import flushTelemetry dynamically to avoid issues when telemetry disabled
        const { flushTelemetry } = await import('../telemetry/index.js');
        // Non-blocking flush - failures are silently ignored
        void flushTelemetry().catch(() => {/* ignore */});
      }

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
        if (isTelemetryEnabled && span) {
          (span as any).setAttribute('chat.messageCount', messageCount);
          (span as any).setAttribute('chat.exitReason', 'interrupted');
        }
        await logger.logEvent('chat_session_interrupted');
        outro(ansis.green('Goodbye!'));
        break;
      }

      // Check for exit
      if (
        userInput.toLowerCase() === 'exit' ||
        userInput.toLowerCase() === 'quit' ||
        userInput.toLowerCase() === 'q' ||
        userInput.toLowerCase() === '/exit' ||
        userInput.toLowerCase() === '/quit' ||
        userInput.toLowerCase() === '/q'
      ) {
        console.log('');
        if (isTelemetryEnabled && span) {
          (span as any).setAttribute('chat.messageCount', messageCount);
          (span as any).setAttribute('chat.exitReason', 'user_exit');
        }
        await logger.logEvent('chat_session_ended', {
          messageCount,
        });
        outro(ansis.green('Goodbye!'));
        break;
      }

      if (!userInput.trim()) {
        continue;
      }

      messageCount++;

      try {
        // Stream the response
        process.stdout.write(ansis.cyan(`${selectedClient.getClientName()}: `));
        await selectedClient.sendMessage(userInput, {
          workingDirectory: model.rootPath,
          agent: agentName,
          withDanger,
          sessionId: logger.getSessionId(),
        });
        console.log('\n');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (isTelemetryEnabled && span) {
          emitLog(SeverityNumber.ERROR, 'Message send failed', {
            'error.message': message,
            'chat.messageCount': messageCount,
          });
        }
        console.error(ansis.red(`Error: ${message}`));
        await logger.logError(message, {
          messageCount,
        });
      }
    }

    if (isTelemetryEnabled && span) {
      (span as any).setStatus({ code: 0 });
    }
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({ code: 2, message: error instanceof Error ? error.message : String(error) });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error(ansis.red(`Error: ${message}`));

    // Log fatal error if logger is available
    const logger = getChatLogger();
    if (logger) {
      await logger.logError(message, {
        fatal: true,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }

    process.exit(1);
  } finally {
    endSpan(span);
  }
}
