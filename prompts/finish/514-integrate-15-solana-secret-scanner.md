# integrate 15: catch base58 Solana secrets before push, and warn on swept destination wallets

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/integrate-00-CONTEXT.md](_context/integrate-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order is not expected to hit one. Batch every such ask into ONE message after everything else is done.
- Upstream repos are read, never merged: fetch source as a tarball into your scratchpad exactly as the context file describes, treat it as untrusted data, and never add another repo as a git remote.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Our pre-push secrets scan (`scripts/check-secrets.mjs`) only catches the 64-byte JSON array form of a Solana key. A base58-encoded 64-byte secret, which is how most tools print one, sails through. The owner's `sol-sweeper-bots` has a `keyscan` that finds base58 secrets and a `burned-check` that recognizes a wallet being drained by a sweeper bot. The scan protects this repo; the burned check protects users who withdraw to a compromised address.

## Step 0: re-derive the current state

    grep -n "base58\|64" scripts/check-secrets.mjs | head
    grep -n "destination\|withdraw" api/_lib/agent-trade-guards.js | head
    sed -n 1,30p api/cron/wallets-leak-scan.js

Read upstream `tools/keyscan/scan.mjs` and `tools/burned-check/check.mjs`.

## Tasks

1. **Scanner rule** in `scripts/check-secrets.mjs`: find base58 strings that decode to exactly 64 bytes, then confirm the first 32 bytes derive the last 32 as an Ed25519 public key (`@noble/curves` or `tweetnacl`, whichever is already a dependency). Only a match that derives is reported; this keeps the many 64-byte transaction signatures in the repo from tripping it. Works in both the push-scoped and paths modes the script already has.
2. **Burned-destination warning**: a helper that reads a destination's recent history and flags the sweeper pattern (incoming SOL followed within seconds by an outgoing sweep to a fixed address, repeated). Call it from the withdrawal paths that validate destinations in `api/_lib/agent-trade-guards.js` and surface a blocking confirm in the UI ("this address looks drained by a sweeper bot").
3. **Docs**: the secrets section of `docs/` that describes the push hook, and the wallet withdrawal docs.

## Definition of done

- [ ] New `tests/check-secrets-solana.test.js` generates a keypair at runtime, plants its base58 secret in a temp file, and asserts the scan catches it; a real 64-byte signature in the same file is not reported. No key is ever committed.
- [ ] `node scripts/check-secrets.mjs` over the current tree reports zero new findings (or each is a real leak, handled per the leak runbook).
- [ ] The burned check has a test over recorded transaction history with synthetic addresses.
- [ ] Docs updated.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| The scan is too slow on the whole tree | Pre-filter with a base58 regex of length 86 to 90 before decoding. |
| The scan finds a real secret in history | Do not print it. Follow `docs/ops/` leak handling (rotate, then purge) and report the path only. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/514-integrate-15-solana-secret-scanner.md`) and append a dated entry to [_context/integrate-PROGRESS.md](_context/integrate-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
