/**
 * Initialize a new Documentation Robotics model
 */

import { intro, text, outro } from "@clack/prompts";
import ansis from "ansis";
import { hasModel, initProject } from "../core/project-init.js";
import { getCliBundledSpecVersion } from "../utils/spec-version.js";
import { isTelemetryEnabled, startSpan, endSpan } from "../telemetry/index.js";
import { getErrorMessage } from "../utils/errors.js";

export interface InitOptions {
  name?: string;
  author?: string;
  description?: string;
  verbose?: boolean;
  debug?: boolean;
}

export async function initCommand(options: InitOptions): Promise<void> {
  intro(ansis.bold(ansis.blue("⚙️  Initialize Documentation Robotics Model")));

  const span = isTelemetryEnabled
    ? startSpan("model.init", {
        "init.hasName": !!options.name,
        "init.hasDescription": !!options.description,
        "init.hasAuthor": !!options.author,
      })
    : null;

  try {
    const rootPath = process.cwd();
    // Check if model already exists
    if (await hasModel(rootPath)) {
      console.error(ansis.red("Error: Model already initialized in this directory"));
      if (isTelemetryEnabled && span) {
        (span as any).setStatus({ code: 2, message: "Model already exists" });
      }
      endSpan(span);
      process.exit(1);
    }

    // Gather model metadata
    // Check if stdin is a TTY to determine if we should prompt
    const isInteractive = process.stdin.isTTY;

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("cli.interactive", isInteractive);
    }

    // If name is provided, skip all prompts
    const skipPrompts = !!options.name;

    const name =
      options.name ||
      (isInteractive
        ? await text({
            message: "Model name:",
            validate: (value) => (value.length === 0 ? "Name is required" : undefined),
          })
        : (() => {
            console.error(ansis.red("Error: Model name is required (use --name option)"));
            if (isTelemetryEnabled && span) {
              (span as any).setStatus({ code: 2, message: "Model name required" });
            }
            endSpan(span);
            process.exit(1);
          })());

    const description =
      options.description ||
      (skipPrompts
        ? ""
        : isInteractive
          ? await text({
              message: "Description (optional):",
              defaultValue: "",
            })
          : "");

    const author =
      options.author ||
      (skipPrompts
        ? ""
        : isInteractive
          ? await text({
              message: "Author (optional):",
              defaultValue: "",
            })
          : "");

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("model.name", name as string);
      (span as any).setAttribute("model.specVersion", getCliBundledSpecVersion());
    }

    // Create the model, spec reference and reports (shared with the project_init MCP tool)
    const result = await initProject(rootPath, {
      name: name as string,
      description: (description as string) || undefined,
      author: (author as string) || undefined,
    });

    if (result.reportError !== undefined) {
      console.warn(
        ansis.yellow(
          `⚠ Warning: Failed to generate reports and README: ${result.reportError}\n` +
          `  Model initialized successfully. To regenerate reports later, run:\n` +
          `  dr reports regenerate`
        )
      );
    }

    if (isTelemetryEnabled && span) {
      (span as any).setAttribute("model.path", rootPath);
      (span as any).setStatus({ code: 0 });
    }

    outro(ansis.green(`✓ Model initialized: ${ansis.bold(result.name)}`));
  } catch (error) {
    if (isTelemetryEnabled && span) {
      (span as any).recordException(error as Error);
      (span as any).setStatus({
        code: 2,
        message: getErrorMessage(error),
      });
    }
    const message = getErrorMessage(error);
    console.error(ansis.red(`Error: ${message}`));
    endSpan(span);
    process.exit(1);
  } finally {
    endSpan(span);
  }
}
