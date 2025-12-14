# Link Instance Catalog

## Executive Summary

- **Total Link Instances**: 167
- **Unique Link Types Used**: 24
- **XML Relationships**: 176
- **Layers Analyzed**: 12

## Top 20 Most Used Link Types

| Rank | Link Type                           | Name                       | Instances | Layers                                     | Unique Values |
| ---- | ----------------------------------- | -------------------------- | --------- | ------------------------------------------ | ------------- |
| 1    | motivation-governed-by-principles   | Governed By Principles     | 36        | 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12 | 21            |
| 2    | motivation-constrained-by           | Constrained By             | 20        | 05                                         | 12            |
| 3    | motivation-fulfills-requirements    | Fulfills Requirements      | 18        | 04, 05                                     | 15            |
| 4    | motivation-supports-goals           | Supports Goals             | 17        | 02, 04, 05, 06, 07, 08, 09, 10, 11, 12     | 7             |
| 5    | security-classification             | Classification             | 14        | 05, 06, 07, 08, 09, 10, 11, 12             | 4             |
| 6    | apm-sla-target-availability         | Sla Target Availability    | 7         | 04, 05                                     | 3             |
| 7    | security-encryption-required        | Encryption Required        | 6         | 05                                         | 2             |
| 8    | motivation-delivers-value           | Delivers Value             | 5         | 02, 04                                     | 3             |
| 9    | apm-health-monitored                | Health Monitored           | 5         | 05                                         | 2             |
| 10   | security-encryption-type            | Encryption Type            | 5         | 05                                         | 3             |
| 11   | business-apm-business-metrics       | Apm Business Metrics       | 4         | 02, 04                                     | 3             |
| 12   | apm-sla-target-latency              | Sla Target Latency         | 4         | 04, 05                                     | 4             |
| 13   | data-retention                      | Retention                  | 4         | 04                                         | 2             |
| 14   | apm-traced                          | Traced                     | 3         | 04                                         | 2             |
| 15   | security-data-pii                   | Data Pii                   | 3         | 04                                         | 3             |
| 16   | apm-health-check-endpoint           | Health Check Endpoint      | 3         | 05                                         | 2             |
| 17   | security-pii                        | Pii                        | 3         | 05                                         | 2             |
| 18   | security-process-security-controls  | Process Security Controls  | 2         | 02                                         | 2             |
| 19   | security-process-separation-of-duty | Process Separation Of Duty | 2         | 02                                         | 2             |
| 20   | data-governance-owner               | Governance Owner           | 2         | 02                                         | 2             |

## Link Instances by Layer

| Layer | Total Instances | Unique Link Types |
| ----- | --------------- | ----------------- |
| 02    | 72              | 11                |
| 03    | 36              | 1                 |
| 04    | 101             | 10                |
| 05    | 138             | 12                |
| 06    | 67              | 3                 |
| 07    | 67              | 3                 |
| 08    | 67              | 3                 |
| 09    | 67              | 3                 |
| 10    | 67              | 3                 |
| 11    | 67              | 3                 |
| 12    | 67              | 3                 |

## XML Structural Relationships

Found 176 XML relationship declarations:

| Type           | Count | Layers         |
| -------------- | ----- | -------------- |
| access         | 8     | 02, 04         |
| aggregation    | 12    | 01, 02, 03, 04 |
| assignment     | 12    | 02, 03, 04, 05 |
| association    | 12    | 01, 02, 05     |
| authorization  | 2     | 03             |
| composition    | 51    | 02, 03, 04     |
| constrainedby  | 3     | 03             |
| derivedfrom    | 1     | 03             |
| flow           | 3     | 02, 04         |
| influence      | 10    | 01             |
| protects       | 1     | 03             |
| realization    | 14    | 01, 02, 04, 05 |
| reference      | 24    | 03             |
| serving        | 7     | 02, 04         |
| specialization | 6     | 02, 03, 04     |
| triggering     | 7     | 02, 04         |
| uses           | 3     | 03             |

## Detailed Link Type Statistics

### Health Check Endpoint (`apm-health-check-endpoint`)

- **Total Instances**: 3
- **Layers Used**: 05
- **Unique Values**: 2

Sample values:

- `/healthz`
- `/health|/readiness`

### Health Monitored (`apm-health-monitored`)

- **Total Instances**: 5
- **Layers Used**: 05
- **Unique Values**: 2

Sample values:

- `true`
- `true|false`

### Sla Target Availability (`apm-sla-target-availability`)

- **Total Instances**: 7
- **Layers Used**: 04, 05
- **Unique Values**: 3

Sample values:

- `99.9%|99.95%|99.99%`
- `99.95%`
- `99.99%`

### Sla Target Latency (`apm-sla-target-latency`)

