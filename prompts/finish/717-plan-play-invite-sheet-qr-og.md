# An invite sheet in /play with the canonical world link, live QR and share, backed by a verified OG unfurl card

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/717-plan-play-invite-sheet-qr-og.md`.

**Priority:** P2, new capability with clear value (score 57 of 100 inside the tier). **Area:** play. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

Everyone at the event arrives through one link, and the cheapest growth is the player who pulls in one more person. Today a player has no way to invite from inside the world: no invite control exists in the HUD, no QR, and nobody has verified that the canonical $THREE link unfurls well when pasted into X, Telegram or Discord. The deep-link contract and the OG endpoint exist, so this is a focused UI plus a verification pass.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Deep-link contract: `coinWorldUrl()` in `src/fits-lib.js` (tested in `tests/fits-lib.test.js`); canonical URL emission in `src/game/coincommunities.js` (`history.replaceState` in `enter()` keeps `coin`, `name`, `symbol`, `image`, `tier`, `ui`; short links resolve identity through `_fetchCoinIdentity` first).
- OG image: `api/play-og.js` (GET only, self-call coin lookup via `api/_lib/self-origin.js`). House OG patterns: `api/page-og.js`, `api/og-leaderboard.js`.
- `qrcode` ^1.5.4 is already a dependency (`package.json`), rendered in `src/wallet-deposit.js`, `src/marketplace.js` and `director-mode.js` (`import('qrcode')`).
- `src/game/friends-panel.js` invites are social-graph friend requests, a different feature; do not conflate.
- There is no invite control in `src/game/coincommunities-ui.js` (no `navigator.share` or invite sheet there) and no test of the OG card for the canonical $THREE URL.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "navigator.share\|invite" src/game/coincommunities-ui.js | head
grep -rn "play-og" api src pages --include=*.js --include=*.html | head
curl -s -o /tmp/play-og-three.png -w "%{http_code} %{content_type} %{size_download}\n" "https://three.ws/api/play-og?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three"
curl -s "https://three.ws/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three" | grep -o '<meta property="og:[^>]*>' | head
cat public/event.json
```

