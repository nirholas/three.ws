# Feature 13: event quest line with a live leaderboard

The quest line and its live leaderboard have shipped. Four event jobs (`event-plaza-catch`, `event-supply-run`, `event-wilds-patrol`, `event-landmark-tour`) are flagged `event: true` in `multiplayer/src/quests.js` and exist only inside the live window of `public/event.json`. The Jobs Board has an Event tab with the standings. The list below records what exists so a rerun builds only the gap.

## Where the code lives

- Quests: engine and event jobs in `multiplayer/src/quests.js` (`isEventMission`), UI in `src/game/quests-ui.js` (Jobs Board plus the Event tab), `src/game/npc/quest-npcs.js`, `src/game/npc/quest-markers.js`
- Event window: `public/event.json` (the same config `src/game/event-countdown.js` reads; do not invent a second source of truth), read server-side through `multiplayer/src/event-window.js`
- Scoring bridge: `multiplayer/src/event-score.js` reports a finished event job to `POST /api/internal/event-score` ([api/internal/event-score.js](../../api/internal/event-score.js)), which needs the world-service token and refuses any run outside the configured event window. Records live in `api/_lib/event-leaderboard-store.js`; ranking in `multiplayer/src/event-leaderboard.js`
- Public read: `GET /api/play/event-leaderboard` ([api/play/event-leaderboard.js](../../api/play/event-leaderboard.js)); the room proxies the same read to the in-world panel through the `eventBoard` message on `src/game/community-net.js`
- Server: `multiplayer/src/rooms/WalkRoom.js`; migrations in `api/_lib/migrations/` (preview with `npm run db:status`, which is a dry run)
- Leaderboard OG precedent: `api/og-leaderboard.js`; cosmetics reward path: `multiplayer/src/event-drop.js`, `src/game/event-souvenir.js` and the cosmetics catalog

## What was built, against the spec

1. **The quest line.** Shipped: four event jobs using existing verbs (fish, supply run, patrol, a three-stop landmark tour), defined in data and gated on the event window. Outside the window they do not exist.
2. **Server-authoritative scoring.** Shipped: only completions the room's quest engine granted are reported, keyed by the player's account, and the browser cannot post a score.
3. **Live leaderboard.** Shipped: the Event tab shows the top players and your own rank, refreshed on a poll and after each run, and the same ranking is the public endpoint above for a projector or the event page.
4. **The reward.** The souvenir cosmetic named in `event.json` (`souvenir.cosmeticId`) is granted by the server on join during the event, and the card offers to equip it in one click. Prizes for the ranking are not paid by code: the board ranks and the owner settles winners manually after the event.
5. **Anti-grief basics.** Per-account records, a world-service token on every write, and window gating on both the room and the endpoint. Tests: `tests/api-internal-event-score.test.js`, `tests/event-leaderboard.test.js`, `tests/play-event-leaderboard-endpoint.test.js`.

## Verify

- Full loop on `npm run dev` with two browsers: complete quests in one, watch the leaderboard move in both; reward granted once, persists across reload.
- Event window off: zero event-quest UI anywhere.
- `npm test` green; add tests for the scoring endpoint (auth, idempotency, window gating). `npm run db:status` before any migration; note what `db:migrate` would apply.

## Report format

The quest list as players will see it, files shipped, the leaderboard endpoint URL, migration status, and the `data/changelog.json` entry. One line on anything deferred.
