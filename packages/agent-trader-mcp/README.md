<h1 align="center">@three-ws/agent-trader-mcp</h1>

**WARNING: this server can move real SOL.** An agent armed in live mode buys from its own custodial Solana wallet.
**Safe by default:** every arm is `simulate` (no spend) unless you pass `mode: "live"` and `confirm_live: true`, and the backend still requires a signed real-funds agreement and enforces the caps.

---

> A [Model Context Protocol](https://modelcontextprotocol.io) server over stdio for one story: arm a three.ws agent on Oracle conviction calls, watch what it did, set its guardrails, and stop it. Authenticated with a three.ws API key.

For read-only market data with no key, use [`@three-ws/oracle-mcp`](../oracle-mcp/README.md).

## Install

```bash
THREE_WS_API_KEY=sk_live_... npx -y @three-ws/agent-trader-mcp
```

Claude Code:

```bash
claude mcp add agent-trader -e THREE_WS_API_KEY=sk_live_... -- npx -y @three-ws/agent-trader-mcp
```

## Tools (8)

| Tool | Kind | What it does |
|---|---|---|
| `trader_getting_started` | free, local | Explains the flow and the risk |
| `agent_arm` | write, guarded | Arms an agent. Default `simulate`. Live needs `mode: "live"` plus `confirm_live: true` |
| `agent_disarm` | write, kill switch | Needs only `agent_id`. Disarms on mainnet and devnet and keeps the agent's other settings |
| `agent_status` | read | Armed or not, mode, caps, recent actions |
| `agent_actions` | read | What the agent did, newest first |
| `agent_performance` | read | Win rate, realized PnL and ROI |
| `agent_positions` | read | Open positions from Oracle calls |
| `agent_guardrails` | read or write | Per-trade cap, daily budget, kill switch and due-diligence limits, and today's spend |

## Safety

- `agent_arm` defaults to simulate. Live is explicit per call and never sticky.
- If the account has not signed the Terms, Risk Disclosure and Agent Wallet Agreement, the server answers `risk_ack_required` with a signing link. The tool returns that verbatim and nothing is armed.
- Per-trade SOL, the daily SOL cap and max open positions are enforced by the three.ws backend. This server cannot widen them.
- `agent_disarm` is the kill switch. It works with only an agent id.
- Clearing a guardrail cap (sending `null`) is a real relaxation. Do it only when the owner asks.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `THREE_WS_API_KEY` | required | three.ws API key or OAuth token for the agent owner |
| `THREE_WS_BASE` | `https://three.ws` | API base URL |
| `THREE_WS_TIMEOUT_MS` | `30000` | Per-request timeout |

## Test

```bash
node --test packages/agent-trader-mcp/test/registration.test.mjs
```

License: Apache-2.0.
