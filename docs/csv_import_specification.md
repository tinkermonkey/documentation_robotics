# Context Studio CSV Import Specification

**Version:** 1.0
**Date:** 2025-12-12
**Target System:** Context Studio Local Server

## Overview

This specification defines the CSV format required for importing hierarchical taxonomy data (Layers, Domains, and Terms) into Context Studio. Development teams creating CSV export modules must adhere to this format to ensure compatibility with the Context Studio import utility.

---

## File Format Requirements

### Basic Format
- **File Type:** CSV (Comma-Separated Values)
- **Encoding:** UTF-8
- **Line Endings:** Any standard format (LF, CRLF)
- **Header Row:** Required (first row must contain column names)
- **Delimiter:** Comma (`,`)
- **Text Qualifier:** Double quotes (`"`) for fields containing commas or line breaks

### File Structure
The CSV file must contain a header row followed by data rows. Each row represents a single entity (Layer, Domain, or Term) in the taxonomy hierarchy.

---

## Column Specifications

### Required Columns

| Column Name | Type | Required | Max Length | Description |
|------------|------|----------|------------|-------------|
| `Depth` | Integer | Yes | - | Hierarchy level (0=Layer, 1=Domain, 2+=Term) |
| `Title` | String | Yes | 255 | Display name of the entity |
| `Definition` | String | No | - | Descriptive text explaining the entity |
| `ID` | String (UUID) | No | 36 | Unique identifier (auto-generated if omitted) |

### Column Details

#### `Depth` (Required)
- **Type:** Integer (0 or positive)
- **Purpose:** Determines the type and hierarchy level of the entity
- **Values:**
  - `0` = Layer (top-level category)
  - `1` = Domain (second-level category, child of Layer)
  - `2` or higher = Term (child of Domain or another Term)
- **Validation:**
  - Must be parseable as an integer
  - Cannot be negative
  - Whitespace is trimmed before parsing
- **Error Handling:** Rows with missing or invalid Depth values are skipped with a warning

#### `Title` (Required)
- **Type:** String
- **Purpose:** Human-readable name for the entity
- **Constraints:**
  - Cannot be null or empty
  - Recommended maximum: 255 characters
- **Behavior:** Used for display and as the primary identifier

#### `Definition` (Optional)
- **Type:** String (multiline supported)
- **Purpose:** Detailed description or definition of the entity
- **Constraints:**
  - Can be null or empty
  - No length restrictions
- **Behavior:** Provides context and meaning for the entity

#### `ID` (Optional)
- **Type:** String (UUID format recommended)
- **Purpose:** Unique identifier for the entity
- **Constraints:**
  - Must be unique across all entities of the same type
  - If provided, must not conflict with existing IDs in the database
- **Behavior:**
  - If omitted, a UUID v4 is automatically generated
  - If provided, used for idempotent updates (creates or updates based on ID match)
- **Format:** UUID format recommended (e.g., `550e8400-e29b-41d4-a716-446655440000`)

---

## Hierarchy Rules

### Parent-Child Relationships

The import process establishes relationships based on row order and depth values:

1. **Layers (Depth 0)**
   - Top-level entities
   - No parent relationships
   - Each Layer row sets the "current layer" context for subsequent Domains

2. **Domains (Depth 1)**
   - Children of the most recently defined Layer
   - If no Layer is defined (Depth 0), domains are assigned to a default "Import" layer
   - Each Domain row sets the "current domain" context for subsequent Terms

3. **Terms (Depth ≥ 2)**
   - Must follow a Domain (Depth 1) in the CSV
   - Parent relationship determined by previous row at `Depth - 1`
   - Terms at Depth 2 are children of the current Domain
   - Terms at Depth 3+ are children of the previous Term at Depth 2, 3, etc.
   - Orphan terms (no Domain context) are skipped with a warning

### Hierarchy Construction Algorithm

```
Initialize: last_layer = null, last_domain = null, last_terms_by_depth = {}

For each row:
  If Depth == 0:
    Create/Update Layer
    Set last_layer = this Layer

  Else If Depth == 1:
    Create/Update Domain
    Set parent_layer = last_layer (or default "Import" layer)
    Set last_domain = this Domain

  Else If Depth > 1:
    Create/Update Term
    Set parent_term = last_terms_by_depth[Depth - 1] (if exists)
    Set parent_domain = last_domain
    Set parent_layer = last_layer
    Store in last_terms_by_depth[Depth] = this Term
```

### Important Hierarchy Constraints

