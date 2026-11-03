# Let embedders supply the skill-trust allowlist on the agent-3d element

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/769-plan-agent-skill-trust-allowlist-attributes.md`.

**Priority:** P3, polish, developer experience, or exploratory (score 30 of 100 inside the tier). **Area:** agent. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`SkillRegistry` (`src/skills/index.js`) implements a real `whitelist` trust mode: a bundle installs only when its manifest author is in `trustedAuthors` or its serving origin is in `trustedOrigins`; empty lists admit nothing. But the `<agent-3d>` element (`src/element.js` around line 2091) only forwards `trust: this.getAttribute('skill-trust')`, `ownerAddress` and `mainThreadOrigins`. There is no attribute or property that supplies the two lists, so `skill-trust="whitelist"` on an embed rejects every skill, and nobody can use the mode that `docs/web-component.md` and `docs/security.md` advertise. `docs/agent-system.md` line ~359 also still claims the allowlist check "is not wired yet", which is stale.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `src/skills/index.js` lines ~113-120 and ~279-290: allowlist fields and enforcement exist.
- `src/element.js` ~2091-2097: constructs `new SkillRegistry({ trust, ownerAddress, mainThreadOrigins })` only. `src/app.js:540` hard-codes `owned-only`.
- `grep -rn "trustedAuthors\|trustedOrigins" src | grep -v src/skills/index.js` returns nothing.
- Docs: `docs/web-component.md` line 157 (Skills and memory) (`skill-trust` row), `docs/security.md` ~243, `docs/agent-system.md` ~359.
- Tests near this: `tests/skill-sandbox-lockdown.test.js`, `tests/skill-manifest.test.js`, `tests/installed-skills.test.js`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "trustedAuthors\|trustedOrigins\|skill-trust" src/element.js src/skills/index.js src/app.js
grep -n "skill-trust" docs/web-component.md docs/security.md docs/agent-system.md
grep -rn "skill-trusted" src docs | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test-first: add `tests/skill-trust-allowlist.test.js`. Assert `SkillRegistry` with `trust: 'whitelist'` admits a bundle whose author or origin is listed, rejects others and rejects everything when lists are empty (this documents existing behaviour). Then add a failing test that the element's registry-construction helper reads allowlists from attributes `skill-trusted-authors` and `skill-trusted-origins` (comma separated) and from a `skillTrust` property `{ authors, origins }`; confirm it fails because the element ignores them.
2. Extract the registry construction in `src/element.js` into a small exported function (for example `buildSkillRegistry(el, manifest, scriptOrigin)`) so it is unit-testable without a DOM, and implement the two attributes plus the property. Attributes are lowercased and trimmed; invalid origins are ignored with a console warning from the element; the default remains `owned-only`.
3. Surface it: add the two attributes to the observed-attributes list and the attribute table in `docs/web-component.md`; fix the stale sentence in `docs/agent-system.md`; add a short whitelist example to `docs/security.md`.
4. Add a `data/changelog.json` entry.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/skill-trust-allowlist.test.js` passes; the element-level test failed before the change.
- [ ] `grep -n "not wired yet" docs/agent-system.md` returns nothing.
- [ ] In a browser on a local page, `<agent-3d src=... skill-trust="whitelist" skill-trusted-authors="0xabc...">` installs a skill from the listed author and refuses one from another author with an error event and no console errors from the element.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Need a test bundle | Use the bundle fixtures already used by `tests/skill-manifest.test.js` and `tests/installed-skills.test.js`. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/769-plan-agent-skill-trust-allowlist-attributes.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `769-plan-agent-skill-trust-allowlist-attributes.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/agent-system.md` (section "8. Skills")

~~~~markdown
## 8. Skills

Skills extend what an agent can do. Every built-in capability is itself a skill: `greet`, `present-model`, `validate-model`, `remember`, `think`, `sign-action`, `help`. On top of those seven, the `AgentSkills` constructor registers the domain skill families that live in the `src/agent-skills-*.js` modules (token trading, launching and watching, swaps, Blinks, NFTs, scene control, sentiment and market intel, and agent and agent-to-agent payments).

Each skill definition (`SkillDef`) has:
- `name` - unique identifier
- `description` - shown to the LLM
- `instruction` - human-readable behavior spec
- `animationHint` - gesture name emitted on `perform-skill`
- `voicePattern` - template text with `{{vars}}` for quick synthesis
- `mcpExposed` - whether the skill is callable via `/api/mcp`
- `inputSchema` - JSON Schema for args validation
- `handler(args, ctx)` - async function returning `{ success, output, sentiment, data }`

The context object passed to every handler includes `protocol`, `memory`, `identity`, `viewer` (the SceneController), and `isBrowser`.

When a skill executes, `AgentSkills.perform()` emits `perform-skill` (so the avatar plays the animation hint and injects patience), runs the handler, emits `skill-done` or `skill-error`, and auto-speaks the result text if in browser context.

Skills loaded from a manifest bundle go through `SkillRegistry` (`skills/index.js`), which enforces trust modes:
- `any` - any skill installs without restriction
- `owned-only` - `manifest.author` must match the `ownerAddress` element attribute or backend record
- `whitelist`: accepted as a mode, but the allowlist check is not wired yet, so today it installs like `any`

A bundle's `sandboxPolicy: "trusted-main-thread"` is only a request. Handlers run in the worker sandbox unless `SkillRegistry.mayRunOnMainThread()` grants the main thread, which it does only for a bundle served from a trusted origin (by default the page's own; `<agent-3d>` passes `mainThreadOrigins` with the page's origin and the origin that served its script) and never under `any` trust. A refused request logs a warning and the skill still runs, sandboxed.

Skill dependencies are resolved recursively. A skill can declare `dependencies: ['wave', 'look-at']` and the registry will install them in order before registering the dependent skill.

For the full skill bundle format, see [SKILL_SPEC.md](../specs/SKILL_SPEC.md).

---
~~~~

### `docs/web-component.md` (section "Skills and memory")

~~~~markdown
### Skills and memory

| Attribute | Type | Default | Description |
|-----------|------|---------|-------------|
| `skills` | comma-separated URIs | - | Additional skill URIs to install on top of manifest skills. |
| `skill-trust` | `any` \| `whitelist` \| `owned-only` | `owned-only` | Controls which skill URIs are allowed to install. `owned-only` allows only skills whose author matches the agent's `ownerAddress`. |
| `memory` | `local` \| `ipfs` \| `encrypted-ipfs` \| `none` | from manifest | Memory storage mode. |
| `memory-key` | string | agent ID or name | Namespace under which memory is persisted. Useful when embedding the same agent in multiple contexts. |
~~~~

