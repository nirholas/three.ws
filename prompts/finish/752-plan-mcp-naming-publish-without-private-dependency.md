# @three-ws/naming-mcp can be npm-published again, with a guard so no published package depends on a private one

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/752-plan-mcp-naming-publish-without-private-dependency.md`.

**Priority:** P2, new capability with clear value (score 42 of 100 inside the tier). **Area:** mcp. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

`@three-ws/naming-mcp` is live on npm (0.1.3, installed with `npx @three-ws/naming-mcp`). Its `package.json` now declares `"@three-ws/tool-sdk": "file:../tool-sdk"`, and `@three-ws/tool-sdk` is `"private": true` and unpublished (`npm view @three-ws/tool-sdk` returns 404). The next `npm publish` of naming-mcp will therefore produce a package nobody outside the monorepo can install. The tool-sdk README documents this as a "known, disclosed follow-up". It is a latent release breaker on a shipped public package, and nothing in the repo would catch the same mistake on the next package.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `packages/naming-mcp/package.json` line 55: `"@three-ws/tool-sdk": "file:../tool-sdk"`; the only importer is `packages/naming-mcp/src/tools/sns-resolve.js` line 15 (`defineTool, defineExecutor, toMcpTools`).
- `packages/tool-sdk` has `src/{define-executor,define-tool,index,mcp-adapter,permissions}.js`, depends only on `zod ^4.6.7` (naming-mcp already depends on `zod ^4.6.7`), has its own `tests/`, and is private.
- naming-mcp tests: `packages/naming-mcp/test/registration.test.mjs` (`node --test`).
- Existing precedent for byte-identical copies guarded by a check: `scripts/check-vendored-workers.mjs` (`npm run check:vendored`), which is for workers, not packages.
- No script flags a publishable package (no `"private": true`) that has a `file:`/`workspace:` dependency.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -n "tool-sdk" packages/naming-mcp/package.json packages/naming-mcp/src -r
npm view @three-ws/tool-sdk version 2>&1 | tail -1
npm view @three-ws/naming-mcp version
grep -n '"private"' packages/tool-sdk/package.json
# every publishable package carrying a non-registry dependency:
node -e "const fs=require('fs');for(const d of fs.readdirSync('packages')){try{const p=JSON.parse(fs.readFileSync('packages/'+d+'/package.json'));if(p.private)continue;for(const k of ['dependencies','optionalDependencies','peerDependencies']){for(const [n,v] of Object.entries(p[k]||{}))if(/^(file:|link:|workspace:)/.test(v))console.log(d,k,n,v)}}catch{}}"
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Choose the vendoring route (publishing tool-sdk to npm is an owner action, so do not depend on it): add `packages/naming-mcp/scripts/vendor-tool-sdk.mjs` that copies `packages/tool-sdk/src/*.js` byte-identically into `packages/naming-mcp/src/vendor/tool-sdk/` with a header file `VENDORED.md` naming the source commit, and add `npm run vendor:tool-sdk` plus a `--check` mode that exits non-zero on drift.
2. Change `packages/naming-mcp/src/tools/sns-resolve.js` to import from `../vendor/tool-sdk/index.js`; delete the `file:` dependency from `packages/naming-mcp/package.json`; add `src/vendor` to the package's `files` allowlist if it has one (check `files`/`.npmignore`).
3. Test-first guard: write `tests/publishable-package-deps.test.js` that fails today by scanning `packages/*/package.json` for non-private packages with `file:`, `link:` or `workspace:` dependencies (apply the same scan as Step 0) and asserting none exist; run it, confirm it fails on naming-mcp, then fix with tasks 1-2 and confirm it passes. Add an allowlist file only if a legitimate workspace dependency exists in the Step 0 output, and justify each entry.
4. Wire the vendor drift check into `npm run check:vendored` (extend `scripts/check-vendored-workers.mjs` or chain a second script) so the repo gate catches drift.
5. Prove the tarball installs outside the monorepo: `cd packages/naming-mcp && npm pack`, install the `.tgz` into a fresh temp dir with `npm i --no-workspaces <tgz>`, and run its `registration.test.mjs`-equivalent smoke (start the server over stdio and list tools via the MCP client SDK). Add this as `packages/naming-mcp/test/packed-install.test.mjs` using a temp directory and `child_process`.
6. Update `packages/tool-sdk/README.md` "Consuming from a package that also ships to npm" to describe the vendoring route and the guard, and the naming-mcp README if it mentions the dependency. Do NOT run `npm publish`; leave the version bump and publish to the owner's routine release.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/publishable-package-deps.test.js` passes (and failed before task 1).
- [ ] `node --test packages/naming-mcp/test/` passes including the packed-install test.
- [ ] `node packages/naming-mcp/scripts/vendor-tool-sdk.mjs --check` exits 0, and exits non-zero after a one-byte edit to `packages/tool-sdk/src/define-tool.js` (verify, then revert).
- [ ] `grep -n "file:" packages/naming-mcp/package.json` returns nothing.
- [ ] `npm run check:vendored` passes.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Want to publish tool-sdk instead | Not needed; vendoring ships the same code with no registry step. Note publishing as an option in the README |
| `npm pack` install in a sandbox lacks network | Use a local `file:` install of the packed tarball with `--offline` after `npm ci` caches; the dependencies are `zod` and the MCP SDK only |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/752-plan-mcp-naming-publish-without-private-dependency.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `752-plan-mcp-naming-publish-without-private-dependency.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `packages/tool-sdk/README.md` (section "Consuming from a package that also ships to npm")

~~~~markdown
## Consuming from a package that also ships to npm

`@three-ws/tool-sdk` is `"private": true` and is never published. Most
`packages/*-mcp` servers (including `naming-mcp`) **are** published
standalone to npm (`npx @three-ws/naming-mcp`, etc.). A published package that
takes a hard `dependencies` entry on this SDK will fail to install for
external consumers, because npm cannot resolve an unpublished private
package from the registry.

For **in-monorepo development and testing** this is not a problem: a `file:`
dependency (`"@three-ws/tool-sdk": "file:../tool-sdk"`) resolves correctly for
every local `npm install`/`npm test` run, which is what
`packages/naming-mcp/src/tools/sns-resolve.js` uses as this package's
proof-of-port. Before that server's *next npm publish*, either (a) publish
`@three-ws/tool-sdk` itself, (b) bundle the two files it actually uses at
build time, or (c) inline the thin adapter call for that one file. This is a
known, disclosed follow-up - not a blocker for using the SDK inside the
monorepo today.
~~~~

