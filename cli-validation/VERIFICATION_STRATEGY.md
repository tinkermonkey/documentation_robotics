# Behavioral Verification Strategy for TypeScript CLI Components

## Why Not AST Analysis?

AST (Abstract Syntax Tree) analysis would be ineffective because:

1. **Different Language Paradigms**
   - Python: Dynamic typing, duck typing, multiple inheritance
   - TypeScript: Static typing, interfaces, single inheritance

2. **Different Implementation Patterns**
   - Python uses `networkx` library for graphs
   - TypeScript uses `graphology` library
   - Same algorithm, different APIs

3. **Structural Differences are OK**

   ```python
   # Python
   def get_dependency_layers(self, element_id: str) -> Dict[str, List[str]]:
       by_layer: Dict[str, List[str]] = {}
       # implementation
   ```

   ```typescript
   // TypeScript
   getDependencyLayers(elementId: string): Map<string, string[]> {
       const byLayer = new Map<string, string[]>();
       // implementation
   }
   ```

   **AST would see:** Different node types, different syntax
   **Reality:** Identical behavior

## Better Approach: Behavior-Based Verification

### Strategy Overview

```
┌─────────────────────┐
│  Python CLI Code    │ ──────┐
│  (Source of Truth)  │       │
└─────────────────────┘       │
                              ▼
                     ┌─────────────────────┐
                     │ Extract Behavior    │
                     │ Specification       │
                     └─────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
   ┌──────────────────────┐      ┌──────────────────────┐
   │ Unit Tests           │      │ Integration Tests    │
   │ (Isolated behavior)  │      │ (Real model data)    │
   └──────────────────────┘      └──────────────────────┘
              │                               │
              └───────────────┬───────────────┘
                              ▼
                     ┌─────────────────────┐
                     │ TypeScript CLI      │
                     │ Implementation      │
                     └─────────────────────┘
```

---

## Step 1: Document Python Behavior as Specification

### Method: Code Analysis + Documentation

For each Python class method:

1. Document what it does (not how)
2. Document input parameters and types
3. Document return value and type
4. Document edge cases and error conditions
5. Create example test cases

### Example: ReferenceRegistry.trace_dependencies()

**Python Specification:**

```yaml
method: trace_dependencies
class: ReferenceRegistry
purpose: Find all elements that depend on or are depended on by a given element

parameters:
  element_id:
    type: string
    description: ID of element to trace from
  direction:
    type: enum[UP, DOWN, BOTH]
    description: |
      UP: Find what element_id depends on (outgoing edges)
      DOWN: Find what depends on element_id (incoming edges)
      BOTH: Both directions
  max_depth:
    type: int | None
    description: Maximum traversal depth, None for unlimited

returns:
  type: List[Element]
  description: All elements found in trace

behavior:
  - Returns empty list if element_id not in graph
  - Performs DFS traversal in specified direction(s)
  - max_depth limits number of hops from source
  - Excludes source element from results
  - Does not return duplicates

edge_cases:
  - element_id not found: return []
  - max_depth = 0: return direct neighbors only
  - circular dependencies: each node visited once only
  - disconnected graph: only returns reachable nodes

examples:
  - name: Simple chain
    graph: A -> B -> C
    call: trace_dependencies('A', UP, None)
    expected: [B, C]

  - name: With max_depth
    graph: A -> B -> C -> D
    call: trace_dependencies('A', UP, 2)
    expected: [B, C]

  - name: Cycle
    graph: A -> B -> C -> A
    call: trace_dependencies('A', UP, None)
    expected: [B, C] # A excluded as source
```

---

## Step 2: Extract Test Cases from Python Code

### Automated Test Generation

