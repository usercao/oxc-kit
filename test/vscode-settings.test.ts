import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { parse } from 'jsonc-parser'
import { afterEach, describe, expect, test } from 'vitest'

import { createVsCodeSettings, initializeVsCodeSettings } from '../src/vscode-settings.ts'
import {
  cleanupTemporaryDirectories,
  createTempDirectory,
  createUnifiedFixture,
} from './helpers.ts'

afterEach(async () => {
  await cleanupTemporaryDirectories()
})

describe('VS Code settings initialization', () => {
  test('creates VS Code settings that point Oxc at the unified config', async () => {
    const { directory } = await createUnifiedFixture()

    await expect(initializeVsCodeSettings(directory)).resolves.toBe('created')
    const settingsText = await readFile(path.join(directory, '.vscode', 'settings.json'), 'utf8')

    expect(parse(settingsText)).toEqual(createVsCodeSettings('oxc.config.mjs'))
    expect(settingsText).toContain(
      '},\n\n  // Load Oxfmt and Oxlint options from oxc.config.mjs\n  "oxc.configPath"',
    )
    expect(settingsText.match(/^ {2}\/\/ .+$/gm)).toEqual([
      '  // Format JavaScript and TypeScript with the Oxc extension',
      '  // Load Oxfmt and Oxlint options from oxc.config.mjs',
      '  // Ignore nested Oxfmt and Oxlint configs',
      '  // Format whole files and apply Oxlint fixes on save',
    ])
    expect(settingsText.startsWith('{\n  // Format JavaScript')).toBe(true)
  })

  test('merges missing settings without replacing JSONC comments or existing values', async () => {
    const { directory } = await createUnifiedFixture()
    const settingsPath = path.join(directory, '.vscode', 'settings.json')
    await mkdir(path.dirname(settingsPath), { recursive: true })
    await writeFile(
      settingsPath,
      `{
  // Keep project-specific formatter behavior.
  "editor.formatOnSave": false,
  "editor.codeActionsOnSave": {
    "source.organizeImports": "explicit",
  },
}
`,
    )

    await expect(initializeVsCodeSettings(directory)).resolves.toBe('updated')
    const settingsText = await readFile(settingsPath, 'utf8')
    const settings = parse(settingsText) as Record<string, unknown>

    expect(settingsText).toContain('// Keep project-specific formatter behavior.')
    expect(settingsText).toContain(
      '\n\n  // Load Oxfmt and Oxlint options from oxc.config.mjs\n  "oxc.configPath"',
    )
    expect(settings['editor.formatOnSave']).toBe(false)
    expect(settings['oxc.configPath']).toBe('oxc.config.mjs')
    expect(settings['oxc.fmt.configPath']).toBe('oxc.config.mjs')
    expect(settings['oxc.disableNestedConfig']).toBe(true)
    expect(settings['oxc.fmt.disableNestedConfig']).toBe(true)
    expect(settings['editor.codeActionsOnSave']).toEqual({
      'source.fixAll.oxc': 'explicit',
      'source.organizeImports': 'explicit',
    })
  })

  test('does not comment config paths that are already set', async () => {
    const { directory } = await createUnifiedFixture()
    const settingsPath = path.join(directory, '.vscode', 'settings.json')
    await mkdir(path.dirname(settingsPath), { recursive: true })
    await writeFile(
      settingsPath,
      '{\n  "oxc.configPath": "custom.mjs",\n  "oxc.fmt.configPath": "custom.mjs"\n}\n',
    )

    await expect(initializeVsCodeSettings(directory)).resolves.toBe('updated')
    await expect(readFile(settingsPath, 'utf8')).resolves.not.toContain('// Load Oxfmt')
  })

  test('requires a unified config to point the settings at', async () => {
    const directory = await createTempDirectory('oxc-kit-vscode-settings-')

    await expect(initializeVsCodeSettings(directory)).rejects.toThrow(/before running oxc init/)
  })

  test('rejects a malformed settings file without replacing it', async () => {
    const { directory } = await createUnifiedFixture()
    const settingsPath = path.join(directory, '.vscode', 'settings.json')
    await mkdir(path.dirname(settingsPath), { recursive: true })
    await writeFile(settingsPath, '{ invalid')

    await expect(initializeVsCodeSettings(directory)).rejects.toThrow(/expected a JSONC object/)
    await expect(readFile(settingsPath, 'utf8')).resolves.toBe('{ invalid')
  })
})
