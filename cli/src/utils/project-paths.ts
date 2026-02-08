/**
 * Project Path Utilities
 *
 * Handles finding project root and related paths in the DR project structure:
 *
 * my-project/
 * ├── .dr/                           # Reference spec (ephemeral, git-ignored)
 * │   ├── manifest.json              # Installed spec version
 * │   └── schemas/
 * └── documentation-robotics/        # Project model (permanent, git-committed)
 *     ├── model/
 *     │   ├── manifest.yaml       # Model spec version
 *     │   └── layers/
 *     ├── annotations/
 *     └── changesets/
 */

import { fileExists } from "./file-io.js";
import { join, dirname } from "path";

const MAX_SEARCH_DEPTH = 5;
const PROJECT_FOLDER_NAME = "documentation-robotics";
const SPEC_FOLDER_NAME = ".dr";

/**
 * Find the project root by searching for the documentation-robotics/ folder
 *
 * Searches upward from the current working directory up to MAX_SEARCH_DEPTH levels.
 * Returns the directory containing the documentation_robotics/ folder.
 *
 * @param startPath - Optional starting path (defaults to process.cwd())
 * @returns Path to project root, or null if not found
 *
 * @example
 * // From /home/user/my-project/documentation-robotics/model/01_motivation
 * // Returns: /home/user/my-project
 * const root = await findProjectRoot();
 */
export async function findProjectRoot(startPath?: string): Promise<string | null> {
  let currentPath = startPath || process.cwd();

  for (let depth = 0; depth < MAX_SEARCH_DEPTH; depth++) {
    const projectPath = join(currentPath, PROJECT_FOLDER_NAME);

    if (await fileExists(projectPath)) {
      return currentPath;
    }

    // Move up one directory
    const parentPath = dirname(currentPath);

    // Check if we've reached the root
    if (parentPath === currentPath) {
      break;
    }

    currentPath = parentPath;
  }

  return null;
}

/**
 * Get the path to the documentation-robotics/ folder
 *
 * @param startPath - Optional starting path (defaults to process.cwd())
 * @returns Path to documentation-robotics/ folder, or null if not found
 */
export async function getDocumentationRobotsPath(startPath?: string): Promise<string | null> {
  const root = await findProjectRoot(startPath);
  return root ? join(root, PROJECT_FOLDER_NAME) : null;
}

/**
 * Get the path to the model directory (documentation-robotics/model/)
 *
 * @param startPath - Optional starting path (defaults to process.cwd())
 * @returns Path to model directory, or null if not found
 */
export async function getModelPath(startPath?: string): Promise<string | null> {
  const drPath = await getDocumentationRobotsPath(startPath);
  if (!drPath) return null;

  const modelPath = join(drPath, "model");
  return (await fileExists(modelPath)) ? modelPath : null;
}

/**
 * Get the path to the .dr/ folder (spec reference directory)
 *
 * @param startPath - Optional starting path (defaults to process.cwd())
 * @returns Path to .dr/ folder, or null if not found
 */
export async function getSpecReferencePath(startPath?: string): Promise<string | null> {
  const root = await findProjectRoot(startPath);
  if (!root) return null;

  const specPath = join(root, SPEC_FOLDER_NAME);
  return (await fileExists(specPath)) ? specPath : null;
}

/**
 * Check if currently in a DR project
 *
 * @param startPath - Optional starting path (defaults to process.cwd())
 * @returns True if documentation-robotics/ folder exists in hierarchy
 */
export async function isInDRProject(startPath?: string): Promise<boolean> {
  return (await findProjectRoot(startPath)) !== null;
}
