import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { startLspSession } from '../test/lsp-session.ts'

interface CommandOutput {
  stderr: string
  stdout: string
}

type OxcTool = 'oxfmt' | 'oxlint'
type PackageBin = 'oxc' | OxcTool

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const yarnCommand = process.platform === 'win32' ? 'yarn.cmd' : 'yarn'

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const usesCommandShim = command.endsWith('.cmd')
    const executable = usesCommandShim ? (process.env.ComSpec ?? 'cmd.exe') : command
    const executableArgs = usesCommandShim ? ['/d', '/s', '/c', command, ...args] : args
    const child = spawn(executable, executableArgs, {
      cwd,
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (exitCode) => {
      if (exitCode === 0) {
        resolve({ stderr, stdout })
        return
      }
      reject(
        new Error(`${command} ${args.join(' ')} exited with code ${exitCode}\n${stdout}${stderr}`),
      )
    })
  })
}

function packageEnvironment(projectDirectory: string): NodeJS.ProcessEnv {
  const binDirectory = path.join(projectDirectory, 'node_modules', '.bin')
  return {
    ...process.env,
    PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
  }
}

function packageBinPath(name: PackageBin, projectDirectory: string): string {
  return path.join(
    projectDirectory,
    'node_modules',
    'vite-oxc-bridge',
    name === 'oxc' ? 'dist/cli.js' : `bin/${name}.js`,
  )
}

function runPackageBin(
  name: PackageBin,
  args: string[],
  projectDirectory: string,
): Promise<CommandOutput> {
  return runCommand(
    process.execPath,
    [packageBinPath(name, projectDirectory), ...args],
    projectDirectory,
    packageEnvironment(projectDirectory),
  )
}

async function initializeLanguageServer(tool: OxcTool, projectDirectory: string): Promise<void> {
  const session = startLspSession(packageBinPath(tool, projectDirectory), {
    cwd: projectDirectory,
    env: packageEnvironment(projectDirectory),
    name: `installed ${tool}`,
    timeoutMs: 15_000,
  })
  const rootUri = pathToFileURL(projectDirectory).href
  const options =
    tool === 'oxfmt' ? { 'fmt.disableNestedConfig': true } : { disableNestedConfig: true }

  try {
    await session.request('initialize', {
      capabilities: {},
      initializationOptions: [{ options, workspaceUri: rootUri }],
      processId: process.pid,
      rootUri,
      workspaceFolders: [{ name: 'package-smoke', uri: rootUri }],
    })
  } finally {
    await session.close()
  }
}

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'vite-oxc-bridge-package-'))
const tarballPath = path.join(temporaryDirectory, 'vite-oxc-bridge.tgz')
const projectDirectory = path.join(temporaryDirectory, 'consumer')

try {
  await runCommand(yarnCommand, ['pack', '--out', tarballPath], repositoryRoot)
  await mkdir(projectDirectory)
  await writeFile(
    path.join(projectDirectory, 'package.json'),
    JSON.stringify({ name: 'package-smoke', private: true, type: 'module' }),
  )
  await runCommand(
    npmCommand,
    ['install', '--no-audit', '--no-fund', tarballPath],
    projectDirectory,
  )
  await writeFile(path.join(projectDirectory, 'vite.config.ts'), 'export default {}\n')
  await writeFile(
    path.join(projectDirectory, 'oxc.config.mjs'),
    `export default {
  fmt: { semi: false, singleQuote: true },
  lint: { rules: { 'no-debugger': 'deny' } },
}
`,
  )
  await writeFile(path.join(projectDirectory, 'source.ts'), "const message = 'hello'\n")

  await runCommand(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      "import { defineConfig, runTool } from 'vite-oxc-bridge'; if (typeof defineConfig !== 'function' || typeof runTool !== 'function') process.exit(1)",
    ],
    projectDirectory,
  )

  const help = await runPackageBin('oxc', ['--help'], projectDirectory)
  if (!help.stdout.includes('Usage: oxc')) {
    throw new Error(`Installed oxc returned unexpected help output:\n${help.stdout}${help.stderr}`)
  }
  await runPackageBin('oxc', ['fmt', '--check', 'source.ts'], projectDirectory)
  await runPackageBin('oxc', ['lint', 'source.ts'], projectDirectory)
  await initializeLanguageServer('oxfmt', projectDirectory)
  await initializeLanguageServer('oxlint', projectDirectory)
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}
