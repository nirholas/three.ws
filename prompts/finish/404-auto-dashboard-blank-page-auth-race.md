# 404. Chase the blank-page finding on /dashboard/agents, /dashboard/developers, /dashboard/copy

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Written 2026-10-24 as a deferred finding from [402](402-auto-clear-live-console-errors.md)'s full `npm run audit:web` sweep (`reports/page-audit-2026-10-24T01-31-13-697Z.md`), which was scoped to console errors and could not safely chase this one in the same session.

## Measurement

In the authenticated full sweep, three `/dashboard/*` routes rendered `blank-page` (0 chars of visible text, 0 visible elements, no canvas/iframe/video) and a missing `<title>`: `/dashboard/agents`, `/dashboard/developers`, `/dashboard/copy`. Every sibling `/dashboard/*` route in the same sweep (`avatars`, `irl-placements`, `fleet`, `holders`, `portfolio`, `three-token`) rendered real content under the same session cookie.

All three pages' HTML (`pages/dashboard-next/agents.html`, `developers.html`, `copy.html`) carry a real static `<title>` tag, so the a11y "no title" finding cannot come from the source HTML; something at runtime clears it. All three page modules (`src/dashboard-next/pages/{agents,developers,copy}.js`) call `await requireUser()` from `src/dashboard-next/api.js:105`, same as every working sibling. `requireUser()` on a logged-out session does `location.href = '/login?return=...'; return new Promise(() => {})` (never resolves). The leading hypothesis: this is a timing race where the crawler captured the DOM in the brief window between that `location.href` navigation firing and the new document committing (a real browser transiently has no title and no painted content mid-navigation), not a deterministic bug in these three pages specifically. If true, any dashboard page is capable of showing this, and only these three happened to hit the race in this sweep.

## Task

1. Re-run `/dashboard/agents`, `/dashboard/developers`, `/dashboard/copy` individually with `npm run audit:web -- --routes=/dashboard/agents,/dashboard/developers,/dashboard/copy` (or the script's single-route re-check flag) a handful of times under the same authenticated session used by the full sweep. If they render real content every re-run, this was the transitional-navigation race: write that conclusion into `prompts/finish/_context/production-100-PROGRESS.md` with the before/after re-check evidence, delete this file, no code change needed.
2. If any of the three reproduces blank reliably: open the browser devtools network/console trail for that route's `getMe()` call (`src/dashboard-next/api.js`) and find why it 401s on this route specifically when the identical cookie succeeds on a sibling route in the same session. Likely candidates: a route-specific API call earlier in the module's top-level `(async function boot())` that throws before the `catch`'s `ApiError` check can run (re-read each file's full `boot()` for anything awaited before `requireUser()`), or a response-shape difference in `getMe()` across routes.
3. Fix the root cause so the page never silently blanks: either the real auth bug, or (if it is a generic risk every `requireUser()` caller shares) make the redirect path paint a minimal "redirecting to sign in..." state with its own `<title>` before `location.href` fires, so a slow navigation never presents a fully blank, title-less document to a user or a crawler.

## Done when

Either (a) the race is confirmed non-reproducible and this file is retired with that evidence, or (b) a real fix lands, is covered by re-running the three routes clean, `npm run check:rules -- --paths <files touched>` exits 0, and this file is retired with the commit SHA in `prompts/finish/_context/production-100-PROGRESS.md`.
