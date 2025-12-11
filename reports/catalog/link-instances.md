# Link Instance Catalog

## Executive Summary

- **Total Link Instances**: 98
- **Unique Link Types Used**: 24
- **XML Relationships**: 24
- **Layers Analyzed**: 12

## Top 20 Most Used Link Types

| Rank | Link Type | Name | Instances | Layers | Unique Values |
|------|-----------|------|-----------|--------|---------------|
| 1 | motivation-governed-by-principles | Governed By Principles | 20 | 02, 04, 05 | 14 |
| 2 | motivation-fulfills-requirements | Fulfills Requirements | 14 | 04, 05 | 11 |
| 3 | motivation-constrained-by | Constrained By | 14 | 05 | 10 |
| 4 | motivation-supports-goals | Supports Goals | 6 | 02, 04, 05 | 4 |
| 5 | apm-sla-target-availability | Sla Target Availability | 5 | 04, 05 | 3 |
| 6 | security-classification | Classification | 5 | 05 | 4 |
| 7 | security-encryption-required | Encryption Required | 4 | 05 | 2 |
| 8 | business-apm-business-metrics | Apm Business Metrics | 3 | 02, 04 | 2 |
| 9 | motivation-delivers-value | Delivers Value | 3 | 02, 04 | 2 |
| 10 | apm-sla-target-latency | Sla Target Latency | 3 | 04, 05 | 3 |
| 11 | apm-health-monitored | Health Monitored | 3 | 05 | 2 |
| 12 | security-encryption-type | Encryption Type | 3 | 05 | 3 |
| 13 | apm-traced | Traced | 2 | 04 | 2 |
| 14 | apm-health-check-endpoint | Health Check Endpoint | 2 | 05 | 2 |
| 15 | security-pii | Pii | 2 | 05 | 2 |
| 16 | security-process-security-controls | Process Security Controls | 1 | 02 | 1 |
| 17 | security-process-separation-of-duty | Process Separation Of Duty | 1 | 02 | 1 |
| 18 | archimate-application-realized-by-process | Application Realized By Process | 1 | 02 | 1 |
| 19 | archimate-application-process-steps | Application Process Steps | 1 | 02 | 1 |
| 20 | data-governance-owner | Governance Owner | 1 | 02 | 1 |

## Link Instances by Layer

| Layer | Total Instances | Unique Link Types |
|-------|-----------------|-------------------|
| 02 | 39 | 11 |
| 04 | 58 | 10 |
| 05 | 81 | 12 |

## XML Structural Relationships

Found 24 XML relationship declarations:

| Type | Count | Layers |
|------|-------|--------|
| Access | 2 | 02, 04 |
| Assignment | 3 | 05 |
| Association | 4 | 01, 05 |
| Influence | 3 | 01 |
| Realization | 6 | 01, 02, 04, 05 |
| Serving | 4 | 02, 04 |
| Triggering | 2 | 02, 04 |

## Detailed Link Type Statistics

### Health Check Endpoint (`apm-health-check-endpoint`)

- **Total Instances**: 2
- **Layers Used**: 05
- **Unique Values**: 2

Sample values:
- `/healthz`
- `/health|/readiness`

### Health Monitored (`apm-health-monitored`)

- **Total Instances**: 3
- **Layers Used**: 05
- **Unique Values**: 2

Sample values:
- `true`
- `true|false`

### Sla Target Availability (`apm-sla-target-availability`)

- **Total Instances**: 5
- **Layers Used**: 04, 05
- **Unique Values**: 3

Sample values:
- `99.9%|99.95%|99.99%`
- `99.95%`
- `99.99%`

### Sla Target Latency (`apm-sla-target-latency`)

- **Total Instances**: 3
- **Layers Used**: 04, 05
- **Unique Values**: 3

Sample values:
- `200ms`
- `200ms|500ms|1000ms`
- `5ms|10ms|50ms`

### Traced (`apm-traced`)

- **Total Instances**: 2
- **Layers Used**: 04
- **Unique Values**: 2

Sample values:
- `true`
- `true|false`

### Application Master Data Source (`archimate-application-master-data-source`)

- **Total Instances**: 1
- **Layers Used**: 02
- **Unique Values**: 1

Sample values:
- `data-object-id`

### Application Process Steps (`archimate-application-process-steps`)

- **Total Instances**: 1
- **Layers Used**: 02
- **Unique Values**: 1

Sample values:
- `step-1,step-2`

### Application Realized By Process (`archimate-application-realized-by-process`)

