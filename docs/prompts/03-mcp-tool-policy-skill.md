# 03. MCP tool policy: read-only by default, opt-in financial groups, and one model-facing skill document

Read `docs/prompts/README.md` first.

## The problem

Our fund-moving safeguards are real but scattered: spend limits in `api/_lib/agent-trade-guards.js`, allowlists in `api/agent/guard.js`, confirm flags in `api/_mcp3d/tools/persona-identity.js` and `packages/x402-mcp/src/tools/pay-and-call.js`, payment sessions in `api/pay/`. There is no single policy that every tool registers under, no server-side default that hides financial tools until the user opts in, and no one document a model reads that lists every tool, its group, whether it moves funds, and which preview tool must precede it. The best platforms ship exactly that: a default set of read-mostly tools, explicit opt-in for the rest, a named confirm flag on every irreversible call, and a skill file that tells the model the rules.

## Build

### Tool policy module

`api/_mcp/policy.js`, imported by every hosted server dispatcher (`api/_mcp/dispatch.js`, `api/_mcpagent/`, `api/_mcp3d/`, `api/_mcpbazaar/`, `api/_mcp-studio/`, `api/pump-fun-mcp`, `api/_mcpibm/`) and by every stdio package under `packages/*-mcp`. Every tool definition gains:

- `group`: one of `agents, chat, runs, skills, trading, orders, perps, lending, predictions, launch, marketplace, cards, mail, x402, wallet, billing, intelligence, integrations, account, allowlist, assets, utility`.
- `tier`: `read` (default on), `write` (on by default, reversible), `financial` (off by default, moves funds or is irreversible).
- `confirmFlag`: for every `financial` tool, the exact boolean argument name (`confirm_swap`, `confirm_transfer`, `confirm_launch`, `confirm_spend`, `confirm_payment`, `confirm_deposit`, `confirm_withdraw`, `confirm_delete`, `confirm_bid`, `confirm_send`). The tool refuses without it, with an error that names the preview tool to call first.
- `previewTool`: the quote or preview tool that must run first; the server records the preview result id and the financial tool requires it (`quote_id` or `preview_id`), rejecting stale ones after ten minutes.

Enforcement: `tools/list` returns only enabled tools for the session. Enablement comes from, in order: the client's allowed-tools list when present, an `X-Three-Tools` header or `tools` query the CLI from prompt 01 sets, the per-key setting stored by `api/api-keys.js`, then the default (read plus write). A disabled tool called anyway returns an error that says how to enable it (`npx three-ws tools`, or the settings page).

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

- `docs/mcp.md`: a "Tool policy" section explaining tiers, defaults and how to enable groups, with the settings page linked.
- `docs/agent-skills.md`: register the new skill.
- `data/changelog.json` entry tagged `security, improvement`.

## Acceptance

- A fresh key sees no `financial` tools in `tools/list` on any server; enabling the `trading` group makes `swap_execute` appear.
- Calling `swap_execute` without `confirm_swap: true` or with a stale `quote_id` fails with an error that names `swap_quote`.
- `scripts/build-mcp-skill.mjs` reproduces `SKILL.md` byte for byte; a test asserts it.
- `tests/mcp-policy.test.js` covers every server's tool list against the policy (no tool without a group and tier); `npm test` green.
