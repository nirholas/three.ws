# 416. Restore the connector-key-cannot-spend regression suite (it cannot even load) and fix two stale scope-error assertions

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- Bug fixes are test-first: both failures already exist and are reproduced below. Confirm each fails for the stated reason before editing, then fix, then confirm green. Commit tests and fix together.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Step 0: re-derive the current state

    npx vitest run tests/mcp-spend-gate.test.js

As measured 2026-10-24, this does not run a single test; it fails at import time:

    FAIL tests/mcp-spend-gate.test.js [ tests/mcp-spend-gate.test.js ]
    TypeError: presetScopes is not a function
     ❯ tests/mcp-spend-gate.test.js:41:47

This is the only test file that exercises "a connector key (Grok Bot, a schedule, CI) can never spend" across all five hosted MCP servers (`three.ws`, `threews-agent`, `threews-3d-studio`, `threews-x402-bazaar`, `ibm-x402-mcp-remote`). It has been completely dark since whichever commit broke its imports; a regression that let a connector key spend would currently ship silently with zero test signal.

Also confirm the second, narrower failure:

    npx vitest run tests/api/mcp-wallet-provision.test.js -t "scope"

As measured 2026-10-24: 2 failed (`enforces the wallet:write scope`, `enforces the services:write scope`), both `TypeError: Cannot read properties of undefined (reading 'code')` at the line asserting `r.error.code`.

If either command now passes cleanly (another agent already shipped a fix), run `git log --oneline -5 -- tests/mcp-spend-gate.test.js tests/api/mcp-wallet-provision.test.js api/_lib/key-scopes.js api/_mcp/policy.js` to find it, confirm the suite genuinely runs and asserts real behavior (not skipped/emptied), and retire this order per the "Never blocked" table.

## Root cause

A connector-key spend-scope feature was built across commits `d551023c2`, `008d23bf2`, `872587de0` (2026-10-08), tested by `tests/mcp-spend-gate.test.js` against names like `CONNECTOR_KEY_SCOPES`, `CONNECTOR_MARKER`, `capConnectorScope`, `isConnectorScope`, `presetScopes`, `KEY_PRESETS` (expected in `api/_lib/spend-scope.js` and `api/_lib/api-keys.js`) and `SPEND_REFUSED_CODE`, `SPEND_WRITE_TOOLS`, `assertMaySpend`, `spendScopeFor` (expected in `api/_mcp/policy.js`). A later large merge (`d77b89178`, "reconcile 140 files of parallel evolution") and two follow-up patches (`0012dcb3c`, `e22e51bc5`) refactored the real implementation into a different, differently-named module: `api/_lib/key-scopes.js` now owns `CONNECTOR_PRESET`, `CONNECTOR_SCOPES`, `SPEND_GRANTS`, `effectiveKeyScope()`, `connectorViolations()`, `connectorSpendMessage()`, `BROWSER_SESSION_URL`; `api/_mcp/policy.js` now owns `connectorSpendError()` (JSON-RPC code `-32003`, `data: { reason: 'spend_requires_browser_session', tool, url }`) and enforces it inside `gateCall()` via `auth?.connector && movesValue(serverId, name)`. The refactored implementation is confirmed working (grepped, read in full, traced end to end): a connector-preset key is stripped of every spend-capable scope at authentication time in `api/_lib/auth.js` (`effectiveKeyScope`), independent of whatever its stored scope string says, and `gateCall` refuses any value-moving tool call from a connector-flagged principal before the handler runs. **This is not a runtime security hole.** It is a test-maintenance gap: nobody updated `tests/mcp-spend-gate.test.js`'s imports and assertions to the renamed module, so the entire suite that pins this guarantee has been silently non-executing, and would stay that way through any future refactor that genuinely broke the guarantee.

The second failure is unrelated to the refactor and is a pre-existing mismatch between an aspirational design and what shipped. The commit message for `d551023c2` describes a single choke point that refuses spend for "an account-bound bearer without the spend scope" generally (not just connector keys) with a JSON-RPC `-32003`. What actually shipped for a non-connector, under-scoped bearer (e.g. an ordinary authenticated user whose token lacks `wallet:write`) is a different, already-consistent-elsewhere mechanism: `scopeRequired(scope)` in `api/_mcpagent/tools.js` (line 120), returning a tool-result-level refusal (`isError: true`, `structuredContent: { ok: false, reason: 'insufficient_scope', required: scope }`), called at lines 514, 602, 703, 855, 898 across `provision_wallet`, `monetize_endpoint`, and every other scope-gated tool in that file. Every *other* scope/sign-in test in `tests/api/mcp-wallet-provision.test.js` (e.g. `requires sign-in for monetize_endpoint`, the `wallet:read` checks) already asserts this exact `r.result.isError` / `r.result.structuredContent` shape and passes today. Only these two tests ("enforces the wallet:write scope", "enforces the services:write scope", lines 251-255 and roughly 378-384) assert the abandoned JSON-RPC `-32003`/`spend_scope_required` shape instead, making them the outliers against the file's own house style, not the house style being wrong. The action is correctly refused either way; only the test's expected error shape is stale.

## Task

### Part A: restore `tests/mcp-spend-gate.test.js`

