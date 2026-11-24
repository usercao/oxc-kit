import path from 'node:path'
import { fileURLToPath } from 'node:url'

// `.ts` when running from source, `.js` once built.
const moduleExtension = path.extname(fileURLToPath(import.meta.url))

export function siblingUrl(name: string, base: string): string {
  return new URL(`./${name}${moduleExtension}`, base).href
}
