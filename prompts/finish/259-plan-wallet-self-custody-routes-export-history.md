# Expose self-custody signing, session keys, key export and balance history as routes, tools and wallet UI

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/259-plan-wallet-self-custody-routes-export-history.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 84 of 100 inside the tier). **Area:** wallet. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Agent wallets are custodial today and the owner has no way to run an agent whose keys the platform never holds, to export a key, to grant an unattended session key with an on-chain cap, or to see a balance over time. The hard part is already written and migrated: `api/_lib/custody/{signing,session,external-tx,auth,builders}.js` and `api/_lib/migrations/20260922190000_self_custody.sql` (tables `agent_signers`, `pending_external_txs`, `auth_reauth`, `agent_balance_history`). No route, tool, cron or page calls any of it, so none of it is reachable. This order wires the existing library to the surface the prompt describes. Solana first; EVM is out of scope.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Library present and unit-shaped: `signing.js` (`SIGNER_MODES = platform|external|session`, `resolveSigningPath`, `sessionAllows`, `reserveSessionSpend`, `assertPlatformSigningAllowed`), `session.js` (`beginSessionGrant`, `endSession`, `sendSessionTransfer`), `external-tx.js` (`prepareExternalTx`, `submitExternalTx`, `refreshSubmittedTx`, `listExternalTxs`, `compareMessages`), `builders.js` (`buildTransferTransaction`, `buildSwapTransaction`). `api/actions/agent-tip.js` and `agent-buy-coin.js` already use `builders.js`.
- Missing routes: no `PUT /agents/:id/signer`, no `POST /api/tx/submit` (only `api/tx/solana/[action].js` and `api/tx/explain.js` exist), no `POST /agents/:id/wallet/export`, no `GET /agents/:id/wallet/history`, no `GET /me/wallet`. `api/v1/agents/[id]/` holds only `loop`, `perps`, `portfolio`, `predictions`, `start.js`, `stop.js`.
- Missing cron: nothing writes `agent_balance_history` (`api/cron/` has no balance-snapshot job; the migration comment names `/api/cron/balance-snapshot`).
- Missing tools: `get_private_wallet_balance`, `get_wallet_summaries`, `get_balance_history` on `/api/mcp-agent`.
- Missing tests: no `tests/` file covers session keys, external-tx verification or export (only `tests/agent-wallet-signer-mode.test.js` and `tests/solana-signers-attester.test.js` touch signers).
- UI: `pages/agent-wallet.html` and `pages/wallet.html` exist; neither shows signer mode, export or history.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
npm run db:status 2>&1 | tail -15            # read only: is 20260922190000_self_custody applied?
ls api/tx api/cron | grep -iE "submit|balance"
grep -rn "agent_balance_history\|agent_signers\|pending_external_txs\|auth_reauth" api --include=*.js | grep -v "_lib/custody\|migrations" | head
grep -n "signer\|wallet/export\|wallet/history\|tx/submit" api/v1/rest.js vercel.json | head
curl -s -o /dev/null -w '%{http_code}\n' https://three.ws/api/tx/submit
```

Skip any task whose route already answers and has a passing test.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first, in `tests/custody-self-custody.test.js` (mock only the RPC `Connection`, never the logic): `sessionAllows` and `reserveSessionSpend` refuse a 2 USDC transfer on a 1 USDC cap and an expired session; `compareMessages` rejects a signed message whose instructions differ from the prepared bytes; `submitExternalTx` rejects a wrong signer, an expired `PREPARED_TTL_MS` row and a replay; `resolveSigningPath` honors `signer: "external"`. Run them, fix real defects found in the library.
2. Add the REST routes to `api/v1/rest.js` (or the `api/v1/agents/[id]/` router the file uses): `PUT /agents/:id/signer` (modes `platform`, `external` with `publicKey`, `session` with cap, mint and hours, returning the unsigned grant transaction from `beginSessionGrant`), `DELETE /agents/:id/signer/session` (`endSession`), `GET /agents/:id/signer`.
3. Add `POST /api/tx/submit` (new `api/tx/submit.js` plus `vercel.json` route): body `{ tx_id, signed_transaction }`, calls `submitExternalTx`, returns the signature and ledger row; `GET /api/tx/:id` calls `refreshSubmittedTx`. Auth through `custody/auth.js` (`requirePrincipal`, scope `wallet:write`).
4. Give every fund-moving route that already builds a transaction (`api/tx/solana/[action].js` `build-transfer` and `build-swap`, `api/actions/agent-tip.js`, `api/v1/agents/[id]/perps`, `predictions`) the `signer: "external"` option via `prepareExternalTx`, returning `{ tx_id, transaction (base64), summary, simulation }`. The confirm-flag rule stays custodial-only.
5. Key export: `POST /agents/:id/wallet/export` behind `auth_reauth` step-up (challenge then single-use grant). The browser encrypts the secret to a passphrase the user types (WebCrypto PBKDF2 + AES-GCM, in `src/wallet/export.js`); the server returns only the ciphertext envelope, shown once, writes an `agent_custody_events` row `kind=export`, never logs the secret, and offers "rotate after export" that generates a new platform key and sweeps SOL and USDC to it (preview first, owner confirms).
6. Balance history: `api/cron/balance-snapshot.js` (hourly, add to `vercel.json` crons and run `node scripts/create-gcp-scheduler.mjs` dry listing only), `GET /agents/:id/wallet/history?range=24h|7d|30d`, and tool `get_balance_history`.
7. Private wallet: `GET /me/wallet` (the account's primary linked Solana wallet via `primaryLinkedSolanaWallet`, SOL and USDC balances) and tools `get_private_wallet_balance`, `get_wallet_summaries` in `api/_mcpagent/` registered in `packages/mcp-policy/src/table.js` (read tier).
8. UI on `pages/agent-wallet.html`: a Custody card (mode chips, grant-session dialog with cap and expiry, revoke), an Export dialog (re-auth step, passphrase, one-time reveal, copy button), a balance-history chart following the `dataviz` skill. States: skeleton loading, empty ("no snapshots yet, the first appears within an hour"), error with retry, hover/focus/active on every control, keyboard-reachable dialogs with focus trap.
9. Docs: `docs/agent-wallets.md` "Custody modes", `docs/api-reference.md` sections, `data/changelog.json` entry tagged `feature, security`, then `npm run build:pages`.
10. Devnet proof (no mainnet): a script `scripts/qa-self-custody-devnet.mjs` that builds a transfer with `signer: "external"`, signs it with a throwaway keypair, submits it through `/api/tx/submit` on devnet and prints the ledger row.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/custody-self-custody.test.js` passes; the 2 USDC transfer on a 1 USDC cap session is refused (named test).
- [ ] `node scripts/qa-self-custody-devnet.mjs` prints a confirmed devnet signature and an `agent_custody_events` row.
- [ ] `curl -s -X POST localhost:3000/api/tx/submit` with no auth returns 401, with a bad `tx_id` returns 404.
- [ ] Export test asserts the server response never contains the plaintext secret and the log capture contains no secret bytes.
- [ ] `/agent-wallet` verified in a real browser: Custody card, export dialog and history chart in loading, empty, error and populated states, no console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No funded devnet wallet | Use `solana airdrop` against devnet in the QA script; retry with backoff across the RPC failover list. |
| Migration not applied locally | `npm run db:status` first, then `npm run db:migrate` against the dev database only. |
| Browser wallet adapter unavailable in headless | Sign with a throwaway `Keypair` in the QA script; the dialog is verified manually with the injected test wallet already used in `tests/e2e`. |
| Cloud Scheduler job for the new cron | Add the cron to `vercel.json`; creating the Scheduler job happens in the deploy runbook, list the one command. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/259-plan-wallet-self-custody-routes-export-history.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `259-plan-wallet-self-custody-routes-export-history.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/19-self-custody-and-signers.md` (whole file)

