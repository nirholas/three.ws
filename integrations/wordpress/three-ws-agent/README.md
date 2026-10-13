# three.ws Agent (WordPress plugin)

A Gutenberg block (`three-ws/agent-3d`) and a `[three_ws_agent]` shortcode that embed the
[`<agent-3d>`](../../../docs/web-component.md) custom element: a live, animated 3D AI agent in
one script tag. No build step, no npm, no bundler; the editor script is plain ES5-safe JS
against the `wp.*` globals WordPress already ships.

## Layout

| File | Role |
|---|---|
| [`three-ws-agent.php`](three-ws-agent.php) | Plugin bootstrap: headers, requires the four `includes/` files. |
| [`includes/pinned-release.php`](includes/pinned-release.php) | **Generated.** The `<agent-3d>` version, CDN URL and SRI hash this release ships against. Run `npm run build:site-builder-embeds` from the repo root to regenerate after a new `npm run release:lib`. Never edit by hand. |
| [`includes/render.php`](includes/render.php) | `three_ws_agent_render()`: the one function that builds the `<agent-3d>` tag and registers/enqueues the pinned loader script with `type="module"`, `integrity` and `crossorigin`. Shared by the block and the shortcode so both always emit identical markup. |
| [`includes/block.php`](includes/block.php) | Registers `three-ws/agent-3d` from `blocks/agent-3d/block.json` with a server `render_callback`. |
| [`includes/shortcode.php`](includes/shortcode.php) | `[three_ws_agent]`, for the classic editor, widgets and theme templates. |
| [`blocks/agent-3d/`](blocks/agent-3d/) | `block.json` (attributes, supports), `index.js` (editor UI: `InspectorControls` + `ServerSideRender`, so the editor preview is the exact PHP-rendered output), `index.asset.php` (hand-written script-dependency manifest, in place of a `@wordpress/scripts` build), `style.css`. |

## Why `ServerSideRender` instead of a client-side editor preview

The block's `edit()` renders [`ServerSideRender`](https://github.com/WordPress/gutenberg/tree/trunk/packages/server-side-render) pointed at the same block name, which calls `three_ws_agent_block_render()` over the REST API. The editor preview is therefore never a second, divergent implementation of the markup; it is the same PHP the front end runs, which is also why the block has no `save()` markup of its own (`save` returns `null`; the block is always server-rendered).

## SRI pin

`includes/pinned-release.php` is one of three files [`scripts/build-site-builder-embeds.mjs`](../../../scripts/build-site-builder-embeds.mjs) writes from [`data/agent-3d-releases.json`](../../../data/agent-3d-releases.json) (the other two are the Framer and Webflow components' `pinned-release.ts`). `npm run check:site-builder-embeds` fails the build if any of the three has drifted from the ledger; it is wired into `npm run gate`.

## Testing

No PHP dependency beyond WordPress core (no Composer, no PHPUnit scaffold in this plugin). Verified with a real local WordPress install and the official [Plugin Check](https://wordpress.org/plugins/plugin-check/) plugin:

```bash
# from the repo root
scripts/wordpress-plugin-check.sh
```

The script spins up `mysql:8` and `wordpress:php8.2-apache` in Docker, mounts this directory as a plugin, installs and activates Plugin Check via WP-CLI, and runs `wp plugin check three-ws-agent`. See that script for the exact commands; its output is reproduced in [`docs/wordpress-embed.md`](../../../docs/wordpress-embed.md).

## Submitting to the WordPress.org plugin directory

Submission (a third-party upload under an owner-controlled WordPress.org account) is an owner
action: see [`marketing/growth/submissions/site-builders.md`](../../../marketing/growth/submissions/site-builders.md).
