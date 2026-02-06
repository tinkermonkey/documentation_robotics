/**
 * GitHub Copilot Integration Management Command
 *
 * Manages installation, upgrades, and configuration of GitHub Copilot integration files.
 * Provides subcommands for install, upgrade, remove, status, and list operations.
 */

import { Command } from 'commander';
import { CopilotIntegrationManager } from '../integrations/copilot-manager.js';
import ansis from 'ansis';
import { CLIError } from '../utils/errors.js';

/**
 * Register all Copilot integration subcommands
 *
 * Usage:
 *   dr copilot install [--agents-only] [--skills-only] [-f|--force]
 *   dr copilot upgrade [--dry-run] [-f|--force]
 *   dr copilot remove [--agents] [--skills] [-f|--force]
 *   dr copilot status
 *   dr copilot list
 */
export function copilotCommands(program: Command): void {
  const copilot = program
    .command('copilot')
    .description('Manage GitHub Copilot integration files');

  /**
   * Install subcommand
   *
   * Copies Copilot integration files to .github/ directory
   * Supports component-specific filtering via flags
   */
  copilot
    .command('install')
    .description('Install GitHub Copilot integration files')
    .option('--agents-only', 'Install only agents')
    .option('--skills-only', 'Install only skills')
    .option('-f, --force', 'Skip confirmation prompts')
    .addHelpText(
      'after',
      `
Examples:
  $ dr copilot install                    # Install all components
  $ dr copilot install --agents-only      # Install only agents
  $ dr copilot install --skills-only -f   # Force install only skills
  $ dr copilot install --agents-only --skills-only  # Install specific components`
    )
    .action(async (options) => {
      const manager = new CopilotIntegrationManager();

      // Build component filter from flags
      const components: string[] = [];
      if (options.agentsOnly) components.push('agents');
      if (options.skillsOnly) components.push('skills');

      try {
        await manager.install({
          components: components.length > 0 ? components : undefined,
          force: options.force,
        });
      } catch (error) {
        console.error(ansis.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  /**
   * Upgrade subcommand
   *
   * Checks for upgrades to installed components and optionally applies them.
   * Supports dry-run mode to preview changes without modifying files.
   */
  copilot
    .command('upgrade')
    .description('Upgrade installed GitHub Copilot integration')
    .option('--dry-run', 'Preview changes without applying them')
    .option('-f, --force', 'Skip confirmation prompts')
    .addHelpText(
      'after',
      `
Examples:
  $ dr copilot upgrade              # Check for upgrades and prompt to apply
  $ dr copilot upgrade --dry-run    # Preview what would be upgraded
  $ dr copilot upgrade -f           # Force upgrade without prompting`
    )
    .action(async (options) => {
      const manager = new CopilotIntegrationManager();

      try {
        await manager.upgrade({
          dryRun: options.dryRun,
          force: options.force,
        });
      } catch (error) {
        throw new CLIError(
          error instanceof Error ? error.message : String(error),
          1
        );
      }
    });

  /**
   * Remove subcommand
   *
   * Removes installed Copilot integration files
   * Supports component-specific removal via flags
   */
  copilot
    .command('remove')
    .description('Remove GitHub Copilot integration files')
    .option('--agents', 'Remove only agents')
    .option('--skills', 'Remove only skills')
    .option('-f, --force', 'Skip confirmation prompts')
    .addHelpText(
      'after',
      `
Examples:
  $ dr copilot remove               # Remove all components
  $ dr copilot remove --agents      # Remove only agents
  $ dr copilot remove --skills -f   # Force remove only skills`
    )
    .action(async (options) => {
      const manager = new CopilotIntegrationManager();

      // Build component filter from flags
      const components: string[] = [];
      if (options.agents) components.push('agents');
      if (options.skills) components.push('skills');

      try {
        await manager.remove({
          components: components.length > 0 ? components : undefined,
          force: options.force,
        });
      } catch (error) {
        throw new CLIError(
          error instanceof Error ? error.message : String(error),
          1
        );
      }
    });

  /**
   * Status subcommand
   *
   * Displays current installation status, version info, and component details
   */
  copilot
    .command('status')
    .description('Show GitHub Copilot integration status')
    .addHelpText(
      'after',
      `
Examples:
  $ dr copilot status    # Show installation status and component details`
    )
    .action(async () => {
      const manager = new CopilotIntegrationManager();

      try {
        await manager.status();
      } catch (error) {
        throw new CLIError(
          error instanceof Error ? error.message : String(error),
          1
        );
      }
    });

  /**
   * List subcommand
   *
   * Lists all available components that can be installed
   */
  copilot
    .command('list')
    .description('List available GitHub Copilot components')
    .addHelpText(
      'after',
      `
Examples:
  $ dr copilot list    # Show all available components and descriptions`
    )
    .action(async () => {
      const manager = new CopilotIntegrationManager();

      try {
        await manager.list();
      } catch (error) {
        throw new CLIError(
          error instanceof Error ? error.message : String(error),
          1
        );
      }
    });
}
