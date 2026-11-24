import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, test } from 'vitest'

import {
  cleanupTemporaryDirectories,
  createTempDirectory,
  createUnifiedFixture,
} from './helpers.ts'

const CLI_PATH = fileURLToPath(new URL('../src/cli.ts', import.meta.url))

function runOxc(
  command: 'fmt' | 'lint',
  args: string[],
  cwd: string,
): Promise<{ exitCode: number | null; output: string }> {
  const child = spawn(process.execPath, [CLI_PATH, command, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    output += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    output += chunk
  })

  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode) => resolve({ exitCode, output }))
  })
}

afterEach(async () => {
  await cleanupTemporaryDirectories()
})

describe('oxc CLI', () => {
  test('runs Oxfmt and Oxlint with their unified config sections', async () => {
    const { directory } = await createUnifiedFixture()
    const sourcePath = path.join(directory, 'source.ts')
    await writeFile(sourcePath, `const message = "hello";\nconsole.log(message);\n`)

    expect((await runOxc('fmt', ['source.ts'], directory)).exitCode).toBe(0)
    expect(await readFile(sourcePath, 'utf8')).toBe(
      `const message = 'hello'\nconsole.log(message)\n`,
    )
    expect((await runOxc('fmt', ['--check', '.'], directory)).exitCode).toBe(0)
    expect((await runOxc('lint', ['source.ts'], directory)).exitCode).toBe(0)
  })

  test('loads a parent unified config from a nested working directory', async () => {
    const { directory } = await createUnifiedFixture()
    const nestedDirectory = path.join(directory, 'packages', 'app')
    await mkdir(nestedDirectory, { recursive: true })
    const sourcePath = path.join(nestedDirectory, 'source.ts')
    await writeFile(sourcePath, 'const message = "hello";\n')

    expect((await runOxc('fmt', ['source.ts'], nestedDirectory)).exitCode).toBe(0)
    expect(await readFile(sourcePath, 'utf8')).toBe("const message = 'hello'\n")
  })

  test('returns the underlying Oxlint failure code', async () => {
    const { directory } = await createUnifiedFixture()
    await writeFile(path.join(directory, 'source.ts'), 'debugger\n')
    const { exitCode, output } = await runOxc('lint', ['source.ts'], directory)

    expect(exitCode).not.toBe(0)
    expect(output).toContain('eslint(no-debugger)')
  })

  test('preserves sortPackageJson rules for package.json files', async () => {
    const directory = await createTempDirectory('vite-oxc-bridge-package-json-')

    await writeFile(
      path.join(directory, 'oxc.config.mjs'),
      `export default {
  fmt: {
    sortPackageJson: {
      sortScripts: true,
    },
  },
}\n`,
    )
    await writeFile(path.join(directory, 'vite.config.ts'), 'export default {}\n')
    const packageJsonPath = path.join(directory, 'package.json')
    await writeFile(
      packageJsonPath,
      `{
  "name": "fixture",
  "scripts": {
    "zeta": "echo z",
    "alpha": "echo a",
    "beta": "echo b"
  }
}\n`,
    )

    expect((await runOxc('fmt', ['.'], directory)).exitCode).toBe(0)
    expect(await readFile(packageJsonPath, 'utf8')).toBe(`{
  "name": "fixture",
  "scripts": {
    "alpha": "echo a",
    "beta": "echo b",
    "zeta": "echo z"
  }
}\n`)
  })

  test('passes a native Vite config argument through to Oxc', async () => {
    const { directory } = await createUnifiedFixture()
    const sourcePath = path.join(directory, 'source.ts')
    await writeFile(sourcePath, 'const message = "hello";\n')

    expect(
      (await runOxc('fmt', ['--config', 'vite.config.ts', 'source.ts'], directory)).exitCode,
    ).toBe(0)
    expect(await readFile(sourcePath, 'utf8')).toBe("const message = 'hello'\n")
  })

  test('returns an error when the selected Vite+ section is missing', async () => {
    const { directory } = await createUnifiedFixture(`export default {
  fmt: { semi: false },
}\n`)

    expect((await runOxc('lint', ['source.ts'], directory)).exitCode).not.toBe(0)
  })

  test('runs type-aware lint with the bridge-owned tsgolint runtime', async () => {
    const { directory } = await createUnifiedFixture(`export default {
  lint: { options: { typeAware: true } },
}
`)
    await writeFile(
      path.join(directory, 'tsconfig.json'),
      `{
  "compilerOptions": { "strict": true },
  "include": ["source.ts"]
}
`,
    )
    await writeFile(path.join(directory, 'source.ts'), 'const _value: string = "ok"\n')

    expect((await runOxc('lint', ['--type-aware', 'source.ts'], directory)).exitCode).toBe(0)
  })
})
