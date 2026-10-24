# 429. The 2026-10-24 dependency security sweep left a live zod DoS open in the x402/chat path and never finished materializing its own toml fix

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan. A judgment call goes in one line of the final report; it never becomes a question that halts work.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: spending real funds or any irreversible on-chain write, git push or a production deploy, posting to an external channel, committing content that references a crypto project other than $THREE, and destroying unrecoverable data. This order touches none of them.
- No mocks of the thing under test, no fake data, no unfinished-work markers, no commented-out code, no `it.skip` / `.todo` to make a failure disappear.
- The em-dash and en-dash characters are banned in everything you write.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- Before committing, run `npm run check:rules -- --paths <files you touched>`. It must exit 0.
- Bug fixes are test-first (CLAUDE.md): this is a dependency-pin bug, so "reproduce" means a test that reads the resolved version straight from `package-lock.json`/`node_modules` and fails today because the resolved version is in the vulnerable range. Write it before touching `package.json` or running `npm install`.
- Master `prompts/masters/06-the-adversary.md`'s honesty-pass discipline applies directly here: a same-day changelog entry claims a fix that the lockfile does not fully back up. Do not add a new overclaim on top of the old one; if a gap remains after your best real fix attempt, say so in the changelog in plain language.

## Why this matters (measured 2026-10-24, from HEAD `cbf6244e3`)

The changelog entry dated 2026-10-24 titled "Hundreds of dependency security advisories cleared across the repo" (`data/changelog.json`) claims:

> "Every committed lockfile was audited and patched: same-line security releases everywhere, vetted moves to patched majors (vitest 4, **zod 4**, helia 7, Svelte 5 and Vite 7 in the chat app, transformers 4 in HQ, gltf-transform 4 for the meshopt worker), and each package's tests and builds were rerun before and after."

The commit this refers to, `1e0698207` ("fix(deps): pin patched jayson, toml, uuid, adm-zip, js-yaml, yaml and zod lines in the root lockfile", one commit before the changelog commit `fbd27eadd2`), added these overrides to root `package.json`:

    "adm-zip@~0.4": "~0.6.1",
    "js-yaml@^4": "^4.3.2",
    "jayson@^4": "^5.0.0",
    "toml@^3": "^5.0.1",
    "uuid@^9": "^11.1.1",
    "uuid@^8": "^11.1.1",
    "yaml@^1": "^1.10.3",
    "zod@^4": "^4.6.7"

Two of these did not land the way the changelog implies:

**1. The zod override only catches consumers that already wanted zod 4.** `"zod@^4": "^4.6.7"` is npm's key-scoped override syntax: it rewrites the resolution *only* for dependents whose own declared range already matches `^4` (here: `colyseus`'s `@colyseus/core`/`@colyseus/better-call`/`@colyseus/playground`, `@modelcontextprotocol/ext-apps`, `@ellipsis-labs/rise`). Root `package.json` itself still declares `"zod": "^3.23.8"` (line 769), and every dependent that declares `zod` as `^3.x` is untouched by this override and still resolves to the dominant deduped `zod@3.25.76`, confirmed live:

    node -e "console.log(require.resolve('zod'))"
    → /home/user/projects/.evolve-wt/node_modules/zod/index.cjs  (3.25.76)

    npm audit --omit=dev --json | node -e "const a=JSON.parse(require('fs').readFileSync(0));console.log(JSON.stringify(a.vulnerabilities.zod,null,2))"
    → severity: "high", isDirect: true, range: "<4.6.6"
      via: GHSA-mrhx-c7xc-m3w5, "Zod can exhaust memory while validating oversized constrained collections",
           CWE-770, CVSS 7.5 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H)
      effects: @coinbase/cdp-sdk, @coinbase/x402, @discord/embedded-app-sdk, @okxweb3/app-x402-core,
                @privy-io/api-base, @pythnetwork/hermes-client, @reown/appkit-wallet,
                @x402/core, @x402/evm, @x402/extensions, @x402/mcp

