/**
 * Layer-specific relationship templates for gap analysis and standard alignment
 */

export interface LayerTemplate {
  layer: string;
  standard: string;
  patterns: Array<{
    sourcePattern: string;
    destinationPattern: string;
    predicate: string;
    description: string;
  }>;
}

export const LAYER_TEMPLATES: LayerTemplate[] = [
  {
    layer: "motivation",
    standard: "ArchiMate 3.2",
    patterns: [
      {
        sourcePattern: "goal",
        destinationPattern: "principle",
        predicate: "supports",
        description: "Goals support principles",
      },
      {
        sourcePattern: "requirement",
        destinationPattern: "goal",
        predicate: "realizes",
        description: "Requirements realize goals",
      },
      {
        sourcePattern: "constraint",
        destinationPattern: "requirement",
        predicate: "restricts",
        description: "Constraints restrict requirements",
      },
    ],
  },
  {
    layer: "business",
    standard: "ArchiMate 3.2",
    patterns: [
      {
        sourcePattern: "process",
        destinationPattern: "process",
        predicate: "triggers",
        description: "Processes trigger other processes",
      },
      {
        sourcePattern: "role",
        destinationPattern: "process",
        predicate: "assigned-to",
        description: "Roles are assigned to the processes they perform",
      },
      {
        sourcePattern: "process",
        destinationPattern: "service",
        predicate: "realizes",
        description: "Processes realize services",
      },
    ],
  },
  {
    layer: "product",
    standard: "Product Management Practice",
    patterns: [
      {
        sourcePattern: "feature",
        destinationPattern: "softwarecapability",
        predicate: "realizes",
        description: "Features realize software capabilities",
      },
      {
        sourcePattern: "softwarecapability",
        destinationPattern: "milestone",
        predicate: "scheduled-for",
        description: "Software capabilities are scheduled for milestones",
      },
      {
        sourcePattern: "feature",
        destinationPattern: "milestone",
        predicate: "scheduled-for",
        description: "Features are scheduled for milestones",
      },
      {
        sourcePattern: "feature",
        destinationPattern: "feature",
        predicate: "depends-on",
        description: "Features depend on other features",
      },
      {
        sourcePattern: "userworkflow",
        destinationPattern: "feature",
        predicate: "composes",
        description: "User workflows compose features",
      },
    ],
  },
  {
    layer: "security",
    standard: "NIST SP 800-53",
    patterns: [
      {
        sourcePattern: "countermeasure",
        destinationPattern: "threat",
        predicate: "mitigates",
        description: "Countermeasures mitigate threats",
      },
      {
        sourcePattern: "role",
        destinationPattern: "permission",
        predicate: "aggregates",
        description: "Roles aggregate the permissions they grant",
      },
      {
        sourcePattern: "policy",
        destinationPattern: "countermeasure",
        predicate: "mandates",
        description: "Policies mandate countermeasures",
      },
    ],
  },
  {
    layer: "application",
    standard: "ArchiMate 3.2",
    patterns: [
      {
        sourcePattern: "component",
        destinationPattern: "service",
        predicate: "realizes",
        description: "Components realize services",
      },
      {
        sourcePattern: "component",
        destinationPattern: "component",
        predicate: "uses",
        description: "Components use other components",
      },
      {
        sourcePattern: "interface",
        destinationPattern: "service",
        predicate: "serves",
        description: "Interfaces serve services",
      },
    ],
  },
  {
    layer: "technology",
    standard: "ArchiMate 3.2",
    patterns: [
      {
        sourcePattern: "node",
        destinationPattern: "device",
        predicate: "composes",
        description: "Nodes compose devices",
      },
      {
        sourcePattern: "artifact",
        destinationPattern: "component",
        predicate: "realizes",
        description: "Artifacts realize components",
      },
      {
        sourcePattern: "node",
        destinationPattern: "systemsoftware",
        predicate: "composes",
        description: "Nodes compose the system software they run",
      },
    ],
  },
  {
    layer: "api",
    standard: "OpenAPI 3.0",
    patterns: [
      {
        sourcePattern: "operation",
        destinationPattern: "schema",
        predicate: "references",
        description: "Operations reference schemas",
      },
      {
        sourcePattern: "securityscheme",
        destinationPattern: "operation",
        predicate: "serves",
        description: "Security schemes serve operations",
      },
      {
        sourcePattern: "response",
        destinationPattern: "schema",
        predicate: "returns",
        description: "Responses return schemas",
      },
    ],
  },
  {
    layer: "ux",
    standard: "HTML 5.3 / component libraries",
    patterns: [
      {
        sourcePattern: "view",
        destinationPattern: "componentinstance",
        predicate: "composes",
        description: "Views compose the component instances placed in them",
      },
      {
        sourcePattern: "componentinstance",
        destinationPattern: "librarycomponent",
        predicate: "realizes",
        description: "Instances realize the library component they place",
      },
      {
        sourcePattern: "view",
        destinationPattern: "dataconfig",
        predicate: "binds-to",
        description: "Views bind to their data configuration",
      },
    ],
  },
  {
    layer: "navigation",
    standard: "Router patterns",
    patterns: [
      {
        sourcePattern: "route",
        destinationPattern: "screen",
        predicate: "navigates-to",
        description: "Routes navigate to screens",
      },
      {
        sourcePattern: "menuitem",
        destinationPattern: "route",
        predicate: "references",
        description: "Menu items reference routes",
      },
      {
        sourcePattern: "link",
        destinationPattern: "route",
        predicate: "targets",
        description: "Links target routes",
      },
    ],
  },
  {
    layer: "data-model",
    standard: "JSON Schema Draft 7",
    patterns: [
      {
        sourcePattern: "entity",
        destinationPattern: "entity",
        predicate: "references",
        description: "Entities reference other entities",
      },
      {
        sourcePattern: "entity",
        destinationPattern: "property",
        predicate: "has",
        description: "Entities have properties",
      },
      {
        sourcePattern: "property",
        destinationPattern: "entity",
        predicate: "references",
        description: "Properties reference entities",
      },
    ],
  },
  {
    layer: "data-store",
    standard: "Database schema patterns",
    patterns: [
      {
        sourcePattern: "table",
        destinationPattern: "table",
        predicate: "references",
        description: "Tables reference other tables via foreign keys",
      },
      {
        sourcePattern: "index",
        destinationPattern: "table",
        predicate: "indexes",
        description: "Indexes apply to tables",
      },
      {
        sourcePattern: "view",
        destinationPattern: "table",
        predicate: "derives-from",
        description: "Views derive from tables",
      },
    ],
  },
  {
    layer: "apm",
    standard: "OpenTelemetry",
    patterns: [
      {
        sourcePattern: "trace",
        destinationPattern: "service",
        predicate: "monitors",
        description: "Traces monitor services",
      },
      {
        sourcePattern: "metric",
        destinationPattern: "component",
        predicate: "measures",
        description: "Metrics measure components",
      },
      {
        sourcePattern: "alert",
        destinationPattern: "metric",
        predicate: "triggers-on",
        description: "Alerts trigger on metrics",
      },
    ],
  },
  {
    layer: "testing",
    standard: "IEEE 829-2008 test documentation",
    patterns: [
      {
        sourcePattern: "testcasesketch",
        destinationPattern: "coveragerequirement",
        predicate: "validates",
        description: "Test case sketches validate the coverage requirement they exercise",
      },
      {
        sourcePattern: "testcoveragetarget",
        destinationPattern: "coveragerequirement",
        predicate: "composes",
        description: "Coverage targets compose their coverage requirements",
      },
      {
        sourcePattern: "testcoveragemodel",
        destinationPattern: "testcoveragetarget",
        predicate: "composes",
        description: "Coverage models compose their coverage targets",
      },
    ],
  },
];
