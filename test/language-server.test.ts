import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { afterEach, describe, expect, test } from 'vitest'

import { cleanupTemporaryDirectories, createUnifiedFixture } from './helpers.ts'
import { startLspSession, type LspSession } from './lsp-session.ts'

function startWrapperSession(tool: 'oxfmt' | 'oxlint', cwd: string): LspSession {
  const wrapperPath = fileURLToPath(new URL(`../bin/${tool}.js`, import.meta.url))
  return startLspSession(wrapperPath, { cwd, name: tool })
}

async function formatWithLsp(configDirectory: string, sourcePath: string): Promise<unknown> {
  const session = startWrapperSession('oxfmt', configDirectory)
  const rootUri = pathToFileURL(configDirectory).href
  const sourceUri = pathToFileURL(sourcePath).href

  try {
    await session.request('initialize', {
      capabilities: { textDocument: { formatting: {} } },
      initializationOptions: [
        {
          options: { 'fmt.configPath': 'oxc.config.mjs', 'fmt.disableNestedConfig': true },
          workspaceUri: rootUri,
        },
      ],
      processId: null,
      rootUri,
      workspaceFolders: [{ name: 'fixture', uri: rootUri }],
    })
    session.notify('initialized', {})
    session.notify('textDocument/didOpen', {
      textDocument: {
        languageId: 'typescript',
        text: 'const message = "hello";\n',
        uri: sourceUri,
        version: 1,
      },
    })
    return await session.request('textDocument/formatting', {
      options: { insertSpaces: true, tabSize: 2 },
      textDocument: { uri: sourceUri },
    })
  } finally {
    await session.close()
  }
}

async function lintWithLsp(configDirectory: string, sourcePath: string): Promise<unknown> {
  const session = startWrapperSession('oxlint', configDirectory)
  const rootUri = pathToFileURL(configDirectory).href
  const sourceUri = pathToFileURL(sourcePath).href

  try {
    await session.request('initialize', {
      capabilities: {
        textDocument: { diagnostic: {} },
        workspace: { diagnostics: { refreshSupport: true } },
      },
      initializationOptions: [
        {
          options: { configPath: 'oxc.config.mjs', disableNestedConfig: true },
          workspaceUri: rootUri,
        },
      ],
      processId: process.pid,
      rootUri: null,
      workspaceFolders: [{ name: 'fixture', uri: rootUri }],
    })
    session.notify('initialized', {})
    session.notify('textDocument/didOpen', {
      textDocument: {
        languageId: 'typescript',
        text: await readFile(sourcePath, 'utf8'),
        uri: sourceUri,
        version: 1,
      },
    })
    return await session.request('textDocument/diagnostic', {
      textDocument: { uri: sourceUri },
    })
  } finally {
    await session.close()
  }
}

afterEach(async () => {
  await cleanupTemporaryDirectories()
})

describe('Oxc wrappers', () => {
  test('loads fmt from oxc.config.* for a formatting request', async () => {
    const { directory } = await createUnifiedFixture(`export default {
  fmt: { semi: false, singleQuote: true },
}\n`)
    const sourcePath = path.join(directory, 'source.ts')
    await writeFile(sourcePath, 'const message = "hello";\n')

    await expect(formatWithLsp(directory, sourcePath)).resolves.toEqual([
      {
        newText: "'hello'",
        range: {
          end: { character: 24, line: 0 },
          start: { character: 16, line: 0 },
        },
      },
    ])
  })

  test('loads lint from oxc.config.* for a diagnostic request', async () => {
    const { directory } = await createUnifiedFixture()
    const sourcePath = path.join(directory, 'source.ts')
    await writeFile(sourcePath, 'debugger\n')

    await expect(lintWithLsp(directory, sourcePath)).resolves.toMatchObject({
      items: [expect.objectContaining({ code: 'eslint(no-debugger)' })],
      kind: 'full',
    })
  })
})