`@coinbase/x402` and the `@x402/*` family are this platform's x402 payment rail, and `@ai-sdk/anthropic`/`@ai-sdk/openai`/`@modelcontextprotocol/sdk` (also deduped to `3.25.76`, confirmed via `npm ls zod`) back the chat and MCP surfaces. 165 files under `api/`, `src/`, `scripts/` import `zod` directly (`grep -rl "from 'zod'" api/ src/ scripts/ | grep -v node_modules | wc -l` → 165), including `api/chat.js`, `api/x402-checkout.js`, `api/x402-checkout-record.js`, `api/x402-merchant.js`, `api/x402-skus.js`, `api/marketplace/*`, `api/agent-skills.js`, `api/agent-skill-price.js`: they resolve the same vulnerable `3.25.76` from `node_modules/zod` by plain node module resolution. A network-reachable DoS advisory with a public GHSA ID is live today on the request-validation path of the payment rail, and the changelog says "zod 4" as if this were closed.

**2. The toml override never fully materialized in the lockfile.** `"toml@^3": "^5.0.1"` did apply to the *nested* copies under the kamino/meteora/pump-fun SDK tree (`node_modules/@coral-xyz/anchor/node_modules/toml` and seven siblings all resolve to `5.0.1`, confirmed via the lockfile's `packages` map), but the top-level, hoisted instance used directly by the root's own `@coral-xyz/anchor@0.32.1` did not move:

    npm ls toml
    → @coral-xyz/anchor@0.32.1
        `-- toml@3.0.0 invalid: "^5.0.1" from node_modules/@coral-xyz/anchor

    npm audit --omit=dev --json | node -e "const a=JSON.parse(require('fs').readFileSync(0));console.log(JSON.stringify(a.vulnerabilities['@coral-xyz/anchor'],null,2))"
    → severity: "high", isDirect: true, range: "*", via: ["toml"], fixAvailable: false

`toml@3.0.0` sits in the range for all five open toml GHSA advisories (quadratic-complexity DoS via array-of-tables headers GHSA-4qx8-w7c3-pj3p, via dotted keys GHSA-9j65-hcg3-gc64, uncontrolled resource consumption via long integers GHSA-9qmh-m7c6-f92p, uncontrolled recursion GHSA-82x6-q7mm-w9cf, prototype pollution GHSA-v5mp-jgw5-2x6j). The override's intent was correct; the lockfile just was not fully regenerated from it for every instance.

**Baseline, for comparison against your own fresh run:** `npm audit --omit=dev --json` on 2026-10-24 reports `metadata.vulnerabilities = {info:0, low:27, moderate:7, high:56, critical:0, total:90}`.

**What this order is deliberately NOT about:** `@solana/spl-token` / `@solana/buffer-layout-utils` is also flagged high via `bigint-buffer` (`fixAvailable: false`; confirmed 2026-10-24 that `@solana/buffer-layout-utils` has never published past `0.3.0` and carries no fix). The changelog already honestly discloses this class ("What remains are advisories with no patched release published anywhere (bigint-buffer, elliptic, node-forge)"). Do not touch it and do not re-disclose what is already honestly disclosed; this order is only about the two items the changelog claimed were fixed but measurably are not.

## Step 0: re-derive the current state

    git log --oneline -1
    git show --stat 1e0698207 -- package.json          # confirm the override block is still there and unchanged
    node -e "console.log(require.resolve('zod'))"       # confirm which zod version plain 'zod' imports still get
    npm ls zod 2>&1 | head -40
    npm ls toml 2>&1
    npm audit --omit=dev --json > /tmp/audit-429.json
    node -e "const a=require('/tmp/audit-429.json'); console.log(JSON.stringify(a.vulnerabilities.zod,null,2)); console.log(JSON.stringify(a.vulnerabilities['@coral-xyz/anchor'],null,2)); console.log(a.metadata.vulnerabilities)"
    node -e "const fs=require('fs');console.log(fs.readFileSync('data/changelog.json','utf8').includes('zod 4'))"   # confirm the overclaim is still live in the committed changelog

If either finding is already gone (an unrelated commit in this shared worktree beat you to it), skip that half and say so in the report; do not re-fix what is already fixed.

## Tasks

1. Write `tests/dependency-pin-advisories.test.js`. Offline and deterministic (no network, no shelling `npm audit`): read `package-lock.json` directly (`JSON.parse(readFileSync('package-lock.json','utf8')).packages`) and assert, by exact `node_modules/...` path:
   - The root `node_modules/zod` entry's `version` satisfies `>=4.6.6` (use `semver.gte` if `semver` is already a dependency, else a simple parsed-tuple compare; check `grep -n '"semver"' package.json` first rather than adding a new dependency for this).
   - The root `node_modules/@coral-xyz/anchor/node_modules/toml` entry's `version` satisfies `>=5.0.1` (if the package stays hoisted rather than nested after your fix, resolve whichever path `npm ls toml` shows as the one `@coral-xyz/anchor@0.32.1` actually uses, and assert that path).
   Run it now and confirm both assertions fail for the reason this file states (version too low), not for an unrelated parsing error.
2. Fix zod. Edit the override in `package.json` from `"zod@^4": "^4.6.7"` to the unscoped `"zod": "^4.6.7"` so every consumer gets the patched line. Run `npm install`, then `npm ls zod` (confirm no `invalid` markers) and `npm run test:core`. Compare the failing-test count to a baseline you capture from `npm run test:core` *before* this edit (the suite already has pre-existing failures tracked by other orders; your job is zero *new* failures, not a clean suite). Pay particular attention to any test file that imports `@coinbase/x402`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, or `@modelcontextprotocol/sdk`, or exercises `api/chat.js`, `api/x402-checkout.js`, `api/x402-checkout-record.js`, `api/x402-merchant.js`, `api/x402-skus.js`, `api/marketplace/*`, `api/agent-skills.js`, `api/agent-skill-price.js` (`grep -rl "x402-checkout\|x402-merchant\|x402-skus\|chat.js\|marketplace\|agent-skills" tests/ | sort`).
   - If the broadened override is clean (no new test failures), keep it. This is the fix; the changelog's "zod 4" claim becomes true.
   - If broadening breaks a specific vendor package's own behavior (a zod-3-only internal API called by *their* code, not yours), narrow the override to per-package form instead of reverting outright: `"overrides": {"@coinbase/x402": {"zod": "^4.6.7"}, "@ai-sdk/anthropic": {"zod": "^4.6.7"}, ...}`, adding only the packages that stay green, and leave the ones that do not on `zod@^4` scoped to themselves (i.e. revert just that one package's forced bump). Re-run `npm run test:core` after each change until nothing new is red beyond what the unscoped attempt already revealed, and name every package left on the vulnerable line in the final report and in the changelog edit from task 4.
3. Fix toml. Run `npm install` first (the override already exists in `package.json`; confirm whether a plain reinstall resolves the hoisting). If the top-level `@coral-xyz/anchor` instance still shows `invalid` after that, try `npm install toml@^5.0.1` to force a fresh resolve of the top-level package, then `npm ls toml` again. Re-run `npm run test:core` and confirm no new failures (toml is used for Anchor IDL/config parsing; grep `tests/` for anything exercising Anchor-based Solana SDKs before assuming silence means safety).
4. Re-run `node -e "..."` from Step 0 against a fresh `npm audit --omit=dev --json` and compare to the `/tmp/audit-429.json` baseline. Edit `data/changelog.json`: if both items are now fully fixed, no changelog change is needed (the existing 2026-10-24 entry becomes accurate; say so in the report). If either item only got a partial fix per task 2's fallback, append a new dated entry (today, 2026-10-24, tag `["security","infra"]`) that names exactly what remains open and why (e.g. "`@coinbase/x402` ships its own zod 3.x internals and has not published a zod-4-compatible release; tracked, left on the patched-3.x line until it does" versus whatever you actually found), so the public record stops overclaiming. Do not edit the derived `public/changelog*.json`/`public/sitemap/index.html` files by hand; run `npm run build:pages` (or whatever `audit:docs`/the existing build step names) if the repo's convention regenerates them from `data/changelog.json`, confirmed by checking how the 2026-10-24 entry's commit touched those same derived files.
5. Run `npm run check:rules -- --paths package.json package-lock.json data/changelog.json tests/dependency-pin-advisories.test.js` and fix anything it flags.

## Definition of done

- [ ] `tests/dependency-pin-advisories.test.js` exists, failed before the fix for the stated reason, and `npx vitest run tests/dependency-pin-advisories.test.js` exits 0 after it.
- [ ] Fresh `npm audit --omit=dev --json`'s `vulnerabilities.zod` is either absent, or present only because a named, tested, deliberately-scoped exception remains (and that exception is named in the changelog, not silently left).
- [ ] Fresh `npm ls toml` shows no `invalid` marker anywhere in the tree, and `vulnerabilities['@coral-xyz/anchor']` is gone from the audit output.
- [ ] `npm run test:core` has zero new failures versus the pre-edit baseline captured in task 2 (quote both counts in the report).
- [ ] `data/changelog.json` either stays as-is (full fix, confirmed accurate) or carries a new honest entry naming the residual gap; never both silent and inaccurate.
- [ ] `npm run check:rules -- --paths package.json package-lock.json data/changelog.json tests/dependency-pin-advisories.test.js` exits 0.
- [ ] Commit with explicit paths; subject names the actual fix (e.g. `fix(deps): close the zod memory-exhaustion advisory the scoped override missed and materialize the toml fix for anchor`).
- [ ] This file deleted in the closing commit, with a dated line appended to `prompts/finish/_context/production-100-PROGRESS.md` naming the commit SHA, unless a Definition of done line could not be made to pass, in which case leave the file and say exactly which line and why.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Broadening the zod override breaks a vendor package's own tests or runtime behavior | Do not force it blindly. Narrow to a per-package override for whichever packages stay green (task 2's fallback), leave the rest on the old scoped override, and name the exception honestly in the changelog edit. The fix for a real upstream constraint is disclosure, not a forced breaking change. |
| `npm install` after the override edit produces a large `package-lock.json` diff | Expected and fine; review it before committing, but size alone is not a reason to stop. |
| Toml's hoisting needs `rm -rf node_modules && npm install` to fully resolve | Safe and reversible (local only, no git/production impact); run it. Do not hand-edit `package-lock.json`. |
| `npm audit` numbers differ from this file's baseline when you run it (other agents share this worktree) | Trust your own fresh Step 0 output over this file's numbers, per the work-order standard; note the discrepancy in the report. |
| `@solana/spl-token`/`bigint-buffer`/elliptic/node-forge also show up in your fresh audit | Out of scope on purpose, already honestly disclosed in the existing changelog entry; do not touch, do not re-disclose. |
| `semver` is not already a dependency | Do not add it for one test file; compare the three dot-separated integers manually (the versions involved, `3.25.76` vs `4.6.6`/`4.6.7` and `3.0.0` vs `5.0.1`, are simple enough for a manual tuple compare). |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you. Never claim a line you did not verify.
2. Commit with explicit paths, one commit (or a small number if the test/changelog/package edits are cleanly separable and each gets its own honest message).
3. Delete this file in the final commit once every Definition of done line is verified green, and append the dated progress line described above. If a line cannot pass, leave the file and say which line remains and why.
4. Final report, in this order: the Step 0 measurements (reproduced or not, with exact command output); which path was taken for zod (full unscoped bump, or the per-package fallback, naming every package left on the vulnerable line); the toml fix confirmation; before/after `npm run test:core` failure counts; the changelog diff (quoted) if one was made; any other one-line judgment calls. No trailing questions.