```python
# Python script to generate TypeScript test cases
import ast
import inspect
from documentation_robotics.core import ReferenceRegistry, DependencyTracker, ProjectionEngine

def extract_test_from_docstring(method):
    """Parse examples from docstrings into test cases"""
    if method.__doc__:
        # Look for Examples section
        # Generate TypeScript test
        pass

def extract_test_from_implementation(method):
    """Analyze implementation to infer test cases"""
    source = inspect.getsource(method)
    tree = ast.parse(source)

    # Find:
    # - If statements (edge cases)
    # - Error handling (exceptions)
    # - Return statements (expected outputs)
    pass

# Generate test suite
for cls in [ReferenceRegistry, DependencyTracker, ProjectionEngine]:
    for method_name in dir(cls):
        if not method_name.startswith('_'):
            method = getattr(cls, method_name)
            if callable(method):
                extract_test_from_docstring(method)
                extract_test_from_implementation(method)
```

---

## Step 3: Create Comprehensive Unit Tests

### Test Structure

```typescript
// tests/unit/core/reference-registry-compat.test.ts
import { describe, it, expect } from "bun:test";
import { ReferenceRegistry } from "@/core/reference-registry";
import { Element } from "@/core/element";

describe("ReferenceRegistry - Python CLI Compatibility", () => {
  describe("registerElement()", () => {
    it("should extract references from element.realizes property", () => {
      const registry = new ReferenceRegistry();

      const element = new Element({
        id: "business.service.customer",
        type: "service",
        name: "Customer Service",
        properties: {
          realizes: ["motivation.goal.customer-mgmt"],
        },
      });

      registry.registerElement(element);

      const refs = registry.getReferencesFrom("business.service.customer");
      expect(refs).toHaveLength(1);
      expect(refs[0].target).toBe("motivation.goal.customer-mgmt");
      expect(refs[0].type).toBe("realizes");
    });

    it("should handle array of references", () => {
      const registry = new ReferenceRegistry();

      const element = new Element({
        id: "app.service.user",
        type: "service",
        name: "User Service",
        properties: {
          accesses: ["data.entity.user", "data.entity.role"],
        },
      });

      registry.registerElement(element);

      const refs = registry.getReferencesFrom("app.service.user");
      expect(refs).toHaveLength(2);
      expect(refs.map((r) => r.target)).toContain("data.entity.user");
      expect(refs.map((r) => r.target)).toContain("data.entity.role");
    });
  });

  describe("Reference property detection", () => {
    // Test that we recognize same properties as Python CLI
    const KNOWN_REF_PROPERTIES = [
      "realizes",
      "realizedBy",
      "serves",
      "servedBy",
      "accesses",
      "accessedBy",
      "uses",
      "usedBy",
      "composedOf",
      "partOf",
      "flows",
      "triggers",
      "archimateRef",
      "businessActorRef",
      "stakeholderRef",
      "motivationGoalRef",
      "dataObjectRef",
      "apiOperationRef",
      "applicationServiceRef",
      "schemaRef",
    ];

    KNOWN_REF_PROPERTIES.forEach((propName) => {
      it(`should recognize '${propName}' as reference property`, () => {
        const registry = new ReferenceRegistry();

        const element = new Element({
          id: "test.element",
          type: "test",
          name: "Test",
          properties: {
            [propName]: "target.element",
          },
        });

        registry.registerElement(element);

        const refs = registry.getReferencesFrom("test.element");
        expect(refs.length).toBeGreaterThan(0);
      });
    });
  });
});
```

---

## Step 4: Integration Tests with Real Python CLI Model

### Use Your Actual Model as Test Data

