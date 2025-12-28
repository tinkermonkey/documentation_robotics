import path from 'node:path'
import fs from 'node:fs/promises'

/**
 * Resolve the model root directory and manifest path.
 * Supports both TS layout (root/model/manifest.yaml) and Python layout
 * (root/documentation-robotics/model/manifest.yaml).
 */
export async function resolveModelRoot(opts?: {
  modelPath?: string
  cwd?: string
}): Promise<{ rootPath: string; manifestPath: string }> {
  const cwd = opts?.cwd ? path.resolve(opts.cwd) : process.cwd()
  const input = opts?.modelPath ? path.resolve(cwd, opts.modelPath) : cwd

  const candidates: string[] = []

  // If a manifest file is directly provided
  if (input.endsWith('manifest.yaml')) {
    candidates.push(input)
  }

  // If a model directory is provided
  candidates.push(path.join(input, 'manifest.yaml'))

  // TypeScript layout: <root>/model/manifest.yaml
  candidates.push(path.join(input, 'model', 'manifest.yaml'))

  // Python/TypeScript unified layout: <root>/documentation-robotics/model/manifest.yaml
  candidates.push(path.join(input, 'documentation-robotics', 'model', 'manifest.yaml'))

  // Optional override via env var (highest priority)
  if (process.env.DR_MODEL_PATH) {
    const envPath = path.resolve(process.env.DR_MODEL_PATH)
    if (envPath.endsWith('manifest.yaml')) {
      candidates.unshift(envPath)
    } else {
      candidates.unshift(path.join(envPath, 'manifest.yaml'))
      candidates.unshift(path.join(envPath, 'model', 'manifest.yaml'))
    }
  }

  for (const manifestPath of candidates) {
    try {
      await fs.access(manifestPath)
      const normalized = path.normalize(manifestPath)
      // rootPath is the parent of the model directory
      let rootPath: string
      if (normalized.endsWith(path.join('documentation-robotics', 'model', 'manifest.yaml'))) {
        // <root>/documentation-robotics/model/manifest.yaml -> <root>
        rootPath = path.dirname(path.dirname(path.dirname(normalized)))
      } else if (normalized.endsWith(path.join('model', 'manifest.yaml'))) {
        // <root>/model/manifest.yaml -> <root>
        rootPath = path.dirname(path.dirname(normalized))
      } else {
        // <root>/manifest.yaml -> <root>
        rootPath = path.dirname(normalized)
      }
      return { rootPath, manifestPath: normalized }
    } catch {
      // continue searching
    }
  }

  throw new Error(
    'Model not found. Provide --model <path> (directory containing documentation-robotics/model/manifest.yaml) or set DR_MODEL_PATH.'
  )
}
