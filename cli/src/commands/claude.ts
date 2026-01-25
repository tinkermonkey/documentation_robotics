/**
 * Claude Code Integration Management Command
 *
 * Manages installation, upgrades, and configuration of Claude Code integration files.
 * Provides subcommands for install, upgrade, remove, status, and list operations.
 */

import { Command } from 'commander';
import { ClaudeIntegrationManager } from '../integrations/claude-manager.js';
import ansis from 'ansis';

/**
 * Register all Claude integration subcommands
 *
 * Usage:
 *   dr claude install [--reference-only] [--commands-only] [--agents-only] [--skills-only] [--templates-only] [-f|--force]
 *   dr claude upgrade [--dry-run] [-f|--force]
 *   dr claude remove [--reference] [--commands] [--agents] [--skills] [--templates] [-f|--force]
 *   dr claude status
 *   dr claude list
 */
export function claudeCommands(program: Command): void {
  const claude = program
    .command('claude')
    .description('Manage Claude Code integration files');

  /**
   * Install subcommand
   *
   * Copies Claude integration files to .claude/ directory
   * Supports component-specific filtering via flags
   */
  claude
    .command('install')
    .description('Install Claude Code integration files')
    .option('--reference-only', 'Install only reference sheets')
    .option('--commands-only', 'Install only commands')
    .option('--agents-only', 'Install only agents')
    .option('--skills-only', 'Install only skills')
    .option('--templates-only', 'Install only templates')
    .option('-f, --force', 'Skip confirmation prompts')
    .addHelpText(
      'after',
      `
Examples:
  $ dr claude install                    # Install all components
  $ dr claude install --reference-only   # Install only reference sheets
  $ dr claude install --skills-only -f   # Force install only skills
  $ dr claude install --commands-only --agents-only  # Install specific components`
    )
    .action(async (options) => {
      const manager = new ClaudeIntegrationManager();

      // Build component filter from flags
      const components: string[] = [];
      if (options.referenceOnly) components.push('reference_sheets');
      if (options.commandsOnly) components.push('commands');
      if (options.agentsOnly) components.push('agents');
      if (options.skillsOnly) components.push('skills');
      if (options.templatesOnly) components.push('templates');

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
  claude
    .command('upgrade')
    .description('Upgrade installed Claude Code integration')
    .option('--dry-run', 'Preview changes without applying them')
    .option('-f, --force', 'Skip confirmation prompts')
    .addHelpText(
      'after',
      `
Examples:
  $ dr claude upgrade              # Check for upgrades and prompt to apply
  $ dr claude upgrade --dry-run    # Preview what would be upgraded
  $ dr claude upgrade -f           # Force upgrade without prompting`
    )
    .action(async (options) => {
      const manager = new ClaudeIntegrationManager();

      try {
        await manager.upgrade({
          dryRun: options.dryRun,
          force: options.force,
        });
      } catch (error) {
        console.error(ansis.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  /**
   * Remove subcommand
   *
   * Removes installed Claude integration files
   * Supports component-specific removal via flags
   */
  claude
    .command('remove')
    .description('Remove Claude Code integration files')
    .option('--reference', 'Remove only reference sheets')
    .option('--commands', 'Remove only commands')
    .option('--agents', 'Remove only agents')
    .option('--skills', 'Remove only skills')
    .option('--templates', 'Remove only templates')
    .option('-f, --force', 'Skip confirmation prompts')
    .addHelpText(
      'after',
      `
Examples:
  $ dr claude remove               # Remove all components
  $ dr claude remove --reference   # Remove only reference sheets
  $ dr claude remove --skills -f   # Force remove only skills`
    )
    .action(async (options) => {
      const manager = new ClaudeIntegrationManager();

      // Build component filter from flags
      const components: string[] = [];
      if (options.reference) components.push('reference_sheets');
      if (options.commands) components.push('commands');
      if (options.agents) components.push('agents');
      if (options.skills) components.push('skills');
      if (options.templates) components.push('templates');

      try {
        await manager.remove({
          components: components.length > 0 ? components : undefined,
          force: options.force,
        });
      } catch (error) {
        console.error(ansis.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  /**
   * Status subcommand
   *
   * Displays current installation status, version info, and component details
   */
  claude
    .command('status')
    .description('Show Claude Code integration status')
    .addHelpText(
      'after',
      `
Examples:
  $ dr claude status    # Show installation status and component details`
    )
    .action(async () => {
      const manager = new ClaudeIntegrationManager();

      try {
        await manager.status();
      } catch (error) {
        console.error(ansis.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });

  /**
   * List subcommand
   *
   * Lists all available components that can be installed
   */
  claude
    .command('list')
    .description('List available Claude Code components')
    .addHelpText(
      'after',
      `
Examples:
  $ dr claude list    # Show all available components and descriptions`
    )
    .action(async () => {
      const manager = new ClaudeIntegrationManager();

      try {
        await manager.list();
      } catch (error) {
        console.error(ansis.red('Error:'), error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}
