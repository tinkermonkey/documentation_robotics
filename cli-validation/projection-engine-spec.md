# Projection Engine - Python CLI Behavior Specification

**Source:** `cli-validation/python-cli/src/documentation_robotics/core/projection_engine.py` (540 lines)

**Purpose:** Automatically creates elements across layers based on projection rules with property transformations, conditional logic, and template rendering.

## Overview

The Projection Engine is the most complex component, supporting:

- **Rule-based projection** from source to target layers
- **Property transformations** (uppercase, kebab-case, template rendering, etc.)
- **Conditional projections** (operator-based filtering)
- **Jinja2 template support** for advanced property mapping
- **Bidirectional relationships** (auto-creates reverse links)
- **YAML rule loading** from configuration files

## Data Structures

### ProjectionCondition

```python
@dataclass
class ProjectionCondition:
    field: str          # Field to check (supports dot notation)
    operator: str       # equals, not_equals, contains, matches, exists, gt, lt, in
    value: Optional[Any] = None
    pattern: Optional[str] = None  # For regex matching
```

**Operators:**

- `exists`: Field has non-None value
- `equals`: Field value equals specified value
- `not_equals`: Field value not equal to value
- `contains`: Value string is contained in field value
- `matches`: Field value matches regex pattern
- `gt`: Field value > value (greater than)
- `lt`: Field value < value (less than)
- `in`: Field value is in list

**TypeScript Equivalent:**

```typescript
interface ProjectionCondition {
  field: string;
  operator: "exists" | "equals" | "not_equals" | "contains" | "matches" | "gt" | "lt" | "in";
  value?: any;
  pattern?: string;
}
```

### PropertyTransform

```python
@dataclass
class PropertyTransform:
    type: str  # uppercase, lowercase, kebab, snake, pascal, prefix, suffix, template
    value: Optional[str] = None  # For prefix/suffix/template
```

**Transform Types:**

- `uppercase`: Convert to UPPERCASE
- `lowercase`: Convert to lowercase
- `kebab`: Convert to kebab-case (spaces/underscores → hyphens, lowercase)
- `snake`: Convert to snake_case (spaces/hyphens → underscores, lowercase)
- `pascal`: Convert to PascalCase (capitalize each word, remove separators)
- `prefix`: Add prefix before value (requires `value` parameter)
- `suffix`: Add suffix after value (requires `value` parameter)
- `template`: Format using string template with `{value}` placeholder

**Examples:**

```yaml
"Customer Management" →
  uppercase: "CUSTOMER MANAGEMENT"
  lowercase: "customer management"
  kebab: "customer-management"
  snake: "customer_management"
  pascal: "CustomerManagement"
  prefix (value="app-"): "app-Customer Management"
  suffix (value="-service"): "Customer Management-service"
  template (value="Service: {value}"): "Service: Customer Management"
```

**TypeScript Equivalent:**

```typescript
interface PropertyTransform {
  type: "uppercase" | "lowercase" | "kebab" | "snake" | "pascal" | "prefix" | "suffix" | "template";
  value?: string;
}
```

### PropertyMapping

```python
@dataclass
class PropertyMapping:
    source: str                            # Source property path or template
    target: str                            # Target property path
    default: Optional[Any] = None          # Default if source is None
    required: bool = False                 # Error if missing
    transform: Optional[PropertyTransform] = None
```

**Features:**

- Dot notation for nested properties: `"properties.description"`
- Element attributes: `"id"`, `"name"`, `"type"`, `"layer"`
- Template strings: `"{source.name}"`
- Jinja2 templates: `"{{ source.name | upper }}"`
- Default values when source is None
- Required validation (throws error if missing)
- Transformation pipeline

**TypeScript Equivalent:**

```typescript
interface PropertyMapping {
  source: string;
  target: string;
  default?: any;
  required?: boolean;
  transform?: PropertyTransform;
}
```

### ProjectionRule

```python
@dataclass
class ProjectionRule:
    name: str
    from_layer: str
    from_type: str
    to_layer: str
    to_type: str
    name_template: str
    property_mappings: Union[Dict[str, str], List[PropertyMapping]]
    conditions: List[ProjectionCondition] = []
    template_file: Optional[str] = None
    create_bidirectional: bool = True
```