1. Open `tests/mcp-spend-gate.test.js` in full. Replace its import block (currently importing non-existent names from `api/_lib/spend-scope.js`, `api/_lib/api-keys.js`, and `api/_mcp/policy.js`) with the real, current exports:
   - From `api/_lib/key-scopes.js`: `CONNECTOR_PRESET`, `CONNECTOR_SCOPES`, `SPEND_GRANTS`, `effectiveKeyScope`, `connectorViolations`, `connectorSpendMessage`, `BROWSER_SESSION_URL` (whichever the test body actually needs after step 2).
   - From `api/_mcp/policy.js`: `connectorSpendError`, `movesValue`, `gateCall`, `listForRequest` (whichever the test body actually needs).
   - Drop imports with no current equivalent (`KEY_PRESETS`, `presetScopes`, `SPEND_REFUSED_CODE`, `SPEND_WRITE_TOOLS`, `assertMaySpend`, `spendScopeFor`, `isConnectorScope`, `capConnectorScope`, `CONNECTOR_MARKER`); rewrite the assertions that used them in terms of the real API (e.g. a connector key's effective scope comes from `effectiveKeyScope({ scope: <stored>, preset: CONNECTOR_PRESET })`, not a standalone `capConnectorScope(presetScopes(...))` call).
2. Rewrite `expectBrowserRefusal()` (and any assertion using `SPEND_REFUSED_CODE` / `reason: 'connector_key_cannot_spend'` / `required_scope`) to match `connectorSpendError()`'s real shape: `code: -32003`, `data: { reason: 'spend_requires_browser_session', tool: name, url: 'https://three.ws/dashboard' }`. Read `api/_mcp/policy.js` lines 162-168 and `api/_lib/key-scopes.js` lines 96-106 again while doing this so the rewritten assertions describe the literal current code, not a guess.
3. Keep the test's structure and intent (walk every hosted server's `tools/list` and `tools/call` with a connector principal; confirm every value-moving tool is refused; confirm a non-connector key keeps full access) since that design is sound and still the right thing to pin; only the glue to the real module names and the real error shape changes.
4. Run `npx vitest run tests/mcp-spend-gate.test.js` repeatedly while fixing until every test in the file passes for real reasons (not by weakening an assertion to always pass; each assertion must fail if you temporarily comment out the `auth?.connector && movesValue(...)` check in `gateCall`, to prove it is load-bearing, then restore the check before committing).

### Part B: fix the two stale assertions in `tests/api/mcp-wallet-provision.test.js`

5. Open `tests/api/mcp-wallet-provision.test.js` at the `enforces the wallet:write scope` test (around line 251) and the `enforces the services:write scope` test (around line 378). Replace:

       expect(r.error.code).toBe(-32003);
       expect(r.error.data).toMatchObject({ reason: 'spend_scope_required', required_scope: 'wallet:write' });

   with the shape every neighboring test in the same file already uses for a designed refusal, matching what `scopeRequired('wallet:write')` in `api/_mcpagent/tools.js` (line 120) actually returns:

       expect(r.result.isError).toBe(true);
       expect(r.result.structuredContent).toMatchObject({ ok: false, reason: 'insufficient_scope', required: 'wallet:write' });

   Do the equivalent for the `services:write` test with `required: 'services:write'`.
6. Run `npx vitest run tests/api/mcp-wallet-provision.test.js` in full and confirm all tests in the file pass, not just the two edited ones.

## Done when

- `npx vitest run tests/mcp-spend-gate.test.js` passes in full, with every assertion verified load-bearing (temporarily breaking the real `gateCall` connector check makes the relevant test fail, confirmed, then the check is restored).
- `npx vitest run tests/api/mcp-wallet-provision.test.js` passes in full.
- `git diff` touches only `tests/mcp-spend-gate.test.js` and `tests/api/mcp-wallet-provision.test.js` (no source files under `api/` change; this order fixes test staleness, not application behavior).
- Both files are committed together on `evolve` with an explicit-path commit describing the restored coverage and the two corrected assertions.
- This file is removed, with a dated entry added to `prompts/finish/_context/production-100-PROGRESS.md` (create it with a one-line header if it does not exist) citing the fix commit SHA and noting explicitly that no runtime enforcement code changed, only test coverage.

## Never blocked

| Looks like a blocker | It is not | Do this |
|---|---|---|
| Another agent already fixed this | Routine for a shared worktree | Re-run both step-0 commands first; if both already pass, confirm via `git log` the fix genuinely restored coverage (not an emptied/skipped test file), then retire this order without further changes |
| Tempted to resolve the import error by weakening assertions to `expect(true).toBe(true)` or deleting hard-to-rewrite cases | Defeats the entire point: this is the one suite that would catch a future regression in the connector-cannot-spend guarantee | Rewrite each assertion against the real module (`api/_lib/key-scopes.js`, `api/_mcp/policy.js`) so it still fails if the real enforcement breaks; verify with the break-then-restore check in step 4 before committing |
| Unsure whether the two `mcp-wallet-provision.test.js` tests should instead be fixed by changing the application code to throw the JSON-RPC `-32003` for every under-scoped bearer, matching the original 2026-10-08 design intent | That would touch five dispatcher call sites and every other scope-gated tool in `api/_mcpagent/tools.js` to stay consistent, a much larger change than this order's scope, for a path that already correctly refuses the action today (just with a tool-result shape instead of a JSON-RPC one) | Fix the two tests to match the actual, already-consistent-elsewhere `scopeRequired()` shape per step 5; do not change `api/_mcpagent/tools.js` in this order |
| `effectiveKeyScope()` or `connectorSpendError()` look like they might have changed again since 2026-10-24 | Possible if another agent is actively working this area | Re-read the current file contents before writing the rewritten assertions; do not copy this order's quoted code verbatim without confirming it still matches `api/_lib/key-scopes.js` and `api/_mcp/policy.js` on disk |

## Report format

State: both step-0 failing outputs, the import/assertion rewrite diff for `tests/mcp-spend-gate.test.js`, the break-then-restore proof that the rewritten assertions are load-bearing, the two-line diff for `tests/api/mcp-wallet-provision.test.js`, both final passing-test outputs, and the commit SHA.
