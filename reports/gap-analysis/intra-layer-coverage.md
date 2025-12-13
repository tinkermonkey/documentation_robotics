# Intra-Layer Relationship Coverage Analysis

**Generated**: Automatically
**Layers Analyzed**: 12
**Coverage Target**: 2+ relationships per entity

## Executive Summary

| Layer | Entities | Meeting Target | Coverage % | Total Relations |
|-------|----------|----------------|------------|-----------------|
| 01-motivation-layer | 10 | 10 | 100.0% | 23 |
| 02-business-layer | 13 | 3 | 23.1% | 5 |
| 03-security-layer | 34 | 0 | 0.0% | 0 |
| 04-application-layer | 9 | 2 | 22.2% | 5 |
| 05-technology-layer | 13 | 1 | 7.7% | 4 |
| 06-api-layer | 26 | 0 | 0.0% | 0 |
| 07-data-model-layer | 19 | 0 | 0.0% | 0 |
| 08-datastore-layer | 10 | 0 | 0.0% | 0 |
| 09-ux-layer | 26 | 0 | 0.0% | 0 |
| 10-navigation-layer | 15 | 0 | 0.0% | 0 |
| 11-apm-observability-layer | 19 | 0 | 0.0% | 0 |
| 12-testing-layer | 17 | 0 | 0.0% | 0 |
| **TOTAL** | **211** | **16** | **7.6%** | **37** |

## Coverage Statistics

- **Total Entities**: 211
- **Entities Meeting Target**: 16/211 (7.6%)
- **Entities Below Target**: 195
- **Total Relationships**: 37
- **Average Relationships per Entity**: 0.2

## Layers Needing Immediate Attention (< 50% Coverage)

- **03-security-layer**: 0.0% (0/34 entities)
- **06-api-layer**: 0.0% (0/26 entities)
- **07-data-model-layer**: 0.0% (0/19 entities)
- **08-datastore-layer**: 0.0% (0/10 entities)
- **09-ux-layer**: 0.0% (0/26 entities)
- **10-navigation-layer**: 0.0% (0/15 entities)
- **11-apm-observability-layer**: 0.0% (0/19 entities)
- **12-testing-layer**: 0.0% (0/17 entities)
- **05-technology-layer**: 7.7% (1/13 entities)
- **04-application-layer**: 22.2% (2/9 entities)
- **02-business-layer**: 23.1% (3/13 entities)

## Critical Gaps by Category

_These relationship types appear frequently across layers but are not in the catalog._

## Recommended Actions

1. **Phase 1 - Layers Below 50% Coverage**
   - Focus on 11 layers with critical coverage gaps
   - Ensure each entity has at least 2 relationships

2. **Phase 2 - Complete Structural Layers** (Business, Application, Technology)
   - Add composition/aggregation relationships where missing
   - Required for ArchiMate compliance

3. **Phase 3 - Technical Layers** (API, Data, UX, Navigation)
   - Define domain-specific intra-layer relationships
   - Focus on entities with 0-1 relationships
