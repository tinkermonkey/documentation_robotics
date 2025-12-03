/**
 * Skills System - Type Definitions
 *
 * This module defines the core types for the auto-activating skills system.
 * Skills are background helpers that proactively activate based on conversation context.
 */

/**
 * Represents an activated skill ready to inject its prompt
 */
export interface SkillActivation {
    /** Unique identifier for the skill */
    skillId: string;

    /** Human-readable name */
    skillName: string;

    /** Confidence that this skill should be active (0.0 to 1.0) */
    confidence: number;

    /** Explanation of why the skill was activated */
    trigger: string;

    /** The prompt to inject into the system message */
    prompt: string;
}

/**
 * Contextual information extracted from the conversation history
 */
export interface ConversationContext {
    /** Recent user and assistant messages (last 5 turns) */
    recentMessages: string[];

    /** DR CLI commands executed recently */
    recentCommands: string[];

    /** High-level operations performed */
    recentOperations: OperationType[];

    /** Layers that have been modified */
    modifiedLayers: string[];

    /** Whether a changeset is currently active */
    activeChangeset: boolean;
}

/**
 * High-level operation types that can trigger skill activation
 */
export enum OperationType {
    /** Adding new elements to the model */
    ADD_ELEMENT = 'ADD_ELEMENT',

    /** Modifying existing elements */
    MODIFY_ELEMENT = 'MODIFY_ELEMENT',

    /** Deleting elements from the model */
    DELETE_ELEMENT = 'DELETE_ELEMENT',

    /** Running validation */
    VALIDATE = 'VALIDATE',

    /** Extracting model from code */
    EXTRACT_CODE = 'EXTRACT_CODE',

    /** Applying a changeset to the main model */
    APPLY_CHANGESET = 'APPLY_CHANGESET'
}

/**
 * Definition of a skill's behavior and activation patterns
 */
export interface SkillDefinition {
    /** Unique identifier */
    id: string;

    /** Human-readable name */
    name: string;

    /** Description of what the skill does */
    description: string;

    /** Patterns that trigger skill activation */
    activationPatterns: {
        /** Keywords in messages that trigger activation */
        keywords?: string[];

        /** Operation types that trigger activation */
        operations?: OperationType[];

        /** Custom function for complex activation logic */
        customDetector?: (context: ConversationContext) => boolean;
    };

    /** The prompt to inject when this skill is active */
    prompt: string;
}