~~~~markdown
# 19. Self-custody mode, external signers, key export, and the user's private wallet

Read `docs/prompts/README.md` first.

## The problem

Agent wallets are custodial: keys are generated and encrypted by the platform (`api/_lib/agent-wallet.js`) and the platform signs. Non-custodial transaction builders exist for a few actions (`api/tx/solana/[action].js` `build-transfer`, `build-swap`), and the studio can connect a browser wallet, but there is no coherent self-custody story: no way to run an agent whose keys the platform never holds, no export with a sane re-encryption ceremony, no external signer registration, no view of the user's own connected wallet next to the agent's, and no balance history over time.

## Build

- **Non-custodial path for every fund-moving route.** Each financial route and tool from prompts 05 to 16 accepts `signer: "external"` and returns an unsigned, simulated, base64 transaction plus a `tx_id`; `POST /tx/submit` broadcasts a signed one and reconciles it to the same ledger rows. The SDK exposes this as the default when no `agentId` is passed. The confirm-flag rule still applies to the custodial path only; the external path is confirmed by the signature itself.
- **External signer registration:** `PUT /agents/:id/signer` with modes `platform`, `external` (a public key the user signs with), and `session` (a delegated session key with a spend cap and expiry the user grants from their wallet, so an agent can act unattended within limits). Migration for `agent_signers`.
- **Key export:** `POST /agents/:id/wallet/export` (financial, `confirm_export`): requires a fresh re-authentication, encrypts the secret to a passphrase the user types in the browser (never sent to the server in plaintext), shows it once, records the export in `agent_custody_events`, and offers "rotate after export" which generates a new platform key and sweeps.
- **Private wallet view:** `GET /me/wallet` and tool `get_private_wallet_balance` for the user's connected wallet; `get_wallet_summaries` returns agent wallets and the private wallet together.
- **Balance history:** a cron snapshots every agent wallet's balances hourly into `agent_balance_history`; `GET /agents/:id/wallet/history?range=` and tool `get_balance_history` return the series; the wallet page draws it (follow the `dataviz` skill).
- Docs: `docs/agent-wallets.md` gains "Custody modes"; `docs/api-reference.md` sections; changelog entry tagged `feature, security`.

