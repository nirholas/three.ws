# Expose the tool gateway bundle: metered web, document, speech and gemini routes plus agent tools

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/703-plan-mcp-tool-gateway-metered-routes-tools.md`.

**Priority:** P2, new capability with clear value (score 66 of 100 inside the tier). **Area:** mcp. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Agents need web fetch and search, document parsing, speech and image tools without the owner bringing separate keys. The gateway library is written (metering, pricing, SSRF-safe download, storage) but has no routes, no tools and no docs, so it earns nothing and helps no agent. Quality-first routing runs on Google Cloud (Gemini, Vertex) which is pre-approved.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Built: `api/_lib/tool-gateway/{documents,download,errors,gemini,html-text,meter,pricing,speech,storage,web}.js`.
- Missing: any route under `api/tool-gateway/` or `/api/v1/tools/`, agent tools, entries in `packages/mcp-policy/src/table.js`, pricing page, tests, `docs/tool-gateway.md`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls api/_lib/tool-gateway api | grep -iE "gateway|tools"
grep -rn "tool-gateway" api src packages --include=*.js -l | grep -v "_lib/tool-gateway"
ls tests | grep -i gateway; sed -n 1,60p api/_lib/tool-gateway/pricing.js
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first (`tests/tool-gateway.test.js`): `download.js` refuses private IPs and redirects to them; `meter.js` debits once per call and refunds on provider error; `pricing.js` returns a price for every tool; `html-text.js` strips scripts. Fix defects.
2. Routes (`api/v1/tools/[tool].js` plus `vercel.json`): `web.fetch`, `web.search`, `documents.parse`, `speech.transcribe`, `speech.synthesize`, `vision.describe`. Auth by session or API key, billed through `meter.js` against the account balance; paid anonymous calls via the existing x402 rail.
3. MCP and agent tools with the same names in `api/_mcp/tools/` registered in the policy table (read tier except those that spend, which are write tier with price in the description).
4. Public pricing table page section on `/pricing` (or `/tools`) generated from `pricing.js`, with skeleton, error and empty states.
5. Docs `docs/tool-gateway.md`, `docs/api-reference.md`, changelog.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/tool-gateway.test.js` passes.
- [ ] `curl` of each route against `npm run dev` with a dev key returns real output (fetch of a public page, parse of a small PDF) and a ledger debit row.
- [ ] Unauthenticated call returns 401/402 with the x402 shape.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Gemini key missing locally | Use Vertex AI with the project ADC (`aerial-vehicle-466722-p5`), as `gemini.js` supports. |
| Search provider | Use the provider `web.js` already implements; if none is configured, ship fetch and document routes and report the env var. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/703-plan-mcp-tool-gateway-metered-routes-tools.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `703-plan-mcp-tool-gateway-metered-routes-tools.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/26-tool-gateway-bundle.md` (whole file)

~~~~markdown
# 26. The tool gateway: search, browser, image, video, speech and transcription under one credit balance

Read `docs/prompts/README.md` first.

## The problem

Generation exists in pieces: 3D and image forge lanes, vision, assistant speech, announcement voice. There is no single set of general-purpose tools an agent gets by default and pays for with the same credits: web search, page fetch and browser automation, image generation, video generation, text to speech, speech to text, and document parsing. Competing platforms bundle all of these under one subscription so a developer does not collect five vendor keys.

## Build

- Tools on the unified endpoint under a `gateway` group: `web_search`, `web_fetch` (readable extraction), `browser` (Playwright on Cloud Run with session persistence, screenshot and act), `image_generate` (the existing forge lanes, GCP Imagen first), `video_generate` (Veo on Vertex), `tts`, `transcribe`, `parse_document` (PDF, DOCX, spreadsheets). Each backed by GCP where GCP has the capability; the existing lanes and failover chains reused; no new paid vendor without approval (list any gap as the missing var).
- Metering per call in credits through `api/_lib/llm-metering-rule.js` or a sibling, with prices on `/pricing` and in the model catalog response.
- Default on for every agent at the read tier; results are untrusted data.
- The local runtime (prompt 20) and the SDK (prompt 06) expose them.
- Docs: `docs/tool-gateway.md` linked from `docs/start-here.md`; changelog entry tagged `feature`.

## Acceptance

- An agent asked to research a token, screenshot its site, and summarize it uses `web_search`, `browser` and the model, and the run shows the cost per step.
- `tts` and `transcribe` round-trip a sentence.
- `npm test` green.
~~~~

