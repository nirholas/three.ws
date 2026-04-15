# Prompt 07 — Embed Docs, Example Gallery, and Polish

**Branch:** `feat/widget-docs-and-polish`
**Depends on:** Prompts 00–06 all merged.
**Parallel with:** nothing — this is the final pass.

## Goal

Turn the Widget Studio into something people want to use: a public `/widgets` gallery that showcases each widget type with a real embedded demo, a developer-focused `/docs/widgets` page with copy-pasteable snippets, OG/oEmbed support on every widget URL, cross-widget QA, a11y pass, and a homepage nudge pointing visitors to the Studio.

This prompt is where the project stops feeling like a developer tool and starts feeling like a product. Treat it with care.

## Prerequisites

- All five widget prompts (01–05) merged and working.
- Dashboard (Prompt 06) merged.

## Read these first

| File | Why |
|:---|:---|
| All `src/widgets/*.js` files | Confirm every widget mounts cleanly and exposes a consistent `mount(...)` / `destroy()` contract. |
| [features.html](../../features.html) and [style.css](../../style.css) | Reference for the visual system. Match it. |
| [vercel.json](../../vercel.json) | You will add new public routes. |
| [api/agent-oembed.js](../../api/agent-oembed.js) and [api/agent-og.js](../../api/agent-og.js) | Pattern for OG/oEmbed endpoints. |
| [scripts/](../../scripts/) | Existing build-time scripts for icons, animations. If the gallery needs prebuilt poster images, mirror this pattern. |
| [docs/](../../docs/) | Existing developer docs. Follow the tone. |

## Build this

### 1. Example gallery at `/widgets`

Create `public/widgets-gallery/index.html` (route at `/widgets`). A public page with:

- **Hero:** "Embeddable 3D, no code." One-line pitch, CTA: "Create yours in the Studio".
- **Five type sections** — each renders a real, working widget URL in an iframe, shows its config, and provides the snippet to copy. Use a handful of showcase widgets (create them on a demo account and hardcode their widget IDs — store IDs in a small JSON config at `public/widgets-gallery/showcase.json` so they can be updated without code changes).
- **Call-to-action:** "Create yours — it's free" linking to `/studio` (or `/login?return=/studio`).

Layout each section:

```
┌──────────────────────────────────────────────┐
│ Turntable Showcase                           │
│ Hero banner for sites — auto-rotate, no UI.  │
│                                              │
│ [live iframe demo 600x600]                   │
│                                              │
│ <iframe src="..." width="600" height="600"/> │
│ [Copy] [Open in Studio template]             │
└──────────────────────────────────────────────┘
```

"Open in Studio template" clones the showcase widget into the user's account (uses Prompt 06's duplicate endpoint if the widget is public to duplicate; otherwise uses a new server-side "template" flag — pick the simpler path).

### 2. Developer docs at `/docs/widgets`

Create `docs/WIDGETS.md` in the repo and link it from the README. Also create a rendered page at `public/docs-widgets.html` with the same content (or rewrite the route to serve the markdown via a minimal renderer — whichever is consistent with how `docs/` is served today).

Sections:

- **Overview** — what widgets are.
- **URL params** — `#widget=<id>` and related.
- **iframe embed** — snippet + size recommendations.
- **Script embed** — `embed.js` snippet + what it does.
- **postMessage API** — parent-to-iframe and iframe-to-parent events the widgets emit:
  - `widget:ready` (iframe → parent)
  - `widget:load` / `widget:load:error`
  - `widget:chat:message` (talking-agent only)
  - `widget:hotspot:open` (hotspot-tour only)
- **CSP / CORS** — what sites need to allow (usually nothing, but document if your embed requires `allow="..."`).
- **Privacy** — visitor data, rate limits, what's logged.
- **FAQ** — why no WordPress plugin, can I self-host, etc.

### 3. OG + oEmbed on every widget

For each widget type, extend the OG/oEmbed endpoints so:

- **OG image** (`/api/widgets/:id/og`) returns a rendered PNG or SVG preview — title + avatar thumbnail + type badge. Use a server-side image library if one is already in deps (`sharp` is in devDependencies — check if it's available at runtime on Vercel; if not, use SVG since Slack/Discord/X will render it). Reasonable output: 1200x630.
- **OG tags** (in the widget page's HTML head when resolving `#widget=`): Open Graph + Twitter card tags. The `index.html` SPA shell needs to set these dynamically — since hash params aren't available server-side, either use a pre-render crawler check (user-agent detection for social bots; redirect them to a server-rendered metadata page) OR move the widget resolution upstream so `/widget/:id` (path, not hash) is the canonical URL.
  - **Recommendation:** add a second canonical URL pattern: `https://host/w/<id>` that's server-rendered with proper meta tags and client-redirects to `#widget=<id>` for regular browsers. Social crawlers see the meta. Regular users hit the SPA. Update Studio's share UI to prefer `/w/<id>`.
- **oEmbed** (`/api/widgets/:id/oembed`): returns the standard oEmbed JSON so WordPress, Ghost, and Notion auto-embed pasted widget URLs. Type = `rich`, `html` = an iframe snippet.

Add `<link rel="alternate" type="application/json+oembed" href="...">` to the widget HTML head.

### 4. Homepage nudge

The main viewer page is currently purely a viewer. After this prompt:

- Add a subtle "Make this a widget" button in the header (visible when a model is loaded). Clicking opens Studio with that model preloaded.
- Add a small "Widgets" link in the nav pointing to `/widgets`.

Do not redesign the homepage. One button, one link.

### 5. Cross-widget QA

Run through each widget type on each browser/device:

| | Chrome desktop | Safari desktop | Firefox desktop | iOS Safari | Android Chrome |
|:---|:-:|:-:|:-:|:-:|:-:|
| Turntable | | | | | |
| Animation Gallery | | | | | |
| Talking Agent | | | | | |
| Passport | | | | | |
| Hotspot Tour | | | | | |

Fix any browser-specific bugs found. Common ones:
- iOS Safari autoplay restrictions on animation clips.
- Safari `speechSynthesis.getVoices()` returning empty until a user gesture.
- Chrome/iOS intersection observer quirks on nested iframes.

### 6. a11y audit

Run `axe` (via `@axe-core/cli` — add as devDep if needed) on:

- `/studio`
- `/widgets` gallery
- Each widget type in public mode
- `/dashboard` widgets tab

Fix every critical and serious violation. Document any known issues in `docs/WIDGETS.md`.

Key checks:
- Color contrast ≥ 4.5:1 for text.
- All interactive elements keyboard-reachable.
- ARIA labels on icon-only buttons.
- `prefers-reduced-motion` respected everywhere.
- Focus visible on all interactive controls.
- Screen reader announces widget state changes (SPEAK, animation changes, hotspot open).

### 7. Performance pass

- Lighthouse performance ≥ 80 on each widget type, mobile emulation.
- First contentful paint < 2s on a cold load with a small GLB.
- Bundle budget: the public widget JS (non-Studio, non-dashboard) should lazy-load only the widget runtime needed for its type. Dynamic imports from Prompt 01 onward should already do this; verify.
- Preload hints for the GLB URL and the HDR env map.

### 8. Error boundaries

Every widget runtime must handle:

- Widget not found (404 from GET) → clear error page, not a crash.
- Avatar deleted / model URL 404 → "Model unavailable" in the widget frame.
- Rate limit exceeded (talking-agent) → polite message.
- RPC failure (passport) → cached data + "last verified" label.
- LLM brain failure (talking-agent) → "Having trouble reaching the brain. Try again in a moment."

### 9. Analytics (respecting privacy)

Add a minimal, first-party analytics log:

- Each widget load: `widget_id`, `type`, country (from Vercel edge headers, not IP), referer host only (not full URL), timestamp.
- Aggregate into `widget_views_daily` table or use `widget_views` from Prompt 06.
- No cookies. No tracking across widgets. No user identifiers.
- Document this in the docs page and in the Studio's "Generate Embed" modal ("By sharing a widget, you agree visitors' anonymous load events will be logged for your analytics.").

### 10. README update

Update the main `README.md` with:

- A new section near the top: "Widget Studio — make any avatar embeddable."
- Link to `/widgets` gallery and `/studio`.
- Update the roadmap section to strike through the shipped items.

## Do not do this

- Do not rewrite the homepage. Two additions only.
- Do not add tracking cookies.
- Do not log chat message content in analytics.
- Do not ship the gallery with broken showcase widgets. Verify each one loads cleanly in incognito before merging.
- Do not add a new design system or rebrand. Match existing styles.
- Do not introduce a documentation SSG. Plain HTML/markdown is fine.

## Deliverables

**New:**
- `public/widgets-gallery/index.html`
- `public/widgets-gallery/gallery.js`
- `public/widgets-gallery/showcase.json`
- `docs/WIDGETS.md`
- `public/docs-widgets.html` (if serving HTML)
- `api/widgets/[id]/og.js` — if not built in Prompt 03, build here.
- `api/widgets/[id]/oembed.js` — same.
- `public/w/[id].html` + route rewrite for server-rendered metadata page.

**Modified:**
- `vercel.json` — new routes (`/widgets`, `/w/:id`, `/docs/widgets`, og/oembed endpoints).
- `README.md` — Widget Studio section + roadmap updates.
- `index.html` — "Make this a widget" button + Widgets nav link.
- Widget runtimes — add error boundaries if missing.
- `src/app.js` — resolve `/w/:id` path to the same widget-load flow as `#widget=`.

## Acceptance criteria

- [ ] `/widgets` gallery renders with 5 working embedded demos.
- [ ] Each demo has a copy-paste iframe snippet that works when pasted in a blank HTML file.
- [ ] `/docs/widgets` page covers all types, URL params, postMessage API, CSP notes.
- [ ] `/w/<id>` server-renders correct OG tags — pasting into Slack shows a rich card.
- [ ] oEmbed auto-embed works in WordPress or Ghost (verify by pasting into a test instance).
- [ ] All five widget types pass a11y audit (no critical/serious violations).
- [ ] Lighthouse performance ≥ 80 on each widget type.
- [ ] All error boundaries trigger correctly when simulated.
- [ ] Homepage has "Make this a widget" button and "Widgets" nav link.
- [ ] README has a prominent Widget Studio section.
- [ ] Analytics logs load events (verify via DB query after loading a widget).
- [ ] No console errors anywhere.
- [ ] `npm run build` succeeds, final bundle reports are reasonable.

## Test plan

1. **Gallery smoke test:** open `/widgets` in incognito. Every section renders. Every embed works. Every "Copy iframe" paste into a blank HTML file renders.
2. **OG test:** share `https://<host>/w/<id>` in Slack and Discord. Rich card with image appears.
3. **oEmbed test:** paste the same URL into WordPress or Ghost. Auto-embeds.
4. **Docs test:** walk through `/docs/widgets`. Every code snippet works when copy-pasted.
5. **Browser matrix:** run through the cross-browser matrix. Any failures — fix or document as known issue with a workaround.
6. **a11y:** run `axe-cli` and Lighthouse a11y on each widget type URL and on Studio/Dashboard. Fix violations.
7. **Perf:** run Lighthouse perf mobile on each widget. Tune preload hints if FCP > 2s.
8. **Error simulation:**
   - Delete an avatar → load its widget → "Model unavailable."
   - Revoke a Talking Agent's brain endpoint → "Can't reach brain."
   - Point a Passport at a non-existent tokenId → "Agent not found."
   - Hit Talking Agent rate limit → polite message.
9. **Analytics:** load 3 widgets, query DB, confirm view rows with correct metadata.
10. **Full flow, fresh user:** sign up → go to viewer → load model → "Make this a widget" → lands in Studio → picks turntable → saves → shares → works in incognito. No friction.

## When you finish

- PR with:
  - Screenshots of `/widgets` gallery and one OG card.
  - Lighthouse scores for each widget type.
  - A short paragraph for the project's social post.
- Then: ship it. Post about it. Send the demo link to 3 real people. Ask what they'd pay for.
