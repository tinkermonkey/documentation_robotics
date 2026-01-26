/**
 * Output formatters for statistics
 * Supports text, JSON, and markdown output formats
 */

import ansis from 'ansis';
import { ModelStats } from '../core/stats-collector.js';
import { getLayerNumber } from '../core/layer-utils.js';

export type StatsFormat = 'text' | 'json' | 'markdown' | 'compact';

export interface FormatterOptions {
  format: StatsFormat;
  compact?: boolean;
  verbose?: boolean;
}

/**
 * Format statistics for output
 */
export function formatStats(stats: ModelStats, options: FormatterOptions): string {
  switch (options.format) {
    case 'json':
      return formatJSON(stats);
    case 'markdown':
      return formatMarkdown(stats);
    case 'compact':
      return formatCompact(stats);
    case 'text':
    default:
      return formatText(stats, options.verbose);
  }
}

/**
 * Format as plain text (default)
 */
function formatText(stats: ModelStats, verbose?: boolean): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push(ansis.bold(`${ansis.cyan(stats.project.name)}`));
  lines.push(ansis.dim('='.repeat(80)));
  lines.push('');

  // Overview section
  lines.push(ansis.bold('Overview:'));
  lines.push(`  ${ansis.gray('Version:')}         ${stats.project.version}`);
  lines.push(`  ${ansis.gray('Created:')}         ${formatDate(stats.project.created)}`);
  lines.push(`  ${ansis.gray('Updated:')}         ${formatDate(stats.project.updated)}`);

  const statusIcon = stats.validation.isValid ? ansis.green('✓') : ansis.red('✗');
  const statusText = stats.validation.isValid ? 'Valid' : 'Invalid';
  lines.push(`  ${ansis.gray('Status:')}          ${statusIcon} ${statusText}`);

  if (stats.validation.errors > 0) {
    lines.push(`  ${ansis.gray('Errors:')}          ${ansis.red(stats.validation.errors)}`);
  }
  if (stats.validation.warnings > 0) {
    lines.push(`  ${ansis.gray('Warnings:')}        ${ansis.yellow(stats.validation.warnings)}`);
  }

  // Elements by layer
  lines.push('');
  lines.push(ansis.bold('Elements by Layer:'));
  for (const layer of stats.layers) {
    const layerNum = getLayerNumber(layer.name);
    const typeDetails = Object.entries(layer.elementsByType)
      .map(([type, count]) => `${count} ${type}${count > 1 ? 's' : ''}`)
      .join(', ');

    const typeSummary = typeDetails ? ` (${typeDetails})` : '';
    lines.push(
      `  ${String(layerNum).padEnd(2)}. ${ansis.cyan(layer.name.padEnd(20))} ${String(layer.totalElements).padEnd(3)} elements${typeSummary}`
    );
  }

  // Summary stats
  lines.push('');
  lines.push(
    ansis.bold(`Total: ${ansis.cyan(`${stats.statistics.totalElements} elements`)} across ${ansis.cyan(`${stats.statistics.totalLayers} layers`)}`)
  );

  // Relationships section
  if (stats.statistics.totalRelationships > 0) {
    lines.push('');
    lines.push(ansis.bold('Cross-Layer Relationships:'));

    const byPair = stats.relationships.byPair;
    const sortedPairs = Object.entries(byPair)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);

    for (const [pair, count] of sortedPairs) {
      lines.push(`  ${pair.padEnd(20)} ${String(count).padEnd(3)} relationships`);
    }

    lines.push('');
    lines.push(ansis.bold(`Total Relationships: ${ansis.cyan(stats.statistics.totalRelationships)}`));
    lines.push(`  ${ansis.gray('Cross-layer:')} ${stats.relationships.crossLayerCount}`);
    lines.push(`  ${ansis.gray('Intra-layer:')} ${stats.relationships.intraLayerCount}`);
  }

  // Completeness
  lines.push('');
  lines.push(ansis.bold('Model Completeness:'));
  const completenessBar = createCompletionBar(stats.completeness.overall);
  lines.push(`  ${completenessBar} ${stats.completeness.overall}%`);

  // Layer coverage details
  lines.push('');
  lines.push(ansis.bold('Layer Coverage:'));
  for (const layer of stats.layers) {
    const icon = layer.coverage >= 75 ? ansis.green('✓') : layer.coverage >= 50 ? ansis.yellow('◐') : ansis.red('✗');
    lines.push(
      `  ${icon} ${ansis.cyan(layer.name.padEnd(18))} ${String(layer.coverage).padEnd(3)}% (${layer.totalElements} elements)`
    );
  }

  // Quality metrics
  if (verbose || stats.orphanedElements.length > 0) {
    lines.push('');
    lines.push(ansis.bold('Quality Metrics:'));

    if (stats.orphanedElements.length === 0) {
      lines.push(`  ${ansis.green('✓')} No orphaned elements`);
    } else {
      lines.push(`  ${ansis.yellow(`⚠`)} ${stats.orphanedElements.length} orphaned element${stats.orphanedElements.length > 1 ? 's' : ''}`);
      if (verbose) {
        for (const orphan of stats.orphanedElements.slice(0, 5)) {
          lines.push(`    - ${orphan}`);
        }
        if (stats.orphanedElements.length > 5) {
          lines.push(`    ... and ${stats.orphanedElements.length - 5} more`);
        }
      }
    }
  }

  lines.push('');

  return lines.join('\n');
}

