# Build the Robinhood Crypto trading connector with spend caps, simulation and owner-pasted keys

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/975-plan-robinhood-crypto-connector-spend-capped.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 52 of 100 inside the tier). **Area:** robinhood. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Robinhood Crypto is a crypto venue alongside our Solana rail. Today the hosted MCP has only four read-only Robinhood tools. A connector that lets an owner paste their own Robinhood Crypto API key, set a hard spend cap, and have agents quote and place crypto orders gives the cross-venue agent the playbook describes. Crypto only.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `api/_mcp/tools/robinhood.js` has 4 read-only tools; `api/v1/robinhood/*` exists.
- Missing: key vault entry, signed request client, order tools, spend-cap ledger, UI, tests, docs.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
sed -n 1,60p api/_mcp/tools/robinhood.js; ls api/v1/robinhood
grep -rn "robinhood" api/_lib -l | head; ls tests | grep -i robinhood
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read the official Robinhood Crypto Trading API docs (API key plus Ed25519 request signing). Tests first (`tests/robinhood-crypto-client.test.js`): the signature construction matches documented test vectors; requests over the cap are refused before network; the key is never logged or returned.
2. `api/_lib/robinhood/crypto-client.js`: signed GET/POST, quotes, holdings, orders; keys stored with `api/_lib/secret-box.js` per account.
3. Spend cap ledger table (migration) with per-day and per-order limits enforced server-side; every order passes the confirm flag and financial-tier guard.
4. Routes `PUT /api/v1/robinhood/credentials`, `GET .../holdings`, `POST .../orders/preview`, `POST .../orders` and tools `robinhood_quote`, `robinhood_holdings`, `robinhood_place_order` (financial tier).
5. Settings card (states: skeleton, empty, error, hover/focus/active) to paste a key, set caps and revoke.
6. Docs `docs/robinhood-crypto.md`, changelog.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] Signature vector test and cap tests pass.
- [ ] Read-only calls (holdings, quote) work against the live API with an owner-provided key; order path verified up to the preview.
- [ ] No equities or options concepts appear anywhere.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No API key | Build and test with documented vectors; the key paste is the one missing piece, owner-supplied. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

- Any live order is a real trade: render the order table (pair, side, amount) and stop for the owner's explicit yes.
- Pasting the API key is owner-only. All asks batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/975-plan-robinhood-crypto-connector-spend-capped.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `975-plan-robinhood-crypto-connector-spend-capped.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/research/solana-robinhood-playbook-2026-10.md` (section "Ranked plan")

~~~~markdown
## Ranked plan

"Owner" marks steps that move funds, sign on mainnet, change production flags, or publish externally. Everything else can be built and verified now.

| # | Work | Effort | Gate |
|---|---|---|---|
| 1 | Fix `/markets/robinhood`: index R1 and pump.fun's Robinhood Chain coins, drop NOXA, add rug-risk flags | 2-3 days | Commit names other projects (Owner) |
| 2 | Decaying anti-sniper fee on the native $THREE lane, proven on devnet | 2 days | Mainnet config (Owner) |
| 3 | Agent revenue holder rewards plus the public buyback counter page | 4-5 days | Enable flags (Owner) |
| 4 | Follow-this-agent: one button on profiles and in the Seeker app, wrapping copy trading with a spend cap | 3-4 days | None |
| 5 | Robinhood Chain tools in the hosted MCP, 4663 USDG in the x402 network list | 2-3 days | None |
| 6 | Solana Agent Registry dual registration, with feedback written from x402 receipts | 2-3 days | Mainnet registration fees (Owner) |
| 7 | Robinhood Crypto connector (owner-supplied API key, spend-capped, crypto only) | 4-5 days | Live order test (Owner) |
| 8 | Commerce Blinks: buy coin, hire, tip | 2 days | None |
| 9 | x402 batch settlement on our facilitator, Pay.sh listing | 3 days | Listing is external (Owner) |
| 10 | ERC-4337 paymaster on 4663 for revenue-leading agent actions | 3 days | Fund the paymaster (Owner) |
| 11 | Compressed NFT mint for avatars and agents | 3 days | Mainnet (Owner) |
| 12 | Smart-account or TEE custody option for agent wallets | Multi-week | Design review |

