---
name: autopilot-loop
description: Run a three.ws agent's autopilot through the autopilot-mcp tools: read its scopes and spend cap, generate proposals, dry-run them, execute or dismiss them, and undo reversible actions. Use when an owner wants to grant, limit or audit what an agent may do on its own.
---

# three.ws agent autopilot

The plugin starts `@three-ws/autopilot-mcp` over stdio (`npx -y @three-ws/autopilot-mcp`). Scopes, confirmation and spend caps are enforced server-side. These tools cannot override them.

## Environment

- `THREE_WS_API_KEY` (required): the agent owner's three.ws API key or OAuth access token, sent as a bearer token. `THREE_WS_TOKEN` and `THREE_WS_BEARER` are accepted aliases. It can move real SOL through `execute_proposal`, so treat it like a password and never print it.
- `THREE_WS_BASE` (optional): API origin, default `https://three.ws`.
- `THREE_WS_TIMEOUT_MS` (optional): per-request timeout, default 60000.

Every tool takes `agentId`, the UUID of an agent owned by the credential.

## Tools

| Tool | Arguments | Effect |
| --- | --- | --- |
| `get_autopilot_config` | `agentId` | Read scopes, auto-execute flags, daily SOL cap, confirmation rule and trust level. Call first. |
| `set_autopilot_config` | `agentId`, `enabled`, `scopes`, `autoExecute`, `dailySpendSol`, `requireConfirm` | Change the boundaries only. Idempotent. |
| `compute_trust` | `agentId` | Read the earned trust level (sandbox, trusted, autonomous) and stats. |
| `generate_proposals` | `agentId` | Create proposals from the agent's memories. Reversible scoped ones may auto-run. |
| `list_proposals` | `agentId`, `status` (`pending`, `executed`, `dismissed`, `undone`, `failed`), `limit` | Find proposal ids. |
| `dryrun_proposal` | `agentId`, `proposalId` | Preview what execution would do, with guard checks and a `blocked` flag. No spend. |
| `adjust_proposal` | `agentId`, `proposalId`, `params` | Correct a pending proposal's params. Validated server-side. |
| `execute_proposal` | `agentId`, `proposalId`, `confirm` | Execute for real. |
| `dismiss_proposal` | `agentId`, `proposalId` | Reject a pending proposal and record that the agent should not propose it again. |
| `undo_action` | `agentId`, `proposalId` | Reverse an executed alert or briefing. |
| `list_autopilot_activity` | `agentId` (optional), `limit`, `cursor` | Read the append-only log of autonomous actions. |

Proposal kinds are `create_alert`, `briefing` and `wallet_transfer`. Scopes use the same three names. Transfers send native SOL only. Alerts cover `$THREE` only (`asset: "three"`).

## Safety rules

- A `wallet_transfer` is real SOL on Solana mainnet and cannot be undone. Before calling `execute_proposal` with `confirm: true` for one, show the owner the recipient and the amount in SOL from `dryrun_proposal`, and wait for an explicit yes.
- Always call `dryrun_proposal` before `execute_proposal`. Do not execute when `blocked` is true.
- Do not raise `dailySpendSol` or grant `wallet_transfer` unless the owner asked for exactly that.
- `undo_action` cannot reverse a transfer. The server rejects it with `irreversible`.

## Worked example

1. `get_autopilot_config` with `{"agentId": "<uuid>"}`.
2. If the owner wants alerts only: `set_autopilot_config` with `{"agentId": "<uuid>", "enabled": true, "scopes": {"create_alert": true}, "dailySpendSol": 0}`.
3. `generate_proposals`, then `list_proposals` with `{"status": "pending"}`.
4. `dryrun_proposal` on the one the owner picks, then `execute_proposal`. If the owner dislikes the result, `undo_action`.
