---
name: see-3d-model
description: Render a GLB from several camera angles so you can look at the images and judge the model, with geometry stats attached. Use after generating or receiving a 3D asset, or when asked to check, critique or inspect a GLB.
---

# See a 3D model

A `.glb` is opaque to a language model. `@three-ws/see` renders it from several angles and returns image URLs plus geometry facts, so you can check an asset before you hand it over. No key and no account are needed.

## Option 1: MCP tool

This plugin's `.mcp.json` registers `https://three.ws/api/mcp-studio`. Call its `look_at_model` tool with the GLB URL. The frames come back as MCP image content blocks you can see directly.

## Option 2: the npm package (Node 18+)

```bash
npm install @three-ws/see
```

```js
import { see, toMessageContent, SeeError } from '@three-ws/see';

const look = await see('https://example.com/robot.glb', {
  views: ['three-quarter', 'front', 'side', 'back'],
  size: 512,
});
look.views;        // [{ view, theta, phi, imageUrl }, ...]
look.missingViews; // angles that failed to render (a partial turntable is not an error)
look.notes;        // plain-language reading of the geometry
look.stats;        // { vertices, triangles, materials, textures, animations, ... }
look.viewerUrl;    // spin it in a browser
look.arUrl;        // place it in a room from a phone
```

`toMessageContent(look, { fetchImages: true })` shapes a look into multimodal chat content (one text label plus one image per angle). `fetchImages: true` inlines base64 for APIs that will not fetch URLs.

## Options

| Option | Default | Notes |
| --- | --- | --- |
| `views` | `['three-quarter','front','side','back']` | up to 6 from `front`, `three-quarter`, `side`, `back`, `top`, `bottom`; unknown names are ignored |
| `size` | `512` | square pixels, 128 to 1024 |
| `stats` | `true` | `false` skips the geometry pass |
| `baseUrl` | `https://three.ws` | another deployment |
| `timeoutMs` | `120000` | rendering holds a browser for seconds |
| `fetch` | global `fetch` | inject for tests or proxies |

## Errors

`SeeError` carries `code`: `invalid_url`, `render_failed`, `rate_limited` (wait `err.retryAfter` seconds), `timeout`, `unreachable`.

## What to look for

- `back`: the half single-view generators most often leave unfinished.
- `side`: flattened or collapsed depth.
- `bottom`: missing caps, inverted normals, floating pieces.
- `front`: facing, symmetry, whether the subject is recognisable.

Then say exactly what to change, and regenerate if needed. The GLB URL must be publicly reachable.
