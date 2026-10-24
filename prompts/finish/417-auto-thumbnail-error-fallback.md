# 417. Wire the existing broken-image fallback pattern into the three card renderers that still show the native broken-image glyph

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a UI fix: per CLAUDE.md's Definition of Done, start a dev server and exercise the feature in a real browser before claiming done. Port 3000 belongs to the owner's dev server; run `npx vite --port 3107` instead, and stop it (kill the PID) before ending the turn.
- No mocks, no TODOs, no placeholders, no em-dash/en-dash anywhere you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Out of scope, do not touch: the Cloudflare R2 object-storage outage itself (why thumbnails are currently failing to load) is tracked, owner-gated, at `prompts/finish/_context/production-100-OWNER-ACTIONS.md` Row 36. This order does not fix that outage and does not need it fixed to be worth shipping: a broken-thumbnail fallback is correct behavior for ANY image load failure (dead link, 404, timeout, a future outage), not just this one.

## Step 0: re-derive the current state

Confirm the live image failures are still happening (if they are not, the fix is still worth shipping for the next time an image load fails, since the gap is structural, not a one-off):

    curl -s https://three.ws/api/healthz | python3 -c "import json,sys; d=json.load(sys.stdin); print([s for s in d.get('subsystems', d.get('checks', [])) if s.get('name')=='object_storage'])"

As measured 2026-10-24: `object_storage` is `down`, `detail: "bucket unreachable: Please enable R2 through the Cloudflare Dashboard."`, `credentialFault: true`. This has been continuously down since 2026-09-08 per OWNER-ACTIONS Row 36 (7+ weeks). Also confirmed live the same day: the raw public fallback domain itself now 403s (`curl -sD- -o /dev/null https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/thumb/<any-key>.png` returns `403 Forbidden` from Cloudflare directly), and the same-origin `/cdn/` proxy's own fallback attempt 502s (`curl -sD- -o /dev/null https://three.ws/cdn/thumb/<any-key>.png` returns `502` with header `x-brownout-trace: r2:public-object;o=error;t=0`). **That 502 is correct, intentional, already-tested behavior** on the server: see `tests/cdn-object-storage-failover.test.js` lines 167-174, "502s once the public domain fails too, with no length left pinned to the object." Do not change `api/cdn-object.js`'s fallback chain; it is working as designed for a dual outage.

Confirm the authenticated crawl's scale of the visible symptom (the actual target of this order: what the browser shows the visitor, not the network response):

    grep -c "ERR_BLOCKED_BY_ORB" reports/page-audit-2026-10-24T01-31-13-697Z.md
    grep -c "http-502" reports/page-audit-2026-10-24T01-31-13-697Z.md

As measured 2026-10-24: 547 and 989 occurrences respectively (report `reports/page-audit-2026-10-24T01-31-13-697Z.md`, full authenticated crawl, 1130 routes), concentrated on thumbnail/avatar `<img>` loads across `/`, `/rankings`, `/avatars`, `/gallery`, `/flow`, `/economy`, `/monitor`, `/gallery-picker`, `/launches`. If the report file above no longer exists (reports are not meant to be kept forever), re-run `npm run audit:web:login` and use the fresh report instead; the exact counts are not load-bearing, the pattern is.

Confirm the gap this order targets still exists (grep for the designed fallback markup next to a bare `<img>` with no error wiring):

    grep -n "fleet-av\"\|fleet-av-fb" src/monitor.js
    grep -n "ae-avatar\"\|ae-avatar-fallback\|ae-offer-av" src/economy-live.js
    grep -n "agp-card-thumb\|agp-card-ph" src/avatar-gallery-picker.js
    grep -n "onerror\|addEventListener('error'" src/monitor.js src/economy-live.js src/avatar-gallery-picker.js

As measured 2026-10-24: all three files build a fallback markup string for the "no thumbnail URL at all" case (`.fleet-av-fb`, `.ae-avatar-fallback` / `.ae-offer-av-fallback`, `.agp-card-ph`), but none of them wire an `error` listener on the `<img>` for the "URL present, load failed" case, so a dead thumbnail renders the browser's native broken-image glyph instead of the same fallback the empty case already uses. If any of these three files already has such wiring when you check, drop that file from scope and note it in the report; do not re-wire something already fixed.

## Root cause

