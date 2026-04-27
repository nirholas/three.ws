# 13 — Zero-dep Claude.ai artifact bundle

## Why

Claude.ai Artifacts run in a sandboxed iframe: no npm, no localStorage, CDN scripts allowed. We need a single-file `artifact.js` that, dropped into an Artifact's HTML, boots an embodied agent keyed by agent-id.

## Parallel-safety

Output is a new static file under `public/`. No edits to `src/app.js` or the library build.

## Files you own

- Create: `public/artifact.js` — single self-contained ES module, ~300 LOC max.
- Create: `public/artifact-example.html` — copy-paste-ready template demonstrating usage.

## Deliverable

### `public/artifact.js`

- Import Three.js + GLTFLoader from a pinned CDN (`https://esm.sh/three@0.160.0`, `https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js`). Pin exact versions. No dynamic unpkg.
- Exports an auto-mount IIFE: scans the document for `<div data-agent-id="..."></div>` elements on `DOMContentLoaded` and mounts a viewer into each.
- Fetches `https://three.ws/api/agents/${id}` → gets `manifest_url` → fetches manifest → loads `avatar.glb`.
- Renders: transparent background (`alpha: true`), orbit controls off, a subtle auto-rotate + breathing idle (inline, no idle-animation.js dep), responsive to container size.
- If fetch fails, shows an inline error div with the CDN-safe CSS injected at the top of the mount.

### `public/artifact-example.html`

A minimal HTML document a user can paste into a Claude.ai Artifact:

```html
<!doctype html>
<html>
	<head>
		<meta charset="utf-8" />
		<style>
			html,
			body {
				margin: 0;
				height: 100%;
				background: #111;
			}
		</style>
	</head>
	<body>
		<div data-agent-id="demo" style="width:100%;height:100vh"></div>
		<script type="module" src="https://three.ws/artifact.js"></script>
	</body>
</html>
```

## Constraints

- Absolutely no imports from `src/`, `dist-lib/`, or anything in this repo. Must be self-contained.
- Pinned CDN versions only. No unversioned URLs.
- Must respect `prefers-reduced-motion` — skip auto-rotate / breathing if set.
- No localStorage / sessionStorage. No cookies.
- No `window.VIEWER` debug globals.
- Must handle DPR (`renderer.setPixelRatio(Math.min(devicePixelRatio, 2))`).

## Acceptance

- Open `public/artifact-example.html` directly in a browser (via a local server) → demo agent loads and idles.
- Paste the example HTML into a Claude.ai Artifact — same behavior.
- Network tab: exactly one Three import, one GLTFLoader import, one `/api/agents/:id`, one manifest fetch, one `.glb` fetch.

## Report

- Final file size of `public/artifact.js` gzipped (measure with `gzip -c public/artifact.js | wc -c`).
- Any CORS surprises you hit fetching from the Artifact sandbox.
