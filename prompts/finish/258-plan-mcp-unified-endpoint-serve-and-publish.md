# Serve the unified MCP endpoint at /mcp and /api/mcp/all and make it the default install target

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/258-plan-mcp-unified-endpoint-serve-and-publish.md`.

**Priority:** P1, unshipped fix or half-built user-visible feature (score 88 of 100 inside the tier). **Area:** mcp. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

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

A developer today has to know which of seven hosted MCP servers holds the tool they want, configure several, and authorize each. The registry that merges them into one server was built (`api/_mcpall/registry.js`, `api/_mcpall/sources.js`) but nothing serves it: production answers 404 on both `https://three.ws/mcp` and `https://three.ws/api/mcp/all`. The tool count is a headline number for MCP directories, and the one-URL install is the single biggest distribution lever for the MCP surface. The wiring (handler, OAuth scope union, CI guard, listings, stdio twin, live count page) is what is missing.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- Built: `api/_mcpall/registry.js` (`buildRegistry`, `unifiedName`, `SHADOWED`, `UNIFIED_ENDPOINT = https://three.ws/mcp`, `UNIFIED_ROUTE = /api/mcp/all`, `bootProblems`, `summarize`) and `api/_mcpall/sources.js` (a `SOURCES` array adapting main, 3D, studio, agent, bazaar, IBM and pump-fun servers). Nothing outside `api/_mcpall/registry.js` imports `_mcpall`.
- Built: `packages/mcp-policy` (`table.js`, `groups.js`, `runtime.js`, `enablement.js`, `stdio.js`) which gives every tool a group and tier.
- Missing: any HTTP handler (`api/mcp/` does not exist; `api/mcp.js` is the legacy main server), any `vercel.json` route for `/mcp` or `/api/mcp/all`, the script `check:mcp-tools` (named in the registry comments but absent from `package.json`), tests for the registry (`tests/` has no mcpall test), a `/mcp` page entry in `data/pages.json`, and listings that lead with the unified server.
- `curl -s -o /dev/null -w '%{http_code}' https://three.ws/mcp` returns 404 and `/api/mcp/all` returns 404.
- Existing census tooling: `scripts/build-mcp-catalog.mjs`, `scripts/check-mcp-counts.mjs`, `public/tools.json`, `public/.well-known/mcp.json`.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```
cd /home/user/three.ws
curl -s -o /dev/null -w '%{http_code}\n' https://three.ws/mcp https://three.ws/api/mcp/all
ls api/mcp 2>&1; grep -rn "_mcpall" api server scripts tests packages --include=*.js --include=*.mjs | grep -v "^api/_mcpall"
grep -n '"check:mcp-tools"\|"gate"' package.json | cut -c1-160
grep -n '"/mcp"\|mcp/all' vercel.json
node -e "import('./api/_mcpall/registry.js').then(m=>{const r=m.buildRegistry();console.log(m.summarize(r))})"
ls tests | grep -i "mcpall\|unified"
```

