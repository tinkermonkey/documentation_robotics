# Layer 2: Business Layer

**Standard**: [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)

---

## Overview

This layer defines **15** node types that represent various aspects of the architecture.

## Node Types

### Product

**ID**: `business.product`

Coherent collection of services with a value

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `services`: array
  - Contains relationship
- `contracts`: array
  - Contains relationship

### BusinessCollaboration

**ID**: `business.businesscollaboration`

Aggregate of business roles working together

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `properties`: object
  - Cross-layer properties

### RepresentationFormat

**ID**: `business.representationformat`

RepresentationFormat element in Business Layer


### BusinessRole

**ID**: `business.businessrole`

The responsibility for performing specific behavior

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string

### BusinessObject

**ID**: `business.businessobject`

Concept used within business domain

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `properties`: object
  - Cross-layer properties

### BusinessEvent

**ID**: `business.businessevent`

Something that happens and influences behavior

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `type`: string (required)
- `properties`: object
  - Cross-layer properties

### BusinessActor

**ID**: `business.businessactor`

An organizational entity capable of performing behavior

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string

### Representation

**ID**: `business.representation`

Perceptible form of business object

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `format`: string (required)

### Contract

**ID**: `business.contract`

Formal specification of agreement

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `properties`: object
  - Cross-layer properties

### BusinessInterface

**ID**: `business.businessinterface`

Point of access where business service is available

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `properties`: object
  - Cross-layer properties

### BusinessInteraction

**ID**: `business.businessinteraction`

Unit of collective behavior by collaboration

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string

### EventType

**ID**: `business.eventtype`

EventType element in Business Layer


### BusinessProcess

**ID**: `business.businessprocess`

Sequence of business behaviors achieving a result

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `properties`: object
  - Cross-layer properties

### BusinessService

**ID**: `business.businessservice`

Service that fulfills a business need

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `properties`: object
  - Cross-layer properties

### BusinessFunction

**ID**: `business.businessfunction`

Collection of business behavior based on criteria

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string


## References

- [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)
