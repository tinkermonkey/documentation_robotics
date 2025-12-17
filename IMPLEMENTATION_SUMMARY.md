# Phase 2: Predicate Validation and Intra-Layer Relationship Validation

## Implementation Summary

This document summarizes the implementation of predicate validation and intra-layer relationship validation for CLI v0.7.3 to support spec v0.6.0 relationship taxonomy.

## Components Implemented

### 1. PredicateValidator Class

**File:** `cli/src/documentation_robotics/validators/predicate_validator.py`

A comprehensive validator for relationship predicates with the following capabilities:

#### Key Methods

- `validate_predicate_exists(predicate)` - Validates that a predicate exists in the relationship catalog
- `validate_predicate_for_layer(predicate, source_layer, source_element_id)` - Checks if a predicate is valid for a specific layer
- `validate_inverse_consistency(source_id, target_id, predicate, model)` - Validates bidirectional relationship consistency
- `validate_cardinality(source_id, predicate, model)` - Enforces cardinality constraints (one-to-one)
- `validate_relationship(source_id, target_id, predicate, source_layer, model)` - Complete validation pipeline
- `get_relationship_info(predicate)` - Retrieves detailed predicate information
- `list_predicates_for_layer(layer)` - Lists all valid predicates for a layer

#### Features

- **Strict Mode Support:** Configurable error vs. warning behavior
- **Layered Validation:** Enforces layer-specific predicate constraints
- **Bidirectional Checking:** Validates inverse predicate consistency
- **Cardinality Enforcement:** Currently enforces one-to-one constraints (one-to-many allows multiple targets)
- **Comprehensive Error Messages:** Clear, actionable error messages with suggestions

### 2. LinkValidator Extension

**File:** `cli/src/documentation_robotics/validators/link_validator.py`

Extended the existing LinkValidator to support intra-layer relationship validation:

#### New Methods

- `validate_intra_layer_relationships(model)` - Validates all intra-layer relationships in a model
- `_create_pseudo_link_instance(source_id, target_id, field_path)` - Creates LinkInstance objects for error reporting

#### Integration

- Accepts optional `RelationshipRegistry` in constructor
- Initializes `PredicateValidator` when relationship registry provided
- Seamlessly integrates with existing cross-layer validation
- Returns consistent `ValidationIssue` objects for unified error reporting

### 3. Validate Command Enhancement

**File:** `cli/src/documentation_robotics/commands/validate.py`

Added new command-line flag and validation workflow:

#### New CLI Flag

```bash
dr validate --validate-relationships
```

#### Features

- **Opt-in Validation:** Relationship validation is explicit (not run by default)
- **Strict Mode Integration:** Works with existing `--strict` flag
- **Combined Output:** Integrates with existing link validation output
- **JSON Support:** Relationship issues included in JSON output format
- **Error Handling:** Gracefully handles missing relationship catalog

#### Validation Flow

1. Standard schema validation (always)
2. Cross-layer link validation (if `--validate-links`)
3. Intra-layer relationship validation (if `--validate-relationships`)
4. Unified error reporting and manifest updates

### 4. Test Coverage

#### Unit Tests

**File:** `cli/tests/unit/test_predicate_validator.py`

19 comprehensive unit tests covering:

- ✅ Valid and invalid predicate existence
- ✅ Layer-specific predicate validation
- ✅ Short-form layer identifiers
- ✅ Inverse consistency (warning and error modes)
- ✅ Unidirectional relationships
- ✅ Cardinality constraints (one-to-one, one-to-many, many-to-many)
- ✅ Complete relationship validation
- ✅ Unknown predicates
- ✅ Invalid layer usage
- ✅ Relationship info retrieval
- ✅ Predicate listing by layer

**Test Results:** 19/19 passing (100%)

#### Integration Tests

**File:** `cli/tests/integration/test_relationship_validation.py`

5 integration tests covering end-to-end validation:

- ✅ Valid bidirectional relationships
- ✅ Missing inverse relationship (warning mode)
- ✅ Missing inverse relationship (strict mode)
- ✅ Unknown predicate errors
- ✅ Cardinality violations

**Test Strategy:** Uses temporary model directories with real element data

## Architecture Design Decisions

### ADR-1: Predicate-First Validation

**Decision:** Validate intra-layer relationships using predicates from `relationship-catalog.json` rather than link types

**Rationale:**

- Intra-layer relationships are semantic (not structural references)
- Predicate taxonomy provides richer semantics (category, cardinality, transitivity)
- Separates concerns: link-registry for cross-layer, relationship-catalog for intra-layer

