/**
 * Element subcommands for managing model elements
 * Provides an alternative way to access add, list, show, delete, and update commands
 * via an "element" subcommand group
 */

import { Command } from "commander";
import { addCommand } from "./add.js";
import { listCommand } from "./list.js";
import { showCommand } from "./show.js";
import { deleteCommand } from "./delete.js";
import { updateCommand } from "./update.js";

export function elementCommands(program: Command): void {
  // element add <layer> <type> <name> [options]
  program
    .command("add <layer> <type> <name>")
    .description("Add an element to a layer")
    .option("--name <name>", "Element display name (optional, defaults to provided name)")
    .option("--description <description>", "Element description")
    .option("--attributes <json>", "Element attributes as JSON (type-specific properties)")
    .option("--source-file <path>", "Source file path")
    .option("--source-symbol <symbol>", "Source symbol or line number")
    .option("--source-provenance <provenance>", "Source provenance (manual or generated)")
    .option("--source-repo-remote <remote>", "Source repository remote")
    .option("--source-repo-commit <commit>", "Source repository commit hash")
    .option("--verbose", "Show detailed output")
    .option("--debug", "Enable debug output")
    .action(async (layer, type, name, options) => {
      await addCommand(layer, type, name, options);
    });

  // element list <layer> [options]
  program
    .command("list <layer>")
    .description("List elements in a layer")
    .option("--type <type>", "Filter by element type")
    .option("--json", "Output as JSON")
    .option("--verbose", "Show detailed output")
    .option("--debug", "Enable debug output")
    .action(async (layer, options) => {
      await listCommand(layer, options);
    });

  // element show <id> [options]
  program
    .command("show <id>")
    .description("Display element details")
    .option("--verbose", "Show detailed output")
    .option("--debug", "Enable debug output")
    .action(async (id, options) => {
      await showCommand(id, options);
    });

  // element delete <id> [options]
  program
    .command("delete <id>")
    .description("Delete an element")
    .option("--force", "Skip confirmation prompt")
    .option("--cascade", "Remove dependent elements automatically")
    .option("--verbose", "Show detailed output")
    .option("--debug", "Enable debug output")
    .action(async (id, options) => {
      await deleteCommand(id, options);
    });

  // element update <id> [options]
  program
    .command("update <id>")
    .description("Update an element")
    .option("--name <name>", "New element name")
    .option("--description <description>", "New description")
    .option("--attributes <json>", "Element attributes as JSON (type-specific properties)")
    .option("--source-file <path>", "Source file path")
    .option("--source-symbol <symbol>", "Source symbol or line number")
    .option("--source-provenance <provenance>", "Source provenance (manual or generated)")
    .option("--source-repo-remote <remote>", "Source repository remote")
    .option("--source-repo-commit <commit>", "Source repository commit hash")
    .option("--clear-source-reference", "Remove source reference from element")
    .option("--verbose", "Show detailed output")
    .option("--debug", "Enable debug output")
    .action(async (id, options) => {
      await updateCommand(id, options);
    });
}
