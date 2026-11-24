import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleExtension = path.extname(fileURLToPath(import.meta.url))
const shimUrl = new URL(`./vite-plus-shim${moduleExtension}`, import.meta.url).href

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'vite-plus'
      ? { shortCircuit: true, url: shimUrl }
      : nextResolve(specifier, context)
  },
})
