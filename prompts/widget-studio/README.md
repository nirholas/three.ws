# Widget Studio — Build Prompts

A no-code Widget Studio for the three.ws platform. Users pick an avatar, choose a widget type, brand it, and get a stable embed URL tied to their account. No code required — but the generated HTML is always shown and copyable.

## Why these prompts exist

Each file in this directory is a **self-contained prompt** you can paste into a fresh Claude Code chat. Each one fully specifies the goal, the code context to read, the deliverables, the non-goals, and how to verify. A fresh Claude instance should be able to execute a single prompt end-to-end without reading the others.

## Run order

**Sequential (must run first):**

1. [`00-studio-foundation.md`](00-studio-foundation.md) — `/studio` route, widget-type picker, live preview, config schema, persistence API (Neon + R2), `#widget=<id>` URL-param resolver.

**Parallelizable (after 00 is merged):**

2. [`01-turntable-widget.md`](01-turntable-widget.md) — Turntable Showcase widget (hero banner).
3. [`02-animation-gallery-widget.md`](02-animation-gallery-widget.md) — Labeled animation buttons.
4. [`03-talking-agent-widget.md`](03-talking-agent-widget.md) — NichAgent + MCP-powered chat. **The killer widget.**
5. [`04-erc8004-passport-widget.md`](04-erc8004-passport-widget.md) — On-chain identity badge.
6. [`05-hotspot-tour-widget.md`](05-hotspot-tour-widget.md) — Click-to-place hotspots.

**Sequential (after the widgets):**

7. [`06-widgets-dashboard.md`](06-widgets-dashboard.md) — "My Widgets" tab in `/dashboard` (list/edit/delete/duplicate).
8. [`07-embed-docs-and-polish.md`](07-embed-docs-and-polish.md) — Docs page, live example gallery, cross-widget QA, a11y pass.

## How each prompt is structured

```
Goal                — 1-2 sentences. What "done" looks like.
Prerequisites       — what must exist before you start.
Read these first    — 4-8 files with line pointers. Don't skip.
Build this          — detailed spec. Schemas, UI, routes, API contracts.
Do not do this      — scope guard. Prevent accidental feature creep.
Deliverables        — exact files to create or modify.
Acceptance criteria — a checklist you verify before declaring done.
Test plan           — manual steps to exercise the feature.
```

## Ground rules for every prompt

- **Read the target files before writing code.** The codebase has an agent protocol, ERC-8004 integration, MCP server, Avaturn Creator, and R2-backed avatar storage — assumptions from pattern-matching will be wrong.
- **Keep scope tight.** If the prompt says "Turntable only," don't also build the Animation Gallery.
- **Do not introduce new frameworks.** Stack is three.js + dat.gui + vhtml + vanilla DOM + Vite + Vercel serverless + Neon + R2. No React, no TypeScript, no Tailwind.
- **Keep auth on.** Studio routes require a signed-in user. Public widget URLs resolve via `widget_id` without auth.
- **Widget IDs are stable.** Once issued, a `widget_id` never changes its owner, model, or type. Edits update config; they don't re-mint the id.
- **Show the code.** Every Generate modal must include a "Show HTML" disclosure so the user sees the iframe/script snippet they're copying.
- **Mobile-friendly.** The end-user embeds run inside iframes on mobile devices. Controls must work with touch.

## Suggested branching

Each prompt is a PR. Branch names:

```
feat/studio-foundation
feat/widget-turntable
feat/widget-animation-gallery
feat/widget-talking-agent
feat/widget-erc8004-passport
feat/widget-hotspot-tour
feat/widgets-dashboard
feat/widget-docs-and-polish
```

PRs 2–6 all depend on PR 1 being merged. They can otherwise be built in parallel by different sessions.

## Shared vocabulary

| Term               | Meaning                                                                                                  |
| :----------------- | :------------------------------------------------------------------------------------------------------- |
| **Widget**         | A preconfigured, embeddable viewer experience owned by one user account.                                 |
| **Widget Studio**  | The authoring UI at `/studio` where widgets are created and edited.                                      |
| **Widget runtime** | The viewer code that renders a saved widget config inside an iframe.                                     |
| **Widget ID**      | A short URL-safe ID (`wdgt_<12char>`) that resolves to a saved config.                                   |
| **Widget type**    | One of: `turntable`, `animation-gallery`, `talking-agent`, `passport`, `hotspot-tour`.                   |
| **Avatar**         | A glTF/GLB model in the user's R2 account, addressable by `avatar_id`.                                   |
| **Embed config**   | JSON document describing widget state (camera, env, brand colors, type-specific fields). Stored in Neon. |

## After all prompts are done

Ship it. Post about it. Send the demo link to three people. Ask them what they'd pay for.
