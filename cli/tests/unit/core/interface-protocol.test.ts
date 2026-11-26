/**
 * The application interface's protocol and interfaceType under spec 0.16.0 (Context Studio
 * 43f52ae5): the values the 0.15.0 -> 0.16.0 migration rewrites, and the spellings the validator
 * recommends.
 */
import { describe, it, expect } from "bun:test";
import { migratedInterfaceAttributes, recommendedProtocol } from "@/core/interface-protocol";

describe("migratedInterfaceAttributes", () => {
  it("writes REST as HTTP and calls it an api", () => {
    expect(migratedInterfaceAttributes({ protocol: "REST" })).toEqual({ protocol: "HTTP", interfaceType: "api" });
  });

  it("writes HTTPS as HTTP and leaves interfaceType for a person, as it leaves plain HTTP", () => {
    expect(migratedInterfaceAttributes({ protocol: "HTTPS" })).toEqual({ protocol: "HTTP" });
    expect(migratedInterfaceAttributes({ protocol: "HTTP" })).toBeNull();
  });

  it("sets interfaceType from the protocols that say it, keeping the protocol", () => {
    for (const protocol of ["gRPC", "GraphQL", "SOAP", "WebSocket"]) {
      expect(migratedInterfaceAttributes({ protocol })).toEqual({ protocol, interfaceType: "api" });
    }
    expect(migratedInterfaceAttributes({ protocol: "AMQP" })).toEqual({ protocol: "AMQP", interfaceType: "message-channel" });
  });

  it("keeps an interfaceType already set and the other attributes, so running it again changes nothing", () => {
    expect(migratedInterfaceAttributes({ protocol: "REST", interfaceType: "user-interface", version: "v2" })).toEqual({
      protocol: "HTTP",
      interfaceType: "user-interface",
      version: "v2",
    });
    const once = migratedInterfaceAttributes({ protocol: "REST" })!;
    expect(migratedInterfaceAttributes(once)).toBeNull();
  });

  it("changes nothing without a protocol, or for one 0.15.0 couldn't hold", () => {
    expect(migratedInterfaceAttributes({})).toBeNull();
    expect(migratedInterfaceAttributes({ interfaceType: "in-process" })).toBeNull();
    expect(migratedInterfaceAttributes({ protocol: "MCP" })).toBeNull();
  });
});

describe("recommendedProtocol", () => {
  it("keeps a recommended name as it is", () => {
    for (const name of ["HTTP", "MCP", "GraphQL", "gRPC", "JSON-RPC", "Kafka"]) expect(recommendedProtocol(name)).toBe(name);
  });

  it("names the rewrite for REST and HTTPS, and the spelling for another case", () => {
    expect(recommendedProtocol("REST")).toBe("HTTP");
    expect(recommendedProtocol("https")).toBe("HTTP");
    expect(recommendedProtocol("graphql")).toBe("GraphQL");
  });

  it("has nothing to say about a protocol outside the vocabulary", () => {
    expect(recommendedProtocol("Thrift")).toBeNull();
  });
});
