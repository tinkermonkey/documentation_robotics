# Phase 10 Implementation Summary: Source Reference Queries and Staleness Checking

## Overview

Successfully implemented Phase 10 capabilities to extend the `dr search` and `dr links` commands for querying entities by source provenance and identifying stale source references.

## Completed Features

### 1. Source Reference Filtering in `dr search` Command

**Location**: `cli/src/documentation_robotics/commands/search.py`

#### New Options Added:
- `--has-source-ref`: Filter to entities WITH source references
- `--no-source-ref`: Filter to entities WITHOUT source references
- `--source-provenance`: Filter by provenance type (extracted, manual, inferred, generated)

#### Validation:
- Prevents conflicting flags (`--has-source-ref` and `--no-source-ref`)
- Prevents invalid combinations (`--source-provenance` with `--no-source-ref`)

#### Example Usage:
```bash
# Find entities without source links in application layer
dr search --no-source-ref --layer application

# Find manually linked entities
dr search --has-source-ref --source-provenance manual

# Find all extracted entities
dr search --has-source-ref --source-provenance extracted
```

### 2. Staleness Checking in `dr links` Command

**Location**: `cli/src/documentation_robotics/commands/links.py`

#### New Subcommand: `check-staleness`
- Command: `dr links check-staleness`
- Options:
  - `--threshold`: Age threshold for staleness (default: "90days", examples: "6months", "1year")
  - `--layer`: Check only elements in a specific layer
  - `--format`: Output format ("text" or "json")

#### Example Usage:
```bash
# Check for stale source links using default 90-day threshold
dr links check-staleness

# Check with custom threshold
dr links check-staleness --threshold 6months

# Check specific layer with JSON output
dr links check-staleness --layer application --format json
```

#### Output Format (Text):
```
⚠ Stale source links:

  api-endpoint-legacy-service
    Name: Legacy Service
    Source: src/services/legacy.py (legacy_handler)
    Commit: abc123de (2024-06-01 - 183 days old)
    Recommendation: Re-ingest or verify manually

[more items...]

Summary: 6/45 source links are stale
```

## Implementation Details

### Utility Modules Created

#### 1. `source_ref_utils.py`
**Purpose**: Utilities for extracting and filtering source references

**Key Functions**:
- `get_source_reference(element_data)`: Extract source reference from element
- `has_source_reference(element_data)`: Check if element has source reference
- `get_source_provenance(element_data)`: Extract provenance type
- `get_source_locations(element_data)`: Extract file/symbol locations
- `get_repository_info(element_data)`: Extract repository metadata
- `filter_elements_by_source()`: Filter elements by source criteria

**Data Structure**:
```python
{
  "properties": {
    "source": {
      "reference": {
        "provenance": "manual|extracted|inferred|generated",
        "locations": [
          {
            "file": "src/services/legacy.py",
            "symbol": "LegacyServiceHandler"
          }
        ],
        "repository": {
          "url": "https://github.com/example/repo.git",
          "commit": "abc123def456...",
          "timestamp": "2024-06-01T10:30:00"
        }
      }
    }
  }
}
```

#### 2. `staleness_checker.py`
**Purpose**: Check for stale source references based on commit age

**Key Functions**:
- `parse_threshold(threshold_str)`: Parse threshold strings (e.g., "90days", "6months")
- `get_commit_date(element_data)`: Extract commit timestamp from element
- `check_staleness()`: Identify stale source references
- `format_stale_report()`: Format staleness results for display

**Supports Threshold Formats**:
- Days: "1day", "90days"
- Weeks: "1week", "4weeks"
- Months: "1month", "6months" (approximated as 30 days per month)
- Years: "1year", "2years" (approximated as 365 days per year)

## Test Coverage

### Unit Tests

#### 1. `tests/utils/test_source_ref_utils.py` (31 tests)
- Test source reference extraction (5 tests)
- Test source reference presence checking (3 tests)
- Test provenance extraction (5 tests)
- Test location extraction (4 tests)
- Test repository info extraction (3 tests)
- Test filtering by source criteria (11 tests)

**Coverage**: 94% of `source_ref_utils.py`

#### 2. `tests/utils/test_staleness_checker.py` (31 tests)
- Test threshold parsing (12 tests)
- Test commit date extraction (5 tests)
- Test staleness checking (8 tests)
- Test report formatting (6 tests)

**Coverage**: 93% of `staleness_checker.py`

#### 3. `tests/commands/test_search_source_filters.py` (13 tests)
- Integration tests for `dr search` source filtering
- Tests for flag validation
- Tests for different provenance types
- Tests for combining filters with other options

### All Tests Pass
- Unit tests: 62/62 passing
- Integration tests: 19/19 passing (existing search tests)
- No regressions in existing functionality

## Files Modified

### Commands
- `cli/src/documentation_robotics/commands/search.py`
  - Added source reference filter options
  - Added validation logic
  - Integrated filtering into search flow

- `cli/src/documentation_robotics/commands/links.py`
  - Added `check-staleness` subcommand
  - Integrated staleness checking logic
  - Added text and JSON output formats

### Utilities (New)
- `cli/src/documentation_robotics/utils/source_ref_utils.py`
  - Helper functions for source reference handling
  - Filter functionality

- `cli/src/documentation_robotics/utils/staleness_checker.py`
  - Staleness detection logic
  - Threshold parsing
  - Report formatting

### Tests (New)
- `cli/tests/utils/test_source_ref_utils.py`
  - 31 unit tests for source reference utilities

- `cli/tests/utils/test_staleness_checker.py`
  - 31 unit tests for staleness checking

- `cli/tests/commands/test_search_source_filters.py`
  - 13 integration tests for search source filtering

- `cli/tests/utils/__init__.py`
  - Package initialization file

## Acceptance Criteria Met

✅ `--has-source-ref` flag added to dr search
✅ `--no-source-ref` flag added to dr search
✅ `--source-provenance` option added with enum choices (extracted, manual, inferred, generated)
✅ `dr links check-staleness` subcommand implemented
✅ Staleness check compares commit timestamps against threshold
✅ Clear output for stale links with recommendations
✅ Unit tests cover filtering and staleness checking
✅ Code reviewed and implemented (all tests passing)

## Key Design Decisions

1. **Flexible Source Reference Storage**: Works with existing element data structure where source references are stored in `properties.source.reference`

2. **Backward Compatibility**: All additions are new options/commands; no breaking changes to existing APIs

3. **Efficient Filtering**: Filter operations are applied at the Python level after element retrieval, allowing for flexible composition with other filters

4. **Extensible Staleness Checking**: Threshold parsing is flexible and can be extended with additional time units

5. **Rich Output Formats**: Supports both human-readable and JSON output formats for integration with other tools

## Integration Points

- Works seamlessly with existing `--layer`, `--type`, `--name`, `--property`, and `--limit` filters in search
- Staleness checking integrates with model loading and layer iteration
- Both utilities follow established patterns in codebase for error handling and output formatting

## Documentation

- Comprehensive docstrings for all functions
- Clear usage examples in command help text
- Error messages guide users toward correct usage
- Test cases serve as executable documentation

## Future Enhancements

Potential future improvements:
1. Git repository integration to automatically fetch real commit dates
2. Batch updating of source references with new commit information
3. Custom threshold configurations per element type
4. Integration with CI/CD pipelines for automated staleness reporting
5. Source reference analytics and historical tracking