Skip any task whose artifact already exists and passes its test.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read `api/mcp.js` (the reference Streamable HTTP handler: initialize, tools/list, tools/call, resources, prompts, OAuth bearer and API-key auth, x402 anonymous pricing) and `api/_mcpall/sources.js` to learn the source contract (`tools()`, `isPublic`, `x402Amount`, `before`).
2. Write `tests/mcp-unified-registry.test.js` first: it builds the registry and asserts no unresolved duplicate unified names, every tool has a group and tier, every name matches `TOOL_NAME_RE`, the legacy name stays callable as an alias only when it maps to exactly one unified tool, and a deliberately colliding fixture source makes `bootProblems` non-empty. Run it and fix `registry.js` where it genuinely fails.
3. Create `api/mcp/all.js` exporting the Streamable HTTP handler for the unified server (JSON-RPC `initialize`, `tools/list`, `tools/call`, `resources/list|read`, `prompts/list|get`). `tools/list` returns exactly the tools the caller's key or session has enabled through `@three-ws/mcp-policy` enablement (default: read and write tiers of every group; financial tiers opt-in). `tools/call` dispatches through the source's `run(args, auth, req)` so scope checks, validation, per-source rate limits (`before`), and x402 pricing behave exactly as on the legacy server.
4. Add routes in `vercel.json` (the Cloud Run route table): `/mcp` and `/mcp/` to `/api/mcp/all`, and make the `.well-known/oauth-protected-resource` metadata name resource server `mcp-all` with the union of group scopes. Extend the OAuth consent copy so each scope group is listed. Keep the seven legacy endpoints untouched.
5. Add `scripts/check-mcp-tools.mjs` (runs `buildRegistry`, prints `summarize`, exits non-zero on `bootProblems`, a missing group or tier, or an invalid name), wire `check:mcp-tools` into `package.json` scripts and into the `gate` script.
6. Generate the live tool and group count from the registry at build time into `public/tools.json` (extend `scripts/build-mcp-catalog.mjs`) and add a `/mcp` page (`pages/mcp.html`, entry in `data/pages.json`) that shows the count, the group list with tier badges, copy-paste install snippets for Claude Desktop, Claude Code and Cursor, and a link to `/mcp-tools`. States: skeleton while `/tools.json` loads, an error state with a retry button, hover/focus/active on every button and link, an empty state for a search with no match.
7. Update the listings to lead with the unified server: `public/.well-known/mcp.json`, `server.json`, `.claude-plugin/marketplace.json` (create if absent), `docs/mcp.md` (counts via the existing marker mechanism checked by `scripts/check-mcp-counts.mjs`), and `docs/start-here.md`.
8. Publish the stdio twin as `packages/mcp` (name `@three-ws/mcp`): a thin proxy that forwards stdio JSON-RPC to the unified endpoint with `THREE_WS_API_KEY`, with its own README and a test that spawns it against a local server. Do not `npm publish` (owner gate).
9. Add a handler test `tests/mcp-unified-endpoint.test.js`: tools/list with no key shows the public set only, tools/call on a gated tool without a key returns the MCP error result, a paid tool without payment returns the 402 shape, and the count in `tools/list` with every group enabled equals the count in `public/tools.json`.
10. Changelog entry in `data/changelog.json` tagged `feature, sdk`, then `npm run build:pages`.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `node scripts/check-mcp-tools.mjs` exits 0 and `npm run check:mcp-tools` is part of `npm run gate`.
- [ ] `npx vitest run tests/mcp-unified-registry.test.js tests/mcp-unified-endpoint.test.js` passes.
- [ ] On a local server (`npm run dev`), `curl -s -X POST localhost:3000/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` returns a tool list and its length with every group enabled equals the tool count printed on `/mcp`.
- [ ] `/mcp` page checked in a real browser: skeleton, error and empty states, hover/focus/active, no console errors.
- [ ] `npm run check:mcp-counts` passes with the new counts.
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| Two servers publish the same tool name | Add the pair to `SHADOWED` in `api/_mcpall/registry.js` with the winning source and a one-line reason, or rename with the group prefix. |
| A source module has import side effects that break a cold boot | Lazy-import inside the source's `tools()` and keep `bootProblems` as the guard. |
| Production still 404s after the route lands | The deploy is the owner gate; verify on the local server and report the exact curl the owner runs after deploy. |
| `npm publish` for `@three-ws/mcp` | Owner gate; ship the package with a `prepublishOnly` check and list the one command. |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/258-plan-mcp-unified-endpoint-serve-and-publish.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `258-plan-mcp-unified-endpoint-serve-and-publish.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `docs/prompts/17-unified-mcp-endpoint.md` (whole file)

~~~~markdown
# 17. One MCP endpoint, one OAuth, every tool

Read `docs/prompts/README.md` first.

## The problem

We run seven hosted MCP servers (`docs/mcp.md`): main, 3D, studio, agent wallet, bazaar, launch, and a partner lane. A developer has to know which one holds the tool they want, configure several, and authorize each. The best platforms expose their entire surface as one URL behind one OAuth grant, with tool groups the user can switch on and off, and the count of tools is a headline number.

## Build

- `https://three.ws/mcp` (and `/api/mcp/all` as the route): a single Streamable HTTP server that mounts every tool from every existing server, namespaced by the group field from prompt 03 (`agents_`, `wallet_`, `assets_`, `x402_`, and so on) with collision detection at boot (`npm run check:mcp-tools`, wired into `npm run gate`, fails on duplicate names or missing group and tier).
- One OAuth 2.1 grant with the union of scopes; each group maps to a scope so a consent screen shows what a client gets. API keys work the same way.
- The prompt 02 resources and prompts all live here too.
- Per-key and per-session tool selection from prompt 03 decides what `tools/list` returns; the default shows the read and write tiers of every group.
- The existing seven servers keep working as thin views of the same registry, so nothing already installed breaks. Their docs point to the unified endpoint as the default.
- Registry listings: update `server.json`, `/.well-known/mcp.json`, the MCP registry manifests, and the Claude plugin marketplace in `.claude-plugin/marketplace.json` to lead with the unified server. Publish the stdio twin as `@three-ws/mcp` under `packages/`, which proxies to the unified endpoint with a key.
- A live tool count and group list on `/mcp` (page in `data/pages.json`) and in `docs/mcp.md`, generated at build from the registry so the number never rots.

## Acceptance

- One `npx three-ws setup` entry gives Claude Desktop every three.ws tool.
- `npm run check:mcp-tools` fails when two servers define the same tool name.
- The tool count printed on `/mcp` equals `tools/list` with every group enabled.
- Docs updated, changelog entry tagged `feature, sdk`, `npm test` green.
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

### `docs/prompts/README.md` (whole file)

~~~~markdown
# Agent platform build prompts

Each file in this directory is a complete, self-contained build brief for one missing surface of the three.ws agent platform. Hand a file to an agent as its task. Every brief assumes the agent has read `CLAUDE.md` and this page.

## Order

Dependencies flow downward. Rows in the same tier can run in parallel.

