# Close the 2026-10-25 security audit (32 unvalidated findings) and sweep the seven surfaces it never reached

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/260-plan-security-close-oct25-audit-and-sweep-gaps.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 82 of 100 inside the tier). **Area:** security. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

The October 25 audit ran out of agent budget. It left 17 `needs_validation` records and 15 hunter-reported fingerprints that nobody independently verified, and its own coverage ledger says 47 of 68 units were never hunted, including seven whole surfaces the critic found (AWS Marketplace linking and SNS events, inference node operators, agent commerce and A2A mandates, account and credential CRUD, plugin and LobeHub registry, paid upstream RPC/SDP/pinning proxies, teams runtime and social ingestion). Git history shows many of the 17 were fixed afterwards (tty SSRF, oracle follow and test-alert proof of chat control, vault zero-share deposit, createAgent owner gate, rebalance timing floor, agent-ask unpublished agents, strategy-run daily cap reservation, CAD forge O_NOFOLLOW, DNS rebinding in the MCP bridge, domain-register contact binding, direct run.app forwarded-hop trust, presign inherited content types, Go chat server now requires a password or generates a token). Nobody recorded which are closed with a regression test and which are not, so the report still reads as 32 open issues, and the unexamined surfaces handle money (AWS Marketplace billing, inference payouts, A2A mandates) and credentials.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `docs/security/audit-2026-10-25/` holds REPORT.md, NEEDS-VALIDATION.md (17 records with a local check each), FINDINGS-DETAIL.md and findings.json. No closure record exists.
- Fixed per `git log` since 2026-10-25 (verify each has a test): `c67769be5` tty, `2753f9403` oracle follow/test-alert, `2ecf6c61d` vault shares, `fd08959cf` createAgent/rebalance, `8288a51bd` agent-ask, `bf3b376ca` strategy-run cap, `a1c319fb5` CAD forge, `e2a44bed5` DNS rebinding, `82a1eae32` domain contact + persona spend cap, `93f4a514e` run.app forwarded hops, `aab4241d9` presign content type, and `chat/server` auth in `chat/server/main.go` (password flag or generated token).
- Not obviously fixed (grep found no commit or test): chat proxy OpenRouter body passthrough (`chat-proxy-openrouter-body-passthrough-bypasses-free-model-gate`), third-party persona driving visitor home tools, agent update with an unowned `avatar_id`, sign-in completion login CSRF (Telegram, SAML, handoff GET), Walk Avatar extension token injection, and these fingerprints: home-call-gate-first-entity-only-bypass, home-call-scope-ignores-area-device-targets, mcp-automation-spend-confirm-unbound-write-tier, multiplayer-studio-room-owner-id-client-asserted-and-broadcast, skill-import-github-server-token-private-readme-disclosure, upload-presign-anon-declared-size-not-enforced-public-bucket, webhooks-delivery-claim-before-apply-no-release-shopify-shop-redact, webhooks-discord-activity-session-unbound-room-and-token-audience, x402-modal-merchant-402-challenge-fields-unescaped-innerhtml, x402-pay-execute-budget-rollback-on-402-after-signed-transfer-handed-to-host.
- Unexamined surface code lives at: `api/aws-marketplace/{link,register,subscription,issue-key}.js`, `api/_lib/aws-marketplace*.js`, `api/inference/{[action],livepeer}.js`, `api/_lib/inference-{billing,jobs,nodes}.js`, `api/_lib/a2a/{mandate,cart-mandate,reputation-gate,platform-ceiling}.js`, `api/_lib/a2a-hire-phases.js`, `api/plugins/[action].js`, `api/lobehub/`, `api/chat-plugin/`, `api/pinning/[action].js`, `api/sdp/[...path].js`, `api/evm-rpc.js`, `api/solana-rpc.js`, `api/teams/`, `api/team-chat.js`, `api/social/`.
- Hardening notes in the ledger still open: agent-wallet get-or-create not atomic, `createApprovalRequest` does not compare payload hashes, marketplace versions and analytics lack publish filters.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
cd /home/user/three.ws
git log --oneline --since=2026-10-25 -i --grep='ssrf\|oracle\|vault\|agent-ask\|spend\|csrf\|presign\|rebinding\|persona\|forwarded\|cad-forge\|sanitiz\|escape'
# for each of the 17 slugs and 15 fingerprints, find a regression test that names it or its route
for s in tty oracle vault createagent rebalance agent-ask strategy presign rebinding forwarded cad-forge openrouter handoff walk-avatar x402-modal pay-execute; do echo "== $s"; grep -rli "$s" tests | head -3; done
node -e "const f=require('./docs/security/audit-2026-10-25/findings.json');console.log(Array.isArray(f)?f.length:Object.keys(f).length)"
npm run check:rules -- --paths docs/security
```

Build a scratch table (not committed) of slug, status (fixed with test / fixed without test / open / not reproducible), evidence. Skip anything already closed with a passing regression test.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. For every record marked "fixed without test", add the missing regression test beside the module's existing tests (`tests/*.test.js`, `tests/api/*.test.js`, Foundry tests under `contracts/*/test` for contracts). The test must fail against the pre-fix commit (check out the parent commit's file into a temp dir or revert the hunk locally) and pass now.
2. For every record still open, work test-first. Write the local check from NEEDS-VALIDATION.md as an automated test, run it, confirm it fails for the reason the record states, then fix:
   - Chat proxy: allowlist the forwarded OpenRouter body fields (model must end in `:free`, drop `models`, `plugins`, `provider`, clamp `max_tokens`) in the anonymous chat proxy handler; test in `tests/` beside the existing chat proxy tests.
   - Third-party persona vs visitor home tools: a published agent's persona and skills must not share a prompt with a signed-in visitor's home tools without an owner-of-home confirmation step; every home action initiated in a turn the visitor did not request needs the existing confirm gate.
   - Agent update `avatar_id`: reject an avatar the caller does not own (404/403) in `api/agents/` update and the public manifest builder.
   - Login CSRF: bind Telegram callback to the `tgflow` cookie, reject unsolicited SAML responses (`InResponseTo` check), and keep the iOS handoff GET working (add a one-time, device-bound nonce rather than removing the flow).
   - Walk Avatar extension (`extensions/walk-avatar/`): require a `state` value minted by the extension and verified on the auth-callback before storing a token.
   - Each unverified fingerprint: read the named code, reproduce or refute with a test, fix if reproduced. Refuted ones are recorded as such with the test that proves the guard.
3. Sweep the seven unexamined surfaces. For each, read every handler under the paths above and review: authentication and ownership on every verb (IDOR on ids), request signature verification (AWS SNS message signature and `SubscriptionURL` host allowlist, marketplace token replay), SSRF on any fetch of a caller URL (must use `fetchSafePublicUrlPinned`), spend and ledger idempotency (inference billing and A2A mandate settlement must be replay-safe and capped by `platform-ceiling.js`), mass assignment on credential CRUD, rate limits on the paid upstream proxies, response-body caps, and error leakage. Write a failing test for each defect found, then fix it.
4. Fix the three hardening notes: make agent-wallet get-or-create atomic (unique constraint plus `ON CONFLICT`), make `createApprovalRequest` compare the payload hash on reuse, add `published` filters to marketplace versions and analytics queries.
5. Write `docs/security/audit-2026-10-25/CLOSURE.md` (internal tree, stays out of the public site per `docs/internal/README.md` rules): one row per record with status, commit, and test file. Update `REPORT.md` header with a pointer to it. Do not edit findings.json history.
6. Add a `data/changelog.json` entry only if a user-visible behavior changed (for example login flow or a refused request); then `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `docs/security/audit-2026-10-25/CLOSURE.md` lists all 17 records, all 15 fingerprints and all 7 surfaces with a status, and no row says "unknown".
- [ ] Every row marked fixed names a test file; `grep -c` of those test names in `npm test` output shows they run and pass.
- [ ] Each defect fixed in this order has a test that was observed failing before the fix (state the failure line in the report).
- [ ] `npm test` passes; Foundry suites for any touched contract pass (`forge test` in the contract directory).
- [ ] `npm run audit:guards` and `npm run audit:mcp-safety` report no new findings.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Cannot run a candidate against production | Findings are source-level. Reproduce against local handlers with the `tests/` harness and a stubbed DB or fetch, never against production. |
| Contract changes would need a redeploy | Fix source and Foundry tests only. A redeploy of a deployed contract is an owner on-chain action; list it as the single remaining owner step with the exact command. |
| A fix would change a working flow (iOS handoff, free chat lane) | Add the new check additively and keep the legacy path behind the same entry point; prove with the existing flow's test. |
| The record is a false positive | Write the test that proves the guard holds, mark it refuted in CLOSURE.md. A refutation needs evidence, not a note. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/260-plan-security-close-oct25-audit-and-sweep-gaps.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `260-plan-security-close-oct25-audit-and-sweep-gaps.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/security/audit-2026-10-25/REPORT.md` (whole file)