- **Sequential Processing:** Rows are processed in order; ensure proper sequencing
- **Context Inheritance:** Entities inherit their parent context from previously processed rows
- **Depth Gaps:** Avoid gaps in depth values (e.g., don't jump from Depth 2 to Depth 5)
- **Domain Requirement:** Terms (Depth ≥ 2) require a preceding Domain (Depth 1)

---

## Import Behavior

### Create vs. Update Logic

The import utility uses **upsert** logic based on the `ID` field:

- **If ID is provided:**
  - Checks if entity with that ID exists
  - If exists: Updates `title` and `definition` fields
  - If not exists: Creates new entity with provided ID

- **If ID is omitted:**
  - Always creates a new entity with auto-generated UUID
  - May result in duplicates if Title matches existing entities

### Error Handling

| Error Condition | Behavior |
|----------------|----------|
| Missing or invalid `Depth` | Row skipped with warning |
| Missing `Title` | Row processed (may fail at database level) |
| Duplicate `ID` | Error logged, row skipped, transaction rolled back |
| Term without Domain context | Row skipped with warning |
| Invalid parent relationship | Row skipped with warning |

### Transaction Boundaries

- Each row is committed individually
- Failed rows do not rollback previous successful imports
- Duplicate ID errors rollback only the failed row

---

## Example CSV Files

### Example 1: Simple Hierarchy

```csv
Depth,Title,Definition,ID
0,Business Concepts,Top-level business concepts,layer-001
1,Finance,Financial management domain,domain-001
2,Revenue,Income generated from business operations,term-001
3,Recurring Revenue,Predictable revenue from subscriptions,term-002
3,One-time Revenue,Single transaction revenue,term-003
2,Expenses,Costs incurred in business operations,term-004
1,Operations,Operational processes,domain-002
2,Logistics,Supply chain and delivery,term-005
```

**Result Structure:**
```
Layer: Business Concepts
├── Domain: Finance
│   ├── Term: Revenue
│   │   ├── Term: Recurring Revenue
│   │   └── Term: One-time Revenue
│   └── Term: Expenses
└── Domain: Operations
    └── Term: Logistics
```

### Example 2: Multiple Layers

```csv
Depth,Title,Definition,ID
0,Technical Architecture,System architecture layer,
1,Frontend,User interface domain,
2,React Components,Reusable UI components,
2,State Management,Application state handling,
0,Data Layer,Data management layer,
1,Databases,Data storage systems,
2,PostgreSQL,Relational database,
2,Redis,In-memory cache,
```

**Result Structure:**
```
Layer: Technical Architecture
└── Domain: Frontend
    ├── Term: React Components
    └── Term: State Management

Layer: Data Layer
└── Domain: Databases
    ├── Term: PostgreSQL
    └── Term: Redis
```

### Example 3: Deep Nesting (5 Levels)

```csv
Depth,Title,Definition,ID
0,Taxonomy,Main classification system,
1,Biology,Biological classification,
2,Animals,Animal kingdom,
3,Mammals,Warm-blooded vertebrates,
4,Primates,Order of mammals,
5,Humans,Homo sapiens,
```

**Result Structure:**
```
Layer: Taxonomy
└── Domain: Biology
    └── Term: Animals
        └── Term: Mammals
            └── Term: Primates
                └── Term: Humans
```

### Example 4: ID Omission (Auto-generation)

```csv
Depth,Title,Definition
0,Quick Import,Rapidly imported layer
1,Testing,Test domain
2,Unit Tests,Component testing
```

**Behavior:** System generates UUIDs automatically for all three entities.

---

## Validation Checklist

Before exporting CSV files, ensure:

- [ ] Header row contains exactly: `Depth,Title,Definition,ID`
- [ ] All rows have valid `Depth` integer values (0 or positive)
- [ ] All rows have non-empty `Title` values
- [ ] Depth values follow logical sequence (no large gaps)
- [ ] Domains (Depth 1) appear before their Terms (Depth 2+)
- [ ] IDs are unique within the file (if provided)
- [ ] IDs are valid UUIDs or omitted entirely
- [ ] File is UTF-8 encoded
- [ ] Special characters in `Title` and `Definition` are properly escaped
- [ ] Multi-line definitions are enclosed in double quotes

---

## Command Line Usage

The import utility is invoked via command line:

```bash
# Standard import
python utils/import_csv.py -f /path/to/file.csv

# Debug mode (verbose logging)
python utils/import_csv.py -f /path/to/file.csv -d

# Test mode (import first 10 rows only)
python utils/import_csv.py -f /path/to/file.csv --test
```

---

## Technical Notes

### Database Schema Compatibility

This CSV format is designed for the Context Studio database schema where:
- Layers, Domains, and Terms may be stored in separate tables OR a unified `structure_nodes` table with a `node_type` discriminator
- Parent-child relationships are managed through foreign key references
- UUIDs are stored as strings in SQLite

### Character Encoding

- All text fields support full UTF-8 character set
- Emojis and special Unicode characters are supported
- No BOM (Byte Order Mark) required

### Performance Considerations

- Large files (10,000+ rows) process successfully but may take several minutes
- Use `--test` flag to validate format with first 10 rows before full import
- Each row commits individually, so partial imports are preserved on errors

---

## Support and Troubleshooting

### Common Issues

**Issue:** "Row missing or invalid Depth"
- **Cause:** Depth column contains non-integer values or is empty
- **Fix:** Ensure all Depth values are integers (0, 1, 2, etc.)

**Issue:** "No domain found for term"
- **Cause:** Term (Depth 2+) appears before any Domain (Depth 1)
- **Fix:** Reorder rows so Domains appear before their Terms

**Issue:** "Duplicate Term with id"
- **Cause:** ID already exists in database
- **Fix:** Remove ID column to auto-generate, or use unique IDs

**Issue:** "File not found"
- **Cause:** Invalid file path
- **Fix:** Use absolute paths or verify relative path is correct

---

## Appendix: Column Header Variations

**Strict Requirement:** Column headers must match exactly as specified. The following are **NOT** accepted:

- ❌ `depth`, `DEPTH` (case-sensitive, must be `Depth`)
- ❌ `Name` instead of `Title`
- ❌ `Description` instead of `Definition`
- ❌ `Identifier` or `UUID` instead of `ID`

**Accepted:** Only `Depth`, `Title`, `Definition`, `ID` (exact case match)

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12-12 | Initial specification based on `utils/import_csv.py` |

---

## Contact

For questions or issues with this specification, please contact the Context Studio development team or file an issue in the project repository.
