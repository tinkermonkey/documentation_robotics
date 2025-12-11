// Validation Queries for Documentation Robotics Specification
// Run with: lbug tools/graph-db/spec-ontology.lbug < tools/graph-db/queries/validation.cypher

// ============================================================================
// Query 1: Validate All Link Types Have Predicates
// ============================================================================

MATCH (lt:LinkType)
WHERE lt.predicate = '' OR lt.predicate IS NULL
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       lt.category AS Category,
       'Missing predicate' AS Issue
ORDER BY lt.category, lt.name;

// ============================================================================
// Query 2: Validate Link Target Entities Exist
// ============================================================================

MATCH (lt:LinkType)
WHERE NOT EXISTS {
    MATCH (lt)-[:TARGETS_ENTITY]->(:EntityType)
}
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       lt.category AS Category,
       'No target entities defined' AS Issue
ORDER BY lt.category, lt.name;

// ============================================================================
// Query 3: Validate Predicates Are Used
// ============================================================================

MATCH (p:Predicate)
WHERE NOT EXISTS {
    MATCH (lt:LinkType)-[:USES_PREDICATE]->(p)
}
RETURN p.name AS Predicate,
       p.category AS Category,
       'Predicate not used by any LinkType' AS Issue
ORDER BY p.category, p.name;

// ============================================================================
// Query 4: Validate Inverse Predicates Exist
// ============================================================================

MATCH (p:Predicate)
WHERE p.inversePredicate <> '' AND p.inversePredicate IS NOT NULL
  AND NOT EXISTS {
    MATCH (p2:Predicate {name: p.inversePredicate})
  }
RETURN p.name AS Predicate,
       p.inversePredicate AS InversePredicate,
       'Inverse predicate not defined' AS Issue
ORDER BY p.name;

// ============================================================================
// Query 5: Validate Bidirectional Links Have Inverse Predicates
// ============================================================================

MATCH (lt:LinkType)
WHERE lt.bidirectional = true
  AND (lt.inversePredicate = '' OR lt.inversePredicate IS NULL)
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       lt.predicate AS Predicate,
       'Bidirectional link missing inverse predicate' AS Issue
ORDER BY lt.name;

// ============================================================================
// Query 6: Validate Link Source and Target Layers Exist
// ============================================================================

MATCH (lt:LinkType)
WHERE NOT EXISTS {
    MATCH (lt)-[:LINKS_FROM]->(:Layer)
}
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       'No source layer defined' AS Issue
ORDER BY lt.name;

MATCH (lt:LinkType)
WHERE NOT EXISTS {
    MATCH (lt)-[:LINKS_TO]->(:Layer)
}
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       'No target layer defined' AS Issue
ORDER BY lt.name;

// ============================================================================
// Query 7: Validate Strength Values
// ============================================================================

MATCH (lt:LinkType)
WHERE NOT (lt.strength IN ['low', 'medium', 'high', 'critical'])
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       lt.strength AS InvalidStrength,
       'Invalid strength value' AS Issue
ORDER BY lt.name;

// ============================================================================
// Query 8: Validate Cardinality Values
// ============================================================================

MATCH (lt:LinkType)
WHERE NOT (lt.cardinality IN ['single', 'array', 'object'])
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       lt.cardinality AS InvalidCardinality,
       'Invalid cardinality value' AS Issue
ORDER BY lt.name;

// ============================================================================
// Query 9: Find Orphaned Entity Types
// ============================================================================

MATCH (e:EntityType)
WHERE NOT EXISTS {
    MATCH (l:Layer)-[:DEFINES]->(e)
}
RETURN e.id AS EntityID,
       e.name AS EntityName,
       'Entity type not linked to any layer' AS Issue
ORDER BY e.id;

// ============================================================================
// Query 10: Validate Category Consistency
// ============================================================================

MATCH (lt:LinkType)
WHERE lt.category NOT IN [
    'apm', 'archimate', 'business', 'data', 'datastore',
    'motivation', 'navigation', 'security', 'ux'
]
RETURN lt.id AS LinkID,
       lt.name AS LinkName,
       lt.category AS InvalidCategory,
       'Category not in standard list' AS Issue
ORDER BY lt.category, lt.name;

// ============================================================================
// Query 11: Complete Validation Summary
// ============================================================================

MATCH (lt:LinkType)
WITH
    count(lt) AS TotalLinkTypes,
    sum(CASE WHEN lt.predicate = '' OR lt.predicate IS NULL THEN 1 ELSE 0 END) AS MissingPredicates,
    sum(CASE WHEN lt.bidirectional = true AND (lt.inversePredicate = '' OR lt.inversePredicate IS NULL) THEN 1 ELSE 0 END) AS BidirectionalMissingInverse,
    sum(CASE WHEN NOT (lt.strength IN ['low', 'medium', 'high', 'critical']) THEN 1 ELSE 0 END) AS InvalidStrengths
MATCH (p:Predicate)
WITH TotalLinkTypes, MissingPredicates, BidirectionalMissingInverse, InvalidStrengths,
     count(p) AS TotalPredicates
MATCH (e:EntityType)
WITH TotalLinkTypes, MissingPredicates, BidirectionalMissingInverse, InvalidStrengths, TotalPredicates,
     count(e) AS TotalEntities
RETURN
    TotalLinkTypes,
    MissingPredicates,
    BidirectionalMissingInverse,
    InvalidStrengths,
    TotalPredicates,
    TotalEntities,
    CASE
        WHEN MissingPredicates = 0 AND BidirectionalMissingInverse = 0 AND InvalidStrengths = 0
        THEN 'PASS'
        ELSE 'FAIL'
    END AS ValidationStatus;