~~~~markdown
# Security audit report: three.ws (run-1)

**Candidate validation is incomplete.** The 50-agent budget ran out after 17 of 32 candidates were independently re-checked. These 15 fingerprints were reported by hunters but never independently verified. They are kept out of findings.json and listed in their ledger units as unresolved:

- home-call-gate-first-entity-only-bypass
- home-call-scope-ignores-area-device-targets
- mcp-automation-spend-confirm-unbound-write-tier
- mcp-bridge-url-guard-dns-rebinding-toctou
- mcp-domain-register-contact-not-bound-to-quote
- mcp-persona-spend-session-cap-keyed-by-caller-session-id
- multiplayer-studio-room-owner-id-client-asserted-and-broadcast
- rate-limit-client-ip-xff-spoof-direct-cloud-run
- skill-import-github-server-token-private-readme-disclosure
- upload-presign-anon-declared-size-not-enforced-public-bucket
- upload-presign-content-type-prototype-lookup-bypass-siblings
- webhooks-delivery-claim-before-apply-no-release-shopify-shop-redact
- webhooks-discord-activity-session-unbound-room-and-token-audience
- x402-modal-merchant-402-challenge-fields-unescaped-innerhtml
- x402-pay-execute-budget-rollback-on-402-after-signed-transfer-handed-to-host

## Scope and method
- Profile: quick (one hunter wave of 26 coarse units, one final coverage critic). This is a partial pass. It does not say the rest of the repo is safe.
- Source-only. No OS sandbox was available, so no target code was run and nothing was probed on the network. Because of that, no finding is `confirmed` and none has a severity. The 17 records are `needs_validation`.
- Agents spent: 50 of 50 (6 recon, 26 hunters, 1 critic, 17 verifiers).
- No prior runs exist for this repo.
- Deviation: hunters read the skill files by path instead of receiving the blocks pasted into their prompts.
- Hunter results for covered units did not record per-file review lists, so a covered unit's reviewed paths are its assigned starting paths plus any traced files. Treat "covered" as "sampled by one hunter", not "audited".
- Source ref: see run-metadata.json.

## Coverage counts
{'deferred': 47, 'candidate': 20, 'covered': 1} units in coverage-ledger.json (68 total). Deferred units are hunter-reported gaps, 7 surfaces the critic found, and 5 covered units the critic reopened (h01, h03, h04, h15, h18). Under the quick profile they were not hunted.

## Critic-found surfaces not examined
AWS Marketplace linking and SNS events; inference node operators; agent commerce and A2A mandates; account and credential CRUD; plugin and LobeHub registry; paid upstream RPC/SDP/pinning proxies; teams runtime and social seed ingestion.

## Needs-validation records (17), highest verifier priority hint first
- [high] chat-server-tool-server-unauthenticated-shell-default: Go chat tool server exposes shell, file write and arbitrary file read with no auth by default, all interfaces, wildcard CORS
- [high] contracts-agentpayments-createagent-caller-chosen-authority-token-squat: createAgent authority gate is vacuous, letting the first caller squat any agentToken
- [medium] api-ssrf-tty-guard-bypass-redirect-follow-unpinned-fetch: Unauthenticated /api/tty SSRF guard bypassed by redirect-following, unpinned fetch
- [medium] business-logic-vault-deposit-zero-share-mint-donation-inflation: Vault deposit can mint zero shares after an outside donation inflates NAV
- [medium] chat-proxy-openrouter-body-passthrough-bypasses-free-model-gate: Anonymous chat proxy forwards full request body to OpenRouter on platform key; extra fields can reach non-free models/paid features
- [medium] chat-third-party-persona-drives-visitor-home-tools: Published agent's third-party persona/skills share a prompt with a signed-in visitor's home tools, executed under visitor authority
- [medium] contracts-hood-portfolios-rebalance-targets-unbounded-creator-drain: Portfolio creator can propose unbounded rebalance targets and drain via open fillRebalance
- [medium] custody-spend-policy-daily-cap-ignores-strategy-run-buys: Strategy-run buys count as zero toward the agent daily SOL cap
- [medium] glb-media-cad-forge-policy-frame-attribute-escape: CAD Forge static policy does not block frame/code-object attributes (generator frame walk to real globals/builtins)
- [low] agents-access-control-agent-update-unowned-avatar-id-public-manifest-body-uri: Agent update accepts an avatar_id the caller does not own; public manifest emits its CDN URL
- [low] ai-llm-agent-ask-anonymous-working-memory-poisoning: Anonymous agent-ask visitors write working-tier memories injected into the owner's chat prompt
- [low] ai-llm-agent-ask-unpublished-persona-skills-disclosure: agent-ask serves unpublished agents' private persona, system prompt and custom skills to anonymous callers
- [low] api-auth-login-csrf-unbound-signin-completion: Sign-in completion endpoints issue a session without binding to the initiating browser (login CSRF)
- [low] business-logic-oracle-follow-unauthenticated-chat-subscription-tamper: Oracle follower subscriptions are unauthenticated and keyed by caller-supplied Telegram chat_id
- [low] business-logic-oracle-test-alert-arbitrary-chat-html-injection: Oracle test-alert sends unescaped owner-controlled HTML to an arbitrary chat from the platform bot
- [low] extensions-walk-avatar-auth-callback-token-injection-no-state-binding: Walk Avatar extension stores any token from a three.ws auth-callback URL (login CSRF / session fixation)
- [low] glb-media-cad-forge-collect-follows-child-symlink: CAD Forge parent reads child-controlled artifact paths with symlink-following open

