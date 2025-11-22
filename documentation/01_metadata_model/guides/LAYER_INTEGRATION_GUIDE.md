# Layer Integration Guide - Security, Motivation & Business Layers

## Overview

This guide explains how the Security Layer integrates with the Motivation Layer (WHY) and Business Layer (WHO) to provide comprehensive, traceable security modeling without duplication.

## Architecture Philosophy

### Layered Concerns

```
┌─────────────────────────────────────────────────────────────┐
│                    MOTIVATION LAYER (WHY)                    │
│  • Stakeholders - who cares                                  │
│  • Goals - what we want to achieve                           │
│  • Requirements - what must be done (including security)     │
│  • Assessments - threats, risks, gaps                        │
│  • Constraints - regulatory/contractual commitments          │
└──────────────────────┬──────────────────────────────────────┘
                       │ references
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                     BUSINESS LAYER (WHO)                     │
│  • BusinessActors - organizational entities                  │
│  • BusinessRoles - responsibilities                          │
│  • BusinessServices - value delivered                        │
└──────────────────────┬──────────────────────────────────────┘
                       │ references
                       ↓
┌─────────────────────────────────────────────────────────────┐
│                    SECURITY LAYER (WHAT/HOW)                 │
│  • Actors - security actors (refs Business & Motivation)     │
│  • Objectives - security goals (refs Motivation Goals)       │
│  • Threats - technical threats (refs Assessments)            │
│  • Implementation - roles, permissions, policies             │
│  • Mitigation - references Requirements for controls         │
└─────────────────────────────────────────────────────────────┘
```

### Single Source of Truth

| Concept | Defined In | Referenced By |
|---------|-----------|---------------|
| **Business Actors** | Business Layer | Security Layer (Actor.businessActorRef) |
| **Stakeholders** | Motivation Layer | Security Layer (Actor.stakeholderRef) |
| **Goals** | Motivation Layer | Security Layer (ActorObjective.motivationGoalRef) |
| **Requirements** | Motivation Layer | Security Layer (Threat.mitigatedByRequirements) |
| **Assessments** | Motivation Layer | Security Layer (Threat.assessmentRef) |
| **Constraints** | Motivation Layer | Security Layer (SocialDependency.commitmentRefs) |

## Key Refactoring Changes (v2.0)

### 1. Renamed Entities

| Old Name | New Name | Reason |
|----------|----------|--------|
| `Goal` (Security Layer) | `ActorObjective` | Avoid conflict with Motivation Goal |

### 2. Removed Entities (Now Use Motivation Layer)

| Removed Entity | Replacement | Location |
|----------------|-------------|----------|
| `SecurityRequirement` | `Requirement` with security properties | Motivation Layer |
| `SocialCommitment` | `Constraint` with compliance properties | Motivation Layer |

### 3. Added Cross-References

| Security Entity | New Reference Field | Target Layer | Target Entity |
|-----------------|---------------------|--------------|---------------|
| `Actor` | `businessActorRef` | Business | BusinessActor |
| `Actor` | `stakeholderRef` | Motivation | Stakeholder |
| `ActorObjective` | `motivationGoalRef` | Motivation | Goal |
| `Threat` | `assessmentRef` | Motivation | Assessment |
| `Threat` | `mitigatedByRequirements` | Motivation | Requirement[] |
| `SocialDependency` | `commitmentRefs` | Motivation | Constraint[] |

## Complete Integration Example

### Step 1: Define in Motivation Layer (WHY)