**Key Fields:**

- `from_layer`/`from_type`: Source element filter
- `to_layer`/`to_type`: Target element type to create
- `name_template`: Template for projected element name (e.g., `"{source.name} Service"`)
- `property_mappings`: How to map properties (supports both formats)
- `conditions`: Filters that must all evaluate to true
- `create_bidirectional`: If true, adds `realizes: source.id` to projected element

**TypeScript Equivalent:**

```typescript
interface ProjectionRule {
  name: string;
  from_layer: string;
  from_type: string;
  to_layer: string;
  to_type: string;
  name_template: string;
  property_mappings: PropertyMapping[];
  conditions?: ProjectionCondition[];
  template_file?: string;
  create_bidirectional?: boolean;
}
```

## Constructor & Rule Loading

### Constructor

```python
def __init__(self, model: Any, rules_path: Optional[Path] = None):
    self.model = model
    self.rules: List[ProjectionRule] = []
    if rules_path and rules_path.exists():
        self.load_rules(rules_path)
```

**Behavior:**

- Stores reference to model
- Initializes empty rules list
- Loads rules from YAML if path provided

### load_rules()

```python
def load_rules(self, path: Path) -> None:
    # Load YAML file
    # Parse "projections" array
    # Create ProjectionRule objects
```

**YAML Format:**

```yaml
projections:
  - name: "Business to Application"
    from: business.service
    to: application.service
    conditions:
      - field: type
        operator: equals
        value: core
    rules:
      - create_type: service
        name_template: "{source.name} Service"
        properties:
          description:
            source: description
            transform: uppercase
        create_bidirectional: true
```

**Parsing Logic:**

1. Split `from` and `to` by `.` to get layer and type
2. Get first item from `rules` array (simplified - could support multiple)
3. Parse conditions into `ProjectionCondition` objects
4. Parse properties into `PropertyMapping` objects (supports simple string or object)
5. Set defaults for optional fields

## Public Methods

### 1. find_applicable_rules()

**Signature:**

```python
def find_applicable_rules(
    source: Any,
    target_layer: Optional[str] = None
) -> List[ProjectionRule]
```

**Purpose:** Find rules that apply to a source element.

**Algorithm:**

1. Iterate through all loaded rules
2. Check if `rule.from_layer` matches `source.layer`
3. Check if `rule.from_type` matches `source.type` (or is None)
4. Check if `target_layer` matches `rule.to_layer` (if filter provided)
5. Evaluate all conditions - ALL must be true
6. Return list of matching rules

**Important Details:**

- Rules without `from_type` match any type in layer
- Empty target_layer filter matches all
- Conditions use AND logic (all must pass)
- Returns empty list if no matches

**Test Cases:**

```yaml
test_layer_match:
  rule: { from_layer: business, from_type: service }
  element: { layer: business, type: service }
  expected: [rule]

test_type_mismatch:
  rule: { from_layer: business, from_type: capability }
  element: { layer: business, type: service }
  expected: []

test_condition_match:
  rule:
    from_layer: business
    conditions:
      - field: type
        operator: equals
        value: core
  element: { layer: business, properties: { type: core } }
  expected: [rule]

test_condition_fail:
  rule:
    from_layer: business
    conditions:
      - field: type
        operator: equals
        value: core
  element: { layer: business, properties: { type: support } }
  expected: []
```

### 2. project_element()

**Signature:**

```python
def project_element(
    source: Any,
    target_layer: str,
    rule: Optional[ProjectionRule] = None,
    dry_run: bool = False
) -> Optional[Any]
```

**Purpose:** Project a single element to target layer.

**Algorithm:**

1. If rule not provided, find applicable rules (use first match)
2. Build projected element using `_build_projected_element()`
3. If dry_run=True, return element without adding to model
4. If dry_run=False:
   - Add element to model via `model.add_element()`
   - Register with reference registry (if available)
   - Return projected element

**Important Details:**

- Throws `ValueError` if no applicable rule found
- Throws `ValueError` if projection fails (e.g., required field missing)
- dry_run allows validation without modifying model
- Automatically registers element with reference registry

**Test Cases:**

