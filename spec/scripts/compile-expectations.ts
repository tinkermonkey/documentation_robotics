/**
 * compile-expectations.ts — compiles spec/schemas/expectations/*.expectations.json into the
 * spec/dist/expectations.json distribution file.
 *
 * Expectations are soft: they say which connections a node type is expected to have, so a planned
 * change can be told what it is missing. They must never break the build. Anything that does not
 * fit the current spec is reported as a warning and dropped, at the smallest grain possible:
 *
 *   - a file that does not parse, or is not an object      → the file is dropped
 *   - an expectation that fails the format schema          → that expectation is dropped
 *   - an unknown source type, or one outside the file's layer → that expectation is dropped
 *   - a connection whose triple the catalog no longer allows → that connection is dropped
 *   - named other-end types the catalog does not allow     → those types are dropped
 *   - an expectation left with no connections              → that expectation is dropped
 *
 * Kept separate from build-spec.ts so it can be unit-tested without writing spec/dist/.
 */

import Ajv from "ajv";

export type Direction = "outgoing" | "incoming";

export interface ExpectationConnection {
  direction: Direction;
  predicate: string;
  other?: { types?: string[]; layers?: string[] };
}

export interface ConnectionExpectation {
  id: string;
  layer: string;
  source: string;
  rationale: string;
  anyOf: ExpectationConnection[];
}

export interface DroppedExpectation {
  /** Expectation id, or the file name when a whole file is dropped. */
  id: string;
  file: string;
  reason: string;
}

export interface ExpectationsDistFile {
  specVersion: string;
  expectations: ConnectionExpectation[];
  /** What the build dropped, and why, so a reviewer can see it without the build log. */
  dropped: DroppedExpectation[];
}

export interface CatalogTriple {
  source: string;
  predicate: string;
  destination: string;
}

export interface ExpectationSourceFile {
  /** File name, for messages. */
  file: string;
  /** Raw file contents. */
  content: string;
}

export interface CompileExpectationsInput {
  files: ExpectationSourceFile[];
  /** Every triple the relationship catalog allows. */
  triples: CatalogTriple[];
  /** Every spec node id (`layer.type`). */
  nodeTypes: Iterable<string>;
  /** The format schema (spec/schemas/base/connection-expectations.schema.json). */
  schema: object;
}

export interface CompileExpectationsResult {
  expectations: ConnectionExpectation[];
  dropped: DroppedExpectation[];
  /** Partial drops (a connection or a type) that left the expectation in place. */
  warnings: string[];
}

const layerOf = (specNodeId: string) => specNodeId.slice(0, specNodeId.indexOf("."));

