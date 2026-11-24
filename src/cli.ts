#!/usr/bin/env node

import { runTool, TOOL_USAGE } from './tool.ts'
import type { OxcTool } from './types.ts'
import { initializeVsCodeSettings } from './vscode-settings.ts'

const HELP = `Usage: oxc <command> [options] [tool arguments]

Commands:
  init       Create Vite+-compatible VS Code settings
  lint       Run Oxlint with the lint section from oxc.config.*
  fmt        Run Oxfmt with the fmt section from oxc.config.*

Options:
  -h, --help           Show this help
`

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  if (!command || command === '--help' || command === '-h') {
    process.stdout.write(HELP)
    return
  }

  if (command === 'init') {
    if (args.length > 0) {
      throw new Error(`The init command does not accept arguments\n\n${HELP}`)
    }

    const result = await initializeVsCodeSettings()
    const verb =
      result === 'created' ? 'Created' : result === 'updated' ? 'Updated' : 'Already configured'
    process.stdout.write(`${verb} .vscode/settings.json\n`)
    return
  }

  const tool = (Object.keys(TOOL_USAGE) as OxcTool[]).find(
    (candidate) => TOOL_USAGE[candidate].command === command,
  )
  if (tool) {
    await runTool(tool, args)
    return
  }

  throw new Error(`Unknown command: ${command}\n\n${HELP}`)
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  process.stderr.write(`oxc: ${message}\n`)
  process.exitCode = 1
}
