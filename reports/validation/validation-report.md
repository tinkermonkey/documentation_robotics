# Relationship Validation Report

## Executive Summary

❌ **Validation Status**: FAILED

- **Total Issues**: 253
- **Errors**: 156 🔴
- **Warnings**: 97 ⚠️
- **Info**: 0 ℹ️
- **Layers Validated**: 12
- **Links Validated**: 98

## Errors (Must Fix)

| Category | Message | Location | Field Path | Expected | Actual |
|----------|---------|----------|------------|----------|--------|
| schema | Link type 'security-process-security-controls' used in invalid source layer | 02-business-layer.md | `process.security-controls` | One of: 02-business | 02 |
| cardinality | Link expects single value but has multiple | 02-business-layer.md | `process.security-controls` | Single value | control-id-1,control-id-2 |
| schema | Link type 'security-process-separation-of-duty' used in invalid source layer | 02-business-layer.md | `process.separation-of-duty` | One of: 02-business | 02 |
| schema | Link type 'business-apm-business-metrics' used in invalid source layer | 02-business-layer.md | `apm.business-metrics` | One of: 02-business, 04-application, 06-api | 02 |
| cardinality | Link expects single value but has multiple | 02-business-layer.md | `apm.business-metrics` | Single value | metric-id-1,metric-id-2 |
| schema | Link type 'archimate-application-realized-by-process' used in invalid source layer | 02-business-layer.md | `application.realized-by-process` | One of: 02-business | 02 |
| schema | Link type 'archimate-application-process-steps' used in invalid source layer | 02-business-layer.md | `application.process-steps` | One of: 02-business | 02 |
| cardinality | Link expects single value but has multiple | 02-business-layer.md | `application.process-steps` | Single value | step-1,step-2 |
| schema | Link type 'motivation-delivers-value' used in invalid source layer | 02-business-layer.md | `motivation.delivers-value` | One of: 02-business, 04-application | 02 |
| cardinality | Link expects single value but has multiple | 02-business-layer.md | `motivation.delivers-value` | Single value | value-id-1,value-id-2 |
| schema | Link type 'motivation-supports-goals' used in invalid source layer | 02-business-layer.md | `motivation.supports-goals` | One of: 02-business, 04-application, 05-technology, 06-api | 02 |
| cardinality | Link expects single value but has multiple | 02-business-layer.md | `motivation.supports-goals` | Single value | goal-id-1,goal-id-2 |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 02-business-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 02 |
| cardinality | Link expects single value but has multiple | 02-business-layer.md | `motivation.governed-by-principles` | Single value | principle-id-1,principle-id-2 |
| schema | Link type 'data-governance-owner' used in invalid source layer | 02-business-layer.md | `data.governance-owner` | One of: 02-business | 02 |
| schema | Link type 'archimate-application-represented-by-dataobject' used in invalid source layer | 02-business-layer.md | `application.represented-by-dataobject` | One of: 02-business | 02 |
| schema | Link type 'archimate-application-master-data-source' used in invalid source layer | 02-business-layer.md | `application.master-data-source` | One of: 02-business | 02 |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 04-application-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 04 |
| cardinality | Link expects single value but has multiple | 04-application-layer.md | `motivation.fulfills-requirements` | Single value | requirement-id-1,requirement-id-2 |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 04-application-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 04 |
| cardinality | Link expects single value but has multiple | 04-application-layer.md | `motivation.governed-by-principles` | Single value | principle-id-1,principle-id-2 |
| schema | Link type 'apm-traced' used in invalid source layer | 04-application-layer.md | `apm.traced` | One of: 04-application | 04 |
| schema | Link type 'business-apm-business-metrics' used in invalid source layer | 04-application-layer.md | `apm.business-metrics` | One of: 02-business, 04-application, 06-api | 04 |
| cardinality | Link expects single value but has multiple | 04-application-layer.md | `apm.business-metrics` | Single value | metric-id-1,metric-id-2 |
| schema | Link type 'apm-sla-target-latency' used in invalid source layer | 04-application-layer.md | `apm.sla-target-latency` | One of: 04-application, 05-technology, 06-api | 04 |
| schema | Link type 'apm-sla-target-availability' used in invalid source layer | 04-application-layer.md | `apm.sla-target-availability` | One of: 04-application, 05-technology, 06-api | 04 |
| schema | Link type 'motivation-supports-goals' used in invalid source layer | 04-application-layer.md | `motivation.supports-goals` | One of: 02-business, 04-application, 05-technology, 06-api | 04 |
| cardinality | Link expects single value but has multiple | 04-application-layer.md | `motivation.supports-goals` | Single value | goal-id-1,goal-id-2 |
| schema | Link type 'motivation-delivers-value' used in invalid source layer | 04-application-layer.md | `motivation.delivers-value` | One of: 02-business, 04-application | 04 |
| cardinality | Link expects single value but has multiple | 04-application-layer.md | `motivation.delivers-value` | Single value | value-id-1,value-id-2 |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 04-application-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 04 |
| cardinality | Link expects single value but has multiple | 04-application-layer.md | `motivation.governed-by-principles` | Single value | principle-id-1,principle-id-2 |
| schema | Link type 'apm-traced' used in invalid source layer | 04-application-layer.md | `apm.traced` | One of: 04-application | 04 |
| schema | Link type 'business-apm-business-metrics' used in invalid source layer | 04-application-layer.md | `apm.business-metrics` | One of: 02-business, 04-application, 06-api | 04 |
| cardinality | Link expects single value but has multiple | 04-application-layer.md | `apm.business-metrics` | Single value | metric-product-views,metric-product-searches,metric-catalog-accuracy |
| schema | Link type 'apm-sla-target-latency' used in invalid source layer | 04-application-layer.md | `apm.sla-target-latency` | One of: 04-application, 05-technology, 06-api | 04 |
| schema | Link type 'apm-sla-target-availability' used in invalid source layer | 04-application-layer.md | `apm.sla-target-availability` | One of: 04-application, 05-technology, 06-api | 04 |
| schema | Link type 'motivation-supports-goals' used in invalid source layer | 04-application-layer.md | `motivation.supports-goals` | One of: 02-business, 04-application, 05-technology, 06-api | 04 |
| cardinality | Link expects single value but has multiple | 04-application-layer.md | `motivation.supports-goals` | Single value | goal-product-catalog-accuracy,goal-mobile-app-launch |
| schema | Link type 'motivation-delivers-value' used in invalid source layer | 04-application-layer.md | `motivation.delivers-value` | One of: 02-business, 04-application | 04 |
| cardinality | Link expects single value but has multiple | 04-application-layer.md | `motivation.delivers-value` | Single value | value-customer-convenience,value-operational-efficiency |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 04-application-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 04 |
| cardinality | Link expects single value but has multiple | 04-application-layer.md | `motivation.governed-by-principles` | Single value | principle-api-first,principle-security-by-design |
| schema | Link type 'security-data-pii' used in invalid source layer | 04-application-layer.md | `data.pii` | One of: 04-application | 04 |
| schema | Link type 'data-retention' used in invalid source layer | 04-application-layer.md | `data.retention` | One of: 04-application | 04 |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-id-1,principle-id-2 |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.constrained-by` | Single value | constraint-id-1,constraint-id-2 |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | requirement-id-1,requirement-id-2 |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-cloud-native,principle-auto-scaling,principle-containerization |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.constrained-by` | Single value | constraint-aws-infrastructure,constraint-budget-500k |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | req-horizontal-scaling,req-99-95-availability,req-container-orchestration |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-high-availability,principle-data-durability |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | req-acid-compliance,req-replication,req-backup-recovery |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-serverless-first,principle-pay-per-use |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | req-event-driven-processing,req-auto-scaling |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-id-1,principle-id-2 |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.constrained-by` | Single value | constraint-id-1,constraint-id-2 |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | requirement-id-1,requirement-id-2 |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-open-source-first,principle-acid-compliance,principle-data-integrity |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.constrained-by` | Single value | constraint-no-proprietary-licenses,constraint-gdpr-compliance |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | req-acid-transactions,req-encryption-at-rest,req-point-in-time-recovery |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-containerization,principle-immutable-infrastructure |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | req-container-support,req-oci-compliance |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-high-performance,principle-reverse-proxy |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | req-tls-termination,req-load-balancing,req-http2-support |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-async-messaging,principle-event-driven-architecture |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | req-message-persistence,req-message-ordering,req-delivery-guarantees |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-id-1,principle-id-2 |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.constrained-by` | Single value | constraint-id-1,constraint-id-2 |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | requirement-id-1,requirement-id-2 |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-zero-trust,principle-network-segmentation,principle-defense-in-depth |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.constrained-by` | Single value | constraint-eu-data-residency,constraint-gdpr-compliance |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | req-network-isolation,req-dmz-architecture,req-private-subnet-isolation |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-encrypted-transit,principle-secure-connectivity |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | req-encrypted-communication,req-ipsec-protocol |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-edge-caching,principle-low-latency |
| schema | Link type 'motivation-fulfills-requirements' used in invalid source layer | 05-technology-layer.md | `motivation.fulfills-requirements` | One of: 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.fulfills-requirements` | Single value | req-global-distribution,req-sub-100ms-response |
| schema | Link type 'motivation-supports-goals' used in invalid source layer | 05-technology-layer.md | `motivation.supports-goals` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.supports-goals` | Single value | goal-id-1,goal-id-2 |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-id-1,principle-id-2 |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.constrained-by` | Single value | constraint-id-1,constraint-id-2 |
| schema | Link type 'apm-sla-target-availability' used in invalid source layer | 05-technology-layer.md | `apm.sla-target-availability` | One of: 04-application, 05-technology, 06-api | 05 |
| schema | Link type 'apm-sla-target-latency' used in invalid source layer | 05-technology-layer.md | `apm.sla-target-latency` | One of: 04-application, 05-technology, 06-api | 05 |
| schema | Link type 'apm-health-monitored' used in invalid source layer | 05-technology-layer.md | `apm.health-monitored` | One of: 05-technology | 05 |
| schema | Link type 'apm-health-check-endpoint' used in invalid source layer | 05-technology-layer.md | `apm.health-check-endpoint` | One of: 05-technology | 05 |
| schema | Link type 'motivation-supports-goals' used in invalid source layer | 05-technology-layer.md | `motivation.supports-goals` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.supports-goals` | Single value | goal-system-reliability,goal-data-integrity |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-open-source-first,principle-acid-compliance |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| schema | Link type 'apm-sla-target-availability' used in invalid source layer | 05-technology-layer.md | `apm.sla-target-availability` | One of: 04-application, 05-technology, 06-api | 05 |
| schema | Link type 'apm-health-monitored' used in invalid source layer | 05-technology-layer.md | `apm.health-monitored` | One of: 05-technology | 05 |
| schema | Link type 'motivation-supports-goals' used in invalid source layer | 05-technology-layer.md | `motivation.supports-goals` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.supports-goals` | Single value | goal-deployment-automation,goal-horizontal-scaling |
| schema | Link type 'motivation-governed-by-principles' used in invalid source layer | 05-technology-layer.md | `motivation.governed-by-principles` | One of: 02-business, 04-application, 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.governed-by-principles` | Single value | principle-cloud-native,principle-container-orchestration |
| schema | Link type 'apm-sla-target-availability' used in invalid source layer | 05-technology-layer.md | `apm.sla-target-availability` | One of: 04-application, 05-technology, 06-api | 05 |
| schema | Link type 'apm-health-monitored' used in invalid source layer | 05-technology-layer.md | `apm.health-monitored` | One of: 05-technology | 05 |
| schema | Link type 'apm-health-check-endpoint' used in invalid source layer | 05-technology-layer.md | `apm.health-check-endpoint` | One of: 05-technology | 05 |
| schema | Link type 'security-encryption-required' used in invalid source layer | 05-technology-layer.md | `security.encryption-required` | One of: 05-technology | 05 |
| schema | Link type 'security-encryption-type' used in invalid source layer | 05-technology-layer.md | `security.encryption-type` | One of: 05-technology | 05 |
| schema | Link type 'security-classification' used in invalid source layer | 05-technology-layer.md | `security.classification` | One of: 05-technology | 05 |
| schema | Link type 'security-pii' used in invalid source layer | 05-technology-layer.md | `security.pii` | One of: 05-technology, 06-api | 05 |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.constrained-by` | Single value | constraint-id-1,constraint-id-2 |
| schema | Link type 'security-encryption-required' used in invalid source layer | 05-technology-layer.md | `security.encryption-required` | One of: 05-technology | 05 |
| schema | Link type 'security-encryption-type' used in invalid source layer | 05-technology-layer.md | `security.encryption-type` | One of: 05-technology | 05 |
| schema | Link type 'security-classification' used in invalid source layer | 05-technology-layer.md | `security.classification` | One of: 05-technology | 05 |
| schema | Link type 'security-pii' used in invalid source layer | 05-technology-layer.md | `security.pii` | One of: 05-technology, 06-api | 05 |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.constrained-by` | Single value | constraint-gdpr-compliance,constraint-data-retention-7years |
| schema | Link type 'security-encryption-required' used in invalid source layer | 05-technology-layer.md | `security.encryption-required` | One of: 05-technology | 05 |
| schema | Link type 'security-classification' used in invalid source layer | 05-technology-layer.md | `security.classification` | One of: 05-technology | 05 |
| schema | Link type 'security-classification' used in invalid source layer | 05-technology-layer.md | `security.classification` | One of: 05-technology | 05 |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| schema | Link type 'security-encryption-required' used in invalid source layer | 05-technology-layer.md | `security.encryption-required` | One of: 05-technology | 05 |
| schema | Link type 'security-encryption-type' used in invalid source layer | 05-technology-layer.md | `security.encryption-type` | One of: 05-technology | 05 |
| schema | Link type 'security-classification' used in invalid source layer | 05-technology-layer.md | `security.classification` | One of: 05-technology | 05 |
| schema | Link type 'motivation-constrained-by' used in invalid source layer | 05-technology-layer.md | `motivation.constrained-by` | One of: 05-technology, 06-api | 05 |
| cardinality | Link expects single value but has multiple | 05-technology-layer.md | `motivation.constrained-by` | Single value | constraint-backup-retention-30days,constraint-disaster-recovery-sla |

