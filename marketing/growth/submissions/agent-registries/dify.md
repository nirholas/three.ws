# Dify (langgenius/dify-plugins) plugin submission

Target: `https://github.com/langgenius/dify-plugins`.

Re-verified 2026-11-14: repo exists, not archived, 561 stars, 675 root entries, still one directory per
contributor/author, no `three-ws` directory yet. The submission path DRIFTED from the 2026-10-13 text below: the repo
README now says to publish by pull request to this repo (fork, add `<org>/<plugin>/` holding the plugin source and
the current `.difypkg`, fill the PR template), and approved plugins are then auto-listed on marketplace.dify.ai.
So the PR is the submission, not a separate marketplace upload. The repo has no LICENSE (nothing is copied from it).
It also requires, per `docs/plugin-submission-requirements.md`: a `PRIVACY.md` or hosted privacy policy referenced in
`manifest.yaml`, a plugin README with contact and source repo URL, and a risk level in the PR template (choose
medium: it sends user content and user-provided GLB URLs to an external service).

Originally confirmed 2026-10-13: the repo exists and its root is organized as one directory per contributor/author
(e.g. `BrightData`, `16api`, ...), each holding that author's published plugin(s). No directory in the
current root listing packages a generic "call any MCP server" tool, so this is a from-scratch Dify tool
plugin, not a manifest drop-in like the other three registries in this directory.

Unlike Hermes, Kilo Code, and OpenHands, a Dify plugin is not just a YAML/JSON file: it's a buildable
package (`.difypkg`) produced by Dify's own `dify` plugin CLI from a `manifest.yaml` + a `provider.yaml` +
Python tool implementation files, then then submitted by pull request to this GitHub repo (superseded text: it
used to say the Marketplace takes the upload directly; see the re-verification note above). That build step needs a local
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
3. `dify plugin package` to produce the `.difypkg`. Add `PRIVACY.md` and a README with contact and source repo URL.
4. Fork `https://github.com/langgenius/dify-plugins`, create `three-ws/three-ws/` with the plugin source and the
   single current `.difypkg`, open the PR using the repo's PR template (risk level: medium). On approval it lists
   on `https://marketplace.dify.ai` automatically.
