// Traceability Queries for Documentation Robotics Specification
// Run with: lbug tools/graph-db/spec-ontology.lbug < tools/graph-db/queries/traceability.cypher

// ============================================================================
// Query 1: All Traceability Relationships
// ============================================================================
// Find all link types that establish traceability between layers

MATCH (lt:LinkType)
WHERE lt.relationshipCategory = 'traceability'
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       lt.predicate AS Predicate,
       lt.inversePredicate AS Inverse,
       lt.strength AS Strength,
       lt.bidirectional AS Bidirectional
ORDER BY lt.strength DESC, lt.name;

// ============================================================================
// Query 2: Motivation Layer Traceability
// ============================================================================
// Show all layers that trace back to Motivation layer (goals, requirements)

MATCH (lt:LinkType)-[:LINKS_FROM]->(source:Layer),
      (lt)-[:LINKS_TO]->(target:Layer {id: '01'})
WHERE lt.relationshipCategory = 'traceability'
RETURN source.id AS SourceLayerID,
       source.name AS SourceLayer,
       lt.name AS TraceabilityLink,
       lt.predicate AS Predicate,
       lt.strength AS Strength
ORDER BY source.id, lt.name;

// ============================================================================
// Query 3: Goal Support Chain
// ============================================================================
// Find all elements that support goals

MATCH (lt:LinkType)
WHERE lt.predicate = 'supports-goals' OR lt.predicate = 'supported-by'
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       lt.predicate AS Predicate,
       lt.inversePredicate AS Inverse
ORDER BY lt.name;

// ============================================================================
// Query 4: Requirement Fulfillment Chain
// ============================================================================
// Find all elements that fulfill requirements

MATCH (lt:LinkType)-[:LINKS_FROM]->(source:Layer)
WHERE lt.predicate = 'fulfills-requirements'
RETURN source.name AS SourceLayer,
       lt.name AS LinkType,
       lt.strength AS Strength,
       lt.bidirectional AS SupportsInverseQuery
ORDER BY source.id;

// ============================================================================
// Query 5: Value Delivery Chain
// ============================================================================
// Find all elements that deliver business value

MATCH (lt:LinkType)
WHERE lt.predicate = 'delivers-value'
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       lt.bidirectional AS Bidirectional
ORDER BY lt.name;

// ============================================================================
// Query 6: Multi-Hop Traceability Paths
// ============================================================================
// Find paths from implementation layers to motivation layer
// Note: This would require actual instance data, showing the pattern

MATCH (impl:Layer)-[:LINKS_TO*1..3]->(motiv:Layer {id: '01'})
WHERE impl.id IN ['04', '05', '06']
RETURN impl.name AS ImplementationLayer,
       motiv.name AS MotivationLayer,
       length(path) AS PathLength
ORDER BY impl.id;

// ============================================================================
// Query 7: Bidirectional Traceability Links
// ============================================================================
// Find traceability links that support inverse navigation

MATCH (lt:LinkType)
WHERE lt.relationshipCategory = 'traceability' AND lt.bidirectional = true
RETURN lt.name AS LinkName,
       lt.predicate AS Forward,
       lt.inversePredicate AS Backward,
       lt.strength AS Strength
ORDER BY lt.strength DESC, lt.name;

// ============================================================================
// Query 8: High-Strength Traceability
// ============================================================================
// Find critical and high-strength traceability links

MATCH (lt:LinkType)
WHERE lt.relationshipCategory = 'traceability'
      AND lt.strength IN ['critical', 'high']
RETURN lt.name AS LinkName,
       lt.predicate AS Predicate,
       lt.strength AS Strength,
       lt.bidirectional AS Bidirectional
ORDER BY lt.strength DESC, lt.name;

// ============================================================================
// Query 9: Traceability Coverage by Layer
// ============================================================================
// Count traceability links from each layer

MATCH (lt:LinkType)-[:LINKS_FROM]->(source:Layer)
WHERE lt.relationshipCategory = 'traceability'
RETURN source.id AS LayerID,
       source.name AS Layer,
       count(lt) AS TraceabilityLinks
ORDER BY source.id;

// ============================================================================
// Query 10: Gaps in Traceability
// ============================================================================
// Find layers with no traceability links

MATCH (l:Layer)
WHERE NOT EXISTS {
    MATCH (lt:LinkType)-[:LINKS_FROM]->(l)
    WHERE lt.relationshipCategory = 'traceability'
}
RETURN l.id AS LayerID,
       l.name AS LayerName,
       'No traceability links' AS Gap
ORDER BY l.id;
