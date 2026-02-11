/**
 * Chat Logs Command
 *
 * View and manage chat session logs stored in .dr/chat/sessions/
 */

import { Command } from "commander";
import ansis from "ansis";
import {
  listChatSessions,
  readChatSession,
  getChatLogger,
  ChatLogEntry,
} from "../utils/chat-logger.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { Model } from "../core/model.js";
import { getErrorMessage } from "../utils/errors.js";

/**
 * Format a chat log entry for display
 */
function formatLogEntry(entry: ChatLogEntry): string {
  const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : "N/A";
  const roleLabel = entry.role ? `[${entry.role.toUpperCase()}]` : "";
  const typeLabel = `[${entry.type.toUpperCase()}]`;

  let color = ansis.dim;
  if (entry.type === "error") {
    color = ansis.red;
  } else if (entry.type === "command") {
    color = ansis.cyan;
  } else if (entry.type === "message" && entry.role === "user") {
    color = ansis.green;
  } else if (entry.type === "message" && entry.role === "assistant") {
    color = ansis.blue;
  }

  const line = `${timestamp} ${typeLabel} ${roleLabel}`;
  const prefix = color(line);

  // Truncate content if too long
  let content = entry.content;
  const maxLength = 100;
  if (content.length > maxLength) {
    content = content.substring(0, maxLength) + "...";
  }

  return `${prefix}: ${content}`;
}

/**
 * Register chat logs command
 */
