import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { applyEdits, modify, parse, type FormattingOptions, type ParseError } from 'jsonc-parser'

import { hasErrorCode, isObject } from './utils.ts'

type JsonValue = boolean | JsonObject | JsonValue[] | null | number | string

interface JsonObject {
  [key: string]: JsonValue
}

export const VITE_PLUS_VSCODE_SETTINGS: JsonObject = {
  'editor.defaultFormatter': 'oxc.oxc-vscode',
  '[javascript]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
  '[javascriptreact]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
  '[typescript]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
  '[typescriptreact]': { 'editor.defaultFormatter': 'oxc.oxc-vscode' },
  'oxc.disableNestedConfig': true,
  'oxc.fmt.disableNestedConfig': true,
  'editor.formatOnSave': true,
  'editor.formatOnSaveMode': 'file',
  'editor.codeActionsOnSave': { 'source.fixAll.oxc': 'explicit' },
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

function serializeSettings(eol: string): string {
  return JSON.stringify(VITE_PLUS_VSCODE_SETTINGS, null, 2).replaceAll('\n', eol) + eol
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
  const settingsPath = path.join(projectRoot, '.vscode', 'settings.json')
  let originalText: string

  try {
    originalText = await readFile(settingsPath, 'utf8')
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw error
    }

    await mkdir(path.dirname(settingsPath), { recursive: true })
    await writeFile(settingsPath, serializeSettings('\n'), 'utf8')
    return 'created'
  }

  if (originalText.trim().length === 0) {
    await writeFile(settingsPath, serializeSettings(detectEol(originalText)), 'utf8')
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
    VITE_PLUS_VSCODE_SETTINGS,
    detectFormattingOptions(originalText),
  )
  if (updatedText === originalText) {
    return 'unchanged'
  }

  await writeFile(settingsPath, updatedText, 'utf8')
  return 'updated'
}
