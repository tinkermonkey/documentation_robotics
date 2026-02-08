# Layer 5: Technology Layer

**Standard**: [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)

---

## Overview

This layer defines **22** node types that represent various aspects of the architecture.

## Node Types

### NetworkType

**ID**: `technology.networktype`

NetworkType element in Technology Layer


### Device

**ID**: `technology.device`

Physical IT resource with processing capability

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `deviceType`: string (required)
- `properties`: object
  - Cross-layer properties

### TechnologyEvent

**ID**: `technology.technologyevent`

Technology state change

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `eventType`: string (required)

### TechnologyInteraction

**ID**: `technology.technologyinteraction`

Unit of collective technology behavior

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string

### PathType

**ID**: `technology.pathtype`

PathType element in Technology Layer


### CommunicationNetwork

**ID**: `technology.communicationnetwork`

Set of structures that connects nodes

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `networkType`: string (required)
- `properties`: object
  - Cross-layer properties
- `source`: object
  - Source code reference

### TechnologyFunction

**ID**: `technology.technologyfunction`

Collection of technology behavior

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string

### Artifact

**ID**: `technology.artifact`

Physical piece of data used or produced

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `artifactType`: string (required)
- `properties`: object
  - Cross-layer properties
- `source`: object
  - Source code reference

### TechnologyInterface

**ID**: `technology.technologyinterface`

Point of access where technology services are available

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `protocol`: string (required)
- `properties`: object
  - Cross-layer properties
- `source`: object
  - Source code reference

### SystemSoftwareType

**ID**: `technology.systemsoftwaretype`

SystemSoftwareType element in Technology Layer


### SystemSoftware

**ID**: `technology.systemsoftware`

Software that provides platform for applications

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `softwareType`: string (required)
- `properties`: object
  - Cross-layer properties
- `source`: object
  - Source code reference

### DeviceType

**ID**: `technology.devicetype`

DeviceType element in Technology Layer


### TechProtocol

**ID**: `technology.techprotocol`

TechProtocol element in Technology Layer


### Node

**ID**: `technology.node`

Computational or physical resource that hosts artifacts

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `nodeType`: string (required)
- `properties`: object
  - Cross-layer properties
- `source`: object
  - Source code reference

### TechnologyCollaboration

**ID**: `technology.technologycollaboration`

Aggregate of nodes working together

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `nodes`: array
  - Contains relationship

### TechnologyService

**ID**: `technology.technologyservice`

Externally visible unit of technology functionality

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `serviceType`: string (required)
- `properties`: object
  - Cross-layer properties
- `source`: object
  - Source code reference

### NodeType

**ID**: `technology.nodetype`

NodeType element in Technology Layer


### TechServiceType

**ID**: `technology.techservicetype`

TechServiceType element in Technology Layer


### TechEventType

**ID**: `technology.techeventtype`

TechEventType element in Technology Layer


### TechnologyProcess

**ID**: `technology.technologyprocess`

Sequence of technology behaviors

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `properties`: object
  - Cross-layer properties
- `source`: object
  - Source code reference

### Path

**ID**: `technology.path`

Link between nodes through which they exchange

**Attributes**:

- `id`: string (uuid) (required)
- `name`: string (required)
- `documentation`: string
- `pathType`: string (required)
- `properties`: object
  - Cross-layer properties

### ArtifactType

**ID**: `technology.artifacttype`

ArtifactType element in Technology Layer



## References

- [ArchiMate 3.2](https://pubs.opengroup.org/architecture/archimate32-doc/)