| Tier | Prompt | Why this order |
|---|---|---|
| 1 | [01 CLI setup and login](01-cli-setup-login.md) | Everything else gets installed through it. |
| 1 | [03 MCP tool policy and the model-facing skill](03-mcp-tool-policy-skill.md) | Every later tool registers under it. |
| 1 | [05 Agents REST parity](05-agents-rest-parity.md) | The SDK, gateways and loop all wrap these routes. |
| 1 | [17 One MCP endpoint, one OAuth](17-unified-mcp-endpoint.md) | Every later tool mounts here. |
| 1 | [18 Open-model roster and free-tier models](18-open-model-roster.md) | Needed by the free tier and the local runtime. |
| 1 | [29 Free tier, pricing and rate limits](29-free-tier-and-hosting-plan.md) | Every metered brief prices against `data/plans.json`. |
| 2 | [04 Community skills registry](04-community-skills-registry.md) | Installs through the CLI. |
| 2 | [06 Agents SDK](06-agents-sdk.md) | Wraps tier 1 routes. |
| 2 | [15 Gasless launch and the launch command](15-gasless-launch.md) | Adds a CLI subcommand. |
| 2 | [16 Self-funded inference](16-self-funded-inference.md) | Wallet plus credits. |
| 2 | [19 Self-custody, signers, key export, balance history](19-self-custody-and-signers.md) | Changes the signing contract every financial brief uses. |
| 2 | [30 Trading tool parity](30-trading-tool-parity.md) | Exposes existing trading as tools; venue interface for later legs. |
| 2 | [33 Account, X posting policy, Google linking](33-account-social-and-sso.md) | Account objects the gateways and status tools read. |
| 3 | [07 Perps](07-perps.md), [08 Lending](08-lending.md), [09 Prediction markets](09-prediction-markets.md) | New execution venues under the policy. |
| 3 | [10 Whole-agent marketplace with bids](10-agent-marketplace-bids.md) | Transfers custody; depends on 19. |
| 3 | [11 Agent mail](11-agent-mail.md), [12 Agent cards](12-agent-cards.md), [31 Human tasks](31-human-task-fulfillment.md) | Real-world surfaces; provider adapters plus tools. |
| 3 | [21 Memory and self-improvement](21-agent-memory-and-self-improvement.md) | Needs runs (05) and prompt-only skills (04). |
| 3 | [22 External MCP integrations for agents](22-external-mcp-integrations-for-agents.md) | Needs the policy (03) and the unified endpoint (17). |
| 3 | [25 Sandboxed code execution](25-sandboxed-code-execution.md), [26 Tool gateway](26-tool-gateway-bundle.md) | New default tools under the policy, metered by 29. |
| 3 | [28 Public economics](28-public-economics-dashboard.md) | Reads the fee settings the launch brief unifies. |
| 4 | [13 Telegram and Discord](13-chat-gateways.md), [24 Slack, WhatsApp, Signal, SMS, email, voice](24-more-gateways-and-voice.md) | Uses runs, link codes and mail. |
| 4 | [20 Local agent runtime and TUI](20-local-agent-runtime-tui.md) | Uses 17, 25, 26, 21 and the gateway. |
| 4 | [35 Always-on strategy loop](35-always-on-strategy-loop.md) | Uses runs, memory, budgets and guards. |
| 4 | [27 Bounties and hackathons](27-bounties-and-hackathons.md) | Creates runs from bounties; feeds 28. |
| 4 | [32 EVM secondary leg](32-evm-secondary-leg.md) | Extends the venue interfaces after Solana is complete. |
| 5 | [14 Desktop app release](14-desktop-app-release.md) | Ships the console over everything above. |
| 5 | [23 Distribution into every agent framework](23-distribution-into-agent-frameworks.md) | Packages 01, 03 and 17 for other agents. |
| 5 | [34 Localization](34-localization.md) | Translates what exists. |
| 5 | [36 Agent evals and replay](36-agent-evals-and-replay.md) | Measures everything above; smoke suite into the gate. |

## Rules that apply to every brief

- `CLAUDE.md` governs. The four stop-and-ask gates apply, and nothing else stops the work. In particular: any fund-moving action in a test or dry run renders recipient, amount, token and chain and waits for the owner's explicit yes.
- Solana first. Every surface ships and is verified on Solana before any EVM leg is considered.
- No mocks, no placeholders, no TODOs, no sample arrays. Every tool, route, page and state is real and wired.
- Every fund-moving or irreversible tool takes an explicit confirm flag, is disabled by default, and has a quote or preview tool that must be called first. Prompt 03 defines the shared policy; every later prompt registers its tools under it.
- Each brief ends only when the definition of done in `CLAUDE.md` holds: reachable in the UI, exercised in a real browser, no console errors, tests green with `npm test`, docs written, `data/changelog.json` entry appended, `STRUCTURE.md` row added for a new surface, `npm run audit:docs` clean, `npm run check:rules -- --paths <your files>` clean.
- Never name a third-party token in committed code, fixtures or docs. Refer to venues by capability and by the module that integrates them. The promoted coin is `$THREE` only.
- Commit your own finished work promptly with explicit paths and a message that describes the diff.
~~~~

