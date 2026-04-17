# Task: Granular progress UI for the selfie → avatar pipeline

## Context

Repo root: `/workspaces/3D-Agent`. Read [src/CLAUDE.md](../../src/CLAUDE.md) first.

Today the selfie submit button shows "Sending…" while the server does 10–30s of work against the Avaturn API (see [src/selfie-pipeline.js](../../src/selfie-pipeline.js) and [src/selfie-capture.js](../../src/selfie-capture.js)). Users think it's broken and refresh. We want a clear 5-stage progress UI.

## Files you own (exclusive)

- [src/selfie-pipeline.js](../../src/selfie-pipeline.js)
- [src/selfie-capture.js](../../src/selfie-capture.js)

**Do not edit** any `api/` file, any other `src/` file, or add new files outside those two.

## Stages to surface

1. `compressing` — images are being downscaled (usually < 2s).
2. `uploading` — POST to `/api/onboarding/avaturn-session` in flight.
3. `queued` — server accepted, waiting for Avaturn response.
4. `building` — Avaturn is generating (this is where the real time goes).
5. `ready` — session URL received, redirecting to the Avaturn iframe.

Stages 3–4 are inferred client-side from elapsed time because the current backend returns once, not a stream. Use these heuristics:

- After POST returns successfully with a session URL, we jump straight to `ready`.
- If POST is in flight more than 2s, flip label from `uploading` to `queued`.
- If in flight more than 6s, flip to `building`.
- If in flight more than 30s, show a "still working — this occasionally takes up to 60s" note. Do not abort.

If the POST errors, show the error and a _Try again_ button. Never leave the user stuck on a spinner.

## UI requirements

- A progress bar with 5 labelled dots, current stage pulsing.
- Elapsed time (MM:SS) under the bar.
- Cancel button disabled during `compressing`/`uploading` (avoids orphan Avaturn sessions), enabled during `queued`/`building`.
- Cancel aborts the fetch via `AbortController`.
- Use the existing `selfie:*` event names or add `selfie:progress` with `{ stage, elapsedMs }`. If you add a new event, emit it only from `selfie-pipeline.js` and consume it in `selfie-capture.js`.

## Conventions

- Tabs, 4-wide, single quotes, 100-col. ESM.
- No new deps.
- Keep the existing event names (`selfie:submit`, `selfie:error`, etc.) — additive only.

## Out of scope

- Do not change the backend endpoint at `api/onboarding/avaturn-session.js`.
- Do not touch the Avaturn SDK wiring in `src/avatar-creator.js`.
- Do not add progress streaming (SSE / WebSocket) — client-side heuristic only.
- Do not redesign the selfie capture UI — progress panel is an addition, not a replacement.

## Verification

```bash
node --check src/selfie-pipeline.js
node --check src/selfie-capture.js
npx prettier --write src/selfie-pipeline.js src/selfie-capture.js
npm run build
```

Manually: `npm run dev`, take a selfie, confirm stages tick through. Throttle network in DevTools to see the `queued` → `building` transitions.

## Report back

Files edited, commands + output, the exact stage transitions you used, what happens on fetch abort.
