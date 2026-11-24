import { defineConfig } from './src/index.ts'

export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
    sortImports: true,
    sortPackageJson: {
      sortScripts: true,
    },
  },
  lint: {
    plugins: ['typescript', 'unicorn', 'oxc', 'import'],
  },
})
