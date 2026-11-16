# microsoft 26: prove the Marketplace SaaS offer end to end against Microsoft's SaaS API emulator before the owner publishes it

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Independent of every other `microsoft-` order, so it can run in parallel with all of them. Dev port: 3126.

## Operating clause (binding)

- Read CLAUDE.md, then [_context/microsoft-00-CONTEXT.md](_context/microsoft-00-CONTEXT.md) (facts, approved wording, parallel-run rules). CLAUDE.md overrides both.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan; judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (Partner Center, store submission, Entra registration, push, deploy) into ONE message at the end. Never contact Microsoft or any third party.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code in shipped code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit.

## Why this matters

The SaaS offer code ([api/_lib/microsoft-marketplace.js](../../api/_lib/microsoft-marketplace.js), [api/microsoft-marketplace/[action].js](../../api/microsoft-marketplace/[action].js), [api/cron/microsoft-metering.js](../../api/cron/microsoft-metering.js)) has unit tests, but nobody has driven a full purchase lifecycle through it. The owner's first real test happens in a Partner Center preview tenant, where every bug costs a day of round trips. Microsoft publishes an open-source emulator of the SaaS Fulfillment API v2 ([microsoft/Commercial-Marketplace-SaaS-API-Emulator](https://github.com/microsoft/Commercial-Marketplace-SaaS-API-Emulator), MIT) that issues purchase tokens, answers resolve/activate/update calls and fires webhooks at a configured URL. Running the real three.ws code against it finds the integration bugs now.

## Step 0: re-derive the current state

    curl -s https://three.ws/api/microsoft-marketplace/status
    grep -n "marketplaceapi.microsoft.com\|login.microsoftonline.com\|API_BASE\|process.env.MS_" api/_lib/microsoft-marketplace.js | head -40
    npx vitest run tests/microsoft-marketplace.test.js
    ls scripts | grep -i -E "microsoft|saas"
    grep -n "microsoft" package.json

Read the emulator's README and source (clone it into a fresh directory under the scratchpad, never inside the repo). Record which operations it supports (resolve, activate, get, list, change plan, change quantity, delete, operations, webhook firing, metering) and its auth model.

## Tasks

1. **Configurable endpoints.** Make the Fulfillment API base, the Metering API base and the token endpoint overridable by env (`MS_MARKETPLACE_API_BASE`, `MS_MARKETPLACE_METERING_BASE`, `MS_MARKETPLACE_TOKEN_URL`), defaulting to Microsoft's production hosts. Production behaviour must be byte-identical when unset; a unit test proves the defaults.
2. **Webhook auth in emulator mode.** The emulator cannot mint Entra tokens. Add an explicit `MS_MARKETPLACE_EMULATOR=1` mode, refused at boot when `NODE_ENV=production` or `K_SERVICE` is set, that accepts the emulator's webhook calls. Production verification code paths must be untouched; a test proves emulator mode can never be active in production.
3. **E2E harness** `scripts/microsoft-saas-e2e.mjs` (and `npm run microsoft:saas-e2e`): starts the emulator, starts the real API on port 3126 against an isolated database (`scripts/lib/isolated-db.mjs`, PGlite, so the prod DB is untouched), applies the Microsoft migrations, then drives: purchase token, `/microsoft/activate` resolve, the Entra sign-in step (exercise the callback logic with a signed test ID token issued by a key the harness generates and registers through an emulator-only JWKS override, never weakening production verification), activation, ChangePlan, ChangeQuantity, Suspend, Reinstate, Renew, Unsubscribe. After each step assert the rows in `microsoft_saas_subscriptions` and `microsoft_saas_operations`, the computed `users.plan`, and the operation verdict sent back.
4. **Metering pass.** Seed real `usage_events` rows in the isolated DB, run the metering cron handler, and assert the batches posted, the per-event settlement and idempotency on rerun. If the emulator has no metering endpoint, implement a metering receiver inside the harness that enforces Microsoft's documented `batchUsageEvent` contract (25-event batches, 24-hour window, duplicate rule, per-event statuses) and returns each documented status at least once.
5. **Bugs found** are fixed test-first: a failing case in `tests/microsoft-marketplace.test.js` first, then the fix.
6. **Docs.** A "Run the lifecycle locally" section in [docs/microsoft-marketplace-saas.md](../../docs/microsoft-marketplace-saas.md) and a line in the owner checklist of [docs/microsoft-marketplace-offer-plan.md](../../docs/microsoft-marketplace-offer-plan.md) saying the emulator pass is green. Changelog entry only if a user-visible fix landed.

## Definition of done

- [ ] `npm run microsoft:saas-e2e` passes every lifecycle step from a clean checkout (output in the report).
- [ ] Emulator mode is refused under production env (test output).
- [ ] With the overrides unset, the client hits Microsoft's production hosts (test output).
- [ ] Every bug found has a failing-then-passing test; `npm test` passes.
- [ ] Docs updated; `npm run audit:docs` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Emulator needs a newer Node or Docker | Run its Docker image if it ships one, else install the Node version user-local with the version manager already on the machine. |
| Emulator lacks an operation | Cover that operation in the harness receiver against Microsoft's documented contract, and say which in the report. |
| Database | `scripts/lib/isolated-db.mjs` (see memory "Isolated DB for live checks"). Never point the harness at production. |
| Entra token verification | Inject the test key only through the emulator-mode JWKS override; never add a bypass reachable in production. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last: leave the file, put a dated status line under the title naming what remains, and add it to the owner message. Either way append to [_context/microsoft-PROGRESS.md](_context/microsoft-PROGRESS.md).
4. Report: what step 0 measured; files and SHAs; evidence per Definition of done line; the one batched owner message; one-line judgment calls. No trailing questions.
