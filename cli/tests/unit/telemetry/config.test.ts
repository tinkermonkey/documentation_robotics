/**
 * Tests for OTLP configuration loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';

// Store original env variables
const originalOTLPEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const originalOTLPLogsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
const originalServiceName = process.env.OTEL_SERVICE_NAME;

beforeEach(() => {
  // Clear environment variables before each test
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  delete process.env.OTEL_SERVICE_NAME;
});

afterEach(() => {
  // Restore environment
  if (originalOTLPEndpoint) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalOTLPEndpoint;
  if (originalOTLPLogsEndpoint) process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = originalOTLPLogsEndpoint;
  if (originalServiceName) process.env.OTEL_SERVICE_NAME = originalServiceName;

  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  delete process.env.OTEL_SERVICE_NAME;
});

describe('loadOTLPConfig()', () => {
  describe('Default Configuration', () => {
    it('should return defaults when no env vars or config file', async () => {
      // Use a homedir that won't have a config file
      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');

      const config = await loadOTLPConfig();

      expect(config).toEqual({
        endpoint: 'http://localhost:4318/v1/traces',
        logsEndpoint: 'http://localhost:4318/v1/logs',
        serviceName: 'dr-cli',
      });
    });
  });

  describe('Environment Variable Precedence', () => {
    it('should use OTEL_EXPORTER_OTLP_ENDPOINT when set', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://custom:4318/v1/traces';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config.endpoint).toBe('http://custom:4318/v1/traces');
    });

    it('should use OTEL_EXPORTER_OTLP_LOGS_ENDPOINT when set', async () => {
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://custom:4318/v1/logs';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config.logsEndpoint).toBe('http://custom:4318/v1/logs');
    });

    it('should use OTEL_SERVICE_NAME when set', async () => {
      process.env.OTEL_SERVICE_NAME = 'custom-service';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config.serviceName).toBe('custom-service');
    });

    it('should use all env vars when set', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-endpoint:4318/v1/traces';
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://env-logs:4318/v1/logs';
      process.env.OTEL_SERVICE_NAME = 'env-service';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config).toEqual({
        endpoint: 'http://env-endpoint:4318/v1/traces',
        logsEndpoint: 'http://env-logs:4318/v1/logs',
        serviceName: 'env-service',
      });
    });
  });

  describe('File Configuration', () => {
    it('should handle missing config file gracefully', async () => {
      // When config file doesn't exist (which is the normal case for most users)
      // the function should return defaults without errors
      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config).toEqual({
        endpoint: 'http://localhost:4318/v1/traces',
        logsEndpoint: 'http://localhost:4318/v1/logs',
        serviceName: 'dr-cli',
      });
    });
  });

  describe('Configuration Precedence', () => {
    it('should prefer env vars over defaults', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-endpoint:4318/v1/traces';
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://env-logs:4318/v1/logs';
      process.env.OTEL_SERVICE_NAME = 'env-service';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config).toEqual({
        endpoint: 'http://env-endpoint:4318/v1/traces',
        logsEndpoint: 'http://env-logs:4318/v1/logs',
        serviceName: 'env-service',
      });
    });

    it('should demonstrate precedence pattern', async () => {
      // When no env var is set, should use default
      delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // endpoint should be the default
      expect(config.endpoint).toBe('http://localhost:4318/v1/traces');
    });
  });

  describe('Return Type', () => {
    it('should return OTLPConfig interface with required fields', async () => {
      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(typeof config.endpoint).toBe('string');
      expect(typeof config.logsEndpoint).toBe('string');
      expect(typeof config.serviceName).toBe('string');
    });

    it('should return non-empty string values', async () => {
      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config.endpoint.length).toBeGreaterThan(0);
      expect(config.logsEndpoint.length).toBeGreaterThan(0);
      expect(config.serviceName.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty environment variable values', async () => {
      // Empty string env var should be treated as not set
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Empty string is falsy, so should fall back to default
      expect(config.endpoint).toBe('http://localhost:4318/v1/traces');
    });

    it('should preserve whitespace in configuration values', async () => {
      process.env.OTEL_SERVICE_NAME = 'my-service ';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Should preserve the trailing space
      expect(config.serviceName).toBe('my-service ');
    });
  });

  describe('Special Characters and URLs', () => {
    it('should handle URLs with special characters', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT =
        'http://localhost:4318/v1/traces?api_key=secret&version=1';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config.endpoint).toBe(
        'http://localhost:4318/v1/traces?api_key=secret&version=1'
      );
    });

    it('should handle HTTPS URLs', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://secure.example.com:4318/v1/traces';
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'https://secure.example.com:4318/v1/logs';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config.endpoint).toBe('https://secure.example.com:4318/v1/traces');
      expect(config.logsEndpoint).toBe('https://secure.example.com:4318/v1/logs');
    });
  });

  describe('URL Validation', () => {
    it('should reject invalid endpoint URLs and use default', async () => {
      // Set invalid URL in env var
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'not-a-valid-url';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Should fall back to default when invalid URL provided
      expect(config.endpoint).toBe('http://localhost:4318/v1/traces');
    });

    it('should reject invalid logs endpoint URLs and use default', async () => {
      // Set invalid URL in env var
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'http://[invalid-ipv6]:4318';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Should fall back to default when invalid URL provided
      expect(config.logsEndpoint).toBe('http://localhost:4318/v1/logs');
    });

    it('should accept valid URLs with ports', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:9999/v1/traces';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config.endpoint).toBe('http://localhost:9999/v1/traces');
    });

    it('should accept valid URLs with paths', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/custom/path/traces';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config.endpoint).toBe('http://localhost:4318/custom/path/traces');
    });

    it('should accept valid URLs with query parameters', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318/v1/traces?key=value&foo=bar';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      expect(config.endpoint).toBe('http://localhost:4318/v1/traces?key=value&foo=bar');
    });

    it('should prefer valid file config over invalid env var', async () => {
      // Set invalid URL in env var
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'invalid-url-string';

      // Create a temporary config file with valid URL
      const { homedir } = await import('node:os');
      const { writeFileSync, unlinkSync } = await import('node:fs');
      const { join } = await import('node:path');

      const configPath = join(homedir(), '.dr-config.yaml');
      const configContent = `telemetry:
  otlp:
    endpoint: 'http://valid-file-config:4318/v1/traces'
`;
      writeFileSync(configPath, configContent);

      try {
        const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
        const config = await loadOTLPConfig();

        // Invalid env var should fall back to file config
        expect(config.endpoint).toBe('http://valid-file-config:4318/v1/traces');
      } finally {
        // Clean up
        try {
          unlinkSync(configPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should handle mixed valid and invalid URLs in config file', async () => {
      // Set invalid logs endpoint in env var
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = 'not a url';

      // Create config file with valid logs endpoint
      const { homedir } = await import('node:os');
      const { writeFileSync, unlinkSync } = await import('node:fs');
      const { join } = await import('node:path');

      const configPath = join(homedir(), '.dr-config.yaml');
      const configContent = `telemetry:
  otlp:
    logs_endpoint: 'http://file-logs:4318/v1/logs'
`;
      writeFileSync(configPath, configContent);

      try {
        const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
        const config = await loadOTLPConfig();

        // Invalid env var for logs endpoint should use file config
        expect(config.logsEndpoint).toBe('http://file-logs:4318/v1/logs');
      } finally {
        // Clean up
        try {
          unlinkSync(configPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    });

    it('should reject URLs missing scheme', async () => {
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'localhost:4318/v1/traces';

      const { loadOTLPConfig } = await import('../../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // URL without scheme is invalid, should use default
      expect(config.endpoint).toBe('http://localhost:4318/v1/traces');
    });
  });
});
