import type { OxcConfig } from './types.ts'

export type { OxcConfig, OxcTool } from './types.ts'

export function defineConfig<const Config extends OxcConfig>(config: Config): Config {
  return config
}

export { runTool } from './runner.ts'
export { initializeVsCodeSettings } from './vscode-settings.ts'
