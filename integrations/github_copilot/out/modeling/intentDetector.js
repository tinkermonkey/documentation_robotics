"use strict";
/**
 * Intent Detector
 *
 * Detects user intent from natural language messages to route to appropriate workflows.
 * Supports 10 intent types and extracts relevant entities (layer, type, name).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.IntentDetector = exports.IntentType = void 0;
/**
 * Intent types that can be detected
 */
var IntentType;
(function (IntentType) {
    IntentType["VALIDATE"] = "validate";
    IntentType["FIX_ERRORS"] = "fix_errors";
    IntentType["EXTRACT_CODE"] = "extract_code";
    IntentType["GENERATE_DOCS"] = "generate_docs";
    IntentType["SECURITY_REVIEW"] = "security_review";
    IntentType["MIGRATE_VERSION"] = "migrate_version";
    IntentType["EXPLORE_IDEA"] = "explore_idea";
    IntentType["LEARN"] = "learn";
    IntentType["ADD_ELEMENT"] = "add_element";
    IntentType["MODEL_FEATURE"] = "model_feature";
    IntentType["UNKNOWN"] = "unknown";
})(IntentType || (exports.IntentType = IntentType = {}));
/**
 * Intent Detector Class
 */
class IntentDetector {
    constructor() {
        // 11 layers in DR
        this.layers = [
            'motivation', 'business', 'security', 'application', 'technology',
            'api', 'data_model', 'datastore', 'ux', 'navigation', 'apm', 'testing'
        ];
        // Common element types
        this.elementTypes = [
            'goal', 'requirement', 'service', 'process', 'actor', 'component',
            'interface', 'operation', 'entity', 'view', 'route', 'metric'
        ];
    }
    /**
     * Detect intent from user message
     *
     * @param message - User's natural language message
     * @param context - Conversation context for additional signals
     * @returns Intent result with confidence and entities
     */
    detect(message, context) {
        const lowercaseMsg = message.toLowerCase();
        // Try each intent pattern in priority order
        let result = this.detectValidate(lowercaseMsg);
        if (result.confidence >= 0.7)
            return result;
        result = this.detectFixErrors(lowercaseMsg);
        if (result.confidence >= 0.7)
            return result;
        result = this.detectExtractCode(lowercaseMsg);
        if (result.confidence >= 0.7)
            return result;
        result = this.detectSecurityReview(lowercaseMsg);
        if (result.confidence >= 0.7)
            return result;
        result = this.detectMigrateVersion(lowercaseMsg);
        if (result.confidence >= 0.7)
            return result;
        result = this.detectExploreIdea(lowercaseMsg);
        if (result.confidence >= 0.7)
            return result;
        result = this.detectGenerateDocs(lowercaseMsg);
        if (result.confidence >= 0.7)
            return result;
        result = this.detectLearn(lowercaseMsg);
        if (result.confidence >= 0.7)
            return result;
        result = this.detectAddElement(lowercaseMsg);
        if (result.confidence >= 0.6)
            return result;
        result = this.detectModelFeature(lowercaseMsg);
        if (result.confidence >= 0.6)
            return result;
        // Default to unknown
        return {
            intent: IntentType.UNKNOWN,
            confidence: 0.0,
            entities: {},
            suggestedWorkflow: 'modeling'
        };
    }
    detectValidate(message) {
        const patterns = [
            /\b(validate|check|verify|test|lint|ensure correct)\b/,
            /\b(is.*(correct|valid|right|good))\b/,
            /\b(any (errors|issues|problems|warnings))\b/
        ];
        const confidence = this.matchPatterns(message, patterns);
        return {
            intent: IntentType.VALIDATE,
            confidence,
            entities: {},
            suggestedWorkflow: confidence > 0 ? 'validation' : undefined
        };
    }
    detectFixErrors(message) {
        const patterns = [
            /\b(fix|repair|resolve|correct|address)\s+(errors|issues|problems|warnings)\b/,
            /\b(auto.?fix|auto.?correct)\b/
        ];
        const confidence = this.matchPatterns(message, patterns);
        return {
            intent: IntentType.FIX_ERRORS,
            confidence,
            entities: {},
            suggestedWorkflow: confidence > 0 ? 'validation' : undefined
        };
    }
    detectExtractCode(message) {
        const patterns = [
            /\b(extract|ingest|analyze|scan|parse|import)\s+(code|codebase|source|project)\b/,
            /\b(from\s+(my|the)?\s*(code|codebase|source))\b/,
            /\b(reverse.?engineer)\b/
        ];
        const confidence = this.matchPatterns(message, patterns);
        return {
            intent: IntentType.EXTRACT_CODE,
            confidence,
            entities: {},
            suggestedWorkflow: confidence > 0 ? 'extraction' : undefined
        };
    }
    detectGenerateDocs(message) {
        const patterns = [
            /\b(generate|create|produce|export|make)\s+(docs|documentation|diagrams|reports)\b/,
            /\b(document|documentation for)\b/
        ];
        const confidence = this.matchPatterns(message, patterns);
        return {
            intent: IntentType.GENERATE_DOCS,
            confidence,
            entities: {},
            suggestedWorkflow: undefined // No specific workflow for docs generation
        };
    }
    detectSecurityReview(message) {
        const patterns = [
            /\b(security|secure|safety|compliance|audit)\b/,
            /\b(gdpr|hipaa|soc2|pci.?dss)\b/,
            /\b(vulnerabilit|threat|attack|breach)\b/,
            /\b(authentication|authorization|encryption)\b/
        ];
        const confidence = this.matchPatterns(message, patterns);
        return {
            intent: IntentType.SECURITY_REVIEW,
            confidence,
            entities: {},
            suggestedWorkflow: confidence > 0 ? 'security_review' : undefined
        };
    }
    detectMigrateVersion(message) {
        const patterns = [
            /\b(migrate|upgrade|update)\s+(to|version|spec)\b/,
            /\b(migration)\b/
        ];
        const confidence = this.matchPatterns(message, patterns);
        return {
            intent: IntentType.MIGRATE_VERSION,
            confidence,
            entities: {},
            suggestedWorkflow: confidence > 0 ? 'migration' : undefined
        };
    }
    detectExploreIdea(message) {
        const patterns = [
            /\b(what if|suppose|consider|explore)\b/,
            /\b(should (we|i)|could (we|i))\s+(add|use|switch|change)\b/,
            /\b(alternative|option|approach)\b/,
            /\b(vs|versus|or|compare)\b/
        ];
        const confidence = this.matchPatterns(message, patterns);
        return {
            intent: IntentType.EXPLORE_IDEA,
            confidence,
            entities: {},
            suggestedWorkflow: confidence > 0 ? 'ideation' : undefined
        };
    }
    detectLearn(message) {
        const patterns = [
            /\b(how (do|can) i|how to|help me)\b/,
            /\b(what is|explain|teach|learn|understand)\b/,
            /\b(which (layer|type)|where (should|do))\b/
        ];
        const confidence = this.matchPatterns(message, patterns);
        return {
            intent: IntentType.LEARN,
            confidence,
            entities: {},
            suggestedWorkflow: confidence > 0 ? 'education' : undefined
        };
    }
    detectAddElement(message) {
        const patterns = [
            /\b(add|create|make|new)\s+\w+\s+(for|to|that|which)\b/,
            /\b(add|create)\s+a\b/
        ];
        const confidence = this.matchPatterns(message, patterns);
        // Extract entities
        const entities = this.extractEntities(message);
        return {
            intent: IntentType.ADD_ELEMENT,
            confidence,
            entities,
            suggestedWorkflow: confidence > 0 ? 'modeling' : undefined
        };
    }
    detectModelFeature(message) {
        const patterns = [
            /\b(model|design|architect|build)\s+\w+/,
            /\b(system|feature|capability|module)\b/
        ];
        const confidence = this.matchPatterns(message, patterns);
        // Extract entities
        const entities = this.extractEntities(message);
        return {
            intent: IntentType.MODEL_FEATURE,
            confidence,
            entities,
            suggestedWorkflow: confidence > 0 ? 'modeling' : undefined
        };
    }
    /**
     * Match message against regex patterns and calculate confidence
     */
    matchPatterns(message, patterns) {
        let matches = 0;
        for (const pattern of patterns) {
            if (pattern.test(message)) {
                matches++;
            }
        }
        // Confidence based on match count
        if (matches === 0)
            return 0.0;
        if (matches === 1)
            return 0.7;
        if (matches === 2)
            return 0.85;
        return 0.95;
    }
    /**
     * Extract entities (layer, type, name) from message
     */
    extractEntities(message) {
        const entities = {};
        // Extract layer
        for (const layer of this.layers) {
            if (message.toLowerCase().includes(layer)) {
                entities.layer = layer;
                break;
            }
        }
        // Extract element type
        for (const type of this.elementTypes) {
            if (message.toLowerCase().includes(type)) {
                entities.elementType = type;
                break;
            }
        }
        // Extract name (basic heuristic - look for quoted text or capitalized words)
        const quotedMatch = message.match(/["']([^"']+)["']/);
        if (quotedMatch) {
            entities.elementName = quotedMatch[1];
        }
        return entities;
    }
}
exports.IntentDetector = IntentDetector;
//# sourceMappingURL=intentDetector.js.map
