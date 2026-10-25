# 448. `/api/agents/:id/allowance` pull op signs and sends a real transfer with no real-funds agreement check

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix: follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them: it adds a safety check to code, it does not sign or send anything itself.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

`tests/real-funds-agreement-coverage.test.js` is the mechanical guard that every route touching a custodial Solana key either calls `requireRealFundsAgreement`/`currentSignatureFor` or carries a reviewed `EXEMPT` reason. Running it today:

    npx vitest run tests/real-funds-agreement-coverage.test.js

fails 8 of 66 assertions (58 pass). Order 401 (open, closed-vitest-suite order) mentions this test file only in passing and names a single example file; it does not diagnose the other 7. Reading every implicated file end to end (`api/_mcpagent/dispatch.js`, `api/_mcpagent/named-services-tools.js`, `api/actions/agent-tip.js`, `api/agents/solana-allowance.js`, `api/creator-payouts.js`, `api/pump/launch-intents.js`, `api/skills/import.js`, `api/labor/deliver.js`) plus the library code each one imports shows the 8 failures are **not one bug repeated eight times**. They are one real, severe gap, one test-harness blind spot that needs a test-only fix, five false positives that need `EXEMPT` entries with accurate reasons, and one stale exemption to delete. Conflating them (e.g. gating all eight, or blanket-exempting all eight) would either break working flows or silently widen the custodial-key attack surface this test exists to police. This order separates them correctly, which no existing order does.

### The one real gap: `api/agents/solana-allowance.js` `opPull` (lines 252-291)

`opPull` is reachable directly from `POST /api/agents/:id/allowance { op: 'pull' }` (dispatched at line 163 of the same file). It:

1. Checks the on-chain allowance ceiling (`checkAgentAllowanceSpend`/`checkAllowancePull`, line 259-260): good, but this is a spend-limit check, not an agreement check.
2. Recovers the agent's live custodial keypair directly: `const agentKeypair = await recoverSolanaAgentKeypair(owned.meta.encrypted_solana_secret, ...)` (line 271-274).
3. Builds, simulates, and sends a real signed on-chain transaction that moves the allowance's SPL tokens (`buildSignedPull`, `conn.sendRawTransaction`, lines 276-283).

`grep -n "requireRealFundsAgreement\|currentSignatureFor" api/agents/solana-allowance.js` returns nothing: the file never imports or calls either gate function, anywhere. Every other synchronous, request-triggered custodial signing path in this codebase that this test already covers (e.g. `api/agents/solana-wallet.js`'s withdraw handler, `api/_mcpagent/named-services-tools.js`'s `buildPayTool`) calls the gate before touching the key. This one route doesn't, meaning an account that has never signed the real-funds Terms of Service / Risk Disclosure / Agent Wallet Agreement can still pull funds through an on-chain allowance today. This is the exact failure mode `requireRealFundsAgreement`'s own docstring describes guarding against ("real funds never move on an unverified agreement").

### The test-harness blind spot: `api/_mcpagent/named-services-tools.js`

`buildPayTool`'s handler (lines 141-212) calls `const unsigned = await agreementRequired(auth.userId, url); if (unsigned) return unsigned;` (line 173-174) before `payExternalX402`. `agreementRequired` is defined in the sibling file `api/_mcpagent/tools.js` (`grep -n "agreementRequired" api/_mcpagent/tools.js` shows it at line 83, and it calls `currentSignatureFor` internally at line 86). The route genuinely enforces the gate, one hop away through a local, non-`_lib` wrapper. The test's `GATE` regex only matches the literal tokens `requireRealFundsAgreement`/`currentSignatureFor` in the route's own source, and its `DELEGATED` escape hatch (lines 52-54, 96-100 of the test) only generalizes for `api/_lib/` targets (`DELEGATED[file].replace(/^api\/_lib\//, '_lib/')`), not a same-directory file like `api/_mcpagent/tools.js`. This needs a test-only fix: extend `DELEGATED` to this file, pointed at `api/_mcpagent/tools.js`, and confirm `tools.js`'s `agreementRequired` really calls the gate (it does, per the grep above) so the check stays meaningful rather than being silently disabled.

### Five false positives, same root cause

The test's `importsKeyModule` (lines 71-77) flags a route the moment it imports **any** export from a `_lib` file whose **entire source text** matches `KEY_USE` (`recoverSolanaAgentKeypair|recoverAgentKey|loadAgentKeypairForUser|loadAgentForSigning`), even when the specific export the route uses never touches a key. Confirmed for each:

