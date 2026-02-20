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
        predicate: "performs",
        description: "Roles perform processes",
      },
      {
        sourcePattern: "service",
        destinationPattern: "process",
        predicate: "realizes",
        description: "Services realize processes",
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
        predicate: "authorizes",
        description: "Roles authorize permissions",
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
        sourcePattern: "infrastructure",
        destinationPattern: "node",
        predicate: "hosts",
        description: "Infrastructure hosts nodes",
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
    standard: "React/Component",
    patterns: [
      {
        sourcePattern: "component",
        destinationPattern: "component",
        predicate: "renders",
        description: "Components render other components",
      },
      {
        sourcePattern: "component",
        destinationPattern: "entity",
        predicate: "binds-to",
        description: "Components bind to entities",
      },
      {
        sourcePattern: "form",
        destinationPattern: "schema",
        predicate: "validates",
        description: "Forms validate against schemas",
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
];