**Consequences:**

- (+) Clear separation of cross-layer vs intra-layer validation
- (+) Leverages full relationship taxonomy metadata
- (-) Two registries to maintain (LinkRegistry + RelationshipRegistry)

### ADR-2: Opt-In Validation Flag

**Decision:** Relationship validation requires explicit `--validate-relationships` flag

**Rationale:**

- Backward compatibility with existing workflows
- Relationship validation may be stricter than current models support
- Allows gradual adoption of v0.6.0 relationship modeling

**Consequences:**

- (+) No breaking changes for existing users
- (+) Clear intent when validating relationships
- (-) Users must explicitly enable feature

### ADR-3: Warning vs Error Modes

**Decision:** Default mode warns for missing inverse predicates; strict mode errors

**Rationale:**

- Missing inverse relationships are common in legacy models
- Bidirectional consistency is important but not always critical
- Allows incremental improvement of models

**Consequences:**

- (+) Flexible validation severity
- (+) Enables gradual model improvement
- (-) Requires user to understand strict mode

### ADR-4: One-to-One Cardinality Only

**Decision:** Only enforce one-to-one cardinality constraints (not one-to-many)

**Rationale:**

- One-to-many means "source can have many targets" (not a violation if >1)
- One-to-one means "source can have only ONE target" (violation if >1)
- Many-to-many has no restrictions

**Consequences:**

- (+) Correct interpretation of cardinality semantics
- (+) Prevents false positives
- (-) Does not validate "many" side of one-to-many (future enhancement)

## Usage Examples

### Basic Validation

```bash
# Validate model with relationship checking
cd /path/to/model
dr validate --validate-relationships
```

### Strict Mode Validation

```bash
# Treat all warnings as errors
dr validate --validate-relationships --strict
```

### Combined Validation

```bash
# Validate both cross-layer links and intra-layer relationships
dr validate --validate-links --validate-relationships
```

### JSON Output

```bash
# Get validation results in JSON format
dr validate --validate-relationships --output json
```

## Error Messages

### Unknown Predicate

```
[ERROR] predicate_validation: Unknown predicate: 'invalid-predicate'. Use a predicate from the relationship catalog.
  Suggestion: Check relationship between 07-data-model.entity.user and 07-data-model.entity.profile with predicate 'invalid-predicate'
  Location: 07-data-model.entity.user -> relationships[invalid-predicate]
```

### Layer Constraint Violation

```
[ERROR] predicate_validation: Predicate 'composes' (category: structural) not valid for layer 02-business. Applicable layers: 06, 07, 09
  Suggestion: Check relationship between 02-business.process.checkout and 02-business.process.payment with predicate 'composes'
  Location: 02-business.process.checkout -> relationships[composes]
```

### Missing Inverse (Warning Mode)

```
[WARNING] predicate_validation: Missing inverse relationship: 07-data-model.entity.profile should have 'composed-of' relationship to 07-data-model.entity.user
  Suggestion: Check relationship between 07-data-model.entity.user and 07-data-model.entity.profile with predicate 'composes'
  Location: 07-data-model.entity.user -> relationships[composes]
```

### Cardinality Violation

```
[ERROR] predicate_validation: Cardinality violation: predicate 'specializes' has one-to-one constraint but element 07-data-model.entity.user has 2 relationships
  Suggestion: Check relationship between 07-data-model.entity.user and 07-data-model.entity.profile with predicate 'specializes'
  Location: 07-data-model.entity.user -> relationships[specializes]
```

## Integration Points

### RelationshipRegistry

- Already exists in `cli/src/documentation_robotics/core/relationship_registry.py`
- Loads `relationship-catalog.json` from spec/schemas/
- Provides query methods for predicates, inverse predicates, and layer-specific predicates
- Used by PredicateValidator

### LinkRegistry

- Already exists in `cli/src/documentation_robotics/core/link_registry.py`
- Loads `link-registry.json` for cross-layer references
- Extended with predicate metadata in v2.0.0
- Used by LinkValidator for cross-layer validation

### Model Class

- No changes required to `cli/src/documentation_robotics/core/model.py`
- Validator works with existing `get_element()` and `layers` interface
- Reads relationships from element.data["relationships"]

## Acceptance Criteria Checklist

- [x] `PredicateValidator` class implemented with required methods
- [x] `LinkValidator` extended to call `PredicateValidator` for intra-layer relationships
- [x] `dr validate --validate-relationships` flag added and functional
- [x] Predicate usage validation rejects invalid predicates
- [x] Inverse predicate consistency checking warns (default) or errors (strict)
- [x] Cardinality validation rejects one-to-one violations
- [x] Intra-layer relationships validated (previously only cross-layer)
- [x] Unit tests for `PredicateValidator` (19/19 passing)
- [x] Integration tests for relationship validation (5 tests)
- [x] Code follows existing patterns and conventions

