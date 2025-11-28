import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as cp from 'child_process';
import { TIER1_ESSENTIALS } from './prompts/tier1';
import { TIER2_DEVELOPER_GUIDE } from './prompts/tier2';
import { VALIDATOR_AGENT_PROMPT } from './prompts/validator';
import { runDrCli } from './drCli';

export function activate(context: vscode.ExtensionContext) {

    const handler: vscode.ChatRequestHandler = async (request: vscode.ChatRequest, context: vscode.ChatContext, stream: vscode.ChatResponseStream, token: vscode.CancellationToken) => {

        // 1. System Prompt with Tool Instructions
        const systemPrompt = TIER2_DEVELOPER_GUIDE + `
You are the Documentation Robotics assistant (@dr).
Your goal is to help the user model, validate, and document their architecture.

TOOL USE INSTRUCTIONS:
You have access to the following tools. To use a tool, output a markdown code block with the specific language identifier.

1. Execute 'dr' CLI commands:
\`\`\`execute
dr <command>
\`\`\`

2. Execute arbitrary shell commands (e.g., python scripts, git, etc.):
\`\`\`shell
<command>
\`\`\`

3. Create or overwrite a file:
\`\`\`create_file <path/to/file>
<file content>
\`\`\`

When you use a tool:
1. Output the command block.
2. Stop generating text.
3. Wait for the tool output (it will be provided in the next message).
4. Analyze the output and continue.

You are an agentic assistant. If the user asks you to create a script or perform a task, DO NOT just suggest it. Create the file and execute it using the tools provided.
Always validate your changes after making them.
`;

        const messages: vscode.LanguageModelChatMessage[] = [
            vscode.LanguageModelChatMessage.User(systemPrompt)
        ];

        // 2. Load History
        for (const turn of context.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
            } else if (turn instanceof vscode.ChatResponseTurn) {
                let responseText = '';
                for (const part of turn.response) {
                    if (part instanceof vscode.ChatResponseMarkdownPart) {
                        responseText += part.value.value;
                    }
                }
                messages.push(vscode.LanguageModelChatMessage.Assistant(responseText));
            }
        }

        // 3. Handle Slash Commands
        if (request.command === 'validate') {
            await handleValidateCommand(request, stream, token, messages);
            return;
        } else if (request.command === 'model') {
            messages.push(vscode.LanguageModelChatMessage.User("The user wants to perform interactive modeling. Interpret their intent and suggest 'dr' commands."));
        }

        // 4. Add user's message
        messages.push(vscode.LanguageModelChatMessage.User(request.prompt));

        // 5. Select Model
        const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4' });
        if (!model) {
            stream.markdown("Error: Could not find a compatible Copilot model.");
            return;
        }

        // 6. Run Agent Loop
        await runAgentLoop(model, messages, stream, token);
    };

    const drParticipant = vscode.chat.createChatParticipant('documentation-robotics.dr', handler);
    drParticipant.iconPath = vscode.Uri.file(context.asAbsolutePath('icon.png'));
}

