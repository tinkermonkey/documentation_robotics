import type { NodeAIEvaluation } from "../node-audit-types.js";
import { getErrorMessage } from "../../../utils/errors.js";

export class NodeResponseParser {
  /**
   * Parse NodeAIEvaluation[] from a Claude response string.
   * Tries code-fenced JSON first, falls back to raw array extraction.
   */
  parseLayerEvaluation(response: string): NodeAIEvaluation[] {
    // 1. Try code block: ```json\n...\n```
    const codeBlockMatch = response.match(/```json\n([\s\S]*?)\n```/);
    // 2. Fall back to raw array
    const rawArrayMatch = response.match(/\[[\s\S]*\]/);

    const jsonMatch = codeBlockMatch ?? rawArrayMatch;
    if (!jsonMatch) {
      const truncated = response.substring(0, 200);
      throw new Error(
        `Failed to extract JSON array from AI response. Expected JSON array in code block or raw JSON array.\nReceived: ${truncated}${response.length > 200 ? "..." : ""}`
      );
    }

    const jsonString = codeBlockMatch ? codeBlockMatch[1] : jsonMatch[0];
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch (error: unknown) {
      const truncated = jsonString.substring(0, 200);
      throw new Error(
        `Failed to parse JSON from AI response: ${getErrorMessage(error)}\nReceived: ${truncated}${jsonString.length > 200 ? "..." : ""}`
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error("Expected JSON array of node evaluations from AI response");
    }

    return parsed.map((item: unknown, index: number) => this.validateItem(item, index));
  }

  private validateItem(item: unknown, index: number): NodeAIEvaluation {
    if (typeof item !== "object" || item === null) {
      throw new Error(`Node evaluation at index ${index} is not a valid object`);
    }

    const obj = item as Record<string, unknown>;

    if (!obj.specNodeId || typeof obj.specNodeId !== "string") {
      throw new Error(
        `Node evaluation at index ${index} missing or invalid field: specNodeId (must be non-empty string)`
      );
    }

    if (typeof obj.alignmentScore !== "number") {
      throw new Error(
        `Node evaluation at index ${index} missing or invalid field: alignmentScore (must be number)`
      );
    }

    if (typeof obj.documentationScore !== "number") {
      throw new Error(
        `Node evaluation at index ${index} missing or invalid field: documentationScore (must be number)`
      );
    }

    if (!obj.alignmentReasoning || typeof obj.alignmentReasoning !== "string") {
      throw new Error(
        `Node evaluation at index ${index} missing or invalid field: alignmentReasoning (must be non-empty string)`
      );
    }

    if (!obj.documentationReasoning || typeof obj.documentationReasoning !== "string") {
      throw new Error(
        `Node evaluation at index ${index} missing or invalid field: documentationReasoning (must be non-empty string)`
      );
    }

    const suggestions = Array.isArray(obj.suggestions) &&
      obj.suggestions.every((s) => typeof s === "string")
      ? (obj.suggestions as string[])
      : [];

    return {
      specNodeId: obj.specNodeId,
      alignmentScore: Math.max(0, Math.min(100, Math.round(obj.alignmentScore))),
      alignmentReasoning: obj.alignmentReasoning,
      documentationScore: Math.max(0, Math.min(100, Math.round(obj.documentationScore))),
      documentationReasoning: obj.documentationReasoning,
      suggestions,
    };
  }
}