Priority hints are the verifiers' non-binding opinion, not severity.

## Hardening notes
Recorded per unit as hardening_notes in coverage-ledger.json. Examples: agent-wallet get-or-create is not atomic; createApprovalRequest does not compare payload hashes; ThreeWSFactory CREATE2 is permissionless; marketplace versions and analytics lack publish filters; global CSP allows unsafe-inline and unsafe-eval.

## Reading order
Start with chat chat/server shell default (high hint), AgentPayments createAgent squat (high hint), then the medium hints. Each record in NEEDS-VALIDATION.md has a local test plan.
~~~~

### `docs/security/audit-2026-10-25/NEEDS-VALIDATION.md` (whole file)

~~~~markdown
# Needs validation

Each item lists the exact blocker and the safe check that resolves it.

## Agent update accepts an avatar_id the caller does not own; public manifest emits its CDN URL

`agents-access-control-agent-update-unowned-avatar-id-public-manifest-body-uri`

Blockers:
- Attacker needs the victim's unguessable avatar UUID; no leak source confirmed.
- Whether /cdn/<key> or r2.dev serves private-visibility keys without auth (api/cdn-object.js suggests the bucket is public).
- Not executed.

Local check: Two dummy users: A PATCHes own agent with B's private avatar_id, then fetch the public manifest and registration unauthenticated and check for B's CDN URL; test whether the URL serves bytes without auth.

Deployment check: Owner checks whether private avatar keys are fetchable without auth and whether avatar UUIDs leak.

## Anonymous agent-ask visitors write working-tier memories injected into the owner's chat prompt

`ai-llm-agent-ask-anonymous-working-memory-poisoning`

Blockers:
- Model compliance with injected text unobserved.
- Production send-sol env (recipient lock, demo token, caps) and GUARDIAN_DISABLE unknown.
- Memories are not public by default, so only the owner chat is exposed.

Local check: POST anonymous /api/agent-ask with a marker instruction, then chat as owner and check the marker appears in recalled memory and the system prompt but not for a non-owner.

Deployment check: Owner checks prod send-sol env and counts anon-originated working rows on a test agent.

## agent-ask serves unpublished agents' private persona, system prompt and custom skills to anonymous callers

`ai-llm-agent-ask-unpublished-persona-skills-disclosure`

Blockers:
- Leak reliability against the model unproven.
- Needs an unpublished agent UUID; check whether any public surface leaks it.
- Product intent for agent-ask on unpublished agents unclear.

Local check: Dummy DB with unpublished agent holding marker strings; anonymous POST /api/agent-ask asking to repeat instructions; compare with /api/chat.

Deployment check: Owner tests own unpublished agent unauthenticated; checks public exposure of unpublished UUIDs.

## Sign-in completion endpoints issue a session without binding to the initiating browser (login CSRF)

`api-auth-login-csrf-unbound-signin-completion`

Blockers:
- Telegram and SAML may not be enabled in production.
- SAML InResponseTo handling untraced.
- Handoff GET is bearer by design for iOS; any fix must keep that flow.
- Attacker needs an account and a victim click.

Local check: Mint a handoff code as A, open the exchange GET in a session signed in as B and confirm the session switches to A; repeat Telegram callback without tgflow cookie and SAML with an unsolicited response.

Deployment check: Confirm Telegram/SAML enabled in prod; any edge origin check on handoff exchange.

## Unauthenticated /api/tty SSRF guard bypassed by redirect-following, unpinned fetch

`api-ssrf-tty-guard-bypass-redirect-follow-unpinned-fetch`

Blockers:
- Redirect following and rebinding not exercised.
- Whether Cloud Run egress reaches useful internal services.
- GCP metadata needs a header this fetch cannot send.
- Response must be a valid GLB to render.

Local check: Two loopback fixtures, first 302s to second; with a test DNS allowance call resolveSource and loadModel and confirm the second is hit; add a regression test.

Deployment check: Staging: point ?src at owned public host redirecting to an internal canary; check canary log and Cloud Run egress reachability.

## Oracle follower subscriptions are unauthenticated and keyed by caller-supplied Telegram chat_id

`business-logic-oracle-follow-unauthenticated-chat-subscription-tamper`

Blockers:
- Telegram delivers only to chats that started the bot.
- Production rate-limit values unknown.
- Unauthenticated access is documented as intended.

Local check: Anonymous POST, GET, DELETE with a chat_id the caller does not control on a test DB and bot; confirm rows change and alertFollowers delivers.

Deployment check: Staging: anonymous POST/DELETE/GET with arbitrary chat_id.

## Oracle test-alert sends unescaped owner-controlled HTML to an arbitrary chat from the platform bot

`business-logic-oracle-test-alert-arbitrary-chat-html-injection`

Blockers:
- Agent-name write path may restrict characters (not traced).
- Delivery needs the target chat to have started the bot.
- oracleTelegramTestIp ceiling not checked.

Local check: With Telegram stubbed, create an agent named with an anchor tag, POST test-alert with another chat_id and inspect the sendMessage payload.

## Vault deposit can mint zero shares after an outside donation inflates NAV

`business-logic-vault-deposit-zero-share-mint-donation-inflation`

Blockers:
- Not executed.
- transferUsdcGuarded spend policy may impose a minimum amount.
- Vault creation gating not examined.
- No min_shares parameter makes loss silent.

Local check: Unit test sharesForDeposit(1n, 1_000_000_000n, 1n) returns 0n; then on devnet or mocks: deposit 1 atomic, donate USDC to vault_address, second deposit mints 0 shares.

Deployment check: Check transferUsdcGuarded and prod config for minimum deposit.

