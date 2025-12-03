/**
 * Conversation Context Analyzer
 *
 * Analyzes chat history to extract contextual information for skill activation.
 */

import * as vscode from 'vscode';
import { ConversationContext, OperationType } from './types';

export class ConversationContextAnalyzer {
    /**
     * Analyze conversation history and current message to build context
     */
    static analyze(
        history: readonly (vscode.ChatRequestTurn | vscode.ChatResponseTurn)[],
        currentMessage: string
    ): ConversationContext {
        const recentMessages: string[] = [];
        const recentCommands: string[] = [];
        const recentOperations: OperationType[] = [];
        const modifiedLayers = new Set<string>();
        let activeChangeset = false;

        // Process history (last 10 turns for context)
        const turnsToAnalyze = history.slice(-10);

        for (const turn of turnsToAnalyze) {
            if (turn instanceof vscode.ChatRequestTurn) {
                recentMessages.push(turn.prompt);
            } else if (turn instanceof vscode.ChatResponseTurn) {
                let responseText = '';
                for (const part of turn.response) {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        responseText += part.value.value;
                    }
                }

                // Extract DR commands from execute blocks
                const commands = this.extractDrCommands(responseText);
                recentCommands.push(...commands);

                // Detect operations from commands
                const operations = this.detectOperations(commands);
                recentOperations.push(...operations);

                // Extract modified layers
                const layers = this.extractModifiedLayers(commands);
                layers.forEach(layer => modifiedLayers.add(layer));

                // Check for active changeset
                if (this.detectActiveChangeset(commands, responseText)) {
                    activeChangeset = true;
                }

                recentMessages.push(responseText);
            }
        }

        // Add current message
        recentMessages.push(currentMessage);

        return {
            recentMessages: recentMessages.slice(-10), // Keep last 10 messages
            recentCommands: recentCommands.slice(-15), // Keep last 15 commands
            recentOperations: recentOperations.slice(-10),
            modifiedLayers: Array.from(modifiedLayers),
            activeChangeset
        };
    }

    /**
     * Extract DR CLI commands from response text containing execute blocks
     */
    private static extractDrCommands(text: string): string[] {
        const commands: string[] = [];
        const executeRegex = /```execute\s+(dr\s+[^\n`]+)/g;
        let match;

        while ((match = executeRegex.exec(text)) !== null) {
            commands.push(match[1].trim());
        }

        return commands;
    }

    /**
     * Detect high-level operations from command patterns
     */
    private static detectOperations(commands: string[]): OperationType[] {
        const operations: OperationType[] = [];

        for (const cmd of commands) {
            if (cmd.includes('dr add')) {
                operations.push(OperationType.ADD_ELEMENT);
            } else if (cmd.includes('dr update')) {
                operations.push(OperationType.MODIFY_ELEMENT);
            } else if (cmd.includes('dr remove')) {
                operations.push(OperationType.DELETE_ELEMENT);
            } else if (cmd.includes('dr validate')) {
                operations.push(OperationType.VALIDATE);
            } else if (cmd.includes('dr ingest') || cmd.includes('dr extract')) {
                operations.push(OperationType.EXTRACT_CODE);
            } else if (cmd.includes('dr changeset apply')) {
                operations.push(OperationType.APPLY_CHANGESET);
            }
        }

        return operations;
    }

    /**
     * Extract layer names from dr add/update commands
     */
    private static extractModifiedLayers(commands: string[]): string[] {
        const layers: string[] = [];
        const layerPattern = /dr (?:add|update)\s+(\w+)/;

        for (const cmd of commands) {
            const match = cmd.match(layerPattern);
            if (match) {
                layers.push(match[1]);
            }
        }

        return layers;
    }

    /**
     * Detect if a changeset is currently active
     */
    private static detectActiveChangeset(commands: string[], responseText: string): boolean {
        // Check for changeset create command
        const hasCreateChangeset = commands.some(cmd => cmd.includes('dr changeset create'));

        // Check for changeset apply or discard (would deactivate)
        const hasApplyOrDiscard = commands.some(cmd =>
            cmd.includes('dr changeset apply') || cmd.includes('dr changeset discard')
        );

        // If created and not applied/discarded, it's active
        if (hasCreateChangeset && !hasApplyOrDiscard) {
            return true;
        }

        // Also check for mentions of being "in a changeset" or "changeset: name"
        if (responseText.toLowerCase().includes('changeset') && !hasApplyOrDiscard) {
            return responseText.includes('changeset: ') || responseText.includes('in changeset');
        }

        return false;
    }
}
