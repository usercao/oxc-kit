import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { findConfig } from './config.ts'
import type { OxcTool } from './types.ts'
import './vite-plus-hooks.ts'

const require = createRequire(import.meta.url)
const packageManifest = require('../package.json') as { version: string }

export const TOOL_USAGE = {
  oxfmt: { action: 'format', command: 'fmt' },
  oxlint: { action: 'lint', command: 'lint' },
} as const satisfies Record<OxcTool, { action: string; command: string }>

export function resolveToolBin(tool: OxcTool): string {
  const manifestPath = require.resolve(`${tool}/package.json`)
  const manifest = require(manifestPath) as { bin?: string | Record<string, string> }
  const binPath = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[tool]
  if (!binPath) {
    throw new Error(`${tool} does not expose a ${tool} CLI in its package manifest`)
  }
  return path.resolve(path.dirname(manifestPath), binPath)
}

export function resolveTsgolintBin(): string {
  // Resolve the native binary from oxlint-tsgolint's own context so strict layouts (pnpm, PnP) work.
  const tsgolintRequire = createRequire(require.resolve('oxlint-tsgolint/package.json'))
  const executable = process.platform === 'win32' ? 'tsgolint.exe' : 'tsgolint'
  return tsgolintRequire.resolve(
    `@oxlint-tsgolint/${process.platform}-${process.arch}/${executable}`,
  )
}

export function enableVitePlusConfigDiscovery(environment: NodeJS.ProcessEnv, tool: OxcTool): void {
  environment.VP_VERSION = packageManifest.version
  if (tool === 'oxlint') {
    environment.OXLINT_TSGOLINT_PATH ??= resolveTsgolintBin()
  }
}

function isConfigArgument(argument: string): boolean {
  return argument === '-c' || argument === '--config' || argument.startsWith('--config=')
}

/**
 * Points the tool at the nearest `oxc.config.*`, which it loads through the `vite-plus` shim.
 * Language servers take the path from the editor's `configPath` settings instead.
 */
async function withUnifiedConfig(args: string[]): Promise<string[]> {
  if (args.includes('--lsp') || args.some(isConfigArgument)) {
    return args
  }
  const configPath = await findConfig()
  return configPath ? ['--config', configPath, ...args] : args
}

/** Runs the original tool CLI in this process; the tool sets `process.exitCode` itself. */
export async function runTool(tool: OxcTool, args: string[]): Promise<void> {
  const binPath = resolveToolBin(tool)
  enableVitePlusConfigDiscovery(process.env, tool)
  process.argv = [process.execPath, binPath, ...(await withUnifiedConfig(args))]
  await import(pathToFileURL(binPath).href)
}
