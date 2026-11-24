import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parse,
  parseTree,
  type FormattingOptions,
  type ParseError,
} from 'jsonc-parser'

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

interface SettingGroup {
  comment: string
  keys: string[]
}

function createSettingGroups(configPath: string): SettingGroup[] {
  return [
    {
      comment: 'Format JavaScript and TypeScript with the Oxc extension',
      keys: [
        'editor.defaultFormatter',
        '[javascript]',
        '[javascriptreact]',
        '[typescript]',
        '[typescriptreact]',
      ],
    },
    {
      comment: `Load Oxfmt and Oxlint options from ${configPath}`,
      keys: ['oxc.configPath', 'oxc.fmt.configPath'],
    },
    {
      comment: 'Ignore nested Oxfmt and Oxlint configs',
      keys: ['oxc.disableNestedConfig', 'oxc.fmt.disableNestedConfig'],
    },
    {
      comment: 'Format whole files and apply Oxlint fixes on save',
      keys: ['editor.formatOnSave', 'editor.formatOnSaveMode', 'editor.codeActionsOnSave'],
    },
  ]
}

function insertComment(text: string, offset: number, comment: string): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  const indentation = text.slice(lineStart, offset)
  if (indentation.trim().length > 0) {
    return text
  }

  const eol = detectEol(text)
  const before = text.slice(0, lineStart)
  const previousLine = before.trimEnd().split('\n').at(-1) ?? ''
  const precededByBlankLine = /\n[\t ]*\r?\n$/.test(before)
  const blankLine = precededByBlankLine || previousLine.trimEnd().endsWith('{') ? '' : eol
  return before + blankLine + `${indentation}// ${comment}${eol}` + text.slice(lineStart)
}

/** Adds a blank line and a comment above the first newly written setting of each group. */
function annotateSettingGroups(
  text: string,
  configPath: string,
  addedKeys: ReadonlySet<string>,
): string {
  const root = parseTree(text)
  if (!root) {
    return text
  }

  const annotations = createSettingGroups(configPath).flatMap(({ comment, keys }) => {
    const offsets = keys
      .filter((key) => addedKeys.has(key))
      .map((key) => findNodeAtLocation(root, [key])?.parent?.offset)
      .filter((offset) => offset !== undefined)
    return offsets.length > 0 ? [{ comment, offset: Math.min(...offsets) }] : []
  })

  // Insert from the end so earlier offsets stay valid.
  return annotations
    .toSorted((a, b) => b.offset - a.offset)
    .reduce((current, { comment, offset }) => insertComment(current, offset, comment), text)
}

function mergeMissingSettings(
  text: string,
  existing: JsonObject,
  incoming: JsonObject,
  formattingOptions: FormattingOptions,
  addedKeys: Set<string>,
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
        if (currentPath.length === 0) {
          addedKeys.add(key)
        }
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
  const relativeConfigPath = path.relative(projectRoot, configPath).split(path.sep).join('/')
  const settings = createVsCodeSettings(relativeConfigPath)
  const allKeys = new Set(Object.keys(settings))
  const settingsPath = path.join(projectRoot, '.vscode', 'settings.json')
  let originalText: string

  try {
    originalText = await readFile(settingsPath, 'utf8')
  } catch (error) {
    if (!hasErrorCode(error, 'ENOENT')) {
      throw error
    }

    await mkdir(path.dirname(settingsPath), { recursive: true })
    await writeFile(
      settingsPath,
      annotateSettingGroups(serializeSettings(settings, '\n'), relativeConfigPath, allKeys),
      'utf8',
    )
    return 'created'
  }

  if (originalText.trim().length === 0) {
    const text = serializeSettings(settings, detectEol(originalText))
    await writeFile(settingsPath, annotateSettingGroups(text, relativeConfigPath, allKeys), 'utf8')
    return 'updated'
  }

  const errors: ParseError[] = []
  const existing: JsonValue = parse(originalText, errors, { allowTrailingComma: true })
  if (errors.length > 0 || !isObject(existing)) {
    throw new Error(
      `Unable to merge ${path.relative(projectRoot, settingsPath)}: expected a JSONC object`,
    )
  }

  const addedKeys = new Set<string>()
  const updatedText = mergeMissingSettings(
    originalText,
    existing,
    settings,
    detectFormattingOptions(originalText),
    addedKeys,
  )
  if (updatedText === originalText) {
    return 'unchanged'
  }

  await writeFile(
    settingsPath,
    annotateSettingGroups(updatedText, relativeConfigPath, addedKeys),
    'utf8',
  )
  return 'updated'
}