## Anonymous chat proxy forwards full request body to OpenRouter on platform key; extra fields can reach non-free models/paid features

`chat-proxy-openrouter-body-passthrough-bypasses-free-model-gate`

Blockers:
- OpenRouter handling of models/plugins/provider with a :free primary and whether the key is charged.
- Whether the key has paid credits.
- Actual chatIp limit values.

Local check: Stub fetch, POST a :free model with models, plugins and a large max_tokens, assert the upstream body contains them, then add an allowlist and assert they are dropped.

Deployment check: Owner reviews OpenRouter activity for non-:free generations/plugin charges on the proxy key; test with spend-capped staging key.

## Go chat tool server exposes shell, file write and arbitrary file read with no auth by default, all interfaces, wildcard CORS

`chat-server-tool-server-unauthenticated-shell-default`

Blockers:
- Launch mode of the shipped binary (password flag, firewall, loopback proxy) unknown.
- shell.go and toolfns.go sinks not independently re-read.

Local check: In an isolated VM run with no flags; send a preflight and POST /tool Shell id with a foreign Origin from another host; GET /read_file; repeat with -password set.

Deployment check: Check released docs/commands for omitted -password.

## Published agent's third-party persona/skills share a prompt with a signed-in visitor's home tools, executed under visitor authority

`chat-third-party-persona-drives-visitor-home-tools`

Blockers:
- Model compliance with the injected persona unobserved.
- Classifier guarded verdict per service not read.
- Role scoping may limit guest targets.

Local check: Stub the LLM to return a home tool call; owner A publishes an agent, visitor B has a home membership and mock bridge; confirm an unguarded service executes with B's userId and no confirmation; dump classifier verdicts.

Deployment check: Owner reviews home action logs for agent-actor actions in turns where visitor did not request them and agent not owned by visitor.

## createAgent authority gate is vacuous, letting the first caller squat any agentToken

`contracts-agentpayments-createagent-caller-chosen-authority-token-squat`

Blockers:
- Not executed.
- Deployment status and whether funds are held.
- Whether the platform owner pre-registers legitimate tokens.
- Whether an owner-side reassign or remove function exists (not checked).

Local check: Foundry test: attacker createAgent(token, attacker, 0); real creator call reverts AgentExists; payer acceptPayment; attacker withdraws.

Deployment check: Owner checks deployment and registered agents.

## Portfolio creator can propose unbounded rebalance targets and drain via open fillRebalance

`contracts-hood-portfolios-rebalance-targets-unbounded-creator-drain`

Blockers:
- Not executed.
- Deployed portfolios, delay values and third-party TVL unknown.
- Depositors may redeem during the timelock.
- Constituents are creator-chosen and visible before deposit.

Local check: Foundry test in contracts/hood-portfolios/test: zero delay, valuable and worthless constituents, targets [0, huge], fill by a colluder, assert depositor loss; repeat with a nonzero delay and redeem early.

Deployment check: Owner checks deployed portfolios and balances.

## Strategy-run buys count as zero toward the agent daily SOL cap

`custody-spend-policy-daily-cap-ignores-strategy-run-buys`

Blockers:
- Not executed.
- Whether strategy-run is deployed and reachable.
- Whether delegated or scoped keys are constrained by daily_sol_cap.

Local check: Run a mocked live strategy buy through makeRuntime, confirm payload has amountSol and no solAmount, then checkBuyAllowed with 4.9 SOL spent and expect a block.

Deployment check: Owner sums strategy-run buys per agent per day against daily_sol_cap.

## Walk Avatar extension stores any token from a three.ws auth-callback URL (login CSRF / session fixation)

`extensions-walk-avatar-auth-callback-token-injection-no-state-binding`

Blockers:
- Extension not loaded; storage overwrite unconfirmed.
- Whether APIs attribute to the bearer user when no cookie is present.
- Victim must be induced to navigate to the crafted URL.

Local check: In a throwaway Chrome profile load the extension, mint B's token, open the callback URL while signed out and confirm threews_session is overwritten; repeat while signed in as A.

Deployment check: Two test accounts; victim signed out; check attribution of /api/avatars/mine and /api/tts/speak and whether attacker can see text.

## CAD Forge parent reads child-controlled artifact paths with symlink-following open

`glb-media-cad-forge-collect-follows-child-symlink`

Blockers:
- Needs a companion policy-escape or native primitive in the child.
- Whether production runs as uid 0 and what /proc/1/environ holds.
- Whether getsize on /proc files bypasses the cap.

Local check: As root in the built image run main.run_build with a test-double child that writes part.glb as a symlink to a root-only dummy file; expect _collect to return its bytes.

Deployment check: Owner: confirm container uid 0 and /proc/1/environ contents.

## CAD Forge static policy does not block frame/code-object attributes (generator frame walk to real globals/builtins)

`glb-media-cad-forge-policy-frame-attribute-escape`

Blockers:
- Code not executed; the frame chain on the deployed Python version is inferred.
- Whether the program text can be steered by the user or is only LLM-generated.
- Seccomp, uid drop and rlimit effectiveness under Cloud Run.
- Whether secrets are readable by the sandbox uid.

Local check: Feed sandbox_child.py via test_sandbox.py a generator-based program that reads f_back.f_back.f_globals['os'] and f_builtins['open']; expect a policy refusal; if it runs, add a test to test_cad_policy.py.

Deployment check: Owner: confirm /health seccomp_required true, root->nobody drop, canary build refused.
~~~~

### `docs/security/audit-2026-10-25/FINDINGS-DETAIL.md` (whole file)

~~~~markdown
# Findings detail

All records are `needs_validation` (source-only run, nothing executed).

## Agent update accepts an avatar_id the caller does not own; public manifest emits its CDN URL

Fingerprint: `agents-access-control-agent-update-unowned-avatar-id-public-manifest-body-uri`

api/agents.js handleUpdate sets avatar_id = COALESCE(body.avatar_id, avatar_id) with no avatars.owner_id check (handleCreate checks at 308-312). Unauthenticated manifest/registration in api/agents/_id/_sub.js join the avatar and call resolveAvatarUrl with visibility hardcoded 'public', emitting the private avatar CDN URL in body.uri and registration. Verifier assessment: Source path holds: handleUpdate writes avatar_id with no owner check; public manifest/registration emit the CDN URL. Attacker needs the victim's random avatar UUID and the CDN may already be public. Non-binding priority hint: low. Suggested fix: Validate UUID and require avatars.owner_id = caller in handleUpdate as handleCreate does; in public manifest/registration only emit URLs for public or unlisted avatars owned by the agent owner.

Claimed root cause: Missing ownership check on update; public resolver forces public visibility.