export function chatLogsCommand(program: Command): void {
  const logsCommand = program.command("chat-logs").description("View and manage chat session logs");

  /**
   * List sessions subcommand
   */
  logsCommand
    .command("list")
    .alias("ls")
    .description("List all chat sessions")
    .option("-l, --limit <number>", "Limit number of sessions shown", "10")
    .addHelpText(
      "after",
      `
Examples:
  $ dr chat-logs list                 # Show last 10 sessions
  $ dr chat-logs list --limit 20      # Show last 20 sessions`
    )
    .action(async (options) => {
      try {
        // Load model to get project root if available
        let projectRoot: string | undefined;
        try {
          const model = await Model.load(process.cwd());
          if (model) {
            projectRoot = model.rootPath;
          }
        } catch {
          // Model not available, will use default
        }

        const sessions = await listChatSessions(projectRoot);
        const limit = Math.min(parseInt(options.limit) || 10, sessions.length);

        if (sessions.length === 0) {
          console.log(ansis.yellow("No chat sessions found."));
          return;
        }

        console.log("");
        console.log(ansis.bold("Chat Sessions:"));
        console.log("");

        for (let i = 0; i < limit; i++) {
          const session = sessions[i];
          const filename = session.replace(".log", "");
          const index = limit - i;
          console.log(`${ansis.dim(`${index}.`)} ${ansis.cyan(filename)}`);
        }

        console.log("");
        console.log(ansis.dim(`Use 'dr chat-logs view <session-id>' to view a session`));
        console.log(ansis.dim(`Total sessions: ${sessions.length}`));
        console.log("");
      } catch (error) {
        console.error(ansis.red("Error:"), getErrorMessage(error));
        process.exit(1);
      }
    });

  /**
   * View session subcommand
   */
  logsCommand
    .command("view <session-file>")
    .description("View a specific chat session")
    .option("-n, --no-truncate", "Show full content without truncation")
    .addHelpText(
      "after",
      `
Examples:
  $ dr chat-logs view <session-id>_<timestamp>.log    # View session details
  $ dr chat-logs view <session-id> --no-truncate       # Show full content`
    )
    .action(async (sessionFile, options) => {
      try {
        // Load model to get project root if available
        let projectRoot: string | undefined;
        try {
          const model = await Model.load(process.cwd());
          if (model) {
            projectRoot = model.rootPath;
          }
        } catch {
          // Model not available, will use default
        }

        // Support both with and without .log extension
        const logFile = sessionFile.endsWith(".log") ? sessionFile : sessionFile + ".log";

        const entries = await readChatSession(logFile, projectRoot);

        if (entries.length === 0) {
          console.log(ansis.yellow("Session not found or is empty."));
          return;
        }

        console.log("");
        console.log(ansis.bold(`Session: ${ansis.cyan(sessionFile)}`));
        console.log("");

        // Find session info
        const sessionStart = entries.find(
          (e) => e.type === "event" && e.content === "Session started"
        );
        const sessionId = sessionStart?.metadata?.sessionId || "unknown";

        console.log(ansis.dim(`Session ID: ${sessionId}`));
        console.log(ansis.dim(`Entries: ${entries.length}`));
        console.log("");
        console.log(ansis.bold("Messages:"));
        console.log("");

        for (const entry of entries) {
          if (options.noTruncate || entry.type === "command") {
            const timestamp = entry.timestamp
              ? new Date(entry.timestamp).toLocaleTimeString()
              : "N/A";
            const roleLabel = entry.role ? `[${entry.role.toUpperCase()}]` : "";
            const typeLabel = `[${entry.type.toUpperCase()}]`;

            let line = `${ansis.dim(timestamp)} ${typeLabel}`;
            if (roleLabel) {
              line += ` ${roleLabel}`;
            }

            console.log(line);

            if (entry.type === "command") {
              console.log(ansis.cyan(`  $ ${entry.content}`));
              if (entry.metadata?.args) {
                console.log(ansis.dim(`  Args: ${JSON.stringify(entry.metadata.args)}`));
              }
            } else {
              // Split long content into multiple lines
              const contentLines = entry.content.split("\n");
              for (const contentLine of contentLines) {
                console.log(`  ${contentLine}`);
              }
            }

            if (entry.metadata && Object.keys(entry.metadata).length > 0) {
              console.log(ansis.dim(`  Metadata: ${JSON.stringify(entry.metadata)}`));
            }

            console.log("");
          } else {
            console.log(formatLogEntry(entry));
          }
        }
      } catch (error) {
        console.error(ansis.red("Error:"), getErrorMessage(error));
        process.exit(1);
      }
    });

  /**
   * Current session subcommand
   */
  logsCommand
    .command("current")
    .description("Show current chat session information")
    .addHelpText(
      "after",
      `
Examples:
  $ dr chat-logs current    # Show current session info`
    )
    .action(async () => {
      try {
        const logger = getChatLogger();

        if (!logger) {
          console.log(ansis.yellow("No active chat session."));
          return;
        }

        console.log("");
        console.log(ansis.bold("Current Chat Session:"));
        console.log("");
        console.log(`Session ID: ${ansis.cyan(logger.getSessionId())}`);
        console.log(`Log file: ${logger.getSessionLogPath()}`);
        console.log("");

        const summary = await logger.getSummary();
        console.log("Statistics:");
        console.log(`  Messages: ${summary.messageCount}`);
        console.log(`  Commands: ${summary.commandCount}`);
        console.log(`  Errors: ${summary.errorCount}`);
        console.log(`  Duration: ${summary.duration}`);
        console.log("");
      } catch (error) {
        console.error(ansis.red("Error:"), getErrorMessage(error));
        process.exit(1);
      }
    });

  /**
   * Info subcommand
   */
  logsCommand
    .command("info")
    .description("Show chat logs directory information")
    .addHelpText(
      "after",
      `
Examples:
  $ dr chat-logs info    # Show logs directory path and stats`
    )
    .action(async () => {
      try {
        // Load model to get project root if available
        let projectRoot: string | undefined;
        try {
          const model = await Model.load(process.cwd());
          if (model) {
            projectRoot = model.rootPath;
          }
        } catch {
          // Model not available, will use default
        }

        const projectLogDir = projectRoot ? join(projectRoot, ".dr", "chat", "sessions") : null;
        const homeLogDir = join(homedir(), ".dr", "chat", "sessions");

        console.log("");
        console.log(ansis.bold("Chat Logs Configuration:"));
        console.log("");

        if (projectRoot && existsSync(projectLogDir!)) {
          console.log(`Project logs:   ${ansis.green("✓")} ${projectLogDir}`);
        } else if (projectRoot) {
          console.log(`Project logs:   ${ansis.dim("(not created yet)")} ${projectLogDir}`);
        }

        if (existsSync(homeLogDir)) {
          console.log(`Global logs:    ${ansis.green("✓")} ${homeLogDir}`);
        } else {
          console.log(`Global logs:    ${ansis.dim("(not created yet)")} ${homeLogDir}`);
        }

        console.log("");
        console.log(ansis.dim("Logs are stored as JSON with one entry per line."));
        console.log(ansis.dim("Session ID is used in the filename for easy identification."));
        console.log("");
      } catch (error) {
        console.error(ansis.red("Error:"), getErrorMessage(error));
        process.exit(1);
      }
    });
}
