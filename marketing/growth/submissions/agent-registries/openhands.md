# OpenHands (OpenHands/extensions) integration catalog submission

**Status: draft PR opened 2026-11-04.** PR: https://github.com/OpenHands/extensions/pull/902
(branch `nirholas:add-three-ws-integration`).

Target: `https://github.com/OpenHands/extensions`, default branch `main`, license MIT.

## Owner step (the one thing left)

The repo's PR template has a `HUMAN:` section that AI agents are told not to edit, and asks that the PR stay a
draft until a person writes a short note there (at least 20 visible characters). Open the PR, replace that
comment with one or two sentences in your own words (for example why you want three.ws in Agent Canvas), then
click **Ready for review**.

## Format (verified live 2026-11-04)

`integrations/catalog/<id>.json` is the single hand-authored source. Required fields per
`integrations/catalog.schema.json`: `id`, `name`, `description`, `docsUrl`, `connectionOptions`. After an edit,
`npm run build:integrations` regenerates `integrations/catalog-index.js`. A remote no-auth entry must also be
added to the intentional allowlist in
`tests/test_catalogs.py::test_remote_no_auth_mcp_entries_are_intentionally_public` (it was
`cloudflare-docs`, `deepwiki`, `huggingface`).

## What shipped

- `integrations/catalog/three-ws.json`: name "three.ws 3D Studio", categories Engineering and Design, `docsUrl`
  `https://three.ws/docs`, `logoUrl` `https://three.ws/favicon.svg`, one connection option
  `{provider: "mcp", transport: {kind: "shttp", url: "https://three.ws/api/mcp-studio"}, auth: {strategy: "none"}}`.
- Regenerated `integrations/catalog-index.js`.
- `three-ws` added to the public no-auth allowlist test.

## Verification

- `pytest tests/test_catalog_schema.py tests/test_integration_catalog_in_sync.py tests/test_catalogs.py`:
  117 passed.
- `getIntegrationCatalogEntry("three-ws")` from the package's own `integrations/index.js` returns the entry.
- Live MCP against the declared URL: `initialize` returns `three-ws-3d-studio-free`; `search_catalog
  {"q":"chair","limit":3}` returns 24 matches from the 1306-asset library.
