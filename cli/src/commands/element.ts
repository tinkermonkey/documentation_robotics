/**
 * Element subcommands
 * Re-exports standalone commands as subcommands for consistency
 */

import { Command } from "commander";
import { addCommand } from "./add.js";
import { updateCommand } from "./update.js";
import { deleteCommand } from "./delete.js";
import { showCommand } from "./show.js";
import { listCommand } from "./list.js";

export function elementCommands(program: Command): void {
  program
    .command("add <layer> <type> <id>")
    .description("Add an element to a layer")
    .option("--name <name>", "Element name (defaults to ID)")
    .option("--description <desc>", "Element description")
    .option("--properties <json>", "Element properties as JSON object")
    .addHelpText(
      "after",
      `
Examples:
  $ dr element add business business-service customer-mgmt --name "Customer Management"
  $ dr element add api endpoint create-customer --properties '{"method":"POST","path":"/customers"}'`
    )
    .action(addCommand);

  program
    .command("update <id>")
    .description("Update an element")
    .option("--name <name>", "New element name")
    .option("--description <desc>", "New description")
    .option("--properties <json>", "Updated properties (JSON)")
    .addHelpText(
      "after",
      `
Examples:
  $ dr element update api-endpoint-create-customer --name "Create Customer (v2)"
  $ dr element update business-service-order --description "Updated description"`
    )
    .action(updateCommand);

  program
    .command("delete <id>")
    .description("Delete an element")
    .option("--force", "Skip confirmation prompt and dependency checks")
    .option("--cascade", "Remove dependent elements automatically")
    .option("--dry-run", "Show what would be removed without actually removing")
    .addHelpText(
      "after",
      `
Examples:
  $ dr element delete api-endpoint-old-endpoint
  $ dr element delete api-endpoint-old-endpoint --force
  $ dr element delete api-endpoint-old-endpoint --cascade
  $ dr element delete api-endpoint-old-endpoint --dry-run
  $ dr element delete api-endpoint-old-endpoint --cascade --dry-run`
    )
    .action(deleteCommand);

  program
    .command("show <id>")
    .description("Display element details")
    .addHelpText(
      "after",
      `
Examples:
  $ dr element show api-endpoint-create-customer
  $ dr element show business-service-order-mgmt`
    )
    .action(showCommand);

  program
    .command("list <layer>")
    .description("List elements in a layer")
    .option("--type <type>", "Filter by element type")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Examples:
  $ dr element list api
  $ dr element list business --type business-service
  $ dr element list api --json`
    )
    .action(listCommand);
}
