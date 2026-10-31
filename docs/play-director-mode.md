# /play venue projector view (`?director=1`)

A screen on a wall, or an OBS browser source, that watches the world without being in it. Open the $THREE home town like this on the production origin:

```
/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three&director=1
```

`?coin=` is optional for a director: with no (or a malformed) coin it falls back to the $THREE home town. `tier=holders` is ignored, a projector always watches the general room.

## What it does

| Piece | Behavior |
| --- | --- |
| Spectator seat | The client joins with `{ spectator: true }`. The server decides the seat in `onAuth` ([multiplayer/src/spectator.js](../multiplayer/src/spectator.js)): no `Player` on the schema (so no peer is ever sent an avatar for it), no economy profile, every message it sends is dropped, at most 8 per room, and `/population` subtracts it. Invisible and uncounted by construction. |
| Auto-director | Cuts every 15 to 30 seconds between occupied points of interest: the totem, the jumbotron, the chart wall, the dance floor, the oracle ribbon, any crowd of 2 or more, and a wide plaza shot. Players pull the choice (weight is score squared, an empty landmark loses to anything with people in it), the last shot is almost never repeated, and a crowd shot is cut early if the crowd walks off. Pure logic in [src/game/director-shots.js](../src/game/director-shots.js). |
| No clipping | Every shot path is sampled against the district colliders before it is used. If the natural angle is walled off it swings round the subject, pulls in, and finally cranes above the tallest roof. A per-frame safety pass slides the camera out of any box it ends up inside. |
| Broadcast overlay | Event name and LIVE badge or countdown, the running agenda segment and what is next, a progress bar, the world name and symbol, the live online count, and an invite QR. No player HUD: [src/game/director-mode.css](../src/game/director-mode.css) hides every body-level node except the canvas, the overlay and the meetup moments, so a HUD added to /play later stays out of the broadcast by default. |
| Event states | Read from `public/event.json` through the same parser as every other meetup surface ([src/game/director-overlay-state.js](../src/game/director-overlay-state.js)). `id: null` is the explicit no-event state: world, symbol and count only. Refetched every minute. `?meetup=now` and `?meetup=<ISO>` previews work (and are preserved in the address bar). |
| Group photo | From the gather call until six seconds after the shutter the camera is locked on the totem with the whole crowd in frame (the standoff widens with the turnout). The countdown is the meetup layer's own banner and shutter overlay, restyled to projector scale; the shutter adds a white flash. The screen never poses or takes a photo itself. |
| Presenter PA | When a host is on the presenter PA (`/host`), the screen shows a projector-scale lower third: LIVE, the speaker's name and role, the level meters and the live captions. The screen plays the PA audio; mute and volume are hidden because nobody works a slider at a wall display (set the level on the venue sound system), and **Tap to listen** stays for the one time an operator has to unlock audio on a browser that blocked autoplay. A screen that joins or reconnects mid-talk picks the broadcast up from the next audio packet, because every packet names the speaker. |
| Reduced motion | `prefers-reduced-motion` turns every shot into a held still, and drops the pulse, breathing pill and flash. |

## Unattended resilience

- Reconnects forever (backoff capped at 15 seconds, no retry limit). The last frame, the crowd and the build stay on screen under a small "Reconnecting" pill; there is no error card and no toast. When the room re-streams, builds removed while it was away are dropped.
- Holds a screen wake lock and re-requests it when the tab returns to view.
- Hides the cursor after 3 seconds idle. `F` toggles fullscreen.
- Keeps full quality: the render tier is pinned high and the blur and power-saver frame caps are bypassed, so an unfocused OBS source still renders at 60fps.
- A lost WebGL context that is not restored within 4 seconds, a render loop stalled for 90 seconds, or a page stuck out of the world for 60 seconds reloads the page, with a delay that doubles on repeated reloads (2s up to 60s) so a permanent fault retries gently.

## Known limits

- **Play-pass gate.** If the platform pins `PLAY_GATE_MINT`, spectators are subject to the same wallet gate as players (no exemption). The screen then waits on the sign-in card, which is hidden on a director page, and reloads after 60 seconds. Run the screen from a signed-in profile, or keep the gate off for the event.
- The overlay's online count reads the client's roster, so it is the number of players in the world, not in other rooms of the same coin.
- A one-hour soak has not been run against this build.

## Extending

`window.__CC__._director.addLandmark({ id, label, x, y, z, facing, standoff, height, radius, weight })` adds a point of interest the director may cut to.

## Tests and checks

- [tests/director-shots.test.js](../tests/director-shots.test.js), [tests/director-overlay-state.test.js](../tests/director-overlay-state.test.js), [tests/walkroom-spectator.test.js](../tests/walkroom-spectator.test.js)
- Live net-level (no WebGL): `BASE=http://localhost:3000 WS=ws://localhost:2567 node scripts/play-spectator-check.mjs` (two players plus a spectator: invisibility, count, dropped sends).
- Live full page: `BASE=http://localhost:3000 WS=ws://localhost:2567 node scripts/play-director-check.mjs` (two players plus a director; invisibility, count, shot rotation, overlay states, group-photo cut, network drop, context loss).