Three list/card renderers emit a plain `<img src="${url}">` whenever a thumbnail URL is present, with no `error` handler, even though this exact codebase already has a designed, tested pattern for this (not a new concept): `src/marketplace-gallery.js` lines 868-876 wires `panelImg.addEventListener('error', () => { panelImg.outerHTML = panelFallbackHTML(listing, accent); }, { once: true })` specifically because, per its own comment, "An R2 asset can 403/502 behind a URL that still looked valid when the listing loaded." `src/home-bento.js` line 689 and `src/play-economy.js` line 256 do the equivalent with a plain `img.onerror =` assignment. Those three files are correctly out of scope here (already fixed). The three in scope render their rows as `.map(...).join('')` HTML strings assigned to `.innerHTML`, so there is no single live DOM node to attach a listener to at template-build time the way the already-fixed files do it; that is almost certainly why this got skipped there, not a different design decision.

Call sites in scope:
- `src/monitor.js`: `fleetRow()` (~line 146, `.fleet-av` / `.fleet-av-fb`), the on-air desk list render (~line 232, same classes), the tip-earners list render (~line 315, same classes), and the forge gallery render (~line 506, `<img src="${esc(c.preview_image_url)}">` inside `.forge-cell`, which has **no fallback markup at all** today, bare or wired).
- `src/economy-live.js`: `agentCard()` (~line 119, `.ae-avatar` / `.ae-avatar-fallback`), `offerAvatar()` (~line 344, `.ae-offer-av` / `.ae-offer-av-fallback`).
- `src/avatar-gallery-picker.js`: `_renderCard()` (~line 479, `.agp-card-thumb` / `.agp-card-ph` with `AVATAR_PH_SVG`).

## Task

