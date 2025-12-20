/**
 * Chat Command - Interactive chat with Claude about the architecture model
 * Implements streaming responses and multi-turn conversations
 */

import ansis from 'ansis';
import { text, intro, outro } from '@clack/prompts';
import { Model } from '../core/model.js';
import { ClaudeClient } from '../ai/claude-client.js';
import { ModelContextProvider } from '../ai/context-provider.js';
import { getModelTools } from '../ai/tools.js';

/**
 * Chat command implementation
 * Launches an interactive conversation with Claude about the architecture model
 */
export async function chatCommand(): Promise<void> {
  try {
    // Check for API key
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error(ansis.red('Error: ANTHROPIC_API_KEY environment variable not set'));
      process.exit(1);
    }

    // Load the model
    const model = await Model.load(process.cwd());
    if (!model) {
      console.error(ansis.red('Error: Could not load architecture model'));
      process.exit(1);
    }

    // Initialize Claude client and context provider
    const client = new ClaudeClient(apiKey);
    const contextProvider = new ModelContextProvider(model);

    // Show intro
    intro(ansis.bold(ansis.cyan('Documentation Robotics Chat')));
    console.log(ansis.dim('Powered by Claude AI - Ask about your architecture model\n'));

    // Generate system prompt with model context
    const modelContext = await contextProvider.generateContext();
    const systemPrompt = `You are a helpful assistant analyzing an architecture model built with Documentation Robotics. The model defines a 12-layer federated architecture.

${modelContext}

You have access to tools to query the model:
- dr_list: List elements in a specific layer
- dr_find: Find a specific element by ID
- dr_search: Search for elements by name or description
- dr_trace: Trace dependencies for an element (what depends on it, what it depends on)

Use these tools to help answer questions about the architecture model. When the user asks about specific elements or layers, use the tools to get the most current information.`;

    // Get available tools
    const tools = getModelTools();

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
        const stream = await client.chat(userInput, {
          systemPrompt,
          tools,
        });

        for await (const chunk of stream) {
          process.stdout.write(chunk);
        }
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
