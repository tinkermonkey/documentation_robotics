# Predicate Catalog Report

## Executive Summary

- **Total Unique Predicates**: 115
- **Total Predicate Usages**: 268
- **XML Relationship Types**: 7
- **Property Patterns**: 119
- **OpenAPI x- Extensions**: 0

## Predicate Usage by Category

| Category | Count | Percentage |
|----------|-------|------------|
| Behavioral | 8 | 3.0% |
| Governance | 36 | 13.4% |
| Other | 191 | 71.3% |
| Structural | 9 | 3.4% |
| Traceability | 24 | 9.0% |

## Behavioral Predicates

| Predicate | Usage Count | Layers | Field Paths |
|-----------|-------------|--------|-------------|
| serving | 4 | 02, 04 | `xml-relationship` |
| access | 2 | 02, 04 | `xml-relationship` |
| triggering | 2 | 02, 04 | `xml-relationship` |

## Governance Predicates

| Predicate | Usage Count | Layers | Field Paths |
|-----------|-------------|--------|-------------|
| governed-by-principles | 20 | 02, 04, 05 | `motivation.governed-by-principles` |
| constrained-by | 16 | 05 | `motivation.constrained-by` |

## Other Predicates

| Predicate | Usage Count | Layers | Field Paths |
|-----------|-------------|--------|-------------|
| version | 8 | 04, 05, 11 | `service.version`, `software.version` |
| sla-target-availability | 6 | 04, 05 | `apm.sla-target-availability` |
| provider | 5 | 05, 11 | `cloud.provider`, `node.provider` |
| license | 5 | 05 | `software.license` |
| classification | 5 | 05 | `security.classification` |
| association | 4 | 01, 05 | `xml-relationship` |
| openapi | 4 | 04 | `spec.openapi` |
| region | 4 | 05, 11 | `cloud.region`, `node.region` |
| health-monitored | 4 | 05 | `apm.health-monitored` |
| format | 4 | 05 | `artifact.format` |
| encryption-required | 4 | 05 | `security.encryption-required` |
| id | 4 | 11 | `product.id`, `user.id` |
| influence | 3 | 01 | `xml-relationship` |
| business-metrics | 3 | 02, 04 | `apm.business-metrics` |
| schema | 3 | 02, 04 | `event.schema`, `spec.schema` |
| sla-target-latency | 3 | 04, 05 | `apm.sla-target-latency` |
| database | 3 | 04, 05 | `spec.database` |
| pii | 3 | 04, 05 | `data.pii`, `security.pii` |
| instance-type | 3 | 05 | `node.instance-type` |
| sla | 3 | 05 | `service.sla` |
| size | 3 | 05 | `artifact.size` |
| encryption-type | 3 | 05 | `security.encryption-type` |
| apm-data-quality-metrics | 3 | 07, 08, 11 | `x-apm-data-quality-metrics` |
| type | 3 | 11 | `error.type`, `exception.type`, `link.type` |
| source | 2 | 01 | `constraint.source`, `requirement.source` |
| security.mitigates | 2 | 01 | `requirement.security.mitigates` |
| security.implementation-type | 2 | 01 | `requirement.security.implementation-type` |
| security.implementation-params | 2 | 01 | `requirement.security.implementation-params` |
| commitment-type | 2 | 01 | `constraint.commitment-type` |
| compliance-requirements | 2 | 01 | `constraint.compliance-requirements` |
| penalties | 2 | 01 | `constraint.penalties` |
| topic | 2 | 02, 04 | `event.topic` |
| async | 2 | 04, 10 | `FlowStep.async`, `function.async` |
| traced | 2 | 04 | `apm.traced` |
| terraform | 2 | 05 | `spec.terraform` |
| cidr | 2 | 05 | `network.cidr` |
| monitoring | 2 | 05 | `service.monitoring` |
| health-check-endpoint | 2 | 05 | `apm.health-check-endpoint` |
| method | 2 | 11 | `http.method` |
| status_code | 2 | 11 | `http.status_code` |
| name | 2 | 11 | `db.name`, `service.name` |
| measurable | 1 | 01 | `goal.measurable` |
| target-date | 1 | 01 | `goal.target-date` |
| kpi | 1 | 01 | `goal.kpi` |
| achieved-date | 1 | 01 | `outcome.achieved-date` |
| metrics | 1 | 01 | `outcome.metrics` |
| rationale | 1 | 01 | `principle.rationale` |
| implications | 1 | 01 | `principle.implications` |
| status | 1 | 01 | `requirement.status` |
| traceability-id | 1 | 01 | `requirement.traceability-id` |
| negotiable | 1 | 01 | `constraint.negotiable` |
| quantifiable | 1 | 01 | `value.quantifiable` |
| measurement | 1 | 01 | `value.measurement` |
| security-actors | 1 | 02 | `collaboration.security-actors` |
| shared-permissions | 1 | 02 | `collaboration.shared-permissions` |
| api-operations | 1 | 02 | `interface.api-operations` |
| digital-channel | 1 | 02 | `interface.digital-channel` |
| bpmn | 1 | 02 | `process.bpmn` |
| security-controls | 1 | 02 | `process.security-controls` |
| audit-required | 1 | 02 | `process.audit-required` |
| separation-of-duty | 1 | 02 | `process.separation-of-duty` |
| kpi-target | 1 | 02 | `process.kpi-target` |
| realized-by-process | 1 | 02 | `application.realized-by-process` |
| process-steps | 1 | 02 | `application.process-steps` |
| application-ref | 1 | 02 | `event.application-ref` |
| availability | 1 | 02 | `sla.availability` |
| response-time | 1 | 02 | `sla.response-time` |
| schema-id | 1 | 02 | `spec.schema-id` |
| governance-owner | 1 | 02 | `data.governance-owner` |
| represented-by-dataobject | 1 | 02 | `application.represented-by-dataobject` |
| master-data-source | 1 | 02 | `application.master-data-source` |
| constraint-refs | 1 | 02 | `contract.constraint-refs` |
| sla-metrics | 1 | 02 | `contract.sla-metrics` |
| framework | 1 | 04 | `implementation.framework` |
| ux | 1 | 04 | `spec.ux` |
| endpoint | 1 | 04 | `interface.endpoint` |
| idempotent | 1 | 04 | `function.idempotent` |
| orchestration | 1 | 04 | `process.orchestration` |
| saga | 1 | 04 | `process.saga` |
| deprecated | 1 | 04 | `service.deprecated` |
| retention | 1 | 04 | `data.retention` |
| manufacturer | 1 | 05 | `device.manufacturer` |
| model | 1 | 05 | `device.model` |
| port | 1 | 05 | `interface.port` |
| url | 1 | 05 | `interface.url` |
| bandwidth | 1 | 05 | `path.bandwidth` |
| latency | 1 | 05 | `path.latency` |
| vlan | 1 | 05 | `network.vlan` |
| automation | 1 | 05 | `process.automation` |
| business-object-ref | 1 | 07 | `x-business-object-ref` |
| apm-performance-metrics | 1 | 08 | `x-apm-performance-metrics` |
| collaboration | 1 | 10 | `FlowStep.collaboration` |
| compensation | 1 | 10 | `FlowStep.compensation` |
| route | 1 | 11 | `http.route` |
| system | 1 | 11 | `db.system` |
| statement | 1 | 11 | `db.statement` |
| message | 1 | 11 | `exception.message` |
| stacktrace | 1 | 11 | `exception.stacktrace` |
| description | 1 | 11 | `link.description` |
| host | 1 | 11 | `db.host` |
| environment | 1 | 11 | `deployment.environment` |
| namespace.name | 1 | 11 | `k8s.namespace.name` |
| pod.name | 1 | 11 | `k8s.pod.name` |
| deployment.name | 1 | 11 | `k8s.deployment.name` |
| request.headers | 1 | 11 | `http.request.headers` |

