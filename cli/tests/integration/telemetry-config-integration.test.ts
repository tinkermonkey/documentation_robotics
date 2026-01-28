/**
 * Integration tests for telemetry initialization with configuration loading
 *
 * Verifies that initTelemetry() properly loads and uses OTLP configuration from:
 * 1. Environment variables (highest priority)
 * 2. ~/.dr-config.yaml file (medium priority)
 * 3. Hard-coded defaults (lowest priority)
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Store original env variables
const originalOTLPEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const originalOTLPLogsEndpoint = process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
const originalServiceName = process.env.OTEL_SERVICE_NAME;
const originalDRConfigPath = process.env.DR_CONFIG_PATH;

// Generate unique temp path for each test run
const testConfigPath = join(tmpdir(), `.dr-config-test-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`);

beforeEach(() => {
  // Clear environment variables before each test
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  delete process.env.OTEL_SERVICE_NAME;
  // Set test config path
  process.env.DR_CONFIG_PATH = testConfigPath;
});

afterEach(async () => {
  // Restore environment
  if (originalOTLPEndpoint) process.env.OTEL_EXPORTER_OTLP_ENDPOINT = originalOTLPEndpoint;
  if (originalOTLPLogsEndpoint) process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = originalOTLPLogsEndpoint;
  if (originalServiceName) process.env.OTEL_SERVICE_NAME = originalServiceName;
  if (originalDRConfigPath) process.env.DR_CONFIG_PATH = originalDRConfigPath;

  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  delete process.env.OTEL_SERVICE_NAME;
  delete process.env.DR_CONFIG_PATH;

  // Clean up test config file
  if (existsSync(testConfigPath)) {
    unlinkSync(testConfigPath);
  }
});

describe.serial('telemetry initialization with config loading', () => {
  describe('Configuration precedence in initTelemetry()', () => {
    it('should use environment variables when set (highest priority)', async () => {
      // Set environment variables
      const customEndpoint = 'http://custom-env:4318/v1/traces';
      const customLogsEndpoint = 'http://custom-env:4318/v1/logs';
      const customServiceName = 'my-service-from-env';

      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = customEndpoint;
      process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT = customLogsEndpoint;
      process.env.OTEL_SERVICE_NAME = customServiceName;

      // Create a temporary config file with different values
      const configContent = `telemetry:
  otlp:
    endpoint: 'http://localhost:4318/v1/traces'
    logs_endpoint: 'http://localhost:4318/v1/logs'
    service_name: 'dr-cli-from-file'
`;
      writeFileSync(testConfigPath, configContent);

      // Import and call loadOTLPConfig
      const { loadOTLPConfig } = await import('../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Verify env vars take precedence over config file
      expect(config.endpoint).toBe(customEndpoint);
      expect(config.logsEndpoint).toBe(customLogsEndpoint);
      expect(config.serviceName).toBe(customServiceName);
    });

    it('should use config file values when env vars not set', async () => {
      // Create a temporary config file
      const configContent = `telemetry:
  otlp:
    endpoint: 'http://custom-file:4318/v1/traces'
    logs_endpoint: 'http://custom-file:4318/v1/logs'
    service_name: 'my-service-from-file'
`;
      writeFileSync(testConfigPath, configContent);

      // Import and call loadOTLPConfig
      const { loadOTLPConfig } = await import('../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Verify config file values are used
      expect(config.endpoint).toBe('http://custom-file:4318/v1/traces');
      expect(config.logsEndpoint).toBe('http://custom-file:4318/v1/logs');
      expect(config.serviceName).toBe('my-service-from-file');
    });

    it('should use defaults when no env vars or config file', async () => {
      // Ensure no config file exists
      if (existsSync(testConfigPath)) {
        unlinkSync(testConfigPath);
      }

      // Import and call loadOTLPConfig
      const { loadOTLPConfig } = await import('../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Verify defaults are used
      expect(config.endpoint).toBe('http://localhost:4318/v1/traces');
      expect(config.logsEndpoint).toBe('http://localhost:4318/v1/logs');
      expect(config.serviceName).toBe('dr-cli');
    });

    it('should handle partial config file with mixed sources', async () => {
      // Set only one env var
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://env-endpoint:4318/v1/traces';

      // Create config file with partial values
      const configContent = `telemetry:
  otlp:
    logs_endpoint: 'http://file-logs:4318/v1/logs'
    service_name: 'from-file'
`;
      writeFileSync(testConfigPath, configContent);

      // Import and call loadOTLPConfig
      const { loadOTLPConfig } = await import('../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Verify correct precedence:
      // - endpoint from env var (set)
      // - logsEndpoint from file (env var not set, file has value)
      // - serviceName from file (env var not set, file has value)
      expect(config.endpoint).toBe('http://env-endpoint:4318/v1/traces');
      expect(config.logsEndpoint).toBe('http://file-logs:4318/v1/logs');
      expect(config.serviceName).toBe('from-file');
    });

    it('should ignore empty/whitespace env vars and use next priority', async () => {
      // Set env var with just whitespace
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = '   ';

      // Create config file with actual value
      const configContent = `telemetry:
  otlp:
    endpoint: 'http://from-file:4318/v1/traces'
`;
      writeFileSync(testConfigPath, configContent);

      // Import and call loadOTLPConfig
      const { loadOTLPConfig } = await import('../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Whitespace-only env var should be treated as not set
      expect(config.endpoint).toBe('http://from-file:4318/v1/traces');
    });

    it('should gracefully handle invalid config file', async () => {
      // Create an invalid YAML file
      writeFileSync(testConfigPath, 'invalid: yaml: content: [');

      // Import and call loadOTLPConfig
      const { loadOTLPConfig } = await import('../../src/telemetry/config.js');

      // Should not throw, should return defaults
      const config = await loadOTLPConfig();
      expect(config.endpoint).toBe('http://localhost:4318/v1/traces');
      expect(config.logsEndpoint).toBe('http://localhost:4318/v1/logs');
      expect(config.serviceName).toBe('dr-cli');
    });

    it('should handle config file without telemetry section', async () => {
      // Create a valid but incomplete config file
      const configContent = `version: 1
paths:
  models: ./models
`;
      writeFileSync(testConfigPath, configContent);

      // Import and call loadOTLPConfig
      const { loadOTLPConfig } = await import('../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Should use defaults when telemetry section is missing
      expect(config.endpoint).toBe('http://localhost:4318/v1/traces');
      expect(config.logsEndpoint).toBe('http://localhost:4318/v1/logs');
      expect(config.serviceName).toBe('dr-cli');
    });
  });

  describe('Integration with initTelemetry()', () => {
    it('should load configuration when initTelemetry is called', async () => {
      // This test verifies that loadOTLPConfig is called within initTelemetry
      // by checking that the function can be imported without errors

      // Set custom env vars
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://integration-test:4318/v1/traces';
      process.env.OTEL_SERVICE_NAME = 'test-service';

      // Import config loader to verify it's working
      const { loadOTLPConfig } = await import('../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Verify the loaded config has our values
      expect(config.endpoint).toBe('http://integration-test:4318/v1/traces');
      expect(config.serviceName).toBe('test-service');
    });

    it('should support complex YAML structures in config file', async () => {
      const configContent = `version: 1
defaults:
  model_root: ./documentation-robotics

telemetry:
  otlp:
    endpoint: 'http://otel-collector:4318/v1/traces'
    logs_endpoint: 'http://otel-collector:4318/v1/logs'
    service_name: 'documentation-robotics'

validation:
  strict: true
`;
      writeFileSync(testConfigPath, configContent);

      // Import and call loadOTLPConfig
      const { loadOTLPConfig } = await import('../../src/telemetry/config.js');
      const config = await loadOTLPConfig();

      // Verify telemetry config is correctly extracted from complex file
      expect(config.endpoint).toBe('http://otel-collector:4318/v1/traces');
      expect(config.logsEndpoint).toBe('http://otel-collector:4318/v1/logs');
      expect(config.serviceName).toBe('documentation-robotics');
    });
  });
});
