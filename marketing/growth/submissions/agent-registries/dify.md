# Dify (langgenius/dify-plugins) plugin submission

Target: `https://github.com/langgenius/dify-plugins`.

Confirmed 2026-10-13: the repo exists and its root is organized as one directory per contributor/author
(e.g. `BrightData`, `16api`, ...), each holding that author's published plugin(s). No directory in the
current root listing packages a generic "call any MCP server" tool, so this is a from-scratch Dify tool
plugin, not a manifest drop-in like the other three registries in this directory.

Unlike Hermes, Kilo Code, and OpenHands, a Dify plugin is not just a YAML/JSON file: it's a buildable
package (`.difypkg`) produced by Dify's own `dify` plugin CLI from a `manifest.yaml` + a `provider.yaml` +
Python tool implementation files, then signed and submitted through the Dify Marketplace, not through this
GitHub repo directly (`langgenius/dify-plugins` mirrors already-published marketplace plugins; the actual
submission path is `https://marketplace.dify.ai` plus the `dify-plugin` CLI). That build step needs a local
Python toolchain this session does not have reason to install for one registry listing, so this file documents
the real plugin identity and tool surface for the owner to scaffold with the CLI, rather than guessing at a
`.difypkg` binary layout this session cannot verify.

## What ships (plugin identity, to feed into `dify plugin init`)

- Plugin name: `three-ws`
- Author: `three-ws`
- Category: `tool`
- Tools exposed (each a thin wrapper calling `https://three.ws/api/mcp-studio` over JSON-RPC, same wire
  format as `packages/ai-sdk/src/client.js` / `packages/langchain/src/client.js` in this repo):
  - `forge` -> `forge_free(prompt, tier?)`
  - `rig` -> `rig_mesh(glb_url)`
  - `render` -> `look_at_model(glb_url, views?, size?)`
- No credentials required (the provider has no auth fields).

## Verification packet

- Repo structure (per-contributor plugin directories) confirmed via the GitHub contents API, 2026-10-13.
- Tool schemas confirmed live against production in this session's test runs
  (`packages/ai-sdk/test/tools.test.js`, `packages/langchain/test/tools.test.js`).

## Owner steps (not automatable here)

1. Install the `dify-plugin` CLI (`pip install dify-plugin` or the packaged binary per Dify's plugin docs).
2. `dify plugin init`, name `three-ws`, category `tool`, then add the three tools listed above as thin
   fetch wrappers around `https://three.ws/api/mcp-studio` (reuse the request shape in
   `packages/ai-sdk/src/client.js`).
3. `dify plugin package` to produce the `.difypkg`, then submit it at `https://marketplace.dify.ai`.
