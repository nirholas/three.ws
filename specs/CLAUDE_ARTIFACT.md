# CLAUDE_ARTIFACT — contract spec

Endpoint that returns a single self-contained HTML document suitable for rendering as a Claude.ai artifact.

## URL shape

```
GET https://three.ws/api/artifact
```

### Parameters

| Param   | Required | Pattern                            | Notes                                     |
| ------- | -------- | ---------------------------------- | ----------------------------------------- |
| `agent` | one of   | `/^[a-z0-9_-]{3,64}$/i`            | Agent ID; looked up in `agent_identities` |
| `model` | one of   | `https://` URL, whitelisted origin | GLB URL; viewer-only, no persona          |
| `theme` | no       | `dark` \| `light`                  | Default `dark`                            |
| `idle`  | no       | string                             | Animation clip name                       |
| `bg`    | no       | hex string (no `#`)                | Background colour                         |

Exactly one of `agent` or `model` must be supplied; both or neither → 400.

## Whitelisted model origins

- `*.r2.cloudflarestorage.com`
- `*.amazonaws.com`
- `*.cloudfront.net`
- `storage.googleapis.com`
- `*.blob.core.windows.net`
- `three.ws`
- `*.vercel.app`

Any other origin, or non-`https:` scheme → 400.

## Response

- **Status:** `200 OK`
- **Content-Type:** `text/html; charset=utf-8`
- **Cache:** `public, max-age=60, s-maxage=60, stale-while-revalidate=3600`

### Content-Security-Policy

```
default-src 'self' https://three.ws/;
script-src 'self' 'unsafe-inline' https://three.ws/;
img-src * data: blob:;
connect-src *;
style-src 'self' 'unsafe-inline';
frame-ancestors *
```

`frame-ancestors *` allows Claude.ai's sandboxed artifact iframe to load the document.

## Error responses

All errors are `application/json` in the standard `{ error, error_description }` envelope:

| Status | Code                 | Cause                                                       |
| ------ | -------------------- | ----------------------------------------------------------- |
| 400    | `invalid_request`    | Bad agent ID pattern, bad model URL, or missing both params |
| 404    | `not_found`          | Agent ID not found or deleted                               |
| 405    | `method_not_allowed` | Non-GET/HEAD request                                        |
| 429    | `rate_limited`       | Exceeded `widgetRead` preset (600/min per IP)               |

## Browser compat

The returned document uses `<agent-3d>` (custom element) defined by the UMD bundle at `/dist-lib/agent-3d.umd.cjs`. Requires:

- Custom Elements v1 — Chrome 67+, Firefox 63+, Safari 10.1+
- WebGL 1 (three.js fallback for WebGL 2 absent)

Claude.ai artifact iframes run Chromium — fully supported.

## Authoring notes

- `res.end(html)` is used intentionally. The "no `res.end`" rule in `CLAUDE.md` applies to JSON responses only.
- HTML attribute values are escaped via `escAttr()` to prevent XSS from user-supplied agent names or model URLs.
- SQL lookup uses tagged-template `sql\`...\`` — no string concat.
