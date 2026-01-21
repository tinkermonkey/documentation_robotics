# OpenTelemetry Collector Example

**⚠️ NOTE: These are EXAMPLE configurations only**

This directory contains example configurations for running a local OpenTelemetry stack with SigNoz for development and testing purposes. **These are not required** for using the Documentation Robotics CLI.

## What's Included

- `docker-compose.signoz.yml` - Example Docker Compose configuration for a complete SigNoz stack
- `signoz-stack.sh` - Example helper script for managing the SigNoz stack

## When to Use This

Use these examples if you want to:

- Test the CLI's telemetry integration locally
- View traces and logs in a web UI during development
- Learn how to set up an OTEL collector for your own projects

## When NOT to Use This

You don't need this if:

- You already have an OTEL collector running
- You're using a managed observability service
- You don't need telemetry during development

## Usage

### Start the Example Stack

```bash
# From the repository root
./docs/otel_example/signoz-stack.sh start
```

This starts:

- OpenTelemetry Collector (HTTP: `localhost:4318`, gRPC: `localhost:4317`)
- SigNoz UI (`http://localhost:3301`)
- ClickHouse (trace storage)
- Redis (caching)
- Zookeeper (coordination)

### Stop the Stack

```bash
./docs/otel_example/signoz-stack.sh stop
```

### Remove All Data

```bash
./docs/otel_example/signoz-stack.sh clean
```

## Alternative Collectors

You can use any OpenTelemetry-compatible collector instead of this example:

- [Jaeger](https://www.jaegertracing.io/)
- [Zipkin](https://zipkin.io/)
- [Grafana Tempo](https://grafana.com/oss/tempo/)
- [Honeycomb](https://www.honeycomb.io/)
- [Datadog](https://www.datadoghq.com/)
- Or any other OTLP-compatible backend

The CLI will work with any collector that accepts OTLP HTTP on port 4318 or OTLP gRPC on port 4317.

## Customization

To customize the collector configuration:

1. Edit `otel-collector-config.yml` (referenced in `docker-compose.signoz.yml`)
2. Modify exporters, processors, or receivers as needed
3. Restart the stack

## Requirements

- Docker
- Docker Compose

## Maintenance Notice

**These examples are provided as-is** and may not reflect the latest SigNoz or OpenTelemetry versions. For production use, please refer to the official documentation:

- [SigNoz Official Docs](https://signoz.io/docs/)
- [OpenTelemetry Collector Docs](https://opentelemetry.io/docs/collector/)

## Questions?

For CLI telemetry configuration, see:

- [CLI Telemetry Documentation](../../cli/docs/telemetry.md)
- [CLI README - Telemetry Section](../../cli/README.md)
