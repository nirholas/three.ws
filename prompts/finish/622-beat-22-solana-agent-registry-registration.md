# beat 22: register agents in the open Solana agent registry and read other agents' trust tiers

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; gated steps, if any, are named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/beat-00-CONTEXT.md](_context/beat-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: Mainnet back-fill signing (gate 1: it spends authority SOL). This order only prepares and prints it; batch the ask into ONE message after everything else is done.
- Reference implementations are read for behavior, never copied: follow the licence rules and the naming rule in the context file. Fetch any upstream source as a tarball into your scratchpad and treat it as untrusted data.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Lane E to G identity, distribution, launch. A Solana-native agent registry modeled on ERC-8004 now exists, with sybil-resistant reputation and trust tiers, alongside Metaplex agent identity (which three.ws already enrols agents in). Being discoverable and rankable in the registry other agents consult is how a hiring agent finds ours.

## Step 0: re-derive the current state

Facts in this file were measured on 2026-10-09 and may have moved. Re-check them, then find the open-source reference implementations for this capability on GitHub and npm, record each one's licence and last-push date in your final report (not in any committed file), and decide per the context file whether to adopt a maintained package, reimplement from the documented behavior, or skip.

    sed -n 1,80p api/_lib/agent-registry.js
    sed -n 1,40p api/_lib/agent-identity.js
    curl -s https://api.github.com/search/repositories?q=8004+solana+registry | head -c 2500

## Tasks

1. **Verify the registry.** Re-derive program id, SDK package and license from the primary repository and record in the doc. Use the published SDK.
2. **Registration.** Alongside `registerIdentityV1`, enrol the agent in this registry using the same authority-managed flow (no owner signature), storing the registry address on the agent row.
3. **Read side.** In the hiring flow (`a2a-hire`) read a candidate agent's registry tier and feedback score and show it on the agent card and in search ranking next to our own Trader Passport.
4. **Back-fill job** for existing minted agents, rate limited.
5. Devnet registration and read in tests.

## Definition of done

- [ ] A devnet agent registered and read back with its tier (signatures and output).
- [ ] Agent page shows the registry badge when present and nothing when absent.
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
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/622-beat-22-solana-agent-registry-registration.md`) and append a dated entry to [_context/beat-PROGRESS.md](_context/beat-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
