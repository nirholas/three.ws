# Let an agent connect third-party MCP servers: connection routes, OAuth, runtime mounting and a catalog page

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/266-plan-mcp-external-integrations-agent-connections.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 74 of 100 inside the tier). **Area:** mcp. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

Agents can only use three.ws tools. They cannot read a Notion page, file a Linear issue, check a Stripe payment or open a GitHub issue for the person they serve, which is the most common first request from anyone who tries an agent product. The catalog (`data/mcp-catalog.json`, 83 vetted servers), the connection table (`agent_mcp_connections`), the SSRF-safe client and the tier classifier are all written, but nothing uses them at runtime: the only importers are two scripts under `scripts/`. So no agent can be connected to anything.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Built: `api/_lib/mcp-connections/catalog.js` (`validateCatalog`, `loadCatalog`, `getCatalogEntry`, `presentEntry`, `platformClientConfigured`), `client.js` (`openSession`, `fetchTools`, `probeServer`, `discoverAuth`, `toolResultToText`), `classify.js` (`classifyTool`, `defaultEnabledTools`, tiers read/write/financial), `safe-fetch.js` (`assertServerUrl`, `createSafeFetch`, `BlockedUrlError`), migration `20260925210000_agent_mcp_connections.sql` (status machine `pending_auth|pending_review|active|needs_auth|error|disabled`, `credentials_enc`, `enabled_tools`, `tier_overrides`, `acknowledged_tools`), scripts `scripts/check-mcp-catalog.mjs` and `scripts/vet-mcp-integrations.mjs` (`npm run check:mcp-catalog`, `vet:mcp-catalog`).
- Missing: routes `GET|POST|DELETE /agents/:id/mcp` and `POST /agents/:id/mcp/:conn/auth` plus the OAuth callback; storage of credentials with `api/_lib/secret-box.js`; mounting of connected tools into the agent tool loop (`api/agent/run.js`) under `ext_<name>_` names; MCP tools `list_integrations`, `install_integration`, `remove_integration`; the CLI subcommand `three-ws mcp install`; a UI. `/integrations` (`pages/integrations.html`) is an embed marketing page and is unrelated.
- Tests: none for connection lifecycle (`tests/` has only `settings-connections-route.test.js` for gateway links).

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
npm run check:mcp-catalog 2>&1 | tail -5
node -e "const c=require('./data/mcp-catalog.json');console.log(c.servers.length, [...new Set(c.servers.map(s=>s.auth))])"
grep -rn "mcp-connections" api src packages --include=*.js -l | grep -v "_lib/mcp-connections"
ls api/v1/agents/\[id\]; grep -n "agent_mcp_connections" -r api --include=*.js | grep -v migrations | head -3
npm run db:status 2>&1 | tail -6
grep -n "ext_" api/agent/run.js | head
```

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Tests first (`tests/mcp-connections-lifecycle.test.js`): a fake MCP server started in-process on 127.0.0.1 is refused by `assertServerUrl` (SSRF), a public-URL fixture served by a local HTTP stub with `allowLoopback` test injection connects, lists tools and classifies them; a new connection has every `write` and `financial` tool disabled; enabling a write tool requires it in `acknowledged_tools`; `credentials_enc` is never returned by any route; deleting a connection deletes credentials. Run, then fix real defects.
2. Routes under `api/v1/agents/[id]/mcp/` (and the `vercel.json` routes): `GET` (list with status, tool counts, last error), `POST` (`{ catalog_id }` or `{ server_url, transport }`; custom URLs enter `pending_review` and return the discovered tool list for the safety review step), `PATCH /:conn` (enable or disable tools, tier overrides, acknowledge), `DELETE /:conn`, `POST /:conn/auth` (start OAuth with the platform as client using `discoverAuth` and dynamic client registration where `registration: dynamic`, PKCE, state stored hashed in `oauth_state_hash`), and the callback `GET /api/mcp-connections/callback` that exchanges the code, stores tokens through `secret-box.js`, refreshes expiring tokens before each call.
3. Runtime: in `api/agent/run.js` (and the shared tool-loop module it uses) load the agent's `active` connections each turn, expose enabled tools as `ext_<name>_<tool>` with the classifier tier, enforce the existing tier and confirm rules (`packages/mcp-policy`), wrap every result as untrusted data (strip it into a clearly delimited block, never let it set instructions), cap result size with `toolResultToText`, record `last_used_at`, set `needs_auth` on 401.
4. MCP tools `list_integrations`, `install_integration`, `remove_integration` in `api/_mcpagent/` registered in `packages/mcp-policy/src/table.js` (list read tier, install and remove write tier), and the CLI `three-ws mcp install <name> --agent <id>` in `packages/three-ws-cli/src` with a test beside its existing tests.
5. Page `pages/mcp-integrations.html` (route `/mcp-integrations`, entry in `data/pages.json`): catalog grid with search, category chips from the catalog, vendor and transport and auth badges, "Connect" opening a dialog that starts OAuth or takes a bearer token, per-agent connection panel with tool toggles grouped by tier and a safety review table for custom URLs. States: skeleton cards, empty ("No servers match. Add a custom server by URL."), error with retry, needs-auth banner with reconnect, hover/focus/active everywhere, keyboard dialogs, mobile at 400px.
6. Real end-to-end proof: connect an agent to one public documentation MCP server (no auth) and to the GitHub MCP server through OAuth using the platform client if `platformClientConfigured` is true; the agent answers a question that needs each. If the GitHub client id is not configured, complete the no-auth server proof and report the single missing env var.
7. Docs: `docs/integrations.md` rewritten as the connections guide plus a catalog contribution guide, linked from `docs/start-here.md`; `data/changelog.json` entry tagged `feature`; `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `npx vitest run tests/mcp-connections-lifecycle.test.js` passes including the SSRF refusal and the "write tools hidden until enabled" tests.
- [ ] `npm run check:mcp-catalog` passes.
- [ ] Against `npm run dev`, an agent run uses an `ext_` tool from a no-auth public MCP server and the run shows the call and cost.
- [ ] `GET /api/v1/agents/:id/mcp` never contains `credentials_enc` or any token substring (asserted).
- [ ] `/mcp-integrations` verified in a browser in loading, empty, error, needs-auth and connected states, no console errors.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| OAuth client id for a catalog vendor is not configured | Ship the dynamic-registration path (works without a platform client), list the vendor env var as the one missing piece, prove with a no-auth or dynamic-registration server. |
| A catalog entry is stdio only | Leave it listed as `stdio` with an "install locally" instruction; the hosted runtime mounts only `streamable-http` and `sse`. |
| Third-party server is flaky in tests | Tests use a local in-process MCP server; the live proof is a separate script with retries. |
| Migration not applied locally | `npm run db:status` then `npm run db:migrate` on the dev database only. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/266-plan-mcp-external-integrations-agent-connections.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `266-plan-mcp-external-integrations-agent-connections.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/22-external-mcp-integrations-for-agents.md` (whole file)