```yaml
# File: motivation/product-security-motivation.yaml

# Stakeholder
stakeholders:
  - id: "stakeholder-product-manager"
    name: "Product Manager"
    type: internal
    documentation: "Responsible for product catalog and pricing"

# Business Goal
goals:
  - id: "goal-pricing-accuracy"
    name: "Ensure Pricing Accuracy"
    priority: critical
    properties:
      - key: "goal.measurable"
        value: "true"
      - key: "goal.kpi"
        value: "Zero unauthorized price changes, dual approval for changes >$100"

# Risk Assessment
assessments:
  - id: "assessment-pricing-manipulation-risk"
    name: "Risk of Unauthorized Price Manipulation"
    assessmentType: threat
    documentation: "Malicious insiders could manipulate prices causing financial loss and reputation damage"

# Security Requirements (with security properties)
requirements:
  - id: "req-dual-control-pricing"
    name: "Require Dual Approval for Significant Price Changes"
    requirementType: compliance
    priority: high
    documentation: "Price changes over $100 require approval from two different roles"
    properties:
      # Security implementation details
      - key: "requirement.security.mitigates"
        value: "unauthorized-price-change"
      - key: "requirement.security.implementation-type"
        value: "separation-of-duty"
      - key: "requirement.security.implementation-params"
        value: |
          {
            "requiredApprovers": 2,
            "fromRoles": ["finance", "product-manager"],
            "threshold": {"field": "priceChange", "operator": "greaterThan", "value": 100}
          }

  - id: "req-price-audit-trail"
    name: "Comprehensive Audit Trail for Price Changes"
    requirementType: compliance
    priority: high
    properties:
      - key: "requirement.security.mitigates"
        value: "unauthorized-price-change"
      - key: "requirement.security.implementation-type"
        value: "audit"

# Regulatory Constraint
constraints:
  - id: "constraint-inventory-sla"
    name: "Vendor Inventory Accuracy SLA"
    constraintType: regulatory
    documentation: "External vendor must maintain inventory accuracy per contract"
    properties:
      - key: "constraint.commitment-type"
        value: "service-level"
      - key: "constraint.compliance-requirements"
        value: '["99% accuracy on inventory levels", "updates within 15 minutes"]'
      - key: "constraint.penalties"
        value: "Service credits for SLA violations"
```

### Step 2: Define in Business Layer (WHO)

```yaml
# File: business/product-actors.yaml

businessActors:
  - id: "business-actor-product-manager"
    name: "Product Manager"
    documentation: "Business role responsible for product management"
```

### Step 3: Implement in Security Layer (WHAT/HOW)

```yaml
# File: security/product-security.yaml
version: "2.0.0"
application: "product-management"

# Actor with cross-layer references
actors:
  - id: "product-manager-actor"
    name: "Product Manager"
    type: role
    businessActorRef: "business-actor-product-manager"  # → Business Layer
    stakeholderRef: "stakeholder-product-manager"        # → Motivation Layer
    objectives:
      - id: "ensure-pricing-accuracy"
        description: "Ensure pricing is accurate and approved"
        criticality: critical
        motivationGoalRef: "goal-pricing-accuracy"      # → Motivation Layer

# Threat linked to Assessment and mitigated by Requirements
threats:
  - id: "unauthorized-price-change"
    name: "Unauthorized Price Manipulation"
    description: "Malicious insider changes product prices without approval"
    threatens: ["product-pricing", "ensure-pricing-accuracy"]
    threatActors: ["malicious-insider", "compromised-editor"]
    likelihood: medium
    impact: high
    assessmentRef: "assessment-pricing-manipulation-risk"  # → Motivation Assessment
    mitigatedByRequirements:                                # → Motivation Requirements
      - "req-dual-control-pricing"
      - "req-price-audit-trail"
    countermeasures:
      - type: "separation-of-duty"
        description: "Require dual approval for price changes"
        effectiveness: high
        implemented: true
        implementedBy: ["req-dual-control-pricing"]

# Social dependency with commitment reference
socialDependencies:
  - depender: "product-catalog"
    dependee: "external-vendor"
    resource: "inventory-data"
    objective: "maintain-inventory-accuracy"
    criticality: medium
    trust:
      trustLevel: medium
      verification: continuous
    commitmentRefs: ["constraint-inventory-sla"]  # → Motivation Constraint

# Security Constraints (SoD implements the requirement)
securityConstraints:
  separationOfDuty:
    - name: "price-approval"
      description: "Price changes require dual approval"
      tasks: ["propose-price-change", "approve-price-change"]
      message: "Price proposer cannot approve their own changes"
      mutuallyExclusive: true
```

