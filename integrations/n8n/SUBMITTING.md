# Publishing the n8n node

## Verified 2026-11-04

`npm test` 7 passed, `npm run build` successful, `npx eslint .` reports 0 errors and 1 warning (the MCP tool arguments are an arbitrary JSON object by design).

Live run of the built `dist/nodes/ThreeWs/forge.js` against production: submit then resolve for "a small wooden chair" returned `https://three.ws/cdn/forge/0f0944390b17/f65f5ace-26cc-4e42-97ef-f081fb7f49a5.glb`, and `search_catalog` on `/api/mcp-studio` returned `24 matches for "chair"`.

## Owner decision

Verified-node status needs publishing through a GitHub Actions workflow with npm provenance, and this repo does not use GitHub Actions (CLAUDE.md). Two paths:

1. Unverified (works today): `npm publish --access public` from this folder. Users install it by name on self-hosted n8n.
2. Verified (n8n Cloud): publish from a separate repo that has the provenance workflow, then submit in the n8n Creator Portal.

Publishing to npm is an external action and is owned by order 938.
