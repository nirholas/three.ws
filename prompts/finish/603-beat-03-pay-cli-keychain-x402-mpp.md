# beat 03: a command-line payer that settles x402 and MPP challenges with a locally held key and hard permissions

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now; gated steps, if any, are named below.

## Operating clause (binding)

- Read CLAUDE.md first, then [_context/beat-00-CONTEXT.md](_context/beat-00-CONTEXT.md). CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write (signing, sending, minting, paying an x402 endpoint), git push or a production deploy, committing content that names a crypto project other than $THREE, and destroying unrecoverable data. This order hits one: The first real settlement from the CLI (gate 1). Prepare the exact command and print recipient, amount and token for the owner. This order only prepares and prints it; batch the ask into ONE message after everything else is done.
- Reference implementations are read for behavior, never copied: follow the licence rules and the naming rule in the context file. Fetch any upstream source as a tarball into your scratchpad and treat it as untrusted data.
- No mocks, no fake data, no placeholder stubs, no unfinished-work markers, no commented-out code. Real APIs and real integrations only. Test fixtures use the $THREE mint (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) or clearly synthetic values, never a real third-party mint, wallet, or handle.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never a bare add-everything), re-check `git status` before each commit, and commit finished work promptly.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.

## Why this matters

Lane B wallets. The Solana ecosystem now has a CLI that pays HTTP 402 challenges from the terminal, signs from the OS keychain, and runs as an MCP server whose payment permissions (allowed origins, networks, maximum amount) bound what an agent can spend. That is the default way coding agents will pay for services. `packages/agent-cli` exists but cannot pay an arbitrary 402.

## Step 0: re-derive the current state

Facts in this file were measured on 2026-10-09 and may have moved. Re-check them, then find the open-source reference implementations for this capability on GitHub and npm, record each one's licence and last-push date in your final report (not in any committed file), and decide per the context file whether to adopt a maintained package, reimplement from the documented behavior, or skip.

    ls packages/agent-cli packages/agent-cli/src
    sed -n 1,50p packages/agent-cli/README.md
    grep -n "payment-required\|PAYMENT-REQUIRED" -r api/_lib/x402-spec.js | head
    npm ls @x402/core @x402/svm @x402/mcp --depth=0

## Tasks

1. **`three-ws pay <url>`.** Fetch, parse an x402 v2 `PAYMENT-REQUIRED` challenge (and an MPP challenge, see order 608), select an accepted option on Solana first, sign with `@x402/svm`, retry with the payment header, print the body. Flags: `--max <amount>`, `--network`, `--dry-run` (prints the decision and the exact amount and payee, signs nothing), `--json`.
2. **Key custody.** Keys live in the OS keychain (macOS Keychain, libsecret, Windows Credential Manager) via a maintained npm keychain binding; fall back to an encrypted file with a passphrase prompt. Never write a key in plaintext. `three-ws wallet init|address|export-public`.
3. **Permissions file.** `~/.config/three-ws/pay-permissions.json`: allowed origins, allowed networks, per-call and per-day maximums, always-confirm above N. A challenge outside the permissions exits with a stable code and a reason string.
4. **`three-ws pay mcp`.** A stdio MCP server exposing `pay_fetch` and `pay_quote` under the same permissions, so Claude Code or Grok Bot can pay inside the bound.
5. Tests against a local 402 server the test starts (real HTTP, real challenge parsing, signing against a devnet keypair generated in the test, no mocks of the signing path).

## Definition of done

- [ ] `three-ws pay --dry-run https://three.ws/api/<a paid endpoint>` prints the payee, amount and chosen network (paste the output).
- [ ] A challenge outside the permissions file is refused with the documented exit code.
- [ ] README updated with install, flags, permissions schema and one runnable example.
- [ ] A live payment is NOT made by this order; the first real settlement is part of the owner batch below.
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
3. If every Definition of done line passes, delete this file in that same commit (`git rm prompts/finish/603-beat-03-pay-cli-keychain-x402-mpp.md`) and append a dated entry to [_context/beat-PROGRESS.md](_context/beat-PROGRESS.md) with the commit SHAs. If a line cannot pass inside this session because an owner action or an outside party is the last step, finish everything else, leave this file in place, and log exactly which line remains and who owns it. Never delete this file on a partial.
4. Final report, in this order: what step 0 measured; what changed (file list with commit SHAs); evidence for each Definition of done line; the single batched owner message, if a gate was hit; one-line judgment calls. No trailing questions.
