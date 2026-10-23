# README 3D API

Turns a model URL into a fenced block that GitHub renders as an interactive 3D viewer.

```bash
curl -X POST https://three.ws/api/readme-3d \
  -H 'content-type: application/json' \
  -d '{"url":"https://three.ws/avatars/fox.glb","budget":150000}'
```

## Request

| Field | Type | Default | Notes |
|---|---|---|---|
| `url` | string | required | Public https URL of a `.glb`, `.gltf` (single file), `.obj` or `.stl`. Fetched through the SSRF guard; max 40 MB. |
| `budget` | number | 153600 | Target size in bytes of the STL, clamped to 8 KB to 400 KB. |
| `facets` | number | 6000 | Upper bound on triangles, 16 to 6000. The budget usually binds first. |
| `name` | string | `model` | Solid name written into the STL. |
| `details` | boolean | `false` | Wrap the block in a `<details>` disclosure. |

## Response

```json
{
  "markdown": "```stl\nsolid model\n…\n```\n",
  "facets": 1500,
  "source_facets": 10194,
  "bytes": 214000,
  "github_limit_bytes": 524288,
  "fits_github": true
}
```

GitHub stops rendering a markdown file larger than 512 KB, so keep the README's total size in mind: `npx readme-3d check README.md` reports the headroom.

## Errors

`400` invalid body or blocked URL, `413` source over 40 MB, `415` not a supported model, `422` the file could not be parsed, `429` rate limit (12 per 10 minutes per IP), `502` the model host failed.

The converter is the [`readme-3d`](../../packages/readme-3d) package (`convertBytes`). In product it is reachable from the Forge download menu, the avatar page, the avatar dashboard, model pages and the [/readme-3d](https://three.ws/readme-3d) page.
