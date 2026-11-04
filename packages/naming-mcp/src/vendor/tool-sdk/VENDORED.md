# Vendored: @three-ws/tool-sdk

These files are a byte-identical copy of `packages/tool-sdk/src/*.js`. Do not edit them here.

`@three-ws/tool-sdk` is private and unpublished, and `@three-ws/naming-mcp` is published to npm, so
naming-mcp cannot declare it as a dependency: an npm install outside this monorepo could not resolve it.
The copy ships inside the naming-mcp tarball instead. Its only external import is `zod`, a regular
naming-mcp dependency.

To change this code, edit `packages/tool-sdk/src/`, then run `npm run vendor:tool-sdk` and commit both.
`npm run check:vendored` fails on any drift between the two.

Source: `packages/tool-sdk/src` at commit `de2e362ec8ebf8008be1c8dff65f087a000667d6`.

| File | sha256 (first 16) |
|---|---|
| `define-executor.js` | `2aefa24535cc41fe` |
| `define-tool.js` | `ff8c88eb52541ba4` |
| `index.js` | `29b12c60f366e9e9` |
| `mcp-adapter.js` | `f544223df16acd65` |
| `permissions.js` | `c9b6fd98ce850417` |
