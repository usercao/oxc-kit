import { registerHooks } from 'node:module'

import { siblingUrl } from './sibling-url.ts'

const shimUrl = siblingUrl('vite-plus-shim', import.meta.url)

registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === 'vite-plus'
      ? { shortCircuit: true, url: shimUrl }
      : nextResolve(specifier, context)
  },
})