Trace:
- entrypoint: api/agents.js:447
- propagation: api/agents.js:533
- propagation: api/agents/_id/_sub.js:378
- propagation: api/_lib/avatars.js:545
- propagation: api/_lib/r2.js:439
- sink: api/agents/_id/_sub.js:441

Evidence:
- api/agents.js:308: create path checks avatar ownership
- api/agents/_id/_sub.js:401: visibility hardcoded public
- api/agents/_id/_sub.js:515: registration emits URL

## Anonymous agent-ask visitors write working-tier memories injected into the owner's chat prompt

Fingerprint: `ai-llm-agent-ask-anonymous-working-memory-poisoning`

agent-ask saveTurn (agent-ask.js:191, called 311) stores visitor question (<=1000 chars) and answer as agent_memories tier 'working', salience 0.2, 2h TTL. memory-store.js:481 computeContext selects all non-expired pinned or working rows; chat.js:2120 recallForChat merges them; chat.js:2198 appends '- (type) snippet' (160 char) to system prompt with no untrusted fence. Chat tools include sendSol (chat.js:402); Guardian inspects only user message. Funds impact depends on api/agent/send-sol.js:83 AVATAR_LOCK_RECIPIENT/AVATAR_DEMO_TOKEN config. Verifier assessment: Anonymous agent-ask writes visitor text to the working memory tier, which reaches the owner's chat system prompt unfenced. Rows default to non-public, sendSol is capped and guarded, so impact is bounded to the owner's own chat. Non-binding priority hint: low. Suggested fix: Do not write anonymous turns to the working tier; fence recalled snippets as untrusted data; require the user message to authorize sendSol.

Claimed root cause: Public unauthenticated write path stores attacker text in a tier the owner chat trusts; recall unfenced.

Trace:
- entrypoint: api/agent-ask.js:248
- propagation: api/agent-ask.js:311
- propagation: api/agent-ask.js:191
- propagation: api/_lib/memory-store.js:481
- propagation: api/chat.js:2120
- sink: api/chat.js:2198

Evidence:
- api/agent-ask.js:16: comment claims lowest tier avoids polluting
- api/_lib/memory-store.js:473: working = in-context-now set
- api/chat.js:402: sendSol tool offered
- api/agent/send-sol.js:83: recipient lock depends on env

## agent-ask serves unpublished agents' private persona, system prompt and custom skills to anonymous callers

Fingerprint: `ai-llm-agent-ask-unpublished-persona-skills-disclosure`

POST /api/agent-ask (agent-ask.js:248) selects agent by id and deleted_at only (261), loads agentSkillsForPrompt (289), builds system prompt with persona/system_prompt and skills (70, 290) for anonymous asker. api/chat.js:546 requires is_published OR owner; chat.js:632 says persona prompts are private IP; 685 skills only when agentVisible. Anonymous caller knowing an unpublished agent UUID can have the model reveal persona/skills. Prompt instruction not to reveal is not deterministic. Verifier assessment: agent-ask looks up agents without an is_published/owner filter and injects persona and skills into the prompt; chat.js gates the same data. Needs an unpublished agent UUID. Non-binding priority hint: low. Suggested fix: Add AND (is_published = true OR user_id = caller) to the lookup at agent-ask.js:261 and load skills only for visible agents.

Claimed root cause: Missing visibility predicate on sibling path.

Trace:
- entrypoint: api/agent-ask.js:248
- propagation: api/agent-ask.js:261
- propagation: api/agent-ask.js:289
- sink: api/agent-ask.js:290

Evidence:
- api/chat.js:546: sibling control
- api/chat.js:632: comment: private IP
- api/chat.js:685: skills gated by agentVisible
- api/agent-ask.js:70: persona and skills inserted verbatim

## Sign-in completion endpoints issue a session without binding to the initiating browser (login CSRF)

Fingerprint: `api-auth-login-csrf-unbound-signin-completion`

Handoff exchange GET (api/auth/handoff.js:98,131-132) redeems bearer code, destroySession then createSession for code owner, no origin/cookie binding (mint side line 69 requires isSameSiteOrigin). Telegram widget callback (telegram/[action].js:119 default {i:'login'} when flow cookie absent; signIn 70,180) creates session for payload identity. SAML ACS (saml/[action].js:72,119-120) accepts unsolicited POST. Attacker with own code/payload/assertion makes victim browser sign in as attacker; victim data saved under attacker account. privy/verify.js:40 enforces isSameSiteOrigin as comparable control. Session cookie SameSite=Lax (auth.js:144) so top-level GET carries/sets. Verifier assessment: Handoff exchange GET, Telegram callback without a flow cookie, and SAML ACS complete sign-in with no browser binding, so a victim can be signed in as the attacker (login CSRF). No account takeover; needs victim interaction. Non-binding priority hint: low. Suggested fix: Require the signed flow cookie on Telegram, enforce InResponseTo and bind RelayState for SAML, and add a confirm step or Sec-Fetch-Site check before the handoff replaces a session.

Claimed root cause: Completion handlers set session cookie with no per-flow browser binding.

Trace:
- entrypoint: api/auth/handoff.js:98
- propagation: api/auth/handoff.js:131
- propagation: api/auth/telegram/[action].js:119
- propagation: api/auth/telegram/[action].js:180
- propagation: api/auth/saml/[action].js:72
- sink: api/auth/saml/[action].js:120

Evidence:
- api/auth/handoff.js:69: mint side has same-site check
- api/auth/privy/verify.js:40: comparable endpoint enforces guard
- api/auth/telegram/[action].js:107: flow cookie exists but absence tolerated at 119
- api/_lib/auth.js:144: SameSite=Lax

## Unauthenticated /api/tty SSRF guard bypassed by redirect-following, unpinned fetch

Fingerprint: `api-ssrf-tty-guard-bypass-redirect-follow-unpinned-fetch`

GET /api/tty?src=<url> is unauthenticated and only IP-rate-limited. It validates src once with assertSafePublicUrl (DNS check only), then passes the URL string to packages/tty-3d loadModel, which calls global fetch with redirect:'follow' and no dispatcher pin. A public URL that 302s to an internal/metadata address passes the guard and is followed with no re-validation; DNS rebinding also works. The avatar branch passes avatar.model_url to loadModel with no SSRF check at all. Error message `could not read that model: ${err.message}` is returned to the caller. Verifier assessment: /api/tty validates the URL once then fetches with default fetch and redirect follow, so a public URL redirecting to an internal address or a rebinding host reaches internal targets. Mostly blind: the body must parse as GLB, but the error text leaks status. Non-binding priority hint: medium. Suggested fix: Pass the pinned per-hop fetcher with redirect manual to loadModel for both src and avatar.model_url branches; return a generic error.

