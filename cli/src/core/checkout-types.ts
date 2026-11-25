/**
 * Shared shapes for user-level DR: projects, repositories and checkouts (issues 1279, 1285).
 *
 * The design is `docs/design/USER_LEVEL_DR.md`; the plan is the staged changeset `user-level-dr`
 * (`documentation-robotics/changesets/changeset-1795281066041-0kg0ygyyb/`). The interfaces here
 * are that plan's `data-model.objectschema` elements of the same names. They are the contract
 * the project registry, the per-checkout server state and the central server record are built
 * against, so change them only together with every user.
 */

/** The checkout key of a repository's main worktree, and the default wherever a checkout is not named. */
export const MAIN_CHECKOUT = "main";

/**
 * The address of a checkout: `{project, checkout}`. Every scoped API route, deep link, websocket
 * subscription, DrBot session and MCP result carries one.
 * (`data-model.objectschema.checkout-ref`)
 */
export interface CheckoutRef {
  /** The project's name in the farm: kebab-case, unique in the farm, also its `@name` federation name. */
  project: string;
  /** `"main"` for the main worktree, else git's own name for the linked worktree. */
  checkout: string;
}

/**
 * A git repository, identified by the real path of its common git directory
 * (`git rev-parse --git-common-dir`). Derived from git, never stored.
 * (`data-model.objectschema.repository`)
 */
export interface Repository {
  /** Real path of the common git directory: the same from every worktree of the repository. */
  commonDir: string;
  /** Real path of the main worktree. */
  mainCheckout: string;
  /** origin's URL, when it has one. */
  remote?: string;
}

/** `present`: on disk. `missing`: git still lists it but the folder is gone. `prunable`: git says `git worktree prune` would remove it. */
export type CheckoutState = "present" | "missing" | "prunable";

/**
 * One working tree of a project's repository. Discovered from `git worktree list --porcelain`,
 * never stored. (`data-model.objectschema.checkout`)
 */
export interface Checkout {
  /** `"main"` for the main worktree, else the name under `<commonDir>/worktrees/<name>`. Unique per repository. */
  key: string;
  /** Real path of the working tree. */
  path: string;
  /** Short branch name, or null when detached. */
  branch: string | null;
  /** Commit the working tree is at. */
  head: string;
  isMain: boolean;
  state: CheckoutState;
  locked: boolean;
}

/** A checkout together with the project it belongs to. */
export interface ResolvedCheckout {
  ref: CheckoutRef;
  checkout: Checkout;
  /** The project's model folder, resolved for this checkout. */
  modelPath: string;
}

/**
 * Turns a `CheckoutRef` into the checkout it names, or null when the project or checkout is
 * unknown or the checkout is not `present`. The project registry provides it; the server's
 * checkout context pool consumes it, so the two can be built and tested apart.
 */
export type CheckoutResolver = (ref: CheckoutRef) => Promise<ResolvedCheckout | null>;

/** One checkout as a project listing shows it. */
export interface ProjectListCheckout {
  key: string;
  path: string;
  branch: string | null;
  head: string;
  state: CheckoutState;
  /** The active changeset's id, when one is active. */
  activeChangeset: string | null;
  stagedChangesets: number;
}

/**
 * What `project_list`, `GET /api/projects` and `dr farm list` return for a project.
 * (`data-model.objectschema.project-list-entry`)
 */
export interface ProjectListEntry {
  name: string;
  /** The main checkout's path. */
  repository: string;
  /** The model folder as the farm records it. */
  model: string;
  remote?: string;
  /** Set when the repository folder is gone: the project stays listed until it is removed (#1438). */
  missing?: true;
  /** With `missing`: the call that drops the project from the farm (`dr farm remove <name>`). */
  remove?: string;
  checkouts: ProjectListCheckout[];
}

/**
 * Limits of the checkout context pool. `DR_SERVER_MAX_LOADED` and `DR_SERVER_IDLE_MINUTES`
 * override them. (`data-model.objectschema.context-pool-settings`)
 */
export interface ContextPoolSettings {
  maxLoaded: number;
  idleMinutes: number;
}

export const DEFAULT_CONTEXT_POOL_SETTINGS: Readonly<ContextPoolSettings> = Object.freeze({
  maxLoaded: 4,
  idleMinutes: 30,
});

/**
 * The record of the central DR process serving one farm, kept at `servers/<farm-hash>.json` in
 * the user state directory. The token sits in a 0600 file beside it, never in the record.
 * (`data-model.objectschema.server-record`)
 */
export interface ServerRecord {
  /** Real path of the farm root the process serves. */
  farmRoot: string;
  pid: number;
  port: number;
  cliVersion: string;
  /** ISO 8601. */
  startedAt: string;
  /** The detached launcher's pid, when one started the process. */
  launcherPid?: number;
  /** Path of the 0600 token file. */
  tokenPath: string;
}

/**
 * A deep link into the shared viewer. The route and the token travel in the URL fragment
 * (`/#/p/<project>/c/<checkout>/...`), never in the query string. Built from the server record,
 * never by starting a process. (`data-model.objectschema.viewer-link`)
 */
export interface ViewerLink {
  url: string;
  project: string;
  checkout: string;
  changeset?: string;
  element?: string;
}
