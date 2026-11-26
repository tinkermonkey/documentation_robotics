/**
 * The application interface's protocol and interfaceType, as spec 0.16.0 has them (Context Studio
 * 43f52ae5). protocol is open text with a recommended vocabulary: the highest-level named protocol
 * (MCP for an MCP server, GraphQL for a GraphQL endpoint), with REST written as HTTP (REST is a
 * style) and HTTPS written as HTTP (TLS belongs in the technology layer). interfaceType classifies
 * the channel. The 0.15.0 -> 0.16.0 migration and the validator's advice both read this module.
 */

/** The recommended protocol names, spelled as each protocol's own documentation spells it */
export const RECOMMENDED_INTERFACE_PROTOCOLS = [
  "HTTP",
  "MCP",
  "GraphQL",
  "gRPC",
  "SOAP",
  "JSON-RPC",
  "WebSocket",
  "SSE",
  "AMQP",
  "MQTT",
  "Kafka",
  "NATS",
] as const;

/** Values the spec writes another way: REST is a style over HTTP, HTTPS is HTTP plus TLS */
const PROTOCOL_REWRITES: Record<string, string> = { rest: "HTTP", https: "HTTP" };

/**
 * The interfaceType a 0.15.0 protocol value says. HTTP and HTTPS say none: an HTTP controller may
 * serve pages (user-interface) as well as an API, so the migration leaves those for a person.
 */
const INTERFACE_TYPE_OF_OLD_PROTOCOL: Record<string, string> = {
  rest: "api",
  grpc: "api",
  graphql: "api",
  soap: "api",
  websocket: "api",
  amqp: "message-channel",
};

/** The recommended spelling of a protocol value, or the rewrite the spec asks for; null when neither applies */
export function recommendedProtocol(protocol: string): string | null {
  const key = protocol.trim().toLowerCase();
  if (PROTOCOL_REWRITES[key]) return PROTOCOL_REWRITES[key];
  return RECOMMENDED_INTERFACE_PROTOCOLS.find((name) => name.toLowerCase() === key) ?? null;
}

/**
 * An application interface's attributes as spec 0.16.0 has them: protocol REST or HTTPS becomes
 * HTTP, and interfaceType is set where the old protocol value says it (api for REST, gRPC, GraphQL,
 * SOAP and WebSocket; message-channel for AMQP). An interfaceType already set is kept, so running
 * it again changes nothing. Null when nothing changes.
 */
export function migratedInterfaceAttributes(attributes: Record<string, unknown>): Record<string, unknown> | null {
  const protocol = attributes.protocol;
  if (typeof protocol !== "string") return null;
  const key = protocol.trim().toLowerCase();
  const next = { ...attributes };
  let changed = false;
  const interfaceType = INTERFACE_TYPE_OF_OLD_PROTOCOL[key];
  if (interfaceType && (next.interfaceType === undefined || next.interfaceType === null || next.interfaceType === "")) {
    next.interfaceType = interfaceType;
    changed = true;
  }
  const rewrite = PROTOCOL_REWRITES[key];
  if (rewrite && protocol !== rewrite) {
    next.protocol = rewrite;
    changed = true;
  }
  return changed ? next : null;
}
