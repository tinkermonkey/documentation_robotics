# Documentation Robotics for GitHub Copilot

This extension integrates **Documentation Robotics (DR)** into GitHub Copilot Chat, allowing you to model, validate, and document architecture using natural language directly within VS Code.

## Overview

This integration replicates the functionality of the Claude Code integration but is built as a native VS Code extension using the Chat Participant API.

| Feature         | Implementation                                        |
| :-------------- | :---------------------------------------------------- |
| **Participant** | `@dr`                                                 |
| **Commands**    | `/init`, `/model`, `/validate`, `/ingest`, `/project` |
| **Context**     | System prompts derived from DR Reference Sheets       |
| **Execution**   | Local `dr` CLI execution via Node.js `child_process`  |

## Implementation Plan

### 1. Extension Manifest (`package.json`)

- Define the `@dr` chat participant.
- Register slash commands (`/validate`, `/model`, etc.).
- Declare activation events.

### 2. Chat Handler (`src/extension.ts`)

- Implement `vscode.ChatRequestHandler`.
- Route slash commands to specific handlers.
- Manage context (Tier 1/2/3 reference sheets).
- Interface with the `dr` CLI.

### 3. Prompt Engineering (`src/prompts/`)

- Port existing Markdown reference sheets from `cli/src/documentation_robotics/claude_integration/` to TypeScript string constants.
- **Tier 1**: Essentials (Always loaded).
- **Tier 2**: Developer Guide (Loaded for modeling).
- **Agents**: Specialized prompts for `/validate` and `/ingest`.

### 4. CLI Integration (`src/drCli.ts`)

- Wrapper around `child_process` to execute `dr` commands.
- Handle output parsing (JSON vs Text).
- Error handling and user feedback.

## Development

### Prerequisites

- Node.js & npm
- VS Code 1.85+
- GitHub Copilot Chat Extension
- Documentation Robotics CLI installed (`pip install documentation-robotics`)

### Setup

1. `npm install`
2. Open in VS Code
3. Press `F5` to launch Extension Development Host

### Usage

In GitHub Copilot Chat:

- `@dr /init` - Initialize a new project
- `@dr /model Add a payment service` - Interactive modeling
- `@dr /validate` - Validate architecture
