# WordPress embed

The **three.ws Agent** plugin ([`integrations/wordpress/three-ws-agent/`](../integrations/wordpress/three-ws-agent))
embeds [`<agent-3d>`](web-component.md) as a Gutenberg block or a shortcode. No npm, no build
step, no bundler: the editor script is plain ES5-safe JS against the `wp.*` globals WordPress
already ships, and both entry points render through one shared PHP function so the block editor's
preview is never a second, divergent implementation of the markup.

## Installing

Copy or symlink `integrations/wordpress/three-ws-agent/` into `wp-content/plugins/`, then activate
**three.ws Agent** from Plugins. There is nothing to configure: a public agent, agent ID, or bare
model URL renders with no API key.

## Block

Search the block inserter for "three.ws Agent" (category: Embeds). The inspector panel exposes:

| Attribute | Purpose |
|---|---|
| On-chain URI | `agent://base/42`. Takes priority over Agent ID and Model URL. |
| Agent ID | Backend account ID or CAIP-10 ID. Used when On-chain URI is empty. |
| Chain ID | Paired with a numeric Agent ID. |
| Model URL | Bare GLB for an ad-hoc agent. Used when On-chain URI and Agent ID are both empty. |
| Background | `transparent`, `dark`, or `light`. |
| Framing | `full` or `portrait`. |

## Shortcode

For the classic editor, widgets, or theme templates:

```
[three_ws_agent src="agent://base/42" background="dark" framing="portrait"]
```

`agent_id`, `chain_id`, and `model` are also accepted, matching the block's attributes.

## SRI pin

`includes/pinned-release.php` is generated from [`data/agent-3d-releases.json`](../data/agent-3d-releases.json)
by `npm run build:site-builder-embeds` (the same step that pins the Framer and Webflow
components). The render function enqueues the loader script with `type="module"`, `integrity`,
and `crossorigin` via a `script_loader_tag` filter, since core's enqueue API has no argument for
ESM integrity pins. `npm run check:site-builder-embeds` (wired into `npm run gate`) fails the
build if the plugin's pin drifts from the ledger.

## Verification

Verified against a real local WordPress install in Docker (no mocks), using the official
[Plugin Check](https://wordpress.org/plugins/plugin-check/) plugin from wordpress.org:

```bash
scripts/wordpress-plugin-check.sh
```

Reproduced output from a real run (2026-11-03, WordPress 7.1.4, Plugin Check 2.1.0):

```
[plugin-check] WordPress version: 7.1.4
[plugin-check] activating three-ws-agent...
Success: Activated 1 of 1 plugins.
[plugin-check] installing the official Plugin Check plugin from wordpress.org...
Success: Installed 1 of 1 plugins.
[plugin-check] running wp plugin check three-ws-agent...
Success: Checks complete. No errors found.
[plugin-check] publishing a block page and a shortcode page...
[plugin-check] block renders: <agent-3d body="https://three.ws/avatars/default.glb" background="dark" framing="full" style="display:block;width:100%;height:480px">
[plugin-check] shortcode renders: <agent-3d body="https://three.ws/avatars/default.glb" background="transparent" framing="portrait" style="display:block;width:100%;height:480px">
[plugin-check] pinned loader on both pages: https://three.ws/agent-3d/1.5.2/agent-3d.js (sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q)
```

After Plugin Check, the script publishes one page with the block and one with the
`[three_ws_agent]` shortcode, fetches both over HTTP, and exits non-zero unless each serves a real
`<agent-3d>` element and the loader `<script type="module">` carrying the release URL and SRI hash
from `includes/pinned-release.php`. Set `WP_KEEP=1` to leave WordPress running on
`http://localhost:8089` (override with `WP_PORT`) and open the two pages in a browser: in Chromium
both pages define the `agent-3d` element and mount a live WebGL canvas with no console errors.

## Submitting to the WordPress.org plugin directory

Submission (an upload under an owner-controlled WordPress.org account, and the review queue that
follows it) is an owner action: see
[`marketing/growth/submissions/site-builders.md`](../marketing/growth/submissions/site-builders.md).