## Acceptance

- A swap built with `signer: "external"`, signed in a browser wallet, submitted through `/tx/submit`, appears in the custody ledger with the signature.
- A session key with a 1 USDC cap refuses a 2 USDC transfer.
- Export shows the encrypted secret once and never logs it.
- `npm test` green.
~~~~

### `docs/agent-wallets.md` (whole file)

~~~~markdown
# Agent wallets

Every three.ws agent owns a **custodial Solana wallet**. It is what lets an agent act on its own - pay for an API call, buy a coin, tip another agent, receive its earnings - without a human approving each transaction in a browser extension.

This is the reference for the wallet itself: how it's created, how its key is held, what may spend from it, and where the controls live. For the owner-facing safety story (limits, freeze, proof, recovery) read [Custody you can verify](custody.md). For the complete tour of everything the wallet can do, read [What agents can do → The Agent Wallet](agent-abilities/chapters/10-the-agent-wallet.md).

## What you get

The wallet is created automatically when an agent is created - there is no separate "enable wallet" step and no seed phrase for the owner to write down. Each agent gets:

- a **Solana keypair** (mainnet and devnet share one address)
- an **EVM keypair** for the chains where the agent registers its ERC-8004 identity
- a spot on the platform's custody ledger, which records every outbound movement

Nothing is shared between agents. Two agents owned by the same person hold two independent wallets.

## Key custody

The private key is generated on the server, never leaves it, and is **encrypted at rest with AES-256-GCM**.

The encryption key derives, via HKDF, from a dedicated secret (`WALLET_ENCRYPTION_KEY`) that exists only to protect wallets - deliberately *not* the platform's `JWT_SECRET`. Each ciphertext embeds its own random salt, so no two records share a derived key, and rotating session secrets never bricks a wallet. Ciphertexts written under the older scheme still decrypt (dual-read) and re-encrypt opportunistically on their next write.

This is the same secret box used for coin treasuries and the launcher, so every custodial secret on the platform is held the same way.

**What this means honestly:** the platform can sign for the agent. That is the point - an autonomous agent that needs you to approve each transaction is not autonomous. What the platform gives you in exchange is that everything it *can* do is capped by policy you set, halted by a freeze you control, recorded in an audit trail, and provable on-chain. See [custody.md](custody.md).

## Who can spend

Five paths move funds out of an agent wallet, and **all five pass through one policy module** before anything is signed:

| Path | Trigger |
|------|---------|
| Withdraw | The owner sweeps funds out |
| x402 pay | The agent pays for a paid API call. Also reachable from any paid checkout on the site: the [x402 payment modal](tutorials/pay-for-x402-service.md) lists a signed-in user's agents next to Phantom, and picking one settles from that agent's wallet with no popup |
| Trade | A discretionary buy/sell from the wallet hub, or from the in-world coin widget's **Pay with** selector (SOL-denominated coins) |
| Purchase | The agent buys a marketplace skill or asset for itself (see [Marketplace](marketplace.md)), under its own daily purchase cap |
| Snipe | The autonomous sniper worker executes a strategy |

Because enforcement lives at the signing boundary rather than in each feature, a new feature cannot accidentally introduce an unguarded spend path.

### The policy

Limits are stored per agent and are **opt-in** - an unset ceiling means "no global cap," so existing automated flows keep their own per-feature caps until an owner tightens the policy. Once set, they are hard limits applied uniformly:

- `daily_usd` - rolling 24-hour USD-equivalent outflow ceiling, summed from the custody ledger
- `per_tx_usd` - maximum USD-equivalent for a single outbound transaction
- `withdraw_allowlist`, the active addresses on the [destination whitelist](./destination-whitelist.md); new addresses serve a cooldown (24h default, 1h minimum) and need step-up before they can receive funds
- `frozen` - the kill switch: every **autonomous** path is refused
- `require_capabilities` - when on, every autonomous spend must present a valid [scoped session key](agent-abilities/wallet/21-access.md)

