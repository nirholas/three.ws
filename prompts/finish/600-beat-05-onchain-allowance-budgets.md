# beat 05: agent spend budgets backed by the Solana Subscriptions and Allowances program, revocable by the owner at any time

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; gated steps, if any, are named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/beat-00-CONTEXT.md](_context/beat-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: Any mainnet allowance creation (gate 1). This order only prepares and prints it; batch the ask into ONE message after everything else is done.
- Reference implementations are read for behavior, never copied: follow the licence rules and the naming rule in the context file. Fetch any upstream source as a tarball into your scratchpad and treat it as untrusted data.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Lane B wallets. In June 2026 the Solana Foundation shipped an audited, open-source program for recurring and delegated spending: a user authorizes a capped (optionally expiring) allowance to a delegate, many allowances can coexist on one token account, and the owner can revoke instantly. That is exactly an agent budget enforced by the chain rather than by our database. three.ws agents hold custodial keys with seven software guard layers; an on-chain allowance lets a user keep funds in their own wallet and give the agent only a budget.

## Step 0: re-derive the current state

Facts in this file were measured on 2026-10-09 and may have moved. Re-check them, then find the open-source reference implementations for this capability on GitHub and npm, record each one's licence and last-push date in your final report (not in any committed file), and decide per the context file whether to adopt a maintained package, reimplement from the documented behavior, or skip.

    curl -s https://solana.com/news/subscriptions-and-allowances | head -c 3000
    grep -n "session_key\|guardian\|spend_limit" -r api/_lib --include=*.js -l | head
    ls api/_lib | grep -i "guard\|spend"

## Tasks

1. **Verify the program.** Re-derive the program id, instruction set and TypeScript client from the primary announcement and repository; record them in the doc. Use the generated client from npm, do not hand-encode instructions.
2. **Allowance mode for an agent.** In agent wallet settings, a new mode "owner-funded budget": the owner signs one transaction creating a fixed-delegation allowance (mint, cap, expiry) to the agent wallet; the agent spends by pulling through the program. Prepare the transaction server side and return it unsigned for the owner wallet to sign.
3. **Guard integration.** The existing spend guards read the remaining on-chain allowance as a hard ceiling; a pull that the program would reject is refused before it is built.
4. **Revoke + status UI.** Show cap, spent, remaining, expiry, and a one-click revoke (an unsigned transaction for the owner to sign) on the agent wallet page.
5. **Recurring delegation.** Expose the recurring-pull variant for agent-to-agent subscriptions behind a feature flag; subscription plans are out of scope here.
6. Devnet only in tests: create, pull within cap, pull over cap rejected by the program, revoke, pull after revoke rejected.

## Definition of done

- [ ] Devnet transcript of create, pull, over-cap rejection, revoke, post-revoke rejection (signatures listed).
- [ ] Guard refuses a request above remaining allowance before building a transaction (test).
- [ ] No mainnet transaction was signed by this order.
- [ ] Docs page, changelog entry, `STRUCTURE.md` row.
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
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/600-beat-05-onchain-allowance-budgets.md`) and append a dated entry to [_context/beat-PROGRESS.md](_context/beat-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