## Traceability Chain

### Complete Flow: Business Need → Security Control

```
1. STAKEHOLDER (Motivation Layer)
   ↓
   stakeholder-product-manager

2. BUSINESS ACTOR (Business Layer)
   ↓
   business-actor-product-manager

3. SECURITY ACTOR (Security Layer)
   ↓
   product-manager-actor
   • businessActorRef: business-actor-product-manager
   • stakeholderRef: stakeholder-product-manager

4. BUSINESS GOAL (Motivation Layer)
   ↓
   goal-pricing-accuracy "Ensure Pricing Accuracy"

5. SECURITY OBJECTIVE (Security Layer)
   ↓
   ensure-pricing-accuracy
   • motivationGoalRef: goal-pricing-accuracy

6. RISK ASSESSMENT (Motivation Layer)
   ↓
   assessment-pricing-manipulation-risk

7. THREAT (Security Layer)
   ↓
   unauthorized-price-change
   • assessmentRef: assessment-pricing-manipulation-risk

8. REQUIREMENTS (Motivation Layer)
   ↓
   req-dual-control-pricing + req-price-audit-trail
   • Properties define security implementation

9. MITIGATION (Security Layer)
   ↓
   Threat.mitigatedByRequirements: [req-dual-control-pricing, ...]

10. IMPLEMENTATION (Security Layer)
    ↓
    securityConstraints.separationOfDuty.price-approval
    • Implements req-dual-control-pricing
```

## Query Examples

### Find All Requirements for a Threat

```yaml
# Query Security Layer
threat = get_threat("unauthorized-price-change")
requirement_ids = threat.mitigatedByRequirements

# Query Motivation Layer
for req_id in requirement_ids:
  requirement = get_requirement(req_id)
  print(f"{requirement.name}: {requirement.description}")
  # Access security implementation details
  impl_type = requirement.properties["requirement.security.implementation-type"]
  impl_params = requirement.properties["requirement.security.implementation-params"]
```

### Trace Actor to Stakeholder

```yaml
# Query Security Layer
actor = get_actor("product-manager-actor")

# Query Business Layer
business_actor = get_business_actor(actor.businessActorRef)

# Query Motivation Layer
stakeholder = get_stakeholder(actor.stakeholderRef)
goals = get_stakeholder_goals(stakeholder.id)
```

### Find All Threats for a Goal

```yaml
# Query Motivation Layer
goal = get_goal("goal-pricing-accuracy")
assessments = get_goal_assessments(goal.id)

# Query Security Layer
threats = []
for assessment in assessments:
  threat = get_threat_by_assessment(assessment.id)
  threats.append(threat)
```

## Benefits of Integration

### 1. Single Source of Truth
- **One place** for all requirements (Motivation Layer)
- **One place** for all actors (Business Layer + Motivation Layer)
- **No duplication** between business and security models

### 2. Complete Traceability
- Trace from **stakeholder** → **goal** → **assessment** → **requirement** → **security control**
- Justify every security control with business requirement
- Understand impact of requirement changes on security

### 3. Consistency
- Same actor identity across layers
- Goals aligned between business and security
- Requirements validated against multiple concerns

### 4. ArchiMate Alignment
- Leverages standard ArchiMate Motivation elements
- Follows ArchiMate best practices for layering
- Compatible with ArchiMate tooling

### 5. Reduced Maintenance
- Change stakeholder once, reflected everywhere
- Update requirement in one place
- Single definition for compliance commitments

## Migration Guide

### Migrating from v1.0 to v2.0

#### 1. Rename Goals to Objectives
```yaml
# OLD (v1.0)
actors:
  - id: "product-manager"
    goals:
      - id: "maintain-catalog"

# NEW (v2.0)
actors:
  - id: "product-manager"
    objectives:
      - id: "maintain-catalog"
        motivationGoalRef: "goal-catalog-accuracy"  # Add reference
```