```yaml
test_basic_projection:
  source: { id: business.service.crm, name: CRM }
  rule: { to_layer: application, to_type: service, name_template: "{source.name} Service" }
  expected:
    id: application.service.crm-service
    name: CRM Service
    properties:
      realizes: business.service.crm

test_dry_run:
  source: { id: business.service.crm }
  dry_run: true
  expected: Element returned but not added to model

test_no_rule_found:
  source: { layer: motivation }
  target_layer: application
  rules: []
  expected: ValueError
```

### 3. \_build_projected_element() (Private but Critical)

**Signature:**

```python
def _build_projected_element(source: Any, rule: ProjectionRule) -> Any
```

**Purpose:** Build the projected element from source and rule.

**Algorithm:**

1. **Render name:** Use `_render_template()` with `rule.name_template`
2. **Generate ID:** Call `generate_element_id(layer, type, name)`
3. **Initialize data dict:** `{id, name}`
4. **Map properties:**
   - If `property_mappings` is dict (legacy):
     - Key = target property, Value = source spec
     - If value starts with `{` or `{{`: Render as template
     - Otherwise: Get nested property from source
   - If `property_mappings` is list (new):
     - For each mapping:
       - Get source value (element attribute or nested property)
       - Use default if None
       - Check required (throw error if missing)
       - Apply transform if present
       - Set nested target property
5. **Add bidirectional ref:** If `create_bidirectional=true`, add `properties.realizes = source.id`
6. **Create Element:** Return new Element object

**Important Details:**

- ID generation uses kebab-case conversion
- Template rendering supports both `{source.xxx}` and `{{ source.xxx }}`
- Nested property access uses dot notation
- Element attributes (id, name, type, layer) accessible directly
- Transformations applied after default value resolution
- Required validation happens before transformation

### 4. \_render_template() (Private but Critical)

**Signature:**

```python
def _render_template(template_str: str, source: Any) -> str
```

**Purpose:** Render template string with source element data.

**Algorithm:**

1. Build context dict with all source element data
2. Add convenience properties:
   - `name_pascal`: PascalCase version of name
   - `name_kebab`: kebab-case version
   - `name_snake`: snake_case version
3. Wrap in `{"source": {...}}` for Jinja2 access
4. If template contains `{{`: Use Jinja2 Template
5. Otherwise: Use Python string replacement for `{source.xxx}`

**Important Details:**

- Jinja2 supports filters and expressions: `{{ source.name | upper }}`
- Simple format just does literal replacement
- All element attributes exposed in template context
- Convenience case conversions provided

**Examples:**

```python
source = {name: "Customer Management"}

"{source.name}" → "Customer Management"
"{source.name} Service" → "Customer Management Service"
"{{ source.name | upper }}" → "CUSTOMER MANAGEMENT"
"{source.name_kebab}" → "customer-management"
"{source.name_pascal}Component" → "CustomerManagementComponent"
```

### 5. project_all()

**Signature:**

```python
def project_all(
    from_layer: Optional[str] = None,
    to_layer: Optional[str] = None,
    dry_run: bool = False
) -> List[Any]
```

**Purpose:** Project all applicable elements in batch.

**Algorithm:**

1. Get source elements:
   - If `from_layer` specified: Get elements from that layer
   - Otherwise: Get all elements from all layers
2. For each source element:
   - Find applicable rules (with optional to_layer filter)
   - For each matching rule:
     - Try to project element
     - Catch errors, log warning, continue
3. Return list of all successfully projected elements

**Important Details:**

- Errors are caught and logged, don't stop batch processing
- Returns list of projected elements
- dry_run propagates to individual projections
- Can filter by source and/or target layer

## Helper Methods

### \_get_nested_property()

```python
def _get_nested_property(data: dict, path: str) -> Any
```

- Split path by `.` (e.g., `"properties.description"`)
- Navigate dict structure
- Return None if path doesn't exist

### \_set_nested_property()

```python
def _set_nested_property(data: dict, path: str, value: Any) -> None
```

- Split path by `.`
- Create intermediate dicts as needed
- Set final key to value

### \_to_pascal_case()

```python
def _to_pascal_case(text: str) -> str
```

