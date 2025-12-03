"use strict";
/**
 * Skills System - Type Definitions
 *
 * This module defines the core types for the auto-activating skills system.
 * Skills are background helpers that proactively activate based on conversation context.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationType = void 0;
/**
 * High-level operation types that can trigger skill activation
 */
var OperationType;
(function (OperationType) {
    /** Adding new elements to the model */
    OperationType["ADD_ELEMENT"] = "ADD_ELEMENT";
    /** Modifying existing elements */
    OperationType["MODIFY_ELEMENT"] = "MODIFY_ELEMENT";
    /** Deleting elements from the model */
    OperationType["DELETE_ELEMENT"] = "DELETE_ELEMENT";
    /** Running validation */
    OperationType["VALIDATE"] = "VALIDATE";
    /** Extracting model from code */
    OperationType["EXTRACT_CODE"] = "EXTRACT_CODE";
    /** Applying a changeset to the main model */
    OperationType["APPLY_CHANGESET"] = "APPLY_CHANGESET";
})(OperationType || (exports.OperationType = OperationType = {}));
//# sourceMappingURL=types.js.map
