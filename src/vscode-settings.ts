import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { applyEdits, modify, parse, type FormattingOptions, type ParseError } from 'jsonc-parser'

import { CONFIG_FILENAMES, findConfig } from './config.ts'
import { hasErrorCode, isObject } from './utils.ts'

type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string

interface JsonObject {
  [key: string]: JsonValue
}

/** VS Code settings that point both Oxc language servers at the unified config. */
export function createVsCodeSettings(configPath: string): JsonObject {
  return {
    'editor.defaultFormatter': 'oxc.oxc-vscode',
    '[javascript]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
    '[javascriptreact]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
    '[typescript]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
    '[typescriptreact]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
    'oxc.configPath': configPath,
    'oxc.fmt.configPath': configPath,
    'oxc.disableNestedConfig': true,
    'oxc.fmt.disableNestedConfig': true,
    'editor.formatOnSave': true,
    'editor.formatOnSaveMode': 'file',
    'editor.codeActionsOnSave': { 'source.fixAll.oxc': 'explicit' },
  }
}

export type VsCodeSettingsInitialization = 'created' | 'unchanged' | 'updated'

function detectEol(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n'
}

function detectFormattingOptions(text: string): FormattingOptions {
  const indentation = /^([\t ]+)"/m.exec(text)?.[1] ?? '  '

  return {
    eol: detectEol(text),
    insertSpaces: !indentation.includes('\t'),
    tabSize: indentation.includes('\t') ? 1 : indentation.length,
  }
}

function serializeSettings(settings: JsonObject, eol: string): string {
  return JSON.stringify(settings, null, 2).replaceAll('\n', eol) + eol
}

function mergeMissingSettings(
  text: string,
  existing: JsonObject,
  incoming: JsonObject,
  formattingOptions: FormattingOptions,
): string {
  let updatedText = text

  function insertMissingSettings(
    existingNode: JsonObject,
    incomingNode: JsonObject,
    currentPath: string[],
  ): void {
    for (const [key, incomingValue] of Object.entries(incomingNode)) {
      const existingValue = existingNode[key]
      const settingPath = [...currentPath, key]

      if (!(key in existingNode)) {
        updatedText = applyEdits(
          updatedText,
          modify(updatedText, settingPath, incomingValue, { formattingOptions }),
        )
      } else if (isObject(existingValue) && isObject(incomingValue)) {
        insertMissingSettings(existingValue, incomingValue, settingPath)
      }
    }
  }

  insertMissingSettings(existing, incoming, [])
  return updatedText
}

export async function initializeVsCodeSettings(
  projectRoot = process.cwd(),
): Promise<VsCodeSettingsInitialization> {
  const configPath = await findConfig(projectRoot)
  if (!configPath) {
    throw new Error(`Create one of ${CONFIG_FILENAMES.join(', ')} before running oxc init`)
  }
  const settings = createVsCodeSettings(
    path.relative(projectRoot, configPath).split(path.sep).join('/'),
  )
  const settingsPath = path.join(projectRoot, '.vscode', 'settings.json')
  let originalText: string

  try {
    originalText = await readFile(settingsPath, 'utf8')
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw error
    }

    await mkdir(path.dirname(settingsPath), { recursive: true })
    await writeFile(settingsPath, serializeSettings(settings, '\n'), 'utf8')
    return 'created'
  }

  if (originalText.trim().length === 0) {
    await writeFile(settingsPath, serializeSettings(settings, detectEol(originalText)), 'utf8')
    return 'updated'
  }

  const errors: ParseError[] = []
  const existing: JsonValue = parse(originalText, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !isObject(existing)) {
    throw new Error(
      `Unable to merge ${path.relative(projectRoot, settingsPath)}: expected a JSONC object`,
    )
  }

  const updatedText = mergeMissingSettings(
    originalText,
    existing,
    settings,
    detectFormattingOptions(originalText),
  )
  if (updatedText === originalText) {
    return 'unchanged'
  }

  await writeFile(settingsPath, updatedText, 'utf8')
  return 'updated'
}
