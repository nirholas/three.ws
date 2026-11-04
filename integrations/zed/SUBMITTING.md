# Publishing the three.ws extension to the Zed extension registry

Zed extensions are listed through a pull request to <https://github.com/zed-industries/extensions>. Format per the Zed docs (<https://zed.dev/docs/extensions/developing-extensions>, checked 2026-11-04) and the accepted `postgres-context-server` extension in `zed-extensions/postgres-context-server`.

| Field | Value |
| --- | --- |
| Extension id | `three-ws` |
| Name | three.ws 3D Agent |
| Version | 0.1.0 |
| License | Apache-2.0 (`LICENSE` in this folder) |
| Context server id | `three-ws` |
| Runtime | `@three-ws/mcp-server` from npm (1.2.3 at the time of writing) |

## What was validated

- `cargo build --target wasm32-wasip2 --release` compiled `zed_three_ws` v0.1.0 against `zed_extension_api` 0.7.0 with no errors on 2026-11-04 (output: `Finished release profile`, a 419 KB `zed_three_ws.wasm`).
- `extension.toml` matches the schema the accepted MCP extension uses (`schema_version = 1`, a `[context_servers.<id>]` table).
- `@three-ws/mcp-server` 1.2.3 is on npm and its entry point is `src/index.js`, the path the extension runs.

## Owner steps

1. Fork `zed-industries/extensions`.
2. Add this repository as a submodule: `git submodule add https://github.com/nirholas/three.ws.git extensions/three-ws`.
3. Add to the top-level `extensions.toml`:

   ```toml
   [three-ws]
   submodule = "extensions/three-ws"
   path = "integrations/zed"
   version = "0.1.0"
   ```

4. Run `pnpm sort-extensions`, commit, and open the pull request. Zed's CI builds the extension and a maintainer reviews it.
5. After it merges, bump `version` in both `extension.toml` and `Cargo.toml` for every later release.

Order 938 (`prompts/finish/938-partners-15-listings-prs-and-sends.md`) owns sending this pull request.
