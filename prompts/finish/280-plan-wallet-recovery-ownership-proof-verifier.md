# Build the wallet ownership proof tool support needs before releasing a stranded balance

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/280-plan-wallet-recovery-ownership-proof-verifier.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 58 of 100 inside the tier). **Area:** wallet. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

Support releases stranded agent-wallet balances only after a claimant proves control of both the login wallet and the original funding wallet by signing a single-use message. The support runbook already tells operators to verify with `scripts/verify-wallet-ownership.mjs "when built"`, but the script does not exist, so verification is done by hand with raw `nacl.sign.detached.verify` against bytes the operator must reproduce exactly. A manual step on a money-release path is where mistakes (a reused nonce, wrong byte string, expired request, look-alike address) turn into lost funds. A small, tested tool that generates the challenge and verifies both signatures, with expiry and single-use enforcement, removes that risk and makes the template reusable for any case instead of one hard-coded agent.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `docs/support/stranded-wallet-ownership-proof.md` is the template. It hard-codes one case (agent id, login wallet, funding wallet, nonce, issue time) and says "see `scripts/verify-wallet-ownership.mjs` when built".
- `ls scripts | grep -i ownership` returns nothing. Adjacent wallet scripts exist and set the house style: `scripts/rescue-wallet.mjs` (dry-run default, flags parsing, runbook `docs/ops/wallet-rescue.md`), `scripts/audit-wallet-flows.mjs`, `scripts/recover-sealed-wallets.mjs`.
- Dependencies available for ed25519 verification: `@noble/curves` ^2.2.0 (used by `api/_lib/x402/self-facilitator.js`), `bs58` ^6, `@solana/web3.js`. `tweetnacl` is not a direct dependency, so use `@noble/curves/ed25519.js`.
- The custody audit trail is `agent_custody_events` (see `api/_lib/agent-trade-guards.js`, `recordCustodyEvent`), and agent wallet addresses live in `agent_identities.meta.solana_address` (`api/_lib/agent-wallet.js`).
- No test covers a wallet ownership proof flow (`ls tests | grep -i ownership` finds only unrelated avatar and cosmetics tests).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
ls scripts | grep -i "ownership\|verify-wallet"
grep -n "verify-wallet-ownership" -r docs scripts package.json
ls tests | grep -i "ownership\|wallet-proof"
node -e "console.log(Object.keys(require('./package.json').dependencies).filter(d=>/noble|bs58|tweetnacl/.test(d)))"
sed -n 1,60p scripts/rescue-wallet.mjs
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Library first: create `scripts/lib/wallet-ownership.mjs` exporting `buildChallenge({ agentId, nonce, issuedAt })` (returns the exact message text: `three.ws wallet recovery`, `agent: <id>`, `nonce: <base64url>`, `issued: <ISO-8601 UTC, seconds precision>`, newline separated, no trailing newline), `generateNonce()` (9 random bytes, base64url, from `node:crypto`), and `verifyWalletSignature({ message, address, signature })` that accepts base58 or base64 signatures, validates the address is a 32-byte base58 ed25519 key and the signature is 64 bytes, verifies with `@noble/curves/ed25519.js`, and returns `{ ok, reason }` with specific reasons (`bad_address`, `bad_signature_encoding`, `signature_invalid`). It must never throw on malformed claimant input.
2. Tests first for the library in `tests/wallet-ownership.test.js`: sign a challenge with a freshly generated `Keypair` (real signatures, no fixtures standing in for crypto), then assert accept; assert reject for a signature from a different key, a message differing by one character or a trailing newline, a truncated signature, a non-base58 address, and a 31-byte address. Assert `buildChallenge` is byte-stable and rejects an `agentId` that is not a UUID. Confirm the tests fail before the library exists, then pass.
3. CLI `scripts/verify-wallet-ownership.mjs` with two subcommands and house-style flag parsing (see `scripts/rescue-wallet.mjs`):
   - `challenge --agent <uuid> [--issued <iso>]` prints a fresh nonce and the exact text block, and writes a claim record to `.support-claims/<agent>-<nonce>.json` (add `.support-claims/` to `.gitignore`; it must never be committed). The record stores agent id, nonce, issued time, login wallet and funding wallet (once supplied) and status.
   - `verify --claim <file> --login-wallet <addr> --login-sig <sig> --funding-wallet <addr> --funding-sig <sig>` verifies BOTH signatures against the stored challenge text, enforces a 72-hour expiry from `issued`, refuses a claim already marked `verified` or `used` (single use), refuses if the two wallets are equal unless `--allow-same-wallet` is passed with a recorded reason, and prints a clear PASS or FAIL with the reason for each wallet. On PASS it marks the claim `verified` and prints the only permitted payout destination (the login wallet). Exit code 0 on PASS, 1 on any failure.
   - Optional read-only context lookup `--check-account`: when `DATABASE_URL` is available, confirm the login wallet is the wallet recorded for the agent's owner and list the agent's `agent_custody_events` destinations, flagging any address that looks similar to the funding or login wallet (shared first 4 and last 4 characters) but differs, to catch look-alike address poisoning. Read-only; never writes to the database. When no database is configured, print that the check was skipped and why.
