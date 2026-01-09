#!/usr/bin/env node
/**
 * Example: Using the Agent Abstraction Layer
 * 
 * This example demonstrates how to use the CodingAgent abstraction
 * to interact with Claude Code CLI.
 * 
 * Usage:
 *   node examples/agent-usage.js
 */

import { ClaudeCodeAgent } from '../dist/ai/agents/index.js';

async function main() {
  console.log('=== Agent Abstraction Layer Example ===\n');
  
  // 1. Create agent instance
  const agent = new ClaudeCodeAgent();
  console.log(`Agent: ${agent.name}`);
  console.log(`Command: ${agent.command}\n`);
  
  // 2. Check availability
  console.log('Checking availability...');
  const available = await agent.isAvailable();
  console.log(`Available: ${available}`);
  
  if (!available) {
    console.log('Note: Claude Code CLI not installed, but we can still demo parsing.\n');
  } else {
    console.log();
  }
  
  // 3. Test output parsing
  console.log('=== Testing Output Parsing ===\n');
  
  const sampleOutput = `{"type":"assistant","message":{"content":[{"type":"text","text":"I'll help you with that."}]}}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"dr list api"}}]}}
{"type":"result","result":"api-endpoint-create-user\\napi-endpoint-list-users"}
{"type":"assistant","message":{"content":[{"type":"text","text":"Found 2 API endpoints."}]}}`;
  
  const events = agent.parseOutput(sampleOutput);
  console.log(`Parsed ${events.length} events:\n`);
  
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    console.log(`Event ${i + 1}:`);
    console.log(`  Type: ${event.type}`);
    
    if (event.content) {
      console.log(`  Content: ${event.content}`);
    }
    if (event.toolName) {
      console.log(`  Tool: ${event.toolName}`);
      console.log(`  Input: ${JSON.stringify(event.toolInput)}`);
    }
    if (event.toolResult) {
      console.log(`  Result: ${event.toolResult}`);
    }
    console.log();
  }
  
  // 4. Demonstrate spawning (without actually running)
  console.log('=== Spawn Configuration Example ===\n');
  console.log('To spawn an agent process:');
  console.log(`
const agentProcess = agent.spawn({
  cwd: '/path/to/project',
  message: 'What layers are in this model?',
  agentName: 'dr-architect',
});

// Monitor output
agentProcess.process.stdout?.on('data', (data) => {
  const events = agent.parseOutput(data.toString());
  for (const event of events) {
    if (event.type === 'text') {
      console.log(event.content);
    }
  }
});

// Wait for completion
const result = await agentProcess.completion;
console.log('Exit code:', result.exitCode);
console.log('Full response:', result.fullResponse);
  `);
  
  console.log('=== Example Complete ===');
}

main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