~~~~markdown
# 22. External MCP servers as agent tools: an integrations catalog with one-command install

Read `docs/prompts/README.md` first.

## The problem

Our agents use our tools. They cannot be connected to the hundreds of third-party MCP servers that exist for Stripe, Notion, Linear, Slack, GitHub, Google Workspace, Cloudflare, Supabase, Sentry and the rest, so an agent cannot file an issue, read a doc, or check a payment for the person it serves. The best agent products ship a catalog of vetted servers with `install <name>` and per-user OAuth.

## Build

- **Catalog:** `data/mcp-catalog.json` with at least sixty vetted remote or stdio MCP servers (name, vendor, transport, URL or npm package, auth type, scopes, tool count, category, docs link), validated at build, rendered on `/integrations` (in `data/pages.json`) with search and categories.
- **Per-agent connections:** migration `agent_mcp_connections` (agent, catalog id or custom URL, auth state, encrypted credentials with the wallet secret encryption, enabled tools, tier overrides). Routes `GET/POST/DELETE /agents/:id/mcp` and `POST /agents/:id/mcp/:conn/auth` (OAuth flow with the platform as the client, tokens stored encrypted, refresh handled). Custom servers accepted by URL with a safety review step that lists the tools before enabling.
- **Runtime:** the server loop and the local runtime mount connected servers' tools under `ext_<name>_` names, each classified into the prompt 03 tiers by a rules file in the catalog entry (write tools off by default for a new connection). Tool results from external servers are untrusted data.
- **CLI and MCP:** `three-ws mcp install <name> --agent <id>`, tools `list_integrations`, `install_integration`, `remove_integration` (prompt 05 integrations become this).
- **Docs:** `docs/integrations.md` linked from `docs/start-here.md`; catalog contribution guide; changelog entry tagged `feature`.

