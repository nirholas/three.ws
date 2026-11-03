# Knip dead-code report and a gitleaks full-history secret scan wired into local gates

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/782-plan-platform-dead-code-and-secret-history-scans.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 24 of 100 inside the tier). **Area:** platform. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

"Delete aggressively" is a stated operating rule and nothing mechanically enforces it across 60-plus top-level directories, roughly 90 workspace packages and thousands of test files. Separately, `scripts/check-secrets.mjs` only judges added lines in a push range; on a repo where a leaked key is a live wallet, a second opinion over the whole history is worth having. Python dependency vulnerabilities are already covered (`npm run audit:deps`, `scripts/check-deps.mjs`), so that part of the original sweep is done; knip and gitleaks are not installed anywhere.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `grep -rIl -i 'knip\|gitleaks' scripts package.json` finds nothing. `which gitleaks osv-scanner knip semgrep` finds none.
- Existing guards: `scripts/check-secrets.mjs` (`npm run check:secrets`, filename rules repo-wide plus diff-scoped content rules, wired into the pre-push hook in `scripts/setup-git-hooks.mjs`), `scripts/check-deps.mjs` (`npm run audit:deps`, deliberately not in `npm run gate`), and `scripts/check-rules.mjs`.
- GitHub Actions is forbidden in this repo; everything must run locally or via Cloud Build.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -n 'knip\|gitleaks\|semgrep' package.json scripts/*.mjs | head
npm view knip version; npm view knip license
ls .gitleaks.toml knip.json knip.config.* 2>&1 | head
sed -n 1,40p scripts/check-secrets.mjs
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Add `knip` as a devDependency (pinned) with a `knip.json` that models this repo's real entry points: Vite page entries from `data/pages.json`/`pages/`, `api/**` handlers (route table in `vercel.json`), `server/index.mjs`, workspace packages, `scripts/` CLIs named in `package.json`, and test files. Tune ignores so the first report is signal, not noise. Add `npm run audit:dead-code` that runs it in report mode and writes `reports/dead-code.json` (gitignored).
2. Triage the first report: remove unused dependencies and unused exports that are provably dead (verify each with grep across `api/ src/ pages/ workers/ packages/ scripts/ server/ public/`). Do not delete anything referenced dynamically (route strings, `import()` templates, cron handlers). Commit deletions in topical commits with specific messages. Record the before/after counts (files, exports, dependencies) in `docs/ops/dead-code.md`.
3. Add a gitleaks full-history scan as `npm run audit:secrets-history`: a script that downloads a pinned, checksum-verified gitleaks release binary into `.cache/` (gitignored) on first use, runs `gitleaks detect --redact` over all history with a `.gitleaks.toml` that allowlists known synthetic fixtures (hardhat test keys, `YOUR_TOKEN` doc placeholders, public program IDs), and prints findings with commit, file and rule but never the secret. Exit 1 on unallowlisted findings.
4. Run it. For each true positive, write the rotation action into the report (provider, key prefix only, commit); do not rewrite history. If none, say so with the scanned commit count.
5. Tests: `tests/audit-secrets-history.test.js` for the wrapper (checksum verification fails closed on a mismatch, redaction never prints a matched secret, allowlist respected) using a temp git repo fixture built in the test.
6. Docs: `docs/ops/dead-code.md`, mention in `CONTRIBUTING.md` or `docs/ops` where `audit:deps` is described, and a `data/changelog.json` entry only if user-visible (it is not; say so).

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npm run audit:dead-code` exits 0 in report mode and writes `reports/dead-code.json`; `docs/ops/dead-code.md` records the before/after counts.
- [ ] `npm run audit:secrets-history` runs over the full history and exits 0 (or its remaining findings are all listed with a rotation action in the report).
- [ ] `npx vitest run tests/audit-secrets-history.test.js` passes.
- [ ] `npm test` still passes after the dead-code deletions, and `npm run build` succeeds.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| gitleaks release download is blocked | Use `go install github.com/gitleaks/gitleaks/v8@<pinned>` or the container image from a pinned digest; same wrapper. |
| Knip reports thousands of unused files | Scope the first pass to dependencies and exports, then `entry`-tune per directory; never bulk-delete. |
| A history finding is a real key | Report provider and commit with the rotation steps; rotation itself is the owner's action, do not paste the secret anywhere. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/782-plan-platform-dead-code-and-secret-history-scans.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `782-plan-platform-dead-code-and-secret-history-scans.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/oss-adoption-2026-09.md` (section "Beyond 3D: what the second sweep found")

~~~~markdown
## Beyond 3D: what the second sweep found

The 3D sweep is where the product lives, but the wider sweep turned up gaps that
have nothing to do with rendering and are cheaper to close.

### Supply chain and secrets: nothing off the shelf is installed

`scripts/check-secrets.mjs` is a good hand-rolled push-time scan, and there is no
dependency-vulnerability or static-analysis tooling at all. Three drop-ins, all
of which run locally and none of which need GitHub Actions (which this repo does
not use):

- **[google/osv-scanner](https://github.com/google/osv-scanner)** (Apache-2.0,
  11k) reads `package-lock.json` and the Python requirements files and reports
  known vulnerabilities. The `overrides` block in `package.json` shows this work
  is already being done by hand, one CVE at a time.
- **[gitleaks/gitleaks](https://github.com/gitleaks/gitleaks)** (MIT, 29k) as a
  second opinion beside the existing secrets check, which is worth having on a
  repo where a leaked key is a live wallet.
- **[semgrep/semgrep](https://github.com/semgrep/semgrep)** (LGPL-2.1, 16.5k) for
  the rules the custom `check:rules` cannot express. Note the LGPL: run it as a
  tool, do not vendor it into shipped code.

### Dead code: [webpro-nl/knip](https://github.com/webpro-nl/knip) (ISC, 12k)

"Delete aggressively" is a stated operating rule, and nothing mechanically
enforces it across 60-plus top-level directories, ~90 workspace packages, and
1,989 test files. Knip finds unused files, exports, and dependencies in exactly
this shape of monorepo. Expect a large first report; the value is in the
dependency and export findings, not the file list.

### Voice, if the neural TTS lane ever needs to grow

Kokoro already ships as the free in-browser voice, which was the right call and
covers the common case. If a lane ever needs zero-shot voice cloning or more
expressive delivery, the permissively licensed options are
**[resemble-ai/chatterbox](https://github.com/resemble-ai/chatterbox)** (MIT,
26k) and **[canopyai/Orpheus-TTS](https://github.com/canopyai/Orpheus-TTS)**
(Apache-2.0, 6.3k). **F5-TTS is the one to avoid**: its weights are CC BY-NC.
For speech-in, **[SYSTRAN/faster-whisper](https://github.com/SYSTRAN/faster-whisper)**
(MIT, 25k) is the standard server-side Whisper runtime.

---
~~~~