Claimed root cause: tty.js uses assertSafePublicUrl as a one-shot pre-check and then delegates the fetch to loadModel with default global fetch and redirect:'follow', instead of the repo's pinned per-hop fetcher (fetchModel / fetchSafePublicUrlPinned).

Trace:
- entrypoint: api/tty.js:111
- propagation: api/tty.js:85
- propagation: api/_lib/ssrf-guard.js:111
- propagation: api/tty.js:144
- sink: packages/tty-3d/src/index.js:30

Evidence:
- api/tty.js:85: Guard is a pre-check only.
- packages/tty-3d/src/index.js:30: redirect:'follow', global fetch, no pin.
- api/tty.js:95: avatar.model_url passed to loadModel with no SSRF validation.
- api/_lib/fetch-model.js:79: Contrast: sibling proxies use redirect:'manual' with per-hop resolvePublicHost and pinned dispatcher.

## Oracle follower subscriptions are unauthenticated and keyed by caller-supplied Telegram chat_id

Fingerprint: `business-logic-oracle-follow-unauthenticated-chat-subscription-tamper`

api/oracle/follow.js:14 documents no auth; POST (94,131) inserts oracle_followers, DELETE (139) removes, GET (158) lists, keyed by caller-supplied (agent_id, chat_id, network); only IP rate limits. Third party can unsubscribe victim chat, subscribe chats to platform bot messages (alerts.js:349 reads same table), enumerate follows. Verifier assessment: api/oracle/follow has no auth and keys subscriptions on caller-supplied chat_id, so anyone can unsubscribe or subscribe arbitrary chats. GET is a single-pair check, not a list. Content is public signals; delivery needs the chat to have started the bot. Non-binding priority hint: low. Suggested fix: Require proof of chat control, for example a signed /start deep-link nonce bound to chat_id and agent_id, on POST and DELETE.

Claimed root cause: chat_id used as identity with no proof of chat control.

Trace:
- entrypoint: api/oracle/follow.js:14
- propagation: api/oracle/follow.js:59
- propagation: api/oracle/follow.js:94
- propagation: api/oracle/follow.js:131
- sink: api/_lib/oracle/alerts.js:349

Evidence:
- api/oracle/follow.js:158: anonymous list
- api/_lib/oracle/alerts.js:349: dispatch reads same table

## Oracle test-alert sends unescaped owner-controlled HTML to an arbitrary chat from the platform bot

Fingerprint: `business-logic-oracle-test-alert-arbitrary-chat-html-injection`

api/oracle/test-alert.js: chat_id format-validated only (22); ownership of agent only not destination (49); agentName from owner agent record (60) interpolated unescaped (61) in parse_mode HTML message (80). Low confidence: auth exists, Telegram delivers only to chats that started the bot. Verifier assessment: test-alert lets any signed-in user send a bot message with raw agent.name in HTML parse mode to any chat_id. Telegram's tag subset limits it to links and formatting; needs a chat that started the bot. Non-binding priority hint: low. Suggested fix: HTML-escape agentName; bind chat_id to a chat the caller verified.

Claimed root cause: Unescaped interpolation and unrestricted destination.

Trace:
- entrypoint: api/oracle/test-alert.js:22
- propagation: api/oracle/test-alert.js:47
- propagation: api/oracle/test-alert.js:50
- propagation: api/oracle/test-alert.js:64
- sink: api/oracle/test-alert.js:80

Evidence:
- api/oracle/test-alert.js:61: agentName unescaped
- api/oracle/test-alert.js:80: parse_mode HTML

## Vault deposit can mint zero shares after an outside donation inflates NAV

Fingerprint: `business-logic-vault-deposit-zero-share-mint-donation-inflation`

depositToVault (vault-transfer.js:99 transfers USDC first, 114 navBefore, 115 minted=sharesForDeposit with no minted>0 guard). vault-accounting.js:122 par only when shares or navBefore zero else floor(deposit*shares/navBefore). vault-wallet.js:101,124 NAV includes live on-chain USDC of public vault_address (donation-manipulable). deposit.js:44 only checks real-funds agreement; no minimum. First depositor with tiny shares donates to inflate; later smaller deposit mints 0, funds kept by existing holders. Verifier assessment: Vault deposits mint floor(deposit*shares/NAV) with NAV read from the on-chain balance, no minted>0 check, no virtual shares, no min_shares. A first-depositor donation can make a later deposit mint zero shares. Non-binding priority hint: medium. Suggested fix: Reject minted<=0 and refund; add min_shares_out; seed dead or virtual shares; require a minimum first deposit; track accounted balance.

Claimed root cause: Share pricing from donation-manipulable live balance with no zero-mint guard or virtual shares.

Trace:
- entrypoint: api/vaults/deposit.js:44
- propagation: api/vaults/deposit.js:52
- propagation: api/_lib/vault-transfer.js:99
- propagation: api/_lib/vault-transfer.js:115
- propagation: api/_lib/vault-accounting.js:122
- sink: api/_lib/vault-wallet.js:101

Evidence:
- api/_lib/vault-transfer.js:115: no positive-share guard
- api/_lib/vault-accounting.js:122: floor division
- api/_lib/vault-wallet.js:124: NAV from on-chain balance

## Anonymous chat proxy forwards full request body to OpenRouter on platform key; extra fields can reach non-free models/paid features

Fingerprint: `chat-proxy-openrouter-body-passthrough-bypasses-free-model-gate`

POST /api/chat/proxy unauthenticated, per-IP limit only. isFreeModelId (openrouter-free.js:46) checks only body.model ends ':free' (proxy.js:84). proxy.js:128 sends JSON.stringify({...body, model: activeModel}) with platform Bearer key, passing 'models' fallback, 'plugins', 'provider', large max_tokens. Billing effect unobserved. Verifier assessment: /api/chat/proxy gates only on a :free model suffix and then spreads the whole client body upstream with the platform key, so models, plugins, provider and max_tokens pass through. Billing effect depends on OpenRouter behavior. Non-binding priority hint: medium. Suggested fix: Build the upstream payload from an explicit allowlist; clamp max_tokens; cap message size.

Claimed root cause: Allowlist on one field but upstream payload built by spreading untrusted body.

Trace:
- entrypoint: api/chat/proxy.js:65
- propagation: api/chat/proxy.js:84
- propagation: api/_lib/openrouter-free.js:46
- sink: api/chat/proxy.js:128

Evidence:
- api/chat/proxy.js:84: only :free suffix check
- api/chat/proxy.js:128: whole body spread, only model overridden
- api/_lib/openrouter-free.js:46: pure string suffix test

## Go chat tool server exposes shell, file write and arbitrary file read with no auth by default, all interfaces, wildcard CORS

