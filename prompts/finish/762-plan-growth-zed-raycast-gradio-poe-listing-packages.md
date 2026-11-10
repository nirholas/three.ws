# Build the Zed, Raycast, Poe and Gradio MCP Space packages (and an n8n node) that the listing sweep says are accepted elsewhere

**Status 2026-11-04:** all five packages are built and verified (`npm run check:integrations` exits 0; Zed wasm build, Raycast tests/types/build, n8n tests/build/lint, Gradio and Poe tests; Gradio via a real MCP client and Poe and n8n against production Forge returned real GLB links). Remaining, owner-owned and tracked by order 938: create the Raycast account and set `author` in `integrations/raycast/package.json` (`ray lint` fails only on that), add Raycast screenshots, then submit the Zed, Raycast, Hugging Face, Poe and npm/n8n listings per each folder's `SUBMITTING.md`. Poe needs a public deploy of `forge_bot.py`.

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/762-plan-growth-zed-raycast-gradio-poe-listing-packages.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 36 of 100 inside the tier). **Area:** growth. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The growth sweep found several high-traffic listing surfaces where a same-shaped project was accepted, but three.ws has no package to submit: a Zed context-server extension, a Raycast extension, a Poe server bot, a Hugging Face Gradio Space with `mcp_server=True` (the existing Space is static), and an n8n community node. Each is a thin wrapper over capabilities that already exist (the no-key Forge text-to-3D lane, `@three-ws/mcp-server`). Building them so the only remaining step is the owner's submission turns every listing from a multi-day project into a one-command ship. The WordPress, Framer and Webflow embeds are a different order and are not part of this one.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Existing precedent for the layout: `integrations/comfyui/` (with `SUBMITTING.md`), `integrations/blender/`, `integrations/modly/`, `integrations/framer/`. Each integration has a README and a `SUBMITTING.md` with the exact registry fields.
- Not present anywhere in the repo: a Zed extension, a Raycast extension, a Poe bot, a Gradio Space app, an n8n node.
- Packages that already exist and should be reused rather than re-implemented: `packages/ai-sdk`, `packages/langchain`, `packages/three-ws-cli`, `mcp-server/` (`@three-ws/mcp-server`, bin `3d-agent-mcp`).
- Free surfaces to wrap: the no-key Forge lane (`api/forge/`, documented in `docs/forge.md`), remote MCP at `https://three.ws/api/mcp-studio` (initialize returns 200 without auth), and `public/.well-known/openapi.yaml`.
- The sweep records n8n verified-node publishing needs a GitHub Actions provenance workflow, which this repo does not use. Build the node unverified and self-installable and say so.
- Submission itself (PRs to third-party repos, store publishing) is already tracked by `prompts/finish/938-partners-15-listings-prs-and-sends.md`. This order only builds and verifies the packages.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
ls integrations
ls -d integrations/*zed* integrations/*raycast* integrations/*poe* integrations/*gradio* integrations/*n8n* 2>&1 | grep -v "No such"
curl -s -X POST https://three.ws/api/mcp-studio -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' | head -c 400
sed -n 1,60p integrations/comfyui/SUBMITTING.md
grep -n "forge" public/.well-known/openapi.yaml | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Zed: `integrations/zed/` with a Rust extension crate (`extension.toml`, `Cargo.toml`, `src/lib.rs`) that registers a context server running `npx -y @three-ws/mcp-server`, following the current Zed extension docs and the layout of an accepted MCP extension (fetch the zed-industries/extensions README and one merged MCP extension with a plain GET). Include a `configuration` schema for any optional key. Build it with `cargo build --target wasm32-wasip2` (install the target if missing) and record the result. `SUBMITTING.md` lists the exact PR steps and fields.
2. Raycast: `integrations/raycast/` with a "Forge a 3D model" command (prompt in, GLB URL and browser viewer link out, copy and open actions) over the free Forge lane, following Raycast's extension manifest rules (icon, metadata screenshots listed in `SUBMITTING.md`, `npm run build` and `ray lint` clean). Loading, empty and error states in the command UI. Tests for the API client with recorded real responses captured from production, not hand-written fakes.
3. Gradio MCP Space: `integrations/huggingface-space/` with `app.py` using Gradio with `mcp_server=True` exposing a Forge text-to-3D function and a model viewer component, `requirements.txt`, and the Space README front matter (`sdk: gradio`, `tags` including `mcp-server`). Run it locally, call it with a real MCP client over the Space's MCP endpoint, and record the transcript in `SUBMITTING.md`. Keep rate limiting and error messages honest when the free lane is busy.
4. Poe server bot: `integrations/poe/` using `fastapi_poe`, wrapping the free Forge lane, streaming progress text and returning the GLB link and an inline preview image when available. Include the settings the Poe creator dashboard requires and a local run script. Test the bot with `fastapi_poe`'s local tester against the real Forge endpoint.
5. n8n: `integrations/n8n/` with a community node package (`n8n-nodes-three-ws`) implementing a Forge text-to-3D operation and an MCP-tool-call operation, built with `@n8n/node-cli` and linted with the n8n rules. Document that it is installable unverified and why it is not verified (no GitHub Actions in this repo).
6. For each package: README with install, one real example, screenshots/GIF captured from the real run, license (Apache-2.0 to match the repo), and a test target runnable from the package folder. Add the folders to `STRUCTURE.md`, add a section to `integrations/README.md`, and extend `marketing/growth/opportunities.md` rows with "package built, awaiting submission" and the folder path so order 938 can pick them up.
7. A root script `npm run check:integrations` (or extend an existing check) that builds or lints each of the five and fails loudly, so the packages cannot rot.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `ls integrations/zed integrations/raycast integrations/huggingface-space integrations/poe integrations/n8n` shows five populated folders each with README.md and SUBMITTING.md.
- [ ] The Zed extension compiles to wasm, Raycast `ray lint` and build pass, the n8n node lints and builds, the Poe bot and the Gradio app run locally and return a real GLB link from the Forge lane (transcripts in each `SUBMITTING.md`).
- [ ] `npm run check:integrations` exits 0.
- [ ] `STRUCTURE.md` has a row per new folder and `npm run audit:docs` passes.
- [ ] No other crypto project is referenced in any new file (grep recorded in the report).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A toolchain is missing (cargo target, ray CLI, n8n CLI) | Install it locally (rustup target add, `npm i -D @raycast/api`, `npm i -D @n8n/node-cli`); these are dev dependencies, not paid services. |
| The Forge free lane is busy or cold | Retry with backoff and record the real latency; the packages must show queue state honestly. |
| A registry changed its manifest format | Build to the format in its current docs and note the doc URL and date in `SUBMITTING.md`. |
| Store publishing or third-party PRs | Not part of this order. Order 938 owns submission; leave the packages one command from shipping. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/762-plan-growth-zed-raycast-gradio-poe-listing-packages.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `762-plan-growth-zed-raycast-gradio-poe-listing-packages.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `marketing/growth/opportunities.md`
- `marketing/growth/sweep-2026-09-18.md`
