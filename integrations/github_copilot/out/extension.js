"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const tier2_1 = require("./prompts/tier2");
const validator_1 = require("./prompts/validator");
const drCli_1 = require("./drCli");
const skillsManager_1 = require("./skills/skillsManager");
const conversationContext_1 = require("./skills/conversationContext");
const intentDetector_1 = require("./modeling/intentDetector");
const workflows_1 = require("./prompts/workflows");
const drArchitect_1 = require("./prompts/drArchitect");
function activate(context) {
    const handler = async (request, context, stream, token) => {
        // 1. Analyze conversation context and activate skills
        const conversationContext = conversationContext_1.ConversationContextAnalyzer.analyze(context.history, request.prompt);
        const skillsManager = new skillsManager_1.SkillsManager();
        const activatedSkills = await skillsManager.analyzeAndActivate(conversationContext);
        // Show activated skills to user (for transparency)
        if (activatedSkills.length > 0) {
            const skillNames = activatedSkills.map(s => s.skillName).join(', ');
            stream.markdown(`*Skills activated: ${skillNames}*\n\n`);
        }
        // 2. Build system prompt with TIER2 base + activated skill prompts
        let systemPrompt = tier2_1.TIER2_DEVELOPER_GUIDE;
        // Inject skill prompts
        for (const activation of activatedSkills) {
            systemPrompt += '\n\n' + activation.prompt;
        }
        // Add tool instructions
        systemPrompt += `

You are the Documentation Robotics assistant (@dr).
Your goal is to help the user model, validate, and document their architecture.

CRITICAL TOOL USE INSTRUCTIONS:
You have access to the following tools. To use a tool, you MUST output a markdown code block with the EXACT language identifier shown below.

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

EXECUTION RULES (MUST FOLLOW):
1. When you output a tool code block (execute, shell, or create_file), the command is AUTOMATICALLY EXECUTED
2. After outputting the code block, STOP generating text immediately
3. The tool output will be provided to you in the next message
4. Only after receiving the tool output can you analyze results and continue
5. If you do NOT output a code block, NOTHING is executed - you are just talking, not acting

CRITICAL: You are an AGENTIC assistant, not a suggestion bot:
- When the user asks you to run a command: OUTPUT THE EXECUTE BLOCK IMMEDIATELY
- When the user asks you to create a file: OUTPUT THE CREATE_FILE BLOCK IMMEDIATELY
- DO NOT say "you should run" or "I suggest running" - EXECUTE IT YOURSELF
- DO NOT explain what you would do - DO IT, then explain what happened

Example WRONG behavior:
User: "Validate the model"
Assistant: "I suggest running \`dr validate --strict\` to check your model."  ❌ WRONG - nothing executed!

Example CORRECT behavior:
User: "Validate the model"
Assistant: "I'll validate your model now.

\`\`\`execute
dr validate --strict
\`\`\`
"  ✅ CORRECT - command will execute!

NEVER claim a command ran successfully if you only suggested it. If you didn't output an execute/shell/create_file block, the command did NOT run.
`;
        const messages = [
            vscode.LanguageModelChatMessage.User(systemPrompt)
        ];
        // 2. Load History
        for (const turn of context.history) {
            if (turn instanceof vscode.ChatRequestTurn) {
                messages.push(vscode.LanguageModelChatMessage.User(turn.prompt));
            }
            else if (turn instanceof vscode.ChatResponseTurn) {
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
        }
        else if (request.command === 'ingest') {
            await handleIngestCommand(request, stream, token, messages);
            return;
        }
        else if (request.command === 'init') {
            await handleInitCommand(request, stream, token, messages);
            return;
        }
        else if (request.command === 'project') {
            await handleProjectCommand(request, stream, token, messages);
            return;
        }
        else if (request.command === 'model') {
            // Detect intent from user's message
            const intentDetector = new intentDetector_1.IntentDetector();
            const intentResult = intentDetector.detect(request.prompt, conversationContext);
            // Show detected intent to user
            if (intentResult.confidence >= 0.7) {
                stream.markdown(`*Intent detected: ${intentResult.intent} (${Math.round(intentResult.confidence * 100)}% confidence)*\n\n`);
            }
            // Inject DR Architect core identity
            messages.push(vscode.LanguageModelChatMessage.User(drArchitect_1.DR_ARCHITECT_CORE));
            // Inject workflow-specific prompt if detected
            if (intentResult.suggestedWorkflow && workflows_1.WORKFLOW_PROMPTS[intentResult.suggestedWorkflow]) {
                messages.push(vscode.LanguageModelChatMessage.User(workflows_1.WORKFLOW_PROMPTS[intentResult.suggestedWorkflow]));
            }
            // Add context message with detected intent and entities
            const entitiesStr = Object.keys(intentResult.entities).length > 0
                ? `Entities: ${JSON.stringify(intentResult.entities)}\n`
                : '';
            messages.push(vscode.LanguageModelChatMessage.User(`User request: ${request.prompt}\n\n` +
                `${entitiesStr}` +
                `Interpret the user's natural language intent and execute appropriate DR commands.`));
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
async function runAgentLoop(model, messages, stream, token) {
    let loopCount = 0;
    const MAX_LOOPS = 10;
    let anyToolExecuted = false;
    while (loopCount < MAX_LOOPS) {
        if (token.isCancellationRequested)
            break;
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
            if (executeMatch && executeMatch.index !== undefined)
                matches.push({ type: 'execute', index: executeMatch.index, match: executeMatch });
            if (shellMatch && shellMatch.index !== undefined)
                matches.push({ type: 'shell', index: shellMatch.index, match: shellMatch });
            if (createFileMatch && createFileMatch.index !== undefined)
                matches.push({ type: 'create_file', index: createFileMatch.index, match: createFileMatch });
            if (matches.length > 0) {
                anyToolExecuted = true;
                matches.sort((a, b) => a.index - b.index);
                const firstMatch = matches[0];
                if (firstMatch.type === 'execute') {
                    const fullCommand = firstMatch.match[1].trim();
                    const args = fullCommand.replace(/^dr\s+/, '');
                    stream.markdown(`\n\n*Running DR: \`${fullCommand}\`...*\n\n`);
                    let output = "";
                    try {
                        output = await (0, drCli_1.runDrCli)(args);
                    }
                    catch (err) {
                        output = `Error: ${err}`;
                    }
                    messages.push(vscode.LanguageModelChatMessage.Assistant(fullResponse));
                    messages.push(vscode.LanguageModelChatMessage.User(`Tool Output for '${fullCommand}':\n\`\`\`\n${output}\n\`\`\`\n\nRemember: This is the ACTUAL output from the command that was executed. Analyze it carefully.`));
                }
                else if (firstMatch.type === 'shell') {
                    const command = firstMatch.match[1].trim();
                    stream.markdown(`\n\n*Running Shell: \`${command}\`...*\n\n`);
                    let output = "";
                    try {
                        output = await runShell(command);
                    }
                    catch (err) {
                        output = `Error: ${err}`;
                    }
                    messages.push(vscode.LanguageModelChatMessage.Assistant(fullResponse));
                    messages.push(vscode.LanguageModelChatMessage.User(`Tool Output for '${command}':\n\`\`\`\n${output}\n\`\`\`\n\nRemember: This is the ACTUAL output from the command that was executed. Analyze it carefully.`));
                }
                else if (firstMatch.type === 'create_file') {
                    const filePath = firstMatch.match[1].trim();
                    const content = firstMatch.match[2];
                    stream.markdown(`\n\n*Creating File: \`${filePath}\`...*\n\n`);
                    let output = "";
                    try {
                        output = await createFile(filePath, content);
                    }
                    catch (err) {
                        output = `Error: ${err}`;
                    }
                    messages.push(vscode.LanguageModelChatMessage.Assistant(fullResponse));
                    messages.push(vscode.LanguageModelChatMessage.User(`Tool Output for creating '${filePath}':\n${output}\n\nRemember: This is confirmation that the file was created.`));
                }
            }
            else {
                // No tool execution detected - check if model suggested commands without executing
                const suggestedDrCommand = fullResponse.match(/(?:run|execute|try|suggest(?:ed)?|should)\s+[`']?dr\s+[\w\-]+/i);
                const inlineCodeDr = fullResponse.match(/`dr\s+[\w\-]+[^`]*`/);
                if ((suggestedDrCommand || inlineCodeDr) && !anyToolExecuted) {
                    stream.markdown(`\n\n⚠️ **Warning**: It looks like I suggested a command but didn't execute it. Let me fix that.\n\n`);
                    // Provide corrective feedback
                    messages.push(vscode.LanguageModelChatMessage.Assistant(fullResponse));
                    messages.push(vscode.LanguageModelChatMessage.User(`CRITICAL CORRECTION: You suggested a command but did NOT execute it. No command has run yet.\n\n` +
                        `You MUST output an execution code block to actually run the command:\n` +
                        `\`\`\`execute\ndr <command>\n\`\`\`\n\n` +
                        `Please execute the command NOW using the correct format above. Do not just talk about it.`));
                    continue; // Loop again to get execution
                }
                break;
            }
        }
        catch (err) {
            if (err instanceof Error) {
                stream.markdown(`Error communicating with Copilot: ${err.message}`);
            }
            break;
        }
    }
}
async function runShell(command) {
    return new Promise((resolve, _reject) => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        const cwd = workspaceFolders ? workspaceFolders[0].uri.fsPath : undefined;
        cp.exec(command, { cwd }, (err, stdout, stderr) => {
            if (err) {
                resolve(`Error: ${err.message}\nStderr: ${stderr}`);
            }
            else {
                resolve(stdout);
            }
        });
    });
}
async function createFile(filePath, content) {
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
async function handleValidateCommand(request, stream, token, messages) {
    stream.progress("Running validation...");
    try {
        // 1. Run CLI Command
        const output = await (0, drCli_1.runDrCli)("validate --strict");
        // 2. Inject Validator Persona
        messages.push(vscode.LanguageModelChatMessage.User(validator_1.VALIDATOR_AGENT_PROMPT));
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
    }
    catch (error) {
        stream.markdown(`Failed to run validation: ${error}`);
    }
}
async function handleIngestCommand(request, stream, token, messages) {
    // Parse flags from the prompt
    const flags = parseCliFlags(request.prompt);
    // Inject extraction workflow
    messages.push(vscode.LanguageModelChatMessage.User(workflows_1.WORKFLOW_PROMPTS['extraction']));
    messages.push(vscode.LanguageModelChatMessage.User(drArchitect_1.DR_ARCHITECT_CORE));
    // Build the command instruction
    let commandInstruction = `The user wants to ingest/extract code into the DR model.\n\n`;
    if (flags.layers && flags.layers.length > 0) {
        commandInstruction += `Target layers: ${flags.layers.join(', ')}\n`;
    }
    commandInstruction += `\nYou MUST execute the ingest command immediately using the execute tool:\n`;
    commandInstruction += `\`\`\`execute\ndr ingest${flags.layers && flags.layers.length > 0 ? ' --layers ' + flags.layers.join(',') : ''}${flags.strict ? ' --strict' : ''}\n\`\`\`\n\n`;
    commandInstruction += `DO NOT just suggest this command. Execute it now using the exact format shown above.`;
    messages.push(vscode.LanguageModelChatMessage.User(commandInstruction));
    // Send to Copilot
    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4' });
    if (model) {
        await runAgentLoop(model, messages, stream, token);
    }
}
async function handleInitCommand(_request, stream, token, messages) {
    messages.push(vscode.LanguageModelChatMessage.User(drArchitect_1.DR_ARCHITECT_CORE));
    messages.push(vscode.LanguageModelChatMessage.User(`
The user wants to initialize a new DR model.

Execute this command immediately:
\`\`\`execute
dr init
\`\`\`

After initialization completes, guide the user on next steps (adding elements, ingesting code, etc.).
    `));
    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4' });
    if (model) {
        await runAgentLoop(model, messages, stream, token);
    }
}
async function handleProjectCommand(request, stream, token, messages) {
    messages.push(vscode.LanguageModelChatMessage.User(drArchitect_1.DR_ARCHITECT_CORE));
    let commandInstruction = `The user wants to project elements across layers.\n\n`;
    commandInstruction += `Execute the project command:\n`;
    commandInstruction += `\`\`\`execute\ndr project ${request.prompt}\n\`\`\`\n\n`;
    commandInstruction += `DO NOT just suggest this command. Execute it now.`;
    messages.push(vscode.LanguageModelChatMessage.User(commandInstruction));
    const [model] = await vscode.lm.selectChatModels({ vendor: 'copilot', family: 'gpt-4' });
    if (model) {
        await runAgentLoop(model, messages, stream, token);
    }
}
/**
 * Parse CLI flags from a prompt string
 * Examples: "--layers api,data_model --strict" => { layers: ['api', 'data_model'], strict: true }
 */
function parseCliFlags(prompt) {
    const flags = {};
    // Parse --layers flag
    const layersMatch = prompt.match(/--layers\s+([a-z_,]+)/i);
    if (layersMatch) {
        flags.layers = layersMatch[1].split(',').map(l => l.trim());
    }
    // Parse --strict flag
    if (prompt.includes('--strict')) {
        flags.strict = true;
    }
    return flags;
}
function deactivate() { }
//# sourceMappingURL=extension.js.map