Two asymmetries are deliberate:

- **A freeze never blocks the owner's withdrawal.** Locking down a misbehaving agent must not trap your money; the safe direction stays open.
- **An SPL token that can't be priced in USD** is governed by the allowlist and rate limit rather than the USD cap - a price-feed outage can never strand your own withdrawal.

Coin-launch and bonding-curve activity carries an additional SOL-denominated policy (`max_sol_per_tx`, `daily_sol_cap`, an optional `allowed_mints` allowlist). A freshly provisioned agent that has never been configured defaults to **1 SOL per transaction and 5 SOL per rolling day**, so a stolen session token cannot drain it.

On top of the numeric caps sit three additive layers, each of which can only ever *narrow* a spend, never widen it: [natural-language spend rules](financial-controls.md) that an LLM authors and deterministic code enforces, a behavioral anomaly guard that freezes the wallet when a spend doesn't look like the agent's normal behavior, and an owner-signed, epoch-bounded [spend delegation](agent-wallet-api.md#signed-spend-delegation-a-portable-offline-verifiable-cap) that any outside counterparty can verify offline, enforced against the wallet's realized ledger spend rather than a self-reported amount.

### The audit trail

Every spend writes a row to the custody event ledger - amount, USD value, destination, path, timestamp. The rolling daily ceiling is enforced by summing that ledger, which means the cap and the audit trail can never disagree. The ledger is also what the [proof-of-custody](agent-abilities/wallet/20-proof-of-custody.md) Merkle attestation commits to.

## Where owners manage it

The **Agent Wallet Hub** lives at `/agent/:id/wallet`. Owners see all 26 sections; a visitor to a public agent page sees a read-only view: Balance, Deposit, Trust, Trade, and Pulse. Everything a visitor sees is public on-chain data, so the balance a visitor reads is the same live figure the owner reads. The transaction feed is the exception: it is owner-only server-side, so the visitor's Balance tab says so and links to the block explorer instead. A network selector switches every read and write between mainnet and devnet.

`/agent-wallet` is the same hub reached without naming an agent. It resolves the signed-in owner's agents: one agent opens its hub directly, several render a picker, none offers a route to create the first one, and a signed-out visitor is asked to sign in.

Key endpoints:

- `GET /api/agents/:id/solana`: address, live balance, and `deposits_enabled`
  safety verdict (public). Funding UIs must require `deposits_enabled === true`;
  a missing, false, or unreadable verdict is not safe to fund.
- `GET /api/agents/:id/solana/activity`: parsed transaction feed (owner only)
- `GET`/`PUT /api/agents/:id/solana/limits`: read and set the spend policy
- `POST /api/agents/:id/solana/withdraw`: sweep an asset out
- `GET /api/agents/:id/solana/guard` - anomaly guard state and flagged activity
- `GET`/`POST /api/agents/:id/solana/delegation`: read, or verify-and-store, an owner-signed [spend delegation](agent-wallet-api.md#signed-spend-delegation-a-portable-offline-verifiable-cap)

Full request/response shapes are in the [REST API reference](api-reference.md).

## Paying by name

An agent can pay a human-readable name instead of a base58 address. `/api/x402/pay-by-name` resolves a recipient across three namespaces: a raw base58 address (passes straight through), a `.sol` SNS name resolved on-chain via Bonfida (subdomains included), or a `@username` (which resolves to that user's default agent's Solana address). `GET` resolves only, so you can show the user the address before spending; `POST` with `mode='send'` (authenticated, `agent_id` required) signs a USDC transfer as the caller's agent under the same spend policy as any other outbound path, and `mode='prep'` returns an unsigned transaction for a browser wallet to sign.

## Related

- [Custody you can verify](custody.md) - limits, freeze, Merkle proof-of-custody, social recovery and inheritance
- [Financial controls](financial-controls.md) - plain-English spend rules, compiled and enforced deterministically
- [What agents can do](agent-abilities.md) - the complete dossier, including a page per wallet ability
- [x402 protocol](x402.md) - how agents pay for services
- [Coin launches](coin-launches.md) - how the wallet signs a pump.fun launch

---

## Runnable example

[`examples/metamask-agent-wallet/`](https://github.com/nirholas/three.ws/tree/main/examples/metamask-agent-wallet) A localhost bridge plus a single page that gives an agent a real server-side wallet through the authenticated MetaMask Agentic CLI.

It is part of the curated set `npm run export:satellites` publishes as the public
three.ws examples repo, so it is installed, run, and link-checked before every release.
~~~~

