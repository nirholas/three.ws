# 455 grok-fix-05: Grok usage numbers that exclude our own traffic

**How to run:** paste this whole file into a fresh Claude Code chat opened at `/home/nich/three.ws`. Read `CLAUDE.md` before step 0.

**Operating clause (binding):** finish 100% in this session; do not ask the owner questions; no mocks, fake data, TODOs or stubs; never write the em-dash or en-dash character; bug fixes are test-first; stage explicit paths only and commit promptly with a message that describes the diff. Read-only against the production database: SELECT only, no migrations, no writes. Deploys and pushes are owner-gated. This order is independent of orders 451 to 454 and 456 to 458.

## Why

The 2026-11-25 announcement said "5,547 tool calls in 44 days", "Traffic every single day", "2 errors" and "718 distinct prompts written by people and agents we have never met". On 2026-11-27 an audit found those figures came from `scripts/grok-comarketing-numbers.mjs` counting every `usage_events` tool call on `/api/mcp-grok`, which includes:

- the synthetic connector probe (`api/cron/mcp-probe.js`, every 5 minutes; its exact call is `PREFERRED_CALLS['/api/mcp-grok']` exported from `api/_lib/mcp-probe.js`: `search_docs` with `{ query: 'connect Grok to three.ws', limit: 1 }`). On 2026-11-27 about 288 of 293 calls in 24 hours were the probe.
- our own manual testing (the numbers appendix itself attributes the refresh-token grants to "most likely our own testing").
- "718" is distinct prompts minus those whose first 60 characters match text in the repo (`ownPromptCorpus()`), so anything typed by hand while testing still counts as a stranger.
- model counts are tool calls, not finished models; "errors" counts only calls that returned an error, not jobs that failed later.

`/api/grok/stats` (`api/_lib/grok-stats.js`) already excludes the probe's call as of `848857cb2` (test: `tests/grok-stats.test.js`). The numbers script does not.

## Step 0

1. Read `scripts/grok-comarketing-numbers.mjs` in full, the numbers appendix in `docs/partners/xai-comarketing-kit.md` (it may have been renamed by order 453: `git log --follow --oneline -3 -- docs/partners/xai-comarketing-kit.md`, or `git grep -ln "numbers appendix" docs/partners`), and `api/_lib/grok-stats.js`.
2. Database access. There is no `.env.local` on the devbox. `node scripts/read-service-env.mjs '^DATABASE_URL$' --raw` reads it from Cloud Run. If that fails with "Reauthentication failed", the owner must run `gcloud auth login nich@sperax.io` and `gcloud auth login nich@three.ws` in a terminal on this machine: do tasks 1 to 3 (code and tests on PGlite) first, then report that one line. Pass the URL to commands as a process env var only (`DATABASE_URL="$(node scripts/read-service-env.mjs '^DATABASE_URL$' --raw)" node scripts/...`); never write it to a tracked file.
3. Find which `usage_events` columns identify a caller: `client_id`, `meta`, user or API key ids, IP hash. Look at the migration `api/_lib/migrations/20260605120000_usage_events.sql` and the writers (`api/_lib/usage.js`, `api/_mcp-studio/handler.js`).

## Tasks

1. **Define "ours" once.** A small module (for example `api/_lib/own-traffic.js`) exporting the SQL predicate pieces and JS predicate used by both `grok-stats.js` and the numbers script:
   - the probe's exact call (import `PREFERRED_CALLS`, never retype it);
   - calls authenticated as accounts the team owns: build the list from real data, not guesses (the QA account `AUDIT_EMAIL` in `.env`, accounts with an admin role in `users`, and any account id the probe or e2e scripts sign in as; find them with `git grep -n "AUDIT_EMAIL\|e2e.*@\|@three.ws" scripts api`). Read the list at runtime from the database (role or email domain), never hardcode user ids;
   - calls whose user agent is one of our scripts (check what UA `scripts/xai-mcp-e2e.mjs`, `scripts/grok-examples-smoke.mjs`, `api/_lib/mcp-probe.js` send; give them a distinctive UA if they have none, and test that).
2. **Test first** in `tests/grok-comarketing-numbers.test.js` (PGlite via `tests/_helpers/pglite-full-schema.js`, as `tests/grok-stats.test.js` does): seed probe calls, an owned-account call, a script-UA call and two stranger calls; assert the script's query functions count only the strangers. Refactor the script so its queries are importable functions with the CLI as a thin wrapper. Confirm the test fails on the current code, then make it pass.
3. **Attribute to xAI clients.** The script's `--logs` census reads Cloud Logging user agents for xAI clients. Make the headline figures say which share came from xAI's own clients (Grok Bot, grok.com connector, xAI API) versus other MCP clients (Cursor, Claude, unknown), using the same UA list. If the UA is not stored on `usage_events`, join to Cloud Logging by request time and session id as the script already does for the census, or say plainly in the output that attribution is log-based.
4. **Report finished work, not calls.** For generation tools, add finished-model counts from `forge_creations` (status done) joined to the calls that started them, next to the call counts, and a failed-job count next to the error-call count.
5. **Make `/api/grok/stats` use the shared predicate** so the page and the script cannot disagree. `npx vitest run tests/grok-stats.test.js tests/grok-comarketing-numbers.test.js`.
6. **Refresh the figures** (needs the database): `DATABASE_URL=... node scripts/grok-comarketing-numbers.mjs --from 2026-10-08 --to <yesterday UTC> --logs`, and the original window `--from 2026-10-08 --to 2026-11-20` for comparison. Rewrite the numbers appendix with the new figures, the exact command, the date range, and one line saying what is excluded. Keep the old figures in a dated "superseded" note so the change is auditable.
7. **Docs and changelog.** Update the script's header comment. If `/grok` stats change visibly, append one `data/changelog.json` entry (tags `fix`, link `/grok`), then `npm run build:pages`.
8. `npm test` once before close-out.

## Definition of done

- [ ] One shared "our own traffic" definition used by both `/api/grok/stats` and the numbers script.
- [ ] New test fails before, passes after; `tests/grok-stats.test.js` still passes.
- [ ] Figures refreshed from production with the exact command and window recorded, or the single gcloud line reported if access was unavailable.
- [ ] Committed with explicit paths; nothing pushed or deployed; no database writes.
- [ ] One entry appended to `prompts/finish/_context/grok-fix-PROGRESS.md`.

## Report format

Old versus new headline figures (tool calls, distinct external prompts, finished models, active days, failures) for both windows, the share from xAI clients, what is excluded and why, commit hashes.