4. Tests for the CLI in the same test file or `tests/wallet-ownership-cli.test.js`: run the real script via `child_process` with real generated keypairs: PASS for two valid signatures, FAIL for one bad signature, FAIL after expiry (pass `--now` for deterministic time only in tests via an env var the script documents), FAIL on replay of a verified claim, FAIL on wallet-equals-wallet. The script must refuse to print a payout destination on any failure.
5. Rewrite `docs/support/stranded-wallet-ownership-proof.md` into a reusable runbook: replace the hard-coded case with `challenge` output placeholders explained in prose (not a live case), keep the customer message template and operator notes, and replace the "when built" line with the exact commands. Move the concrete case details out of the committed template (they are a real customer's wallets); keep them only in the ignored claim record. Add a `docs/ops` cross-link from `docs/ops/wallet-rescue.md` if it exists.
6. Add an npm script `verify:wallet-ownership` in `package.json`, a `STRUCTURE.md` row for the new script if scripts are listed there, and a `data/changelog.json` entry only if user-visible (it is internal tooling, so a note in `docs/` is enough; follow the `changelog-and-docs` skill). Run `npm run check:rules -- --paths <files>` and `npm run audit:docs`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node scripts/verify-wallet-ownership.mjs challenge --agent <uuid>` prints a challenge block, and `verify` returns PASS (exit 0) with two real signatures and FAIL (exit 1) for each negative case in task 4.
- [ ] `npx vitest run tests/wallet-ownership.test.js` passes (shown failing before the library existed).
- [ ] `git check-ignore .support-claims/x.json` confirms the claim directory is ignored.
- [ ] `grep -rn "when built" docs/support` returns nothing, and the runbook contains no real customer addresses.
- [ ] The script never writes to the database and never prints a payout destination on failure (asserted by tests).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No database credentials for `--check-account` | Skip with a printed notice; the signature verification path must work with no network and no database |
| Wallet signs with a different message encoding (offchain message header) | Support the raw-bytes message exactly as in the template, and document in the runbook that the wallet must sign arbitrary text; reject anything else rather than guessing |
| Unsure whether to also support EVM `personal_sign` | Solana only. Add EVM later if a real claim needs it |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/280-plan-wallet-recovery-ownership-proof-verifier.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `280-plan-wallet-recovery-ownership-proof-verifier.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/support/stranded-wallet-ownership-proof.md` (whole file)

~~~~markdown
# Wallet recovery: ownership-proof request

A support template for verifying that a claimant controls a wallet-auth account
before any balance is credited. Ownership is proven by signature, never by
narrative, and the payout only ever goes to a wallet the claimant signs from, so
there is no address for a bad actor to redirect funds to.

## How to use

1. Generate a fresh nonce per claim (do not reuse the one below):
   `node -e 'console.log(require("crypto").randomBytes(9).toString("base64url"))'`
2. Fill the wallet addresses and the agent id for the specific case.
3. Send the message. Require signatures from BOTH the login wallet and the
   original funding wallet.
4. Verify both signatures before approving any transfer (see
   `scripts/verify-wallet-ownership.mjs` when built, or verify with
   `nacl.sign.detached.verify`). A failed or missing signature ends the claim.

The concrete case below is agent `5e05f68f-eead-4ef9-b6b4-fc85ea73bbe9`:
- Login wallet: `7jWU2UBX7nKEFSXndbjR3NoSmgeqhL6Fh9fA1Vd7GaRe`
- Original funding wallet: `58uQ7w8qPvDcD4WsUqtZqCkiMyJrz1fEeMZmuRPaPbZv`

---

## Message to the customer

Subject: Verifying your three.ws wallet before we release your balance

Hi,

We can help with your withdrawal. Because this balance is tied to a self-custody
wallet, we verify ownership cryptographically before releasing anything. This
protects you: it guarantees the funds can only ever go back to a wallet you
control, and no one else can claim them.

Please do the following. It takes about a minute and costs nothing (no gas, no
transaction, just a message signature).

**Sign this exact text, once from each of the two wallets below:**

```
three.ws wallet recovery
agent: 5e05f68f-eead-4ef9-b6b4-fc85ea73bbe9
nonce: EAVO7fkpv49J
issued: 2026-09-18T00:56:07Z
```

1. **Your login wallet** `7jWU2UBX7nKEFSXndbjR3NoSmgeqhL6Fh9fA1Vd7GaRe`
   (the wallet you use to sign in to three.ws).
2. **The wallet that originally funded the balance**
   `58uQ7w8qPvDcD4WsUqtZqCkiMyJrz1fEeMZmuRPaPbZv`.

How to sign in Phantom: open the wallet, go to Settings, choose "Sign Message"
(or use any wallet tool that signs an arbitrary message), paste the text above
exactly, and sign. Do not send any transaction. Then send us back, for each
wallet: the wallet address and the resulting signature string.

Once both signatures check out, we will send your balance to your login wallet
`7jWU2UBX7nKEFSXndbjR3NoSmgeqhL6Fh9fA1Vd7GaRe`. We can only pay out to a wallet
you have proven you control, so please make sure you can sign from it.

If you are unable to sign from either wallet, we unfortunately cannot verify the
claim and cannot release the balance.

Thanks,
three.ws support

---

## Notes for the operator (do not send)

- The signature is over the literal text block, newlines included. Verify with
  the same bytes you gave the claimant.
- Both signatures are required. The login wallet proves account control; the
  funding wallet proves they are the party who deposited the money. A genuine
  owner controls both; an opportunist controls neither.
- The nonce and timestamp make each request single-use, so an old or screenshotted
  signature cannot be replayed.
- Payout destination is fixed to the proven login wallet. Never send to an address
  the claimant simply types into a message.
- The custody trail agrees with this: every withdrawal this account attempted named
  the login wallet or the funding wallet, never the look-alike poisoning address
  `58uQT1Y1...`.
~~~~

