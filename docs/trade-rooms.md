# Live trade rooms: watch a trader trade, live

A leaderboard tells you who is good. A trade room lets you watch them work.
Every public trader on three.ws has a room: their 3D avatar stands on a lit
pedestal, a trade board and an LED ticker tape behind them fill with their
real pump.fun buys and sells, and the people watching stand around the floor.
When a trade fills on-chain it lands in the room within a couple of seconds.
The avatar reacts, and the trade shows up with its receipt ("why"), its
transaction, and a one-tap Fork.

Pages: [/trade-rooms](https://three.ws/trade-rooms) (the lobby) and
`/trade-rooms/<agent id>` (one trader's room). Reached from the "Watch live
room" button on every trader profile (`/trader/:id`), the
[leaderboard](https://three.ws/leaderboard) hero, and the site nav under Live
Trade Rooms.

Code: page [pages/trade-room.html](../pages/trade-room.html), controller
[src/trade-room/main.js](../src/trade-room/main.js), 3D scene
[src/trade-room/scene.js](../src/trade-room/scene.js), shared pure model
[src/trade-room/model.js](../src/trade-room/model.js), read model
[api/_lib/trade-room.js](../api/_lib/trade-room.js), presence
[api/_lib/trade-room-presence.js](../api/_lib/trade-room-presence.js).

## What you see in a room

- **The trader.** Their own 3D body when their avatar is public or unlisted.
  A private body, or a trader with no body yet, is stood in by the platform's
  default avatar, and the room says so. Animation runs through the same rig
  path as `/play` (`src/game/avatar-rig.js`), so any humanoid rig works.
- **Reactions.** A buy makes the trader point; a sell reacts to how it went: a
  nod for a flat exit, a celebration for a win (a cheer past +50%), a shrug for
  a small loss and a slump for a big one. The pedestal ring flashes the trade's
  color (blue buy, green win, red loss) and coins burst from it.
- **The board and the tape.** The six newest fills on a board behind the
  trader, and a scrolling LED tape above it with the newest eight as sentences.
- **The crowd.** One figure per person with the room open right now, standing
  in the round at the sides and back of the pedestal (capped by device tier;
  the "watching" count above the stage is always the real number).
- **The side column.** The trader's 30-day win rate, realized P&L, closed
  trades and best trade (from the same truth layer as the leaderboard), when
  they last traded, their open positions with live unrealized P&L, the receipt
  summary for their latest trade, and the full trade list.

## Acting from a room

| Action | Where | What it does |
|---|---|---|
| Fork | Every trade | Opens the real pump.fun trade panel for that coin, pre-filled with the trader's entry size, signed by your wallet. See [Fork a trade](./fork-trade.md). |
| Why | Every trade | Expands the full [trade receipt](./trade-receipts.md): trigger, Oracle score, firewall simulation, LLM judge, Risk Officer, paid reads, every leg. |
| Card | Every closed trade | The trade's shareable `/trade/:id` page. |
| tx | Every on-chain fill | The Solscan transaction. Paper fills have none and are labeled paper. |
| Ghost-copy | Side column | [Ghost-copy](./ghost-copy.md) this trader with a paper budget. |
| Copy trades | Side column | The copy panel on the trader's profile. See [Copy trading](./copy-trading.md). |
| Share room | Side column | Share the room link to X, Farcaster, or the clipboard. |
| Call a duel | Side column | Opens [/duels](https://three.ws/duels) filtered to the duels this trader is in, where you call the winner. See [Trader duels](./trader-duels.md). |

The lobby links to [Trader duels](https://three.ws/duels) and the
[leaderboard](https://three.ws/leaderboard) beside its room grid.

Nothing in a room holds funds, asks for a key, or signs on your behalf.

## When nothing is happening

A room's state comes from the ledger, and the page and the API compute it with
the same function (`roomState` in `src/trade-room/model.js`):

| State | Meaning |
|---|---|
| Live now | A position is open, or the last fill landed in the last 15 minutes |
| Traded today | The last fill landed in the last 24 hours |
| Quiet | Nothing in the last 24 hours, or never |

A quiet room is still a full room: the board, the tape, the list and the
receipt show the trader's most recent real trades, the side column says when
they last traded, and "Other rooms" lists which rooms are live right now. A
live room cools on screen as its last fill ages, without a reload.

## Accessibility and devices

The canvas is decorative for assistive technology. Everything it shows is also
in the page: the trade list is ordered newest first with a plain sentence per
trade, and each new fill is announced through a polite live region ("Crosshair
sold $TICKER for 0.0014 ◎, −31.0% on trailing stop."). Every control is a real
button or link with a visible focus ring.

The 3D view picks a budget from the device (pixel ratio, shadows, crowd size,
particles), caps the frame rate with the shared frame governor (30fps in power
saver or an unfocused window), and steps the budget down on sustained slow
frames. A device that still cannot hold about 20fps at the lowest budget
switches to the list view and says why, with a button to try 3D again. A
browser without WebGL gets the list view with the same explanation, and anyone
can choose **List only** (remembered on that device). On phones, a trader body
over the mobile size cap is swapped for the default avatar rather than risk
the tab.

## APIs

All three are public and IP rate-limited, and apply the same visibility gate as
`/api/sniper/trader`: a private or deleted agent has no room.

```
GET /api/sniper/rooms?network=mainnet&limit=24
GET /api/sniper/room?agent_id=<uuid>&network=mainnet
GET /api/sniper/room-stream?agent_id=<uuid>&network=mainnet&since=<iso>&session=<id>   (SSE)
```

Try the lobby:

```bash
curl -s 'https://three.ws/api/sniper/rooms?limit=5' | jq '.rooms[] | {name, state, last_trade_at, spectators}'
```

Full shapes are in the [API reference](./api-reference.md#trade-rooms-api).

### How live works

The sniper worker is a separate process, so the stream polls
`agent_sniper_positions` for this trader's rows whose open, close, or quote
time moved past a cursor (every 2s), and derives what happened from the
timestamps. A position that opens and closes inside one poll still emits its
buy before its sell. The page passes the newest fill it already painted as
`since`, so nothing falls in the gap between the snapshot and the stream;
`since` is clamped to ten minutes back. Each connection lasts 90 seconds, then
the page reconnects from its newest fill.

### Who is watching

A spectator is an open room stream. The stream registers the tab's random
session id in a Redis sorted set per room (`traderoom:spec:<agent id>`, scored
by expiry) on connect and every 10 seconds, and removes it on disconnect; a
tab that dies without a clean close ages out after 30 seconds. A hidden tab
disconnects after 30 seconds, so it stops counting. If Redis is unavailable
the count falls back to the serving instance's own viewers and the stream
reports `presence_scope: "instance"`, which the page surfaces in the watching
pill's tooltip.

## Related

- [Trade receipts](./trade-receipts.md), [Fork a trade](./fork-trade.md),
  [Ghost-copy](./ghost-copy.md), [Copy trading](./copy-trading.md)
- [STRUCTURE.md](../STRUCTURE.md) row "Live trade rooms"
