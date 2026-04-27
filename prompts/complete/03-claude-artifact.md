# 03 — Claude.ai artifact snippet

## Why

Band 5 goal: an embodied agent renders _inside_ a Claude.ai chat as an artifact, not as a JSON blob. Claude.ai artifacts are standalone HTML documents — no external script tags allowed beyond whatever runs inside the sandboxed iframe the artifact is rendered in.

Today [api/mcp.js](../../api/mcp.js) has a `render_avatar` tool but there's no dedicated endpoint that returns a **single self-contained HTML document** an agent can cite directly. This prompt ships that.

## What to build

### 1. The endpoint

Create [api/artifact.js](../../api/artifact.js) — a serverless function that returns `text/html` with:

- `GET /api/artifact?agent=<agentId>` — full-page HTML
- `GET /api/artifact?model=<glbUrl>` — full-page HTML with no agent overlay (just viewer)
- Optional `theme=<dark|light>`, `idle=<clipName>`, `bg=<hex>` query params.

Output shape — a minimal HTML document inline-styled and inline-scripted, using `<agent-3d>` via the already-built library UMD at `/dist-lib/agent-3d.umd.cjs`. Sample:

```html
<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width,initial-scale=1" />
		<title>CZ — three.ws</title>
		<style>
			html,
			body {
				margin: 0;
				height: 100%;
				background: #080814;
			}
			agent-3d {
				display: block;
				width: 100%;
				height: 100%;
			}
		</style>
	</head>
	<body>
		<agent-three.ws="{agentId}" eager></agent-3d>
		<script src="https://three.ws/dist-lib/agent-3d.umd.cjs"></script>
	</body>
</html>
```

Requirements:

- Validate `agentId` / `glbUrl` — reject anything that doesn't match `/^[a-z0-9-]{3,64}$/i` for agent, or a whitelisted https origin for model (reuse [api/\_lib/fetch-model.js](../../api/_lib/fetch-model.js) if it has a URL-validation helper).
- `Content-Security-Policy: default-src 'self' https://three.ws/; script-src 'self' 'unsafe-inline' https://three.ws/; img-src * data: blob:; connect-src *; style-src 'self' 'unsafe-inline'; frame-ancestors *` — permissive enough to embed in Claude.ai's artifact iframe.
- Use [api/\_lib/http.js](../../api/_lib/http.js) to set headers; output via `res.end(html)` is OK here _only_ because we're returning HTML, not JSON (the "no res.end" rule is for JSON responses). Document this exception inline.
- Rate-limit via `limits.publicRead` from [api/\_lib/limits.js](../../api/_lib/limits.js) if the preset exists.

### 2. Static fallback + docs

Create `public/artifact/index.html` — a viewer explaining the endpoint, showing live preview via iframe, copy-to-clipboard button. Style is minimal; use the inline `<style>` pattern from [public/widgets-gallery/index.html](../../public/widgets-gallery/index.html) as a model.

Create `public/artifact/README.md` — how to cite this endpoint in a Claude.ai conversation so it auto-renders as an artifact. Include a worked example.

Create `specs/CLAUDE_ARTIFACT.md` — the contract: URL shape, accepted params, returned CSP, browser compat notes.

## Files you own

- Create: `api/artifact.js`
- Create: `public/artifact/index.html`
- Create: `public/artifact/README.md`
- Create: `specs/CLAUDE_ARTIFACT.md`

## Files off-limits

- `api/mcp.js` — read-only. If its `render_avatar` tool needs to call your new endpoint, that's a **follow-up** task, not this one. Note in reporting.
- `src/element.js`, `src/lib.js` — read-only.

## Acceptance

- `curl -I 'http://localhost:3000/api/artifact?agent=test-id'` → `200`, `Content-Type: text/html`, CSP header set.
- Pasting the URL into Claude.ai (real test) renders an interactive 3D artifact. If you can't run this test, say so in reporting.
- Rejecting malformed input: `?agent=<script>` → 400.
- Rejecting disallowed model origins: `?model=http://evil.example.com/x.glb` → 400.

## Reporting

Endpoint response headers dumped, sample output HTML length, list of query params implemented, whether manual Claude.ai test was run.
