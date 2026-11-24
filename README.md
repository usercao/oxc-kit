# oxc-kit

One typed `oxc.config.ts` for [Oxfmt](https://oxc.rs/docs/guide/usage/formatter) and
[Oxlint](https://oxc.rs/docs/guide/usage/linter), on the command line and in your editor.

```ts
// oxc.config.ts
import { defineConfig } from 'oxc-kit'

export default defineConfig({
  fmt: {
    semi: false,
    singleQuote: true,
  },
  lint: {
    rules: {
      'no-debugger': 'error',
    },
  },
})
```

- **One file** replaces `.oxfmtrc.json` and `.oxlintrc.json`.
- **Typed**: `defineConfig` keeps the native Oxfmt and Oxlint option types.
- **No extra tooling**: the original `oxfmt` and `oxlint` binaries do the work; no Vite or Vite+
  is required.

## Install

```sh
npm install --save-dev oxc-kit
```

`oxc-kit` installs `oxfmt`, `oxlint`, and `oxlint-tsgolint` for you; you do not need to add them
separately.

## Configure

Create `oxc.config.ts` in the project root. Put your Oxfmt options under `fmt` and your Oxlint
options under `lint`, exactly as they would appear in `.oxfmtrc.json` and `.oxlintrc.json`. Either
section may be omitted.

When migrating, move the contents of `.oxfmtrc.json` into `fmt` and `.oxlintrc.json` into `lint`,
then delete both files.

The config may also be named `oxc.config.mts`, `.cts`, `.js`, `.mjs`, or `.cjs`, and must
default-export an object. TypeScript configs run through Node.js type stripping, so syntax that
needs transformation, such as `enum` or `namespace`, is not supported.

## Commands

`oxc fmt` and `oxc lint` find the nearest `oxc.config.*` from the current directory and pass all
other arguments to Oxfmt and Oxlint unchanged:

```json
{
  "scripts": {
    "format": "oxc fmt .",
    "format:check": "oxc fmt --check .",
    "lint": "oxc lint .",
    "lint:fix": "oxc lint --fix ."
  }
}
```

Pass `--config <path>` to use a different config file.

## VS Code

Install the [Oxc extension](https://marketplace.visualstudio.com/items?itemName=oxc.oxc-vscode),
then run:

```sh
npx --no-install oxc init
```

This creates or updates `.vscode/settings.json` so that the extension formats and lints with
`oxc.config.*`. Existing values and JSONC comments are kept. The extension finds the `oxc-kit`
binaries automatically; do not set `oxc.path.oxfmt` or `oxc.path.oxlint`.

`oxc init` also sets `editor.defaultFormatter` per language, even when the top-level value is
already Oxc. VS Code applies language-specific settings before general ones in every scope, so a
language-specific formatter in your user settings would otherwise override the workspace setting.
Add the same override for any other language you want Oxc to format.

The config file is reloaded when it changes. Modules imported by the config are cached until the
editor restarts the Oxc language servers.

## How it works

Oxfmt and Oxlint can read their options from a section of a larger config file through the
protocol that [Vite+](https://viteplus.dev) uses for `vite.config.ts`. `oxc-kit` implements that
protocol for `oxc.config.*`:

1. `oxc fmt`, `oxc lint`, and the editor wrappers run the original Oxfmt and Oxlint in-process
   with Vite+ config loading enabled.
2. The config path comes from `--config` on the command line, or from the `oxc.configPath` and
   `oxc.fmt.configPath` settings in the editor.
3. When Oxfmt or Oxlint asks Vite+ to load that file, `oxc-kit` answers instead and returns the
   `fmt` or `lint` section.

## Requirements

- Node.js 24.22.0 or later

## License

[MIT](./LICENSE)
