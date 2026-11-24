import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// `.ts` when running from source, `.js` once built.
const moduleExtension = path.extname(fileURLToPath(import.meta.url))
const shimUrl = new URL(`./vite-plus-shim${moduleExtension}`, import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'vite-plus'
      ? { shortCircuit: true, url: shimUrl }
      : nextResolve(specifier, context)
  },
})

// Configs in packages without `"type": "module"` are reparsed as ES modules; hide Node's
// warning about it, as Vite+ does with `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON`.
const emitWarning = process.emitWarning.bind(process) as (...args: unknown[]) => void
process.emitWarning = ((...args: unknown[]) => {
  const [, typeOrOptions, code] = args
  const warningCode =
    typeof typeOrOptions === 'object' && typeOrOptions !== null && 'code' in typeOrOptions
      ? typeOrOptions.code
      : code
  if (warningCode !== 'MODULE_TYPELESS_PACKAGE_JSON') {
    emitWarning(...args)
  }
}) as typeof process.emitWarning
