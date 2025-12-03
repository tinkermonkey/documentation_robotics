"use strict";
/**
 * Skills Manager
 *
 * Orchestrates skill activation based on conversation context.
 * Manages registration and activation of all available skills.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillsManager = void 0;
const linkValidationSkill_1 = require("./linkValidationSkill");
const changesetReviewerSkill_1 = require("./changesetReviewerSkill");
class SkillsManager {
    constructor() {
        this.skills = [
            linkValidationSkill_1.LINK_VALIDATION_SKILL,
            changesetReviewerSkill_1.CHANGESET_REVIEWER_SKILL
        ];
    }
    /**
     * Analyze conversation context and activate matching skills
     *
     * @param context - Conversation context extracted from history
     * @returns Array of skill activations with prompts to inject
     */
    async analyzeAndActivate(context) {
        const activations = [];
        for (const skill of this.skills) {
            const activation = this.checkActivation(skill, context);
            if (activation) {
                activations.push(activation);
            }
        }
        return activations;
    }
    /**
     * Check if a skill should be activated based on its patterns
     *
     * @param skill - Skill definition to check
     * @param context - Conversation context
     * @returns SkillActivation if skill should be active, null otherwise
     */
    checkActivation(skill, context) {
        let confidence = 0.0;
        const triggers = [];
        // Check keyword matches in recent messages
        if (skill.activationPatterns.keywords) {
            const keywordMatches = this.checkKeywords(skill.activationPatterns.keywords, context.recentMessages);
            if (keywordMatches.count > 0) {
                // Higher confidence with more matches
                confidence = Math.min(0.5 + (keywordMatches.count * 0.1), 0.9);
                triggers.push(`Keywords: ${keywordMatches.matched.join(', ')}`);
            }
        }
        // Check operation type matches
        if (skill.activationPatterns.operations) {
            const operationMatch = skill.activationPatterns.operations.some(op => context.recentOperations.includes(op));
            if (operationMatch) {
                confidence = Math.max(confidence, 0.7);
                triggers.push('Operation type match');
            }
        }
        // Run custom detector if provided
        if (skill.activationPatterns.customDetector) {
            try {
                const customMatch = skill.activationPatterns.customDetector(context);
                if (customMatch) {
                    confidence = Math.max(confidence, 0.8);
                    triggers.push('Custom detector');
                }
            }
            catch (error) {
                console.error(`Error in custom detector for skill ${skill.id}:`, error);
            }
        }
        // Activate if confidence threshold met
        if (confidence >= 0.5) {
            return {
                skillId: skill.id,
                skillName: skill.name,
                confidence,
                trigger: triggers.join('; '),
                prompt: skill.prompt
            };
        }
        return null;
    }
    /**
     * Check for keyword matches in messages
     *
     * @param keywords - Keywords to search for
     * @param messages - Recent messages to search in
     * @returns Count and list of matched keywords
     */
    checkKeywords(keywords, messages) {
        const matched = new Set();
        // Combine all recent messages
        const combinedText = messages.join(' ').toLowerCase();
        for (const keyword of keywords) {
            if (combinedText.includes(keyword.toLowerCase())) {
                matched.add(keyword);
            }
        }
        return {
            count: matched.size,
            matched: Array.from(matched)
        };
    }
    /**
     * Register a new skill (for extensibility)
     *
     * @param skill - Skill definition to register
     */
    registerSkill(skill) {
        this.skills.push(skill);
    }
    /**
     * Get all registered skills
     *
     * @returns Array of all skill definitions
     */
    getSkills() {
        return [...this.skills];
    }
}
exports.SkillsManager = SkillsManager;
//# sourceMappingURL=skillsManager.js.map
