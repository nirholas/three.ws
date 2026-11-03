# Tune the lintapple UI policy to the real design tokens and lint the core pages in one command

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/789-plan-tooling-ui-lint-policy-tuning.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 18 of 100 inside the tier). **Area:** tooling. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`npm run lint:ui` (lintapple) exists but its `ui-policy.json` was copied from an Apple-oriented default, so the font and size rules are noisy against the real design (Inter, Space Grotesk, JetBrains Mono, a denser type scale) and only five rules carry signal. It also lints exactly one URL, only two pages (`/gallery`, `/create`) were ever triaged, and pages over 5000 elements (such as `/marketplace`) exit with code 2. As a result layout, contrast and ARIA regressions are not checkable across the product.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `ui-policy.json` at the repo root lists fonts `Inter` plus system fonts, a 12 to 64 px type scale, `minControlSize` 15, `minControlGap` 8, viewports 390x844 and 1440x900, light and dark, and an empty `exceptions` array.
- `package.json` has `"lint:ui": "lintapple http://localhost:3000"` only.
- First triage (2026-10-12) fixed `/gallery` and `/create`; known intentional leftovers are listed in `docs/ui-lint.md` (skip link, `line-clamp`, footer watermark, `Inter Fallback`, 22 px walk-companion buttons).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
cat ui-policy.json | jq '{fonts, fontSizes, exceptions}'
grep -n "lint:ui" package.json
grep -rn "font-family" public/*.css src/styles 2>/dev/null | grep -o "font-family:[^;]*" | sort | uniq -c | sort -rn | head
npm run dev &   # port 3000
sleep 15
npx lintapple http://localhost:3000/gallery --ready main; echo "exit $?"
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Derive the real type scale and font stack from the shipped CSS tokens (the shared stylesheet variables used by `public/` and `src/`), update `ui-policy.json` fonts and sizes to match, and verify the rules `font-family` and font size stop firing on `/gallery` and `/create` for correct text.
2. Add `scripts/lint-ui-pages.mjs` that runs lintapple against a fixed list of core pages (`/`, `/gallery`, `/create`, `/forge`, `/discover`, `/docs`, `/agents`) with each page's ready selector, aggregates exit codes (0, 1, 2 distinguished), and prints one summary table; wire it as `npm run lint:ui:core`. For pages that exit 2 (over 5000 elements) lint a named component target instead and document it in the script.
3. Fix real findings on those pages that are defects (ARIA state, control gaps, contrast); record intentional ones as entries in `ui-policy.json` `exceptions` with a reason each. No blanket disables.
4. Test: `tests/ui-lint-pages.test.js` for the script's pure parts (exit-code aggregation, page list integrity against `data/pages.json`).
5. Update `docs/ui-lint.md` (remove the "noisy until tuned" note, document the new command and exceptions).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm run lint:ui:core` exits 0 against a running dev server, printing one row per page.
- [ ] `ui-policy.json` fonts include Space Grotesk and JetBrains Mono as used in the CSS; every `exceptions` entry has a reason.
- [ ] `npx vitest run tests/ui-lint-pages.test.js` passes.
- [ ] Browser check on each fixed page shows no visual regressions and no console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A page exits 2 (too many elements) | Lint a component-level selector target and list it in the script |
| Dev server needs a login for a page | Use the QA login described in the self-unblock playbook (`npm run audit:web:login`) |
| Finding is intentional | Add a documented exception instead of weakening the rule |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/789-plan-tooling-ui-lint-policy-tuning.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `789-plan-tooling-ui-lint-policy-tuning.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/ui-lint.md` (whole file)

~~~~markdown
# UI lint (lintapple)

[lintapple](https://github.com/gholtzap/lintapple) loads a running page in a browser and checks it against `ui-policy.json` at the repo root: font family and size, contrast, control size and gaps, viewport overflow, content clipping, root background, and ARIA state.

```
npm run dev                                   # app on :3000
npx lintapple http://localhost:3000/gallery --ready main
npm run lint:ui                               # same, against the home URL
```

Exit codes: 0 pass, 1 findings, 2 the check could not finish (pages over 5000 elements, such as `/marketplace`, need a component-level target).

## Notes

- The policy ships with Apple system fonts and a 12 to 64px type scale. three.ws uses Inter, Space Grotesk and JetBrains Mono and a denser scale, so the font and size rules are noisy until the policy is tuned to our design tokens. The rules that carry signal today are `viewport-bounds`, `content-clipping`, `control-gap`, `root-background` and `control-state`.
- The home page is a windowed-desktop canvas with a plain HTML fallback behind it. Lint content pages (`/gallery`, `/create`) and pass `--ready` so the app has mounted.
- A passing run means the configured rules held. It is not a design review.

## Triage (2026-10-12)

First pass on `/gallery` and `/create` fixed the rules with signal: control gaps in the header and gallery, accessible names that dropped visible text (gallery tags and cards, create cards, the getting-started pill), icon-only buttons without a tooltip (header, footer, suggestions panel; use a `role="tooltip"` span linked by `aria-describedby`, styled by `.ui-tip`), and the root background. What remains is intentional or environmental: the skip link and visually hidden label sit off-screen on purpose, card titles and descriptions use `line-clamp`, the footer watermark bleeds by design, `Inter Fallback` fails to load only where Arial/Liberation Sans is not installed, and the walk companion's floating buttons are 22px circles (44px on coarse pointers).
~~~~

