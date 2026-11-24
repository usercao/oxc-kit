import { spawn } from 'node:child_process'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { describe, expect, test } from 'vitest'

import { enableVitePlusConfigDiscovery, resolveTsgolintBin } from '../src/tool.ts'
import type { OxcTool } from '../src/types.ts'

const require = createRequire(import.meta.url)
const packageManifest = require('../package.json') as { version: string }

function runWrapper(tool: OxcTool): Promise<{ exitCode: number | null; stderr: string }> {
  const wrapperPath = fileURLToPath(new URL(`../bin/${tool}.js`, import.meta.url))
  const child = spawn(process.execPath, [wrapperPath, '.'], {
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode) => resolve({ exitCode, stderr }))
  })
}

describe('Oxc tool integration', () => {
  test('sets the Vite+ and type-aware environment for Oxlint', async () => {
    const environment: NodeJS.ProcessEnv = {}

    enableVitePlusConfigDiscovery(environment, 'oxlint')

    expect(environment.VP_VERSION).toBe(packageManifest.version)
    expect(environment.OXLINT_TSGOLINT_PATH).toBe(resolveTsgolintBin())
    await expect(access(environment.OXLINT_TSGOLINT_PATH!)).resolves.toBeUndefined()
  })

  test('keeps normal CLI use on the oxc command', async () => {
    for (const [tool, action] of [
      ['oxfmt', 'format'],
      ['oxlint', 'lint'],
    ] as const) {
      const result = await runWrapper(tool)

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain(`This ${tool} wrapper is for IDE extension use only.`)
      expect(result.stderr).toContain(`oxc ${tool === 'oxfmt' ? 'fmt' : 'lint'}`)
      expect(result.stderr).toContain(`To ${action} your code`)
    }
  })
})
