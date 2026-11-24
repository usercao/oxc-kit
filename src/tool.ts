import { createRequire } from 'node:module'
import path from 'node:path'

import type { OxcTool } from './index.ts'

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
  environment.VP_RESOLVING_CONFIG_METADATA ??= '1'
  if (tool === 'oxlint') {
    environment.OXLINT_TSGOLINT_PATH ??= resolveTsgolintBin()
  }
}
