/**
 * Command Adapters for CLI Compatibility Testing
 *
 * Handles command interface differences between Python and Bun CLIs
 * to enable semantic model file comparison
 */

export type CLI = 'python' | 'bun';

export interface InitOptions {
  description?: string;
  author?: string;
  version?: string;
  template?: string;
}

export interface AddOptions {
  name?: string;
  description?: string;
  properties?: Record<string, string>;
  method?: string;  // For API endpoints
  path?: string;    // For API endpoints and navigation routes
}

export interface UpdateOptions {
  name?: string;
  description?: string;
  properties?: Record<string, string>;
}

export interface ProjectUpdateOptions {
  name?: string;
  description?: string;
  version?: string;
  author?: string;
}

export interface RelationshipOptions {
  description?: string;
}

/**
 * Adapt init command for CLI-specific syntax
 */
export function initCommand(cli: CLI, name: string, options?: InitOptions): string[] {
  if (cli === 'python') {
    // Python: dr init PROJECT_NAME [OPTIONS]
    const args = ['init', name];
    if (options?.description) {
      // Python CLI doesn't support --description in init, need to use project update
      // For now, just initialize
    }
    if (options?.author) {
      // Python CLI doesn't support --author in init
    }
    return args;
  } else {
    // Bun: dr init --name PROJECT_NAME [OPTIONS]
    const args = ['init', '--name', name];
    if (options?.description) args.push('--description', options.description);
    if (options?.author) args.push('--author', options.author);
    if (options?.version) args.push('--version', options.version);
    return args;
  }
}

/**
 * Adapt add command for CLI-specific syntax
 */
export function addCommand(
  cli: CLI,
  layer: string,
  type: string,
  id: string,
  options?: AddOptions
): string[] {
  // Both CLIs use same structure: dr add LAYER TYPE ID [OPTIONS]
  const args = ['add', layer, type, id];

  if (options?.name) args.push('--name', options.name);
  if (options?.description) args.push('--description', options.description);
  if (options?.method) args.push('--method', options.method);
  if (options?.path) args.push('--path', options.path);

  if (options?.properties) {
    for (const [key, value] of Object.entries(options.properties)) {
      args.push('--property', `${key}=${value}`);
    }
  }

  return args;
}

/**
 * Adapt update command for CLI-specific syntax
 */
export function updateCommand(cli: CLI, elementId: string, options?: UpdateOptions): string[] {
  // Both CLIs use same structure: dr update ELEMENT_ID [OPTIONS]
  const args = ['update', elementId];

  if (options?.name) args.push('--name', options.name);
  if (options?.description) args.push('--description', options.description);

  if (options?.properties) {
    for (const [key, value] of Object.entries(options.properties)) {
      args.push('--property', `${key}=${value}`);
    }
  }

  return args;
}

/**
 * Adapt delete command for CLI-specific syntax
 */
export function deleteCommand(cli: CLI, elementId: string): string[] {
  // Python: dr remove ELEMENT_ID
  // Bun: dr delete ELEMENT_ID
  if (cli === 'python') {
    return ['remove', elementId];
  } else {
    return ['delete', elementId];
  }
}

/**
 * Adapt relationship add command for CLI-specific syntax
 */
export function relationshipAddCommand(
  cli: CLI,
  sourceId: string,
  targetId: string,
  relationshipType: string,
  options?: RelationshipOptions
): string[] {
  // Both CLIs use same structure: dr relationship add SOURCE TARGET TYPE
  const args = ['relationship', 'add', sourceId, targetId, relationshipType];

  if (options?.description) args.push('--description', options.description);

  return args;
}

/**
 * Adapt relationship remove command for CLI-specific syntax
 */
export function relationshipRemoveCommand(
  cli: CLI,
  sourceId: string,
  targetId: string,
  relationshipType?: string
): string[] {
  // Both CLIs use same structure: dr relationship remove SOURCE TARGET [TYPE]
  const args = ['relationship', 'remove', sourceId, targetId];

  if (relationshipType) args.push(relationshipType);

  return args;
}

/**
 * Adapt project update command for CLI-specific syntax
 */
export function projectUpdateCommand(cli: CLI, options: ProjectUpdateOptions): string[] {
  // Both CLIs use same structure: dr project update [OPTIONS]
  const args = ['project', 'update'];

  if (options.name) args.push('--name', options.name);
  if (options.description) args.push('--description', options.description);
  if (options.version) args.push('--version', options.version);
  if (options.author) args.push('--author', options.author);

  return args;
}

/**
 * Adapt list command for CLI-specific syntax
 */
export function listCommand(cli: CLI, layer?: string, options?: { json?: boolean }): string[] {
  const args = ['list'];

  if (layer) args.push(layer);
  if (options?.json) args.push('--json');

  return args;
}

/**
 * Adapt search command for CLI-specific syntax
 */
export function searchCommand(cli: CLI, query: string, options?: { json?: boolean }): string[] {
  const args = ['search', query];

  if (options?.json) args.push('--json');

  return args;
}

/**
 * Adapt trace command for CLI-specific syntax
 */
export function traceCommand(cli: CLI, elementId: string, options?: { json?: boolean }): string[] {
  const args = ['trace', elementId];

  if (options?.json) args.push('--json');

  return args;
}

/**
 * Adapt validate command for CLI-specific syntax
 */
export function validateCommand(cli: CLI, options?: { json?: boolean; verbose?: boolean }): string[] {
  const args = ['validate'];

  if (options?.json) args.push('--json');
  if (options?.verbose) args.push('--verbose');

  return args;
}

/**
 * Adapt export command for CLI-specific syntax
 */
export function exportCommand(
  cli: CLI,
  format: string,
  options?: { output?: string; layer?: string }
): string[] {
  const args = ['export', format];

  if (options?.output) args.push('--output', options.output);
  if (options?.layer) args.push('--layer', options.layer);

  return args;
}

/**
 * Adapt migrate command for CLI-specific syntax
 */
export function migrateCommand(cli: CLI): string[] {
  return ['migrate'];
}

/**
 * Adapt upgrade command for CLI-specific syntax
 */
export function upgradeCommand(cli: CLI): string[] {
  return ['upgrade'];
}

/**
 * Adapt conformance command for CLI-specific syntax
 */
export function conformanceCommand(cli: CLI, options?: { json?: boolean }): string[] {
  const args = ['conformance'];

  if (options?.json) args.push('--json');

  return args;
}

/**
 * Adapt changeset command for CLI-specific syntax
 */
export function changesetCommand(
  cli: CLI,
  action: 'create' | 'list' | 'apply',
  name?: string
): string[] {
  const args = ['changeset', action];

  if (name) args.push(name);

  return args;
}

/**
 * Helper to execute command with CLI-specific adapter
 */
export async function executeAdaptedCommand<T>(
  pythonCLI: (args: string[], cwd?: string) => Promise<T>,
  bunCLI: (args: string[], cwd?: string) => Promise<T>,
  commandAdapter: (cli: CLI) => string[],
  cwd?: string
): Promise<{ python: T; bun: T }> {
  const pythonArgs = commandAdapter('python');
  const bunArgs = commandAdapter('bun');

  const [python, bun] = await Promise.all([
    pythonCLI(pythonArgs, cwd),
    bunCLI(bunArgs, cwd),
  ]);

  return { python, bun };
}
