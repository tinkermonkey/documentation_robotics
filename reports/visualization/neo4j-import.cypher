// Documentation Robotics Ontology - Neo4j Import
// Run these statements in Neo4j to import the ontology structure

// Clear existing data (optional - remove if you want to keep existing data)
// MATCH (n) DETACH DELETE n;

// Create Layer nodes
CREATE (l01:Layer {id: '01', name: 'Motivation Layer'});
CREATE (l02:Layer {id: '02', name: 'Business Layer'});
CREATE (l03:Layer {id: '03', name: 'Security Layer'});
CREATE (l04:Layer {id: '04', name: 'Application Layer'});
CREATE (l05:Layer {id: '05', name: 'Technology Layer'});
CREATE (l06:Layer {id: '06', name: 'API Layer'});
CREATE (l07:Layer {id: '07', name: 'Data Model Layer'});
CREATE (l08:Layer {id: '08', name: 'Datastore Layer'});
CREATE (l09:Layer {id: '09', name: 'UX Layer'});
CREATE (l10:Layer {id: '10', name: 'Navigation Layer'});
CREATE (l11:Layer {id: '11', name: 'APM/Observability Layer'});
CREATE (l12:Layer {id: '12', name: 'Testing Layer'});

// Create LinkType nodes and relationships
CREATE (lt_apm_criticality:LinkType {id: 'apm-criticality', name: 'Criticality', category: 'apm', cardinality: 'single'});
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-criticality'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_apm_health_check_endpoint:LinkType {id: 'apm-health-check-endpoint', name: 'Health Check Endpoint', category: 'apm', cardinality: 'single'});
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-health-check-endpoint'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_apm_health_monitored:LinkType {id: 'apm-health-monitored', name: 'Health Monitored', category: 'apm', cardinality: 'single'});
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-health-monitored'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_apm_sla_target_availability:LinkType {id: 'apm-sla-target-availability', name: 'Sla Target Availability', category: 'apm', cardinality: 'single'});
MATCH (s:Layer {id: '04-application'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-sla-target-availability'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-sla-target-availability'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-sla-target-availability'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_apm_sla_target_latency:LinkType {id: 'apm-sla-target-latency', name: 'Sla Target Latency', category: 'apm', cardinality: 'single'});
MATCH (s:Layer {id: '04-application'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-sla-target-latency'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-sla-target-latency'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-sla-target-latency'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_apm_trace:LinkType {id: 'apm-trace', name: 'Trace', category: 'apm', cardinality: 'single'});
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-trace'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_apm_traced:LinkType {id: 'apm-traced', name: 'Traced', category: 'apm', cardinality: 'single'});
MATCH (s:Layer {id: '04-application'}), (t:Layer {id: '11-apm'}), (lt:LinkType {id: 'apm-traced'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_archimate_application_master_data_source:LinkType {id: 'archimate-application-master-data-source', name: 'Application Master Data Source', category: 'archimate', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '04-application'}), (lt:LinkType {id: 'archimate-application-master-data-source'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_archimate_application_process_steps:LinkType {id: 'archimate-application-process-steps', name: 'Application Process Steps', category: 'archimate', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '04-application'}), (lt:LinkType {id: 'archimate-application-process-steps'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_archimate_application_realized_by_process:LinkType {id: 'archimate-application-realized-by-process', name: 'Application Realized By Process', category: 'archimate', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '04-application'}), (lt:LinkType {id: 'archimate-application-realized-by-process'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_archimate_application_represented_by_dataobject:LinkType {id: 'archimate-application-represented-by-dataobject', name: 'Application Represented By Dataobject', category: 'archimate', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '04-application'}), (lt:LinkType {id: 'archimate-application-represented-by-dataobject'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_archimate_ref:LinkType {id: 'archimate-ref', name: 'Ref', category: 'archimate', cardinality: 'single'});
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '04-application'}), (lt:LinkType {id: 'archimate-ref'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '07-data-model'}), (t:Layer {id: '04-application'}), (lt:LinkType {id: 'archimate-ref'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_business_apm_business_metrics:LinkType {id: 'business-apm-business-metrics', name: 'Apm Business Metrics', category: 'business', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '02-business'}), (lt:LinkType {id: 'business-apm-business-metrics'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '04-application'}), (t:Layer {id: '02-business'}), (lt:LinkType {id: 'business-apm-business-metrics'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '02-business'}), (lt:LinkType {id: 'business-apm-business-metrics'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_business_interface_ref:LinkType {id: 'business-interface-ref', name: 'Interface Ref', category: 'business', cardinality: 'single'});
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '02-business'}), (lt:LinkType {id: 'business-interface-ref'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_business_object_ref:LinkType {id: 'business-object-ref', name: 'Object Ref', category: 'business', cardinality: 'single'});
MATCH (s:Layer {id: '07-data-model'}), (t:Layer {id: '02-business'}), (lt:LinkType {id: 'business-object-ref'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_business_service_ref:LinkType {id: 'business-service-ref', name: 'Service Ref', category: 'business', cardinality: 'single'});
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '02-business'}), (lt:LinkType {id: 'business-service-ref'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_data_apm_data_quality_metrics:LinkType {id: 'data-apm-data-quality-metrics', name: 'Apm Data Quality Metrics', category: 'data', cardinality: 'single'});
MATCH (s:Layer {id: '07-data-model'}), (t:Layer {id: '07-data-model'}), (lt:LinkType {id: 'data-apm-data-quality-metrics'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_data_governance:LinkType {id: 'data-governance', name: 'Governance', category: 'data', cardinality: 'single'});
MATCH (s:Layer {id: '07-data-model'}), (t:Layer {id: '07-data-model'}), (lt:LinkType {id: 'data-governance'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_data_governance_owner:LinkType {id: 'data-governance-owner', name: 'Governance Owner', category: 'data', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '07-data-model'}), (lt:LinkType {id: 'data-governance-owner'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_data_retention:LinkType {id: 'data-retention', name: 'Retention', category: 'data', cardinality: 'single'});
MATCH (s:Layer {id: '04-application'}), (t:Layer {id: '07-data-model'}), (lt:LinkType {id: 'data-retention'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_database:LinkType {id: 'database', name: 'Database', category: 'data', cardinality: 'single'});
MATCH (s:Layer {id: '07-data-model'}), (t:Layer {id: '07-data-model'}), (lt:LinkType {id: 'database'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_database_column:LinkType {id: 'database-column', name: 'Database Column', category: 'data', cardinality: 'single'});
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '07-data-model'}), (lt:LinkType {id: 'database-column'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_database_table:LinkType {id: 'database-table', name: 'Database Table', category: 'data', cardinality: 'single'});
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '07-data-model'}), (lt:LinkType {id: 'database-table'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_motivation_constrained_by:LinkType {id: 'motivation-constrained-by', name: 'Constrained By', category: 'motivation', cardinality: 'single'});
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-constrained-by'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-constrained-by'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_motivation_delivers_value:LinkType {id: 'motivation-delivers-value', name: 'Delivers Value', category: 'motivation', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-delivers-value'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '04-application'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-delivers-value'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_motivation_fulfills_requirements:LinkType {id: 'motivation-fulfills-requirements', name: 'Fulfills Requirements', category: 'motivation', cardinality: 'single'});
MATCH (s:Layer {id: '04-application'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-fulfills-requirements'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-fulfills-requirements'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-fulfills-requirements'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_motivation_governed_by_principles:LinkType {id: 'motivation-governed-by-principles', name: 'Governed By Principles', category: 'motivation', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-governed-by-principles'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '04-application'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-governed-by-principles'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-governed-by-principles'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-governed-by-principles'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_motivation_supports_goals:LinkType {id: 'motivation-supports-goals', name: 'Supports Goals', category: 'motivation', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-supports-goals'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '04-application'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-supports-goals'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-supports-goals'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '01-motivation'}), (lt:LinkType {id: 'motivation-supports-goals'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_security_classification:LinkType {id: 'security-classification', name: 'Classification', category: 'security', cardinality: 'single'});
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-classification'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_security_data_pii:LinkType {id: 'security-data-pii', name: 'Data Pii', category: 'security', cardinality: 'single'});
MATCH (s:Layer {id: '04-application'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-data-pii'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_security_encrypted:LinkType {id: 'security-encrypted', name: 'Encrypted', category: 'security', cardinality: 'single'});
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-encrypted'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_security_encryption_required:LinkType {id: 'security-encryption-required', name: 'Encryption Required', category: 'security', cardinality: 'single'});
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-encryption-required'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_security_encryption_type:LinkType {id: 'security-encryption-type', name: 'Encryption Type', category: 'security', cardinality: 'single'});
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-encryption-type'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_security_pii:LinkType {id: 'security-pii', name: 'Pii', category: 'security', cardinality: 'single'});
MATCH (s:Layer {id: '05-technology'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-pii'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-pii'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_security_process_security_controls:LinkType {id: 'security-process-security-controls', name: 'Process Security Controls', category: 'security', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-process-security-controls'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_security_process_separation_of_duty:LinkType {id: 'security-process-separation-of-duty', name: 'Process Separation Of Duty', category: 'security', cardinality: 'single'});
MATCH (s:Layer {id: '02-business'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-process-separation-of-duty'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_security_required_permissions:LinkType {id: 'security-required-permissions', name: 'Required Permissions', category: 'security', cardinality: 'array'});
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-required-permissions'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);
CREATE (lt_security_resource:LinkType {id: 'security-resource', name: 'Resource', category: 'security', cardinality: 'single'});
MATCH (s:Layer {id: '06-api'}), (t:Layer {id: '03-security'}), (lt:LinkType {id: 'security-resource'}) CREATE (s)-[:LINKS_TO {via: lt.id}]->(t);

// Query examples:
// 1. Find all layers that link to Motivation layer
// MATCH (s:Layer)-[:LINKS_TO]->(t:Layer {id: '01'}) RETURN s.name;

// 2. Find all link types from Business layer
// MATCH (s:Layer {id: '02'})-[r:LINKS_TO]->(t:Layer) RETURN s.name, t.name, r.via;

// 3. Find shortest path between any two layers
// MATCH path=shortestPath((s:Layer {id: '02'})-[:LINKS_TO*]->( t:Layer {id: '06'})) RETURN path;