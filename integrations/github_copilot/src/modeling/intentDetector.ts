/**
 * Intent Detector
 *
 * Detects user intent from natural language messages to route to appropriate workflows.
 * Supports 10 intent types and extracts relevant entities (layer, type, name).
 */

import { ConversationContext } from '../skills/types';

/**
 * Intent types that can be detected
 */
export enum IntentType {
    VALIDATE = 'validate',
    FIX_ERRORS = 'fix_errors',
    EXTRACT_CODE = 'extract_code',
    GENERATE_DOCS = 'generate_docs',
    SECURITY_REVIEW = 'security_review',
    MIGRATE_VERSION = 'migrate_version',
    EXPLORE_IDEA = 'explore_idea',
    LEARN = 'learn',
    ADD_ELEMENT = 'add_element',
    MODEL_FEATURE = 'model_feature',
    UNKNOWN = 'unknown'
}

/**
 * Result of intent detection
 */
export interface IntentResult {
    /** Detected intent type */
    intent: IntentType;

    /** Confidence in the detection (0.0 to 1.0) */
    confidence: number;

    /** Extracted entities from the message */
    entities: {
        layer?: string;
        elementType?: string;
        elementName?: string;
    };

    /** Suggested workflow to activate */
    suggestedWorkflow?: string;
}

/**
 * Intent Detector Class
 */
export class IntentDetector {
    // 11 layers in DR
    private layers = [
        'motivation', 'business', 'security', 'application', 'technology',
        'api', 'data_model', 'datastore', 'ux', 'navigation', 'apm', 'testing'
    ];

    // Common element types
    private elementTypes = [
        'goal', 'requirement', 'service', 'process', 'actor', 'component',
        'interface', 'operation', 'entity', 'view', 'route', 'metric'
    ];

    /**
     * Detect intent from user message
     *
     * @param message - User's natural language message
     * @param context - Conversation context for additional signals
     * @returns Intent result with confidence and entities
     */
    detect(message: string, context: ConversationContext): IntentResult {
        const lowercaseMsg = message.toLowerCase();

        // Try each intent pattern in priority order
        let result = this.detectValidate(lowercaseMsg);
        if (result.confidence >= 0.7) return result;

        result = this.detectFixErrors(lowercaseMsg);
        if (result.confidence >= 0.7) return result;

        result = this.detectExtractCode(lowercaseMsg);
        if (result.confidence >= 0.7) return result;

        result = this.detectSecurityReview(lowercaseMsg);
        if (result.confidence >= 0.7) return result;

        result = this.detectMigrateVersion(lowercaseMsg);
        if (result.confidence >= 0.7) return result;

        result = this.detectExploreIdea(lowercaseMsg);
        if (result.confidence >= 0.7) return result;

        result = this.detectGenerateDocs(lowercaseMsg);
        if (result.confidence >= 0.7) return result;

        result = this.detectLearn(lowercaseMsg);
        if (result.confidence >= 0.7) return result;

        result = this.detectAddElement(lowercaseMsg);
        if (result.confidence >= 0.6) return result;

        result = this.detectModelFeature(lowercaseMsg);
        if (result.confidence >= 0.6) return result;

        // Default to unknown
        return {
            intent: IntentType.UNKNOWN,
            confidence: 0.0,
            entities: {},
            suggestedWorkflow: 'modeling'
        };
    }

    private detectValidate(message: string): IntentResult {
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

    private detectFixErrors(message: string): IntentResult {
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

    private detectExtractCode(message: string): IntentResult {
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

    private detectGenerateDocs(message: string): IntentResult {
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

    private detectSecurityReview(message: string): IntentResult {
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

    private detectMigrateVersion(message: string): IntentResult {
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

    private detectExploreIdea(message: string): IntentResult {
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

    private detectLearn(message: string): IntentResult {
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

    private detectAddElement(message: string): IntentResult {
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

    private detectModelFeature(message: string): IntentResult {
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
    private matchPatterns(message: string, patterns: RegExp[]): number {
        let matches = 0;

        for (const pattern of patterns) {
            if (pattern.test(message)) {
                matches++;
            }
        }

        // Confidence based on match count
        if (matches === 0) return 0.0;
        if (matches === 1) return 0.7;
        if (matches === 2) return 0.85;
        return 0.95;
    }

    /**
     * Extract entities (layer, type, name) from message
     */
    private extractEntities(message: string): { layer?: string; elementType?: string; elementName?: string } {
        const entities: { layer?: string; elementType?: string; elementName?: string } = {};

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
