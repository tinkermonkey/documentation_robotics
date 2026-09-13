/**
 * Unit tests for the bearer auth middleware used by the HTTP MCP transport.
 *
 * Tests the actual createBearerAuthMiddleware function from http-transport.ts
 * using mock Request/Response objects.
 */

import { describe, it, expect } from "bun:test";
import { createBearerAuthMiddleware } from "../../../src/mcp/http-transport";
import { ApiKeyManager } from "../../../src/mcp/api-key-manager";

describe("Bearer Auth Middleware", () => {
  const testKey = "dr-mcp-test-key-12345";

  // Mock Request object with get method
  class MockRequest {
    private headers: Record<string, string>;

    constructor(headers: Record<string, string> = {}) {
      this.headers = headers;
    }

    get(key: string): string | undefined {
      return this.headers[key.toLowerCase()];
    }
  }

  // Mock Response object
  class MockResponse {
    statusCode = 200;
    responseBody: any = null;
    headersSent = false;

    status(code: number) {
      this.statusCode = code;
      return this;
    }

    json(body: any) {
      this.responseBody = body;
      this.headersSent = true;
    }
  }

  it("rejects requests with a missing Authorization header", async () => {
    const keyManager = new ApiKeyManager("/tmp/test-key");
    const middleware = createBearerAuthMiddleware(keyManager, testKey);
    const req = new MockRequest({});
    const res = new MockResponse() as any;
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    middleware(req as any, res, next);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects requests with a malformed Authorization header", async () => {
    const keyManager = new ApiKeyManager("/tmp/test-key");
    const middleware = createBearerAuthMiddleware(keyManager, testKey);
    const req = new MockRequest({ authorization: "InvalidFormat" });
    const res = new MockResponse() as any;
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    middleware(req as any, res, next);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("rejects requests with an invalid bearer token", async () => {
    const keyManager = new ApiKeyManager("/tmp/test-key");
    const middleware = createBearerAuthMiddleware(keyManager, testKey);
    const req = new MockRequest({ authorization: "Bearer wrong-key" });
    const res = new MockResponse() as any;
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    middleware(req as any, res, next);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("allows requests with a valid bearer token", async () => {
    const keyManager = new ApiKeyManager("/tmp/test-key");
    const middleware = createBearerAuthMiddleware(keyManager, testKey);
    const req = new MockRequest({ authorization: `Bearer ${testKey}` });
    const res = new MockResponse() as any;
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    middleware(req as any, res, next);

    expect(res.statusCode).toBe(200);
    expect(nextCalled).toBe(true);
  });

  it("handles Bearer tokens with extra leading whitespace in the header", async () => {
    const keyManager = new ApiKeyManager("/tmp/test-key");
    const middleware = createBearerAuthMiddleware(keyManager, testKey);
    const req = new MockRequest({ authorization: `Bearer   ${testKey}` });
    const res = new MockResponse() as any;
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    middleware(req as any, res, next);

    expect(nextCalled).toBe(true);
  });

  it("rejects Bearer tokens with trailing whitespace in the token itself", async () => {
    const keyManager = new ApiKeyManager("/tmp/test-key");
    const middleware = createBearerAuthMiddleware(keyManager, testKey);
    const req = new MockRequest({ authorization: `Bearer ${testKey}   ` });
    const res = new MockResponse() as any;
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    middleware(req as any, res, next);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });

  it("is case-sensitive for the Bearer scheme", async () => {
    const keyManager = new ApiKeyManager("/tmp/test-key");
    const middleware = createBearerAuthMiddleware(keyManager, testKey);
    const req = new MockRequest({ authorization: `bearer ${testKey}` });
    const res = new MockResponse() as any;
    let nextCalled = false;
    const next = () => {
      nextCalled = true;
    };

    middleware(req as any, res, next);

    expect(res.statusCode).toBe(401);
    expect(nextCalled).toBe(false);
  });
});
