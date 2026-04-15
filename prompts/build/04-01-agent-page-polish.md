# 04-01 — Agent page polish (the "home" of each agent)

## Why it matters

`/agent/:id` is where a shared agent lives. Right now it renders the avatar but the page feels developer-first, not shareable. We want a single clean page that someone receiving the link — cold, no context — understands in 3 seconds: who the agent is, what it can do, and a way to engage.

## Context

- Agent page: [public/agent/index.html](../../public/agent/index.html).
- Agent data: `/api/agents/:id` ([api/agents/[id].js](../../api/agents/[id].js)) returns public fields when not owner.
- Embed variant (no chrome): [public/agent/embed.html](../../public/agent/embed.html). **Don't touch it here** — it's the chrome-less one.
- OG tag endpoint: [api/agent-og.js](../../api/agent-og.js).

## What to build

Edit only [public/agent/index.html](../../public/agent/index.html) and its companion JS. Do not touch the webcomponent, embed.html, or the head OG tags (other prompts own those).

### Layout (desktop)

- Left column: the 3D avatar viewer (existing canvas).
- Right column: identity card.
  - Agent name (h1).
  - Optional description (≤ 280 chars, rendered as plain text — sanitize).
  - Skills list as subtle pill chips.
  - "Powered by 3D Agent" attribution with link to the product home.
  - Owner-only actions section (only visible to the signed-in owner):
    - "Regenerate from photo" → `/dashboard/selfie?replace=<avatar_id>` (see prompt `03-01`).
    - "Change avatar" → scrolls to the dashboard avatar picker (prompt `03-02`).
    - "Copy embed code" button — copies the `<script src="...">` snippet to clipboard.
    - "Edit" link → dashboard.

### Layout (mobile)

- Stacked: avatar on top (min 60vh), identity card below.
- Owner-only actions collapse into a single menu button.

### Shareability

- One-line "Share" control in the identity card: native `navigator.share` on mobile; copy-to-clipboard on desktop. Copies the canonical `/agent/:id` URL.

### Loading state

- While `/api/agents/:id` resolves, show a skeleton with a soft pulsing rectangle where the identity card will be.
- On 404, show a friendly "This agent doesn't exist or was removed" page, not a raw error.

## Out of scope

- Chat UI or live agent responses (covered by host-embed prompts).
- Editing from this page (dashboard owns editing).
- Analytics.
- Custom themes per agent.

## Acceptance

1. Open `/agent/:id` for someone else's agent → see identity card, avatar, skills, attribution. No owner-only actions visible.
2. Open your own → owner-only buttons appear.
3. Copy embed code → clipboard contains the correct `<script>` snippet.
4. On mobile viewport, layout stacks cleanly.
5. Bogus id → friendly 404 page, not a crash.
6. Lighthouse accessibility ≥ 90.
7. No regression: the existing avatar canvas still mounts and renders with memory + actions.
