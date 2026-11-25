/**
 * Visualization Server
 * HTTP server with WebSocket support for real-time model updates
 */

import { OpenAPIHono, createRoute, z } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { swaggerUI } from "@hono/swagger-ui";
import { createAdaptorServer, type ServerType } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { AsyncLocalStorage } from "async_hooks";
import { runAsWriter } from "../core/changeset-write-activity.js";
import { randomBytes, timingSafeEqual } from "crypto";
import { realpathSync } from "fs";
import { realpath } from "fs/promises";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";

const require = createRequire(import.meta.url);
import { Model } from "../core/model.js";
import { Element } from "../core/element.js";
import { Changeset as StagedChangeset } from "../core/changeset.js";
import { StagingAreaManager } from "../core/staging-area.js";
import { getCliVersion } from "../utils/spec-version.js";
import { allowedActions, purposeOf, RecordLandingError } from "../core/changeset-purpose.js";
import { verifyChangesetInModel } from "../core/changeset-verify.js";
import { ChangesetGraph } from "../core/changeset-graph.js";
import { driftDetail, driftStatus, type DriftSubject } from "../core/changeset-drift-status.js";
import type { ChangesetDrift } from "../core/changeset-base-index.js";
import {
  cascadeDrops,
  danglingRelationshipAdds,
  deleteBlockers,
  reviewCounts,
  reviewRevision,
  stagedSequences,
  type DeleteBlocker,
  type ReviewDecision,
  type ReviewVerdict,
} from "../core/changeset-review.js";
import { CANONICAL_LAYER_NAMES } from "../core/layers.js";
import { type Annotation as StoredAnnotation } from "../core/annotation-store.js";
import {
  type CheckoutRef,
  type ContextPoolSettings,
  type ResolvedCheckout,
} from "../core/checkout-types.js";
import type { ProjectRegistry } from "../core/project-registry.js";
import { CheckoutContext, checkoutKey, type CheckoutSubscriber } from "./checkout-context.js";
import { CheckoutContextPool } from "./checkout-context-pool.js";
import { DrBotLauncher, JSONRPC_ERRORS } from "./dr-bot-launcher.js";
import { CHECKOUT_CONTEXT_KEY, telemetryMiddleware } from "./telemetry-middleware.js";
import { detectAvailableClients, selectChatClient } from "../coding-agents/chat-utils.js";
import { getErrorMessage } from "../utils/errors.js";
import {
  createCommitProgressReporter,
  sameRootPath,
  subscribeCommitProgress,
  type PublishedCommitProgress,
} from "../core/commit-progress.js";
import {
  AnnotationCreateSchema,
  AnnotationUpdateSchema,
  AnnotationReplyCreateSchema,
  LayerNameSchema,
  IdSchema,
  AnnotationFilterSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  AnnotationSchema,
  AnnotationReplySchema,
  AnnotationsListSchema,
  ChangesetsListSchema,
  ChangesetDetailSchema,
  ChangesetActionResultSchema,
  ChangesetCommitRequestSchema,
  ChangesetCommitRefusedSchema,
  ChangesetReviewSchema,
  ChangesetReviewUpdateSchema,
  ChangesetVerificationSchema,
  ModelResponseSchema,
  LayerResponseSchema,
  FeedSubscriptionSchema,
  ProjectNameParamSchema,
  CheckoutKeyParamSchema,
  ProjectListEntrySchema,
  ProjectsListSchema,
  ProjectCheckoutsSchema,
  SpecResponseSchema,
  AnnotationRepliesSchema,
  WSMessageSchema,
  SimpleWSMessageSchema,
  JSONRPCRequestSchema,
  JSONRPCResponseSchema,
  Tier1StatusResponseSchema,
  ChangesetCommitProgressSchema,
} from "./schemas.js";
import {
  cappedReason,
  describeTier1Status,
  percentUsed,
  tier1Status,
  type Tier1Status,
  type Tier1StatusOptions,
  warmingReason,
} from "../analyzers/classifier/status.js";
import type { Tier1Month } from "../analyzers/classifier/types.js";
import { readSession } from "../analyzers/session-state.js";

/**
 * Type Casting Note
 *
 * Type casts (`as any`) are used in this file due to @hono/zod-openapi v1.2.1
 * type inference limitations with async middleware handlers. The middleware
 * properly validates and transforms request/response data at runtime via Zod,
 * so the type assertions are safe despite bypassing TypeScript's type checker.
 *
 * TODO: Remove these casts after @hono/zod-openapi improves async handler typing
 * Upstream tracking: https://github.com/honojs/hono/issues/3524
 * Target version: @hono/zod-openapi v2.0.0+ (when async handler typing is improved)
 *
 * Affected endpoints:
 * - Annotation creation (POST /api/annotations)
 * - Annotation retrieval (GET /api/annotations/:id)
 * - Annotation updates (PATCH /api/annotations/:id)
 * - Annotation replacement (PUT /api/annotations/:id)
 * - Annotation deletion (DELETE /api/annotations/:id)
 * - Layer retrieval (GET /api/layers/:layerName)
 * - Schema retrieval (GET /api/spec)
 */

// WebSocket message types derived from Zod schemas for type safety and runtime validation
type SimpleWSMessage = z.infer<typeof SimpleWSMessageSchema>;
type JSONRPCRequest = z.infer<typeof JSONRPCRequestSchema>;
type JSONRPCResponse = z.infer<typeof JSONRPCResponseSchema>;
type WSMessage = z.infer<typeof WSMessageSchema>;
type FeedSubscription = z.infer<typeof FeedSubscriptionSchema>;

// Type for WebSocket context from Hono's WebSocket helper (hono/ws), shared by all
// runtime adapters (@hono/node-ws, hono/bun, hono/cloudflare-workers, etc.)
// Defines the interface for WebSocket operations within the Hono environment
interface HonoWSContext {
  send(source: string | ArrayBuffer | Uint8Array | ArrayBufferView, options?: { compress?: boolean }): void;
  close(code?: number, reason?: string): void;
}

export interface VisualizationServerOptions {
  /** The one token every `/api/...`, `/ws` and `/mcp` call carries. Default: a random one. */
  authToken?: string;
  withDanger?: boolean;
  /**
   * Changeset-only write mode for chat: the agent may stage adds, updates and new
   * relationships in a changeset, but not commit, apply or delete. Ignored with withDanger.
   */
  withChangesets?: boolean;
  viewerPath?: string;
  /** Pid of the process that launched this server; GET /health reports it with the token. */
  launcherPid?: number;
  /**
   * The farm the server serves, every project and checkout of it: the central process (issue
   * 1279, `docs/design/USER_LEVEL_DR.md` sections 7 and 8; `startCentralServer` in
   * central-server.ts). It is the server's only mode.
   */
  central: CentralModeOptions;
}

/** What the server needs to serve a whole farm. */
export interface CentralModeOptions {
  /** The farm's registry: the only way the server resolves a project or checkout. */
  registry: ProjectRegistry;
  /** Context pool limits. Default: `contextPoolSettingsFromEnv()`. */
  pool?: ContextPoolSettings;
  /**
   * The checkout an MCP session with no root of its own works in (the process's working
   * directory's checkout, else the farm's first project's main); null when the farm has none.
   * It serves no route: every project-data route names its checkout.
   */
  defaultCheckout: CheckoutRef | null;
  /** This process's id, reported by `/health` with the token. */
  serverId?: string;
  /**
   * How often (ms) the server asks the registry whether its loaded checkouts still exist, so a
   * removed checkout's subscribers hear `checkout.removed` (default 30 s; 0 turns it off). The
   * registry has no file watcher: it notices a removal when asked.
   */
  removalCheckMs?: number;
}

/** The first segments of every checkout-scoped route. */
const SCOPED_PREFIX = "/api/projects/:project/checkouts/:checkout";

/**
 * A websocket's subscription to one checkout's feed on the central server. The checkout's
 * context holds it as a subscriber: sends go to the socket, and closing it (the context closing)
 * ends only this subscription, never the socket, which may be subscribed to other checkouts.
 */
interface FeedSubscriber extends CheckoutSubscriber {
  ref: CheckoutRef;
  ws: HonoWSContext;
}

/**
 * Visualization Server class
 */

/**
 * The commit result's `drift`: what the base overlapped when the changeset landed, each overlap
 * with what landing did about it (`describeDrift`, read by the commit before it applied anything).
 */
function landedOverDrift(detail: ChangesetDrift | undefined): { message: string; overlapping?: ChangesetDrift["overlapping"] } {
  const count = detail ? detail.overlapping.elements.length + detail.overlapping.relationships.length : 0;
  if (!detail || count === 0) {
    return {
      message:
        "The base model had changed under this changeset and what it overlapped could not be listed (no base index). " +
        "It landed all the same.",
    };
  }
  return {
    message: `The base model overlapped ${count} staged change(s). The changeset landed; each overlap says what landing did about it.`,
    overlapping: detail.overlapping,
  };
}

/**
 * POST /api/changesets/:id/commit's optional body, as documented in the OpenAPI spec (the handler
 * validates with ChangesetCommitRequestSchema; see the route for why this is not the zod schema).
 */
const COMMIT_REQUEST_DOC_SCHEMA = {
  type: "object",
  properties: {
    drop: {
      type: "array",
      items: { type: "integer" },
      description:
        "Sequence numbers to leave out. Changes that depend on an element a dropped add creates (relationship-adds " +
        "with it at either end, updates of it) are left out too. All are unstaged (tombstoned) before the commit.",
    },
    deleteBlockedLinks: {
      type: "array",
      items: { type: "integer" },
      description:
        "Sequence numbers of delete changes whose blockers may be deleted with the element. With either field " +
        "present, any other delete with blockers is refused (422).",
    },
  },
} as const;

/**
 * A documented GET /api/tier1 example: the status part as written here, and the rest (the
 * capped reason, percentUsed, nearCap, summary, note) from the code that builds real responses,
 * so the examples can't drift from it.
 */
function tier1Example(status: Omit<Tier1Status, "month"> & { month: Tier1Month }): Record<string, unknown> {
  const month = { ...status.month, percentUsed: percentUsed(status.month) };
  const full: Tier1Status = {
    ...status,
    month,
    ...(status.state === "capped" ? { reason: cappedReason(month) } : {}),
  };
  return { ...full, ...describeTier1Status(full) };
}

const TIER1_EMPTY_CACHE = { entries: 0, bytes: 0, files: 0, lastCompaction: null };
const TIER1_MONTH = (spentUsd: number, cards: number, capUsd = 20): Tier1Month => ({
  spentUsd,
  capUsd,
  remainingUsd: Math.max(0, Math.round((capUsd - spentUsd) * 1e6) / 1e6),
  resetsAt: "2026-12-01T00:00:00.000Z",
  cards,
});
const TIER1_WARMING = {
  jobId: "5b0f6c3e-2d0a-4c39-9a51-6f1e0c8f2b7a",
  startedAt: "2026-11-15T10:17:02.114Z",
  cards: { done: 1388, total: 4071 },
  costUsd: 1.94,
  etaSeconds: 497,
};
const TIER1_ON = {
  analyzer: "cbm",
  config: ".dr/analyzers/cbm/tier1.json",
  provider: "cloudflare-workers-ai",
  model: "clef",
  monthlyCapUsd: 20,
  concurrency: 4,
  dotDrIgnored: true,
  warnings: [],
};

/** GET /api/tier1's documented examples: off (the default), on near the cap, capped, a missing key. */
const TIER1_STATUS_EXAMPLES = {
  off: {
    summary: "Not opted in (no tier1.json)",
    value: tier1Example({
      state: "off",
      reason: "no .dr/analyzers/cbm/tier1.json: Tier 1 is opt-in. Enable it with `dr analyzer tier1 enable --provider <name> --model <id>`.",
      analyzer: "cbm",
      config: ".dr/analyzers/cbm/tier1.json",
      credentials: {},
      month: TIER1_MONTH(0, 0),
      bySource: {},
      cache: TIER1_EMPTY_CACHE,
      dotDrIgnored: true,
      warnings: [],
    }),
  },
  onNearCap: {
    summary: "On, past 80% of the cap (nearCap)",
    value: tier1Example({
      ...TIER1_ON,
      state: "on",
      modelId: "@cf/cloudflare/clef",
      credentials: {
        accountId: { set: true, from: "CLOUDFLARE_ACCOUNT_ID" },
        apiToken: { set: true, from: "CLOUDFLARE_API_TOKEN" },
      },
      month: TIER1_MONTH(16.42, 11730),
      bySource: {
        extract: { cards: 9810, costUsd: 13.734, lastAt: "2026-11-14T09:12:40.118Z" },
        probe: { cards: 1, costUsd: 0.0031, lastAt: "2026-11-02T15:01:07.552Z" },
        classify: { cards: 1919, costUsd: 2.6829, lastAt: "2026-11-10T18:44:03.920Z" },
      },
      cache: { entries: 11402, bytes: 6815230, files: 2, lastCompaction: "2026-11-14T09:12:41.003Z" },
    }),
  },
  warming: {
    summary: "On, while the codebase_index job fills the answer cache",
    value: tier1Example({
      ...TIER1_ON,
      state: "warming",
      reason: warmingReason(TIER1_WARMING),
      modelId: "@cf/cloudflare/clef",
      credentials: {
        accountId: { set: true, from: "CLOUDFLARE_ACCOUNT_ID" },
        apiToken: { set: true, from: "CLOUDFLARE_API_TOKEN" },
      },
      month: TIER1_MONTH(1.94, 1388),
      bySource: { index: { cards: 1388, costUsd: 1.94, lastAt: "2026-11-15T10:21:37.502Z" } },
      cache: { entries: 1388, bytes: 1421312, files: 1, lastCompaction: null },
      warming: TIER1_WARMING,
    }),
  },
  capped: {
    summary: "Opted in, but the month's cap is reached",
    value: tier1Example({
      ...TIER1_ON,
      state: "capped",
      modelId: "@cf/cloudflare/clef",
      credentials: {
        accountId: { set: true, from: "tier1.json" },
        apiToken: { set: true, from: "tier1.json" },
      },
      month: TIER1_MONTH(20.0012, 14286),
      bySource: { extract: { cards: 14286, costUsd: 20.0012, lastAt: "2026-11-14T09:12:40.118Z" } },
      cache: { entries: 13950, bytes: 8290114, files: 2, lastCompaction: "2026-11-14T09:12:41.003Z" },
    }),
  },
  openRouter: {
    summary: "On through OpenRouter, pinned to one upstream",
    value: tier1Example({
      ...TIER1_ON,
      state: "on",
      provider: "openrouter",
      model: "cloudflare/clef",
      modelId: "cloudflare/clef",
      routing: { only: ["cloudflare"], allowFallbacks: false, dataCollection: "deny" },
      credentials: { apiKey: { set: true, from: "OPENROUTER_API_KEY" } },
      month: TIER1_MONTH(1.37, 1032),
      bySource: {
        extract: { cards: 1029, costUsd: 1.3601, lastAt: "2026-11-15T10:02:11.481Z" },
        probe: { cards: 3, costUsd: 0.0099, lastAt: "2026-11-15T09:40:52.007Z" },
      },
      cache: { entries: 1018, bytes: 1102230, files: 1, lastCompaction: "2026-11-15T10:02:12.310Z" },
    }),
  },
  noCredentials: {
    summary: "Opted in, a key missing",
    value: tier1Example({
      ...TIER1_ON,
      state: "no-credentials",
      reason: "cloudflare-workers-ai needs credentials.apiToken in tier1.json or CLOUDFLARE_API_TOKEN",
      credentials: {
        accountId: { set: true, from: "CLOUDFLARE_ACCOUNT_ID" },
        apiToken: { set: false, from: null },
      },
      month: TIER1_MONTH(0, 0),
      bySource: {},
      cache: TIER1_EMPTY_CACHE,
    }),
  },
};

/**
 * Reads the commit body: none, or an empty one (whatever the content type), is `{}`, today's plain
 * commit. Anything else must be JSON matching ChangesetCommitRequestSchema.
 */
async function readCommitRequest(
  c: any
): Promise<{ body: { drop?: number[]; deleteBlockedLinks?: number[] } } | { error: string }> {
  const text = (await c.req.text()).trim();
  if (text === "") return { body: {} };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { error: "Malformed JSON in request body" };
  }
  const result = ChangesetCommitRequestSchema.safeParse(json);
  if (!result.success) {
    return {
      error: `Invalid commit body: ${result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ")}`,
    };
  }
  return { body: result.data };
}
export class VisualizationServer {
  private app: OpenAPIHono;
  private _servers: ServerType[] = []; // One per loopback address the viewer listens on
  private upgradeWebSocket?: ReturnType<typeof createNodeWebSocket>["upgradeWebSocket"];
  private injectWebSocket?: ReturnType<typeof createNodeWebSocket>["injectWebSocket"];
  /** When the viewer was last used (see getActivity); the idle exit is measured from it. */
  private lastActivityAt = Date.now();
  private launcherPid?: number;
  private authToken: string;
  private viewerPath?: string; // Optional custom viewer path
  private chatConversationCounter: number = 0;
  /** Debounce for changeset-directory events: one write is several file events. */
  private changesetsDebounceMs = 150;
  private chatInitializationError?: Error; // Store initialization error for status endpoint
  /** Test hook: how GET /api/tier1 reads Tier 1 (an empty environment, a fake git, a fixed clock). */
  private _testTier1Options?: Pick<Tier1StatusOptions, "env" | "git" | "now">;
  /**
   * Launches DrBot's turns (dr-bot-launcher.ts): each in its checkout, under the process's cap on
   * running turns. One per server, for every checkout of the farm.
   */
  readonly drBot: DrBotLauncher;
  /**
   * The checkout context of the request or message being handled. The server has no checkout of
   * its own: every request and websocket message runs in the context of the checkout it names.
   */
  private readonly scope = new AsyncLocalStorage<CheckoutContext>();
  /** Set once stop() is called: stopping again waits for the same stop. */
  private stopping?: Promise<void>;
  /** Whether any stop() call said the process is about to exit (the watchers are left open). */
  private stopForExit = false;
  /** The farm, the checkout context pool and the open sockets. */
  private central: {
    options: CentralModeOptions;
    pool: CheckoutContextPool;
    /** Every open socket, with its subscriptions by checkout key. */
    sockets: Map<HonoWSContext, Map<string, FeedSubscriber>>;
    stopListening: () => void;
    removalTimer?: ReturnType<typeof setInterval>;
    /** Open TCP connections, destroyed on stop: an upgraded websocket would otherwise hold the listener open. */
    connections: Set<import("net").Socket>;
    /** `/mcp`: the MCP sessions (mcp/central-mcp.ts), made on the first MCP request. */
    mcp?: Promise<import("../mcp/central-mcp.js").CentralMcpEndpoint>;
    mcpEndpoint?: import("../mcp/central-mcp.js").CentralMcpEndpoint;
  };

