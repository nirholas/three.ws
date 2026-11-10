---
name: spatial-mcp-artifacts
description: Build, validate and lint Spatial MCP artifacts (a live 3D GLB scene returned as an MCP tool result's structuredContent) with the @three-ws/spatial-mcp package. Use when an MCP server tool should return a 3D model or avatar, or when checking an artifact for conformance.
---

# Spatial MCP artifacts

Spatial MCP is an open (CC0) shape for returning an interactive 3D scene from an MCP tool, carried in `structuredContent`. The `@three-ws/spatial-mcp` package is dependency-free (Node 18+, browsers, bundlers) and exports four functions plus a version constant.

## Install

```bash
npm install @three-ws/spatial-mcp
```

## API (from `src/index.js`)

| Export | Use |
|---|---|
| `SPATIAL_MCP_VERSION` | `'0.1'`, the only accepted `spatialMcpVersion` |
| `buildSpatialArtifact(fields)` | assemble a conformant artifact |
| `validateSpatialArtifact(payload)` | returns `{ valid, version, errors, warnings }`, each item `{ path, message }` |
| `isConformantSpatialArtifact(payload)` | boolean |
| `lintSpatialMeta(payload)` | advisory data-minimization findings `[{ path, message }]` |

## Required shape

Only three fields are required: `spatialMcpVersion: "0.1"`, `kind` (one of `model`, `mesh`, `avatar`, `rigged-model`, `scene`) and `scene.glbUrl` (an **https** URL to a `.glb`). Optional blocks: `camera`, `environment`, `animation`, `persona`, `ar`, `affordances`, `meta`. Unknown top-level fields are warnings, not errors.

`buildSpatialArtifact` inputs: `glbUrl` (required), `kind`, `poster`, `alt`, `autoRotate`, `cameraOrbit`, `environmentImage`, `exposure`, `shadowIntensity`, `download`, `rigged`, `clips`, `autoplay`, `personaId`, `ar` (`{ usdzUrl, glbUrl, launchUrl }`, https only), `prompt`, `title`, `viewerUrl`.

## Emit from an MCP tool

```js
import { buildSpatialArtifact, validateSpatialArtifact } from '@three-ws/spatial-mcp';

const spatial = buildSpatialArtifact({
  glbUrl: 'https://three.ws/avatars/xbot.glb',
  kind: 'rigged-model',
  prompt: 'a sci-fi robot',
  title: 'Sci-fi robot',
});
const { valid, errors } = validateSpatialArtifact(spatial);
if (!valid) throw new Error(JSON.stringify(errors));

return {
  content: [{ type: 'text', text: 'Here is your 3D model.' }],
  structuredContent: { glbUrl: spatial.scene.glbUrl, spatial },
};
```

## Validate an existing artifact

1. Parse the JSON, run `validateSpatialArtifact`.
2. Fix every entry in `errors` by its `path` (for example `scene.glbUrl` must be https, `ar.supported: true` needs at least one AR asset URL, `scene.format` may only be `"glb"`).
3. Read `warnings` (missing `camera`, missing `scene.format`) and add the recommended blocks.
4. Run `lintSpatialMeta` and remove any wallet, price, session id, API key or token-shaped value from `meta`. The spec requires emitters to strip these.

## Conformance fixtures

`fixtures/manifest.json` lists every fixture with the required verdict (`valid`) and, for invalid ones, the `mustFlag` error paths. To test another validator, run it over each `fixtures/<file>` and compare. Import the manifest with `import manifest from '@three-ws/spatial-mcp/fixtures/manifest' with { type: 'json' }`. Fixture URLs use the reserved `assets.example` host and are not fetchable.

## Notes

The package only emits and validates. A reference renderer is served at `https://three.ws/spatial-mcp/spatial-renderer.js`, and the same validator module is importable at `https://three.ws/spatial-mcp/spatial-validator.js`.
