# Layer 4: Application Layer

Layer 4: Application Layer

**Standard**: [ArchiMate 3.2 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)

---

## Overview

Layer 4: Application Layer

This layer defines **14** node types that represent various aspects of the architecture.

## Node Types

### ApplicationService

**ID**: `application.applicationservice`

Service that exposes application functionality

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `serviceType`: string (required)
- `properties`: object
  - Cross-layer properties

### ApplicationCollaboration

**ID**: `application.applicationcollaboration`

Aggregate of application components working together

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `components`: array
  - Contains relationship
- `properties`: object
  - Cross-layer properties

### ApplicationInteraction

**ID**: `application.applicationinteraction`

Unit of collective application behavior

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `pattern`: string (required)

### ApplicationEvent

**ID**: `application.applicationevent`

Application state change notification

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `eventType`: string (required)
- `properties`: object
  - Cross-layer properties

### InteractionPattern

**ID**: `application.interactionpattern`

InteractionPattern element in Application Layer


### DataObject

**ID**: `application.dataobject`

Data structured for automated processing

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `properties`: object
  - Cross-layer properties

### InterfaceProtocol

**ID**: `application.interfaceprotocol`

InterfaceProtocol element in Application Layer


### ApplicationFunction

**ID**: `application.applicationfunction`

Automated behavior performed by application component

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `properties`: object
  - Cross-layer properties

### ApplicationInterface

**ID**: `application.applicationinterface`

Point of access where application service is available

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `protocol`: string (required)
- `properties`: object
  - Cross-layer properties

### ApplicationProcess

**ID**: `application.applicationprocess`

Sequence of application behaviors

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `properties`: object
  - Cross-layer properties

### ComponentType

**ID**: `application.componenttype`

ComponentType element in Application Layer


### ApplicationEventType

**ID**: `application.applicationeventtype`

ApplicationEventType element in Application Layer


### ApplicationComponent

**ID**: `application.applicationcomponent`

Modular, deployable, and replaceable part of a system

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `type`: string (required)
- `properties`: object
  - Cross-layer properties

### ServiceType

**ID**: `application.servicetype`

ServiceType element in Application Layer



## References

- [ArchiMate 3.2 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)