  /**
   * Everything the server holds for the checkout being served (checkout-context.ts): the
   * checkout the current request or message names. Contexts are never shared between checkouts.
   */
  private get context(): CheckoutContext {
    const scoped = this.scope.getStore();
    if (scoped) return scoped;
    throw new Error("No checkout for this call: the server serves a checkout only inside a request or message that names one");
  }

  /**
   * Runs fn with `context` as the checkout being served, as the viewer's writer: a request or
   * message's staging writes are the viewer's (changeset-write-activity.ts). An MCP tool call made
   * inside one runs as its own session instead.
   */
  private inContext<T>(context: CheckoutContext, fn: () => T): T {
    return this.scope.run(context, () => runAsWriter("viewer", fn));
  }

  /** The checkout's model: the context's, which the watcher's reload replaces. */
  private get model(): Model {
    return this.context.model;
  }
  private set model(model: Model) {
    this.context.model = model;
  }
  /** The websockets subscribed to the checkout's feed. */
  private get clients(): Set<CheckoutSubscriber> {
    return this.context.subscribers;
  }
  /** Test hook: the checkout's file watcher (the context owns it). */
  get watcher(): any {
    return this.context.watcher;
  }
  set watcher(watcher: any) {
    this.context.watcher = watcher;
  }
  private get annotationStore() {
    return this.context.annotationStore;
  }
  /**
   * Valid spec node IDs per layer
   * Dynamically loaded from compiled spec (spec/dist/{layer}.json at module load time)
   * Used to validate and resolve viewer spec node IDs
   * Prevents silent drift when node types are added to spec/schemas/nodes/
   */
  private static readonly VALID_SPEC_NODE_IDS: Record<string, string[]> = VisualizationServer.loadValidSpecNodeIds();

  /**
   * Load valid spec node IDs dynamically from bundled spec files
   * Extracts node_types arrays from each layer's compiled schema file
   * This ensures the list is always in sync with the spec build output
   * If any file cannot be loaded, falls back to a minimal safe set
   */
  private static loadValidSpecNodeIds(): Record<string, string[]> {
    const result: Record<string, string[]> = {};

    // Get the directory of this file to build absolute path to bundled schemas
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const bundledDir = path.join(__dirname, "..", "schemas", "bundled");

    for (const layer of CANONICAL_LAYER_NAMES) {
      try {
        // Build absolute path to the layer's compiled spec file
        const specFilePath = path.join(bundledDir, `${layer}.json`);

        // Use require() to synchronously load bundled spec file
        // These JSON files are built by "npm run build" from spec source
        const spec = require(specFilePath) as {
          layer?: { node_types?: string[] };
          specVersion?: string;
        };

        // Extract node_types array from layer object in the compiled spec
        const nodeTypes = spec.layer?.node_types;
        if (Array.isArray(nodeTypes) && nodeTypes.length > 0) {
          result[layer] = nodeTypes;
        } else {
          console.warn(
            `[SPEC-LOAD-001] Layer ${layer} has no node_types in spec file`
          );
          result[layer] = [];
        }
      } catch (error) {
        console.warn(
          `[SPEC-LOAD-002] Failed to load spec node IDs for layer ${layer}: ${getErrorMessage(error)}`
        );
        // Use empty array as fallback - will be caught by usage code
        result[layer] = [];
      }
    }

    return result;
  }

  /**
   * Fallback spec node IDs used when type extraction from elementId fails
   * These are used when no valid spec node ID can be extracted from the elementId
   * or found through other resolution strategies
   */
  private static readonly LAYER_FALLBACK: Record<string, string> = {
    product: "business.businessservice",
    security: "business.businessprocess",
    technology: "application.applicationservice",
    api: "business.businessprocess",
    "data-model": "data-store.database",
    "data-store": "data-store.database",
    ux: "application.applicationcomponent",
    navigation: "application.applicationcomponent",
    apm: "application.applicationservice",
    testing: "business.businessprocess",
  };

  /**
   * All valid spec node IDs across all layers (cached Set for O(1) lookup)
   */
  private static readonly ALL_VALID_IDS: Set<string> = (() => {
    const ids = new Set<string>();
    Object.values(VisualizationServer.VALID_SPEC_NODE_IDS).forEach((layerIds) => {
      layerIds.forEach((id) => ids.add(id));
    });
    return ids;
  })();

  /** The central server for every project and checkout of a farm. */
  constructor(options: VisualizationServerOptions) {
    this.app = new OpenAPIHono();
    const central = options.central;
    if (!central) throw new Error("A visualization server serves a farm: pass the central option");
    const pool = new CheckoutContextPool({
      resolver: central.registry.resolver(),
      settings: central.pool,
      load: (resolved) => this.loadCheckoutContext(resolved),
    });
    const stopRemovedListener = central.registry.onCheckoutRemoved(({ ref }) => {
      this.closeRemovedCheckout(ref);
    });
    // A commit run in this process (the viewer's Apply, an MCP or DrBot changeset_commit) reports
    // its progress on a process-wide channel; its checkout's subscribers hear it (issue 1361).
    const stopProgressListener = subscribeCommitProgress((progress) => this.broadcastCommitProgress(progress));
    const stopListening = () => {
      stopRemovedListener();
      stopProgressListener();
    };
    this.central = { options: central, pool, sockets: new Map(), stopListening, connections: new Set() };

    // Set up the WebSocket adapter for this app instance (works under both
    // Node.js and Bun, since @hono/node-server/@hono/node-ws use Node's
    // http module, which Bun also implements).
    this.loadWebSocketAdapter();

    // Every API, websocket and MCP call carries the token: there is no unauthenticated mode.
    this.authToken = options.authToken || this.generateAuthToken();
    this.drBot = new DrBotLauncher({
      withDanger: options.withDanger || false,
      withChangesets: options.withChangesets || false,
      // One socket can chat in several checkouts: replies name theirs.
      stampCheckout: true,
    });
    this.launcherPid = options.launcherPid;
    // Use explicit viewerPath if provided, otherwise fall back to the bundled viewer
    this.viewerPath = options.viewerPath ||
      new URL("../viewer", import.meta.url).pathname;

    // Add CORS middleware
    this.app.use("/*", cors());

    // Add telemetry middleware to instrument all HTTP requests
    this.app.use("/*", telemetryMiddleware);

    // Add authentication middleware (except for health endpoint and root)
    this.app.use("/api/*", async (c, next) => {
      // Check for token in Authorization header or query parameter
      const authHeader = c.req.header("Authorization");
      const queryToken = c.req.query("token");

      let providedToken: string | null = null;

      if (authHeader && authHeader.startsWith("Bearer ")) {
        providedToken = authHeader.substring(7);
      } else if (queryToken) {
        providedToken = queryToken;
      }

      if (!providedToken) {
        return c.json({ error: "Authentication required. Please provide a valid token." }, 401);
      }

      if (!this.isAuthToken(providedToken)) {
        return c.json({ error: "Invalid authentication token" }, 403);
      }

      return next();
    });

    // An API request that got past the authentication above counts as use of the server (see
    // centralActivity). A refused request, a health check, a page or asset load, and a call to a
    // retired unscoped route (410) do not: those would keep an unused process alive, and a stale
    // custom viewer polling a retired route gets nothing from it.
    this.app.use("/api/*", async (c, next) => {
      await next();
      if (c.res.status !== 410) this.lastActivityAt = Date.now();
    });

    // Each project-data request runs in the context of the checkout its path names.
    this.app.use("/api/*", (c, next) => this.scopeRequest(c, next));
    // MCP for every session of the farm (issue 1279, slice 3A), behind the one token.
    this.app.all("/mcp", (c) => this.handleMcp(c.req.raw));

    this.setupRoutes();

    if (process.env.VERBOSE) {
      console.log(`[Auth] Authentication enabled. Token: ${this.authToken}`);
    }

    // Initialize chat clients asynchronously
    this.initializeChatClients().catch((error) => {
      this.chatInitializationError = error instanceof Error ? error : new Error(String(error));
      console.error("[Chat] Failed to initialize chat clients:", error);
    });
  }