## Warnings (Should Fix)

| Category | Message | Location | Field Path | Suggestion |
|----------|---------|----------|------------|------------|
| format | Value does not match duration format | 02-business-layer.md | `process.separation-of-duty` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 02-business-layer.md | `apm.business-metrics` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 02-business-layer.md | `apm.business-metrics` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 02-business-layer.md | `application.realized-by-process` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 02-business-layer.md | `application.process-steps` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 02-business-layer.md | `application.process-steps` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 02-business-layer.md | `data.governance-owner` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `apm.traced` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `apm.business-metrics` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `apm.business-metrics` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `apm.sla-target-latency` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match percentage format | 04-application-layer.md | `apm.sla-target-availability` | Use format: <number>% |
| format | Value does not match duration format | 04-application-layer.md | `apm.traced` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `apm.business-metrics` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `apm.business-metrics` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `apm.business-metrics` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `data.pii` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 04-application-layer.md | `data.retention` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.fulfills-requirements` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match percentage format | 05-technology-layer.md | `apm.sla-target-availability` | Use format: <number>% |
| format | Value does not match duration format | 05-technology-layer.md | `apm.sla-target-latency` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `apm.health-monitored` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `apm.health-check-endpoint` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `apm.health-monitored` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `apm.health-monitored` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `apm.health-check-endpoint` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.encryption-required` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.encryption-type` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.classification` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.pii` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.encryption-required` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.encryption-type` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.classification` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.pii` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.encryption-required` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.classification` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.classification` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.encryption-required` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.encryption-type` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `security.classification` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |
| format | Value does not match duration format | 05-technology-layer.md | `motivation.constrained-by` | Use format: <number><unit> where unit is ms/s/m/h |

## Issues by Category

| Category | Count |
|----------|-------|
| schema | 98 |
| format | 97 |
| cardinality | 58 |
