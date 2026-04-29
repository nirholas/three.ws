# Pump.fun integration for Solana agents

This integrates the upstream [`pumpfun-claims-bot`](https://github.com/nirholas/pumpfun-claims-bot) MCP server into the three.ws platform so a Solana agent can:

- Observe live pump.fun activity (GitHub social-fee claims, token graduations)
- React to events through the existing Empathy Layer (speak, gesture, emote)
- Expose enriched intel (`getRecentClaims`, `getTokenIntel`, …) via the platform MCP endpoint
- Feed off-chain trust signals into the Solana reputation score
- Surface a live cards overlay through a new widget type

This document covers what was added, how it composes with what was already there, and what is intentionally **not** included.

---

## Architecture

```
                 npx pumpfun-claims-bot              (Railway / standalone)
                          │  JSON-RPC 2.0 (HTTP MCP)
                          ▼
              api/_lib/pumpfun-mcp.js                (cached client, Upstash)
                          │
        ┌─────────────────┼─────────────────────────────────┐
        ▼                 ▼                                 ▼
 api/agents/pumpfun.js   api/agents/pumpfun-feed.js   api/cron/pumpfun-signals.js
   (read-only proxy)        (SSE: claims+graduations)    (15-min crawler)
        │                 │                                 │
        │                 │  EventSource                    │  pumpfun_signals
        ▼                 ▼                                 ▼
  src/agent-skills-pumpfun-watch.js                 solana-reputation.js
       protocol.emit ──► Empathy Layer (avatar)            +
                                                    solana-card.js (passport block)
                          ▲
                          │
              src/widgets/pumpfun-feed.js (DOM overlay v1)
```

---

## What's added

| Surface | Path | Purpose |
|---|---|---|
| MCP client | [api/_lib/pumpfun-mcp.js](../api/_lib/pumpfun-mcp.js) | Cached JSON-RPC client to upstream bot |
| Read API | [api/agents/pumpfun.js](../api/agents/pumpfun.js) | `?op=claims|graduations|token|creator` |
| SSE feed | [api/agents/pumpfun-feed.js](../api/agents/pumpfun-feed.js) | Live event stream, 90s window, auto-reconnects |
| Cron crawler | [api/cron/pumpfun-signals.js](../api/cron/pumpfun-signals.js) | 15-min sweep → `pumpfun_signals` |
| Schema | [api/_lib/schema.sql](../api/_lib/schema.sql) | New `pumpfun_signals` table |
| Skills | [src/agent-skills-pumpfun-watch.js](../src/agent-skills-pumpfun-watch.js) | 4 skills: recent-claims, token-intel, watch-start, watch-stop |
| Widget | [src/widgets/pumpfun-feed.js](../src/widgets/pumpfun-feed.js) | DOM overlay v1 |
| Widget type | [src/widget-types.js](../src/widget-types.js) | `pumpfun-feed` registered |
| Reputation | [api/agents/solana-reputation.js](../api/agents/solana-reputation.js) | `pumpfun_signals` block in response |
| Passport | [api/agents/solana-card.js](../api/agents/solana-card.js) | `pumpfun` block on the agent card |
| Cron schedule | [vercel.json](../vercel.json) | `*/15 * * * *` |

---

## Configuration

```env
# Upstream pumpfun-claims-bot MCP endpoint. Required to enable the integration.
PUMPFUN_BOT_URL=https://pumpfun-bot.example.com/mcp
PUMPFUN_BOT_TOKEN=                 # optional bearer for upstream auth

# Solana RPCs (also used by attestations crawler + pump-sdk skills)
SOLANA_RPC_URL=                    # mainnet (Helius/Triton recommended)
SOLANA_RPC_URL_DEVNET=
```

When `PUMPFUN_BOT_URL` is unset, the integration becomes a no-op: endpoints return `503 unavailable`, the cron returns `{ skipped: 'pumpfun bot not configured' }`, and the watch skills return a friendly error. Solana agents that don't use it pay no cost.

---

## Skills

All registered through `registerPumpFunWatchSkills` in [src/agent-skills.js](../src/agent-skills.js).

| Skill | MCP-exposed | Effect |
|---|---|---|
| `pumpfun-recent-claims` | ✅ | Returns latest N enriched claims |
| `pumpfun-token-intel` | ✅ | Returns full intel for a mint |
| `pumpfun-watch-start` | ❌ (browser-only) | Opens SSE; emits `speak`/`emote`/`gesture` per event |
| `pumpfun-watch-stop` | ❌ | Closes the stream |

### Reaction map (watch-start)

| Event | Empathy Layer trigger | Speech sentiment |
|---|---|---|
| `first_time_claim` | `celebration` 0.9 | +0.7 |
| `fake_claim` | `concern` 0.7 | -0.5 |
| `tier ∈ {influencer, mega}` | `curiosity` 0.5 | +0.2 |
| `graduation` | gesture: `wave` (1.5s) | +0.6 |

These are continuous-blend stimuli, not discrete states — they decay according to the per-second rates in [src/CLAUDE.md](../src/CLAUDE.md#decay-per-second).

---

## Reputation signals

The cron writes typed rows to `pumpfun_signals(wallet, agent_asset, kind, weight, payload, tx_signature)`. `solana-reputation` aggregates them as `pumpfun_signals: { count, weight, by_kind }` in the response.

Default weights:

| Kind | Weight |
|---|---|
| `first_claim` | +0.2 |
| `graduation` | +0.3 |
| `influencer` | +0.2 |
| `new_account` | -0.2 |
| `fake_claim` | -0.6 |

These are **off-chain** signals — flagged as such, not on-chain attestations. `verified=false` semantically. Weighting them into a final composite score is up to consumers; the endpoint exposes the raw aggregates.

---

## Widget

The `pumpfun-feed` widget renders a stack of cards (claim or graduation) as an absolutely-positioned overlay on top of the 3D viewer. With `autoNarrate: true`, the avatar narrates each event through the protocol bus.

Studio config schema (validated in `widget-types.js`):

```js
{
  kind: 'all' | 'claims' | 'graduations',
  minTier: '' | 'notable' | 'influencer' | 'mega',
  autoNarrate: true,
  maxCards: 8,                 // 1..50
}
```

---

## What's intentionally not included

- **Long-lived SSE on Vercel functions** — the feed handler runs a 90s bounded loop and lets the browser auto-reconnect. For higher throughput, deploy the bot itself as a streaming service.
- **On-chain signal attestations** — signals are off-chain only. Promoting them to SPL Memo attestations signed by a platform key is a future step (see [docs/solana.md](solana.md) "What's intentionally not on Solana yet").
- **Agent-as-signer** — the watch skills are read-only; they never sign transactions. The existing `pumpfun-create / -buy / -sell` skills cover signing flows.
- **Anchor program for reputation** — still EVM-only on the on-chain path.

---

## Testing

```bash
npx vitest run tests/pumpfun-mcp.test.js tests/pumpfun-signals.test.js
```

The MCP client and cron crawler are unit-tested with mocked `fetch` and `sql`. End-to-end requires a live `PUMPFUN_BOT_URL` and is exercised via the Solana smoke test path.
