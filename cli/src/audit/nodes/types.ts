/**
 * Type definitions for node audit system
 */

/**
 * Parsed representation of a node schema file
 */
export interface ParsedNodeSchema {
  specNodeId: string;        // "motivation.goal"
  layerId: string;           // "motivation"
  typeName: string;          // "goal"
  title: string;             // "Goal"
  description: string;       // top-level schema description (empty string if absent)
  filePath: string;
  attributes: {
    properties: Record<string, { type?: string; description?: string; format?: string; enum?: string[] }>;
    required: string[];
    additionalProperties: boolean;
  };
}

/**
 * Layer definition loaded from a layer.json file
 */
export interface LayerDefinition {
  id: string;
  number: number;
  name: string;
  nodeTypes: string[];        // from layer.json node_types array
  inspiredBy?: { standard: string; version: string; url?: string };
}

/**
 * Quality assessment for a single node type definition
 */
export interface NodeDefinitionQuality {
  specNodeId: string;
  layerId: string;
  hasDescription: boolean;
  descriptionQuality: "good" | "generic" | "empty";
  attributeCount: number;
  documentedAttributeCount: number;
  attributeDocumentationRatio: number;     // 0.0–1.0
  issues: DefinitionIssue[];
  score: number;                           // 0–100
}

/**
 * A specific issue found in a node definition
 */
export interface DefinitionIssue {
  severity: "error" | "warning" | "info";
  code: "EMPTY_DESCRIPTION" | "GENERIC_DESCRIPTION" | "LOW_ATTRIBUTE_DOCUMENTATION" | "SHORT_DESCRIPTION";
  message: string;
}

/**
 * Candidate semantic overlap between two node types in the same layer
 */
export interface SemanticOverlapCandidate {
  nodeTypeA: string;
  nodeTypeB: string;
  layerId: string;
  reason: string;
  confidence: "high" | "medium" | "low";
  overlapType: "name_similarity" | "attribute_similarity" | "description_similarity";
}

/**
 * Issue with schema completeness — missing or orphaned schema files
 */
export interface SchemaCompletenessIssue {
  layerId: string;
  specNodeId: string;
  issueType: "missing_schema" | "orphaned_schema" | "malformed_element";
  detail: string;
}

/**
 * Per-layer summary of node definition quality
 */
export interface NodeLayerSummary {
  layerId: string;
  totalNodeTypes: number;
  avgQualityScore: number;
  emptyDescriptionCount: number;
  genericDescriptionCount: number;
  goodDescriptionCount: number;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
}

/**
 * AI evaluation result for a single node type
 */
export interface NodeAIEvaluation {
  specNodeId: string;
  alignmentScore: number;           // 0-100: how well node type fits the layer's standard
  alignmentReasoning: string;       // brief explanation
  documentationScore: number;       // 0-100: description accuracy and usefulness
  documentationReasoning: string;   // brief explanation
  suggestions: string[];            // actionable improvement suggestions
}

/**
 * AI review for an entire layer
 */
export interface LayerAIReview {
  layerId: string;
  standard: string;                 // e.g. "ArchiMate 3.2"
  nodeEvaluations: NodeAIEvaluation[];
  avgAlignmentScore: number;        // computed from nodeEvaluations
  avgDocumentationScore: number;    // computed from nodeEvaluations
}

/**
 * Complete node audit report
 */
export interface NodeAuditReport {
  timestamp: string;
  spec: { version: string; totalNodeTypes: number; totalLayers: number };
  layerSummaries: NodeLayerSummary[];
  definitionQuality: NodeDefinitionQuality[];
  overlaps: SemanticOverlapCandidate[];
  completenessIssues: SchemaCompletenessIssue[];
  aiReviews?: LayerAIReview[];      // absent when --enable-ai not used
}
