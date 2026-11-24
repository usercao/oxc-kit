import path from 'node:path'

import { findConfig, loadConfig } from './config.ts'
import type { OxcConfig } from './types.ts'

/** The `vite-plus` API that Oxfmt and Oxlint call to read the `fmt` and `lint` sections. */
export async function resolveConfigFromFile(configFile: string): Promise<OxcConfig> {
  const configPath = await findConfig(path.dirname(path.resolve(configFile)))
  return loadConfig(configPath)
}
