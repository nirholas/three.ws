---
name: agent-provenance
description: Record what an agent did in the three.ws append-only provenance ledger and read and verify any agent's action trail through the provenance-mcp server, with optional ERC-191 signatures.
---

# Agent action provenance with provenance-mcp

The plugin starts `@three-ws/provenance-mcp` over stdio (`npx -y @three-ws/provenance-mcp`). Tools appear as `mcp__provenance-mcp__<tool>`. The ledger is owner-scoped: you only see and write agents your token owns.

## Environment

- `THREE_WS_TOKEN`: a three.ws API key (`sk_live_...`) or OAuth access token, sent as a Bearer token. Needed for every tool.
- `THREE_WS_SIGNER_KEY` (alias `THREE_WS_SIGNER`): optional 0x-prefixed EVM private key. When set, each appended action is ERC-191 signed so its author is publicly verifiable. A per-call `signer_key` overrides it.
- `THREE_WS_BASE` (default `https://three.ws`), `THREE_WS_TIMEOUT_MS` (default `20000`).

## Tools

- `append_agent_action` (`agent_id`, `type` up to 64 chars such as launch, buy, post, reflect, `payload` JSON object, `source_skill`, `signer_key`): appends one action via `POST /api/agent-actions`. Returns the stored action and a `signing` block. The log is append-only: an entry cannot be edited or removed, so put only what belongs in a permanent record in `payload`.
- `list_agent_actions` (`agent_id`, `limit` 1-200 default 50, `cursor`): newest first, from `GET /api/agent-actions`. Each action gets a `verification` block (`signed`, `valid`, `reason`, `recovered`). Page with `next_cursor`.
- `query_action` (`agent_id`, `id` numeric): fetch one action and verify its signature. `reason` is `ok`, `unsigned` or a failure reason.

## Rules

- Never put secrets, private keys or session tokens in `payload`.
- Treat an action marked `valid: false` as untrusted, and say so.
- Pass `signer_key` only if the user gave it for that purpose.

## Example

1. `append_agent_action` with `agent_id: "<uuid>"`, `type: "reflect"`, `payload: {"note": "rebalanced watchlist"}`, `source_skill: "portfolio-review"`.
2. `list_agent_actions` with `limit: 5` to confirm it landed and `verification.valid` is true.
