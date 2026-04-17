# Task: "First meet" flow — name, describe, greet the new avatar

## Context

Repo root: `/workspaces/3D-Agent`. Read [/CLAUDE.md](../../CLAUDE.md) and [src/CLAUDE.md](../../src/CLAUDE.md) first.

After the selfie pipeline produces a GLB and it's saved via `saveRemoteGlbToAccount` in [src/create.js](../../src/create.js), the user lands in the viewer with no identity step. We want a short onboarding: **name your avatar, give it a one-line bio, hear it greet you**. This becomes the user's first emotional moment with their agent.

This task builds a **standalone page** at `/first-meet/?avatar=<id>` so it doesn't interfere with the main app's hash-routing. A later integration step will redirect users here from `saveRemoteGlbToAccount` success.

## Files you own (exclusive — all new)

- `public/first-meet/index.html` — the page shell.
- `public/first-meet/first-meet.js` — the flow logic.
- `public/first-meet/styles.css` — optional; inline styles in HTML are also fine.

**Do not edit** `src/create.js`, `src/app.js`, or the dashboard. The redirect-to-first-meet hook is out of scope.

## Flow

1. **Auth check** — redirect to `/login` if not signed in.
2. **Load the avatar** — `fetch('/api/avatars/<id>')` — show `<model-viewer>` preview.
3. **Step 1: Name.** Single input, autofocus, 2–40 chars, defaults to `My Agent`. Skip button allowed.
4. **Step 2: Bio.** `<textarea>`, 0–280 chars, optional. Placeholder: *"What should people know about this agent?"*.
5. **Step 3: Voice + body type.** Dropdowns. Voice options: `en-US-female`, `en-US-male`, `en-GB-female`, `en-GB-male`. Body type: `feminine`, `masculine`, `neutral`.
6. **Step 4: Greet.** Render the avatar with the built-in `<agent-3d>` element loaded from `/dist-lib/agent-3d.js` (already built by `npm run build:lib`). On mount, call the greet sequence: a wave + an emit of `speak` event saying `Hi — I'm <name>. <bio line or fallback>`. Use browser TTS (the element handles this if `voice=<chosen>` attribute is set).
7. **Step 5: Done.** Two buttons: *Go to my agent* (links to `/agent/<id>`) and *Back to dashboard* (`/dashboard`).

All steps persist progress to `PATCH /api/avatars/<id>` and, if an agent identity exists, to `PATCH /api/agents/<agentId>` for the bio/voice. If no agent exists, call `POST /api/agents` with `{ avatarId, name, bio, voice }` (see [api/agents/index.js](../../api/agents/index.js) for shape).

## Constraints

- No framework. Vanilla JS, one file max for logic, one HTML file for shell.
- Reuse the dashboard's color palette (check [public/dashboard/index.html](../../public/dashboard/index.html) `:root`).
- Use `<model-viewer>` from the existing CDN: `https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js`.
- The `<agent-3d>` element is served from `/dist-lib/agent-3d.js` after `npm run build:lib`. In dev, that path may not exist yet; gracefully fall back to a `<model-viewer>` with no TTS and a plain text greeting bubble.

## Out of scope

- Do NOT auto-redirect users here from the save-avatar flow (that's an integration step).
- Do NOT edit `src/create.js`.
- Do not add authentication logic beyond a simple redirect — reuse the existing `/api/auth/me` pattern.
- Do not write a component library.

## Verification

```bash
node --check public/first-meet/first-meet.js
npx prettier --write public/first-meet/*
npm run build
```

Manually: `npm run dev`, go to `http://localhost:3000/first-meet/?avatar=<id-of-an-existing-avatar>`, walk through the 5 steps.

## Report back

Files created, commands run, what fallback behavior kicks in when `/dist-lib/agent-3d.js` isn't built, what PATCH / POST shapes you actually sent.