/**
 * Format as JSON
 */
function formatJSON(stats: ModelStats): string {
  return JSON.stringify(stats, null, 2);
}

/**
 * Format as Markdown
 */
function formatMarkdown(stats: ModelStats): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${stats.project.name} - Architecture Statistics`);
  lines.push('');

  // Overview
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Version | ${stats.project.version} |`);
  lines.push(`| Created | ${formatDate(stats.project.created)} |`);
  lines.push(`| Updated | ${formatDate(stats.project.updated)} |`);
  lines.push(`| Status | ${stats.validation.isValid ? '✓ Valid' : '✗ Invalid'} |`);
  lines.push(`| Total Elements | ${stats.statistics.totalElements} |`);
  lines.push(`| Total Relationships | ${stats.statistics.totalRelationships} |`);
  lines.push(`| Completeness | ${stats.completeness.overall}% |`);
  lines.push('');

  // Elements by layer
  lines.push('## Elements by Layer');
  lines.push('');
  lines.push(`| Layer | Elements | Types |`);
  lines.push(`|-------|----------|-------|`);

  for (const layer of stats.layers) {
    const typeList = Object.entries(layer.elementsByType)
      .map(([type, count]) => `${type}: ${count}`)
      .join(', ');
    lines.push(`| ${layer.name} | ${layer.totalElements} | ${typeList} |`);
  }
  lines.push('');

  // Relationships
  if (stats.statistics.totalRelationships > 0) {
    lines.push('## Relationships');
    lines.push('');
    lines.push(`| Type | Count |`);
    lines.push(`|------|-------|`);
    lines.push(`| Total | ${stats.statistics.totalRelationships} |`);
    lines.push(`| Cross-layer | ${stats.relationships.crossLayerCount} |`);
    lines.push(`| Intra-layer | ${stats.relationships.intraLayerCount} |`);
    lines.push('');

    lines.push('### By Predicate');
    lines.push('');
    lines.push(`| Predicate | Count |`);
    lines.push(`|-----------|-------|`);
    for (const [predicate, count] of Object.entries(stats.relationships.byPredicate)) {
      lines.push(`| ${predicate} | ${count} |`);
    }
    lines.push('');
  }

  // Completeness
  lines.push('## Completeness');
  lines.push('');
  lines.push(`Overall: **${stats.completeness.overall}%**`);
  lines.push('');

  lines.push('### By Layer');
  lines.push('');
  lines.push(`| Layer | Coverage |`);
  lines.push(`|-------|----------|`);
  for (const [layer, coverage] of Object.entries(stats.completeness.byLayer)) {
    lines.push(`| ${layer} | ${coverage}% |`);
  }
  lines.push('');

  // Quality
  lines.push('## Quality');
  lines.push('');
  if (stats.orphanedElements.length === 0) {
    lines.push('- ✓ No orphaned elements');
  } else {
    lines.push(`- ⚠ ${stats.orphanedElements.length} orphaned element${stats.orphanedElements.length > 1 ? 's' : ''}`);
  }
  lines.push('');

  return lines.join('\n');
}

/**
 * Format as compact single-line summary
 */
function formatCompact(stats: ModelStats): string {
  const statusIcon = stats.validation.isValid ? '✓' : '✗';
  return `${stats.project.name}: ${stats.statistics.totalElements} elements, ${stats.statistics.totalRelationships} relationships, ${stats.statistics.totalLayers} layers | Status: ${statusIcon} ${stats.validation.isValid ? 'Valid' : 'Invalid'} | Completeness: ${stats.completeness.overall}% | Updated: ${formatDate(stats.project.updated)}`;
}

/**
 * Create a completion bar for display
 */
function createCompletionBar(percentage: number, width: number = 40): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);

  if (percentage >= 75) {
    return ansis.green(bar);
  } else if (percentage >= 50) {
    return ansis.yellow(bar);
  } else {
    return ansis.red(bar);
  }
}

/**
 * Format a date string nicely
 */
function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString;
  }
}