1. Create `src/shared/thumb-fallback.js`, a small, pure, importable helper (no DOM-library dependency beyond the browser's own DOM API, consistent with every other file in `src/shared/`). It needs exactly two things:
   - A way for a render function to tag an `<img>` with its own fallback markup without needing a live node reference at template-build time, e.g. a `data-thumb-fallback="<escaped HTML>"` attribute (HTML-attribute-escape the fallback markup; reuse whatever `esc`/`escAttr` helper each calling file already imports for this).
   - `wireThumbFallback(root)`: call once, after any container's `innerHTML` is set. Because the DOM `error` event does not bubble, attach the listener on the capture phase (`root.addEventListener('error', handler, true)`) so one call wires every current and future `<img data-thumb-fallback>` inside `root`. On a matching `error` event, swap `event.target.outerHTML` to the element's `data-thumb-fallback` payload, then remove the attribute first so a failure on the fallback's own re-render (if it somehow contains another `<img>`) cannot loop.
   Keep it to this single responsibility. Do not add retry, polling, or any network logic here; a failed load degrades once and stays degraded for that element's lifetime, same as every existing fallback in this codebase.
2. In `src/monitor.js`: give each of the four `<img class="fleet-av" ...>` tags a `data-thumb-fallback` attribute carrying the same markup the empty-URL branch already renders (`<div class="fleet-av-fb" aria-hidden="true">${initial-or-?}</div>`), and call `wireThumbFallback(container)` once per container after its `innerHTML` is assigned (the fleet list body, the on-air desk body, the tip-earners body). For the forge gallery render (~line 506), which has no fallback markup today, add one: a small lettered/icon tile consistent with `.fleet-av-fb`'s styling (reuse that class, or add a `.forge-cell-fb` rule mirroring it in the `<style>` block of `pages/monitor.html` around line 176-179) showing the creation's category initial or a generic glyph, and wire it the same way.
3. In `src/economy-live.js`: do the same for `agentCard()`'s `.ae-avatar` image (fallback: the existing `.ae-avatar-fallback` markup) and `offerAvatar()`'s `.ae-offer-av` image (fallback: the existing `.ae-offer-av-fallback` markup), calling `wireThumbFallback()` once per rendered list/container after insertion.
4. In `src/avatar-gallery-picker.js`: do the same for `_renderCard()`'s `.agp-card-thumb` image, fallback markup `<div class="agp-card-ph">${AVATAR_PH_SVG}</div>` (the same string the no-URL branch already uses), wiring `wireThumbFallback()` on the grid container after cards are appended.
5. Write `tests/thumb-fallback.test.js` (`// @vitest-environment jsdom` pragma, following the pattern in `tests/agent-copilot-ui.test.js`): mount a container, insert two `<img data-thumb-fallback="...">` elements (give them real, resolvable, same-origin, non-existent paths, e.g. `/does-not-exist-<random>.png`, so the browser's own image loader actually fires a real `error` event, not a synthetic dispatch standing in for one) and one plain `<img>` with no `data-thumb-fallback`, call `wireThumbFallback(container)`, wait for the error events, and assert: the two tagged images were replaced by their exact fallback markup, and the untagged image was left alone (still an `<img>`, not swapped, confirming the handler only acts on tagged elements). Also assert a successfully-loading same-origin image (e.g. an existing small static asset) is never swapped.
6. Run `npx vitest run tests/thumb-fallback.test.js` until it passes for real reasons (temporarily remove the capture-phase `true` argument or the attribute removal and confirm the test fails, to prove the assertions are load-bearing, then restore).
7. Run `npm run test:core` in full; confirm no new failures relative to the current baseline (order `401-auto-restore-green-vitest.md` tracks pre-existing failures; this order must not add to that list).

## Done when

- `npx vitest run tests/thumb-fallback.test.js` passes, with the break-then-restore check from step 6 confirmed.
- `grep -n "data-thumb-fallback" src/monitor.js src/economy-live.js src/avatar-gallery-picker.js` shows every avatar/thumbnail `<img>` in the five call sites listed above now carries the attribute, and `grep -n "wireThumbFallback" src/monitor.js src/economy-live.js src/avatar-gallery-picker.js` shows each relevant container is wired.
- `npm run test:core` shows no new failures versus the pre-change baseline.
- Dev server (`npx vite --port 3107`, stopped afterward) used to load `/monitor`, `/economy` (or wherever `economy-live.js` mounts; confirm via `grep -rl "initEconomyLive" pages/ src/*.js`), and the avatar gallery picker in a real browser, while the R2 outage is live: confirm thumbnails that fail to load show the designed fallback glyph (letter/icon tile), not the browser's broken-image icon. This is free, real-world verification against the actual live outage, no simulation needed; note in the report if the outage has resolved by the time you check (R2 re-enabled) and say what you did to verify instead (e.g. temporarily point one card at a deliberately-404ing path).
- `git diff` touches only: `src/shared/thumb-fallback.js` (new), `src/monitor.js`, `src/economy-live.js`, `src/avatar-gallery-picker.js`, `pages/monitor.html` (only if a new `.forge-cell-fb` rule was added), and `tests/thumb-fallback.test.js` (new).
- Committed on `evolve` with an explicit-path commit naming the fix.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` citing the commit SHA.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| The R2 outage (root cause of today's broken thumbnails) is owner-gated and can't be fixed here | This order is about client-side graceful degradation when ANY image load fails, independent of why; it's correct to ship whether R2 is up or down | Do not touch `api/cdn-object.js`, `api/_lib/r2.js`, or any R2 credential/billing config; proceed with the frontend fix regardless of object_storage's current health status |
| `monitor.js` or `economy-live.js` has top-level side effects (auto-fetch, DOM queries against elements assumed present) that make it risky to import directly in a Vitest file | Routine for page-entry modules in this codebase | Test `wireThumbFallback()` itself directly against a hand-built container in `tests/thumb-fallback.test.js` (step 5); that is the actual new logic. Verify the three call sites' wiring by reading the diff and via the real-browser check in the Done-when list, not by importing the whole page module in a unit test |
| Another agent already added error-fallback wiring to one of these three files by the time you run this | Routine for a shared worktree | Re-run the step-0 greps first; drop any file that already has `onerror`/`addEventListener('error'...)` wiring from scope, note it in the report, and proceed with whichever files still lack it |
| The R2 outage has resolved by the time you check, so thumbnails load fine and there's nothing currently broken to look at | The gap is structural (missing error handling), not tied to this specific outage | Verify by deliberately pointing one card's data at a non-existent path during the browser check (per the Done-when note), not by waiting for a new outage |
| Tempted to add retry/polling/exponential backoff to make the image "come back" automatically | Out of scope, and every existing fallback in this codebase (home-bento.js, play-economy.js, marketplace-gallery.js) degrades once and stays degraded; matching that is the correct, minimal fix | Swap to the fallback once per element, per the existing pattern; do not add retry logic |

## Report format

State: the step-0 grep outputs (confirming which of the three files still had the gap when you started), the diff for `src/shared/thumb-fallback.js` and each of the three callers, the test file and its passing output plus the break-then-restore proof, the `npm run test:core` before/after failure counts, the real-browser verification note (what you saw, with or without a live R2 outage), and the commit SHA.