Fingerprint: `chat-server-tool-server-unauthenticated-shell-default`

chat/server/main.go: Addr :8081 (53), CORS origin * headers * (33), authMiddleware only when *password != "" (112) default empty (25). POST /tool InvokeTool (148) runs Shell via mvdan interp (toolfns/shell.go:214, real processes) and Edit (toolfns.go:112 arbitrary file write); GET /read_file reads any path (files.go:83). Web page in browser can hit localhost:8081; LAN host directly. Password compare is raw string 'Basic '+password, not constant-time. Request body (tool args) tee'd to stdout. Verifier assessment: The Go chat tool server defaults to no password, wildcard CORS and a listen address on all interfaces, and exposes shell, edit and file read. Any web page or LAN host could reach it if run with defaults. Non-binding priority hint: high. Suggested fix: Bind 127.0.0.1 by default; refuse to start without a password or generate a token; constant-time compare; restrict CORS; confine read_file and Edit; stop logging bodies.

Claimed root cause: Fail-open auth, non-loopback bind, wildcard CORS in front of OS command and file write surface.

Trace:
- entrypoint: chat/server/main.go:33
- propagation: chat/server/main.go:53
- propagation: chat/server/main.go:112
- propagation: chat/server/main.go:148
- propagation: chat/server/toolfns/shell.go:214
- sink: chat/server/files.go:83

Evidence:
- chat/server/main.go:25: password default empty
- chat/server/main.go:53: :8081 all interfaces
- chat/server/files.go:83: ReadFile no confinement
- chat/server/toolfns/toolfns.go:112: Edit arbitrary write

## Published agent's third-party persona/skills share a prompt with a signed-in visitor's home tools, executed under visitor authority

Fingerprint: `chat-third-party-persona-drives-visitor-home-tools`

POST /api/chat loads any published agent persona (chat.js:545,641), custom skills (688), public memories; offers home tools whenever caller has a home membership (706); model-emitted home calls run via runHomeRound/runHomeTool with visitor userId (1130,1346). Confirmation gate covers only unlock/open/disarm-class services (home/tools.js:528); other write services (lock, close, arm, scenes) execute immediately. sendSol gate applies only to gated imported skills. Verifier assessment: A published agent's persona and skills run for any visitor, and home tools are added for visitors with a home membership, so a malicious owner could try to prompt-inject unrequested home actions. Depends on model compliance and which services the classifier guards. Non-binding priority hint: medium. Suggested fix: Withhold home tools or require confirmation for every write when the agent owner differs from the caller and carries a persona or custom skills; mark persona content untrusted.

Claimed root cause: Visitor authority and untrusted third-party prompt content combined in one turn; no check that a home write was requested in the visitor message or withholding of tools for non-owned persona.

Trace:
- entrypoint: api/chat.js:545
- propagation: api/chat.js:641
- propagation: api/chat.js:688
- propagation: api/chat.js:706
- propagation: api/chat.js:1130
- propagation: api/chat.js:1346
- sink: api/_lib/home/tools.js:528

Evidence:
- api/chat.js:545: any published agent loadable
- api/chat.js:706: tool set depends only on homeCount
- api/chat.js:1346: runs with visitor identity
- api/_lib/home/tools.js:528: confirmation gate only guarded classes

## createAgent authority gate is vacuous, letting the first caller squat any agentToken

Fingerprint: `contracts-agentpayments-createagent-caller-chosen-authority-token-squat`

contracts/src/AgentPayments.sol:136-140 requires msg.sender to be owner or the caller-supplied agentAuthority, so a caller satisfies it by naming themself. First caller squats any agentToken; AgentExists blocks the real owner; acceptPayment (152) and withdraw (306) pay the squatter. Verifier assessment: createAgent accepts msg.sender == the caller-supplied agentAuthority, so any address can register any agentToken and block the real owner with AgentExists; payments then settle to the squatter. Non-binding priority hint: high. Suggested fix: Bind registration to proof of token control (owner-signed EIP-712, token owner check, or owner-only), and add an owner reassign or remove function.

Claimed root cause: Authority is taken from caller input rather than proven.

Trace:
- entrypoint: contracts/src/AgentPayments.sol:136
- propagation: contracts/src/AgentPayments.sol:139
- propagation: contracts/src/AgentPayments.sol:142
- propagation: contracts/src/AgentPayments.sol:152
- sink: contracts/src/AgentPayments.sol:306

Evidence:
- contracts/src/AgentPayments.sol:136: msg.sender == agentAuthority accepted

## Portfolio creator can propose unbounded rebalance targets and drain via open fillRebalance

Fingerprint: `contracts-hood-portfolios-rebalance-targets-unbounded-creator-drain`

Portfolio.sol:440 proposeRebalance checks only targetUnits length. Constructor (198) sets no floor on rebalanceDelay/rebalanceInterval and PortfolioFactory.sol:49 forwards creator Config. quoteFill (312) prices from creator targets and fillRebalance (473) is open to any caller, so a creator-controlled fill can extract value. Verifier assessment: Portfolio proposeRebalance bounds only the targets length and the constructor sets no minimum delay or interval, so a creator can skew targets and let fillRebalance trade at off-market prices. Depositors can redeem during a nonzero delay. Real path is contracts/hood-portfolios/src, not contracts/src/hood. Non-binding priority hint: medium. Suggested fix: Add minimum delay and interval; cap per-leg target change; add an oracle or NAV-loss limit in quoteFill.

Claimed root cause: No bounds on creator-set targets or timing parameters.

Trace:
- entrypoint: contracts/hood-portfolios/src/Portfolio.sol:440
- propagation: contracts/hood-portfolios/src/Portfolio.sol:447
- propagation: contracts/hood-portfolios/src/Portfolio.sol:198
- propagation: contracts/hood-portfolios/src/PortfolioFactory.sol:49
- propagation: contracts/hood-portfolios/src/Portfolio.sol:312
- sink: contracts/hood-portfolios/src/Portfolio.sol:473

Evidence:
- contracts/src/hood/Portfolio.sol:440: length-only check

## Strategy-run buys count as zero toward the agent daily SOL cap

Fingerprint: `custody-spend-policy-daily-cap-ignores-strategy-run-buys`

handleStrategyRun reaches pump-fun-trade handler which persists agent_actions pumpfun.buy with payload {mint, amountSol, sig}; agent-spend-policy.js:78 sums payload->>'solAmount', so strategy buys contribute zero to daily_sol_cap (default 5 SOL). Strategy path uses non-atomic checkBuyAllowed, not reserveSpend, and loadWallet without audit context, skipping assertPlatformSigningAllowed. Verifier assessment: Strategy buys persist payload key amountSol while the daily cap sums solAmount, so they count as zero toward daily_sol_cap. Only the per-tx cap applies. Principal is the agent owner or a spend-scoped key, so this bypasses the owner's cap rather than crossing tenants. The loadWallet audit-context point is not a separate bug. Non-binding priority hint: medium. Suggested fix: Write solAmount in the note or COALESCE(solAmount, amountSol) in the SUM; use atomic reserveSpend in the strategy path.