export function compileExpectations(input: CompileExpectationsInput): CompileExpectationsResult {
  const nodeTypes = new Set(input.nodeTypes);
  const bySource = new Map<string, CatalogTriple[]>();
  const byDestination = new Map<string, CatalogTriple[]>();
  for (const t of input.triples) {
    (bySource.get(t.source) ?? bySource.set(t.source, []).get(t.source)!).push(t);
    (byDestination.get(t.destination) ?? byDestination.set(t.destination, []).get(t.destination)!).push(t);
  }

  const ajv = new Ajv({ strict: false, allErrors: true });
  const definitions = (input.schema as { definitions?: Record<string, unknown> }).definitions ?? {};
  const validateExpectation = ajv.compile({ definitions, $ref: "#/definitions/expectation" });

  const expectations: ConnectionExpectation[] = [];
  const dropped: DroppedExpectation[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const { file, content } of [...input.files].sort((a, b) => a.file.localeCompare(b.file))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      dropped.push({ id: file, file, reason: `not valid JSON: ${(err as Error).message}` });
      continue;
    }
    if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as Record<string, unknown>).expectations)) {
      dropped.push({ id: file, file, reason: "not an expectations file (needs a 'layer' and an 'expectations' array)" });
      continue;
    }
    const fileLayer = (parsed as Record<string, unknown>).layer;
    const items = (parsed as { expectations: unknown[] }).expectations;

    items.forEach((raw, index) => {
      const label =
        raw && typeof raw === "object" && typeof (raw as Record<string, unknown>).id === "string"
          ? ((raw as Record<string, unknown>).id as string)
          : `${file}#${index}`;
      const drop = (reason: string) => dropped.push({ id: label, file, reason });

      if (!validateExpectation(raw)) {
        const why = (validateExpectation.errors ?? [])
          .map((e) => `${e.instancePath || "/"} ${e.message}`)
          .join("; ");
        drop(`does not match the expectation format: ${why}`);
        return;
      }
      const exp = raw as Omit<ConnectionExpectation, "layer">;

      if (seen.has(exp.id)) {
        drop("duplicate id");
        return;
      }
      if (!nodeTypes.has(exp.source)) {
        drop(`unknown source type '${exp.source}'`);
        return;
      }
      const layer = layerOf(exp.source);
      if (typeof fileLayer === "string" && fileLayer !== layer) {
        drop(`source '${exp.source}' is not in the file's layer '${fileLayer}'`);
        return;
      }

      const kept: ExpectationConnection[] = [];
      for (const conn of exp.anyOf) {
        const shape = describe(exp.source, conn);
        const candidates =
          conn.direction === "outgoing"
            ? (bySource.get(exp.source) ?? []).filter((t) => t.predicate === conn.predicate).map((t) => t.destination)
            : (byDestination.get(exp.source) ?? []).filter((t) => t.predicate === conn.predicate).map((t) => t.source);

        if (!conn.other || (!conn.other.types && !conn.other.layers)) {
          if (candidates.length === 0) {
            warnings.push(`${exp.id}: dropped ${shape}: the catalog allows no such triple`);
            continue;
          }
          kept.push({ direction: conn.direction, predicate: conn.predicate });
          continue;
        }

        const other: { types?: string[]; layers?: string[] } = {};
        if (conn.other.types) {
          const allowed = conn.other.types.filter((t) => candidates.includes(t));
          const notAllowed = conn.other.types.filter((t) => !candidates.includes(t));
          if (notAllowed.length > 0 && allowed.length > 0) {
            warnings.push(`${exp.id}: ${shape}: dropped types the catalog does not allow: ${notAllowed.join(", ")}`);
          }
          if (allowed.length > 0) other.types = allowed;
        }
        if (conn.other.layers) {
          const allowed = conn.other.layers.filter((l) => candidates.some((c) => layerOf(c) === l));
          const notAllowed = conn.other.layers.filter((l) => !allowed.includes(l));
          if (notAllowed.length > 0 && allowed.length > 0) {
            warnings.push(`${exp.id}: ${shape}: dropped layers the catalog allows nothing in: ${notAllowed.join(", ")}`);
          }
          if (allowed.length > 0) other.layers = allowed;
        }
        if (!other.types && !other.layers) {
          warnings.push(`${exp.id}: dropped ${shape}: the catalog allows none of those triples`);
          continue;
        }
        kept.push({ direction: conn.direction, predicate: conn.predicate, other });
      }

      if (kept.length === 0) {
        drop("the catalog no longer allows any of its connections");
        return;
      }
      seen.add(exp.id);
      expectations.push({ id: exp.id, layer, source: exp.source, rationale: exp.rationale, anyOf: kept });
    });
  }

  expectations.sort((a, b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
  return { expectations, dropped, warnings };
}

function describe(source: string, conn: ExpectationConnection): string {
  const other = conn.other?.types?.join("|") ?? conn.other?.layers?.map((l) => `${l}.*`).join("|") ?? "*";
  return conn.direction === "outgoing"
    ? `${source} --${conn.predicate}--> ${other}`
    : `${other} --${conn.predicate}--> ${source}`;
}
