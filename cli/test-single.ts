import { describe, it, expect, beforeEach } from 'bun:test';

beforeEach(() => {
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  delete process.env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT;
  delete process.env.OTEL_SERVICE_NAME;
});

describe('loadOTLPConfig()', () => {
  describe('Default Configuration', () => {
    it('should return defaults when no env vars or config file', async () => {
      const { loadOTLPConfig } = await import('./src/telemetry/config.js');
      const config = await loadOTLPConfig();
      console.log('Config:', config);
      expect(config).toEqual({
        endpoint: 'http://localhost:4318/v1/traces',
        logsEndpoint: 'http://localhost:4318/v1/logs',
        serviceName: 'dr-cli',
      });
    });
  });
});