- Split on spaces, hyphens, underscores
- Capitalize each word
- Join without separators

### \_to_snake_case()

```python
def _to_snake_case(text: str) -> str
```

- Convert to kebab-case first
- Replace hyphens with underscores

## Condition Evaluation

### evaluate() on ProjectionCondition

**Operators:**

```python
exists: field_value is not None
equals: field_value == value
not_equals: field_value != value
contains: value in str(field_value)
matches: re.match(pattern, str(field_value))
gt: field_value > value
lt: field_value < value
in: field_value in value (value must be list)
```

**Nested Field Access:**

- Supports dot notation: `"properties.capabilities.type"`
- Handles missing intermediate keys gracefully (returns None)

## Property Transform Implementation

### apply() on PropertyTransform

```python
uppercase: str_value.upper()
lowercase: str_value.lower()
kebab: str_value.lower().replace(" ", "-").replace("_", "-")
snake: str_value.lower().replace(" ", "_").replace("-", "_")
pascal: "".join(w.capitalize() for w in words)
prefix: f"{self.value}{str_value}"
suffix: f"{str_value}{self.value}"
template: self.value.format(value=str_value)
```

**Important:**

- All transforms convert to string first
- None values return None (no transformation)
- kebab/snake normalize to lowercase
- pascal capitalizes each word

## Edge Cases

1. **Missing source property + no default:** Returns None (not projected)
2. **Missing required property:** Throws ValueError
3. **Invalid template syntax:** Jinja2 throws TemplateError
4. **Circular projection:** Not prevented (could create infinite loop)
5. **Duplicate element IDs:** Model validation should catch this
6. **Empty conditions list:** Matches all elements
7. **Transform on None value:** Returns None
8. **Nested property doesn't exist:** Returns None

## YAML Rule File Format

```yaml
projections:
  - name: "Business to Application"
    from: business.service # Layer.Type
    to: application.service # Layer.Type

    conditions: # Optional filtering
      - field: properties.type
        operator: equals
        value: core
      - field: name
        operator: contains
        value: Service

    rules: # Array, but only first used
      - create_type: service # Type for projected elements
        name_template: "{source.name} Application Service"

        properties: # Property mappings
          # Simple format (target: source)
          description: description

          # Advanced format with transform
          title:
            source: name
            transform: uppercase
            default: "Untitled"
            required: false

          # Template format
          fullName: "{source.name} - {source.type}"

        create_bidirectional: true # Add realizes: source.id
        template: template.j2 # External Jinja2 template (optional)
```

## TypeScript Implementation Checklist

- [ ] ProjectionCondition interface with all 8 operators
- [ ] ProjectionCondition.evaluate() with nested field access
- [ ] PropertyTransform interface with all 8 types
- [ ] PropertyTransform.apply() implementation
- [ ] PropertyMapping interface
- [ ] ProjectionRule interface
- [ ] ProjectionEngine class with model reference
- [ ] load_rules() YAML parser
- [ ] find_applicable_rules() with condition evaluation
- [ ] project_element() with dry_run support
- [ ] \_build_projected_element() with all mapping formats
- [ ] \_render_template() with Jinja2 and simple format
- [ ] project_all() batch processor
- [ ] Helper methods for nested property access
- [ ] Case conversion utilities (pascal, kebab, snake)
- [ ] Unit tests for all components
- [ ] Integration test with real projection rules

## Performance Characteristics

- **load_rules():** O(N) where N = number of rules in file
- **find_applicable_rules():** O(R \* C) where R = rules, C = conditions per rule
- **project_element():** O(M) where M = property mappings
- **project_all():** O(E _R_ M) where E = elements, R = rules, M = mappings
- **Template rendering:** Depends on Jinja2 complexity

## Migration Notes

**Jinja2 Dependency:**

- Python uses Jinja2 for template rendering
- TypeScript options: Nunjucks, Handlebars, or simple replacement
- Nunjucks is most compatible with Jinja2 syntax

**ID Generation:**

- Python uses `generate_element_id()` utility function
- Should produce kebab-case IDs: `layer.type.name-in-kebab-case`

**Element Creation:**

- Python creates Element objects with specific constructor
- TypeScript Element class must support same data structure
