import path from 'node:path'

import { findConfig, loadConfig } from './config.ts'

interface ResolveConfigOptions {
  configFile?: string
}

export async function resolveConfig(
  options: ResolveConfigOptions,
  _command: 'build' | 'serve',
): Promise<Awaited<ReturnType<typeof loadConfig>>> {
  if (!options.configFile) {
    throw new TypeError('vite-plus resolveConfig requires a configFile path')
  }

  return resolveConfigFromFile(options.configFile)
}

export async function resolveConfigFromFile(
  configFile: string,
): Promise<Awaited<ReturnType<typeof loadConfig>>> {
  const configPath = await findConfig(path.dirname(path.resolve(configFile)))
  return loadConfig(configPath)
}