**Time-sensitive:** Arbitrum and Robinhood Chain's Founder House Singapore runs Oct 23 to 25 with up to $300K, including reported funding for AI-agent projects. These terms come from secondary sources. Items 3, 5 and 7 together are a strong application, and applying is an external action, so it is owner-gated.
~~~~

### `docs/research/solana-robinhood-playbook-2026-10.md` (section "How we do it better")

~~~~markdown
## How we do it better

### 1. Revenue-backed agents that work where pump.fun's version did not

pump.fun's Tokenized Agents failed because every agent became its own buyback game: one more launch mode competing for the same attention. Its Holder Rewards works because it is a single default that pays people without asking them to trade. Combine the working half of each:

- One launch path (Genesis), quoted in $THREE.
- Holder rewards for an agent's coin are paid from the agent's measured x402 and skill revenue, not from trading fees. They are opt-in, paid in $THREE or SOL, and every payout links to its transaction.
- The agent's public profile shows revenue kept apart from trading volume, the number of paying callers, and payouts. That is the "real revenue" proof no one else on either chain can show.

This is campaign items 5 and 6 with one change: pay out the way pump.fun's live mechanic does (several times an hour, with a minimum balance) instead of designing our own schedule.

### 2. "Follow this agent", one tap, on the phone

S1 won by turning a public portfolio into a follow button. Our version is better because the thing you follow has a body and explains itself:
- A Follow button on every agent profile and in the Seeker app wraps the existing copy-trading engine, with a spend cap set at the moment you tap.
- The 3D agent narrates each trade it makes, so followers see why, not only what.
- Duels and Quests become the seasons layer. Referrals already exist (`api/_lib/referrals.js`), so the season leaderboard can pay referral tiers too.

### 3. The cross-venue agent Robinhood will not build

Robinhood's agent stack is closed to outside agents, and its chain agents have no body and no revenue. The opening is an agent that holds a Solana wallet and a 4663 wallet, and can also connect to the owner's Robinhood Crypto account:

- **Robinhood Crypto connector.** The owner pastes their own Crypto Trading API key. Their agent can read holdings and quotes and trade crypto inside a spend cap. Each order gets a receipt and the 3D agent narrates it. Crypto only, by design.
- **Robinhood Chain in our hosted MCP.** Port the `hood-mcp` tools (quotes, swaps, launch watch, USDG transfer) into `api/_mcp`, so any Claude or ChatGPT user gets them from the connector they already have.
- **x402 on 4663 in USDG.** Add the chain to the revenue network list. `robinhood/hood402` already exists, so this is wiring work.
- **Gas sponsorship.** An ERC-4337 paymaster sponsors an agent's first actions on 4663. Retention collapsed when Robinhood's 90-day gas waiver ended; we can sponsor exactly the actions that lead to revenue and nothing else.

Solana leads every one of these. The connector and MCP tools ship Solana-first where a Solana equivalent exists.

### 4. Trust as the product on Robinhood Chain

The chain's volume is memes plus wash, and its biggest insider extraction came from snipe-tax exemptions. We already planned rug-risk flags. Ship them on the corrected screener first:
- early-block supply concentration
- tax-exempt wallets
- the creator's past launches

That makes `/markets/robinhood` the only screener on the chain worth trusting, which costs less than competing with R1 and earns more attention.

### 5. Join the standards early, then make our agents the best-documented ones on them

- Register every on-chain agent on the Solana Agent Registry as well as Metaplex. It interoperates with ERC-8004, which we already write on Base and BSC, so one agent carries a single identity across chains.
- Write the registry's feedback records from real x402 receipts. Reputation there becomes paid-call history, not reviews.
- Settle x402 in batches once our facilitator is on, and list our paid endpoints on Pay.sh, which also matches our Google Cloud priority.
- Add Blinks for "buy this agent's coin", "hire this agent" and "tip this agent", so a three.ws agent can be acted on from inside any wallet or post that renders Blinks.

### 6. Value accrual for $THREE that survives a bad month

Copy pump.fun's structure, not its size: a fixed share of platform revenue, committed for a stated period, with a public counter linking every buy. It must be worded as programmatic and non-guaranteed. Pair it with the $THREE compute sink (pay for credits in $THREE with a bonus), which creates demand that does not depend on the coin's price.
~~~~