## Structural Predicates

| Predicate | Usage Count | Layers | Field Paths |
|-----------|-------------|--------|-------------|
| realization | 6 | 01, 02, 04, 05 | `xml-relationship` |
| assignment | 3 | 05 | `xml-relationship` |

## Traceability Predicates

| Predicate | Usage Count | Layers | Field Paths |
|-----------|-------------|--------|-------------|
| fulfills-requirements | 14 | 04, 05 | `motivation.fulfills-requirements` |
| supports-goals | 7 | 02, 04, 05 | `motivation.supports-goals` |
| delivers-value | 3 | 02, 04 | `motivation.delivers-value` |

## XML Relationship Types

Found in `<relationship type="...">` tags:

- access
- assignment
- association
- influence
- realization
- serving
- triggering

## Top 20 Most Used Predicates

| Rank | Predicate | Category | Usage Count |
|------|-----------|----------|-------------|
| 1 | governed-by-principles | Governance | 20 |
| 2 | constrained-by | Governance | 16 |
| 3 | fulfills-requirements | Traceability | 14 |
| 4 | version | Other | 8 |
| 5 | supports-goals | Traceability | 7 |
| 6 | realization | Structural | 6 |
| 7 | sla-target-availability | Other | 6 |
| 8 | provider | Other | 5 |
| 9 | license | Other | 5 |
| 10 | classification | Other | 5 |
| 11 | association | Other | 4 |
| 12 | serving | Behavioral | 4 |
| 13 | openapi | Other | 4 |
| 14 | region | Other | 4 |
| 15 | health-monitored | Other | 4 |
| 16 | format | Other | 4 |
| 17 | encryption-required | Other | 4 |
| 18 | id | Other | 4 |
| 19 | influence | Other | 3 |
| 20 | business-metrics | Other | 3 |
