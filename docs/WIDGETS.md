# Widgets

Embeddable 3D — a configured, shareable view of an avatar that any site can drop in with one line of HTML.

A widget is a saved bundle of: an avatar (GLB stored in R2), a widget type (turntable, animation gallery, talking agent, ERC-8004 passport, hotspot tour), and brand config (background, accent, caption, controls, camera). Widgets are created in the [Widget Studio](https://3dagent.vercel.app/studio) and shared via short URLs.

---

## Table of Contents

- [Quick start](#quick-start)
- [Widget types](#widget-types)
- [URLs](#urls)
- [Embedding](#embedding)
- [postMessage API](#postmessage-api)
- [OG / oEmbed](#og--oembed)
- [CSP / CORS](#csp--cors)
- [Privacy & analytics](#privacy--analytics)
- [FAQ](#faq)

---

## Quick start

1. Sign in at [3dagent.vercel.app](https://3dagent.vercel.app).
2. Open the [Studio](https://3dagent.vercel.app/studio).
3. Pick an avatar, pick a widget type, tweak brand colors and controls, click **Generate Embed**.
4. Copy the iframe snippet into any HTML page, blog post, Notion doc, or CMS.

---

## Widget types

| Type                | Best for                                             | Default size |
| ------------------- | ---------------------------------------------------- | ------------ |
| `turntable`         | Hero banners, product showcases. Auto-rotate, no UI. | 600 × 600    |
| `animation-gallery` | Showcasing a rigged avatar's animation library.      | 720 × 720    |
| `talking-agent`     | Embodied chat — your agent on your site.             | 420 × 600    |
| `passport`          | On-chain identity card backed by ERC-8004.           | 480 × 560    |
| `hotspot-tour`      | Annotated 3D scenes with clickable POIs.             | 800 × 600    |

---

## URLs

Every widget has three canonical URLs.

| URL                                              | Use it for                                                      |
| ------------------------------------------------ | --------------------------------------------------------------- |
| `https://3dagent.vercel.app/w/<id>`              | Sharing in Slack/Discord/X — server-rendered with rich OG card. |
| `https://3dagent.vercel.app/#widget=<id>`        | The SPA viewer with the widget config applied.                  |
| `https://3dagent.vercel.app/api/widgets/<id>/og` | The 1200×630 preview image.                                     |

`/w/<id>` is the recommended share URL — bots get an OG preview, browsers fall through to the SPA.

### Hash parameters

The viewer supports the following hash params (combine with `&`):

| Param            | Type      | Description                                                |
| ---------------- | --------- | ---------------------------------------------------------- |
| `widget`         | `string`  | Loads a saved widget by id.                                |
| `model`          | `string`  | Loads a raw GLB by URL (mutually exclusive with `widget`). |
| `kiosk`          | `boolean` | Hides the header chrome for clean iframe embeds.           |
| `cameraPosition` | `x,y,z`   | Comma-separated camera position override.                  |
| `preset`         | `string`  | HDR environment preset name.                               |

---

## Embedding

### iframe (recommended)

```html
<iframe
	src="https://3dagent.vercel.app/#widget=wdgt_abc123def456&kiosk=true"
	width="600"
	height="600"
	style="border:0;border-radius:12px;max-width:100%"
	allow="autoplay; xr-spatial-tracking; clipboard-write"
	loading="lazy"
></iframe>
```

**Size guidance:**

- Turntable / hotspot-tour: 1:1 or 4:3 — let the user breathe.
- Animation-gallery: 1:1 or slightly wider — picker docks to the top-right on desktop, bottom on mobile.
- Talking-agent: 7:10 portrait — chat needs vertical space.
- Passport: anything ≥ 360 × 480.

### Animation Gallery specifics

The `animation-gallery` widget renders every skinned clip on the avatar as a keyboard-navigable list.

| Config key       | Type      | Default | Description                                                                          |
| ---------------- | --------- | ------- | ------------------------------------------------------------------------------------ |
| `defaultClip`    | `string`  | `''`    | Clip name to autoplay on mount. Falls back to the first clip if the name is unknown. |
| `loopAll`        | `boolean` | `false` | When true, each clip plays once then advances to the next; wraps to the first.       |
| `showClipPicker` | `boolean` | `true`  | Hide the picker chrome while keeping clip playback driven by `widget:command`.       |

Keyboard: ↑/↓ (or `k`/`j`) to move, Home/End to jump, Enter or Space to (re)play the highlighted clip. The picker pins to the top-right; on narrow viewports it docks to the bottom.

### Script embed

```html
<script async src="https://3dagent.vercel.app/embed.js" data-widget="wdgt_abc123def456"></script>
```

The script injects a sandboxed iframe at the script tag's location and forwards size/postMessage events to the parent. Use this when you want auto-resize behavior; use a raw iframe when you want full control.

### oEmbed (WordPress, Ghost, Notion)

Most CMSes auto-detect oEmbed. Paste a `https://3dagent.vercel.app/w/<id>` URL on its own line and the editor should turn it into a live embed automatically. If not, use the iframe snippet above.

---

## postMessage API

Widgets communicate with the parent page via `window.postMessage`. **Always check `event.origin === 'https://3dagent.vercel.app'` (or your custom domain) before trusting any message.**

### iframe → parent

| Event                 | Payload             | When                                      |
| --------------------- | ------------------- | ----------------------------------------- |
| `widget:ready`        | `{ id, type }`      | Widget runtime has booted.                |
| `widget:load`         | `{ id, model_url }` | Underlying GLB loaded successfully.       |
| `widget:load:error`   | `{ id, error }`     | GLB or config failed to load.             |
| `widget:chat:message` | `{ role, content }` | Talking-agent only — a new chat turn.     |
| `widget:hotspot:open` | `{ id, label }`     | Hotspot-tour only — visitor opened a POI. |
| `widget:resize`       | `{ width, height }` | Widget reports its preferred size.        |

```js
window.addEventListener('message', (e) => {
	if (e.origin !== 'https://3dagent.vercel.app') return;
	if (e.data?.type === 'widget:ready') {
		console.log('Widget mounted:', e.data.id);
	}
});
```

### parent → iframe

| Event            | Payload                                   | Effect                                                 |
| ---------------- | ----------------------------------------- | ------------------------------------------------------ |
| `widget:config`  | `{ background, accent, autoRotate, ... }` | Live-update brand config (used by the Studio preview). |
| `widget:command` | `{ command, args }`                       | Trigger a runtime action (e.g. `play_clip`, `wave`).   |

```js
const iframe = document.querySelector('iframe');
iframe.contentWindow.postMessage(
	{ type: 'widget:config', config: { background: '#ff00aa' } },
	'https://3dagent.vercel.app',
);
```

---

## OG / oEmbed

Every widget URL serves rich-preview metadata.

### Open Graph

`/w/<id>` returns a server-rendered HTML page with:

```html
<meta property="og:title" content="…" />
<meta property="og:description" content="…" />
<meta property="og:image" content="https://3dagent.vercel.app/api/widgets/<id>/og" />
<meta name="twitter:card" content="summary_large_image" />
<link
	rel="alternate"
	type="application/json+oembed"
	href="https://3dagent.vercel.app/api/widgets/oembed?url=…"
/>
```

### oEmbed endpoint

```
GET /api/widgets/oembed?url=<widget-url>&format=json
```

Returns standard [oEmbed v1.0](https://oembed.com) JSON, type `rich`.

```json
{
	"type": "rich",
	"version": "1.0",
	"provider_name": "3D Agent",
	"provider_url": "https://3dagent.vercel.app",
	"title": "…",
	"html": "<iframe …></iframe>",
	"width": 600,
	"height": 600,
	"thumbnail_url": "…",
	"thumbnail_width": 1200,
	"thumbnail_height": 630
}
```

Accepts both `https://host/w/<id>` and `https://host/#widget=<id>` forms. Optional `maxwidth` / `maxheight` clamp the returned iframe dimensions.

---

## CSP / CORS

Widgets run in a sandboxed iframe with these `allow` flags:

- `autoplay` — needed for ambient animations.
- `xr-spatial-tracking` — for future WebXR support.
- `clipboard-write` — passport widget copies its address.

If your site uses a strict Content Security Policy, allow:

```
frame-src https://3dagent.vercel.app;
img-src https://3dagent.vercel.app data:;
```

The widget iframe makes outbound requests to `3dagent.vercel.app` and (for some widgets) to public RPC endpoints / R2 storage CDNs. None of these require parent-side CORS configuration.

---

## Privacy & analytics

We log a minimal first-party event per widget load:

| Field          | Source                                             |
| -------------- | -------------------------------------------------- |
| `widget_id`    | the widget being loaded                            |
| `type`         | the widget type                                    |
| `country`      | Vercel edge header (`x-vercel-ip-country`)         |
| `referer_host` | hostname of the embedding page (no path, no query) |
| `created_at`   | timestamp                                          |

We **do not** log:

- IP addresses
- User agent strings
- Cookies (we don't set any on the embed)
- Chat message content (talking-agent transcripts stay between visitor and agent brain)
- Full URLs (only the host)

The widget owner can see aggregated counts in their [Dashboard](https://3dagent.vercel.app/dashboard). No cross-widget tracking.

---

## FAQ

**Can I self-host?** The runtime is open source. The Studio + saved-widgets API depends on Neon + R2; you'd need to wire those yourself. See [DEPLOYMENT.md](./DEPLOYMENT.md).

**Why no WordPress plugin?** The oEmbed endpoint already does what a plugin would. Paste a `/w/<id>` URL into a Gutenberg paragraph block — done.

**How big is the bundle?** The widget runtime lazy-loads only the code needed for its type. Cold load with a small GLB lands ~400KB JS + the GLB itself. Use `loading="lazy"` on the iframe to defer until scroll.

**Mobile?** Yes — every widget type works on iOS Safari and Android Chrome. Touch controls are first-class. `kiosk=true` is enabled by default in embed mode.

**Can I customize per-page?** Use `postMessage` to send live `widget:config` events from the parent page (e.g. tie the widget background to your site theme).

**What about offline?** The viewer registers a service worker for repeat-visit caching. First load is online-only.

---

## Known issues

- iOS Safari may require a user gesture before `speechSynthesis.getVoices()` returns voices for the talking-agent widget.
- Some browser extensions (uBlock + strict mode) will block the analytics POST. The widget itself still works.
- Embedding inside a parent iframe that's _also_ sandboxed can break WebGL initialization. Add `allow-scripts allow-same-origin` to the parent sandbox.