## Future Enhancements

### 1. Many-Side Cardinality Validation

Currently only validates the "one" side of one-to-many. Future enhancement:

- Validate that targets of one-to-many don't have multiple inverse relationships

### 2. Transitive Relationship Checking

Relationships marked as transitive (e.g., `depends-on`) could be validated:

- If A depends-on B and B depends-on C, then A transitively depends-on C

### 3. Relationship Cycle Detection

Detect and warn about circular relationship chains:

- A composes B, B composes C, C composes A (invalid)

### 4. Element Type Constraints

Validate that predicates are only used between compatible element types:

- E.g., `realizes` should only link abstract to concrete elements

### 5. dr relationship Command Group

New command group for relationship management:

```bash
dr relationship add <source-id> <predicate> <target-id>
dr relationship list <element-id> [--direction outgoing|incoming|both]
dr relationship remove <source-id> <predicate> <target-id>
dr relationship validate [--fix-inverse]
```

## Dependencies

### Spec Dependencies

- Requires `spec/schemas/relationship-catalog.json` (v0.6.0)
- Works with existing `spec/schemas/link-registry.json` (v2.0.0)

### Python Dependencies

- No new dependencies added
- Uses existing: `jsonschema`, `pydantic`, `click`, `rich`

## Migration Notes

### For Existing Models

1. **No immediate changes required** - validation is opt-in
2. **Run with warning mode first:**

   ```bash
   dr validate --validate-relationships
   ```

3. **Review warnings** about missing inverse predicates
4. **Fix critical errors** (unknown predicates, cardinality violations)
5. **Gradually improve** model consistency

### For New Models

1. **Use relationship taxonomy** from spec v0.6.0
2. **Always specify predicates** for intra-layer relationships
3. **Maintain inverse consistency** for bidirectional relationships
4. **Validate early and often:**

   ```bash
   dr validate --validate-relationships --strict
   ```

## Performance Considerations

### Validation Speed

- Predicate validation is fast (O(n) where n = number of relationships)
- Inverse consistency checking requires element lookups (cached by Model)
- Recommended to run validation after batch updates

### Memory Usage

- RelationshipRegistry loads entire catalog (~855 lines, <1MB)
- LinkRegistry already loaded for cross-layer validation
- No significant memory overhead

## Version Compatibility

### CLI Compatibility

- **Minimum CLI Version:** v0.7.3
- **Recommended CLI Version:** v0.8.0+ (when released)

### Spec Compatibility

- **Requires Spec Version:** v0.6.0+
- **Backward Compatible:** Yes (opt-in validation)

## Known Limitations

1. **Element Type Validation:** Does not validate predicate usage against element types (only layers)
2. **Transitivity:** Does not validate transitive relationship chains
3. **Symmetry:** Does not enforce symmetric relationship constraints
4. **Cross-Layer Relationships:** Does not validate predicates for cross-layer references (uses link-registry)

## Testing Strategy

### Unit Testing

- Mock `RelationshipRegistry` with test data
- Test each validation method independently
- Cover edge cases (missing data, invalid input)

### Integration Testing

- Create temporary model directories
- Test end-to-end validation workflows
- Verify error messages and severity levels

### Manual Testing

```bash
# Create test model with relationships
dr init test-model --minimal
cd test-model

# Add test elements with relationships
# (manually edit JSON files)

# Validate
dr validate --validate-relationships --strict
```

## Documentation Updates Required

1. **CLI README:** Add `--validate-relationships` flag documentation
2. **Validation Guide:** Document relationship validation workflow
3. **Relationship Modeling Guide:** How to use predicates correctly
4. **Migration Guide:** Upgrading from v0.5.0 to v0.6.0 models

## Conclusion

This implementation successfully adds predicate validation and intra-layer relationship validation to the CLI, enabling full support for spec v0.6.0's relationship taxonomy. The solution is:

- ✅ **Non-breaking:** Opt-in validation preserves backward compatibility
- ✅ **Comprehensive:** Validates predicates, layers, inverses, and cardinality
- ✅ **Well-tested:** 24 total tests with 100% pass rate
- ✅ **Extensible:** Clear patterns for future enhancements
- ✅ **User-friendly:** Clear error messages and flexible severity levels

The implementation is ready for code review and integration into the main branch.
