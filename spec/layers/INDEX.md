# Documentation Robotics Specification Index

This index documents the 12-layer architecture model. Each layer contains specific node types that define elements within that architectural concern.

## Layers

- [Layer 1: Motivation Layer](layers/01-motivation-layer.md)
- [Layer 2: Business Layer](layers/02-business-layer.md)
- [Layer 3: Security Layer](layers/03-security-layer.md)
- [Layer 4: Application Layer](layers/04-application-layer.md)
- [Layer 5: Technology Layer](layers/05-technology-layer.md)
- [Layer 6: API Layer](layers/06-api-layer.md)
- [Layer 7: Data Model Layer](layers/07-data-model-layer.md)
- [Layer 8: Data Store Layer](layers/08-data-store-layer.md)
- [Layer 9: UX Layer](layers/09-ux-layer.md)
- [Layer 10: Navigation Layer](layers/10-navigation-layer.md)
- [Layer 11: APM Observability Layer](layers/11-apm-layer.md)
- [Layer 12: Testing Layer](layers/12-testing-layer.md)

## Node Types by Layer

### Layer 1: Motivation Layer

- [`motivation.assessment`](layers/01-motivation-layer.md#assessment) - Outcome of analysis of the state of affairs
- [`motivation.assessmenttype`](layers/01-motivation-layer.md#assessmenttype) - AssessmentType element in Motivation Layer
- [`motivation.constraint`](layers/01-motivation-layer.md#constraint) - Restriction on the way in which a system is realized
- [`motivation.constrainttype`](layers/01-motivation-layer.md#constrainttype) - ConstraintType element in Motivation Layer
- [`motivation.driver`](layers/01-motivation-layer.md#driver) - External or internal condition that motivates an organization
- [`motivation.drivercategory`](layers/01-motivation-layer.md#drivercategory) - DriverCategory element in Motivation Layer
- [`motivation.goal`](layers/01-motivation-layer.md#goal) - High-level statement of intent, direction, or desired end state
- [`motivation.meaning`](layers/01-motivation-layer.md#meaning) - Knowledge or expertise present in a representation
- [`motivation.outcome`](layers/01-motivation-layer.md#outcome) - End result that has been achieved
- [`motivation.outcomestatus`](layers/01-motivation-layer.md#outcomestatus) - OutcomeStatus element in Motivation Layer
- [`motivation.principle`](layers/01-motivation-layer.md#principle) - Normative property of all systems in a given context
- [`motivation.principlecategory`](layers/01-motivation-layer.md#principlecategory) - PrincipleCategory element in Motivation Layer
- [`motivation.priority`](layers/01-motivation-layer.md#priority) - Priority element in Motivation Layer
- [`motivation.requirement`](layers/01-motivation-layer.md#requirement) - Statement of need that must be realized
- [`motivation.requirementtype`](layers/01-motivation-layer.md#requirementtype) - RequirementType element in Motivation Layer
- [`motivation.stakeholder`](layers/01-motivation-layer.md#stakeholder) - Individual, team, or organization with interest in the outcome
- [`motivation.stakeholdertype`](layers/01-motivation-layer.md#stakeholdertype) - StakeholderType element in Motivation Layer
- [`motivation.value`](layers/01-motivation-layer.md#value) - Relative worth, utility, or importance of something
- [`motivation.valuetype`](layers/01-motivation-layer.md#valuetype) - ValueType element in Motivation Layer

### Layer 2: Business Layer

- [`business.businessactor`](layers/02-business-layer.md#businessactor) - An organizational entity capable of performing behavior
- [`business.businesscollaboration`](layers/02-business-layer.md#businesscollaboration) - Aggregate of business roles working together
- [`business.businessevent`](layers/02-business-layer.md#businessevent) - Something that happens and influences behavior
- [`business.businessfunction`](layers/02-business-layer.md#businessfunction) - Collection of business behavior based on criteria
- [`business.businessinteraction`](layers/02-business-layer.md#businessinteraction) - Unit of collective behavior by collaboration
- [`business.businessinterface`](layers/02-business-layer.md#businessinterface) - Point of access where business service is available
- [`business.businessobject`](layers/02-business-layer.md#businessobject) - Concept used within business domain
- [`business.businessprocess`](layers/02-business-layer.md#businessprocess) - Sequence of business behaviors achieving a result
- [`business.businessrole`](layers/02-business-layer.md#businessrole) - The responsibility for performing specific behavior
- [`business.businessservice`](layers/02-business-layer.md#businessservice) - Service that fulfills a business need
- [`business.contract`](layers/02-business-layer.md#contract) - Formal specification of agreement
- [`business.eventtype`](layers/02-business-layer.md#eventtype) - EventType element in Business Layer
- [`business.product`](layers/02-business-layer.md#product) - Coherent collection of services with a value
- [`business.representation`](layers/02-business-layer.md#representation) - Perceptible form of business object
- [`business.representationformat`](layers/02-business-layer.md#representationformat) - RepresentationFormat element in Business Layer

### Layer 3: Security Layer

- [`security.accesscondition`](layers/03-security-layer.md#accesscondition) - Conditional access rule
- [`security.accesscontrollevel`](layers/03-security-layer.md#accesscontrollevel) - AccessControlLevel element in Security Layer
- [`security.accountabilityrequirement`](layers/03-security-layer.md#accountabilityrequirement) - Accountability and non-repudiation requirements
- [`security.actiontype`](layers/03-security-layer.md#actiontype) - ActionType element in Security Layer
- [`security.actor`](layers/03-security-layer.md#actor) - Actor in the system (beyond roles)
- [`security.actordependency`](layers/03-security-layer.md#actordependency) - Dependency between actors
- [`security.actorobjective`](layers/03-security-layer.md#actorobjective) - Security-related objective or goal of an actor
- [`security.actortype`](layers/03-security-layer.md#actortype) - ActorType element in Security Layer
- [`security.auditconfig`](layers/03-security-layer.md#auditconfig) - Configuration for security audit logging, specifying what events to capture, retention periods, storage destinations, and compliance requirements. Enables security monitoring and forensic analysis.
- [`security.auditlevel`](layers/03-security-layer.md#auditlevel) - AuditLevel element in Security Layer
- [`security.authenticationconfig`](layers/03-security-layer.md#authenticationconfig) - Authentication configuration
- [`security.authprovider`](layers/03-security-layer.md#authprovider) - AuthProvider element in Security Layer
- [`security.bindingofduty`](layers/03-security-layer.md#bindingofduty) - Same actor must complete related tasks
- [`security.classification`](layers/03-security-layer.md#classification) - A single classification level defining data sensitivity and protection requirements
- [`security.classificationlevel`](layers/03-security-layer.md#classificationlevel) - ClassificationLevel element in Security Layer
- [`security.condition`](layers/03-security-layer.md#condition) - A logical expression or predicate that determines when a SecurityPolicy rule applies. Supports attribute-based access control by evaluating context such as time, location, user attributes, or resource state.
- [`security.conditionoperator`](layers/03-security-layer.md#conditionoperator) - ConditionOperator element in Security Layer
- [`security.countermeasure`](layers/03-security-layer.md#countermeasure) - Security countermeasure for a threat
- [`security.criticality`](layers/03-security-layer.md#criticality) - Criticality element in Security Layer
- [`security.dataclassification`](layers/03-security-layer.md#dataclassification) - Data classification and protection policies
- [`security.datasource`](layers/03-security-layer.md#datasource) - DataSource element in Security Layer
- [`security.delegation`](layers/03-security-layer.md#delegation) - Explicit delegation of permissions or goals
- [`security.delegationtype`](layers/03-security-layer.md#delegationtype) - DelegationType element in Security Layer
- [`security.deletionmethod`](layers/03-security-layer.md#deletionmethod) - DeletionMethod element in Security Layer
- [`security.destinationtype`](layers/03-security-layer.md#destinationtype) - DestinationType element in Security Layer
- [`security.effectiveness`](layers/03-security-layer.md#effectiveness) - Effectiveness element in Security Layer
- [`security.encryptionrequirement`](layers/03-security-layer.md#encryptionrequirement) - EncryptionRequirement element in Security Layer
- [`security.evaluationtype`](layers/03-security-layer.md#evaluationtype) - EvaluationType element in Security Layer
- [`security.evidence`](layers/03-security-layer.md#evidence) - Evidence required for accountability
- [`security.evidencestrength`](layers/03-security-layer.md#evidencestrength) - EvidenceStrength element in Security Layer
- [`security.evidencetype`](layers/03-security-layer.md#evidencetype) - EvidenceType element in Security Layer
- [`security.fieldaccesscontrol`](layers/03-security-layer.md#fieldaccesscontrol) - Field-level access control
- [`security.impact`](layers/03-security-layer.md#impact) - Impact element in Security Layer
- [`security.informationentity`](layers/03-security-layer.md#informationentity) - Information asset with fine-grained rights
- [`security.informationright`](layers/03-security-layer.md#informationright) - Fine-grained information access rights
- [`security.likelihood`](layers/03-security-layer.md#likelihood) - Likelihood element in Security Layer
- [`security.maskingstrategy`](layers/03-security-layer.md#maskingstrategy) - MaskingStrategy element in Security Layer
- [`security.needtoknow`](layers/03-security-layer.md#needtoknow) - Information access based on objective/purpose requirements
- [`security.passwordpolicy`](layers/03-security-layer.md#passwordpolicy) - Password requirements
- [`security.permission`](layers/03-security-layer.md#permission) - Permission definition
- [`security.permissionscope`](layers/03-security-layer.md#permissionscope) - PermissionScope element in Security Layer
- [`security.policyaction`](layers/03-security-layer.md#policyaction) - Action to take when policy rule matches
- [`security.policyeffect`](layers/03-security-layer.md#policyeffect) - PolicyEffect element in Security Layer
- [`security.policyrule`](layers/03-security-layer.md#policyrule) - Individual policy rule
- [`security.policytarget`](layers/03-security-layer.md#policytarget) - PolicyTarget element in Security Layer
- [`security.ratelimit`](layers/03-security-layer.md#ratelimit) - Defines throttling constraints for API or service access, specifying maximum request counts, time windows, and actions to take when limits are exceeded. Protects resources from abuse and ensures fair usage across consumers.
- [`security.ratelimitaction`](layers/03-security-layer.md#ratelimitaction) - RateLimitAction element in Security Layer
- [`security.ratelimitscope`](layers/03-security-layer.md#ratelimitscope) - RateLimitScope element in Security Layer
- [`security.requirementlevel`](layers/03-security-layer.md#requirementlevel) - RequirementLevel element in Security Layer
- [`security.resourceoperation`](layers/03-security-layer.md#resourceoperation) - Operation on a resource
- [`security.resourcetype`](layers/03-security-layer.md#resourcetype) - ResourceType element in Security Layer
- [`security.retentionpolicy`](layers/03-security-layer.md#retentionpolicy) - Defines how long security-related data (audit logs, access records, encryption keys) must be retained, archival strategies, and secure deletion procedures. Ensures compliance with regulatory requirements.
- [`security.role`](layers/03-security-layer.md#role) - User role definition
- [`security.secureresource`](layers/03-security-layer.md#secureresource) - Protected resource definition
- [`security.securityconstraints`](layers/03-security-layer.md#securityconstraints) - Security patterns and constraints
- [`security.securitymodel`](layers/03-security-layer.md#securitymodel) - Complete security model for application
- [`security.securitypolicy`](layers/03-security-layer.md#securitypolicy) - Declarative security policy
- [`security.separationofduty`](layers/03-security-layer.md#separationofduty) - Different actors must perform related tasks
- [`security.socialdependency`](layers/03-security-layer.md#socialdependency) - Dependencies and trust between actors
- [`security.storageclass`](layers/03-security-layer.md#storageclass) - StorageClass element in Security Layer
- [`security.threat`](layers/03-security-layer.md#threat) - Security threat and countermeasures
- [`security.trustlevel`](layers/03-security-layer.md#trustlevel) - TrustLevel element in Security Layer
- [`security.validationrule`](layers/03-security-layer.md#validationrule) - Specifies data validation constraints for FieldAccessControl, defining allowed patterns, value ranges, or transformations applied when accessing protected fields. Prevents data corruption and enforces field-level integrity.
- [`security.validationruletype`](layers/03-security-layer.md#validationruletype) - ValidationRuleType element in Security Layer
- [`security.validationseverity`](layers/03-security-layer.md#validationseverity) - ValidationSeverity element in Security Layer
- [`security.verificationlevel`](layers/03-security-layer.md#verificationlevel) - VerificationLevel element in Security Layer

### Layer 4: Application Layer

- [`application.applicationcollaboration`](layers/04-application-layer.md#applicationcollaboration) - Aggregate of application components working together
- [`application.applicationcomponent`](layers/04-application-layer.md#applicationcomponent) - Modular, deployable, and replaceable part of a system
- [`application.applicationevent`](layers/04-application-layer.md#applicationevent) - Application state change notification
- [`application.applicationeventtype`](layers/04-application-layer.md#applicationeventtype) - ApplicationEventType element in Application Layer
- [`application.applicationfunction`](layers/04-application-layer.md#applicationfunction) - Automated behavior performed by application component
- [`application.applicationinteraction`](layers/04-application-layer.md#applicationinteraction) - Unit of collective application behavior
- [`application.applicationinterface`](layers/04-application-layer.md#applicationinterface) - Point of access where application service is available
- [`application.applicationprocess`](layers/04-application-layer.md#applicationprocess) - Sequence of application behaviors
- [`application.applicationservice`](layers/04-application-layer.md#applicationservice) - Service that exposes application functionality
- [`application.componenttype`](layers/04-application-layer.md#componenttype) - ComponentType element in Application Layer
- [`application.dataobject`](layers/04-application-layer.md#dataobject) - Data structured for automated processing
- [`application.interactionpattern`](layers/04-application-layer.md#interactionpattern) - InteractionPattern element in Application Layer
- [`application.interfaceprotocol`](layers/04-application-layer.md#interfaceprotocol) - InterfaceProtocol element in Application Layer
- [`application.servicetype`](layers/04-application-layer.md#servicetype) - ServiceType element in Application Layer

### Layer 5: Technology Layer

- [`technology.artifact`](layers/05-technology-layer.md#artifact) - Physical piece of data used or produced
- [`technology.artifacttype`](layers/05-technology-layer.md#artifacttype) - ArtifactType element in Technology Layer
- [`technology.communicationnetwork`](layers/05-technology-layer.md#communicationnetwork) - Set of structures that connects nodes
- [`technology.device`](layers/05-technology-layer.md#device) - Physical IT resource with processing capability
- [`technology.devicetype`](layers/05-technology-layer.md#devicetype) - DeviceType element in Technology Layer
- [`technology.networktype`](layers/05-technology-layer.md#networktype) - NetworkType element in Technology Layer
- [`technology.node`](layers/05-technology-layer.md#node) - Computational or physical resource that hosts artifacts
- [`technology.nodetype`](layers/05-technology-layer.md#nodetype) - NodeType element in Technology Layer
- [`technology.path`](layers/05-technology-layer.md#path) - Link between nodes through which they exchange
- [`technology.pathtype`](layers/05-technology-layer.md#pathtype) - PathType element in Technology Layer
- [`technology.systemsoftware`](layers/05-technology-layer.md#systemsoftware) - Software that provides platform for applications
- [`technology.systemsoftwaretype`](layers/05-technology-layer.md#systemsoftwaretype) - SystemSoftwareType element in Technology Layer
- [`technology.techeventtype`](layers/05-technology-layer.md#techeventtype) - TechEventType element in Technology Layer
- [`technology.technologycollaboration`](layers/05-technology-layer.md#technologycollaboration) - Aggregate of nodes working together
- [`technology.technologyevent`](layers/05-technology-layer.md#technologyevent) - Technology state change
- [`technology.technologyfunction`](layers/05-technology-layer.md#technologyfunction) - Collection of technology behavior
- [`technology.technologyinteraction`](layers/05-technology-layer.md#technologyinteraction) - Unit of collective technology behavior
- [`technology.technologyinterface`](layers/05-technology-layer.md#technologyinterface) - Point of access where technology services are available
- [`technology.technologyprocess`](layers/05-technology-layer.md#technologyprocess) - Sequence of technology behaviors
- [`technology.technologyservice`](layers/05-technology-layer.md#technologyservice) - Externally visible unit of technology functionality
- [`technology.techprotocol`](layers/05-technology-layer.md#techprotocol) - TechProtocol element in Technology Layer
- [`technology.techservicetype`](layers/05-technology-layer.md#techservicetype) - TechServiceType element in Technology Layer

### Layer 6: API Layer

- [`api.callback`](layers/06-api-layer.md#callback) - Defines a webhook or callback URL pattern where the API will send asynchronous notifications. Enables event-driven integrations and async workflows.
- [`api.components`](layers/06-api-layer.md#components) - Reusable component definitions
- [`api.contact`](layers/06-api-layer.md#contact) - Contact information for the API owner or maintainer, including name, email, and URL. Enables consumers to reach out for support or collaboration.
- [`api.encoding`](layers/06-api-layer.md#encoding) - Specifies serialization details for multipart request body properties, including content-type, headers, and encoding style. Handles complex content negotiation.
- [`api.example`](layers/06-api-layer.md#example) - Provides sample values for request bodies, responses, or parameters. Improves documentation clarity and enables automated testing or mocking.
- [`api.externaldocumentation`](layers/06-api-layer.md#externaldocumentation) - A reference to external documentation resources (URLs, wikis, guides) that provide additional context beyond the inline API specification. Links API elements to comprehensive documentation.
- [`api.header`](layers/06-api-layer.md#header) - Defines HTTP header parameters for requests or responses, specifying name, schema, required status, and description. Documents header-based communication requirements.
- [`api.info`](layers/06-api-layer.md#info) - Metadata about the API
- [`api.license`](layers/06-api-layer.md#license) - Specifies the legal license under which the API is provided, including license name and URL to full terms. Clarifies usage rights for API consumers.
- [`api.link`](layers/06-api-layer.md#link) - Describes a relationship between API responses and subsequent operations, enabling hypermedia-driven API navigation. Supports HATEOAS design patterns.
- [`api.mediatype`](layers/06-api-layer.md#mediatype) - Media type and schema for request/response body
- [`api.oauthflow`](layers/06-api-layer.md#oauthflow) - Individual OAuth 2.0 flow configuration
- [`api.oauthflows`](layers/06-api-layer.md#oauthflows) - Configuration for OAuth 2.0 authentication flows (implicit, password, clientCredentials, authorizationCode), specifying authorization URLs, token URLs, and scopes. Defines OAuth security implementation.
- [`api.openapidocument`](layers/06-api-layer.md#openapidocument) - Root of an OpenAPI specification file
- [`api.operation`](layers/06-api-layer.md#operation) - Single API operation (HTTP method on a path)
- [`api.parameter`](layers/06-api-layer.md#parameter) - Parameter for an operation
- [`api.parameterlocation`](layers/06-api-layer.md#parameterlocation) - ParameterLocation element in API Layer
- [`api.parameterstyle`](layers/06-api-layer.md#parameterstyle) - ParameterStyle element in API Layer
- [`api.pathitem`](layers/06-api-layer.md#pathitem) - Operations available on a path
- [`api.paths`](layers/06-api-layer.md#paths) - Available API endpoints and operations
- [`api.requestbody`](layers/06-api-layer.md#requestbody) - Request payload for an operation
- [`api.response`](layers/06-api-layer.md#response) - Single response definition
- [`api.responses`](layers/06-api-layer.md#responses) - Possible responses from an operation
- [`api.schema`](layers/06-api-layer.md#schema) - Data type definition (JSON Schema subset)
- [`api.securityscheme`](layers/06-api-layer.md#securityscheme) - Security mechanism for the API
- [`api.securitytype`](layers/06-api-layer.md#securitytype) - SecurityType element in API Layer
- [`api.server`](layers/06-api-layer.md#server) - Server where the API is available
- [`api.servervariable`](layers/06-api-layer.md#servervariable) - A variable placeholder in server URL templates that can be substituted at runtime. Enables dynamic server addressing for different environments or tenants.
- [`api.tag`](layers/06-api-layer.md#tag) - A metadata label used to group and categorize API operations for documentation organization. Enables logical grouping of endpoints in generated API documentation.

### Layer 7: Data Model Layer

- [`data-model.arrayschema`](layers/07-data-model-layer.md#arrayschema) - ArraySchema validation rules
- [`data-model.constrainttype`](layers/07-data-model-layer.md#constrainttype) - ConstraintType element in Data Model Layer
- [`data-model.databasemapping`](layers/07-data-model-layer.md#databasemapping) - Specifies how a logical data model entity maps to physical database storage, including table names, column mappings, and storage optimizations. Bridges logical and physical data layers.
- [`data-model.dataclassificationlevel`](layers/07-data-model-layer.md#dataclassificationlevel) - DataClassificationLevel element in Data Model Layer
- [`data-model.datagovernance`](layers/07-data-model-layer.md#datagovernance) - Metadata about data ownership, classification, sensitivity level, and handling requirements. Ensures data is managed according to organizational policies and regulations.
- [`data-model.dataqualitymetrics`](layers/07-data-model-layer.md#dataqualitymetrics) - Defines measurable quality attributes for data elements such as completeness, accuracy, consistency, and timeliness. Enables data quality monitoring and SLA enforcement.
- [`data-model.indextype`](layers/07-data-model-layer.md#indextype) - IndexType element in Data Model Layer
- [`data-model.jsonschema`](layers/07-data-model-layer.md#jsonschema) - Root schema document
- [`data-model.jsontype`](layers/07-data-model-layer.md#jsontype) - Core JSON data types
- [`data-model.maskingstrategy`](layers/07-data-model-layer.md#maskingstrategy) - MaskingStrategy element in Data Model Layer
- [`data-model.numericschema`](layers/07-data-model-layer.md#numericschema) - NumericSchema validation rules
- [`data-model.objectschema`](layers/07-data-model-layer.md#objectschema) - ObjectSchema validation rules
- [`data-model.partitionstrategy`](layers/07-data-model-layer.md#partitionstrategy) - PartitionStrategy element in Data Model Layer
- [`data-model.reference`](layers/07-data-model-layer.md#reference) - Reference to another schema
- [`data-model.referentialaction`](layers/07-data-model-layer.md#referentialaction) - ReferentialAction element in Data Model Layer
- [`data-model.schemacomposition`](layers/07-data-model-layer.md#schemacomposition) - Combining multiple schemas
- [`data-model.schemadefinition`](layers/07-data-model-layer.md#schemadefinition) - A reusable JSON Schema definition that can be referenced throughout the data model. Enables DRY schema design and consistent type definitions across entities.
- [`data-model.schemaproperty`](layers/07-data-model-layer.md#schemaproperty) - Defines a single property within a schema, including its type, constraints, validation rules, and documentation. The fundamental building block of data model structure.
- [`data-model.securityclassification`](layers/07-data-model-layer.md#securityclassification) - SecurityClassification element in Data Model Layer
- [`data-model.sqltype`](layers/07-data-model-layer.md#sqltype) - SQLType element in Data Model Layer
- [`data-model.string`](layers/07-data-model-layer.md#string) - string element in Data Model Layer
- [`data-model.stringformat`](layers/07-data-model-layer.md#stringformat) - StringFormat element in Data Model Layer
- [`data-model.stringschema`](layers/07-data-model-layer.md#stringschema) - StringSchema validation rules
- [`data-model.uicomponent`](layers/07-data-model-layer.md#uicomponent) - UIComponent element in Data Model Layer
- [`data-model.x-apm-data-quality-metrics`](layers/07-data-model-layer.md#x-apm-data-quality-metrics) - Links schema to data quality metrics in APM/Observability Layer
- [`data-model.x-business-object-ref`](layers/07-data-model-layer.md#x-business-object-ref) - Reference to BusinessObject this schema implements
- [`data-model.x-data-governance`](layers/07-data-model-layer.md#x-data-governance) - Data model governance metadata (root-level)
- [`data-model.x-database`](layers/07-data-model-layer.md#x-database) - Database mapping information
- [`data-model.x-security`](layers/07-data-model-layer.md#x-security) - Security and privacy metadata
- [`data-model.x-ui`](layers/07-data-model-layer.md#x-ui) - UI rendering hints

### Layer 8: Data Store Layer

- [`data-store.column`](layers/08-data-store-layer.md#column) - Table column definition
- [`data-store.constraint`](layers/08-data-store-layer.md#constraint) - Table constraint
- [`data-store.constrainttype`](layers/08-data-store-layer.md#constrainttype) - ConstraintType element in Data Store Layer
- [`data-store.database`](layers/08-data-store-layer.md#database) - Database instance containing schemas
- [`data-store.databaseschema`](layers/08-data-store-layer.md#databaseschema) - Logical grouping of database objects
- [`data-store.databasetype`](layers/08-data-store-layer.md#databasetype) - DatabaseType element in Data Store Layer
- [`data-store.function`](layers/08-data-store-layer.md#function) - A stored database function that encapsulates reusable computation logic. Returns a value and can be used in SQL expressions for data transformation or validation.
- [`data-store.functionlanguage`](layers/08-data-store-layer.md#functionlanguage) - FunctionLanguage element in Data Store Layer
- [`data-store.functionvolatility`](layers/08-data-store-layer.md#functionvolatility) - FunctionVolatility element in Data Store Layer
- [`data-store.generationtype`](layers/08-data-store-layer.md#generationtype) - GenerationType element in Data Store Layer
- [`data-store.index`](layers/08-data-store-layer.md#index) - Database index for query optimization
- [`data-store.indexmethod`](layers/08-data-store-layer.md#indexmethod) - IndexMethod element in Data Store Layer
- [`data-store.parallelsafety`](layers/08-data-store-layer.md#parallelsafety) - ParallelSafety element in Data Store Layer
- [`data-store.parametermode`](layers/08-data-store-layer.md#parametermode) - ParameterMode element in Data Store Layer
- [`data-store.referentialaction`](layers/08-data-store-layer.md#referentialaction) - ReferentialAction element in Data Store Layer
- [`data-store.refreshmode`](layers/08-data-store-layer.md#refreshmode) - RefreshMode element in Data Store Layer
- [`data-store.securitydefiner`](layers/08-data-store-layer.md#securitydefiner) - SecurityDefiner element in Data Store Layer
- [`data-store.sequence`](layers/08-data-store-layer.md#sequence) - A database sequence generator that produces unique, ordered numeric values. Used for generating primary keys, order numbers, or other sequential identifiers.
- [`data-store.sequencedatatype`](layers/08-data-store-layer.md#sequencedatatype) - SequenceDataType element in Data Store Layer
- [`data-store.sqldatatype`](layers/08-data-store-layer.md#sqldatatype) - SQLDataType element in Data Store Layer
- [`data-store.table`](layers/08-data-store-layer.md#table) - Database table definition
- [`data-store.trigger`](layers/08-data-store-layer.md#trigger) - A database trigger that automatically executes in response to data modification events (INSERT, UPDATE, DELETE). Enables reactive database behavior and data integrity enforcement.
- [`data-store.triggerevent`](layers/08-data-store-layer.md#triggerevent) - TriggerEvent element in Data Store Layer
- [`data-store.triggerforeach`](layers/08-data-store-layer.md#triggerforeach) - TriggerForEach element in Data Store Layer
- [`data-store.triggertiming`](layers/08-data-store-layer.md#triggertiming) - TriggerTiming element in Data Store Layer
- [`data-store.view`](layers/08-data-store-layer.md#view) - Database view

### Layer 9: UX Layer

- [`ux.actioncomponent`](layers/09-ux-layer.md#actioncomponent) - Interactive element that triggers actions (button, menu, link, voice command)
- [`ux.actioncomponenttype`](layers/09-ux-layer.md#actioncomponenttype) - ActionComponentType element in UX Layer
- [`ux.actionpattern`](layers/09-ux-layer.md#actionpattern) - Reusable action configuration for common user interactions
- [`ux.actiontype`](layers/09-ux-layer.md#actiontype) - ActionType element in UX Layer
- [`ux.aligncontent`](layers/09-ux-layer.md#aligncontent) - AlignContent element in UX Layer
- [`ux.alignitems`](layers/09-ux-layer.md#alignitems) - AlignItems element in UX Layer
- [`ux.animationtype`](layers/09-ux-layer.md#animationtype) - AnimationType element in UX Layer
- [`ux.apiconfig`](layers/09-ux-layer.md#apiconfig) - Configuration for API integration within UI components, specifying endpoints, request/response mapping, authentication, and caching strategies. Connects UI to backend services.
- [`ux.buttonstyle`](layers/09-ux-layer.md#buttonstyle) - ButtonStyle element in UX Layer
- [`ux.cachestrategy`](layers/09-ux-layer.md#cachestrategy) - CacheStrategy element in UX Layer
- [`ux.channeltype`](layers/09-ux-layer.md#channeltype) - ChannelType element in UX Layer
- [`ux.chartseries`](layers/09-ux-layer.md#chartseries) - Configuration for a data series within a chart component, specifying data source, visualization type, colors, and legend properties. Defines how data is visualized in charts.
- [`ux.columndisplaytype`](layers/09-ux-layer.md#columndisplaytype) - ColumnDisplayType element in UX Layer
- [`ux.componentinstance`](layers/09-ux-layer.md#componentinstance) - Instance of a LibraryComponent with application-specific configuration
- [`ux.componentreference`](layers/09-ux-layer.md#componentreference) - A reference to another UI component that can be embedded or composed within a parent component. Enables component reuse and modular UI architecture.
- [`ux.componenttype`](layers/09-ux-layer.md#componenttype) - ComponentType element in UX Layer
- [`ux.condition`](layers/09-ux-layer.md#condition) - Boolean expression for guard conditions
- [`ux.dataconfig`](layers/09-ux-layer.md#dataconfig) - Configuration for data binding and state management within UI components, defining data sources, transformation pipelines, and update triggers. Manages component data flow.
- [`ux.datasource`](layers/09-ux-layer.md#datasource) - DataSource element in UX Layer
- [`ux.errorconfig`](layers/09-ux-layer.md#errorconfig) - Configuration for error handling and display within UI components, specifying error message formats, retry behavior, fallback content, and user guidance. Ensures consistent error UX.
- [`ux.experiencestate`](layers/09-ux-layer.md#experiencestate) - Distinct state that the experience can be in (works across all channels)
- [`ux.filtertype`](layers/09-ux-layer.md#filtertype) - FilterType element in UX Layer
- [`ux.httpmethod`](layers/09-ux-layer.md#httpmethod) - HttpMethod element in UX Layer
- [`ux.justifycontent`](layers/09-ux-layer.md#justifycontent) - JustifyContent element in UX Layer
- [`ux.justifyitems`](layers/09-ux-layer.md#justifyitems) - JustifyItems element in UX Layer
- [`ux.labelposition`](layers/09-ux-layer.md#labelposition) - LabelPosition element in UX Layer
- [`ux.layoutconfig`](layers/09-ux-layer.md#layoutconfig) - Configuration for UI layout structure, defining grid systems, responsive breakpoints, spacing rules, and component arrangement patterns. Controls visual organization of the interface.
- [`ux.layoutstyle`](layers/09-ux-layer.md#layoutstyle) - LayoutStyle element in UX Layer
- [`ux.layouttype`](layers/09-ux-layer.md#layouttype) - LayoutType element in UX Layer
- [`ux.librarycomponent`](layers/09-ux-layer.md#librarycomponent) - Reusable UI component definition that can be instantiated in multiple UXSpecs
- [`ux.librarysubview`](layers/09-ux-layer.md#librarysubview) - Reusable grouping of components that can be composed into views
- [`ux.linestyle`](layers/09-ux-layer.md#linestyle) - LineStyle element in UX Layer
- [`ux.notificationtype`](layers/09-ux-layer.md#notificationtype) - NotificationType element in UX Layer
- [`ux.performancetargets`](layers/09-ux-layer.md#performancetargets) - Defines performance SLAs for UI components including load time, interaction responsiveness, and rendering thresholds. Enables performance monitoring and optimization.
- [`ux.seriestype`](layers/09-ux-layer.md#seriestype) - SeriesType element in UX Layer
- [`ux.sortdirection`](layers/09-ux-layer.md#sortdirection) - SortDirection element in UX Layer
- [`ux.stateaction`](layers/09-ux-layer.md#stateaction) - Action executed during state lifecycle
- [`ux.stateactiontemplate`](layers/09-ux-layer.md#stateactiontemplate) - A reusable template defining actions to execute during component state transitions. Enables standardized behavior patterns for common state changes.
- [`ux.statepattern`](layers/09-ux-layer.md#statepattern) - Reusable state machine pattern for common UX flows
- [`ux.statetransition`](layers/09-ux-layer.md#statetransition) - Transition from current state to another state
- [`ux.stickyposition`](layers/09-ux-layer.md#stickyposition) - StickyPosition element in UX Layer
- [`ux.subview`](layers/09-ux-layer.md#subview) - Instance of a LibrarySubView or custom sub-view definition
- [`ux.tablecolumn`](layers/09-ux-layer.md#tablecolumn) - Configuration for a single column within a data table component, specifying header, data binding, sorting, filtering, and rendering options. Defines table structure and behavior.
- [`ux.textalign`](layers/09-ux-layer.md#textalign) - TextAlign element in UX Layer
- [`ux.transitiontemplate`](layers/09-ux-layer.md#transitiontemplate) - Defines reusable animation and transition patterns for state changes, page navigation, or component lifecycle events. Ensures consistent motion design across the application.
- [`ux.triggertype`](layers/09-ux-layer.md#triggertype) - TriggerType element in UX Layer
- [`ux.uxapplication`](layers/09-ux-layer.md#uxapplication) - Application-level UX configuration that groups UXSpecs and defines shared settings
- [`ux.uxlibrary`](layers/09-ux-layer.md#uxlibrary) - Collection of reusable UI components and sub-views that can be shared across applications
- [`ux.uxspec`](layers/09-ux-layer.md#uxspec) - Complete UX specification for a single experience (visual, voice, chat, SMS)
- [`ux.validationrule`](layers/09-ux-layer.md#validationrule) - Client-side validation rule for a field
- [`ux.validationtype`](layers/09-ux-layer.md#validationtype) - ValidationType element in UX Layer
- [`ux.view`](layers/09-ux-layer.md#view) - Routable grouping of components (a complete user experience)
- [`ux.viewtype`](layers/09-ux-layer.md#viewtype) - ViewType element in UX Layer

### Layer 10: Navigation Layer

- [`navigation.breadcrumbconfig`](layers/10-navigation-layer.md#breadcrumbconfig) - Configuration for breadcrumb navigation display, specifying path generation rules, separator styles, truncation behavior, and home link settings. Provides users with location context and navigation history.
- [`navigation.breadcrumbmode`](layers/10-navigation-layer.md#breadcrumbmode) - BreadcrumbMode element in Navigation Layer
- [`navigation.contextscope`](layers/10-navigation-layer.md#contextscope) - ContextScope element in Navigation Layer
- [`navigation.contextvariable`](layers/10-navigation-layer.md#contextvariable) - Shared variable across flow steps (Gap #1: Cross-experience state)
- [`navigation.datamapping`](layers/10-navigation-layer.md#datamapping) - Maps data between flow context and experience (Gap #2: Data handoff)
- [`navigation.flowanalytics`](layers/10-navigation-layer.md#flowanalytics) - Analytics for funnel tracking (Gap #9: Funnel analytics)
- [`navigation.flowstep`](layers/10-navigation-layer.md#flowstep) - One step in a navigation flow
- [`navigation.guardaction`](layers/10-navigation-layer.md#guardaction) - Action when guard denies access
- [`navigation.guardactiontype`](layers/10-navigation-layer.md#guardactiontype) - GuardActionType element in Navigation Layer
- [`navigation.guardcondition`](layers/10-navigation-layer.md#guardcondition) - Condition expression for guard
- [`navigation.guardtype`](layers/10-navigation-layer.md#guardtype) - GuardType element in Navigation Layer
- [`navigation.httpmethod`](layers/10-navigation-layer.md#httpmethod) - HttpMethod element in Navigation Layer
- [`navigation.navigationflow`](layers/10-navigation-layer.md#navigationflow) - Sequence of routes that realizes a business process
- [`navigation.navigationgraph`](layers/10-navigation-layer.md#navigationgraph) - Complete navigation structure for application
- [`navigation.navigationguard`](layers/10-navigation-layer.md#navigationguard) - Guard condition for route access
- [`navigation.navigationtransition`](layers/10-navigation-layer.md#navigationtransition) - Transition from one route to another
- [`navigation.navigationtrigger`](layers/10-navigation-layer.md#navigationtrigger) - NavigationTrigger element in Navigation Layer
- [`navigation.notificationaction`](layers/10-navigation-layer.md#notificationaction) - Notification to send during flow step
- [`navigation.notificationtype`](layers/10-navigation-layer.md#notificationtype) - NotificationType element in Navigation Layer
- [`navigation.processtracking`](layers/10-navigation-layer.md#processtracking) - Tracks business process instance across flow (Gap #3: Process correlation)
- [`navigation.route`](layers/10-navigation-layer.md#route) - Single route/destination in the application (channel-agnostic)
- [`navigation.routemeta`](layers/10-navigation-layer.md#routemeta) - Route metadata
- [`navigation.routetype`](layers/10-navigation-layer.md#routetype) - RouteType element in Navigation Layer
- [`navigation.storagetype`](layers/10-navigation-layer.md#storagetype) - StorageType element in Navigation Layer
- [`navigation.truncationtype`](layers/10-navigation-layer.md#truncationtype) - TruncationType element in Navigation Layer
- [`navigation.waittype`](layers/10-navigation-layer.md#waittype) - WaitType element in Navigation Layer

### Layer 11: APM Observability Layer

- [`apm.aggregationtemporality`](layers/11-apm-layer.md#aggregationtemporality) - AggregationTemporality element in APM Observability Layer
- [`apm.apmconfiguration`](layers/11-apm-layer.md#apmconfiguration) - Complete APM configuration for an application
- [`apm.attribute`](layers/11-apm-layer.md#attribute) - Key-value pair metadata
- [`apm.authtype`](layers/11-apm-layer.md#authtype) - AuthType element in APM Observability Layer
- [`apm.compressiontype`](layers/11-apm-layer.md#compressiontype) - CompressionType element in APM Observability Layer
- [`apm.dataqualitymetric`](layers/11-apm-layer.md#dataqualitymetric) - Individual data quality metric
- [`apm.dataqualitymetrics`](layers/11-apm-layer.md#dataqualitymetrics) - Data quality monitoring metrics (referenced by Data Model Layer x-apm-data-quality-metrics)
- [`apm.dataqualitytype`](layers/11-apm-layer.md#dataqualitytype) - DataQualityType element in APM Observability Layer
- [`apm.exporterconfig`](layers/11-apm-layer.md#exporterconfig) - Configuration for telemetry data export destinations, specifying protocol (OTLP, Jaeger, Prometheus), endpoints, authentication, batching, and retry policies. Controls where observability data is sent.
- [`apm.exporterprotocol`](layers/11-apm-layer.md#exporterprotocol) - ExporterProtocol element in APM Observability Layer
- [`apm.exportertype`](layers/11-apm-layer.md#exportertype) - ExporterType element in APM Observability Layer
- [`apm.instrumentationconfig`](layers/11-apm-layer.md#instrumentationconfig) - Configuration for automatic or manual instrumentation of application code, specifying which libraries, frameworks, or code paths to instrument and capture telemetry from.
- [`apm.instrumentationscope`](layers/11-apm-layer.md#instrumentationscope) - Logical unit of code that generates telemetry
- [`apm.instrumentationtype`](layers/11-apm-layer.md#instrumentationtype) - InstrumentationType element in APM Observability Layer
- [`apm.instrumenttype`](layers/11-apm-layer.md#instrumenttype) - InstrumentType element in APM Observability Layer
- [`apm.logconfiguration`](layers/11-apm-layer.md#logconfiguration) - Logging configuration
- [`apm.loglevel`](layers/11-apm-layer.md#loglevel) - LogLevel element in APM Observability Layer
- [`apm.logprocessor`](layers/11-apm-layer.md#logprocessor) - A processing pipeline component for log records, enabling filtering, transformation, enrichment, or routing of logs before export. Customizes log processing behavior.
- [`apm.logprocessortype`](layers/11-apm-layer.md#logprocessortype) - LogProcessorType element in APM Observability Layer
- [`apm.logrecord`](layers/11-apm-layer.md#logrecord) - OpenTelemetry log entry
- [`apm.meterconfig`](layers/11-apm-layer.md#meterconfig) - Configuration for metric collection meters, specifying aggregation temporality, cardinality limits, and collection intervals. Controls how metrics are gathered and aggregated.
- [`apm.metricconfiguration`](layers/11-apm-layer.md#metricconfiguration) - Metrics configuration
- [`apm.metricinstrument`](layers/11-apm-layer.md#metricinstrument) - Defines a specific metric measurement instrument (Counter, Gauge, Histogram, etc.) with its name, unit, description, and attributes. The fundamental unit of metric collection.
- [`apm.propagatortype`](layers/11-apm-layer.md#propagatortype) - PropagatorType element in APM Observability Layer
- [`apm.resource`](layers/11-apm-layer.md#resource) - Immutable representation of entity producing telemetry
- [`apm.samplertype`](layers/11-apm-layer.md#samplertype) - SamplerType element in APM Observability Layer
- [`apm.severitynumber`](layers/11-apm-layer.md#severitynumber) - SeverityNumber element in APM Observability Layer
- [`apm.span`](layers/11-apm-layer.md#span) - Unit of work in distributed tracing
- [`apm.spanevent`](layers/11-apm-layer.md#spanevent) - Timestamped event during span execution
- [`apm.spankind`](layers/11-apm-layer.md#spankind) - SpanKind element in APM Observability Layer
- [`apm.spanlink`](layers/11-apm-layer.md#spanlink) - Link to related span (different trace or parent)
- [`apm.spanstatus`](layers/11-apm-layer.md#spanstatus) - Outcome of span execution
- [`apm.statuscode`](layers/11-apm-layer.md#statuscode) - StatusCode element in APM Observability Layer
- [`apm.traceconfiguration`](layers/11-apm-layer.md#traceconfiguration) - Distributed tracing configuration
- [`apm.transformoperation`](layers/11-apm-layer.md#transformoperation) - TransformOperation element in APM Observability Layer

### Layer 12: Testing Layer

- [`testing.contexttype`](layers/12-testing-layer.md#contexttype) - ContextType element in Testing Layer
- [`testing.contextvariation`](layers/12-testing-layer.md#contextvariation) - Different context in which functionality can be invoked
- [`testing.coveragecriteria`](layers/12-testing-layer.md#coveragecriteria) - CoverageCriteria element in Testing Layer
- [`testing.coverageexclusion`](layers/12-testing-layer.md#coverageexclusion) - Explicit exclusion from coverage with justification
- [`testing.coveragegap`](layers/12-testing-layer.md#coveragegap) - Identified gap in test coverage requiring attention
- [`testing.coveragerequirement`](layers/12-testing-layer.md#coveragerequirement) - Requirement for test coverage of a target
- [`testing.coveragesummary`](layers/12-testing-layer.md#coveragesummary) - Summary of coverage status (can be computed or declared)
- [`testing.dependencyeffect`](layers/12-testing-layer.md#dependencyeffect) - DependencyEffect element in Testing Layer
- [`testing.environmentfactor`](layers/12-testing-layer.md#environmentfactor) - Environmental condition that may affect behavior
- [`testing.fieldrelevance`](layers/12-testing-layer.md#fieldrelevance) - FieldRelevance element in Testing Layer
- [`testing.gapseverity`](layers/12-testing-layer.md#gapseverity) - GapSeverity element in Testing Layer
- [`testing.implementationformat`](layers/12-testing-layer.md#implementationformat) - ImplementationFormat element in Testing Layer
- [`testing.inputpartitionselection`](layers/12-testing-layer.md#inputpartitionselection) - Selection of partition values to include in coverage
- [`testing.inputselection`](layers/12-testing-layer.md#inputselection) - Specific partition value selected for a test case
- [`testing.inputspacepartition`](layers/12-testing-layer.md#inputspacepartition) - Partitioning of an input dimension into testable categories
- [`testing.outcomecategory`](layers/12-testing-layer.md#outcomecategory) - Category of expected outcomes (not specific assertions)
- [`testing.outcometype`](layers/12-testing-layer.md#outcometype) - OutcomeType element in Testing Layer
- [`testing.partitioncategory`](layers/12-testing-layer.md#partitioncategory) - PartitionCategory element in Testing Layer
- [`testing.partitiondependency`](layers/12-testing-layer.md#partitiondependency) - Constraint between partition values across fields
- [`testing.partitionvalue`](layers/12-testing-layer.md#partitionvalue) - A specific partition within the input space
- [`testing.presencerule`](layers/12-testing-layer.md#presencerule) - PresenceRule element in Testing Layer
- [`testing.priority`](layers/12-testing-layer.md#priority) - Priority element in Testing Layer
- [`testing.sketchstatus`](layers/12-testing-layer.md#sketchstatus) - SketchStatus element in Testing Layer
- [`testing.targetcoveragesummary`](layers/12-testing-layer.md#targetcoveragesummary) - Coverage metrics summary for a single test coverage target
- [`testing.targetinputfield`](layers/12-testing-layer.md#targetinputfield) - Input field associated with a coverage target
- [`testing.targettype`](layers/12-testing-layer.md#targettype) - TargetType element in Testing Layer
- [`testing.testcasesketch`](layers/12-testing-layer.md#testcasesketch) - Abstract test case selecting specific partition values
- [`testing.testcoveragemodel`](layers/12-testing-layer.md#testcoveragemodel) - Complete test coverage model for application
- [`testing.testcoveragetarget`](layers/12-testing-layer.md#testcoveragetarget) - An artifact or functionality that requires test coverage