- **Total Instances**: 4
- **Layers Used**: 04, 05
- **Unique Values**: 4

Sample values:

- `10ms`
- `200ms`
- `200ms|500ms|1000ms`
- `5ms|10ms|50ms`

### Traced (`apm-traced`)

- **Total Instances**: 3
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

- **Total Instances**: 4
- **Layers Used**: 02, 04
- **Unique Values**: 3

Sample values:

- `metric-id-1,metric-id-2`
- `metric-order-fulfillment-time,metric-order-success-rate`
- `metric-product-views,metric-product-searches,metric-catalog-accuracy`

### Governance Owner (`data-governance-owner`)

- **Total Instances**: 2
- **Layers Used**: 02
- **Unique Values**: 2

Sample values:

- `business-actor-id`
- `sales-rep`

### Retention (`data-retention`)

- **Total Instances**: 4
- **Layers Used**: 04
- **Unique Values**: 2

Sample values:

- `7years`
- `90days|1year|7years`

### Constrained By (`motivation-constrained-by`)

- **Total Instances**: 20
- **Layers Used**: 05
- **Unique Values**: 12

Sample values:

- `constraint-amqp-protocol-required`
- `constraint-aws-infrastructure,constraint-budget-500k`
- `constraint-backup-retention-30days,constraint-disaster-recovery-sla`
- `constraint-data-retention-7years`
- `constraint-eu-data-residency`
- ... and 7 more

### Delivers Value (`motivation-delivers-value`)

- **Total Instances**: 5
- **Layers Used**: 02, 04
- **Unique Values**: 3

Sample values:

- `value-customer-convenience`
- `value-customer-convenience,value-operational-efficiency`
- `value-id-1,value-id-2`

### Fulfills Requirements (`motivation-fulfills-requirements`)

- **Total Instances**: 18
- **Layers Used**: 04, 05
- **Unique Values**: 15

Sample values:

- `req-acid-compliance,req-replication`
- `req-acid-compliance,req-replication,req-backup-recovery`
- `req-acid-transactions,req-encryption-at-rest`
- `req-acid-transactions,req-encryption-at-rest,req-point-in-time-recovery`
- `req-container-support,req-oci-compliance`
- ... and 10 more

### Governed By Principles (`motivation-governed-by-principles`)

- **Total Instances**: 36
- **Layers Used**: 02, 03, 04, 05, 06, 07, 08, 09, 10, 11, 12
- **Unique Values**: 21

Sample values:

- `principle-api-first,principle-cloud-native`
- `principle-api-first,principle-security-by-design`
- `principle-async-messaging,principle-event-driven-architecture`
- `principle-cloud-native,principle-auto-scaling`
- `principle-cloud-native,principle-auto-scaling,principle-containerization`
- ... and 16 more

### Supports Goals (`motivation-supports-goals`)

- **Total Instances**: 17
- **Layers Used**: 02, 04, 05, 06, 07, 08, 09, 10, 11, 12
- **Unique Values**: 7

Sample values:

- `goal-customer-satisfaction,goal-revenue-growth`
- `goal-deployment-automation,goal-horizontal-scaling`
- `goal-example`
- `goal-id-1,goal-id-2`
- `goal-product-catalog-accuracy,goal-customer-satisfaction`
- ... and 2 more

### Classification (`security-classification`)

- **Total Instances**: 14
- **Layers Used**: 05, 06, 07, 08, 09, 10, 11, 12
- **Unique Values**: 4

Sample values:

- `confidential`
- `internal`
- `public|internal|confidential|restricted`
- `restricted`

### Data Pii (`security-data-pii`)

- **Total Instances**: 3
- **Layers Used**: 04
- **Unique Values**: 3

Sample values:

- `false`
- `true`
- `true|false`

### Encryption Required (`security-encryption-required`)

- **Total Instances**: 6
- **Layers Used**: 05
- **Unique Values**: 2

Sample values:

- `true`
- `true|false`

### Encryption Type (`security-encryption-type`)

- **Total Instances**: 5
- **Layers Used**: 05
- **Unique Values**: 3

Sample values:

- `at-rest`
- `at-rest|in-transit|both|end-to-end`
- `both`

### Pii (`security-pii`)

- **Total Instances**: 3
- **Layers Used**: 05
- **Unique Values**: 2

Sample values:

- `true`
- `true|false`

### Process Security Controls (`security-process-security-controls`)

- **Total Instances**: 2
- **Layers Used**: 02
- **Unique Values**: 2

Sample values:

- `control-id-1,control-id-2`
- `control-order-approval,control-payment-verification`

### Process Separation Of Duty (`security-process-separation-of-duty`)

- **Total Instances**: 2
- **Layers Used**: 02
- **Unique Values**: 2

Sample values:

- `true`
- `true|false`