## Acceptance

- Connect an agent to a public documentation MCP server and a GitHub MCP server through OAuth; the agent answers a question that needs each.
- A write tool on a newly connected server is hidden until enabled.
- `npm test` green with catalog validation and connection lifecycle tests.
~~~~

### `docs/prompts/03-mcp-tool-policy-skill.md` (whole file)

~~~~markdown
# 03. MCP tool policy: read-only by default, opt-in financial groups, and one model-facing skill document

Read `docs/prompts/README.md` first.

## Status (2026-10-23)

Delivered: the policy module. The table (groups, tiers, confirm flags, preview tools, bound arguments) and the enablement grammar live in [`packages/mcp-policy`](../../packages/mcp-policy/README.md) so the hosted servers and the stdio packages enforce one table. [`api/_mcp/policy.js`](../../api/_mcp/policy.js) binds it to the hosted side (Redis preview store, saved settings in `mcp_tool_settings`) and every dispatcher built on [`api/_lib/mcp-dispatch.js`](../../api/_lib/mcp-dispatch.js), plus `api/_mcp-studio` and `api/pump-fun-mcp`, calls `listForRequest`, `gateCall` and `finishCall`. `npx three-ws tools` chooses groups. [`docs/mcp.md`](../mcp.md) already explains turning the tools on.

Still open: the `/settings/mcp-tools` page and the `/api/mcp-tools` writer for `mcp_tool_settings` (nothing writes the table yet, so saved settings only take effect once they exist), the generated model-facing skill (`.agents/skills/three-ws/SKILL.md`, `scripts/build-mcp-skill.mjs`, and its byte-for-byte test; the entry-point skill today is `public/skill.md`, rendered by `scripts/build-skills-pack.mjs` from `data/skill-md.template.md`), and a test that walks every server's tool list against the table. The sections below remain the brief for those parts; where they name the original design, the shipped names are given in brackets.

## The problem

Before the policy module, our fund-moving safeguards were real but scattered: spend limits in `api/_lib/agent-trade-guards.js`, allowlists in `api/agent/guard.js`, confirm flags in `api/_mcp3d/tools/persona-identity.js` and `packages/x402-mcp/src/tools/pay-and-call.js`, payment sessions in `api/pay/`. There was no single policy that every tool registered under, no server-side default that hid financial tools until the user opted in, and no one document a model reads that lists every tool, its group, whether it moves funds, and which preview tool must precede it. The best platforms ship exactly that: a default set of read-mostly tools, explicit opt-in for the rest, a named confirm flag on every irreversible call, and a skill file that tells the model the rules.

## Build

### Tool policy module

`api/_mcp/policy.js` [the table itself is `packages/mcp-policy`], imported by every hosted server dispatcher (`api/_mcp/dispatch.js`, `api/_lib/mcp-dispatch.js` for `_mcpagent`, `_mcp3d`, `_mcpbazaar`, `_mcpibm`, `api/_mcp-studio/`, `api/pump-fun-mcp`) and by the stdio packages. Every tool definition gains:

- `group`: one of `agents, chat, runs, skills, trading, orders, perps, lending, predictions, launch, domains, marketplace, cards, mail, x402, wallet, commerce, billing, intelligence, integrations, account, allowlist, assets, gateway, sandbox, utility` (`GROUPS` in the package).
- `tier`: `read` (default on), `write` (on by default, reversible), `financial` (off by default, moves funds or is irreversible).
- `confirmFlag`: for every `financial` tool, the exact boolean argument name (`confirm_swap`, `confirm_transfer`, `confirm_launch`, `confirm_spend`, `confirm_payment`, `confirm_deposit`, `confirm_withdraw`, `confirm_delete`, `confirm_bid`, `confirm_send`, and the later `confirm_run`, `confirm_listing`, `confirm_delist`, `confirm_accept`, `confirm_trade`, `confirm_reveal`, `confirm_cancel`; `CONFIRM_FLAGS` in the package). The tool refuses without it (`reason: "confirmation_required"`), with an error that names the preview tool to call first.
- `previewTool`: the quote or preview tool that must run first; the server records the preview result id and the financial tool requires it (`quote_id` or `preview_id`), rejecting stale ones after ten minutes.

Enforcement: `tools/list` returns only enabled tools for the session. Enablement comes from, in order: the client's allowed-tools list (`X-Three-Allowed-Tools`) when present, an `X-Three-Tools` header, the `tools` query the CLI from prompt 01 sets, the per-key override and then the account setting in `mcp_tool_settings`, then the default (read plus write). A disabled tool called anyway returns `reason: "tool_disabled"` with an error that says how to enable it (`npx three-ws tools`, or the settings page). Separately, a connector-preset API key (the "For an AI agent" key) never sees or calls a value-moving tool on any server (`movesValue` in `api/_mcp/policy.js`).

Settings page: `/settings/mcp-tools` lists every group with its tier, a toggle per group, and per-key overrides. Every state designed. Add to `data/pages.json`.

### Audit the existing tools

Walk every tool in every server and package and assign group, tier, confirm flag and preview tool. Any financial tool without a preview tool gets one built in the same change. Any tool that moves funds without a confirm flag today is a bug; fix it. Report the full table in your final message.

### The model-facing skill

`.agents/skills/three-ws/SKILL.md` (and mirror it to `public/skills/three-ws/SKILL.md` and `skills-pack.json` through `scripts/build-skills-pack.mjs`): the one document a model reads to operate three.ws well. Structure:

1. What three.ws is, in two sentences, and that tools come from the hosted MCP servers installed with `npx three-ws setup` (prompt 01). If tools are missing, tell the user to run setup; never call the HTTP API directly.
2. Tool naming per client namespace.
3. How `agent_id` resolves: `list_agents` once, a default agent env or setting, ask when ambiguous.
4. A table of every group with its representative tools, generated from the policy module by a script (`scripts/build-mcp-skill.mjs`) so it cannot drift; the build fails if the doc and the policy differ.
5. The financial and irreversible section: every `financial` tool, its confirm flag, and the rule "quote or preview first, show it, wait for a clear yes, then execute; report the transaction signature". Generated from the policy too.
6. The resources and prompts from prompt 02, with the resource-to-tool mapping.
7. Common patterns: new user, trade, launch, hire, sell a skill, pay an x402 URL, fund an external wallet through the allowlist, check portfolio, run a DCA, review costs.
8. Deliverability and conduct rules for any outward-facing tool (mail from prompt 11, social posting): genuine content, no deceptive subjects, never fabricate urgency.

## Docs and wiring

- `docs/mcp.md`: the "Turning the tools on" guidance exists; add a "Tool policy" section explaining tiers, defaults and how to enable groups once the settings page ships.
- `docs/agent-skills.md`: register the new skill.
- `data/changelog.json` entry tagged `security, improvement`.

## Acceptance

- A fresh key sees no `financial` tools in `tools/list` on any server; enabling the `trading` group makes `swap_execute` appear.
- Calling `swap_execute` without `confirm_swap: true` or with a stale `quote_id` fails with an error that names `swap_quote`.
- `scripts/build-mcp-skill.mjs` reproduces `SKILL.md` byte for byte; a test asserts it.
- A test (`tests/mcp-policy.test.js`; `tests/api/mcp-policy.test.js` today covers only the `/api/mcp-policy` allowlist endpoint) covers every server's tool list against the policy (no tool without a group and tier); `npm test` green.
~~~~

