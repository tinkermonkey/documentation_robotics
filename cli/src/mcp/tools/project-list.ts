/**
 * project_list — every project of the farm in use, each with its checkouts (issue 1279, design
 * section 9): `ProjectListEntry`, from `ProjectRegistry.listProjects`.
 *
 * Paged with limit and offset over the projects. The page gives the true total and, while
 * projects are left, the call for the next page, so a shortened list never reads as complete.
 * Each project carries all of its checkouts. Reads the farm and git only; starts nothing.
 */

import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ProjectListEntry } from "../../core/checkout-types.js";
import type { FarmSource } from "../../core/project-registry.js";
import { jsonResult, runTool, type McpToolDefinition } from "./shared.js";
import { DEFAULT_CENTRAL_DEPS, sessionRoot, type CentralDeps } from "./central-viewer.js";
import { pageOf, type ListPage } from "./project-status-collectors.js";

/** Projects in one answer when `limit` is not given. */
export const PROJECT_LIST_PAGE_DEFAULT = 25;

const inputSchema = {
  limit: z
    .number()
    .int()
    .min(1)
    .optional()
    .describe(`How many projects to return (default ${PROJECT_LIST_PAGE_DEFAULT}). No upper bound: pass page.total for all of them.`),
  offset: z.number().int().min(0).optional().describe("How many projects to skip (default 0). The result's page.nextOffset is the next one."),
  rootPath: z
    .string()
    .optional()
    .describe(
      "A folder whose farm to list (the farm is found from it as dr finds it). Defaults to the project the client has open, else the MCP server's working directory."
    ),
};

export type ProjectListArgs = z.infer<z.ZodObject<typeof inputSchema>>;

export interface ProjectListResult {
  farm: { root: string; source: FarmSource };
  projects: ProjectListEntry[];
  page: ListPage;
  /** The call that returns the next page; absent on the last one. */
  more?: string;
}

/** The page of the farm's projects the arguments ask for. */
export async function projectList(
  args: ProjectListArgs,
  deps: Pick<CentralDeps, "openRegistry"> = DEFAULT_CENTRAL_DEPS
): Promise<ProjectListResult> {
  const registry = await deps.openRegistry(await sessionRoot(args.rootPath));
  const all = await registry.listProjects();
  const limit = args.limit ?? PROJECT_LIST_PAGE_DEFAULT;
  const { items, page } = pageOf(all, args.offset ?? 0, limit);
  return {
    farm: { root: registry.farm.root, source: registry.farm.source },
    projects: items,
    page,
    ...(page.nextOffset !== undefined
      ? {
          more:
            `${page.total - page.nextOffset} more project${page.total - page.nextOffset === 1 ? "" : "s"}: ` +
            `project_list with offset: ${page.nextOffset}${args.limit ? `, limit: ${args.limit}` : ""}` +
            `${args.rootPath ? `, rootPath: "${args.rootPath}"` : ""} returns the next page.`,
        }
      : {}),
  };
}

/** Builds the project_list handler; tests inject the registry. */
export function createProjectListHandler(deps: Pick<CentralDeps, "openRegistry"> = DEFAULT_CENTRAL_DEPS) {
  return async function projectListHandler(args: ProjectListArgs): Promise<CallToolResult> {
    return runTool(async () => jsonResult(await projectList(args, deps), { compact: true }));
  };
}

export const projectListHandler = createProjectListHandler();

export const projectListTool: McpToolDefinition<typeof inputSchema> = {
  name: "project_list",
  description:
    "Every project in the DR farm in use, by name, each with its repository, model folder, remote and all its checkouts " +
    "(the main worktree is \"main\", linked worktrees by git's name): path, branch, head, state (present, missing, prunable), " +
    `active changeset and staged changeset count. Paged over projects with limit (default ${PROJECT_LIST_PAGE_DEFAULT}, no upper bound) ` +
    "and offset: page gives the true total and nextOffset, and more names the call for the rest. Reads the farm and git only.",
  inputSchema,
  handler: (args) => projectListHandler(args),
};
