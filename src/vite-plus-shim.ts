import path from 'node:path'

import { CONFIG_FILENAMES, findConfig, loadConfig } from './config.ts'
import type { OxcConfig } from './types.ts'

/** The `vite-plus` API that Oxfmt and Oxlint call to read the `fmt` and `lint` sections. */
export async function resolveConfigFromFile(configFile: string): Promise<OxcConfig> {
  const configPath = path.resolve(configFile)
  if (!/^vite\.config\.[cm]?[jt]s$/.test(path.basename(configPath))) {
    return loadConfig(configPath)
  }

  // Oxc found a `vite.config.*` on its own; use the nearest unified config instead.
  const unifiedConfigPath = await findConfig(path.dirname(configPath))
  if (!unifiedConfigPath) {
    throw new Error(`No ${CONFIG_FILENAMES.join(', ')} found from ${path.dirname(configPath)}`)
  }
  return loadConfig(unifiedConfigPath)
}