```typescript
// tests/integration/python-cli-model.test.ts
import { describe, it, expect } from "bun:test";
import { Model } from "@/core/model";

const PYTHON_CLI_MODEL_PATH =
  "/Users/austinsand/workspace/documentation_robotics_viewer/documentation-robotics";

describe("Python CLI Model Integration", () => {
  let model: Model;

  beforeAll(async () => {
    model = await Model.load(PYTHON_CLI_MODEL_PATH);
  });

  describe("Reference Registry", () => {
    it("should extract all references from Python CLI model", async () => {
      const registry = model.referenceRegistry;
      const allRefs = registry.getAllReferences();

      // Python CLI model should have references
      expect(allRefs.length).toBeGreaterThan(0);

      // Log sample for manual verification
      console.log(`Found ${allRefs.length} references`);
      console.log("Sample references:", allRefs.slice(0, 5));
    });

    it("should find references to motivation.goal.visualize-arc", async () => {
      const registry = model.referenceRegistry;
      const refs = registry.getReferencesTo("motivation.goal.visualize-arc");

      // This goal should be realized by business capabilities
      expect(refs.length).toBeGreaterThan(0);

      refs.forEach((ref) => {
        expect(ref.target).toBe("motivation.goal.visualize-arc");
        console.log(`${ref.source} --[${ref.type}]--> ${ref.target}`);
      });
    });
  });

  describe("Dependency Tracker", () => {
    it("should trace dependencies for application.service element", async () => {
      const tracker = model.dependencyTracker;

      // Pick a known element from your model
      const appService = Array.from(model.layers.get("application")?.elements.values() || [])[0];
      if (!appService) {
        throw new Error("No application service found");
      }

      const deps = tracker.getTransitiveDependencies(appService.id);

      // Should find upstream dependencies
      console.log(`${appService.id} depends on ${deps.length} elements`);

      // Verify dependencies are from expected layers (motivation, business, etc.)
      const depLayers = new Set(deps.map((id) => id.split(".")[0]));
      console.log("Dependency layers:", Array.from(depLayers));
    });
  });
});
```

---

## Step 5: Differential Testing

### Compare Outputs Between Implementations

If we can run Python CLI alongside TypeScript CLI:

```typescript
// tests/differential/compare-implementations.test.ts
import { exec } from "child_process";
import { promisify } from "util";
import { Model } from "@/core/model";

const execAsync = promisify(exec);

describe("Differential Testing: Python vs TypeScript", () => {
  it("should produce same trace output as Python CLI", async () => {
    const elementId = "business.service.customer";

    // Run Python CLI
    const { stdout: pythonOutput } = await execAsync(
      `cd ${PYTHON_CLI_MODEL_PATH} && python -m documentation_robotics trace ${elementId} --output list`
    );

    // Run TypeScript CLI
    const model = await Model.load(PYTHON_CLI_MODEL_PATH);
    const deps = model.dependencyTracker.getTransitiveDependencies(elementId);

    // Parse Python output
    const pythonDeps = pythonOutput
      .split("\\n")
      .filter((line) => line.trim())
      .map((line) => line.trim());

    // Compare
    expect(new Set(deps)).toEqual(new Set(pythonDeps));
  });
});
```

---

## Step 6: Property-Based Testing

### Generate Random Test Cases

```typescript
// tests/property-based/reference-registry.test.ts
import { fc, test } from "@fast-check/bun";
import { ReferenceRegistry } from "@/core/reference-registry";
import { Element } from "@/core/element";

describe("ReferenceRegistry - Property-Based Tests", () => {
  test.prop([
    fc.array(
      fc.record({
        id: fc.string(),
        references: fc.array(fc.string()),
      })
    ),
  ])("adding and retrieving references should be consistent", (elements) => {
    const registry = new ReferenceRegistry();

    // Add all elements
    for (const elemData of elements) {
      const element = new Element({
        id: elemData.id,
        type: "test",
        name: "Test",
        references: elemData.references.map((target) => ({
          source: elemData.id,
          target,
          type: "test",
        })),
      });
      registry.registerElement(element);
    }

    // Verify: All added references should be retrievable
    for (const elemData of elements) {
      const refs = registry.getReferencesFrom(elemData.id);
      expect(refs.length).toBe(elemData.references.length);
    }
  });
});
```

---

## Step 7: Manual Verification Checklist

Create a checklist based on Python CLI behavior:

### Reference Registry Checklist

- [ ] Extracts references from all 22 known property names
- [ ] Builds three indexes: source, target, type
- [ ] Handles single string references
- [ ] Handles array of references
- [ ] Handles nested references (data.schemaRef)
- [ ] Loads definitions from layer schemas
- [ ] Falls back to link-registry.json
- [ ] Validates reference integrity (target exists)
- [ ] Provides fast lookups (O(1) by source/target/type)

