# Pulse

[![license](https://img.shields.io/github/license/nirholas/pulse)](LICENSE)

Vendored into three.ws as `services/pulse`. The three.ws surface is [/trenches](../../pages/trenches.html), fed through [api/trenches.js](../../api/trenches.js); see [docs/trenches.md](../../docs/trenches.md) for wiring and deploy.

```bash
npx pulse-trenches            # collector, API and dashboard on :8787
npx -y -p pulse-trenches pulse-mcp   # MCP server for agents (set PULSE_URL)
```

Personal market intelligence for the Solana and Robinhood Chain trenches. Pulse watches every launch, runner and death, scores wallets, labels KOLs, classifies tokens by tech versus meme, writes a daily newsletter to Telegram, and archives everything in Postgres so the history can later train a trading bot.

## What it records

| Table | Contents |
|---|---|
| `tokens` | One row per token: metadata, lifecycle status (`new`, `running`, `graduated`, `dying`, `dead`), category, tech score, ATH, peak volume |
| `token_snapshots` | Price, mcap, liquidity, volume, holders, traders, buy/sell counts every cycle (Timescale hypertable when available) |
| `list_appearances` | Which trending, top-traded or promoted list surfaced a token, and at what rank |
| `launch_events` | Launches and graduations from the pump.fun firehose and the Robinhood Chain factories |
| `trades` | Trades by labelled wallets, whales (5 SOL or more) and early buyers of tokens that run or graduate |
| `wallet_positions`, `wallet_scores` | Per-wallet PnL, win rate, early hits and best multiple |
| `wallets` | KOL and smart-money labels, plus wallets Pulse promotes itself (3+ early hits, 50%+ win rate) |
| `market_snapshots` | Chain-wide totals each cycle |
| `daily_reports` | Every newsletter issue as data, markdown, HTML and the Telegram messages |

Export any table as JSON from `/api/export/<table>`.

## Run it

Requires Node 24 or newer.

```bash
npm install
cp .env.example .env       # optional, everything has a default
npm run build              # builds the dashboard into dist/web
npm start                  # collector + firehose + API + dashboard on http://localhost:8787
```

With no `DATABASE_URL`, Pulse stores data in an embedded PGlite database at `data/pglite`. For TimescaleDB:

```bash
npm run db:up              # Postgres on host port 5544
echo 'DATABASE_URL=postgres://pulse:pulse@localhost:5544/pulse' >> .env
```

Other commands:

| Command | What it does |
|---|---|
| `npm run dev` | Collector and Vite dev server with hot reload (http://localhost:5173) |
| `npm run collect` | One collection cycle, then exit (`-- --jobs` also imports wallets and scores them) |
| `npm run report -- --no-send --print` | Build today's newsletter without sending it |
| `npm test`, `npm run typecheck` | Tests and types |

## Telegram newsletter

Create a bot with @BotFather, add it to your channel as an admin, and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` (for example `@my_channel`). The issue is generated once a day at `REPORT_HOUR` in `REPORT_TIMEZONE`, stored first, then sent. Set `ANTHROPIC_API_KEY` to add a short written overview that is constrained to the day's data.

## Data sources

All keyless: Jupiter token lists, DexScreener, pump.fun, GeckoTerminal, Solana RPC logs for the pump.fun and PumpSwap programs, Robinhood Chain RPC factory logs, and public KOL wallet labels. The public Solana WebSocket drops connections often; Pulse reconnects, but a dedicated `SOLANA_WS_URLS` endpoint keeps the firehose steady.

## Layout

```
src/collector   firehose, scheduler, Robinhood walker, persistence
src/sources     one client per data provider
src/intel       classification, lifecycle status, wallet scoring
src/report      newsletter data, rendering, Telegram, narrative
src/server      Hono API and static dashboard hosting
src/db          migrations and the Postgres/PGlite client
web             Vite dashboard (overview, tokens, token detail, launches, wallets, newsletter)
```

Token names, symbols and descriptions are untrusted on-chain input. The dashboard escapes every interpolation and Pulse never acts on them.

MIT licensed.
