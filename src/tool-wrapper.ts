import { pathToFileURL } from 'node:url'

import './vite-plus-preload.ts'
import { enableVitePlusConfigDiscovery, resolveToolBin, TOOL_USAGE } from './tool.ts'
import type { OxcTool } from './types.ts'

function isEditorInvocation(tool: OxcTool): boolean {
  if (process.argv.includes('--lsp')) {
    return true
  }
  return (
    tool === 'oxfmt' && process.argv.some((argument) => argument.startsWith('--stdin-filepath'))
  )
}

export async function runWrappedTool(tool: OxcTool): Promise<void> {
  if (!isEditorInvocation(tool)) {
    const { action, command } = TOOL_USAGE[tool]
    process.stderr.write(`This ${tool} wrapper is for IDE extension use only.\n`)
    process.stderr.write(`To ${action} your code, run: oxc ${command}\n`)
    process.exitCode = 1
    return
  }

  enableVitePlusConfigDiscovery(process.env, tool)
  await import(pathToFileURL(resolveToolBin(tool)).href)
}