Claimed root cause: Cap sums a payload key the strategy path never writes.

Trace:
- entrypoint: api/pump/[action].js:3761
- propagation: api/pump/[action].js:3866
- propagation: examples/skills/pump-fun-trade/handlers.js:55
- propagation: api/_lib/skill-runtime.js:135
- sink: api/_lib/agent-spend-policy.js:78

Evidence:
- api/pump/[action].js:3869: checkBuyAllowed instead of reserveSpend
- api/_lib/solana-wallet.js:15: loadWallet without audit context

## Walk Avatar extension stores any token from a three.ws auth-callback URL (login CSRF / session fixation)

Fingerprint: `extensions-walk-avatar-auth-callback-token-injection-no-state-binding`

background.js tabs.onUpdated persists the token query/hash param of any top-level tab whose URL starts with https://three.ws/extension/auth-callback into chrome.storage.local.threews_session, then closes the tab. No state/nonce ties it to a sign-in the user started; no check the token belongs to the current user; callback page treats any ?token= as success. Attacker mints own extension token (POST /api/auth/extension-token) and navigates victim to /extension/auth-callback?token=<attacker token>; extension then holds attacker identity (scope avatars:read). For a victim signed out of three.ws, popup avatar lists and narrator /api/tts/speak run as attacker account. Impact limited: tts/speak.js prefers cookie session over bearer, avatars/mine.js likely too. Verifier assessment: The extension accepts any auth-callback URL token with no state binding and overwrites its stored session (login CSRF). Token has extension scope only; cookie session takes precedence in speak.js. Non-binding priority hint: low. Suggested fix: Add a per-sign-in nonce in chrome.storage.session and accept the token only with a matching state, or deliver the token via runtime messaging.

Claimed root cause: Auth-callback capture is trust-on-navigation: token accepted from URL with no binding to a locally initiated login.

Trace:
- entrypoint: extensions/walk-avatar/background.js:224
- propagation: extensions/walk-avatar/background.js:226
- propagation: extensions/walk-avatar/background.js:231
- propagation: extensions/walk-avatar/background.js:237
- propagation: api/tts/speak.js:67
- sink: api/auth/extension-token.js:76

Evidence:
- extensions/walk-avatar/background.js:226: prefix-only check, no state
- extensions/walk-avatar/background.js:237: unconditional overwrite
- public/extension-auth-callback.html:80: any non-empty token treated as success
- api/auth/extension-token.js:76: any account can mint a token
- api/tts/speak.js:67: cookie session takes precedence over bearer

## CAD Forge parent reads child-controlled artifact paths with symlink-following open

Fingerprint: `glb-media-cad-forge-collect-follows-child-symlink`

main._collect trusts child-written result.json 'files' list; checks name against ARTIFACT_KEYS and os.path.isfile then open(path,'rb') following symlinks. Workdir chowned to nobody; child can create symlinks (seccomp deny list lacks symlink/symlinkat). Symlink part.glb -> /proc/1/environ makes the root parent base64 it into the response; getsize on /proc reports 0 so 24MB cap does not bound it. Needs a child-side primitive (companion candidate). Verifier assessment: cad-forge _collect opens child-named files following symlinks, a conditional privilege gain only if submitted code can already create a symlink in the child. The policy exposes no such primitive on its own, so this is defense in depth. Non-binding priority hint: low. Suggested fix: Open with O_NOFOLLOW, fstat for a regular file, bounded read from the fd; add symlink, symlinkat, link and linkat to SECCOMP_DENY.

Claimed root cause: Privileged parent opens files from a child-controlled dir without lstat/O_NOFOLLOW/realpath confinement.

Trace:
- entrypoint: workers/cad-forge/main.py:311
- propagation: workers/cad-forge/sandbox_child.py:185
- propagation: workers/cad-forge/main.py:264
- propagation: workers/cad-forge/main.py:218
- sink: workers/cad-forge/main.py:228

Evidence:
- workers/cad-forge/main.py:97: workdir chowned to nobody
- workers/cad-forge/sandbox_child.py:49: SECCOMP_DENY lacks symlink/symlinkat
- workers/cad-forge/Dockerfile:22: comment: tests run as root like Cloud Run

## CAD Forge static policy does not block frame/code-object attributes (generator frame walk to real globals/builtins)

Fingerprint: `glb-media-cad-forge-policy-frame-attribute-escape`

workers/cad-forge/cad_policy.py check_source rejects only underscore-prefixed attributes plus format/format_map/vformat/mro. gi_frame, f_back, f_globals, f_builtins, f_locals, gi_code, cr_frame, tb_frame pass. `def g(): yield x.gi_frame.f_back.f_back.f_globals` could reach sandbox_child's globals (os, sys) and real builtins (open, eval, __import__). Program text comes from an LLM prompted by an arbitrary user of api/cad.js and MCP cad tool. If the walk works the AST/builtins layer is void; seccomp, nobody uid, rlimits remain. Verifier assessment: cad_policy blocks only underscore and a few attribute names, so generator and frame attributes such as gi_frame, f_back and f_globals pass and may reach the sandbox_child module globals (os, real builtins). Python behavior inferred; seccomp and uid drop remain. Non-binding priority hint: medium. Suggested fix: Switch to an attribute allowlist or deny gi_*, cr_*, ag_*, f_*, tb_* and co_*; reject Yield and GeneratorExp if unneeded; exec from a module whose frames reach nothing sensitive.

Claimed root cause: Attribute denylist is underscore-prefix based and omits non-underscore frame/generator/traceback introspection attributes.

Trace:
- entrypoint: workers/cad-forge/main.py:311
- propagation: workers/cad-forge/cad_policy.py:58
- propagation: workers/cad-forge/cad_policy.py:118
- propagation: workers/cad-forge/sandbox_child.py:172
- sink: workers/cad-forge/sandbox_child.py:185

Evidence:
- workers/cad-forge/cad_policy.py:58: BANNED_ATTRIBUTES only format,format_map,vformat,mro
- workers/cad-forge/cad_policy.py:130: underscore check only other control
- workers/cad-forge/cad_policy.py:60: safe builtins keep iter,next,super,isinstance; def/yield allowed ~141
- workers/cad-forge/sandbox_child.py:172: run_program frame f_globals is module namespace with os/sys at 22-31
~~~~

