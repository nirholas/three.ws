# Remove 'unsafe-eval' from the site-wide CSP and keep it only on the scene-studio route

**Status (2026-11-13):** Production is deployed with the scoped policy: `--headers-only --base https://three.ws` is clean on 26 pages, `/scene` keeps eval and works, and a Draco GLB renders under the enforced policy in `/viewer` and `/app-classic`. The dedicated Playwright spec now exists (`tests/e2e/csp-no-eval.spec.js`, 7/7 pass). The one remaining production violation is zod's eval probe on `/showcase` and `/app-classic`, fixed in `50e9c20db` (built after the live revision `0d4c38210`). Remains (owner): deploy current main (`npm run deploy:gcp:full`), then `node scripts/audit-csp.mjs --base https://three.ws` should report clean and this order can be deleted.

**Status (2026-11-10):** Code, route table (`'unsafe-eval'` only on `/scene`), tests, docs and changelog shipped earlier (a22d25dc7). This pass re-verified locally: no eval in `dist/assets`, `audit-csp` clean on 25 pages, `--headers-only --all` matches (only `/mcp` and `/api/mcp` answer 402), `/scene`, `/` and `/viewer` clean in a real browser. Remains: owner deploy then `node scripts/audit-csp.mjs --headers-only --base https://three.ws` (owner); an opened-Draco-GLB browser pass and a dedicated Playwright no-eval spec (not written, `audit-csp` covers the routes); Report-Only stage skipped (enforced directly, `report-uri` collects hits).

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/714-plan-security-csp-drop-unsafe-eval.md`.

**Priority:** P2, new capability with clear value (score 58 of 100 inside the tier). **Area:** security. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Audit finding H12 is the last open item of the 2026-06-18 security audit. Inline script injection is already closed: `'unsafe-inline'` was removed on 2026-08-06 because `server/csp-hashes.mjs` rewrites `script-src` per HTML response to the hashes of that page's own inline scripts. `'unsafe-eval'` is the remaining weak link and is present in the global policy and in every route group that matters (26 occurrences in the `vercel.json` route table, on pages that hold wallets and sessions). While it stays, any XSS that reaches a string-to-code sink (`eval`, `new Function`, `setTimeout(string)`) still executes with the page's privileges. The audit wrote down the plan and every reviewer since has marked it "still tracked". This order executes the plan and proves it in a real browser.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `grep -c "unsafe-eval" vercel.json` returns 26. `wasm-unsafe-eval` appears 0 times, so WebAssembly (Draco, meshopt, basis, onnxruntime-web) currently relies on `'unsafe-eval'`. Production still sends it: `curl -sI https://three.ws/ | grep -i content-security-policy` shows `script-src 'self' 'unsafe-eval' blob: ...` plus the SHA-256 hashes and no `'unsafe-inline'`.
- `docs/security/SECURITY_AUDIT.md` H12 lists the known eval users: the `cwise` codegen inside the main `index` bundle (does NOT degrade; this is the blocker for the global policy); `new Function` in `public/scene-studio/{app/app.js,libs/acorn/acorn.js}` and `src/scene-studio/vendor/js/libs/app.js` (do not degrade); and two libraries that degrade gracefully when eval is blocked (colyseus msgpack/protobuf JIT with codegen threshold set to Infinity after a failed feature test, pdf.js `isEvalSupported`).
- Not in the audit's list: `src/mesh-ops/runner.js` line 42 evaluates the downloaded Draco wrapper (`new Function(\`${source}\nreturn DracoDecoderModule;\`)`) inside the mesh-ops worker; `src/scene-studio/remote-scene.js` also matches `new Function|eval(` and needs triage.
- Tooling that exists and must be used rather than rewritten: `server/csp-hashes.mjs`, `scripts/audit-csp.mjs` (`npm run audit:csp`; loads pages in Chromium, fails on any `securitypolicyviolation` or CSP header mismatch against `vercel.json`, supports `--all` over `data/pages.json` and `--headers-only --base <origin>`), `scripts/lib/csp-headers.mjs`, `scripts/audit-inline-handlers.mjs`, and tests `tests/csp-hashes.test.js`, `tests/csp-headers-compare.test.js`, `tests/csp-script-hosts.test.js`.
- Every CSP in `vercel.json` already carries `report-uri /api/client-errors`, so violations in the wild are captured (`api/client-errors.js` maps `effective-directive` into a message).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -c "unsafe-eval" vercel.json; grep -c "wasm-unsafe-eval" vercel.json
curl -sI https://three.ws/ | grep -i content-security-policy | tr ';' '\n' | grep -i script-src
grep -rnE "new Function\(|[^a-zA-Z.]eval\(|setTimeout\(['\"\`]" src public --include=*.js -l | grep -v node_modules
npm ls cwise ndarray-ops 2>/dev/null | head -20
grep -rn "cwise" package.json | head
sed -n 300,315p docs/security/SECURITY_AUDIT.md
npm run build 2>&1 | tail -5
grep -l "cwise" dist/assets/*.js 2>/dev/null | head
node scripts/audit-csp.mjs --headers-only --base https://three.ws 2>&1 | tail -15
```

Find which dependency pulls in `cwise` (`npm ls cwise`, or `npm explain cwise` if the lockfile is unreadable by tooling) and which entry imports it; that decides the replacement. Skip any task below whose outcome is already true.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Inventory every runtime eval user in the built output, not just source: after `npm run build`, `grep -l "new Function\|eval(" dist/assets/*.js` and attribute each hit to a package or file. Write the table in a new "Eval users" section of H12 in `docs/security/SECURITY_AUDIT.md`.
2. Remove `cwise` from the main bundle. In order of preference: replace the one ndarray op with a plain typed-array loop, swap the dependency for a codegen-free alternative, alias the module in `vite.config.js` to a precompiled static implementation, or lazy-load it only on the route that needs it. The goal is a main `index` bundle with no `new Function` reachable on first load. Add a Node test beside the module that asserts identical output on a representative array.
3. Mesh-ops Draco: load the decoder through the supported route instead of `new Function` (the three.js `DRACOLoader`-style worker with `draco_decoder.wasm` plus the wrapper loaded as a classic worker script via `importScripts` from a same-origin URL, which needs no eval, or `MeshoptDecoder`). Keep behavior identical (existing mesh-ops tests must pass; add a Draco GLB round-trip test if none exists).
4. For the two dependencies that degrade gracefully (colyseus msgpack/protobuf JIT, pdf.js), write a test that blocks eval and asserts the fallback is taken (colyseus connects and exchanges one message; pdf.js renders one page). Execute the degradation; do not assume it.
5. Triage the remaining hits (`src/scene-studio/remote-scene.js`, `src/scene-studio/vendor/js/libs/app.js`, `public/scene-studio/...`): for each `eval`/`new Function`, remove it or record why it only runs inside `/scene-studio`.
6. Edit `vercel.json`, one edit per CSP string: add `'wasm-unsafe-eval'` to the global `script-src` and remove `'unsafe-eval'` from it and from every per-route policy that does not need it. Keep `'unsafe-eval'` only on the `/scene-studio` route group, moved into its own entry so the exception is one reviewable block; evaluate removing it there too (if acorn's `new Function` is only the script-editor feature, lazy-load it and document the remaining need) without breaking scene-studio. Update `tests/csp-*.test.js` and the header comparison in `audit-csp` in the same change, since they consume the same table.
7. Guard against regression: extend `scripts/audit-csp.mjs` (or `scripts/lib/csp-headers.mjs`) and `tests/csp-headers-compare.test.js` with an assertion, with the allowed route list as data, that no `vercel.json` CSP outside it contains the bare token `'unsafe-eval'` (token match, so `'wasm-unsafe-eval'` is allowed). Show the test failing on a deliberately reintroduced value, then passing.
8. Soak before shipping: `npm run build`, start `node server/index.mjs`, then `node scripts/audit-csp.mjs --all --base http://127.0.0.1:8099`. Any violation names the next eval user; fix at the source and repeat. Also drive these in a real browser with a clean console: `/` (viewer, open a GLB, including a Draco-compressed one), `/studio`, `/forge` (Draco / meshopt GLBs), `/agora`, `/play`, `/dashboard`, a pdf.js viewer, and `/scene-studio` (still works with eval). Add a Playwright test that loads `/`, `/studio`, `/viewer` and the other `audit:csp` default routes under a policy with no `'unsafe-eval'` and asserts zero `securitypolicyviolation` events and zero page errors.
9. Stage the rollout: ship first as `Content-Security-Policy-Report-Only` carrying the stricter policy next to the enforced one for a day (the existing `report-uri /api/client-errors` collects hits), read the violations from the client-errors table, then flip to enforced. If the route table cannot express two headers, add a small Report-Only option in `server/index.mjs` rather than in the pages.
10. Update H12 in `docs/security/SECURITY_AUDIT.md` to "fixed (eval scoped to /scene-studio)" with the date and measured before/after counts from Step 0, `docs/security/SECURITY_REMEDIATION.md` item 7, and the one-line present-day note in `docs/security/review-2026-06-24.md`. Add a plain-language `data/changelog.json` entry ("Tighter script policy on every page except Scene Studio") and run `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node scripts/audit-csp.mjs --all` against a local production build reports zero violations, zero page errors and zero 404s, and `--headers-only` against local matches the route table.
- [ ] `grep -c "'unsafe-eval'" vercel.json` shows only the scene-studio group, `grep -c "wasm-unsafe-eval" vercel.json` is at least 1, and the token test passes (and was shown failing on a reintroduced value).
- [ ] `npx vitest run tests/csp-hashes.test.js tests/csp-headers-compare.test.js tests/csp-script-hosts.test.js` plus the new cwise, Draco and eval-blocked fallback tests pass.
- [ ] Manual browser pass of the listed flows with the console clean, including a Draco-compressed GLB and scene-studio opening a scene.
- [ ] After the owner deploys, `node scripts/audit-csp.mjs --headers-only --base https://three.ws` is clean (record the command in the report).
- [ ] H12 in `docs/security/SECURITY_AUDIT.md`, `docs/security/SECURITY_REMEDIATION.md` and `data/changelog.json` updated; `npm run build:pages` run.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A page breaks without eval and no replacement exists | Lazy-load the dependency only on the route that needs it and give that route its own CSP block (for scene-studio keep `'unsafe-eval'` on that single route group only), record the exact file and reason in H12, and continue. Never keep the global exception |
| Production header verification needs a deploy | Verify locally with `audit-csp` against a built server; the single remaining step is the owner deploy (`npm run deploy:gcp:full`) which the Gates section covers |
| `audit-csp` is slow or flaky under load | Run `--all` in chunks by passing explicit paths, on a quiet machine, with `CONCURRENCY` low; use `--headers-only` for the full catalogue; never accept a timed-out page as clean |
| `package-lock.json` cannot be read by tooling | Use `npm ls <pkg>` and `npm explain <pkg>` instead |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Shipping the stricter header to production is a deploy and needs the owner's approval. Prepare the change, the local proof, and the Report-Only variant, then ask once at the end of the session with the one deploy command. No other gate.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/714-plan-security-csp-drop-unsafe-eval.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `714-plan-security-csp-drop-unsafe-eval.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material

The planning docs this order was derived from. They are referenced rather than inlined so this order stays under the 50,000-character paste limit: read each one before Step 0. Where a source still exists, the live file may be newer than this order: re-read it, and trust the code over both.

- `docs/security/SECURITY_AUDIT.md` (section "H12")
- `docs/security/review-2026-06-24.md`
- `docs/security/SECURITY_REMEDIATION.md`