View the saved PNG with the Read tool and judge it before changing the endpoint.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test first for the pure parts. Add `tests/play-invite.test.js`: the invite URL builder always carries `coin`, `name`, `symbol`, `image` and never leaks session or auth params; for an event window the sheet model leads with the event name and a countdown string, outside it does not. Add `tests/play-og.test.js` (beside existing OG tests if present) asserting `api/play-og.js` returns 200 `image/png` for the $THREE URL, refuses non-GET, and returns a designed fallback image (not an error) when the coin image fetch fails.
2. Build `src/game/invite-sheet.js` and mount an Invite control in the HUD (`src/game/coincommunities-ui.js`) plus a lobby-card action. The sheet shows the canonical link with a Copy button (toast on success, selectable fallback if clipboard is denied), a QR rendered with the existing `qrcode` dependency (lazy `import('qrcode')`, error correction high enough to scan from a projector), and `navigator.share` when available. Inside the `public/event.json` window it leads with the event name and countdown (`src/shared/event-config.js`).
3. States: hover, focus-visible and active on every control, focus trap and Escape to close, keyboard operable, skeleton while the QR renders, designed error when QR generation fails (still shows the link), text via the i18n layer, usable at 400px width. Run `npm run audit:states` and `npm run audit:motion-tokens` over the changed CSS.
4. OG card truth. Paste-test the canonical $THREE URL against the real unfurlers you can reach (the X card validator is not scriptable; use the OG meta tags plus a rendered image check, and the Telegram and Discord crawlers' user agents via curl). The card must show the coin image, name, symbol and a line that sells the world. If `api/play-og.js` renders stale or generic art, fix it: composite the real coin image via the `/api/img` proxy with a designed fallback when IPFS fails; add live facts (online count) only if it does not slow the card. Save a rendered sample for the report.
5. Arrival continuity. On a fresh profile, open the invite link: intro suppressed (a `coin` param already does this), onboarding shown once, and the concierge greeting if it exists in the codebase. Fix any dead end found.
6. Browser verification on `npm run dev`: sheet on desktop and emulated mobile, QR decoded by a real decoder (for example `npx -y jsqr` against a screenshot, or a phone camera) to the exact canonical URL, copy toast, console clean.
7. Docs: add the invite flow to `docs/play-live-events.md`, a `data/changelog.json` entry, and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/play-invite.test.js tests/play-og.test.js` passes.
- [ ] A decoded screenshot of the QR equals the canonical `coinWorldUrl()` for $THREE (command and output in the report).
- [ ] `curl` of the OG endpoint for the $THREE URL returns 200 `image/png`, and the same call with a broken `image` param still returns a valid designed card.
- [ ] Browser: copy, share fallback and Escape-to-close work; no console errors.
- [ ] `npm run audit:states` and `npm run audit:motion-tokens` pass.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No physical phone to scan | Decode the rendered QR in a headless browser screenshot with a JS QR decoder and assert the URL string. |
| Social unfurl tools not scriptable | Assert the meta tags and image response directly; state which external validator was not run. |
| IPFS gateway down while testing the fallback | That is the test case: force the failure with an unreachable `image` URL and verify the fallback card. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/717-plan-play-invite-sheet-qr-og.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `717-plan-play-invite-sheet-qr-og.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/event-readiness/16-invite-flow.md` (whole file)

~~~~markdown
# Feature 16: invite flow (deep link, QR, OG card) for the event

Everyone at the event arrives through one link, and everyone who has fun should be able to pull one more person in. Make inviting effortless from inside the world, and make the link unfurl beautifully everywhere it is pasted.

## Where the code lives

- Deep-link contract: `coinWorldUrl()` in `src/fits-lib.js` (tested in `tests/fits-lib.test.js`); canonical URL emission in `src/game/coincommunities.js` (`history.replaceState` in `enter()`, which keeps exactly `coin`, `name`, `symbol`, `image`, `tier` for a holders world, and `ui`; any link that arrives short of a full identity, including a complete share link since it carries no market cap, resolves name, symbol, image and market cap through `_fetchCoinIdentity` before the rewrite, so the canonical link is always complete)
- OG image for /play links: `api/play-og.js` (GET-only since the fleet hardening pass; any other verb is refused before the satori render). Its coin lookup is a self-call on the configured origin from `api/_lib/self-origin.js`, never the request's `host` or `x-forwarded-host`; outside production a loopback host is honored, so hitting the endpoint on `npm run dev` renders against the local server. House OG patterns: `api/page-og.js`, `api/og-leaderboard.js`
- HUD mount + share precedent: `src/game/coincommunities-ui.js` and the build-share sheet. Do not confuse this with the friend invites in `src/game/friends-panel.js`, which are a social-graph request, not a world link
- QR: `qrcode` is already a dependency (`src/wallet-deposit.js` and `src/marketplace.js` render with it); use it, no new encoder

## What to build

1. **Invite button.** A HUD control (and lobby-card action) opening a small invite sheet: the canonical world link with copy button, a live QR code of that link (event hosts will show phones to each other), and `navigator.share` where available. The link always carries `coin`, `name`, `symbol`, `image` so the destination renders identity instantly, before any API round-trip.
2. **OG card truth.** Paste-test the canonical $THREE URL: the unfurl must show the coin image, name, symbol, and a line that sells the world. If `api/play-og.js` renders stale or generic art, fix it: it should composite the real coin image (via the `/api/img` proxy, with a designed fallback when IPFS fails) and live-ish facts if cheap (online count is a nice touch only if it does not slow the card).
3. **Arrival continuity.** An invitee landing from the link skips straight into the flow a first-timer needs: intro suppressed (a `coin` param already does this), onboarding shown once, and if Feature 14 landed the concierge greets them. Verify the whole arrival path on a fresh profile.
4. **Event framing.** During the event window (`public/event.json`), the invite sheet leads with the event name and countdown, so the share reads as an invitation to a happening, not just a link.

## Verify

- `npm run dev`: invite sheet on desktop and emulated mobile; QR scans from a real phone camera to the right URL; copy toast; share sheet on mobile.
- OG card rendered locally (hit the endpoint directly) and correct for the $THREE canonical URL, including the IPFS-failure fallback.
- `npm test` green.

## Report format

Files shipped, any dependency added (name, weekly downloads, license, why), a rendered OG card sample path, and the `data/changelog.json` entry.
~~~~

