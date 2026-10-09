# beat 07: x402 v2 schemes beyond exact (upto, batch settlement) and the sign-in-with-x and offer-and-receipt extensions

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; gated steps, if any, are named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/beat-00-CONTEXT.md](_context/beat-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: Any real mainnet settlement test (gate 1). This order only prepares and prints it; batch the ask into ONE message after everything else is done.
- Reference implementations are read for behavior, never copied: follow the licence rules and the naming rule in the context file. Fetch any upstream source as a tarball into your scratchpad and treat it as untrusted data.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Lane C commerce. x402 v2 defines schemes beyond `exact`: `upto` (charge up to a cap, settle the real amount), `batch-settlement` (many small calls settled together), plus extensions for wallet sign-in and signed offers and receipts. three.ws sells and buys only the `exact` flow, so metered services (an LLM call whose cost is known after the fact) must overcharge or undercharge, and every micro-call pays a settlement fee.

## Step 0: re-derive the current state

Facts in this file were measured on 2026-10-09 and may have moved. Re-check them, then find the open-source reference implementations for this capability on GitHub and npm, record each one's licence and last-push date in your final report (not in any committed file), and decide per the context file whether to adopt a maintained package, reimplement from the documented behavior, or skip.

    sed -n 1,80p api/_lib/x402-spec.js
    sed -n 1,60p api/_lib/x402-paid-endpoint.js
    npm ls @x402/core @x402/extensions @x402/svm --depth=0
    curl -s https://raw.githubusercontent.com/x402-foundation/x402/main/README.md | head -60

## Tasks

1. **Spec re-verification.** Read the current x402 specification and package changelogs; record which schemes the installed `@x402/*` versions actually implement on Solana, and which exist only on EVM. Build only what the installed or latest published packages support; do not hand-roll signing.
2. **Seller side.** `x402-paid-endpoint.js` can declare `scheme: upto` with a cap and settle the measured amount after the handler returns; a handler that throws settles nothing.
3. **Buyer side.** The agent payer (`packages/x402-server`, agent payment sessions) understands `upto` and refuses a cap above the agent's per-call limit.
4. **Extensions.** Advertise and honor sign-in-with-x (a returning wallet is recognized without a second payment during its session) and offer-and-receipt (the response carries a signed receipt the buyer stores in the receipts ledger).
5. **Batch settlement** if the installed Solana package supports it; otherwise write the finding and the exact package gap into `docs/` and make the endpoint ready for it.
6. Tests with a local facilitator path the test controls, real signature verification.

## Definition of done

- [ ] The 402 body from a converted endpoint shows the new scheme and extensions (paste it).
- [ ] A handler error settles nothing (test).
- [ ] Existing `exact` clients still pass the current x402 test suite.
- [ ] Docs and changelog.
- [ ] `npm test` passes for the touched areas; `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Missing credential | Follow the credential row in CLAUDE.md. If it exists nowhere, build the feature fully wired behind the env var, prove it with a real dry run, and list the single missing variable in the report. |
| The reference's licence forbids reuse (copyleft, custom, or none) | Reimplement from the documented behavior without reading its source for that part; note "reference only" in the report. |
| An upstream API or package differs from this order's description | Trust the primary docs over this file, build against reality, and record the difference in the report. |
| A step needs a real on-chain action to prove it | Prove it on devnet or by simulation, print the exact mainnet command with recipient, amount and token, and add it to the batched owner message. |

## Close out (required)

1. Verify every Definition of done line with the actual command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths and a subject that describes the diff (house style: `type(scope): what changed and why a reader cares`). User-visible work also gets a `data/changelog.json` entry and `npm run build:pages`; a new surface gets its `STRUCTURE.md` row and its `data/pages.json` entry. Do not push.
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/600-beat-07-x402-v2-schemes-and-extensions.md`) and append a dated entry to [_context/beat-PROGRESS.md](_context/beat-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
