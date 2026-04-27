# Task 07 — Widget metadata: OG card + oEmbed + link preview polish

## Why this exists

When a freshly-published widget URL (`/w/wdgt_abc123`) gets pasted into Slack, Discord, X, iMessage, WordPress, Ghost, Notion, or SperaxOS chat, it should unfurl into a rich card with a thumbnail of the avatar and the widget's name. The infrastructure exists ([api/widgets/og.js](../../api/widgets/og.js), [api/widgets/oembed.js](../../api/widgets/oembed.js), the `/w/:id` page); this task verifies it works end-to-end for widgets created by the drop-edit-embed flow, and closes the gaps you find.

This runs in parallel with 01–06. It's verification + targeted polish, not new construction.

## Shared context

- `/w/:id` is served by [api/widgets/page.js](../../api/widgets/page.js) (read it). It should render a full HTML shell with:
    - `<title>` and `<meta name="description">` from `widget.name` / description
    - `og:image` → `/api/widgets/:id/og`
    - `og:url` → canonical `/w/:id`
    - `twitter:card`, `twitter:image`
    - `<link rel="alternate" type="application/json+oembed" href="/api/widgets/oembed?url=<encoded>">`
    - An `<iframe>` or direct `<agent-3d>` that renders the avatar
- [api/widgets/og.js](../../api/widgets/og.js) generates the preview image. Read it and determine:
    - Does it 302 to the avatar's `thumbnail_url` when one exists?
    - Does it generate a fallback SVG/PNG when there's no thumbnail? (New avatars from this flow won't have a thumbnail until we build thumbnail generation — out of scope here.)
- [api/widgets/oembed.js](../../api/widgets/oembed.js) — verify it returns `type: 'rich'`, `html: '<iframe …>'`, `provider_name`, `thumbnail_url`, `width`/`height`.

## What to build

### 1. Audit first

Read and record in your reporting block:

- What exact meta tags does `api/widgets/page.js` emit today?
- What exact JSON does `api/widgets/oembed.js` return today?
- What happens in `api/widgets/og.js` when `avatar.thumbnail_url` is null? (Newly-published widgets from tasks 01–05 will have null thumbnails.)

### 2. Fallback OG image for newly-published widgets

For widgets with no avatar thumbnail:

- Render a server-side SVG (served as `image/svg+xml`) with:
    - Dark background `#0b0d10`.
    - Widget name in large text (truncate at ~40 chars).
    - A small `◎` glyph (match the `three.ws` brand — same glyph used in the Widget Studio type-picker).
    - Dimensions `1200x630` (Open Graph sweet spot).
- Slack, Discord, X, and iMessage accept SVG for OG. WordPress sometimes strips SVG — acceptable trade-off; note it.
- Cache header: `public, max-age=3600, s-maxage=86400`.
- Do NOT add any image-processing dependency. No `sharp`, no canvas.

This may already exist — if it does, leave it alone and move on. Do not rewrite for style.

### 3. oEmbed payload sanity

Verify the oEmbed endpoint returns, at minimum:

```json
{
	"type": "rich",
	"version": "1.0",
	"provider_name": "three.ws",
	"provider_url": "https://three.ws/",
	"title": "<widget.name>",
	"html": "<iframe src=\"https://three.ws/w/<id>\" width=\"600\" height=\"600\" frameborder=\"0\" allow=\"autoplay; fullscreen\" allowfullscreen></iframe>",
	"width": 600,
	"height": 600,
	"thumbnail_url": "https://three.ws/api/widgets/<id>/og",
	"thumbnail_width": 1200,
	"thumbnail_height": 630,
	"author_name": "<widget owner display name or empty>",
	"cache_age": 900
}
```

Add whichever of these are missing. Support `?format=xml` returning oEmbed XML — one-liner using tagged string.

### 4. Link-preview bot allow-list

Ensure the `/w/:id` page (and `/api/widgets/:id/og`) return a 200 for unauthenticated, no-cookie requests — Slackbot, Twitterbot, Discordbot, LinkedInBot etc. will never have your session. If the endpoint today requires auth even for public widgets, fix it (public widgets should be publicly readable by design).

**Do not** add a bot-user-agent sniffing layer. Public widgets are public; no user-agent magic.

### 5. Privacy: private widgets should NOT leak on unfurl

If `widget.is_public === false`:

- `/w/:id` returns 200 with a minimal shell and an `og:image` that says "Private widget." Do not include any title, description, or metadata about the underlying avatar.
- `oembed` returns 404.
- `og.js` returns the "Private" SVG fallback.

The drop-edit-embed flow defaults to `is_public: true` (task 02), so this is a safety net for users who later flip privacy from the Studio.

## Files you own

- Edit: [api/widgets/page.js](../../api/widgets/page.js) — meta tags, privacy branch.
- Edit: [api/widgets/og.js](../../api/widgets/og.js) — null-thumbnail fallback, privacy branch.
- Edit: [api/widgets/oembed.js](../../api/widgets/oembed.js) — completeness, XML support, privacy 404.

## Files off-limits

- `api/widgets/index.js`, `api/widgets/[id].js`, `api/widgets/view.js`, `api/widgets/[id]/*` — not in this task.
- `src/editor/*`, `src/app.js` — not in this task.
- `public/widgets-gallery/*`, `public/studio/*` — not in this task.

## Acceptance

- Publish a new widget via tasks 01–05 flow → copy `/w/<id>`.
- Paste in Slack, Discord, and X DMs (use real accounts or the bot-test tools below) → all three unfurl with a thumbnail + title.
    - Slack debug: https://api.slack.com/reflection/tools/link-checker (or paste into a private channel)
    - X debug: https://cards-dev.twitter.com/validator (deprecated but still works for some)
    - Discord: just paste it; expect the same unfurl.
    - Facebook sharing debugger: https://developers.facebook.com/tools/debug/ (also checks OG).
- Paste in Notion → auto-embeds as iframe via oEmbed.
- `curl -s https://<host>/api/widgets/oembed?url=https://<host>/w/<id>` returns the JSON above.
- `curl -sI https://<host>/api/widgets/<id>/og` returns 200 with an `image/*` content-type.
- Flip the widget to `is_public: false` via Studio → re-paste URL → preview says "Private widget," no avatar leak.

## Reporting

Use the template in [00-README.md](./00-README.md). Include the results of each `curl` and at least two screenshot URLs of unfurls (can describe textually if you can't attach images).
