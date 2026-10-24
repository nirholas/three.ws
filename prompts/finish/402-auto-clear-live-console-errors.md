# 402. Clear console errors on three.ws's highest-traffic live pages

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate. Written by the evolve scout lane on 2026-10-24 from a fresh unauthenticated live-page sweep of production.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that references a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them; it edits frontend/API source in this worktree only. Fixes land here as commits; the owner's next deploy ships them, exactly like every other prepared fix in this queue.
- No mocks, no fake data, no unfinished-work markers, no commented-out code.
- The em-dash and en-dash characters are banned in everything you write.
- Stage explicit paths only (never `git add -A` or `git add .`); re-check `git status` and `git diff --staged` before each commit.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- Bug fixes are test-first (CLAUDE.md): where a fix changes runtime behavior and the repo has a test file for that module, add or extend a test that reproduces the console error's root cause, confirm it fails first, fix, confirm it passes. Where the root cause is purely in a page's own inline script with no existing test harness for it, say so and fix directly; do not invent a new test framework for one page.

## Why this matters (measured 2026-10-24, unauthenticated sweep against `https://three.ws`)

`npm run audit:web` (`scripts/page-audit.mjs`) drives a real headless Chromium through every route in `data/pages.json` and records console errors, uncaught exceptions, and failed requests. A full sweep covers 980 routes across desktop and mobile and takes over an hour, so this order's own measurement is a partial desktop-viewport pass (stopped early, about 160 of 980 routes, to hand off promptly): it already surfaced 20 live pages throwing real browser console errors, several of them severe:

    🔴 /gallery (93e/0w)
    🔴 /monitor (84e/0w)
    🔴 /marketplace (58e/2w)
    🔴 /agents-live (52e/0w)
    🔴 /drive (48e/2w)
    🔴 /feed (38e/0w)
    🔴 /forge-studio (36e/0w)
    🔴 /characters (24e/0w)
    🔴 /artifact (24e/0w)
    🔴 /alpha-copilot (20e/0w)
    🔴 /classic (16e/0w)
    🔴 /community (14e/0w)
    🔴 /forged (12e/0w)
    🔴 / (12e/0w)            ← the homepage itself
    🔴 /cad (7e/0w)
    🔴 /grok (6e/6w)
    🔴 /import/vroid (2e/0w)
    🔴 /discord-activity (2e/0w)
    🔴 /apps/shopify (2e/0w)
    🔴 /crawl (1e/0w)

This is a live production defect, which the RUN-ORDER rule ranks above every unshipped fix and every new feature in this queue. The homepage carrying 12 real console errors is the single highest-leverage item in `prompts/finish/` right now: it is the first thing every new visitor's browser executes.

The script itself distrusts its own parallel-sweep counts (see its header comment: on 2026-07-28, 108 of 131 reported errors turned out to be contention artifacts of running 5 pages at once) and re-verifies every error-severity finding solo, one page at a time, before writing the final report. Treat the numbers above as strong candidates, not as confirmed root causes: the pattern (many of the worst offenders are the heaviest WebGL/Three.js pages: gallery, monitor, agents-live, drive, forge-studio, characters, artifact, classic, cad) suggests a shared root cause in a 3D/rendering dependency rather than 20 unrelated bugs, which is exactly the kind of fix that is worth finding first, since it would clear most of this list in one commit.

## Step 0: re-derive the current state

    npm run audit:web > /tmp/audit-web-$(date +%s).log 2>&1 &
    # takes 60-90+ minutes for the full 980-route x 2-viewport sweep; let it run in the
    # background and keep working. It writes reports/page-audit-<timestamp>.{json,md}
    # when done, with exact error text and a screenshot per offending route, already
    # solo-reverified.
    curl -s https://three.ws/api/version
    git log --oneline -10 -- public/ src/

While that runs, start on the homepage (`/`) directly, since it needs no report to justify fixing: open it in a real browser (or `npx playwright test` style script) with devtools console open, or grep its page module under `src/`/`public/` for obvious causes (a removed export still imported, a null dereference on a DOM node that does not exist on first paint, an API call with no response guard).

## Tasks

