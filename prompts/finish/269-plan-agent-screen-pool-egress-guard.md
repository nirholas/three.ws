# Agent screen caster refuses private-network targets at the request level, not just the typed hostname

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/269-plan-agent-screen-pool-egress-guard.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 70 of 100 inside the tier). **Area:** agent-screen. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

This is an SSRF defect: a user-steerable browser reaches internal and metadata addresses and returns their contents as public screenshots. It is P1 and independent of the pool deploy order.

The agent screen pool runs a shared Chromium that owners can steer (a control lease lets an owner click, type and navigate) and that casts the result to the public agents wall. The navigation guard, `isNavAllowed` in `workers/agent-screen-pool/control.js` (mirrored in `src/shared/agent-screen-control.js`), checks only the literal hostname of the URL typed in. The doc states DNS rebinding is "out of scope for this version". As a result a public hostname that resolves to a private address, an HTTP redirect from a public page to `http://10.x`, `http://169.254.169.254` or an internal host, and subresource requests are all unchecked, while the page contents are streamed back as screenshots to whoever holds the lease. The same guard protects the owner-supplied `homeUrl` in `resolveUrl` (`workers/agent-screen-pool/index.js`).

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `workers/agent-screen-pool/control.js`: `isNavAllowed(rawUrl)` blocks non-http(s), localhost, `.internal`, `::1`, fe80, fc/fd IPv6 prefixes and private IPv4 literals. It never resolves DNS.
- `workers/agent-screen-pool/index.js`: `chromium.launch` and one `browser.newContext` (lines ~150-155). `grep -n "route(\|setRequestInterception" workers/agent-screen-pool/*.js` returns nothing, so there is no request-level interception and redirects and subresources are not checked.
- Tests: `tests/agent-screen-control.test.js`, `tests/agent-screen-worker-compliance.test.js`, `tests/agent-screen-worker-smoke.test.js`, `tests/agent-screen-caster.test.js`.
- The worker is deployed standalone (`workers/agent-screen-pool/Dockerfile`, `cloudbuild.yaml`) and cannot import repo-shared code, so the guard is duplicated by design; a drift check test exists or should be added.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
grep -n "route(\|setRequestInterception\|dns\|lookup" workers/agent-screen-pool/*.js
sed -n 25,60p workers/agent-screen-pool/control.js
sed -n 140,185p workers/agent-screen-pool/index.js
diff <(sed -n '/function ipv4Parts/,/^export function isNavAllowed/p' workers/agent-screen-pool/control.js) <(sed -n '/function ipv4Parts/,/isNavAllowed/p' src/shared/agent-screen-control.js) | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Test-first: in `tests/agent-screen-control.test.js` (or a new `tests/agent-screen-egress-guard.test.js`) write failing tests against a new `isAddressAllowed(ip)` and `assertResolvedPublic(hostname)` helper: a name resolving to 10.0.0.1, 127.0.0.1, 169.254.169.254, 100.64.0.1, ::1, fc00::1 and IPv4-mapped IPv6 (`::ffff:10.0.0.1`) is refused; a name resolving to a public address is allowed; decimal/octal/hex IPv4 forms (`http://2130706433/`, `http://0x7f.1/`) are refused.
2. In the worker, install a Playwright `context.route('**/*', ...)` handler that applies to every request (main frame, redirects, subresources, websockets via `routeWebSocket` where supported): resolve the hostname with `dns.promises.lookup({all:true})`, refuse the request if any returned address is non-public, and `route.abort('blockedbyclient')`. Cache verdicts for a few seconds to bound DNS cost. Redirect hops are re-checked because Playwright routes each hop.
3. Close the rebinding window: for navigation requests, after the route check, verify the connected remote address on the response (`response.serverAddr()`) and abort/blank the page if it is non-public.
4. Apply the same resolved-address check to `homeUrl` in `resolveUrl` and to the `nav` control event path in `control.js`; keep `isNavAllowed` as the cheap first filter.
5. Keep the API-side mirror (`src/shared/agent-screen-control.js`) and the worker copy in sync and add a test that fails if the literal-IP block lists differ between the two.
6. Update `docs/agent-screen-control.md` (remove "DNS-rebinding is out of scope", document the request-level guard and its limits), `workers/agent-screen-pool/README.md`, and add a `data/changelog.json` entry.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] The new egress tests failed before the change (record the failing assertion) and pass after: `npx vitest run tests/agent-screen-control.test.js tests/agent-screen-egress-guard.test.js`.
- [ ] A local run of the worker against a local HTTP server that 302-redirects to `http://127.0.0.1:<port>/secret` shows the redirect is aborted and the secret is never served into a frame.
- [ ] `grep -n "DNS-rebinding" docs/agent-screen-control.md` no longer says "out of scope".
- [ ] `node --test`/vitest `tests/agent-screen-worker-smoke.test.js` and `tests/agent-screen-worker-compliance.test.js` still pass.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Cannot reproduce rebinding with real DNS in the sandbox | Stub `dns.promises.lookup` at the module boundary in tests and use a local redirecting HTTP server for the end-to-end redirect case. |
| Playwright version lacks `serverAddr()` | Rely on the route-time DNS check plus a per-request re-check, and note the narrower guarantee in the doc. |
| Legit agent tasks need an internal host | None do: tasks navigate real public sites (`workers/agent-screen-pool/tasks/`). The base URL for three.ws itself is public. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/269-plan-agent-screen-pool-egress-guard.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `269-plan-agent-screen-pool-egress-guard.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/agent-screen-control.md` (section "Limits and what is next")

~~~~markdown
## Limits and what is next

- **Latency** is a few hundred milliseconds (a queued, polled channel), which feels like a responsive remote desktop for browsing, not like a local mouse. A future WebRTC transport will tighten it for a full desktop.
- **One browser tab** per agent today. Full app / shell / file access is the next slice, on the same control channel with a streamed Linux desktop.
- **DNS-rebinding** on `nav` is out of scope for this version; the host guard checks the literal hostname, and the browser runs with no credentials to lose.

Related: [the caster pool behind the live screen](../workers/agent-screen-pool/README.md), the [live agents wall](https://three.ws/agents-live).
~~~~