### Dependency Tracker Checklist

- [ ] Traces UP (what element depends on)
- [ ] Traces DOWN (what depends on element)
- [ ] Traces BOTH directions
- [ ] Respects max_depth parameter
- [ ] Returns empty array for non-existent elements
- [ ] Handles circular dependencies correctly
- [ ] Finds all paths between two elements
- [ ] Groups dependencies by layer
- [ ] Finds orphaned elements
- [ ] Finds hub elements (high degree)

### Projection Engine Checklist

- [ ] Loads rules from projection-rules.yaml
- [ ] Matches rules by layer and type
- [ ] Evaluates conditions before projecting
- [ ] Applies property transformations (uppercase, kebab, etc.)
- [ ] Uses name templates with variable substitution
- [ ] Creates bidirectional relationships
- [ ] Supports dry-run mode
- [ ] Prevents duplicate projections
- [ ] Respects force flag

---

## Implementation Plan

### Phase 1: Document (1-2 days)

1. Read through Python CLI code systematically
2. Document each public method's behavior
3. Create specification docs (YAML format above)
4. Identify edge cases from code

### Phase 2: Unit Tests (2-3 days)

1. Write comprehensive unit tests based on specs
2. One test file per class
3. Test each public method
4. Test edge cases and error conditions
5. Aim for 100% code coverage

### Phase 3: Integration Tests (1-2 days)

1. Test with your actual Python CLI model
2. Verify reference extraction works
3. Verify dependency tracing works
4. Verify projection rules work (if you have projection-rules.yaml)

### Phase 4: Fix Bugs (2-3 days)

1. Run tests, identify failures
2. Compare TypeScript behavior to Python spec
3. Fix implementation bugs
4. Re-test until all pass

### Phase 5: Differential Testing (1 day, optional)

1. Install Python CLI from git history
2. Run same operations in both CLIs
3. Compare outputs
4. Document any intentional differences

---

## Success Criteria

✅ **100% of unit tests pass**

- Each method tested with multiple scenarios
- All edge cases covered
- All error conditions handled

✅ **Integration tests pass with real model**

- Loads your 275-element model correctly
- Extracts all references
- Traces dependencies accurately
- No crashes or exceptions

✅ **Manual verification complete**

- All checklist items verified
- Outputs match expectations
- Performance acceptable

✅ **Documentation complete**

- API docs for all public methods
- Usage examples
- Migration guide from Python CLI

---

## Tools & Libraries

```json
{
  "testing": {
    "unit": "bun:test",
    "property-based": "@fast-check/bun",
    "coverage": "bun test --coverage"
  },
  "analysis": {
    "ast": "ts-morph (TypeScript), ast module (Python)",
    "static-analysis": "eslint, typescript compiler"
  },
  "comparison": {
    "diff": "diff-match-patch",
    "structure": "deep-object-diff"
  }
}
```

---

## Alternative: Snapshot Testing

If differential testing is complex, use snapshot testing:

```typescript
it("should match Python CLI snapshot for reference extraction", () => {
  const registry = new ReferenceRegistry();
  // ... register elements from known model ...

  const snapshot = {
    totalReferences: registry.getAllReferences().length,
    sampleReferences: registry.getAllReferences().slice(0, 10),
    referencesByType: {
      realizes: registry.getReferencesByType("realizes").length,
      accesses: registry.getReferencesByType("accesses").length,
      // ... etc
    },
  };

  expect(snapshot).toMatchSnapshot();
});
```

First run creates snapshot from current (Python) behavior, future runs verify TypeScript matches.

---

## Conclusion

**AST analysis:** ❌ Too complex, language differences
**Behavior testing:** ✅ Verifies what matters: does it work the same?

The key insight: We don't care if `Dict[str, List[str]]` becomes `Map<string, string[]>`. We care that calling `get_dependency_layers('X')` returns the same elements grouped the same way.

Would you like me to start implementing this verification strategy? I can begin with:

1. Documenting Python CLI behavior specs
2. Creating the first batch of unit tests
3. Testing against your actual model