async function runAgentLoop(
    model: vscode.LanguageModelChat,
    messages: vscode.LanguageModelChatMessage[],
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken
) {
    let loopCount = 0;
    const MAX_LOOPS = 10;

    while (loopCount < MAX_LOOPS) {
        if (token.isCancellationRequested) break;
        loopCount++;

        try {
            const chatResponse = await model.sendRequest(messages, {}, token);
            let fullResponse = "";

            for await (const fragment of chatResponse.text) {
                stream.markdown(fragment);
                fullResponse += fragment;
            }

            // Check for tool calls
            const executeRegex = /```execute\s+(dr\s+[^\n]+)\s*```/;
            const shellRegex = /```shell\s+([\s\S]+?)\s*```/;
            const createFileRegex = /```create_file\s+([^\n]+)\n([\s\S]*?)```/;

            const executeMatch = fullResponse.match(executeRegex);
            const shellMatch = fullResponse.match(shellRegex);
            const createFileMatch = fullResponse.match(createFileRegex);

            // Find the first match in the text to respect execution order
            const matches = [];
            if (executeMatch && executeMatch.index !== undefined) matches.push({ type: 'execute', index: executeMatch.index, match: executeMatch });
            if (shellMatch && shellMatch.index !== undefined) matches.push({ type: 'shell', index: shellMatch.index, match: shellMatch });
            if (createFileMatch && createFileMatch.index !== undefined) matches.push({ type: 'create_file', index: createFileMatch.index, match: createFileMatch });

            if (matches.length > 0) {
                matches.sort((a, b) => a.index - b.index);
                const firstMatch = matches[0];

                if (firstMatch.type === 'execute') {
                    const fullCommand = firstMatch.match[1].trim();
                    const args = fullCommand.replace(/^dr\s+/, '');

                    stream.markdown(`\n\n*Running DR: \`${fullCommand}\`...*\n\n`);

                    let output = "";
                    try {
                        output = await runDrCli(args);
                    } catch (err) {
                        output = `Error: ${err}`;
                    }

                    messages.push(vscode.LanguageModelChatMessage.Assistant(fullResponse));
                    messages.push(vscode.LanguageModelChatMessage.User(`Tool Output for '${fullCommand}':\n\`\`\`\n${output}\n\`\`\``));
                } else if (firstMatch.type === 'shell') {
                    const command = firstMatch.match[1].trim();
                    stream.markdown(`\n\n*Running Shell: \`${command}\`...*\n\n`);
                    let output = "";
                    try {
                        output = await runShell(command);
                    } catch (err) {
                        output = `Error: ${err}`;
                    }
                    messages.push(vscode.LanguageModelChatMessage.Assistant(fullResponse));
                    messages.push(vscode.LanguageModelChatMessage.User(`Tool Output for '${command}':\n\`\`\`\n${output}\n\`\`\``));
                } else if (firstMatch.type === 'create_file') {
                    const filePath = firstMatch.match[1].trim();
                    const content = firstMatch.match[2];
                    stream.markdown(`\n\n*Creating File: \`${filePath}\`...*\n\n`);
                    let output = "";
                    try {
                        output = await createFile(filePath, content);
                    } catch (err) {
                        output = `Error: ${err}`;
                    }
                    messages.push(vscode.LanguageModelChatMessage.Assistant(fullResponse));
                    messages.push(vscode.LanguageModelChatMessage.User(`Tool Output for creating '${filePath}':\n${output}`));
                }
            } else {
                break;
            }
        } catch (err) {
            if (err instanceof Error) {
                stream.markdown(`Error communicating with Copilot: ${err.message}`);
            }
            break;
        }
    }
}

async function runShell(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const cwd = workspaceFolders ? workspaceFolders[0].uri.fsPath : undefined;

        cp.exec(command, { cwd }, (err, stdout, stderr) => {
            if (err) {
                resolve(`Error: ${err.message}\nStderr: ${stderr}`);
            } else {
                resolve(stdout);
            }
        });
    });
}

async function createFile(filePath: string, content: string): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        throw new Error("No workspace folder open.");
    }
    const rootPath = workspaceFolders[0].uri.fsPath;
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(rootPath, filePath);

    // Ensure directory exists
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absolutePath, content);
    return `File created successfully at ${absolutePath}`;
}

async function handleValidateCommand(
    request: vscode.ChatRequest,
    stream: vscode.ChatResponseStream,
    token: vscode.CancellationToken,
    messages: vscode.LanguageModelChatMessage[]
) {
    stream.progress("Running validation...");

    try {
        // 1. Run CLI Command
        const output = await runDrCli("validate --strict");

        // 2. Inject Validator Persona
        messages.push(vscode.LanguageModelChatMessage.User(VALIDATOR_AGENT_PROMPT));
        messages.push(vscode.LanguageModelChatMessage.User(`
            Here is the validation output from 'dr validate --strict':
            \`\`\`text
            ${output}
            \`\`\`

            User request: ${request.prompt || "Analyze this validation report and suggest fixes."}
        `));

        // 3. Send to Copilot (using Agent Loop)
        const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4' });
        if (model) {
            await runAgentLoop(model, messages, stream, token);
        }

    } catch (error) {
        stream.markdown(`Failed to run validation: ${error}`);
    }
}

export function deactivate() {}
