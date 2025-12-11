# Relationship Matrix Report

## Overview

This report provides various matrix views of the Documentation Robotics ontology,
showing relationships between layers, predicate usage, and category distribution.

### Layer-to-Layer Relationship Matrix

Shows the number of link types connecting each pair of layers. Total: 56 link types.

| From \ To | 01-motivation | 02-business | 03-security | 04-application | 05-technology | 06-api | 07-data-model | 11-apm | Total |
|---|---|---|---|---|---|---|---|---|---|
| 01-motivation | - | - | - | - | - | - | - | - | 0 |
| 02-business | 3 | 1 | 2 | 4 | - | - | 1 | - | 11 |
| 03-security | - | - | - | - | - | - | - | - | 0 |
| 04-application | 4 | 1 | 1 | - | - | - | 1 | 3 | 10 |
| 05-technology | 4 | - | 4 | - | - | - | - | 4 | 12 |
| 06-api | 4 | 3 | 4 | 1 | - | - | 2 | 4 | 18 |
| 07-data-model | - | 1 | - | 1 | - | - | 3 | - | 5 |
| 11-apm | - | - | - | - | - | - | - | - | 0 |
| **Total** | 15 | 6 | 11 | 6 | 0 | 0 | 7 | 11 | 56 |

### Category Usage Matrix

Shows which link categories are used by each layer.

| From \ To | 02-business | 04-application | 05-technology | 06-api | 07-data-model | Total |
|---|---|---|---|---|---|---|
| api | - | - | - | - | - | 0 |
| apm | - | 3 | 4 | 4 | - | 11 |
| archimate | 4 | - | - | 1 | 1 | 6 |
| business | 1 | 1 | - | 3 | 1 | 6 |
| data | 1 | 1 | - | 2 | 3 | 7 |
| datastore | - | - | - | - | - | 0 |
| motivation | 3 | 4 | 4 | 4 | - | 15 |
| navigation | - | - | - | - | - | 0 |
| security | 2 | 1 | 4 | 4 | - | 11 |
| ux | - | - | - | - | - | 0 |
| **Total** | 11 | 10 | 12 | 18 | 5 | 56 |

### Predicate Frequency Matrix

Shows which predicates are used in which layers. (Top 20 predicates shown)

| From \ To | 02-business | 04-application | 05-technology | 06-api | 07-data-model | Total |
|---|---|---|---|---|---|---|
| apm-business-metrics | 1 | 1 | - | 1 | - | 3 |
| apm-criticality | - | - | - | 1 | - | 1 |
| apm-data-quality-metrics | - | - | - | - | 1 | 1 |
| apm-sla-target-availability | - | 1 | 1 | 1 | - | 3 |
| apm-sla-target-latency | - | 1 | 1 | 1 | - | 3 |
| apm-trace | - | - | - | 1 | - | 1 |
| archimate-ref | - | - | - | 1 | 1 | 2 |
| business-interface-ref | - | - | - | 1 | - | 1 |
| business-metrics | 1 | 1 | - | 1 | - | 3 |
| business-object-ref | - | - | - | - | 1 | 1 |
| business-service-ref | - | - | - | 1 | - | 1 |
| classification | - | - | 1 | - | - | 1 |
| constrained-by | - | - | 2 | 2 | - | 4 |
| data-governance | - | - | - | - | 1 | 1 |
| database | - | - | - | - | 1 | 1 |
| database-column | - | - | - | 1 | - | 1 |
| database-table | - | - | - | 1 | - | 1 |
| delivers-value | 1 | 1 | - | - | - | 2 |
| encrypted | - | - | - | 1 | - | 1 |
| encryption-required | - | - | 1 | - | - | 1 |
| encryption-type | - | - | 1 | - | - | 1 |
| fulfills-requirements | - | 2 | 2 | 2 | - | 6 |
| governance-owner | 1 | - | - | - | - | 1 |
| governed-by-principles | 2 | 2 | 2 | 2 | - | 8 |
| health-check-endpoint | - | - | 1 | - | - | 1 |
| health-monitored | - | - | 1 | - | - | 1 |
| master-data-source | 1 | - | - | - | - | 1 |
| pii | - | 1 | 2 | 2 | - | 5 |
| process-steps | 1 | - | - | - | - | 1 |
| realized-by-process | 1 | - | - | - | - | 1 |
| represented-by-dataobject | 1 | - | - | - | - | 1 |
| required-permissions | - | - | - | 1 | - | 1 |
| retention | - | 1 | - | - | - | 1 |
| security-controls | 1 | - | - | - | - | 1 |
| security-resource | - | - | - | 1 | - | 1 |
| separation-of-duty | 1 | - | - | - | - | 1 |
| sla-target-availability | - | 1 | 1 | 1 | - | 3 |
| sla-target-latency | - | 1 | 1 | 1 | - | 3 |
| supports-goals | 2 | 2 | 2 | 2 | - | 8 |
| traced | - | 1 | - | - | - | 1 |
| **Total** | 14 | 16 | 19 | 26 | 5 | 80 |

### Top 20 Predicate Frequency Matrix

Shows the most frequently used predicates across layers.

| From \ To | 02-business | 04-application | 05-technology | 06-api | 07-data-model | Total |
|---|---|---|---|---|---|---|
| governed-by-principles | 2 | 2 | 2 | 2 | - | 8 |
| supports-goals | 2 | 2 | 2 | 2 | - | 8 |
| fulfills-requirements | - | 2 | 2 | 2 | - | 6 |
| pii | - | 1 | 2 | 2 | - | 5 |
| constrained-by | - | - | 2 | 2 | - | 4 |
| apm-business-metrics | 1 | 1 | - | 1 | - | 3 |
| apm-sla-target-availability | - | 1 | 1 | 1 | - | 3 |
| apm-sla-target-latency | - | 1 | 1 | 1 | - | 3 |
| business-metrics | 1 | 1 | - | 1 | - | 3 |
| sla-target-availability | - | 1 | 1 | 1 | - | 3 |
| sla-target-latency | - | 1 | 1 | 1 | - | 3 |
| archimate-ref | - | - | - | 1 | 1 | 2 |
| delivers-value | 1 | 1 | - | - | - | 2 |
| apm-criticality | - | - | - | 1 | - | 1 |
| apm-data-quality-metrics | - | - | - | - | 1 | 1 |
| apm-trace | - | - | - | 1 | - | 1 |
| business-interface-ref | - | - | - | 1 | - | 1 |
| business-object-ref | - | - | - | - | 1 | 1 |
| business-service-ref | - | - | - | 1 | - | 1 |
| classification | - | - | 1 | - | - | 1 |
| **Total** | 14 | 16 | 19 | 26 | 5 | 60 |
