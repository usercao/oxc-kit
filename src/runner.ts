import { pathToFileURL } from 'node:url'

import './vite-plus-preload.ts'
import { enableVitePlusConfigDiscovery, resolveToolBin } from './tool.ts'
import type { OxcTool } from './types.ts'

/** Runs the original tool CLI in this process; the tool sets `process.exitCode` itself. */
export async function runTool(tool: OxcTool, args: string[]): Promise<void> {
  const binPath = resolveToolBin(tool)
  enableVitePlusConfigDiscovery(process.env, tool)
  process.argv = [process.execPath, binPath, ...args]
  await import(pathToFileURL(binPath).href)
}
