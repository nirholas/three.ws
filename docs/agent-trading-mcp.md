# Agent trading over MCP

**This can move real SOL.** An agent armed in live mode buys from its own custodial Solana wallet. Everything here defaults to simulate, which spends nothing.

`@three-ws/agent-trader-mcp` is one stdio MCP server for the whole loop: arm an agent on [Oracle](./oracle.md) conviction calls, watch what it did, set its guardrails, and stop it. It needs a three.ws API key for the account that owns the agent.

```bash
claude mcp add agent-trader -e THREE_WS_API_KEY=sk_live_... -- npx -y @three-ws/agent-trader-mcp
```

For read-only market data with no key use [`@three-ws/oracle-mcp`](./oracle.md#oracle-over-mcp).

## Tools

| Tool | Kind | Backing endpoint |
|---|---|---|
| `trader_getting_started` | free, local | none |
| `agent_arm` | write, guarded | `POST /api/oracle/watch` |
| `agent_disarm` | write, the kill switch | `POST /api/oracle/watch` with `armed: false` |
| `agent_status` | read | `GET /api/oracle/watch` |
| `agent_actions` | read | `GET /api/oracle/activity` |
| `agent_performance` | read | `GET /api/oracle/agent-stats` |
| `agent_positions` | read | `GET /api/oracle/activity` with `outcome=open` |
| `agent_guardrails` | read, or write when you pass a field | `GET`/`PUT /api/agents/:id/trade/limits` |

## The flow

1. `agent_guardrails` with only an `agent_id` reads the spend limits and today's spend.
2. `agent_arm` in simulate mode (the default). Watch with `agent_status`, `agent_actions` and `agent_positions`.
3. `agent_performance` is the track record. Move to live only when simulate results justify it.
4. `agent_disarm` stops the agent. It needs only the agent id.

## Safety posture

- `mode` defaults to `simulate`. Live needs `mode: "live"` and `confirm_live: true` on that call; without `confirm_live` the tool refuses locally and sends nothing.
- The backend enforces every boundary: per-trade SOL, the daily SOL cap and max open positions. This server cannot widen them.
- An account that has not signed the Terms, Risk Disclosure and Agent Wallet Agreement gets `risk_ack_required` and the signing link from the server. The tool returns that response unchanged and nothing is armed. See [Risk acknowledgment](./risk-acknowledgment.md).
- `agent_disarm` disarms on mainnet and devnet and re-saves the agent's existing settings, so stopping an agent never resets its configuration.
- Clearing a guardrail cap (sending `null`) is a real relaxation. Do it only when the owner asks.

Source: [packages/agent-trader-mcp](../packages/agent-trader-mcp/README.md). Tests: `node --test packages/agent-trader-mcp/test/registration.test.mjs`.