- `api/_mcpagent/dispatch.js`: imports `accountHasMcpPerps` from `api/_lib/perps/service.js` (`grep -n "recoverSolanaAgentKeypair" api/_lib/perps/service.js` shows it at line 34/603, used by an unrelated function) purely to compute `hiddenTools` (a read-only boolean gate on which MCP tools are listed). `dispatch.js` never recovers a key or moves funds itself; it wires the catalog. Reads only, same shape as the existing `api/_mcp/resources.js` exemption.
- `api/actions/agent-tip.js`: imports `getOrCreateAgentSolanaWallet` from `api/_lib/agent-wallet.js` (`grep -n "export async function recoverSolanaAgentKeypair" api/_lib/agent-wallet.js` shows it defined at line 554 in the same file, unrelated to the wallet-address lookup `agent-tip.js` actually calls). The tip's payer is the external caller's own wallet pubkey (`body.account`); `buildTransferTransaction` returns an **unsigned** transaction that the caller's own wallet signs client-side in a Solana Blink. No custodial key is ever recovered on this path; the agent is only the transfer's recipient.
- `api/creator-payouts.js`: imports `getAgentPayouts, listDistributions, issueRegistrationChallenge, registerPayoutWallet, cancelPendingWallet` from `api/_lib/creator-payouts.js`. That same lib file also defines `sendFromAgentWallet` (line 295-316) and `runDistribution` (line 349), which do call `recoverSolanaAgentKeypair` and sign a real transfer, but `grep -rn "runDistribution" api/ --include=*.js | grep -v _lib/creator-payouts.js` shows no caller outside a cron (the distribution run is cron-triggered, matching this test's own `api/cron/` exclusion). None of the five functions the route imports call `sendFromAgentWallet` or `runDistribution`.
- `api/pump/launch-intents.js`: imports `createFundedLaunchIntent, listFundedLaunchIntents, getFundedLaunchIntent, recordFundingProof, requestLaunchConfirmation, dryRunFundedLaunch` from `api/_lib/pump-funded-launch.js`. That lib file's custodial signing lives in a separate function, `executeApprovedFundedLaunch` (line 584-601, calls `loadAgentForSigning`), which the route's `confirm` action (calling `requestLaunchConfirmation`, line 508) never invokes; per the file's own header comment, "confirm: ask for the owner's yes; the approval executor signs the launch" (a separate executor, not this request).
- `api/skills/import.js`: dynamically imports `solanaConnection` from `api/_lib/agent-pumpfun.js` only to resolve an RPC endpoint string for Anchor IDL fetches (`rpcUrl: async (c) => solanaConnection(...).rpcEndpoint`). The same lib file separately defines `loadAgentForSigning` (used by `pump-funded-launch.js` above), but `skills/import.js` never calls it.

Each of these needs an `EXEMPT` entry in `tests/real-funds-agreement-coverage.test.js` with the specific reason above, not an application-code change. Gating any of them for real would add a signed-agreement requirement to a read-only or recipient-only path that moves no funds for that caller, which is not what the gate is for.

### One stale exemption: `api/labor/deliver.js`

`EXEMPT['api/labor/deliver.js']` (test line 41, reason `'settlement pays the worker; the payer signed when posting'`) assumes the file still touches a custodial key. `grep -n "recoverSolanaAgentKeypair\|recoverAgentKey\|loadAgentKeypairForUser\|loadAgentForSigning" api/_lib/labor-auth.js api/_lib/agent-labor.js api/_lib/labor-evaluation.js api/_lib/http.js` (every module `api/labor/deliver.js` imports) returns nothing: the file no longer matches `keyRoutes` at all. The payout logic moved elsewhere since this exemption was written. The "has no stale exemptions" assertion in the test (line 104-112) now correctly catches this; the fix is to delete the line from `EXEMPT`, not to re-add a key touch.

## Task

1. Reproduce the baseline: `npx vitest run tests/real-funds-agreement-coverage.test.js` and confirm 8 failing / 58 passing (66 total), matching this order's measurement. Save the failure names; you will clear them one by one.

2. **Test-first for the real gap.** Create `tests/agents-solana-allowance-pull-agreement.test.js`. Mirror the mocking style of `tests/agent-wallet-withdraw.test.js` (mock `../api/_lib/auth.js`, `../api/_lib/csrf.js`, `../api/_lib/db.js`, `../api/_lib/real-funds-agreement.js`, `../api/_lib/agent-wallet.js` for `recoverSolanaAgentKeypair`, `../api/_lib/onchain-allowance.js`, `../api/_lib/onchain-allowance-store.js`, `../api/_lib/agent-pumpfun.js` for `solanaConnection`, `../api/_lib/audit.js`, `../api/_lib/agent-trade-guards.js`). This time mock `requireRealFundsAgreement` to resolve `false` (simulating an account that has not signed) and import `handleAllowance` from `api/agents/solana-allowance.js`. Drive a `POST` with `op: 'pull'` against an owned agent with a valid allowance row and a sufficient on-chain ceiling. Assert:
   - The mocked `recoverSolanaAgentKeypair` is never called.
   - No transaction is built, simulated, or sent (spy the relevant mocks and assert zero calls).
   - The response is the agreement-required refusal shape (403, matching `requireRealFundsAgreement`'s own error envelope), not the normal pull success/failure shape.
   Run it now and confirm it fails for the stated reason: today `opPull` calls `recoverSolanaAgentKeypair` and proceeds regardless of the mocked gate's `false` return, because the file never calls the gate at all.

3. Fix `api/agents/solana-allowance.js`: import `requireRealFundsAgreement` from `../_lib/real-funds-agreement.js`, and call it inside `opPull` (around line 252-258) immediately after the ceiling check passes (`if (!mine.allow) ...` block) and before `recoverSolanaAgentKeypair` is ever reached: `if (!(await requireRealFundsAgreement(req, res, { userId: auth.userId, network: row.network, context: 'allowance_pull' }))) return;`. `opPull`'s signature already receives `req` and `res` (it is destructured from the same object `handleAllowance` passes to every op handler); no signature change is needed. Devnet is already exempt inside the gate function itself, so no extra network check is needed here.

4. Re-run `npx vitest run tests/agents-solana-allowance-pull-agreement.test.js` and confirm it passes, then `npx vitest run tests/onchain-allowance.test.js tests/token-allowance.test.js` plus any other existing test importing `api/agents/solana-allowance.js` (`grep -rl "solana-allowance" tests/`) and confirm nothing regresses.

5. **Test-only fix for the blind spot.** In `tests/real-funds-agreement-coverage.test.js`, add `'api/_mcpagent/named-services-tools.js': 'api/_mcpagent/tools.js'` to the `DELEGATED` map (line 52-54). Generalize the two assertions that use `DELEGATED[file]` (lines 96-100) so the path-to-import-string check works for a target outside `api/_lib/` too: today `DELEGATED[file].replace(/^api\/_lib\//, '_lib/')` only ever strips an `api/_lib/` prefix; for `api/_mcpagent/tools.js` (same directory as the importing route) the route's actual import text is `'./tools.js'`, so the check needs to resolve the expected import text relative to the importing file's own directory (e.g. derive it the same way `importsKeyModule` resolves relative imports, rather than a fixed string replace) instead of assuming every delegate lives under `_lib/`. Confirm the new assertion still fails if you temporarily rename `agreementRequired` in `api/_mcpagent/tools.js` (sanity check it is not a no-op), then revert that temporary rename.

6. **Five EXEMPT additions**, each with the exact reason researched above, inserted into `tests/real-funds-agreement-coverage.test.js`'s `EXEMPT` object (keep alphabetical-ish grouping consistent with the existing list, exact wording may be tightened but must stay accurate and specific, not generic):
   - `'api/_mcpagent/dispatch.js': 'only imports perps/service.js to compute hiddenTools (read-only); wires the catalog, never recovers a key or moves funds itself'`
   - `'api/actions/agent-tip.js': 'builds an unsigned Blink transaction the caller own wallet signs; the agent is only the transfer recipient, never the signer'`
   - `'api/creator-payouts.js': 'manages payout wallet registration and reads only; the actual transfer (sendFromAgentWallet/runDistribution in _lib/creator-payouts.js) runs from a cron, outside this route'`
   - `'api/pump/launch-intents.js': 'confirm records the approval only; executeApprovedFundedLaunch (the custodial signer) runs from a separate approval executor, not this route'`

   (Keep every EXEMPT value a single-quoted JS string with no apostrophe inside it, matching the existing entries in this file; rephrase to avoid contractions and possessives rather than escaping or switching quote styles.)
   - `'api/skills/import.js': 'imports agent-pumpfun.js only for its RPC endpoint (solanaConnection) to fetch an Anchor IDL; never calls the file's unrelated signing export'`

7. **One stale removal:** delete the `'api/labor/deliver.js': 'settlement pays the worker; the payer signed when posting'` line from `EXEMPT` (confirmed stale per the grep above: no module `api/labor/deliver.js` imports touches a custodial key anymore).

8. Re-run `npx vitest run tests/real-funds-agreement-coverage.test.js`: all 66+ (plus your new allowance test counted separately) must pass, 0 failing.

9. Run `npm run check:rules -- --paths api/agents/solana-allowance.js tests/real-funds-agreement-coverage.test.js tests/agents-solana-allowance-pull-agreement.test.js` and fix anything it flags.

10. Run the full suite once to confirm no unrelated regression: `npx vitest run tests/agents-solana-allowance-pull-agreement.test.js tests/real-funds-agreement-coverage.test.js tests/onchain-allowance.test.js tests/token-allowance.test.js tests/agent-wallet-withdraw.test.js tests/agent-wallet-trade.test.js`.

11. Add a `data/changelog.json` entry (tag `fix`, describing that allowance pulls now require the signed real-funds agreement like every other custodial-signing path) and run `npm run build:pages`.

12. Read the full diff (`git diff api/agents/solana-allowance.js tests/real-funds-agreement-coverage.test.js tests/agents-solana-allowance-pull-agreement.test.js data/changelog.json`) and confirm every changed line is one of the changes above: no unrelated formatting, no other op handler touched.

## Done when

- `tests/agents-solana-allowance-pull-agreement.test.js` exists, proves the gate is now called before any key recovery in `opPull`, and was confirmed to fail against the pre-fix code for the stated reason.
- `api/agents/solana-allowance.js`'s `opPull` calls `requireRealFundsAgreement` before `recoverSolanaAgentKeypair`; no other op handler in the file is touched.
- `tests/real-funds-agreement-coverage.test.js` passes in full (0 failing), with: a `DELEGATED` entry for `api/_mcpagent/named-services-tools.js` -> `api/_mcpagent/tools.js` and a generalized path-matching check; five new, specific `EXEMPT` reasons for `dispatch.js`, `agent-tip.js`, `creator-payouts.js`, `launch-intents.js`, `skills/import.js`; the stale `api/labor/deliver.js` exemption removed.
- No application file other than `api/agents/solana-allowance.js` changed.
- `npm run check:rules -- --paths api/agents/solana-allowance.js tests/real-funds-agreement-coverage.test.js tests/agents-solana-allowance-pull-agreement.test.js` reports no violations.
- A changelog entry exists and `npm run build:pages` ran cleanly.
- `git diff` shows only the files named above plus the generated changelog/sitemap files.

## Never blocked

| Apparent blocker | Resolution |
| --- | --- |
| "Should the five false positives be gated instead of exempted, to be safe?" | No. Gating a read-only or recipient-only path with a signed-agreement requirement blocks legitimate, fund-safe calls (e.g. a Blink tip the caller's own wallet signs) for no security benefit; the EXEMPT reasons above are specific and mechanically checked by the test's own "no stale exemptions" assertion going forward. |
| "What if `executeApprovedFundedLaunch` or `runDistribution` (the cron/executor paths) also need the gate?" | Out of scope here: this test explicitly excludes `api/cron/`, and the "approval executor" for launch-intents is not an HTTP route this test walks. If it is itself an HTTP route elsewhere, it already appears in `keyRoutes` under its own filename and must pass this same test on its own merits; do not add gate calls to lib functions this order did not measure. |
| "The DELEGATED generalization feels like it's touching test internals, is that allowed?" | Yes. The binding operating clause's test-first rule is about application bugs; this is a test-harness precision fix for a route that is provably already gated (step 5's grep evidence). Fixing the test to see the existing gate correctly is the right scope, not a workaround. |
| "26 other EXEMPT entries might also be stale by now." | Not this order's scope; the "no stale exemptions" assertion already checks every entry mechanically on every run, so any future staleness will fail loudly on its own. Only touch the one confirmed stale entry above. |

## Report format

State: the vitest pass/fail count before and after (8 failing -> 0), the exact line added to `opPull`, the `DELEGATED` and `EXEMPT` diffs, the `check:rules` result, and the commit hash. Call out explicitly that `api/agents/solana-allowance.js` is the only production file changed.
