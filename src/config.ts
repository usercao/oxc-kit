import { readdir, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { OxcConfig } from './types.ts'
import { hasErrorCode, isObject } from './utils.ts'

export const CONFIG_FILENAMES = [
  'oxc.config.ts',
  'oxc.config.mts',
  'oxc.config.cts',
  'oxc.config.js',
  'oxc.config.mjs',
  'oxc.config.cjs',
] as const

const require = createRequire(import.meta.url)

async function readDirectoryEntries(directory: string): Promise<Set<string>> {
  try {
    return new Set(await readdir(directory))
  } catch (error) {
    if (hasErrorCode(error, 'ENOENT', 'ENOTDIR')) {
      return new Set()
    }
    throw error
  }
}

/** Finds the nearest `oxc.config.*` from `startDirectory` upwards. */
export async function findConfig(startDirectory = process.cwd()): Promise<string | undefined> {
  let directory = path.resolve(startDirectory)

  while (true) {
    const entries = await readDirectoryEntries(directory)
    const matches = CONFIG_FILENAMES.filter((filename) => entries.has(filename)).map((filename) =>
      path.join(directory, filename),
    )

    if (matches.length > 1) {
      throw new Error(`Multiple unified Oxc configs found in ${directory}: ${matches.join(', ')}`)
    }
    if (matches[0]) {
      return matches[0]
    }

    const parent = path.dirname(directory)
    if (parent === directory) {
      return undefined
    }
    directory = parent
  }
}

export async function loadConfig(configPath: string): Promise<OxcConfig> {
  const absolutePath = path.resolve(configPath)
  if (absolutePath.endsWith('.cjs') || absolutePath.endsWith('.cts')) {
    delete require.cache[absolutePath]
  }
  const moduleUrl = pathToFileURL(absolutePath)
  // Only re-import when the file changes; every distinct URL stays in the ESM cache forever.
  const { mtimeMs, size } = await stat(absolutePath)
  moduleUrl.searchParams.set('oxc-kit-cache', `${mtimeMs}-${size}`)

  const configModule = (await import(moduleUrl.href)) as { default?: unknown }
  if (!isObject(configModule.default)) {
    throw new TypeError(`${absolutePath} must default-export a configuration object`)
  }

  return configModule.default as OxcConfig
}
