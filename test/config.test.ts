import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { afterEach, describe, expect, test, vi } from 'vitest'

const { readdirMock } = vi.hoisted(() => ({ readdirMock: vi.fn() }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  readdirMock.mockImplementation(actual.readdir)
  return { ...actual, readdir: readdirMock }
})

import { findConfig, loadConfig } from '../src/config.ts'
import { resolveConfigFromFile } from '../src/vite-plus-shim.ts'
import {
  cleanupTemporaryDirectories,
  createTempDirectory,
  createUnifiedFixture,
} from './helpers.ts'

const CONFIG_EXTENSION_CASES = [
  { extension: 'ts', module: 'esm' },
  { extension: 'mts', module: 'esm' },
  { extension: 'cts', module: 'commonjs' },
  { extension: 'js', module: 'esm' },
  { extension: 'mjs', module: 'esm' },
  { extension: 'cjs', module: 'commonjs' },
] as const

afterEach(async () => {
  await cleanupTemporaryDirectories()
})

describe('config discovery', () => {
  test('finds and loads a unified config from a parent directory', async () => {
    const { configPath, directory } = await createUnifiedFixture()
    const nestedDirectory = path.join(directory, 'packages', 'app')
    await mkdir(nestedDirectory, { recursive: true })

    expect(await findConfig(nestedDirectory)).toBe(configPath)
    expect(await loadConfig(configPath)).toEqual({
      lint: { rules: { 'no-debugger': 'deny' } },
      fmt: { semi: false, singleQuote: true },
    })
  })

  test('resolveConfigFromFile loads the config file it is given', async () => {
    const { configPath } = await createUnifiedFixture()

    await expect(resolveConfigFromFile(configPath)).resolves.toEqual({
      lint: { rules: { 'no-debugger': 'deny' } },
      fmt: { semi: false, singleQuote: true },
    })
  })

  test('passes unknown configuration fields through without validation', async () => {
    const { configPath } = await createUnifiedFixture('export default { unrelated: true }\n')

    expect(await loadConfig(configPath)).toEqual({ unrelated: true })
  })

  test.each(CONFIG_EXTENSION_CASES)(
    'loads an .$extension $module configuration',
    async ({ extension, module }) => {
      const directory = await createTempDirectory(`vite-oxc-bridge-${extension}-config-`)
      const configPath = path.join(directory, `oxc.config.${extension}`)
      const config = `{ fmt: { semi: false }, lint: {} }`
      const source =
        module === 'commonjs' ? `module.exports = ${config}\n` : `export default ${config}\n`
      await writeFile(configPath, source)

      await expect(loadConfig(configPath)).resolves.toEqual({
        fmt: { semi: false },
        lint: {},
      })
    },
  )

  test.each([
    { extension: 'mjs', exportPrefix: 'export default ' },
    { extension: 'cjs', exportPrefix: 'module.exports = ' },
    { extension: 'cts', exportPrefix: 'module.exports = ' },
  ])(
    'reloads the root .$extension configuration in a long-running process',
    async ({ extension, exportPrefix }) => {
      const directory = await createTempDirectory(`vite-oxc-bridge-${extension}-reload-`)
      const configPath = path.join(directory, `oxc.config.${extension}`)
      await writeFile(configPath, `${exportPrefix}{ fmt: { semi: false } }\n`)

      expect(await loadConfig(configPath)).toEqual({ fmt: { semi: false } })
      await writeFile(configPath, `${exportPrefix}{ fmt: { semi: true } }\n`)
      expect(await loadConfig(configPath)).toEqual({ fmt: { semi: true } })
    },
  )

  test('reuses the loaded configuration module while the file is unchanged', async () => {
    const { configPath } = await createUnifiedFixture()

    expect(await loadConfig(configPath)).toBe(await loadConfig(configPath))
  })

  test('keeps imported configuration modules cached until process restart', async () => {
    const directory = await createTempDirectory('vite-oxc-bridge-import-cache-')
    const optionsPath = path.join(directory, 'format-options.mjs')
    const configPath = path.join(directory, 'oxc.config.mjs')
    await writeFile(optionsPath, 'export default { semi: false }\n')
    await writeFile(configPath, "import fmt from './format-options.mjs'\nexport default { fmt }\n")

    expect(await loadConfig(configPath)).toEqual({ fmt: { semi: false } })
    await writeFile(optionsPath, 'export default { semi: true }\n')
    expect(await loadConfig(configPath)).toEqual({ fmt: { semi: false } })
  })

  test('rejects a non-object default export', async () => {
    const { configPath } = await createUnifiedFixture("export default 'deny'\n")

    await expect(loadConfig(configPath)).rejects.toThrow(
      /must default-export a configuration object/,
    )
  })

  test('rejects multiple unified configs in the same directory', async () => {
    const directory = await createTempDirectory('vite-oxc-bridge-multi-config-')
    await writeFile(path.join(directory, 'oxc.config.mjs'), 'export default { lint: {} }\n')
    await writeFile(path.join(directory, 'oxc.config.js'), 'export default { fmt: {} }\n')

    await expect(findConfig(directory)).rejects.toThrow(/Multiple unified Oxc configs found/)
  })

  test('reports when no unified config exists in the directory tree', async () => {
    const directory = await createTempDirectory('vite-oxc-bridge-no-config-')

    await expect(findConfig(directory)).resolves.toBeUndefined()
  })

  test('preserves file system errors while discovering a configuration', async () => {
    const directory = await createTempDirectory('vite-oxc-bridge-access-error-')
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    readdirMock.mockRejectedValueOnce(error)

    await expect(findConfig(directory)).rejects.toBe(error)
  })

  test('preserves errors thrown while evaluating a configuration', async () => {
    const { configPath } = await createUnifiedFixture("throw new Error('fixture config failed')\n")

    await expect(loadConfig(configPath)).rejects.toThrow('fixture config failed')
  })
})
