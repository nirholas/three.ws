=== three.ws Agent ===
Contributors: threews
Tags: 3d, avatar, ai agent, embed, block
Requires at least: 6.4
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Embed a live, animated three.ws 3D AI agent anywhere in the block editor. No build step, no API key, SRI-pinned to an immutable release.

== Description ==

three.ws builds `<agent-3d>`, a custom HTML element that renders a rigged, animated 3D AI agent in one script tag: a Three.js viewer, voice I/O, an LLM brain, persistent memory and an extensible skill system, all opt-in. This plugin adds a block (and a shortcode for the classic editor) that drops the element into any post, page, or template with no code.

Set one of:

* **On-chain URI** (`src`), e.g. `agent://base/42`
* **Agent ID** (`agentId`, optionally with a `chainId`), a three.ws backend account or a CAIP-10 on-chain ID
* **Model URL** (`modelUrl`), a bare GLB for an ad-hoc agent with no backing account

...then pick a background (transparent, dark, light) and framing (full or portrait).

The loader script is fetched from three.ws's immutable CDN (`https://three.ws/agent-3d/<version>/agent-3d.js`) with a `integrity` hash pinned to the exact release this plugin ships against, so a CDN or MITM swap is refused by the browser rather than silently served. No three.ws account, API key, or outbound request beyond that script and the agent's own GLB/manifest is required to render a public agent.

Full attribute reference: https://three.ws/docs/web-component

= Shortcode =

For the classic editor, widgets, or any template that cannot use the block:

`[three_ws_agent src="agent://base/42" background="dark" framing="portrait"]`

`[three_ws_agent model="https://three.ws/avatars/default.glb" height="600px"]`

== Installation ==

1. Upload the plugin to the `/wp-content/plugins/` directory, or install it through the WordPress plugin directory.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. Add the "three.ws Agent" block from the block inserter (category: Embeds), or use the `[three_ws_agent]` shortcode.

== Frequently Asked Questions ==

= Do I need a three.ws account? =

No. A bare model URL or a public agent ID renders with no account, no API key, and no backend calls beyond the agent's own manifest and GLB.

= Does this load any tracking script? =

No. The only script this plugin enqueues is the `<agent-3d>` loader from three.ws's CDN, pinned by SRI hash to one exact release.

= Can I use this outside the block editor? =

Yes, the `[three_ws_agent]` shortcode renders the identical output and works in the classic editor, widgets, and theme templates via `do_shortcode()`.

== Changelog ==

= 1.0.0 =
* Initial release: block, shortcode, SRI-pinned to agent-3d 1.5.2.

== Upgrade Notice ==

= 1.0.0 =
Initial release.
