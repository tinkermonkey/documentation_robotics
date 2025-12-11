# Link Coverage Analysis Report

## Executive Summary

- **Layers Analyzed**: 12
- **Link Types in Registry**: 38
- **Link Types Found in Docs**: 24
- **Coverage**: 63.2%
- **Unused Link Types**: 14
- **Links Not in Registry**: 133

## Coverage by Layer

| Layer | Name | Entity Types | Types with Links | Outgoing | Incoming | Field Paths |
|-------|------|--------------|------------------|----------|----------|-------------|
| 01 | Motivation Layer | 10 | 8 (80%) | 0 | 0 | 20 |
| 02 | Business Layer | 14 | 8 (57%) | 0 | 0 | 26 |
| 03 | Security Layer | 23 | 0 (0%) | 0 | 0 | 0 |
| 04 | Application Layer | 9 | 7 (78%) | 0 | 0 | 24 |
| 05 | Technology Layer | 13 | 10 (77%) | 0 | 0 | 32 |
| 06 | API Layer | 25 | 3 (12%) | 0 | 0 | 0 |
| 07 | Data Model Layer | 7 | 5 (71%) | 0 | 0 | 2 |
| 08 | Datastore Layer | 10 | 0 (0%) | 0 | 0 | 2 |
| 09 | UX Layer | 0 | 1 (N/A) | 0 | 0 | 0 |
| 10 | Navigation Layer | 15 | 0 (0%) | 0 | 0 | 0 |
| 11 | APM/Observability Layer | 18 | 9 (50%) | 0 | 0 | 25 |
| 12 | Testing Layer | 15 | 0 (0%) | 0 | 0 | 0 |

## Layer-to-Layer Link Coverage

Number of link types between layer pairs:

| From \ To | 01-motivation | 02-business | 03-security | 04-application | 05-technology | 06-api | 07-data-model | 11-apm |
|---|---|---|---|---|---|---|---|---|
| 01-motivation | - | - | - | - | - | - | - | - |
| 02-business | 3 | 1 | 2 | 4 | - | - | 1 | - |
| 03-security | - | - | - | - | - | - | - | - |
| 04-application | 4 | 1 | 1 | - | - | - | 1 | 3 |
| 05-technology | 4 | - | 4 | - | - | - | - | 4 |
| 06-api | 4 | 3 | 4 | 1 | - | - | 2 | 4 |
| 07-data-model | - | 1 | - | 1 | - | - | 3 | - |
| 11-apm | - | - | - | - | - | - | - | - |

## Unused Link Types

The following link types are defined in the registry but not found in any layer documentation:

- **apm-criticality**: Criticality (x-apm-criticality)
- **apm-trace**: Trace (x-apm-trace)
- **archimate-ref**: Ref (x-archimate-ref)
- **business-interface-ref**: Interface Ref (x-business-interface-ref)
- **business-object-ref**: Object Ref (x-business-object-ref)
- **business-service-ref**: Service Ref (x-business-service-ref)
- **data-apm-data-quality-metrics**: Apm Data Quality Metrics (x-apm-data-quality-metrics)
- **data-governance**: Governance (x-data-governance)
- **database**: Database (x-database)
- **database-column**: Database Column (x-database-column)
- **database-table**: Database Table (x-database-table)
- **security-encrypted**: Encrypted (x-encrypted)
- **security-required-permissions**: Required Permissions (x-required-permissions)
- **security-resource**: Resource (x-security-resource)

## Field Paths Not in Registry

The following field paths are used in documentation but not defined in link-registry.json:

- `goal.measurable` (Layer 01)
- `goal.target-date` (Layer 01)
- `goal.kpi` (Layer 01)
- `outcome.achieved-date` (Layer 01)
- `outcome.metrics` (Layer 01)
- `principle.rationale` (Layer 01)
- `principle.implications` (Layer 01)
- `requirement.source` (Layer 01)
- `requirement.status` (Layer 01)
- `requirement.traceability-id` (Layer 01)
- `requirement.security.mitigates` (Layer 01)
- `requirement.security.implementation-type` (Layer 01)
- `requirement.security.implementation-params` (Layer 01)
- `constraint.source` (Layer 01)
- `constraint.negotiable` (Layer 01)
- `constraint.commitment-type` (Layer 01)
- `constraint.compliance-requirements` (Layer 01)
- `constraint.penalties` (Layer 01)
- `value.quantifiable` (Layer 01)
- `value.measurement` (Layer 01)
- `collaboration.security-actors` (Layer 02)
- `collaboration.shared-permissions` (Layer 02)
- `interface.api-operations` (Layer 02)
- `interface.digital-channel` (Layer 02)
- `process.bpmn` (Layer 02)
- `process.audit-required` (Layer 02)
- `process.kpi-target` (Layer 02)
- `event.application-ref` (Layer 02)
- `event.topic` (Layer 02)
- `sla.availability` (Layer 02)
- `sla.response-time` (Layer 02)
- `spec.schema` (Layer 02)
- `spec.schema-id` (Layer 02)
- `contract.constraint-refs` (Layer 02)
- `contract.sla-metrics` (Layer 02)
- `implementation.framework` (Layer 04)
- `spec.ux` (Layer 04)
- `spec.openapi` (Layer 04)
- `interface.endpoint` (Layer 04)
- `function.async` (Layer 04)
- `function.idempotent` (Layer 04)
- `process.orchestration` (Layer 04)
- `process.saga` (Layer 04)
- `event.schema` (Layer 04)
- `service.version` (Layer 04)
- `service.deprecated` (Layer 04)
- `spec.database` (Layer 04)
- `node.provider` (Layer 05)
- `node.instance-type` (Layer 05)
- `node.region` (Layer 05)
- `spec.terraform` (Layer 05)
- `device.manufacturer` (Layer 05)
- `device.model` (Layer 05)
- `software.version` (Layer 05)
- `software.license` (Layer 05)
- `interface.port` (Layer 05)
- `interface.url` (Layer 05)
- `path.bandwidth` (Layer 05)
- `path.latency` (Layer 05)
- `network.cidr` (Layer 05)
- `network.vlan` (Layer 05)
- `process.automation` (Layer 05)
- `service.sla` (Layer 05)
- `service.monitoring` (Layer 05)
- `artifact.format` (Layer 05)
- `artifact.size` (Layer 05)
- `http.method` (Layer 11)
- `http.route` (Layer 11)
- `http.status_code` (Layer 11)
- `db.system` (Layer 11)
- `db.statement` (Layer 11)
- `db.name` (Layer 11)
- `exception.type` (Layer 11)
- `exception.message` (Layer 11)
- `exception.stacktrace` (Layer 11)
- `product.id` (Layer 11)
- `user.id` (Layer 11)
- `link.type` (Layer 11)
- `link.description` (Layer 11)
- `error.type` (Layer 11)
- `db.host` (Layer 11)
- `service.name` (Layer 11)
- `deployment.environment` (Layer 11)
- `k8s.namespace.name` (Layer 11)
- `k8s.pod.name` (Layer 11)
- `k8s.deployment.name` (Layer 11)
- `cloud.provider` (Layer 11)
- `cloud.region` (Layer 11)
- `http.request.headers` (Layer 11)

## Potential Bidirectional Relationships

The following relationship pairs may benefit from bidirectional modeling:

- realizes (missing) ⇄ realized-by
- supports-goals ⇄ supported-by (missing)
- fulfills-requirements ⇄ fulfilled-by (missing)
- delivers-value ⇄ delivered-by (missing)
- constrains (missing) ⇄ constrained-by