- **Total Instances**: 1
- **Layers Used**: 02
- **Unique Values**: 1

Sample values:
- `app-process-id`

### Application Represented By Dataobject (`archimate-application-represented-by-dataobject`)

- **Total Instances**: 1
- **Layers Used**: 02
- **Unique Values**: 1

Sample values:
- `data-object-id`

### Apm Business Metrics (`business-apm-business-metrics`)

- **Total Instances**: 3
- **Layers Used**: 02, 04
- **Unique Values**: 2

Sample values:
- `metric-id-1,metric-id-2`
- `metric-product-views,metric-product-searches,metric-catalog-accuracy`

### Governance Owner (`data-governance-owner`)

- **Total Instances**: 1
- **Layers Used**: 02
- **Unique Values**: 1

Sample values:
- `business-actor-id`

### Retention (`data-retention`)

- **Total Instances**: 1
- **Layers Used**: 04
- **Unique Values**: 1

Sample values:
- `90days|1year|7years`

### Constrained By (`motivation-constrained-by`)

- **Total Instances**: 14
- **Layers Used**: 05
- **Unique Values**: 10

Sample values:
- `constraint-amqp-protocol-required`
- `constraint-aws-infrastructure,constraint-budget-500k`
- `constraint-backup-retention-30days,constraint-disaster-recovery-sla`
- `constraint-eu-data-residency,constraint-gdpr-compliance`
- `constraint-gdpr-compliance,constraint-data-retention-7years`
- ... and 5 more

### Delivers Value (`motivation-delivers-value`)

- **Total Instances**: 3
- **Layers Used**: 02, 04
- **Unique Values**: 2

Sample values:
- `value-customer-convenience,value-operational-efficiency`
- `value-id-1,value-id-2`

### Fulfills Requirements (`motivation-fulfills-requirements`)

- **Total Instances**: 14
- **Layers Used**: 04, 05
- **Unique Values**: 11

Sample values:
- `req-acid-compliance,req-replication,req-backup-recovery`
- `req-acid-transactions,req-encryption-at-rest,req-point-in-time-recovery`
- `req-container-support,req-oci-compliance`
- `req-encrypted-communication,req-ipsec-protocol`
- `req-event-driven-processing,req-auto-scaling`
- ... and 6 more

### Governed By Principles (`motivation-governed-by-principles`)

- **Total Instances**: 20
- **Layers Used**: 02, 04, 05
- **Unique Values**: 14

Sample values:
- `principle-api-first,principle-security-by-design`
- `principle-async-messaging,principle-event-driven-architecture`
- `principle-cloud-native,principle-auto-scaling,principle-containerization`
- `principle-cloud-native,principle-container-orchestration`
- `principle-containerization,principle-immutable-infrastructure`
- ... and 9 more

### Supports Goals (`motivation-supports-goals`)

- **Total Instances**: 6
- **Layers Used**: 02, 04, 05
- **Unique Values**: 4

Sample values:
- `goal-deployment-automation,goal-horizontal-scaling`
- `goal-id-1,goal-id-2`
- `goal-product-catalog-accuracy,goal-mobile-app-launch`
- `goal-system-reliability,goal-data-integrity`

### Classification (`security-classification`)

- **Total Instances**: 5
- **Layers Used**: 05
- **Unique Values**: 4

Sample values:
- `confidential`
- `internal`
- `public|internal|confidential|restricted`
- `restricted`

### Data Pii (`security-data-pii`)

- **Total Instances**: 1
- **Layers Used**: 04
- **Unique Values**: 1

Sample values:
- `true|false`

### Encryption Required (`security-encryption-required`)

- **Total Instances**: 4
- **Layers Used**: 05
- **Unique Values**: 2

Sample values:
- `true`
- `true|false`

### Encryption Type (`security-encryption-type`)

- **Total Instances**: 3
- **Layers Used**: 05
- **Unique Values**: 3

Sample values:
- `at-rest`
- `at-rest|in-transit|both|end-to-end`
- `both`

### Pii (`security-pii`)

- **Total Instances**: 2
- **Layers Used**: 05
- **Unique Values**: 2

Sample values:
- `true`
- `true|false`

### Process Security Controls (`security-process-security-controls`)

- **Total Instances**: 1
- **Layers Used**: 02
- **Unique Values**: 1

Sample values:
- `control-id-1,control-id-2`

### Process Separation Of Duty (`security-process-separation-of-duty`)

- **Total Instances**: 1
- **Layers Used**: 02
- **Unique Values**: 1

Sample values:
- `true|false`