#### 2. Move SecurityRequirements to Motivation Layer
```yaml
# OLD (v1.0) - Security Layer
threats:
  - id: "price-threat"
    mitigatedBy:
      - id: "req-dual-control"
        type: separation-of-duty

# NEW (v2.0) - Motivation Layer
requirements:
  - id: "req-dual-control"
    requirementType: compliance
    properties:
      - key: "requirement.security.implementation-type"
        value: "separation-of-duty"

# NEW (v2.0) - Security Layer
threats:
  - id: "price-threat"
    mitigatedByRequirements: ["req-dual-control"]
```

#### 3. Convert SocialCommitments to Constraints
```yaml
# OLD (v1.0) - Security Layer
socialDependencies:
  - depender: "system-a"
    commitments:
      - committer: "vendor"
        commitment: "99% SLA"
        type: service-level

# NEW (v2.0) - Motivation Layer
constraints:
  - id: "constraint-vendor-sla"
    name: "Vendor 99% SLA"
    constraintType: regulatory
    properties:
      - key: "constraint.commitment-type"
        value: "service-level"

# NEW (v2.0) - Security Layer
socialDependencies:
  - depender: "system-a"
    commitmentRefs: ["constraint-vendor-sla"]
```

## Validation Rules

### Cross-Layer Reference Validation

```yaml
Validation Rules:
  1. Actor.businessActorRef must reference valid BusinessActor
  2. Actor.stakeholderRef must reference valid Stakeholder
  3. ActorObjective.motivationGoalRef must reference valid Goal
  4. Threat.assessmentRef must reference valid Assessment
  5. Threat.mitigatedByRequirements must reference valid Requirement IDs
  6. SocialDependency.commitmentRefs must reference valid Constraint IDs
  7. Referenced Requirements must have security properties if used for threats
  8. Stakeholder and BusinessActor should represent same entity if both referenced
```

## Best Practices

### 1. Always Start with Motivation
```yaml
# Define WHY first
1. Identify Stakeholders
2. Define Goals
3. Assess Risks (as Assessments)
4. Define Requirements to address risks
5. Document Constraints

# Then define WHO
6. Define BusinessActors

# Finally implement WHAT/HOW
7. Create Security Actors (reference Stakeholder + BusinessActor)
8. Create Security Objectives (reference Goals)
9. Model Threats (reference Assessments)
10. Implement controls (reference Requirements)
```

### 2. Use Properties for Security Details
```yaml
# Motivation Requirement stays business-focused
requirement:
  id: "req-encryption"
  name: "Protect Data in Transit"
  requirementType: compliance

# Security details in properties
properties:
  - key: "requirement.security.implementation-type"
    value: "encryption"
  - key: "requirement.security.implementation-params"
    value: '{"protocol": "TLS 1.3", "cipherSuites": ["AES-256-GCM"]}'
```

### 3. Maintain Bidirectional Traceability
```yaml
# Forward: Stakeholder → Actor
stakeholder:
  id: "stakeholder-pm"
actor:
  stakeholderRef: "stakeholder-pm"

# Backward: Query all actors for a stakeholder
actors = find_actors_by_stakeholder("stakeholder-pm")
```

### 4. Document Rationale
```yaml
# In Motivation Layer, explain WHY
requirement:
  id: "req-mfa"
  documentation: |
    Multi-factor authentication required due to:
    - Assessment: high-risk-unauthorized-access
    - Regulatory: PCI-DSS 8.3
    - Stakeholder: CISO (security mandate)

# In Security Layer, explain HOW
threat:
  mitigatedByRequirements: ["req-mfa"]
  countermeasures:
    - type: "mfa"
      description: "Implements TOTP-based MFA"
```

## Summary

The integrated layer approach provides:
- **Clear separation of concerns**: WHY (Motivation) vs WHO (Business) vs WHAT/HOW (Security)
- **Single source of truth**: Requirements, actors, and commitments defined once
- **Complete traceability**: From business goals to security controls
- **Reduced duplication**: No parallel hierarchies across layers
- **Standards alignment**: Leverages ArchiMate Motivation Layer properly

This architecture ensures security is driven by business requirements and traceable to stakeholder needs, while maintaining clean, maintainable models.