  /**
   * Set up the WebSocket adapter for this server instance
   * This is called in the constructor to support WebSocket functionality via @hono/node-ws,
   * which works identically under Node.js and Bun (both implement Node's http module).
   * Wrapped in try/catch as a defensive guard so a WS setup failure would degrade the
   * server gracefully (no /ws route) rather than crash construction entirely, in case
   * this ever becomes fallible again in the future.
   */
  private loadWebSocketAdapter(): void {
    try {
      const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app: this.app });
      this.injectWebSocket = injectWebSocket;
      this.upgradeWebSocket = upgradeWebSocket;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[Server] WARNING: Could not set up WebSocket adapter: ${message}. ` +
          `WebSocket endpoints (/ws) will not be available.`
      );
      if (process.env.VERBOSE && error instanceof Error && error.stack) {
        console.debug("[Server] Stack trace:", error.stack);
      }
    }
  }

  /**
   * Detect and initialize available chat clients
   */
  private async initializeChatClients(): Promise<void> {
    const clients = await detectAvailableClients();

    // Select the chat client from available clients
    // Note: Chat client preference is no longer persisted in manifest
    this.drBot.chatClient = selectChatClient(clients, null);

    if (this.drBot.chatClient && process.env.VERBOSE) {
      console.log(`[Chat] Using chat client: ${this.drBot.chatClient.getClientName()}`);
    } else if (clients.length === 0 && process.env.VERBOSE) {
      console.log("[Chat] No chat clients available");
    }
  }

  /**
   * Generate a random auth token
   */
  private generateAuthToken(): string {
    return `dr-${randomBytes(24).toString('base64url')}`;
  }

  /**
   * Shared annotation update logic for PUT/PATCH handlers
   * Performs partial updates with atomic operations
   */
  private async updateAnnotation(
    annotationId: string,
    body: z.infer<typeof AnnotationUpdateSchema>
  ): Promise<StoredAnnotation | null> {
    const { updated, messages } = await this.withAnnotations(async () => {
      const updated = await this.annotationStore.update(annotationId, body);
      return { updated, messages: updated ? this.diffAnnotation(updated) : [] };
    });
    if (!updated) {
      return null;
    }

    // Broadcast to all clients: this update, and any change another process made before it
    await this.broadcastAll(messages);

    return updated;
  }

  /** Broadcasts each message, in order. */
  private async broadcastAll(messages: Array<Record<string, unknown>>): Promise<void> {
    for (const message of messages) {
      await this.broadcastMessage(message);
    }
  }

  /** Runs an annotation write or sync after the ones queued before it. */
  private withAnnotations<T>(fn: () => Promise<T>): Promise<T> {
    return this.context.withAnnotations(fn);
  }

  /**
   * Records an annotation as seen and returns a broadcast for each difference from what this
   * server last saw of it. Call it inside withAnnotations.
   */
  private diffAnnotation(annotation: StoredAnnotation): Array<Record<string, unknown>> {
    return this.context.diffAnnotation(annotation);
  }

  /**
   * Compares the annotation files with what this server last saw, and broadcasts each change
   * another process made (the MCP annotation tools, a hand edit) with the same messages the
   * REST routes send: annotation.added, annotation.updated, annotation.reply.added and
   * annotation.deleted.
   */
  private async syncAnnotations(options: { broadcast: boolean }): Promise<void> {
    const messages = await this.context.syncAnnotations();
    if (!options.broadcast) return;
    await this.broadcastAll(messages);
  }

  /** Syncs the annotations once their files have been quiet for a moment. */
  private scheduleAnnotationsSync(): void {
    this.context.debounce("annotations", this.changesetsDebounceMs, () => {
      this.syncAnnotations({ broadcast: true }).catch((error) => {
        console.error(`[Watcher] Failed to broadcast annotations: ${getErrorMessage(error)}`);
      });
    });
  }

  /**
   * Setup HTTP routes and WebSocket handler
   */
  private setupRoutes(): void {
    // Register bearerAuth security scheme for protected /api/* routes
    this.app.openAPIRegistry.registerComponent('securitySchemes', 'bearerAuth', {
      type: 'http',
      scheme: 'bearer',
      description: 'API token (shown at server startup, pass as Authorization: Bearer <token>)',
    });

    // Static viewer HTML at root
    this.app.get("/", (c) => {
      if (this.viewerPath) {
        // Serve custom viewer index.html
        return this.serveCustomViewer("index.html");
      }
      return c.html(this.getViewerHTML());
    });

    // Serve static files from custom viewer path if provided
    // Note: This catch-all route must skip API/WS routes by passing to next handler
    if (this.viewerPath) {
      this.app.get("/*", async (c, next) => {
        const requestPath = c.req.path;
        if (process.env.VERBOSE) console.log(`[ROUTE] Catch-all matched: ${requestPath}`);

        // Skip API routes, WebSocket and MCP - let them be handled by their specific routes
        if (
          requestPath.startsWith("/api/") ||
          requestPath === "/ws" ||
          requestPath === "/health" ||
          requestPath === "/api-spec.yaml" ||
          requestPath === "/api-docs" ||
          requestPath === "/mcp" ||
          requestPath.startsWith("/mcp/")
        ) {
          if (process.env.VERBOSE) console.log(`[ROUTE] Catch-all delegating to next handler for: ${requestPath}`);
          return next(); // Pass to next handler instead of returning 404
        }
        // The viewer's deep links (/p/<project>/c/<checkout>/...) are its page: a link opened
        // without its hash still loads the viewer, which routes from there.
        if (requestPath === "/p" || requestPath.startsWith("/p/")) return this.serveCustomViewer("index.html");

        if (process.env.VERBOSE) console.log(`[ROUTE] Catch-all serving custom viewer file: ${requestPath}`);
        return this.serveCustomViewer(requestPath.substring(1));
      });
    }

    // Health check endpoint
    const healthRoute = createRoute({
      method: 'get',
      path: '/health',
      tags: ['Health'],
      summary: 'Health check',
      description: 'Check if the server is running and healthy',
      responses: {
        200: {
          description: 'Server is healthy',
          content: {
            'application/json': {
              schema: HealthResponseSchema,
            },
          },
        },
      },
    });

    this.app.openapi(healthRoute, (c) => c.json(this.centralHealth(this.requestHasToken(c))));

    // Get full model
    const getModelRoute = createRoute({
      method: 'get',
      path: '/api/model',
      tags: ['Model'],
      summary: 'Get full model',
      description: 'Retrieve the complete architecture model across all layers',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Model data retrieved successfully',
          content: {
            'application/json': {
              schema: ModelResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.dataRoute(getModelRoute, async (c) => {
      if (process.env.VERBOSE) console.log(`[ROUTE] /api/model handler called`);
      try {
        if (process.env.VERBOSE) console.log(`[ROUTE] /api/model serializing model...`);
        const modelData = await this.serializeModel();
        if (process.env.VERBOSE)
          console.log(
            `[ROUTE] /api/model returning ${Object.keys(modelData.layers || {}).length} layers`
          );
        return c.json(modelData);
      } catch (error) {
        const message = getErrorMessage(error);
        console.error(`[ROUTE] /api/model error: ${message}`);
        return c.json({ error: message }, 500);
      }
    });

    // Get specific layer
    const getLayerRoute = createRoute({
      method: 'get',
      path: '/api/layers/:layerName',
      tags: ['Model'],
      summary: 'Get layer',
      description: 'Retrieve a specific layer with all its elements',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ layerName: LayerNameSchema }),
      },
      responses: {
        200: {
          description: 'Layer retrieved successfully',
          content: {
            'application/json': {
              schema: LayerResponseSchema,
            },
          },
        },
        404: {
          description: 'Layer not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(getLayerRoute, (async (c: any) => {
      try {
        const { layerName } = c.req.valid("param");
        const layer = await this.model.getLayer(layerName);

        if (!layer) {
          return c.json({ error: "Layer not found" }, 404);
        }

        const elements = layer.listElements().map((e) => e.toJSON());

        return c.json({
          name: layerName,
          elements,
          elementCount: elements.length,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    }) as any);

    // Get JSON Schema specifications
    const getSpecRoute = createRoute({
      method: 'get',
      path: '/api/spec',
      tags: ['Schema'],
      summary: 'Get JSON schemas',
      description: 'Retrieve all JSON Schema definitions used by the system',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Schemas retrieved successfully',
          content: {
            'application/json': {
              schema: SpecResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.app.openapi(getSpecRoute, (async (c: any) => {
      try {
        const schemas = await this.loadSchemas();
        return c.json({
          version: "0.1.0",
          type: "schema-collection",
          description: "JSON Schema definitions from dr CLI",
          source: "dr-cli",
          schemas,
          schemaCount: Object.keys(schemas).length,
        });
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    }) as any);

    this.setupProjectRoutes();

    // Annotations API (spec-compliant routes)

    // Get all annotations (optionally filtered by elementId)
    const getAnnotationsRoute = createRoute({
      method: 'get',
      path: '/api/annotations',
      tags: ['Annotations'],
      summary: 'Get annotations',
      description: 'Retrieve all annotations, optionally filtered by element',
      security: [{ bearerAuth: [] }],
      request: {
        query: AnnotationFilterSchema,
      },
      responses: {
        200: {
          description: 'Annotations retrieved successfully',
          content: {
            'application/json': {
              schema: AnnotationsListSchema,
            },
          },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(getAnnotationsRoute, (async (c: any) => {
      try {
        const query = c.req.valid("query");
        // All annotations, or one element's; read from disk, so the MCP tools' show too.
        const annotations = await this.annotationStore.list(query.elementId);
        return c.json({ annotations });
      } catch (error) {
        return c.json({ error: getErrorMessage(error) }, 500);
      }
    }) as any);

    // Create annotation
    const createAnnotationRoute = createRoute({
      method: 'post',
      path: '/api/annotations',
      tags: ['Annotations'],
      summary: 'Create annotation',
      description: 'Create a new annotation on a model element',
      security: [{ bearerAuth: [] }],
      request: {
        body: {
          content: {
            'application/json': {
              schema: AnnotationCreateSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Annotation created successfully',
          content: {
            'application/json': {
              schema: AnnotationSchema,
            },
          },
        },
        400: {
          description: 'Invalid request body',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        404: {
          description: 'Element not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.dataRoute(createAnnotationRoute, async (c) => {
      try {
        const body = c.req.valid("json");

        // Verify the element exists in the model or in a changeset that adds it
        if (!(await this.elementExists(body.elementId))) {
          return c.json({ error: "Element not found" }, 404);
        }

        const { annotation, messages } = await this.withAnnotations(async () => {
          const created = await this.annotationStore.create({
            elementId: body.elementId,
            author: body.author,
            content: body.content,
            tags: body.tags,
          });
          return { annotation: created, messages: this.diffAnnotation(created) };
        });

        // Broadcast to all clients (annotation.added)
        await this.broadcastAll(messages);

        return c.json(annotation, 201);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    });

    // Get individual annotation by ID
    const getAnnotationRoute = createRoute({
      method: 'get',
      path: '/api/annotations/:annotationId',
      tags: ['Annotations'],
      summary: 'Get annotation by ID',
      description: 'Retrieve a specific annotation by its ID',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ annotationId: IdSchema }),
      },
      responses: {
        200: {
          description: 'Annotation retrieved successfully',
          content: {
            'application/json': {
              schema: AnnotationSchema,
            },
          },
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(getAnnotationRoute, (async (c: any) => {
      try {
        const { annotationId } = c.req.valid("param");
        const annotation = await this.annotationStore.get(annotationId);

        if (!annotation) {
          return c.json({ error: "Annotation not found" }, 404);
        }

        return c.json(annotation);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    }) as any);

    // Update annotation (PUT - partial update for backwards compatibility)
    // NOTE: DESIGN RATIONALE - Non-standard PUT behavior:
    // This endpoint performs PARTIAL updates (idempotent) like PATCH, not full replacement
    // like standard HTTP PUT. This is a known deviation from HTTP semantics, chosen for
    // backwards compatibility with existing API consumers. New code should prefer PATCH
    // for partial updates. If full replacement semantics are needed in future, a new
    // endpoint should be created rather than changing this one's behavior.
    const putAnnotationRoute = createRoute({
      method: 'put',
      path: '/api/annotations/:annotationId',
      tags: ['Annotations'],
      summary: 'Update annotation (partial)',
      description: 'Update an existing annotation with partial fields (NOTE: partial updates, use PATCH for recommended behavior)',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ annotationId: IdSchema }),
        body: {
          content: {
            'application/json': {
              schema: AnnotationUpdateSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Annotation updated successfully',
          content: {
            'application/json': {
              schema: AnnotationSchema,
            },
          },
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(putAnnotationRoute, (async (c: any) => {
      try {
        const { annotationId } = c.req.valid("param");
        const body = c.req.valid("json");

        const updatedAnnotation = await this.updateAnnotation(annotationId, body);

        if (!updatedAnnotation) {
          return c.json({ error: "Annotation not found" }, 404);
        }

        return c.json(updatedAnnotation);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    }) as any);

    // Update annotation (PATCH)
    const patchAnnotationRoute = createRoute({
      method: 'patch',
      path: '/api/annotations/:annotationId',
      tags: ['Annotations'],
      summary: 'Partially update annotation',
      description: 'Partially update an existing annotation (recommended over PUT)',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ annotationId: IdSchema }),
        body: {
          content: {
            'application/json': {
              schema: AnnotationUpdateSchema,
            },
          },
        },
      },
      responses: {
        200: {
          description: 'Annotation updated successfully',
          content: {
            'application/json': {
              schema: AnnotationSchema,
            },
          },
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(patchAnnotationRoute, (async (c: any) => {
      try {
        const { annotationId } = c.req.valid("param");
        const body = c.req.valid("json");

        const updatedAnnotation = await this.updateAnnotation(annotationId, body);

        if (!updatedAnnotation) {
          return c.json({ error: "Annotation not found" }, 404);
        }

        return c.json(updatedAnnotation);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    }) as any);

    // Delete annotation
    const deleteAnnotationRoute = createRoute({
      method: 'delete',
      path: '/api/annotations/:annotationId',
      tags: ['Annotations'],
      summary: 'Delete annotation',
      description: 'Delete an existing annotation',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ annotationId: IdSchema }),
      },
      responses: {
        204: {
          description: 'Annotation deleted successfully',
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.dataRoute(deleteAnnotationRoute, async (c) => {
      try {
        const { annotationId } = c.req.valid("param");

        // Removes the annotation and its replies
        const deleted = await this.withAnnotations(async () => {
          const existed = await this.annotationStore.delete(annotationId);
          this.context.annotationSnapshot.delete(annotationId);
          return existed;
        });
        if (!deleted) {
          return c.json({ error: "Annotation not found" }, 404);
        }

        // Broadcast to all clients
        await this.broadcastMessage({
          type: "annotation.deleted",
          annotationId,
          timestamp: new Date().toISOString(),
        });

        return c.body(null, 204);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    });

    // GET annotation replies
    const getAnnotationRepliesRoute = createRoute({
      method: 'get',
      path: '/api/annotations/:annotationId/replies',
      tags: ['Annotations'],
      summary: 'Get annotation replies',
      description: 'Retrieve all replies to an annotation',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ annotationId: IdSchema }),
      },
      responses: {
        200: {
          description: 'Replies retrieved successfully',
          content: {
            'application/json': {
              schema: AnnotationRepliesSchema,
            },
          },
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(getAnnotationRepliesRoute, (async (c: any) => {
      try {
        const { annotationId } = c.req.valid("param");
        const annotation = await this.annotationStore.get(annotationId);

        if (!annotation) {
          return c.json({ error: "Annotation not found" }, 404);
        }

        return c.json({ replies: annotation.replies });
      } catch (error) {
        return c.json({ error: getErrorMessage(error) }, 500);
      }
    }) as any);

    // POST annotation reply
    const createAnnotationReplyRoute = createRoute({
      method: 'post',
      path: '/api/annotations/:annotationId/replies',
      tags: ['Annotations'],
      summary: 'Create annotation reply',
      description: 'Add a reply to an annotation',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ annotationId: IdSchema }),
        body: {
          content: {
            'application/json': {
              schema: AnnotationReplyCreateSchema,
            },
          },
        },
      },
      responses: {
        201: {
          description: 'Reply created successfully',
          content: {
            'application/json': {
              schema: AnnotationReplySchema,
            },
          },
        },
        404: {
          description: 'Annotation not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
        500: {
          description: 'Server error',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    this.dataRoute(createAnnotationReplyRoute, async (c) => {
      try {
        const { annotationId } = c.req.valid("param");
        const body = c.req.valid("json");

        const { reply, messages } = await this.withAnnotations(async () => {
          const added = await this.annotationStore.addReply(annotationId, {
            author: body.author,
            content: body.content,
          });
          if (!added) return { reply: null, messages: [] };
          const annotation = await this.annotationStore.get(annotationId);
          const own = {
            type: "annotation.reply.added",
            annotationId,
            replyId: added.id,
            timestamp: added.createdAt,
          };
          // Deleted by another process straight after: the watcher reports the delete.
          return { reply: added, messages: annotation ? this.diffAnnotation(annotation) : [own] };
        });

        if (!reply) {
          return c.json({ error: "Annotation not found" }, 404);
        }

        // Broadcast to all clients: this reply, and any change another process made before it
        await this.broadcastAll(messages);

        return c.json(reply, 201);
      } catch (error) {
        const message = getErrorMessage(error);
        return c.json({ error: message }, 500);
      }
    });

    // Changesets API

    // Get all changesets
    const getChangesetsRoute = createRoute({
      method: 'get',
      path: '/api/changesets',
      tags: ['Changesets'],
      summary: 'Get changesets',
      description:
        'Retrieve a list of all changesets. Each carries its base drift (drift), checked on this read with no commit ' +
        'attempt: whether the base model changed under it and overlaps what it stages. GET /api/changesets/:id ' +
        'adds what changed.',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'Changesets retrieved successfully',
          content: {
            'application/json': {
              schema: ChangesetsListSchema,
            },
          },
        },
      },
    });

    // Changesets are re-read from disk on every request: the CLI (or a chat agent in
    // changeset mode) creates and stages them under documentation-robotics/changesets,
    // which the file watcher doesn't cover, so the in-memory map goes stale.
    this.dataRoute(getChangesetsRoute, async (c) => {
      await this.loadChangesetsFromDisk();
      const changesets: Record<string, any> = {};

      // One manager for the request: each changeset's base is compared with the model as loaded.
      // A copy of the map's entries: the loop awaits, and a reload meanwhile refills the map.
      const manager = this.context.stagingArea();
      // One read of the base for the request too: it is indexed and hashed once, however many
      // changesets are compared with it. A failure here is each changeset's "unknown", below.
      const entries = [...this.context.changesets];
      const base = entries.some(([, changeset]) => changeset.status === "staged")
        ? await manager.readBase().catch(() => undefined)
        : undefined;
      for (const [id, changeset] of entries) {
        const { purpose, verifies } = await purposeOf(this.context.rootPath, changeset);
        changesets[id] = {
          name: changeset.name,
          ...(changeset.description ? { description: changeset.description } : {}),
          status: changeset.status,
          created: changeset.created,
          changes_count: changeset.changes.length,
          ...(changeset.origin ? { origin: changeset.origin } : {}),
          purpose,
          ...(verifies ? { verifies } : {}),
          actions: allowedActions(purpose, changeset.status),
          drift: await driftStatus(manager, this.driftSubject(changeset, purpose, verifies), { base }),
          revision: reviewRevision(changeset),
          review: reviewCounts(changeset, changeset.review, await this.blockedDeletes(changeset)),
        };
      }

      return c.json({
        version: "1.0.0",
        changesets,
      });
    });

    // Get specific changeset
    const getChangesetRoute = createRoute({
      method: 'get',
      path: '/api/changesets/:changesetId',
      tags: ['Changesets'],
      summary: 'Get changeset',
      description:
        'Retrieve a specific changeset with all its changes, and its base drift (drift), checked on this read with no ' +
        'commit attempt: whether the base model changed under it and, when it did, the staged changes the base now ' +
        'overlaps (always all of them, each with what landing does about it) and what was added, removed or changed ' +
        'in the base. Those five lists are a page: driftLimit entries of each from driftOffset, with ' +
        'drift.baseChanges.page giving each list\'s true total and the nextOffset that continues them.',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ changesetId: IdSchema }),
        query: z.object({
          driftLimit: z.coerce.number().int().min(1).optional()
            .describe('How many entries of each drift.baseChanges list to return (default 50; no upper bound)'),
          driftOffset: z.coerce.number().int().min(0).optional()
            .describe('Where in each drift.baseChanges list to start (default 0); pass drift.baseChanges.page.nextOffset to go on'),
        }),
      },
      responses: {
        200: {
          description: 'Changeset retrieved successfully',
          content: {
            'application/json': {
              schema: ChangesetDetailSchema,
            },
          },
        },
        404: {
          description: 'Changeset not found',
          content: {
            'application/json': {
              schema: ErrorResponseSchema,
            },
          },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(getChangesetRoute, (async (c: any) => {
      const { changesetId } = c.req.valid("param");
      const { driftLimit, driftOffset } = c.req.valid("query") as { driftLimit?: number; driftOffset?: number };
      await this.loadChangesetsFromDisk();
      const changeset = this.context.changesets.get(changesetId);

      if (!changeset) {
        return c.json({ error: "Changeset not found" }, 404);
      }

      const blockers = await this.changesetBlockers(changeset);
      const { purpose, verifies, scope } = await purposeOf(this.context.rootPath, changeset);
      // Shown before Apply (#1437): a write that arrives while it lands is refused.
      const stillWriting =
        changeset.status === "staged" ? await this.context.stagingArea().writeActivityWarning(changeset) : undefined;
      return c.json({
        id: changeset.id,
        name: changeset.name,
        description: changeset.description,
        status: changeset.status,
        created: changeset.created,
        modified: changeset.modified,
        baseSnapshot: changeset.baseSnapshot,
        stats: changeset.stats,
        revision: reviewRevision(changeset),
        ...(changeset.origin ? { origin: changeset.origin } : {}),
        purpose,
        ...(verifies ? { verifies } : {}),
        ...(scope ? { scope } : {}),
        actions: allowedActions(purpose, changeset.status),
        ...(stillWriting ? { stillWriting } : {}),
        drift: await driftDetail(
          this.model,
          this.context.stagingArea(),
          this.driftSubject(changeset, purpose, verifies),
          { limit: driftLimit, offset: driftOffset }
        ),
        unstaged: changeset.unstaged,
        review: changeset.review,
        changes: changeset.changes.map((change, index) => {
          const sequence = (change as { sequenceNumber?: number }).sequenceNumber ?? index;
          const list = change.type === "delete" ? blockers.get(sequence) : undefined;
          return list ? { ...change, blockers: list } : change;
        }),
      });
    }) as any);

    // A plan compared with what was built: changeset_verify's report, read-only.
    const getChangesetVerificationRoute = createRoute({
      method: 'get',
      path: '/api/changesets/:changesetId/verification',
      tags: ['Changesets'],
      summary: 'Compare a plan changeset with an as-built changeset',
      description:
        'The plan changeset (staged or committed) compared with the changeset named by `against` (a verification ' +
        'record or any as-built changeset): the same report as the changeset_verify MCP tool, in full. Each planned ' +
        'element and relationship is matched (exact or probable), divergent, missing or unverifiable (extraction ' +
        'cannot see it), and each as-built one the plan does not name is unplanned. Element ids are dotted ids. ' +
        'Read-only; nothing is staged or written.',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ changesetId: IdSchema }),
        query: z.object({
          against: IdSchema.describe('The as-built changeset id to compare the plan with'),
        }),
      },
      responses: {
        200: {
          description: 'The comparison',
          content: { 'application/json': { schema: ChangesetVerificationSchema } },
        },
        400: {
          description: 'against is missing, or names the plan itself',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
        404: {
          description: 'The plan or the as-built changeset was not found',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(getChangesetVerificationRoute, (async (c: any) => {
      const { changesetId } = c.req.valid("param");
      const { against } = c.req.valid("query") as { against: string };
      if (against === changesetId) {
        return c.json({ error: "against names the plan itself; pass the as-built changeset to compare with" }, 400);
      }
      await this.loadChangesetsFromDisk();
      const planned = this.context.changesets.get(changesetId);
      if (!planned) return c.json({ error: "Changeset not found" }, 404);
      const asBuilt = this.context.changesets.get(against);
      if (!asBuilt) return c.json({ error: `As-built changeset not found: ${against}` }, 404);
      const report = await verifyChangesetInModel(this.model, { planned, against: { changeset: asBuilt } });
      return c.json({ ...report, asBuiltChangeset: { id: asBuilt.id, name: asBuilt.name } });
    }) as any);

    // Record the reviewer's per-change verdicts (keep / drop / ask) on a staged changeset.
    const putChangesetReviewRoute = createRoute({
      method: 'put',
      path: '/api/changesets/:changesetId/review',
      tags: ['Changesets'],
      summary: 'Record review decisions',
      description:
        'Set or clear the reviewer\'s verdict on changes of a staged changeset, by sequence number. ' +
        'A null verdict clears the decision. The server stamps atRevision (the changeset\'s current ' +
        'revision) and decidedAt. Stored in review.yaml in the changeset\'s directory, under its file ' +
        'lock. Broadcasts changesets.updated.',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ changesetId: IdSchema }),
        body: { required: true, content: { 'application/json': { schema: ChangesetReviewUpdateSchema } } },
      },
      responses: {
        200: {
          description: 'The changeset\'s review after the update',
          content: { 'application/json': { schema: ChangesetReviewSchema } },
        },
        404: {
          description: 'Changeset not found',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
        409: {
          description: 'Changeset is not staged',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
        422: {
          description: 'A sequence number names no staged change (or, to clear, no decision)',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(putChangesetReviewRoute, (async (c: any) => {
      const { changesetId } = c.req.valid("param");
      const body = c.req.valid("json") as {
        decisions: Array<{ sequence: number; verdict: ReviewVerdict | null; note?: string }>;
      };
      return this.updateChangesetReview(c, changesetId, body.decisions);
    }) as any);

    // Commit a staged changeset to the model, and discard one. These are the user's
    // review step for changes a chat agent staged in changeset mode
    // (`dr visualize --with-changesets`), which never lets the agent commit itself.
    const changesetActionResponses = {
      200: {
        description: 'Action completed',
        content: { 'application/json': { schema: ChangesetActionResultSchema } },
      },
      404: {
        description: 'Changeset not found',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      409: {
        description:
          'Changeset is not staged, or (commit) it is a verification record or an upgrade record, which is never landed. ' +
          'Never for drift: a drifted changeset lands',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
      422: {
        description: 'The changeset failed validation; nothing was applied',
        content: { 'application/json': { schema: ErrorResponseSchema } },
      },
    };

    const commitChangesetRoute = createRoute({
      method: 'post',
      path: '/api/changesets/:changesetId/commit',
      tags: ['Changesets'],
      summary: 'Commit changeset',
      description:
        'Apply a staged changeset to the model (same as `dr changeset commit`): validates it, ' +
        'applies every change atomically, marks it committed, and deactivates it if it was active. ' +
        'Drift does not refuse it: when the base overlaps what the changeset stages (its drift.state is drifted), ' +
        'it lands all the same, and the result\'s drift lists each overlap with what landing did about it. Show ' +
        'GET /api/changesets/:id\'s drift.overlapping, with each consequence, before calling this. Refused (409) for a ' +
        'verification record or an upgrade record (whose actions do not include commit): it is never landed.',
      security: [{ bearerAuth: [] }],
      request: {
        params: z.object({ changesetId: IdSchema }),
        // Optional: without `drop` or `deleteBlockedLinks` the commit is exactly the plain one. Documented
        // with a plain schema object, not the zod schema, so the route installs no JSON validator: one
        // would refuse (400) the empty body that clients send with `Content-Type: application/json`
        // (the viewer's generated client does). The handler reads and checks the body itself.
        body: { required: false, content: { 'application/json': { schema: COMMIT_REQUEST_DOC_SCHEMA } } },
      },
      responses: {
        ...changesetActionResponses,
        400: {
          description: 'The body is not JSON, or does not match the schema (an empty body is the plain commit)',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
        422: {
          description:
            'The changeset failed validation; nothing was applied. Or (body given) a sequence number names ' +
            'no staged change, a delete has blockers and is not in deleteBlockedLinks (blockers lists them), ' +
            'or a staged relationship-add names an element the changeset deletes',
          content: { 'application/json': { schema: ChangesetCommitRefusedSchema } },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(commitChangesetRoute, (async (c: any) => {
      const { changesetId } = c.req.valid("param");
      const parsed = await readCommitRequest(c);
      if ("error" in parsed) {
        return c.json({ error: parsed.error }, 400);
      }
      const body = parsed.body;
      const review =
        body.drop !== undefined || body.deleteBlockedLinks !== undefined
          ? { drop: body.drop ?? [], deleteBlockedLinks: body.deleteBlockedLinks ?? [] }
          : undefined;
      return this.runChangesetAction(c, changesetId, "commit", review);
    }) as any);

    const discardChangesetRoute = createRoute({
      method: 'post',
      path: '/api/changesets/:changesetId/discard',
      tags: ['Changesets'],
      summary: 'Discard changeset',
      description:
        'Throw away a staged changeset (same as `dr changeset discard`): deletes it with its changes and its folder ' +
        'under documentation-robotics/changesets/, and deactivates it if it was active. No record is kept, so it ' +
        'no longer appears in GET /api/changesets. The model is not touched.',
      security: [{ bearerAuth: [] }],
      request: { params: z.object({ changesetId: IdSchema }) },
      responses: changesetActionResponses,
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(discardChangesetRoute, (async (c: any) => {
      const { changesetId } = c.req.valid("param");
      return this.runChangesetAction(c, changesetId, "discard");
    }) as any);

    // Tier 1: its state and this month's spend against the cap (TIER1_DESIGN.md sections 4.3
    // and 7), the tier1_status MCP tool's body from the same code, for the viewer's Tier-1 panel.
    // Read-only: it never sends the probe (that spends money), never writes tier1.json or
    // anything else under .dr/, and no field holds a key or the account id.
    const getTier1Route = createRoute({
      method: 'get',
      path: '/api/tier1',
      tags: ['Extraction'],
      summary: 'Get Tier 1 state and spend',
      description:
        'Whether Tier 1 (the decision model codebase_extract asks about the cards Tier 0 cannot decide) is on for the ' +
        'served project\'s checkout, and why not: state, provider and model, where each credential comes from (never ' +
        'its value), this calendar month\'s spend (UTC) against the monthly cap with the 80% warning state, spend by ' +
        'source, and the answer cache. The same body as the tier1_status MCP tool, without its probe: this endpoint ' +
        'never sends a request to a provider and never writes a file. Returns state "off" when the project has not ' +
        'opted in. Tier 1 is enabled and changed only with `dr analyzer tier1 ...`; nothing in this API changes it.',
      security: [{ bearerAuth: [] }],
      request: {
        query: z.object({
          analyzer: z
            .string()
            .regex(/^[A-Za-z0-9_-]+$/, 'Invalid analyzer name')
            .optional()
            .describe('The analyzer Tier 1 is configured for (default: the active analyzer, else cbm)'),
        }),
      },
      responses: {
        200: {
          description: 'Tier 1\'s state and spend',
          content: {
            'application/json': {
              schema: Tier1StatusResponseSchema,
              examples: TIER1_STATUS_EXAMPLES,
            },
          },
        },
        400: {
          description: 'Invalid analyzer name',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
        500: {
          description: 'The status could not be read',
          content: { 'application/json': { schema: ErrorResponseSchema } },
        },
      },
    });

    // ✅ Type cast required: See Type Casting Note at top of file
    this.dataRoute(getTier1Route, (async (c: any) => {
      const { analyzer: asked } = c.req.valid("query") as { analyzer?: string };
      try {
        return c.json(await this.tier1Body(asked));
      } catch (error) {
        // Messages built by status.ts never quote tier1.json's content (see config.ts).
        return c.json({ error: `Could not read Tier 1's status: ${getErrorMessage(error)}` }, 500);
      }
    }) as any);

    // OpenAPI documentation endpoint
    // Note: @hono/zod-openapi always generates 3.1.0, so we specify it here
    // but the version is normalized to 3.0.3 in the generate-openapi.ts script
    this.app.doc('/api-spec.yaml', {
      openapi: '3.1.0',
      info: {
        title: 'Documentation Robotics Visualization Server API',
        version: '0.1.0',
        description: 'API specification for the DR CLI visualization server',
        contact: {
          name: 'Documentation Robotics',
          url: 'https://github.com/tinkermonkey/documentation_robotics',
        },
        license: {
          name: 'ISC',
        },
      },
      servers: [
        { url: 'http://localhost:8080', description: 'Local development server' },
      ],
      tags: [
        { name: 'Health', description: 'Server health and status' },
        { name: 'Projects', description: "The farm's projects and their checkouts (central process)" },
        { name: 'Schema', description: 'JSON Schema specifications' },
        { name: 'Model', description: 'Architecture model data' },
        { name: 'Changesets', description: 'Model changesets and history' },
        { name: 'Annotations', description: 'User annotations on model elements' },
        { name: 'Extraction', description: 'Codebase extraction: Tier 1 (decision model) state and spend' },
        { name: 'WebSocket', description: 'Real-time updates via WebSocket' },
        { name: 'MCP', description: 'The MCP interface for every session of the farm' },
        { name: 'Docs', description: 'This document, and an interactive view of it' },
      ],
    });

    // Swagger UI for interactive API exploration
    this.app.get('/api-docs', swaggerUI({ url: '/api-spec.yaml' }));

    this.registerUnscopedRouteDocs();

    // WebSocket endpoint
    // Only register if the WebSocket adapter was set up successfully
    if (this.upgradeWebSocket) {
      this.app.get(
        "/ws",
        async (c, next) => {
          // Every socket carries the token.
          {
            // Accept token from multiple sources to support diverse client environments:
            // 1. Query parameter: ?token=<token>
            //    Why: Works in all browsers. Simple and universally compatible.
            // 2. Sec-WebSocket-Protocol header: token, <actual-token>
            //    Why: Browsers cannot set custom HTTP headers during WebSocket handshake
            //    for security reasons. The WebSocket spec allows subprotocol negotiation
            //    as an alternative auth mechanism. Format: ["token", "YOUR_TOKEN"]
            // 3. Authorization header: Bearer <token>
            //    Why: Standard OAuth2/JWT pattern for non-browser clients (Node.js, cURL, etc)
            //    that can set arbitrary headers. Browsers cannot use this for WebSocket due
            //    to HTTP header restrictions during handshake.

            const queryToken = c.req.query("token");

            // Check Sec-WebSocket-Protocol header (browser-compatible method)
            // Format: "token, <actual-token>" or "token,<actual-token>"
            const wsProtocol = c.req.header("Sec-WebSocket-Protocol");
            let protocolToken: string | null = null;
            if (wsProtocol) {
              const protocols = wsProtocol.split(",").map((p) => p.trim());
              // Look for protocol pair: ['token', '<actual-token>']
              const tokenIndex = protocols.indexOf("token");
              if (tokenIndex !== -1 && protocols.length > tokenIndex + 1) {
                protocolToken = protocols[tokenIndex + 1];
              }
            }

            // Check Authorization header (non-browser clients)
            const authHeader = c.req.header("Authorization");
            const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

            const token = queryToken || protocolToken || bearerToken;

            if (!token) {
              return c.json(
                {
                  error:
                    'Authentication required. Provide token via: 1) Query param (?token=YOUR_TOKEN), 2) Sec-WebSocket-Protocol header (browser: new WebSocket(url, ["token", "YOUR_TOKEN"])), or 3) Authorization header (Bearer YOUR_TOKEN)',
                },
                401
              );
            }

            if (!this.isAuthToken(token)) {
              return c.json({ error: "Invalid authentication token" }, 403);
            }

            // If token came from Sec-WebSocket-Protocol, we need to respond with the protocol
            // This is required by the WebSocket spec for subprotocol negotiation
            if (protocolToken) {
              c.header("Sec-WebSocket-Protocol", "token");
            }
          }

          return next();
        },
        this.upgradeWebSocket(() => ({
        onOpen: async (_evt: any, ws: HonoWSContext) => {
          // Telemetry: Track WebSocket connection
          await this.recordWebSocketEvent("ws.connection.open", {
            "ws.client_count": this.socketCount() + 1,
          });

          // A socket receives nothing until it subscribes to a checkout.
          this.central.sockets.set(ws, new Map());
          this.lastActivityAt = Date.now();

          // Send connected message per spec
          ws.send(
            JSON.stringify({
              type: "connected",
              version: "0.1.0",
              timestamp: new Date().toISOString(),
            })
          );

          if (process.env.VERBOSE) {
            console.log(`[WebSocket] Client connected (total: ${this.socketCount()})`);
          }
        },

        onClose: async (_evt: any, ws: HonoWSContext) => {
          // Telemetry: Track WebSocket disconnection
          await this.recordWebSocketEvent("ws.connection.close", {
            "ws.client_count": this.socketCount() - 1,
          });

          this.dropSocket(ws);
          this.lastActivityAt = Date.now();
          if (process.env.VERBOSE) {
            console.log(`[WebSocket] Client disconnected (total: ${this.socketCount()})`);
          }
        },

        onMessage: async (message: any, ws: HonoWSContext) => {
          const messageStartTime = Date.now();
          let messageType = "unknown";

          try {
            // Extract the actual message data
            // In Hono's WebSocket helper, message is a MessageEvent with a data property
            const rawData = (message as any).data ?? message;

            // Handle different message types (string, Buffer, ArrayBuffer)
            let msgStr: string;
            if (typeof rawData === "string") {
              msgStr = rawData;
            } else if (rawData instanceof Buffer || rawData instanceof Uint8Array) {
              msgStr = new TextDecoder().decode(rawData);
            } else {
              msgStr = String(rawData);
            }
            const rawMessage = JSON.parse(msgStr);

            // Runtime validation of WebSocket message format
            const validationResult = WSMessageSchema.safeParse(rawMessage);
            if (!validationResult.success) {
              const errorMsg = validationResult.error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join('; ');
              // Always log validation errors for production debugging
              console.error("Invalid WebSocket message format:", errorMsg);
              ws.send(JSON.stringify({ error: "Invalid message format", details: errorMsg }));
              return;
            }

            const data = validationResult.data as WSMessage;

            // Type-safe discriminated union handling
            if ('jsonrpc' in data && data.jsonrpc === '2.0') {
              // Check if it's a request (has method) or response (has result/error)
              if ('method' in data && typeof data.method === 'string') {
                messageType = (data as JSONRPCRequest).method;
              } else {
                messageType = (data as JSONRPCResponse).id?.toString() || "jsonrpc-response";
              }
            } else if ('type' in data) {
              messageType = (data as SimpleWSMessage).type;
            } else if ('action' in data) {
              messageType = `feed.${data.action}`;
            } else {
              messageType = "unknown";
            }

            // Telemetry: Track message processing
            await this.recordWebSocketEvent("ws.message.received", {
              "ws.message.type": messageType,
              "ws.message.size_bytes": msgStr.length,
            });

            // A feed subscription, or a message handled in the checkout it is for.
            const checkout = await this.dispatchWSMessage(ws, data);

            // Telemetry: Track successful message processing
            const durationMs = Date.now() - messageStartTime;
            await this.recordWebSocketEvent("ws.message.processed", {
              "ws.message.type": messageType,
              "ws.message.duration_ms": durationMs,
              "ws.message.status": "success",
              ...(checkout ? { "dr.project": checkout.project, "dr.checkout": checkout.checkout } : {}),
            });
          } catch (error) {
            const errorMsg = getErrorMessage(error);
            const durationMs = Date.now() - messageStartTime;

            // Telemetry: Track message processing error
            await this.recordWebSocketEvent("ws.message.error", {
              "ws.message.type": messageType,
              "ws.message.duration_ms": durationMs,
              "ws.message.status": "error",
              "error.message": errorMsg,
            });

            // Always log message handling errors for operational visibility
            console.warn(
              `[WebSocket] Error handling ${messageType} message (${durationMs}ms): ${errorMsg}`
            );
            ws.send(
              JSON.stringify({
                type: "error",
                message: errorMsg,
              })
            );
          }
        },

        onError: async (error: any) => {
          const message = getErrorMessage(error);

          // Telemetry: Track WebSocket error
          await this.recordWebSocketEvent("ws.error", {
            "error.type": error instanceof Error ? error.constructor.name : "unknown",
            "error.message": message,
          });

          // Always log WebSocket errors with full context including stack trace for debugging
          console.error("[WebSocket] Error:", error);
        },
      }))
      );
    }
  }

  /**
   * Documents the routes outside the project and checkout scope that are not OpenAPI routes of
   * their own (the websocket, MCP and the docs), so the document lists every route the server
   * answers. Their handlers are registered elsewhere.
   */
  private registerUnscopedRouteDocs(): void {
    const registry = this.app.openAPIRegistry;
    // A websocket frame, not a route body: registered so clients generate its type (issue 1361).
    registry.register("ChangesetCommitProgress", ChangesetCommitProgressSchema);
    const unauthorized = { description: "No token, or a wrong one" };
    registry.registerPath({
      method: "get",
      path: "/ws",
      tags: ["WebSocket"],
      summary: "Open the websocket",
      description:
        "Upgrades to a websocket (one per browser tab). The token comes as ?token=, as the " +
        "Sec-WebSocket-Protocol pair [\"token\", <token>], or as Authorization: Bearer. A socket receives " +
        "nothing until it subscribes to a checkout: {action: \"subscribe\", project, checkout}. Every event " +
        "carries the project and checkout it is about. The frames are in cli/docs/VISUALIZATION_SERVER_PROTOCOL.md; " +
        "changeset.commit.progress is the ChangesetCommitProgress schema.",
      responses: {
        101: { description: "Switching to the websocket protocol" },
        401: unauthorized,
        403: { description: "The token is wrong" },
      },
    });
    for (const method of ["post", "get", "delete"] as const) {
      registry.registerPath({
        method,
        path: "/mcp",
        tags: ["MCP"],
        summary: "MCP (streamable HTTP)",
        description:
          "The MCP interface for every project of the farm (streamable HTTP: POST a JSON-RPC message, GET the " +
          "session's event stream, DELETE to end the session). The token comes as Authorization: Bearer only.",
        security: [{ bearerAuth: [] }],
        responses: {
          200: { description: "The MCP response" },
          401: unauthorized,
        },
      });
    }
    registry.registerPath({
      method: "get",
      path: "/api-spec.yaml",
      tags: ["Docs"],
      summary: "This OpenAPI document",
      responses: { 200: { description: "The OpenAPI document" } },
    });
    registry.registerPath({
      method: "get",
      path: "/api-docs",
      tags: ["Docs"],
      summary: "Interactive API documentation (Swagger UI)",
      responses: { 200: { description: "The Swagger UI page" } },
    });
  }

  /**
   * Get OpenAPI specification document
   * Provides a stable public API for OpenAPI spec generation.
   *
   * BEHAVIOR: Returns an OpenAPI spec with the version specified in `config.openapi`.
   * The returned document will have whatever OpenAPI version was passed in the config.
   *
   * NOTE: Hono's getOpenAPI31Document() passes the config directly through and
   * uses the specified version in the output. There is no forced version conversion.
   */
  public getOpenAPIDocument(config: {
    openapi: string;
    info: {
      title: string;
      version: string;
      description?: string;
      contact?: { name?: string; url?: string };
      license?: { name: string };
    };
    servers?: Array<{ url: string; description?: string }>;
  }): any {
    return this.app.getOpenAPI31Document(config);
  }

  /**
   * Serialize model to graph format for client consumption.
   *
   * Returns { nodes, links } where:
   * - nodes: flat array of all elements across all layers
   * - links: intra-layer relationships (carry layer_id) and cross-layer
   *   references (carry source_layer_id + target_layer_id)
   *
   * Links are deduplicated: if the same relationship appears on multiple
   * elements (e.g. stored on both source and target), only one entry is kept.
   */
  private async serializeModel(): Promise<any> {
    const nodes: any[] = [];
    const linksMap = new Map<string, any>();

    // Build element-id → layer_id lookup so cross-layer reference links can
    // carry accurate source_layer_id / target_layer_id even when the
    // referenced element lives in a different layer.
    const elementLayerMap = new Map<string, string>();
    for (const [layerName, layer] of this.model.layers) {
      for (const e of layer.listElements()) {
        const layerId = e.layer_id || layerName;
        if (e.id) elementLayerMap.set(e.id, layerId);
        // Also index by path so references that use dot-separated slugs resolve correctly.
        // For new-format elements: e.id is a UUID, e.path is the dot-separated slug.
        // For old-format elements: e.id === e.path (both the slug), so no duplicate work.
        if (e.path && e.path !== e.id) elementLayerMap.set(e.path, layerId);
      }
    }

    for (const [layerName, layer] of this.model.layers) {
      for (const e of layer.listElements()) {
        const layerId = e.layer_id || layerName;

        // Resolve a viewer-compatible spec_node_id so every element renders
        // correctly in the v0.3.0 viewer regardless of which layer it belongs to.
        const viewerSpecNodeId = this.resolveViewerSpecNodeId(e.id, layerId, e.type, e.spec_node_id);

        // Node — all model fields for complete client-side access
        const node: any = {
          id: e.id,
          spec_node_id: viewerSpecNodeId,
          type: e.type,
          layer_id: layerId,
          name: e.name,
        };
        if (e.description) node.description = e.description;
        if (e.attributes && Object.keys(e.attributes).length > 0) node.attributes = e.attributes;
        if (e.source_reference) node.source_reference = e.source_reference;
        if (e.metadata) node.metadata = e.metadata;

        nodes.push(node);

        // Intra-layer links from relationships
        for (const rel of e.relationships) {
          const linkId = `rel:${rel.source}:${rel.target}:${rel.predicate}`;
          if (!linksMap.has(linkId)) {
            linksMap.set(linkId, {
              id: linkId,
              source: rel.source,
              target: rel.target,
              type: rel.predicate,
              layer_id: layerId,
            });
          }
        }

        // Cross-layer links from references
        for (const ref of e.references) {
          const linkId = `ref:${ref.source}:${ref.target}:${ref.type}`;
          if (!linksMap.has(linkId)) {
            linksMap.set(linkId, {
              id: linkId,
              source: ref.source,
              target: ref.target,
              type: ref.type,
              source_layer_id: elementLayerMap.get(ref.source) || layerId,
              target_layer_id: elementLayerMap.get(ref.target) || 'unknown',
            });
          }
        }
      }
    }

    // Central relationships.yaml links (added via `dr relationship add`)
    // These are NOT attached to individual elements, so the per-element loop
    // above misses them entirely. Emit them here using the same linksMap so
    // duplicates are naturally de-duplicated.
    for (const rel of this.model.relationships.getAll()) {
      const linkId = `rel:${rel.source}:${rel.target}:${rel.predicate}`;
      if (!linksMap.has(linkId)) {
        const layerId = rel.layer || elementLayerMap.get(rel.source);
        if (!layerId) continue; // Skip — source element not found and no layer field set
        const link: any = {
          id: linkId,
          source: rel.source,
          target: rel.target,
          type: rel.predicate,
        };
        // Cross-layer relationships set targetLayer; intra-layer relationships do not.
        // Both paths are reachable through normal CLI usage via `dr relationship add`.
        if (rel.targetLayer) {
          link.source_layer_id = layerId;
          link.target_layer_id = rel.targetLayer;
        } else {
          link.layer_id = layerId;
        }
        linksMap.set(linkId, link);
      }
    }

    return {
      nodes,
      links: Array.from(linksMap.values()),
    };
  }

  /**
   * Resolve viewer spec node ID with fallback logic
   * Handles multiple resolution strategies:
   * 1. Valid pass-through: Return specNodeId if it's already a valid spec node ID
   * 2. Dot-format extraction: Extract type from elementId in "layer.type.name" format and construct candidate
   * 3. Hyphen-format extraction: Extract type from elementId in "layer-type-name" format and construct candidate
   * 4. Type-parameter fallback: If extracted type differs from type parameter, retry with type parameter
   * 5. Layer-specific fallback: Use LAYER_FALLBACK map for layers with limited viewer support
   *
   * @param elementId - The element ID (can be in dot-format or hyphen-format)
   * @param layer - The layer name (canonical form)
   * @param type - The element type field
   * @param specNodeId - The spec node ID if already known
   * @returns The resolved spec node ID string
   */
  private resolveViewerSpecNodeId(
    elementId: string,
    layer: string,
    type: string,
    specNodeId: string
  ): string {
    // Strategy 1: Valid pass-through - return if specNodeId is valid (anywhere in the model)
    if (specNodeId && VisualizationServer.ALL_VALID_IDS.has(specNodeId)) {
      return specNodeId;
    }

    // Strategy 2 & 3: Extract type from elementId and construct candidate
    // Only extract if elementId is not empty
    let extractedType: string | null = null;

    if (elementId) {
      // Try dot-format extraction first (layer.type.name)
      if (elementId.includes(".")) {
        const parts = elementId.split(".");
        if (parts.length >= 2) {
          extractedType = parts[1]; // Second segment is the type
        }
      }

      // If no dot-format extraction, try hyphen-format (layer-type-name)
      if (!extractedType && elementId.includes("-")) {
        // For multi-word layers like "data-model" or "data-store", handle specially
        if (layer === "data-model" || layer === "data-store") {
          // These layers have hyphens in their names
          // For "data-model-entity-users", we need to extract after "data-model-"
          const expectedPrefix = layer + "-";
          if (elementId.startsWith(expectedPrefix)) {
            const afterPrefix = elementId.substring(expectedPrefix.length);
            const parts = afterPrefix.split("-");
            if (parts.length >= 1) {
              extractedType = parts[0]; // First segment after layer prefix is the type
            }
          }
        } else {
          // For single-word layers, split by hyphen and take second part
          const parts = elementId.split("-");
          if (parts.length >= 2) {
            // Second segment is the type (first is layer)
            extractedType = parts[1];
          }
        }
      }
    }

    // If we extracted a type, try to construct a valid candidate
    if (extractedType) {
      const candidate = `${layer}.${extractedType}`;
      const layerIds = VisualizationServer.VALID_SPEC_NODE_IDS[layer] || [];
      if (layerIds.includes(candidate)) {
        return candidate;
      }
    }

    // Strategy 4: If type param was provided, try with provided type
    // This applies when:
    // - extractedType is null (e.g., unparseable elementId) but type is valid
    // - extractedType differs from type (prefer extracted over provided)
    if (type && (!extractedType || extractedType !== type)) {
      const candidate = `${layer}.${type}`;
      const layerIds = VisualizationServer.VALID_SPEC_NODE_IDS[layer] || [];
      if (layerIds.includes(candidate)) {
        return candidate;
      }
    }

    // Strategy 5: Fall back to layer-specific fallback
    if (layer in VisualizationServer.LAYER_FALLBACK) {
      return VisualizationServer.LAYER_FALLBACK[layer];
    }

    // Default fallback for unknown layers
    return "data-store.database";
  }

  /**
   * Broadcast message to all connected WebSocket clients
   */
  private async broadcastMessage(message: any): Promise<void> {
    const messageStr = JSON.stringify(this.stamp(message));
    const messageType = message.type || "unknown";

    // Telemetry: Track broadcast start
    await this.recordWebSocketEvent("ws.broadcast.start", {
      "ws.broadcast.type": messageType,
      "ws.broadcast.client_count": this.clients.size,
      "ws.broadcast.message_size_bytes": messageStr.length,
    });

    let failureCount = 0;
    const failedClients: CheckoutSubscriber[] = [];

    for (const client of this.clients) {
      try {
        client.send(messageStr);
      } catch (error) {
        failureCount++;
        failedClients.push(client);
        const msg = getErrorMessage(error);
        // Always log broadcast failures for operational visibility in production
        console.warn(`[WebSocket] Failed to send message to client: ${msg}`);
      }
    }

    // Remove dead clients from the active client set
    for (const client of failedClients) {
      this.clients.delete(client);
    }

    // Telemetry: Track broadcast completion
    await this.recordWebSocketEvent("ws.broadcast.complete", {
      "ws.broadcast.type": messageType,
      "ws.broadcast.success_count": this.clients.size - failureCount,
      "ws.broadcast.failure_count": failureCount,
    });

    // Always warn about significant broadcast failures (>10% failure rate)
    if (failureCount > 0) {
      const failureRate = this.clients.size > 0 ? (failureCount / this.clients.size) * 100 : 0;
      if (failureRate >= 10 || failureCount > 5) {
        console.warn(
          `[WebSocket] Broadcast completed with ${failureCount}/${this.clients.size} client failures (${failureRate.toFixed(1)}% failure rate)`
        );
      }
    }
  }

  /**
   * Record WebSocket telemetry event
   * Creates spans for WebSocket operations when telemetry is enabled
   */
  private async recordWebSocketEvent(
    eventName: string,
    attributes: Record<string, any>
  ): Promise<void> {
    // Check if telemetry is enabled (compile-time constant set by esbuild)
    // @ts-ignore - TELEMETRY_ENABLED is a global constant defined at build time
    const isTelemetryEnabled = typeof TELEMETRY_ENABLED !== "undefined" ? TELEMETRY_ENABLED : false;

    if (!isTelemetryEnabled) {
      return;
    }

    try {
      // Dynamic import for tree-shaking
      const { startSpan, endSpan } = await import("../telemetry/index.js");

      // Create span for WebSocket event
      const span = startSpan(eventName, attributes);

      // End span immediately (WebSocket events are typically instantaneous)
      endSpan(span);
    } catch (error) {
      // Log telemetry failures to enable production debugging
      // Always log errors (not just in DEBUG) to catch silent failures
      console.warn(`[Telemetry] Failed to record WebSocket event: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Find an element across all layers
   */
  private async findElement(id: string): Promise<Element | null> {
    for (const layer of this.model.layers.values()) {
      const element = layer.getElement(id);
      if (element) return element;
    }
    return null;
  }

  /**
   * Whether an element can be annotated: it is in the model, or a changeset that is still open
   * (staged, not committed or discarded) adds it. A reviewer comments mostly on what the plan
   * adds, so those count too.
   */
  private async elementExists(id: string): Promise<boolean> {
    if (await this.findElement(id)) return true;
    // Changesets are written by other processes (the CLI, the MCP tools): read them fresh.
    await this.loadChangesetsFromDisk();
    for (const changeset of this.context.changesets.values()) {
      if (changeset.status !== "staged") continue;
      if (changeset.changes.some((change) => change.type === "add" && change.elementId === id)) return true;
    }
    return false;
  }

  /**
   * Handle WebSocket messages
   */
  private async handleWSMessage(ws: HonoWSContext, data: WSMessage): Promise<void> {
    const simpleMsg = data as SimpleWSMessage;
    switch (simpleMsg.type) {
      case "subscribe":
        // Send subscribed confirmation
        const topics = simpleMsg.topics || ["model", "annotations"];
        ws.send(
          JSON.stringify({
            type: "subscribed",
            topics,
            timestamp: new Date().toISOString(),
          })
        );

        // Send initial model state
        const modelData = await this.serializeModel();
        ws.send(
          JSON.stringify({
            type: "model",
            data: modelData,
            timestamp: new Date().toISOString(),
          })
        );
        break;

      case "ping":
        // Respond with pong
        ws.send(
          JSON.stringify({
            type: "pong",
            timestamp: new Date().toISOString(),
          })
        );
        break;

      case "annotate":
        if (simpleMsg.annotation) {
          await this.broadcastMessage({
            type: "annotation",
            data: simpleMsg.annotation,
          });
        }
        break;

      default:
        ws.send(
          JSON.stringify({
            type: "error",
            message: `Unknown message type: ${simpleMsg.type}`,
          })
        );
    }
  }

  /**
   * Handle JSON-RPC 2.0 messages for chat functionality
   */
  private async handleJSONRPCMessage(ws: HonoWSContext, data: WSMessage): Promise<void> {
    // Only requests have a method; responses have result/error
    if (!('method' in data)) {
      // This is a response, not something we handle in this function
      // Log unexpected protocol patterns for operational visibility
      const responseType = ('result' in data) ? 'success' : ('error' in data) ? 'error' : 'unknown';
      const msgId = ('id' in data) ? data.id : 'unknown';
      console.warn(
        `[WebSocket] Received JSON-RPC ${responseType} response from client (ID: ${msgId}), ignoring`
      );
      return;
    }
    const rpcMsg = data as JSONRPCRequest;
    const { method, params, id } = rpcMsg;

    // Helper to send JSON-RPC response
    const sendResponse = (result: any) => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          result,
          id,
        })
      );
    };

    // Helper to send JSON-RPC error
    const sendError = (code: number, message: string, data?: any) => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code, message, data },
          id,
        })
      );
    };

    try {
      switch (method) {
        case "chat.status":
          // Check if any chat client is available
          const hasClient = this.drBot.chatClient !== undefined;

          // Determine error message: initialization error takes precedence
          let statusError: string | null = null;
          if (this.chatInitializationError) {
            statusError = `Chat initialization failed: ${this.chatInitializationError.message}`;
          } else if (!hasClient) {
            statusError = "No chat client available. Install Claude Code or GitHub Copilot.";
          }

          sendResponse({
            sdk_available: hasClient,
            sdk_version: hasClient ? this.drBot.chatClient!.getClientName() : null,
            error_message: statusError,
            // What the chat agent may do, fixed when the viewer started (#1241).
            permission_mode: this.drBot.chatPermissionMode(),
          });
          break;

        case "chat.send":
          // Validate params
          if (!params || typeof params !== 'object' || !('message' in params) || typeof (params as any).message !== 'string' || (params as any).message.trim() === '') {
            sendError(JSONRPC_ERRORS.INVALID_PARAMS, "Message cannot be empty");
            return;
          }

          // Check if chat client is available
          if (!this.drBot.chatClient) {
            sendError(
              JSONRPC_ERRORS.NO_CLIENT_AVAILABLE,
              "No chat client available. Install Claude Code or GitHub Copilot to enable chat."
            );
            return;
          }

          // The viewer's conversation id ties sends together: Claude Code resumes the same
          // session for each send that carries it. Without one, every send is a fresh session.
          const clientConversationId = (params as any).conversation_id;
          if (
            clientConversationId !== undefined &&
            (typeof clientConversationId !== "string" ||
              clientConversationId.trim() === "" ||
              clientConversationId.length > 200)
          ) {
            sendError(
              JSONRPC_ERRORS.INVALID_PARAMS,
              "conversation_id must be a non-empty string of at most 200 characters"
            );
            return;
          }
          const conversationId: string =
            clientConversationId ?? `conv-${++this.chatConversationCounter}-${Date.now()}`;

          // The launcher runs the turn in this checkout, or queues it at the cap, or refuses a
          // send to a conversation whose reply is still running.
          const started = await this.drBot.startTurn({
            context: this.context,
            channel: ws,
            conversationId,
            message: (params as any).message,
            requestId: id,
            resumable: clientConversationId !== undefined,
          });
          if (started.status === "refused") {
            sendError(started.code, started.message);
            return;
          }
          break;

        case "chat.cancel":
          // Cancel the named conversation's reply, or else the first active one
          sendResponse(this.drBot.cancel(this.context, (params as any)?.conversation_id));
          break;

        default:
          sendError(JSONRPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${method}`);
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      sendError(JSONRPC_ERRORS.INTERNAL_ERROR, "Internal error", errorMsg);
    }
  }

  /**
   * Watch the model and the changesets for changes made outside the server (the CLI, DrBot).
   * A model change reloads and broadcasts `model.updated`. A changeset change, including the
   * active-changeset marker in `.dr/`, broadcasts a debounced `changesets.updated`. An annotation change (the
   * MCP annotation_* tools write the same files) broadcasts what changed, debounced.
   */
  private setupFileWatcher(): void {
    // The watcher's events run in the context of the checkout it watches.
    const context = this.context;
    context.watch({
      onModelChanged: () =>
        this.inContext(context, async () => {
          await this.reloadAndBroadcast();
          // A base change moves the staged changesets' drift, which clients read from GET /api/changesets.
          this.scheduleChangesetsBroadcast();
        }),
      onChangesetsChanged: () => this.inContext(context, () => this.scheduleChangesetsBroadcast()),
      onAnnotationsChanged: () => this.inContext(context, () => this.scheduleAnnotationsSync()),
    });
  }

  /** Broadcasts `changesets.updated` once the changeset files have been quiet for a moment. */
  private scheduleChangesetsBroadcast(): void {
    this.context.debounce("changesets", this.changesetsDebounceMs, () => {
      this.broadcastChangesetsUpdated().catch((error) => {
        console.error(`[Watcher] Failed to broadcast changesets: ${getErrorMessage(error)}`);
      });
    });
  }

  /**
   * Sends `changeset.commit.progress` to the subscribers of the checkout a commit in flight is
   * landing in, and to no other checkout's (issue 1361). A report for a checkout this server has
   * not loaded has no subscribers to reach and is dropped.
   *
   * Sent synchronously (no telemetry await, unlike broadcastMessage): a report is on every socket
   * when the reporter returns, so the commit's final report goes out before its HTTP response.
   */
  private broadcastCommitProgress(progress: PublishedCommitProgress): void {
    const { rootPath, ...payload } = progress;
    for (const ref of this.central.pool.loaded()) {
      const context = this.central.pool.peek(ref);
      if (!context || !sameRootPath(context.rootPath, rootPath)) continue;
      if (context.subscribers.size === 0) continue;
      const message = JSON.stringify(
        this.inContext(context, () =>
          this.stamp({ type: "changeset.commit.progress", ...payload, timestamp: new Date().toISOString() })
        )
      );
      for (const subscriber of [...context.subscribers]) {
        try {
          subscriber.send(message);
        } catch (error) {
          context.subscribers.delete(subscriber);
          console.warn(`[WebSocket] Failed to send commit progress to a client: ${getErrorMessage(error)}`);
        }
      }
    }
  }

  /**
   * Reload the changesets from disk and send every client `changesets.updated` with their ids
   * and the active one. Clients fetch `GET /api/changesets` for the details.
   */
  private async broadcastChangesetsUpdated(): Promise<void> {
    await this.loadChangesetsFromDisk();
    let active: string | null = null;
    try {
      active = await new StagingAreaManager(this.context.rootPath).getActiveId();
    } catch (error) {
      console.warn(`[Changesets] Could not read the active changeset: ${getErrorMessage(error)}`);
    }
    await this.broadcastMessage({
      type: "changesets.updated",
      ids: [...this.context.changesets.keys()],
      active,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Load all JSON schemas from bundled directory (recursive)
   * Loads schemas from all subdirectories: base/, nodes/, relationships/, etc.
   */
  private async loadSchemas(): Promise<Record<string, any>> {
    const schemasPath = new URL("../schemas/bundled/", import.meta.url).pathname;
    const schemas: Record<string, any> = {};

    try {
      const fs = await import("fs/promises");
      const path = await import("path");

      // Recursive function to walk through directories
      const walkDirectory = async (dir: string, prefix: string = ""): Promise<void> => {
        const entries = await fs.readdir(dir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const schemaKey = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            // Recursively walk subdirectories
            await walkDirectory(fullPath, schemaKey);
          } else if (entry.isFile() && (entry.name.endsWith(".schema.json") || entry.name.endsWith(".json"))) {
            // Load JSON schema files
            const content = await fs.readFile(fullPath, "utf-8");
            try {
              schemas[schemaKey] = JSON.parse(content);
            } catch (parseError) {
              const parseErrorMsg = parseError instanceof Error ? parseError.message : String(parseError);
              throw new Error(`Invalid JSON in schema file ${fullPath}: ${parseErrorMsg}`);
            }
          }
        }
      };

      await walkDirectory(schemasPath);

      return schemas;
    } catch (error) {
      const errorMsg = getErrorMessage(error);
      console.error("Failed to load schemas:", error);
      throw new Error(`Failed to load schema files: ${errorMsg}`);
    }
  }

  /**
   * Get viewer HTML
   */
  private getViewerHTML(): string {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Documentation Robotics Viewer</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background: #f5f5f5;
      color: #333;
    }

    header {
      background: white;
      border-bottom: 1px solid #e0e0e0;
      padding: 20px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }

    .header-content {
      max-width: 1400px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    h1 {
      font-size: 24px;
      font-weight: 600;
    }

    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .status-badge.connected {
      background: #4caf50;
      color: white;
    }

    .status-badge.disconnected {
      background: #f44336;
      color: white;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
    }

    .content {
      display: grid;
      grid-template-columns: 300px 1fr;
      gap: 20px;
      height: calc(100vh - 100px);
    }

    .sidebar {
      background: white;
      border-radius: 4px;
      overflow-y: auto;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 16px;
    }

    .main-panel {
      background: white;
      border-radius: 4px;
      overflow-y: auto;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      padding: 20px;
    }

    .layer-group {
      margin-bottom: 16px;
    }

    .layer-header {
      font-weight: 600;
      padding: 8px 0;
      border-bottom: 2px solid #e0e0e0;
      margin-bottom: 8px;
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
    }

    .layer-header:hover {
      color: #2196F3;
    }

    .layer-header::before {
      content: '▶';
      margin-right: 8px;
      display: inline-block;
      transition: transform 0.2s;
    }

    .layer-header.expanded::before {
      transform: rotate(90deg);
    }

    .layer-elements {
      margin-left: 16px;
      display: none;
    }

    .layer-elements.expanded {
      display: block;
    }

    .element-item {
      padding: 8px;
      margin-bottom: 4px;
      background: #f9f9f9;
      border-left: 3px solid #e0e0e0;
      cursor: pointer;
      border-radius: 2px;
      transition: all 0.2s;
      font-size: 13px;
    }

    .element-item:hover {
      background: #f0f0f0;
      border-left-color: #2196F3;
    }

    .element-item.selected {
      background: #e3f2fd;
      border-left-color: #2196F3;
      font-weight: 500;
    }

    .element-details {
      min-height: 300px;
    }

    .detail-header {
      border-bottom: 2px solid #e0e0e0;
      padding-bottom: 12px;
      margin-bottom: 16px;
    }

    .detail-header h2 {
      font-size: 18px;
      margin-bottom: 4px;
    }

    .detail-header .element-type {
      font-size: 12px;
      color: #999;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .detail-section {
      margin-bottom: 16px;
    }

    .detail-section h3 {
      font-size: 13px;
      font-weight: 600;
      text-transform: uppercase;
      color: #999;
      margin-bottom: 8px;
      letter-spacing: 0.5px;
    }

    .detail-value {
      font-size: 14px;
      line-height: 1.6;
      color: #333;
      word-break: break-word;
    }

    .annotations-list {
      max-height: 200px;
      overflow-y: auto;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      padding: 8px;
    }

    .annotation-item {
      padding: 8px;
      margin-bottom: 8px;
      background: #fffde7;
      border-left: 3px solid #fbc02d;
      border-radius: 2px;
      font-size: 12px;
    }

    .annotation-item .author {
      font-weight: 600;
      color: #666;
    }

    .annotation-item .text {
      margin: 4px 0 0 0;
      color: #333;
    }

    .annotation-item .timestamp {
      font-size: 11px;
      color: #999;
      margin-top: 4px;
    }

    .annotation-form {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .annotation-form input,
    .annotation-form textarea {
      padding: 8px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      font-family: inherit;
      font-size: 12px;
    }

    .annotation-form textarea {
      resize: vertical;
      min-height: 60px;
    }

    .annotation-form button {
      padding: 8px 12px;
      background: #2196F3;
      color: white;
      border: none;
      border-radius: 4px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }

    .annotation-form button:hover {
      background: #1976D2;
    }

    .loading {
      text-align: center;
      padding: 40px;
      color: #999;
    }

    .loading::after {
      content: '';
      display: inline-block;
      width: 16px;
      height: 16px;
      border: 2px solid #f3f3f3;
      border-top: 2px solid #2196F3;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin-left: 8px;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .stats {
      font-size: 12px;
      color: #999;
      margin-bottom: 16px;
      padding-bottom: 12px;
      border-bottom: 1px solid #e0e0e0;
    }
  </style>
</head>
<body>
  <header>
    <div class="header-content">
      <div>
        <h1>📚 Documentation Robotics Viewer</h1>
      </div>
      <div class="status-badge connected" id="status">● Connected</div>
    </div>
  </header>

  <div class="container">
    <div class="content">
      <div class="sidebar">
        <div class="stats" id="stats">Loading...</div>
        <div id="model-tree">
          <div class="loading">Loading model...</div>
        </div>
      </div>

      <div class="main-panel">
        <div id="element-details">
          <div class="loading">Select an element to view details</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentModel = null;
    let selectedElementId = null;

    const statusEl = document.getElementById('status');
    const modelTreeEl = document.getElementById('model-tree');
    const detailsEl = document.getElementById('element-details');
    const statsEl = document.getElementById('stats');

    /**
     * Escape HTML special characters to prevent XSS
     * @param {string} text - Text to escape
     * @returns {string} HTML-escaped text
     */
    function escapeHtml(text) {
      if (!text) return '';
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    // Extract token from URL query parameters if present
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    // Log token status for debugging
    if (!token) {
      console.warn('[WebSocket] No authentication token found in URL. If authentication is enabled, connection will fail.');
      console.warn('[WebSocket] Expected URL format: http://localhost:PORT?token=YOUR_TOKEN');
    } else {
      console.log('[WebSocket] Found authentication token in URL');
    }

    // Build WebSocket URL with token if available
    let wsUrl = \`ws://\${window.location.host}/ws\`;
    if (token) {
      wsUrl += \`?token=\${encodeURIComponent(token)}\`;
    }

    console.log('[WebSocket] Connecting to:', wsUrl.replace(/token=[^&]+/, 'token=***'));

    const ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
      console.log('WebSocket connected');
      updateStatus(true);
      ws.send(JSON.stringify({ type: 'subscribe' }));
    });

    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === 'model' || message.type === 'model-update') {
          currentModel = message.data;
          renderModel();
        } else if (message.type === 'annotation') {
          // Update annotations for the element
          renderSelectedElement();
        } else if (message.type === 'error') {
          console.error('WebSocket error:', message.message);
        }
      } catch (error) {
        console.error('Failed to parse message:', error);
      }
    });

    ws.addEventListener('close', (event) => {
      console.log('WebSocket disconnected', event.code, event.reason);
      updateStatus(false);

      // If closed immediately with auth error codes, show helpful message
      if (!token && (event.code === 1002 || event.code === 1008 || event.code === 1006)) {
        showAuthError();
      }
    });

    ws.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      updateStatus(false);

      // If we don't have a token, likely an auth issue
      if (!token) {
        showAuthError();
      }
    });

    function showAuthError() {
      const errorDiv = document.createElement('div');
      errorDiv.style.cssText = 'position: fixed; top: 80px; left: 50%; transform: translateX(-50%); background: #f44336; color: white; padding: 16px 24px; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 10000; max-width: 500px; text-align: center;';
      errorDiv.innerHTML = \`
        <strong>⚠️ Authentication Required</strong><br>
        <span style="font-size: 14px; margin-top: 8px; display: inline-block;">
          Please use the full URL with authentication token from the terminal.
        </span>
      \`;
      document.body.appendChild(errorDiv);

      // Auto-dismiss after 10 seconds
      setTimeout(() => {
        errorDiv.style.transition = 'opacity 0.5s';
        errorDiv.style.opacity = '0';
        setTimeout(() => errorDiv.remove(), 500);
      }, 10000);
    }

    function updateStatus(connected) {
      if (connected) {
        statusEl.className = 'status-badge connected';
        statusEl.textContent = '● Connected';
      } else {
        statusEl.className = 'status-badge disconnected';
        statusEl.textContent = '● Disconnected';
      }
    }

    function renderModel() {
      if (!currentModel) return;

      // Update stats
      const layerCount = Object.keys(currentModel.layers).length;
      const elementCount = currentModel.totalElements || 0;
      statsEl.textContent = \`\${layerCount} layers · \${elementCount} elements\`;

      // Render layers and elements
      modelTreeEl.innerHTML = '';
      const layers = Object.entries(currentModel.layers)
        .sort((a, b) => a[0].localeCompare(b[0]));

      for (const [layerName, layerData] of layers) {
        const layerDiv = document.createElement('div');
        layerDiv.className = 'layer-group';

        const headerDiv = document.createElement('div');
        headerDiv.className = 'layer-header';
        headerDiv.textContent = layerName;
        headerDiv.addEventListener('click', () => {
          headerDiv.classList.toggle('expanded');
          elementsDiv.classList.toggle('expanded');
        });

        const elementsDiv = document.createElement('div');
        elementsDiv.className = 'layer-elements';

        for (const element of layerData.elements) {
          const elemDiv = document.createElement('div');
          elemDiv.className = 'element-item';
          const elementSlug = element.path || element.id;
          if (elementSlug === selectedElementId) {
            elemDiv.classList.add('selected');
          }
          elemDiv.innerHTML = \`\${escapeHtml(elementSlug)}<br><span style="font-size: 11px; color: #999;">\${escapeHtml(element.name)}</span>\`;
          elemDiv.addEventListener('click', () => {
            selectedElementId = elementSlug;
            document.querySelectorAll('.element-item').forEach(el => el.classList.remove('selected'));
            elemDiv.classList.add('selected');
            renderSelectedElement();
          });

          elementsDiv.appendChild(elemDiv);
        }

        layerDiv.appendChild(headerDiv);
        layerDiv.appendChild(elementsDiv);
        modelTreeEl.appendChild(layerDiv);
      }
    }

    function renderSelectedElement() {
      if (!selectedElementId || !currentModel) {
        detailsEl.innerHTML = '<div class="loading">Select an element to view details</div>';
        return;
      }

      // Find element in model
      let element = null;
      for (const layer of Object.values(currentModel.layers)) {
        element = layer.elements.find(e => (e.path || e.id) === selectedElementId);
        if (element) break;
      }

      if (!element) {
        detailsEl.innerHTML = '<div class="loading">Element not found</div>';
        return;
      }

      let html = \`
        <div class="detail-header">
          <div class="element-type">\${escapeHtml(element.type)}</div>
          <h2>\${escapeHtml(element.name)}</h2>
          <div style="font-size: 12px; color: #666; margin-top: 4px;"><code>\${escapeHtml(element.path || element.id)}</code></div>
        </div>
      \`;

      if (element.description) {
        html += \`
          <div class="detail-section">
            <h3>Description</h3>
            <div class="detail-value">\${escapeHtml(element.description)}</div>
          </div>
        \`;
      }

      if (element.properties && Object.keys(element.properties).length > 0) {
        html += \`
          <div class="detail-section">
            <h3>Properties</h3>
            <div class="detail-value"><pre>\${escapeHtml(JSON.stringify(element.properties, null, 2))}</pre></div>
          </div>
        \`;
      }

      if (element.annotations && element.annotations.length > 0) {
        html += \`
          <div class="detail-section">
            <h3>Annotations</h3>
            <div class="annotations-list">
              \${element.annotations.map(ann => \`
                <div class="annotation-item">
                  <div class="author">\${escapeHtml(ann.author)}</div>
                  <div class="text">\${escapeHtml(ann.text)}</div>
                  <div class="timestamp">\${new Date(ann.timestamp).toLocaleString()}</div>
                </div>
              \`).join('')}
            </div>
          </div>
        \`;
      }

      html += \`
        <div class="detail-section">
          <h3>Add Annotation</h3>
          <form class="annotation-form" onsubmit="addAnnotation(event, '\${escapeHtml(element.path || element.id)}')">
            <input type="text" placeholder="Author name" id="ann-author" required>
            <textarea placeholder="Annotation text" id="ann-text" required></textarea>
            <button type="submit">Add Annotation</button>
          </form>
          <div id="ann-error" style="margin-top: 8px; min-height: 1.2em;"></div>
        </div>
      \`;

      detailsEl.innerHTML = html;
    }

    function addAnnotation(event, elementId) {
      event.preventDefault();

      const author = document.getElementById('ann-author').value;
      const text = document.getElementById('ann-text').value;

      if (!author || !text) return;

      // Send to server using new annotation API
      fetch('/api/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ elementId, author, content: text })
      })
        .then(r => r.json().then(data => ({ ok: r.ok, data })))
        .then(({ ok, data }) => {
          if (ok && data && data.id) {
            document.getElementById('ann-author').value = '';
            document.getElementById('ann-text').value = '';
            const errorDiv = document.getElementById('ann-error');
            if (errorDiv) errorDiv.textContent = '';
          } else if (!ok) {
            const errorMsg = (data && data.error) ? data.error : 'Failed to create annotation';
            const errorDiv = document.getElementById('ann-error');
            if (errorDiv) {
              errorDiv.textContent = 'Error: ' + errorMsg;
              errorDiv.style.color = '#d32f2f';
              errorDiv.style.marginTop = '8px';
            }
          }
        })
        .catch(err => {
          const errorDiv = document.getElementById('ann-error');
          if (errorDiv) {
            errorDiv.textContent = 'Error: Failed to add annotation: ' + err.message;
            errorDiv.style.color = '#d32f2f';
            errorDiv.style.marginTop = '8px';
          }
        });
    }
  </script>
</body>
</html>`;
  }

  /**
   * Serve a file from the custom viewer path
   */
  private async serveCustomViewer(filePath: string): Promise<Response> {
    if (process.env.VERBOSE) console.log(`[VIEWER] serveCustomViewer called for: ${filePath}`);

    if (!this.viewerPath) {
      console.error(`[VIEWER] Custom viewer path not configured`);
      return new Response("Custom viewer path not configured", { status: 500 });
    }

    try {
      const path = await import("path");
      const fs = await import("fs/promises");

      // Resolve absolute path and prevent directory traversal
      const fullPath = path.resolve(this.viewerPath, filePath);
      if (process.env.VERBOSE) console.log(`[VIEWER] Resolved path: ${fullPath}`);

      // Security check: ensure the resolved path is within viewerPath
      if (!fullPath.startsWith(path.resolve(this.viewerPath))) {
        console.error(`[VIEWER] Security check failed - path outside viewer directory`);
        return new Response("Forbidden", { status: 403 });
      }

      // Read file
      if (process.env.VERBOSE) console.log(`[VIEWER] Reading file: ${fullPath}`);
      const content = await fs.readFile(fullPath);

      // Determine content type
      const ext = path.extname(fullPath).toLowerCase();
      const contentTypes: Record<string, string> = {
        ".html": "text/html",
        ".css": "text/css",
        ".js": "application/javascript",
        ".json": "application/json",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".ico": "image/x-icon",
        ".woff": "font/woff",
        ".woff2": "font/woff2",
        ".ttf": "font/ttf",
        ".eot": "application/vnd.ms-fontobject",
      };

      const contentType = contentTypes[ext] || "application/octet-stream";

      if (process.env.VERBOSE)
        console.log(`[VIEWER] Successfully read file, returning with Content-Type: ${contentType}`);
      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": contentType,
        },
      });
    } catch (error) {
      if ((error as any).code === "ENOENT") {
        console.error(`[VIEWER] File not found: ${filePath}`);
        return new Response("File not found", { status: 404 });
      }
      console.error(`[VIEWER] Error serving custom viewer file ${filePath}:`, error);
      return new Response("Internal server error", { status: 500 });
    }
  }

  /** The model as it is on disk now. */
  private loadModelFromDisk(): Promise<Model> {
    return this.context.loadModelFromDisk();
  }

  /**
   * Reload the model and changesets from disk and send the new model to every client.
   */
  private async reloadAndBroadcast(): Promise<void> {
    // A write of several files starts one reload per file event, and they overlap. A reload that
    // started earlier may have read the disk mid-write, so once a newer one is under way its result
    // is dropped: the newest reload, started after the last write, is the one that sets the model
    // (which the changesets' drift is read against) and broadcasts it.
    const generation = ++this.context.reloadGeneration;
    const model = await this.loadModelFromDisk();
    if (generation !== this.context.reloadGeneration) return;
    this.model = model;
    await this.loadChangesetsFromDisk();

    const modelData = await this.serializeModel();
    const message = JSON.stringify(
      this.stamp({
        type: "model.updated",
        data: modelData,
        timestamp: new Date().toISOString(),
      })
    );

    for (const client of this.clients) {
      try {
        client.send(message);
      } catch (error) {
        const msg = getErrorMessage(error);
        console.warn(`[Watcher] Failed to send update: ${msg}`);
      }
    }
  }

  /** Whether a request's token is the server's, compared in constant time. */
  private isAuthToken(provided: string): boolean {
    const given = Buffer.from(provided);
    const expected = Buffer.from(this.authToken);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  /**
   * Commit or discard a staged changeset for POST /api/changesets/:id/{commit,discard}.
   *
   * Works on a freshly loaded model rather than the server's in-memory copy, so a CLI
   * change since the last reload can't be overwritten. Afterwards the server reloads and
   * broadcasts `model.updated` and `changesets.updated` at once, rather than wait for the watcher.
   */
  private async runChangesetAction(
    c: any,
    changesetId: string,
    action: "commit" | "discard",
    review?: { drop: number[]; deleteBlockedLinks: number[] }
  ) {
    let model = await Model.load(this.context.rootPath, { lazyLoad: false });
    let manager = new StagingAreaManager(model.rootPath, model);

    const changeset = await manager.load(changesetId);
    if (!changeset) {
      return c.json({ error: "Changeset not found" }, 404);
    }
    if (changeset.status !== "staged") {
      return c.json({ error: `Changeset is already ${changeset.status}` }, 409);
    }
    if (action === "commit") {
      // A record (verification or upgrade) never lands (commit refuses it too); refused before any review drop.
      const refusal = await manager.landingRefusal(changeset);
      if (refusal) return c.json({ error: refusal.fullText }, 409);
    }

    // A commit with the reviewer's verdicts: leave the dropped changes (and what depends on them)
    // out, and refuse a delete that relationships still name unless the reviewer let them go too.
    let reviewResult: { dropped: number[]; linksDeleted: number } | undefined;
    let restoreOnFailure: { sequences: number[]; removedAt: number } | undefined;
    if (action === "commit" && review) {
      const prepared = await this.prepareReviewedCommit(model, changeset, review);
      if ("refusal" in prepared) {
        return c.json(prepared.refusal.body, prepared.refusal.status);
      }
      reviewResult = { dropped: prepared.dropped, linksDeleted: prepared.linksDeleted };
      if (prepared.dropped.length > 0) {
        // The dropped changes are unstaged first, so the changeset's record (its tombstones)
        // shows what was left out; commit then lands what is still staged.
        const removedAt = await manager.unstageSequences(changeset.id, prepared.dropped);
        if (removedAt !== undefined) restoreOnFailure = { sequences: prepared.dropped, removedAt };
      }
    }

    // The commit's progress, for the checkout's open viewers (issue 1361). Advisory: the response
    // below is unchanged, and a failure's last report says the phase it stopped in.
    const progress = action === "commit" ? createCommitProgressReporter(this.context.rootPath, changesetId) : undefined;

    let result: {
      committed?: number;
      skipped?: number;
      failed?: number;
      preExistingErrors?: number;
      deactivated?: boolean;
      deactivationError?: string;
      drift?: { message: string; overlapping?: ChangesetDrift["overlapping"] };
    } = {};
    try {
      if (restoreOnFailure) {
        // A fresh model without the dropped changes (inside the try, so a failure puts them back).
        model = await Model.load(this.context.rootPath, { lazyLoad: false });
        manager = new StagingAreaManager(model.rootPath, model);
      }
      if (action === "commit") {
        // Only errors the changeset introduces block; the base model's own are counted.
        const commit = await manager.commit(model, changesetId, {
          validate: true,
          ...(progress ? { onProgress: progress.onProgress } : {}),
        });
        result = {
          committed: commit.committed,
          skipped: commit.skipped ?? 0,
          failed: commit.failed,
          preExistingErrors: commit.validation.preExistingErrors ?? 0,
          deactivated: commit.deactivated,
          ...(commit.deactivationError ? { deactivationError: commit.deactivationError } : {}),
          // Drift never refuses the commit (#1200): the result says what the base overlapped.
          ...(commit.driftWarning ? { drift: landedOverDrift(commit.driftDetail) } : {}),
        };
      } else {
        await manager.discard(changesetId);
      }
    } catch (error) {
      progress?.fail();
      if (restoreOnFailure) await this.restoreDroppedChanges(changeset.id, restoreOnFailure);
      if (error instanceof RecordLandingError) {
        return c.json({ error: error.fullText }, 409);
      }
      const message = getErrorMessage(error);
      if (message.startsWith("Validation failed")) {
        return c.json({ error: message }, 422);
      }
      throw error;
    }

    // commit deactivates the changeset itself and reports a failure in the result; retrying here
    // would throw after the changes landed. discard clears the marker itself; this is a safety net.
    if (action === "discard" && (await manager.getActiveId()) === changesetId) {
      await manager.clearActive();
    }

    progress?.phase("reloading");
    try {
      await this.reloadAndBroadcast();
    } catch (error) {
      console.error(`[Changesets] Reload after ${action} failed: ${getErrorMessage(error)}`);
    }
    try {
      await this.broadcastChangesetsUpdated();
    } catch (error) {
      console.error(`[Changesets] Broadcast after ${action} failed: ${getErrorMessage(error)}`);
    }

    progress?.finish();

    const updated = this.context.changesets.get(changesetId) ?? (await manager.load(changesetId));
    return c.json({
      id: changesetId,
      name: changeset.name,
      status: updated?.status ?? (action === "commit" ? "committed" : "discarded"),
      ...result,
      ...(reviewResult ?? {}),
    });
  }

  /**
   * Checks a reviewed commit's body against the changeset before anything is written: every
   * sequence number names a staged change; the drops cascade to the changes that depend on an
   * element a dropped add creates; and, over what is left, no delete has blockers unless it is in
   * `deleteBlockedLinks`. Drift is not checked: it never refuses a commit.
   */
  private async prepareReviewedCommit(
    model: Model,
    changeset: StagedChangeset,
    review: { drop: number[]; deleteBlockedLinks: number[] }
  ): Promise<
    | { dropped: number[]; linksDeleted: number }
    | { refusal: { status: 422; body: { error: string; blockers?: Record<string, DeleteBlocker[]> } } }
  > {
    const staged = stagedSequences(changeset);
    const { dropped, unknown } = cascadeDrops(changeset, review.drop);
    const unknownLinks = review.deleteBlockedLinks.filter((sequence) => !staged.has(sequence));
    const allUnknown = [...new Set([...unknown, ...unknownLinks])].sort((a, b) => a - b);
    if (allUnknown.length > 0) {
      return {
        refusal: {
          status: 422,
          body: {
            error: `No staged change with sequence number ${allUnknown.join(", ")} in changeset '${changeset.id}'`,
          },
        },
      };
    }

    const droppedSet = new Set(dropped);
    const remaining = StagedChangeset.fromJSON({
      ...changeset.toJSON(),
      changes: changeset.toJSON().changes.filter((change, index) => {
        const sequence = (change as { sequenceNumber?: number }).sequenceNumber ?? index;
        return !droppedSet.has(sequence);
      }),
    });
    const graph = await ChangesetGraph.build(model, remaining);
    const dangling = danglingRelationshipAdds(graph, remaining);
    if (dangling.length > 0) {
      return {
        refusal: {
          status: 422,
          body: {
            error:
              `${dangling.length} staged relationship-add(s) name an element this changeset deletes: ` +
              dangling.map((d) => `sequence ${d.sequence} (${d.relationshipId})`).join(", ") +
              ". Drop them or the delete.",
          },
        },
      };
    }
    const blockers = deleteBlockers(graph, remaining);
    const allowed = new Set(review.deleteBlockedLinks);
    const refused = [...blockers].filter(([sequence]) => !allowed.has(sequence));
    if (refused.length > 0) {
      const links = refused.reduce((n, [, list]) => n + list.length, 0);
      return {
        refusal: {
          status: 422,
          body: {
            error:
              `${refused.length} delete(s) (sequence ${refused.map(([s]) => s).join(", ")}) are still referenced by ` +
              `${links} relationship(s). Pass their sequence numbers in deleteBlockedLinks to delete those ` +
              `relationships with them, or drop the deletes.`,
            blockers: Object.fromEntries(refused.map(([sequence, list]) => [String(sequence), list])),
          },
        },
      };
    }
    const linksDeleted = new Set(
      [...blockers].flatMap(([, list]) => list.map((blocker) => blocker.relationshipId))
    ).size;

    return { dropped, linksDeleted };
  }

  /**
   * Puts back the changes a reviewed commit unstaged when the commit then failed (validation, a
   * write), under the changeset's file lock: re-stages them from their tombstones and removes those
   * tombstones, so anything staged meanwhile (DrBot) is kept. Left alone if it is no longer staged.
   */
  private async restoreDroppedChanges(
    changesetId: string,
    dropped: { sequences: number[]; removedAt: number }
  ): Promise<void> {
    try {
      const storage = this.context.changesetStorage;
      if ((await storage.load(changesetId))?.status !== "staged") return;
      await storage.restoreUnstaged(changesetId, dropped.sequences, dropped.removedAt);
    } catch (error) {
      console.error(
        `[Changesets] Could not restore the changes dropped from '${changesetId}' after a failed commit: ` +
          getErrorMessage(error)
      );
    }
  }

  /**
   * What the drift report reads about a changeset (changeset-drift-status.ts): its purpose and, for
   * a verification record, the plan it verifies when that changeset is still on disk.
   */
  private driftSubject(changeset: StagedChangeset, purpose: DriftSubject["purpose"], verifies?: string): DriftSubject {
    const plan = verifies ? this.context.changesets.get(verifies) : undefined;
    return { changeset, purpose, ...(plan ? { plan: { name: plan.name, status: plan.status } } : {}) };
  }

  /**
   * Each staged delete's blockers (see deleteBlockers), for GET /api/changesets/:id. Empty for a
   * changeset that is not staged or has no deletes; a failure is logged and reads as none.
   */
  private async changesetBlockers(changeset: StagedChangeset): Promise<Map<number, DeleteBlocker[]>> {
    if (changeset.status !== "staged" || !changeset.changes.some((change) => change.type === "delete")) {
      return new Map();
    }
    try {
      return deleteBlockers(await ChangesetGraph.build(this.model, changeset), changeset);
    } catch (error) {
      console.warn(`[Changesets] Could not compute delete blockers for '${changeset.id}': ${getErrorMessage(error)}`);
      return new Map();
    }
  }

  /**
   * The sequence numbers of the staged deletes that have blockers, for the list's review counts (a
   * delete with blockers never cancels its add). Only computed when a delete could pair with an add.
   */
  private async blockedDeletes(changeset: StagedChangeset): Promise<Set<number>> {
    const adds = new Set(changeset.changes.filter((c) => c.type === "add").map((c) => c.elementId));
    if (!changeset.changes.some((c) => c.type === "delete" && adds.has(c.elementId))) return new Set();
    return new Set((await this.changesetBlockers(changeset)).keys());
  }

  /** PUT /api/changesets/:id/review: set or clear decisions, under the changeset's lock. */
  private async updateChangesetReview(
    c: any,
    changesetId: string,
    decisions: Array<{ sequence: number; verdict: ReviewVerdict | null; note?: string }>
  ) {
    const storage = this.context.changesetStorage;
    if (!(await storage.load(changesetId))) {
      return c.json({ error: "Changeset not found" }, 404);
    }
    let refusal: { status: 409 | 422; error: string } | undefined;
    let review;
    try {
      review = await storage.updateReview(changesetId, (changeset, current) => {
        if (changeset.status !== "staged") {
          refusal = { status: 409, error: `Changeset is already ${changeset.status}` };
          throw new Error(refusal.error);
        }
        const staged = stagedSequences(changeset);
        // A decision can be set only on a staged change; one on a change since unstaged can still be cleared.
        const unknown = decisions
          .filter((d) => !staged.has(d.sequence) && !(d.verdict === null && String(d.sequence) in current))
          .map((d) => d.sequence);
        if (unknown.length > 0) {
          refusal = {
            status: 422,
            error: `No staged change with sequence number ${[...new Set(unknown)].join(", ")} in changeset '${changeset.id}'`,
          };
          throw new Error(refusal.error);
        }
        const atRevision = reviewRevision(changeset);
        const decidedAt = new Date().toISOString();
        for (const { sequence, verdict, note } of decisions) {
          if (verdict === null) {
            delete current[String(sequence)];
            continue;
          }
          const trimmed = note?.trim();
          current[String(sequence)] = {
            verdict,
            ...(trimmed ? { note: trimmed } : {}),
            atRevision,
            decidedAt,
          } satisfies ReviewDecision;
        }
        return current;
      });
    } catch (error) {
      if (refusal) return c.json({ error: refusal.error }, refusal.status);
      throw error;
    }

    try {
      await this.broadcastChangesetsUpdated();
    } catch (error) {
      console.error(`[Changesets] Broadcast after review failed: ${getErrorMessage(error)}`);
    }
    return c.json(review);
  }

  /**
   * GET /api/tier1's body: tier1Status for the served project (its real path, as the MCP tools
   * resolve it) and the analyzer asked for, else the active one, else cbm, with the description
   * tier1_status adds. Reads files and runs git; sends nothing and writes nothing.
   */
  private async tier1Body(asked?: string): Promise<Record<string, unknown>> {
    const real = async (dir: string) => realpath(dir).catch(() => dir);
    const projectRoot = await real(this.context.rootPath);
    const codebaseRoot = await real(this.model.codebaseRoot);
    const analyzer = asked ?? (await readSession(projectRoot).catch(() => null))?.active_analyzer ?? "cbm";
    const status = await tier1Status(projectRoot, analyzer, { codebaseRoot, ...(this._testTier1Options ?? {}) });
    return { ...status, ...describeTier1Status(status) };
  }

  /**
   * Load all changesets from disk into the in-memory map
   */
  private async loadChangesetsFromDisk(): Promise<void> {
    await this.context.loadChangesets();
  }

  /**
   * Start the server: it listens on 127.0.0.1 only, and sweeps idle contexts and removed checkouts.
   */
  async start(port: number = 8080): Promise<void> {
    const central = this.central;
    try {
      const server = await this.listenOn(port, "127.0.0.1");
      server.on("connection", (socket: import("net").Socket) => {
        central.connections.add(socket);
        socket.once("close", () => central.connections.delete(socket));
      });
      this._servers.push(server);
    } catch (error) {
      this.closeServers();
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        throw new Error(`Port ${port} is already in use.`);
      }
      throw error;
    }
    for (const server of this._servers) this.injectWebSocket?.(server);
    central.pool.startSweeping();
    const interval = central.options.removalCheckMs ?? 30_000;
    if (interval > 0) {
      central.removalTimer = setInterval(() => {
        this.checkRemovedCheckouts().catch((error) => {
          console.warn(`[Central] Checking for removed checkouts failed: ${getErrorMessage(error)}`);
        });
      }, interval);
      central.removalTimer.unref?.();
    }
  }

  /**
   * One HTTP server for the app, listening on host:port. Node reports bind failures (e.g.
   * EADDRINUSE) through an 'error' event, not a throw; this turns that into a rejection
   * instead of an unhandled 'error' that would crash the process.
   */
  private async listenOn(port: number, host: string): Promise<ServerType> {
    const server = createAdaptorServer({ fetch: this.app.fetch });
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
      server.listen(port, host);
    });
    return server;
  }

  /** Closes every HTTP server this instance listens on. */
  private closeServers(): void {
    for (const server of this._servers) {
      server.close((error?: Error) => {
        if (error && process.env.VERBOSE) {
          console.warn(`[SERVER] Error while closing HTTP server: ${getErrorMessage(error)}`);
        }
      });
    }
    this._servers = [];
  }

  /**
   * Get the current auth token
   */
  getAuthToken(): string {
    return this.authToken;
  }

  /** Whether a request carries this server's token (Authorization: Bearer, or ?token=). */
  private requestHasToken(c: { req: { header(name: string): string | undefined; query(name: string): string | undefined } }): boolean {
    const authHeader = c.req.header("Authorization");
    const provided = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : c.req.query("token");
    return !!provided && this.isAuthToken(provided);
  }

  /**
   * Stop the server (`stopCentral`, not awaited).
   *
   * With `processExiting`, the file watcher is left open: the process is about to exit, which
   * releases its watches. Closing a chokidar watcher while the tree it watches is being deleted
   * deadlocks Bun's main thread (seen on Bun 1.3.4 and 1.3.5, #1235), so process.exit was never
   * reached and the server ignored every later signal. That is what happens when a project
   * folder is removed as its viewer is stopped.
   */
  stop(options: { processExiting?: boolean } = {}): void {
    void this.stopCentral(options);
  }

  // -------------------------------------------------------------------------------------------
  // The farm (issue 1279): every project and checkout
  // -------------------------------------------------------------------------------------------

  /** Open websockets, subscribed or not. */
  private socketCount(): number {
    return this.central.sockets.size;
  }

  /** An event carries the checkout it is about. */
  private stamp(message: Record<string, unknown>): Record<string, unknown> {
    const { project, checkout } = this.context.ref;
    return { ...message, project, checkout };
  }

  /**
   * Stops the central server: ends every checkout's DrBot turns, tells each subscriber its
   * checkout is no longer served, closes every context and socket, then the listener.
   */
  stopCentral(options: { processExiting?: boolean } = {}): Promise<void> {
    // A later call that says the process is exiting still counts, if the contexts are not closed yet.
    if (options.processExiting) this.stopForExit = true;
    this.stopping ??= this.stopFarm();
    return this.stopping;
  }

  private async stopFarm(): Promise<void> {
    const central = this.central;
    if (central.removalTimer) clearInterval(central.removalTimer);
    central.removalTimer = undefined;
    central.stopListening();
    // End the MCP sessions (their bridges reconnect to the next process).
    if (central.mcp) await (await central.mcp).close().catch(() => {});
    const timestamp = new Date().toISOString();
    for (const ref of central.pool.loaded()) {
      const context = central.pool.peek(ref);
      if (!context) continue;
      for (const [conversationId, proc] of context.chatProcesses) {
        context.cancelledChatProcesses.add(proc);
        try {
          proc.kill("SIGTERM");
        } catch (error) {
          console.warn(`[Central] Could not stop DrBot turn ${conversationId}: ${getErrorMessage(error)}`);
        }
      }
      const message = JSON.stringify({ type: "server.stopping", project: ref.project, checkout: ref.checkout, timestamp });
      for (const subscriber of context.subscribers) {
        try {
          subscriber.send(message);
        } catch {
          // A socket that is already gone needs no notice.
        }
      }
    }
    central.pool.stop({ processExiting: this.stopForExit });
    for (const ws of central.sockets.keys()) {
      try {
        ws.close(1001, "server stopping");
      } catch {
        // Already closed.
      }
    }
    central.sockets.clear();
    const servers = this._servers;
    this._servers = [];
    const closed = Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve())))
    );
    for (const connection of central.connections) connection.destroy();
    central.connections.clear();
    // The listener stops accepting at close(). Its callback waits for every connection to end,
    // and under Bun it never comes once a connection was upgraded to a websocket, even after the
    // connection is destroyed: wait for it a moment, no longer.
    let grace: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([closed, new Promise<void>((resolve) => (grace = setTimeout(resolve, 1000)))]);
    clearTimeout(grace);
  }

  /** The port the server listens on (the one the OS chose when started on port 0). */
  listeningPort(): number | undefined {
    const address = this._servers[0]?.address();
    return address && typeof address === "object" ? address.port : undefined;
  }

  /** What the central process reports for its idle exit (`CentralActivity` in central-server-contract.ts). */
  centralActivity(): { clients: number; mcpSessions: number; drBotTurns: number; lastActivityAt: number } {
    // Running turns, across every checkout (the launcher's cap counts the same ones).
    const drBotTurns = this.drBot.runningTurns;
    return {
      clients: this.socketCount(),
      mcpSessions: this.central.mcpEndpoint?.sessionCount ?? 0,
      drBotTurns,
      lastActivityAt: this.lastActivityAt,
    };
  }

  /**
   * `/mcp` on the central process: the token as a bearer header (never a query parameter: an MCP
   * client always sends headers), then the session's own MCP server (mcp/central-mcp.ts).
   */
  private async handleMcp(request: Request): Promise<Response> {
    const central = this.central;
    const header = request.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token || !this.isAuthToken(token)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    this.lastActivityAt = Date.now();
    central.mcp ??= import("../mcp/central-mcp.js").then(({ CentralMcpEndpoint }) => {
      central.mcpEndpoint = new CentralMcpEndpoint({
        registry: central.options.registry,
        fallbackRoot: async () => {
          const ref = central.options.defaultCheckout;
          return ref ? (await central.options.registry.resolveRef(ref))?.checkout.path : undefined;
        },
        onActivity: () => {
          this.lastActivityAt = Date.now();
        },
      });
      return central.mcpEndpoint;
    });
    return (await central.mcp).handle(request);
  }

  /** `/health` on the central process (`CentralHealth`): status and version, the rest only with the token. */
  private centralHealth(withToken: boolean): z.infer<typeof HealthResponseSchema> {
    const central = this.central;
    const response: z.infer<typeof HealthResponseSchema> = { status: "ok", version: "0.1.0", cliVersion: getCliVersion() };
    // Chat detection failed at start-up: the server runs, without DrBot. Anyone may learn that it
    // is degraded; what failed (an error that can name local paths) is for the token's holder only.
    if (this.chatInitializationError) response.status = "degraded";
    if (!withToken) return response;
    if (this.chatInitializationError) {
      response.warnings = [`Chat service unavailable: ${getErrorMessage(this.chatInitializationError)}`];
    }
    if (central.options.serverId) response.serverId = central.options.serverId;
    response.pid = process.pid;
    if (this.launcherPid) response.launcherPid = this.launcherPid;
    response.farmRoot = this.farmRoot();
    response.clients = this.socketCount();
    // What `ensureCentralServer` reads before it replaces an older process: is anything using it?
    const activity = this.centralActivity();
    response.mcpSessions = activity.mcpSessions;
    response.drBotTurns = activity.drBotTurns;
    response.loadedCheckouts = central.pool.size;
    return response;
  }

  private farmRoot(): string {
    const root = this.central.options.registry.farm.root;
    try {
      return realpathSync(root);
    } catch {
      return root;
    }
  }

  /**
   * A checkout's context, loaded on first use. A message naming why when the registry doesn't
   * list the project, or the checkout, or the checkout is not on disk (`missing` or `prunable`).
   */
  private async acquireCheckout(ref: CheckoutRef): Promise<{ context: CheckoutContext } | { error: string }> {
    const central = this.central;
    const registry = central.options.registry;
    // Another process may have registered the project since the registry was read.
    if (!registry.getProject(ref.project)) await this.reloadRegistry();
    if (!registry.getProject(ref.project)) return { error: `Unknown project: ${ref.project}` };

    const resolved = await registry.resolveRef(ref);
    if (!resolved) {
      // Gone, or never there: a loaded context for it is closed.
      this.closeRemovedCheckout(ref);
      const listed = (await registry.checkouts(ref.project)).find((c) => c.key === ref.checkout);
      return {
        error: listed
          ? `Checkout ${ref.checkout} of project ${ref.project} is ${listed.state}: its folder is not on disk`
          : `Unknown checkout of project ${ref.project}: ${ref.checkout}`,
      };
    }
    const context = await central.pool.acquire(ref);
    if (!context || context.closed) return { error: `Checkout ${ref.checkout} of project ${ref.project} could not be loaded` };
    return { context };
  }

  private async reloadRegistry(): Promise<void> {
    try {
      await this.central.options.registry.reload();
    } catch (error) {
      console.warn(`[Central] Could not re-read the farm: ${getErrorMessage(error)}`);
    }
  }

  /** Loads a checkout's context for the pool: its model, changesets and annotations, and its file watcher. */
  private async loadCheckoutContext(resolved: ResolvedCheckout): Promise<CheckoutContext> {
    const context = await CheckoutContext.load(resolved.ref, resolved.modelPath);
    await this.inContext(context, async () => {
      await this.loadChangesetsFromDisk();
      await this.syncAnnotations({ broadcast: false }).catch((error) => {
        console.warn(`[Annotations] Could not read the annotations: ${getErrorMessage(error)}`);
      });
      this.setupFileWatcher();
    });
    return context;
  }

  /**
   * A checkout is gone (`checkout-removed`): its context closes, ending its DrBot turns, and its
   * subscribers hear `checkout.removed`. Their sockets stay open for their other checkouts.
   */
  private closeRemovedCheckout(ref: CheckoutRef): void {
    this.central.pool.close(ref);
  }

  /** Asks the registry about each loaded checkout, so a removed one is closed even with no request for it. */
  private async checkRemovedCheckouts(): Promise<void> {
    const central = this.central;
    for (const ref of central.pool.loaded()) {
      if (!(await central.options.registry.resolveRef(ref))) this.closeRemovedCheckout(ref);
    }
  }

  /**
   * Runs an `/api/projects/{project}/checkouts/{checkout}/...` request in that checkout's context:
   * 404 when the registry doesn't list it or it is not on disk. Every other `/api/...` path (the
   * project routes, `/api/spec`, the retired unscoped routes) needs no checkout.
   */
  private async scopeRequest(c: any, next: () => Promise<void>): Promise<Response | void> {
    const segments = c.req.path.split("/");
    let ref: CheckoutRef;
    if (segments[2] === "projects") {
      // /api/projects, /api/projects/{project}, /api/projects/{project}/checkouts
      if (segments.length < 7 || segments[4] !== "checkouts") return next();
      try {
        ref = { project: decodeURIComponent(segments[3]), checkout: decodeURIComponent(segments[5]) };
      } catch {
        return c.json({ error: "Malformed project or checkout in the path" }, 400);
      }
    } else {
      return next();
    }
    const found = await this.acquireCheckout(ref);
    if ("error" in found) return c.json({ error: found.error }, 404);
    c.set(CHECKOUT_CONTEXT_KEY, ref);
    return this.inContext(found.context, () => next());
  }

  /** Handles a websocket message: a feed subscription, or a message in the checkout it is for. */
  private async dispatchWSMessage(ws: HonoWSContext, data: WSMessage): Promise<CheckoutRef | undefined> {
    const handle = () =>
      "jsonrpc" in data && data.jsonrpc === "2.0" ? this.handleJSONRPCMessage(ws, data) : this.handleWSMessage(ws, data);
    if ("action" in data) return this.handleFeedSubscription(ws, data);
    const ref = this.messageCheckout(ws, data);
    if (!ref) {
      ws.send(JSON.stringify({ type: "error", message: "Subscribe to a checkout first: {action: \"subscribe\", project, checkout}" }));
      return undefined;
    }
    const found = await this.acquireCheckout(ref);
    if ("error" in found) {
      ws.send(JSON.stringify({ type: "error", message: found.error, project: ref.project, checkout: ref.checkout }));
      return ref;
    }
    await this.inContext(found.context, handle);
    return ref;
  }

  /**
   * The checkout a websocket message is for: the project and checkout its params name, else the
   * socket's one subscription; null when it names none and the socket has no one subscription.
   */
  private messageCheckout(ws: HonoWSContext, data: WSMessage): CheckoutRef | null {
    const params = "params" in data ? (data.params as Record<string, unknown> | undefined) : undefined;
    if (params && typeof params === "object" && typeof params.project === "string" && typeof params.checkout === "string") {
      return { project: params.project, checkout: params.checkout };
    }
    const subscriptions = [...(this.central.sockets.get(ws)?.values() ?? [])];
    return subscriptions.length === 1 ? subscriptions[0].ref : null;
  }

  /**
   * `{action: "subscribe" | "unsubscribe", project, checkout}`: adds or removes the socket's
   * subscription to the checkout's feed, acquiring its context. A subscribed context is never
   * evicted. (`application.applicationfunction.subscribe-checkout-feed`)
   */
  private async handleFeedSubscription(ws: HonoWSContext, frame: FeedSubscription): Promise<CheckoutRef> {
    const central = this.central;
    const ref: CheckoutRef = { project: frame.project, checkout: frame.checkout };
    const key = checkoutKey(ref);
    const timestamp = () => new Date().toISOString();

    if (frame.action === "unsubscribe") {
      const subscription = central.sockets.get(ws)?.get(key);
      if (subscription) {
        central.sockets.get(ws)!.delete(key);
        central.pool.peek(ref)?.subscribers.delete(subscription);
      }
      ws.send(JSON.stringify({ type: "unsubscribed", ...ref, timestamp: timestamp() }));
      return ref;
    }

    const found = await this.acquireCheckout(ref);
    if ("error" in found) {
      ws.send(JSON.stringify({ type: "error", message: found.error, ...ref }));
      return ref;
    }
    // The socket may have closed while the checkout loaded.
    const subscriptions = central.sockets.get(ws);
    if (!subscriptions) return ref;
    if (!subscriptions.has(key)) {
      const subscription: FeedSubscriber = {
        ref,
        ws,
        send: (source, options) => ws.send(source, options),
        // The context closing ends this subscription only; the socket stays open.
        close: () => {
          if (central.sockets.get(ws)?.get(key) === subscription) central.sockets.get(ws)!.delete(key);
        },
      };
      found.context.subscribers.add(subscription);
      subscriptions.set(key, subscription);
    }
    found.context.touch();
    ws.send(JSON.stringify({ type: "subscribed", ...ref, timestamp: timestamp() }));
    return ref;
  }

  /** A closed socket's subscriptions end. */
  private dropSocket(ws: HonoWSContext): void {
    const central = this.central;
    for (const subscription of central.sockets.get(ws)?.values() ?? []) {
      central.pool.peek(subscription.ref)?.subscribers.delete(subscription);
    }
    central.sockets.delete(ws);
  }

  /** The farm's projects, the registry re-read first. */
  private async farmProjects() {
    await this.reloadRegistry();
    return this.central.options.registry.listProjects();
  }

  /** `GET /api/projects`, `/api/projects/{project}` and `/api/projects/{project}/checkouts` (central only). */
  private setupProjectRoutes(): void {
    const notFound = {
      description: "The farm lists no project of that name",
      content: { "application/json": { schema: ErrorResponseSchema } },
    };
    const projectParams = z.object({ project: ProjectNameParamSchema });

    const listProjectsRoute = createRoute({
      method: "get",
      path: "/api/projects",
      tags: ["Projects"],
      summary: "List the projects",
      description: "Every project of the farm with its checkouts (main checkout and linked worktrees)",
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: "The farm's projects", content: { "application/json": { schema: ProjectsListSchema } } },
      },
    });
    this.app.openapi(listProjectsRoute, (async (c: any) => {
      try {
        return c.json({ projects: await this.farmProjects() });
      } catch (error) {
        return c.json({ error: getErrorMessage(error) }, 500);
      }
    }) as any);

    const getProjectRoute = createRoute({
      method: "get",
      path: "/api/projects/:project",
      tags: ["Projects"],
      summary: "Get a project",
      description: "One project of the farm with its checkouts",
      security: [{ bearerAuth: [] }],
      request: { params: projectParams },
      responses: {
        200: { description: "The project", content: { "application/json": { schema: ProjectListEntrySchema } } },
        404: notFound,
      },
    });
    this.app.openapi(getProjectRoute, (async (c: any) => {
      const { project } = c.req.valid("param");
      const entry = (await this.farmProjects()).find((p) => p.name === project);
      if (!entry) return c.json({ error: `Unknown project: ${project}` }, 404);
      return c.json(entry);
    }) as any);

    const getProjectCheckoutsRoute = createRoute({
      method: "get",
      path: "/api/projects/:project/checkouts",
      tags: ["Projects"],
      summary: "List a project's checkouts",
      description: "The project's main checkout and linked worktrees, with their state and staged changesets",
      security: [{ bearerAuth: [] }],
      request: { params: projectParams },
      responses: {
        200: { description: "The project's checkouts", content: { "application/json": { schema: ProjectCheckoutsSchema } } },
        404: notFound,
      },
    });
    this.app.openapi(getProjectCheckoutsRoute, (async (c: any) => {
      const { project } = c.req.valid("param");
      const entry = (await this.farmProjects()).find((p) => p.name === project);
      if (!entry) return c.json({ error: `Unknown project: ${project}` }, 404);
      return c.json({ project: entry.name, checkouts: entry.checkouts });
    }) as any);
  }

  /**
   * Registers a project-data route under /api/projects/{project}/checkouts/{checkout}/: `route`
   * is written with its old unscoped path (/api/...), which answers `410 Gone` naming the scoped
   * one for this release (retiredRoute). scopeRequest runs the handler in the named checkout's
   * context.
   */
  private dataRoute(route: any, handler: (c: any) => any): void {
    const scoped = VisualizationServer.scopedRoute(route);
    this.app.openapi(scoped, handler);
    this.retiredRoute(route.method, route.path, scoped.path);
  }

  /**
   * An unscoped project-data path, retired in slice 4 of issue 1279: `410 Gone` with the scoped
   * path template that replaces it, for a custom viewer build (`--viewer-path`) that still calls
   * it. Not in the OpenAPI document. Kept for one release.
   */
  private retiredRoute(method: string, oldPath: string, scopedPath: string): void {
    const template = (p: string) => p.replace(/:([A-Za-z]+)/g, "{$1}");
    const body = {
      error:
        `${method.toUpperCase()} ${template(oldPath)} is gone: every project-data route names its project and checkout. ` +
        "Projects and their checkouts are listed at GET /api/projects.",
      replacement: template(scopedPath),
    };
    this.app.on(method.toUpperCase(), oldPath, (c) => c.json(body, 410));
  }

  /** The checkout-scoped twin of an unscoped /api route. */
  private static scopedRoute(route: any): any {
    const scope = z.object({ project: ProjectNameParamSchema, checkout: CheckoutKeyParamSchema });
    const params = route.request?.params ? scope.merge(route.request.params) : scope;
    const own404 = route.responses?.[404]?.description;
    return createRoute({
      ...route,
      path: SCOPED_PREFIX + route.path.slice("/api".length),
      description: `${route.description}, in the named project's checkout`,
      request: { ...(route.request ?? {}), params },
      responses: {
        ...route.responses,
        404: {
          description: own404
            ? `${own404}; or the farm lists no such project or checkout, or the checkout is not on disk`
            : "The farm lists no such project or checkout, or the checkout is not on disk",
          content: { "application/json": { schema: ErrorResponseSchema } },
        },
      },
    });
  }
}