1. **Homepage first (`/`, 12 errors).** This is production's front door. Reproduce locally: serve the built frontend (`npm run dev` or the production build, whichever the repo's existing manual QA docs call for) and open `/` with console open. Fix every error at its root: a missing null-check, a race with an async asset load, a stale import. Do not silence a console.error call; fix what it is reporting.
2. **Look for the shared cause across the WebGL-heavy pages before fixing them one by one.** `/gallery`, `/monitor`, `/agents-live`, `/drive`, `/forge-studio`, `/characters`, `/artifact`, `/classic`, `/cad` are all 3D/Three.js-driven pages with unusually high error counts (93, 84, 52, 48, 36, 24, 24, 16, 7). Check whether they share a module (a Three.js loader, a shared avatar/animation import, a WebGL context helper) that recently changed; `git log --oneline -20 -- src/animation-retarget.js src/glb-canonicalize.js` and any shared Three.js bootstrap file is the first place to look. If one shared regression explains most of this list, fix it once and re-run those specific routes to confirm the count drops across all of them, rather than patching each page's symptom separately.
3. **Clear the remainder individually**, in error-count order, once the report from Step 0 has exact text and a screenshot per route: `/marketplace`, `/feed`, `/alpha-copilot`, `/community`, `/forged`, `/grok` (6 errors and 6 warnings; also check whether this is the same `data/pages.json` duplicate-path bug fixed in order 401's class B, since `/grok` is one of the duplicated paths there), `/import/vroid`, `/discord-activity`, `/apps/shopify`, `/crawl`.
4. **After the full sweep from Step 0 finishes**, read `reports/page-audit-<newest>.md`'s "## Detail" section top to bottom; it is sorted by error count and already solo-reverified. Fix anything newly surfaced there that this partial pass did not catch (the mobile viewport was not sampled at all in this order's measurement), and confirm every route listed above now shows `0e` by re-running `npx vitest`-free direct checks or a targeted partial sweep (`node scripts/page-audit.mjs` supports auditing a subset; check its `--help` or source for a routes filter before writing a new one).
5. If any fix touches `/grok`, `/import/vroid`, or anything that renders token/coin metadata, remember on-chain and token metadata is untrusted display data only: fixing a rendering crash is in scope, changing what gets displayed as if it were trusted input is not.

## Definition of done

- [ ] `/` (homepage) shows 0 console errors on a fresh load, desktop and mobile, confirmed by a direct check (not just the deferred full sweep).
- [ ] Every route listed in "Why this matters" above re-checked individually and shows 0 console errors, OR, for any that remain non-zero, the report states the exact remaining error text and why it is out of scope (a known third-party embed, confirmed by checking it is not three.ws's own code).
- [ ] If a shared root cause was found across the WebGL-heavy pages, it is named in the report with the single commit SHA that fixed it and the before/after error counts for at least 3 of the affected pages.
- [ ] The full `npm run audit:web` sweep started in Step 0 has completed (or, if it is still running when this order finishes, its process ID and log path are named in the report so it is not silently orphaned); the resulting `reports/page-audit-*.md` was read and any new finding it surfaced beyond this order's partial list is either fixed or explicitly deferred to a new order with its own number.
- [ ] `npm run check:rules -- --paths <files you touched>` exits 0.
- [ ] `npm run test:core` was run after the fix and shows no new failures versus its state before this order started (cite both counts; if order 401 is in flight concurrently, diff against whichever baseline is current).

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The full sweep in Step 0 is too slow to wait for | Start it in the background per Step 0 and work the homepage and the shared-cause hypothesis first; its report is a confirmation tool, not a gate on starting. |
| A page's error only reproduces in production, not locally | Check for an env-var or auth difference (`.auth/audit-state.json` session vs none); if it truly needs production data, add the defensive null-check/guard that would prevent the crash under any data shape rather than trying to reproduce the exact production dataset locally. |
| The shared-cause hypothesis is wrong and each page has a different bug | Fix them individually in error-count order; say in the report that the shared-cause hypothesis did not hold and why. |
| A fix would require touching on-chain/token metadata trust boundaries | Fix the rendering crash only; do not change what untrusted metadata is allowed to trigger. Note it in the report if the two are entangled. |
| Another agent is mid-fix on an overlapping file | Check `git log` and `git status` before editing; rebase your understanding, do not fight over the same lines. |
| Playwright/browser tooling is not installed in this environment | `npx playwright install chromium`; if network-blocked, use the existing `npm run audit:web` script's own browser bootstrap instead of installing a second one. |

## Report format

1. Homepage result first (error count before/after, commit SHA).
2. Shared-cause finding (yes/no, and the fix if yes) across the WebGL-heavy pages.
3. Per-route results for the remainder, in the error-count order listed above.
4. Full-sweep report path and its new findings, fixed or deferred with a reason.
5. Final `npm run test:core` and `npm run check:rules` confirmation.
6. One-line judgment calls, if any. No trailing questions.
