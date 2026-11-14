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

The `<agent-3d>` element is the client of the three.ws agent service, so it loads from three.ws itself (`https://three.ws/agent-3d/<version>/agent-3d.js`) with an `integrity` hash pinned to the exact release this plugin ships against: a swapped file is refused by the browser rather than silently served. No three.ws account or API key is required to render a public agent. Every request the element makes is listed under External services below.

Full attribute reference: https://three.ws/docs/web-component

= Shortcode =

For the classic editor, widgets, or any template that cannot use the block:

`[three_ws_agent src="agent://base/42" background="dark" framing="portrait"]`

`[three_ws_agent model="https://three.ws/avatars/default.glb" height="600px"]`

== External services ==

This plugin embeds the three.ws agent service (https://three.ws). The block and shortcode render nothing until a visitor's browser loads a page that contains them; the plugin itself makes no server-side requests from your WordPress site.

When a page with the block or shortcode is viewed, the visitor's browser connects to three.ws to:

* Load the `<agent-3d>` element from `https://three.ws/agent-3d/<version>/agent-3d.js`, pinned by SRI hash.
* Load the agent's public manifest, its 3D model (GLB), the shared animation manifest and model decoders, and the agent's embed policy. For a bare model URL, the GLB is fetched from whatever URL you entered.
* Only if the visitor chats with the agent: send the typed message (or, with voice turned on, the speech audio) to three.ws to produce the agent's reply.

As with any web request, three.ws receives the visitor's IP address, browser user agent and the page URL that embeds the agent. No cookies are set for anonymous visitors and no tracking or advertising script is loaded.

three.ws Terms of Service: https://three.ws/legal/tos
three.ws Privacy Policy: https://three.ws/legal/privacy

== Installation ==

1. Upload the plugin to the `/wp-content/plugins/` directory, or install it through the WordPress plugin directory.
2. Activate the plugin through the 'Plugins' screen in WordPress.
3. Add the "three.ws Agent" block from the block inserter (category: Embeds), or use the `[three_ws_agent]` shortcode.

== Frequently Asked Questions ==

= Do I need a three.ws account? =

No. A bare model URL or a public agent ID renders with no account and no API key. The requests the element makes to three.ws are listed under External services.

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
