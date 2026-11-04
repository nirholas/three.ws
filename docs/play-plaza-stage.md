# The Plaza Stage in /play

A hosted Living Stage stands in the plaza of every coin world in [/play](/play). Walk up to it and the same live show that runs at [/stage](/stage) plays around you: the host's voice comes from the deck and gets louder as you approach, captions follow every line, you get a seat in the ring, you can ask the host a question from the chat bar, and you can tip the host in $THREE.

The stage a world joins is derived from its coin, not looked up. `plazaStageId(mint)` in [multiplayer/src/plaza-stage.js](../multiplayer/src/plaza-stage.js) is the uuidv5 of the mint, which is both the `stage_world` room filter and the `stages.id` a claim writes. The footprint (`PLAZA_STAGE`, `stageInRange`, `stageMarqueeInRange`) lives in [multiplayer/src/world-features.js](../multiplayer/src/world-features.js), so the marker the player sees and the disc the server keeps clear of building are the same coordinates.

## Two halves, split for cost

| Half | File | Always mounted | Cost |
|---|---|---|---|
| Landmark | [src/game/plaza-stage.js](../src/game/plaza-stage.js) | Yes, in worlds that have a coin mint | Geometry, a canvas marquee and one distance check per frame. No socket, no audio. |
| Show client | [src/game/plaza-stage-show.js](../src/game/plaza-stage-show.js) | No, lazy-imported on approach | The `stage_world` socket, host avatar, TTS and lip-sync, seat markers, panel, tip flow. |

[src/game/coincommunities.js](../src/game/coincommunities.js) constructs the landmark beside the wheel station and war portal, ticks it each frame, gives it the `E` key through the same interact chain (synchronous, like the other stations), disposes it in `leave()`, and routes the chat bar to it (see Questions).

## Proximity lifecycle

| Distance from the stage centre | What happens |
|---|---|
| Beyond 26 m | Nothing. No request, no audio, no socket. |
| Inside 26 m (the marquee ring) | One `GET /api/stage?coin=<mint>` to paint the marquee, then a refresh every 45 s while the player loiters. |
| Inside 13 m (the attend ring) | The show client is imported and `start()` joins the room. |
| Past 16 m after attending | `dispose()`: room closed, audio stopped, avatar and seats removed, listeners freed. The 3 m band is hysteresis so walking along the crowd's edge does not flap the socket. |

Marquee states: `unclaimed`, `scheduled` (with a countdown), `dark`, `live`, `loading` and `error`. When there is no show the stage stays a quiet landmark.

## The show client

`PlazaStageShow` takes `{ stageId, coin, camera, hostAnchor, audienceAnchor, ui, detail, onShowState, isPowerSaver }` and exposes `start()`, `dispose()`, `setStageDetail(data)`, `togglePanel()`, `panelOpen()`, `isSpeaking()`, `tick(dt)` and `ask(text)`.

- **Feed.** [src/stage-net.js](../src/stage-net.js) relays `host`, `utterance`, `audience`, `tip` and `leaderboard`. Captions render in a status region (`aria-live="polite"`) that stays visible with the panel closed. State changes go back through `onShowState`, so the marquee shows the audience and board the player is watching.
- **Voice.** [src/shared/stage-voice.js](../src/shared/stage-voice.js) fetches `/api/tts/speak`, plays it through a `PositionalAudio` on the host's head with an `AudioListener` on the follow camera, and drives lip-sync. The next beat (a tip shout-out, for example) stops the current line. If TTS or autoplay fails the captions still carry the words and a toast asks the player to tap to hear the host.
- **Host body.** The host's GLB loads through the world's own avatar path (`resolveAvatarUrl` and `buildAvatar` in [src/game/avatar-rig.js](../src/game/avatar-rig.js): meshopt and DRACO decode, bone canonicalization, idle clip). A lit placeholder body stands on the deck from the first frame and stays if the GLB is blocked, so the host is never invisible and never in a T-pose.
- **Seats.** The server deals ring seats; each member in the `audience` event becomes a marked spot on the audience anchor. The local player's spot is larger and cyan, VIP tippers are gold. Capped at 40 (16 in power-saver mode).
- **Reduced motion and power saver.** Panel animation respects `prefers-reduced-motion`; power-saver mode skips the host GLB download and caps the seats.

### States

The panel has a designed state for each of: connecting (skeleton), feed offline (message and a **Retry the feed** button wired to `StageNet.retry()`), no show (tells the player when the next show is, or that a host claims the stage from `/stage`), and live. Every control has hover, active and `focus-visible` styles and is keyboard-operable; `Escape` closes the panel and returns focus. All copy goes through `t()` with `play.stage_*` keys in [public/locales/en.json](../public/locales/en.json).

## Questions

While the player is attending, the chat bar sends to the host's queue instead of to the world chat. `PlazaStage.ask(text)` returns `'away'` when no show is mounted (the line goes to world chat as normal), otherwise `'sent'`, `'offline'` or `'empty'`.

## Tips

A tip is an on-chain $THREE spend, so it is two steps:

1. **Choose an amount.** Only the presets in `TIP_PRESETS` ([src/shared/stage-tip.js](../src/shared/stage-tip.js), shared with `/stage`) are offered: 100, 500, 2,000 and 10,000. Choosing one opens a confirm card showing the **recipient** (the host wallet), the **amount**, the **token** ($THREE) and the network. Nothing is signed yet. Tips are offered only while the host is live and has a wallet.
2. **Confirm and sign.** Only the Confirm button calls `confirmTip()`, which signs the transfer with the player's own wallet (`tipAgent`) and then records the settlement signature with `POST /api/stage/tip`. The API verifies the transfer on-chain and is idempotent per signature; if its RPC lags the one that confirmed the transfer it answers `pending` and the client re-posts until it lands.

Failures are actionable: no wallet (install one), not enough $THREE (a **Get $THREE** link), wallet prompt rejected (calm "nothing was sent"), still confirming. A tip broadcast replayed by the room (reconnect or bridge retry) is displayed once.

## Verifying

```bash
npx vitest run tests/plaza-stage-show.test.js tests/plaza-stage-mount.test.js
```

The show test proves nothing opens before `start()`, join-once, full disposal, the confirm gate (no signing without Confirm, no double signing), the pending-retry loop, replay dedupe, seats, and the offline, empty and skeleton states. The mount test runs the landmark's real proximity logic: zero requests for a player who never approaches, one marquee read in the outer ring, join in the attend ring, leave past the hysteresis band, and a source check that the world constructs, ticks, interacts with and disposes it.

To see it live: run `npm run dev` and `npm run dev:multi`, claim the plaza with `POST /api/stage { action: 'plaza', agentId, coinMint }` from the host agent's owner account, go live from `/stage`, and open the coin's world in two browsers.
