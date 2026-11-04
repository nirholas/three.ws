<h1 align="center">@three-ws/oracle-mcp</h1>

<p align="center"><strong>The three.ws Oracle for any AI agent: a conviction score and tier for every pump.fun launch, with the proof next to it. Free, read-only, no key.</strong></p>

---

> A [Model Context Protocol](https://modelcontextprotocol.io) server over stdio. It reads the public Oracle API at `https://three.ws/api/oracle/*`. It signs nothing, holds no secret and cannot trade.

There is also a hosted version with the same read tools plus the arming tools: `https://three.ws/api/mcp-oracle` (streamable HTTP, no account needed to read).

## Install

```bash
npx -y @three-ws/oracle-mcp
```

Claude Code:

```bash
claude mcp add oracle -- npx -y @three-ws/oracle-mcp
```

Any client with a JSON config:

```json
{ "mcpServers": { "oracle": { "command": "npx", "args": ["-y", "@three-ws/oracle-mcp"] } } }
```

## Tools (12, all read-only)

| Tool | Use it to |
|---|---|
| `oracle_getting_started` | Learn the Oracle and which tool to call first |
| `oracle_stats` | Judge how much to trust the signal today |
| `oracle_top_plays` | Get the shortlist of current best calls |
| `oracle_feed` | Browse the live board with score, tier and category filters |
| `oracle_coin` | Get the full verdict for one mint |
| `oracle_search` | Find a mint from a symbol or name |
| `oracle_movers` | See which scores are rising or falling |
| `oracle_wins` | See calls that later graduated or ran 2x |
| `oracle_backtest` | See the realized hit rate per tier |
| `oracle_calibration` | Check whether an 80 really beats a 60 |
| `oracle_leaderboard` | Rank the agents trading the stream |
| `oracle_wallet` | Read a wallet reputation card or the wallet leaderboard |

A 404 is reported as "not found". A 5xx or timeout is reported as "temporarily unavailable". Neither is ever returned as an empty market.

## Trading on the signal

Arming an agent moves real SOL, so it is not in this package. Use [`@three-ws/agent-trader-mcp`](../agent-trader-mcp/README.md), which defaults to simulate mode and requires a signed real-funds agreement before anything goes live.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `THREE_WS_BASE` | `https://three.ws` | API base URL |
| `THREE_WS_TIMEOUT_MS` | `20000` | Per-request timeout |

## Test

```bash
node --test packages/oracle-mcp/test/registration.test.mjs
```

License: Apache-2.0.
