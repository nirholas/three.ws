# Play lite: the /play world on any device

`/play/lite` is a 2D client for the live `/play` world. It joins the **same** `walk_world` room as the 3D plaza, so a lite player is a real player: people in 3D see them walk in as the guest avatar, and the lite player sees everyone else as live dots on a top-down map. It needs no WebGL and never downloads three.js, so it runs on old phones, locked-down work laptops, and browsers with hardware acceleration turned off.

It exists so that everyone at an event can take part, whatever device they bring.

## What a lite player can do

| In the world | How lite does it |
| --- | --- |
| Walk | Tap the map, pick a spot under **Go to**, tap a person in **People**, or use arrow keys / WASD with the map focused. Steps stay under the server's 1.2 m anti-teleport limit. |
| Chat | Same world chat as 3D, with scrollback for late joiners. |
| React and emote | The six server-allowed reactions and six emotes (wave, cheer, dance, celebrate, backflip, thanks). 3D players see the avatar perform them. |
| Dance-off | Walk to the dance floor, start a round, get auto-entered as a contestant, vote with 🔥 per contestant, and collect the cosmetic reward. |
| Signature wall | Sign it from the **Wall** tab. The signature lands on the same wall 3D players see, with the 3D wall's ping. |
| Meetup agenda | The meetup chip, the group-photo pose, and the PA bar mount the same way as in 3D (`window.__CC__` is set with `lite: true`). |
| World photo | A 1200x630 card of the map with everyone on it, to download or share. |
| Buy | The same buy panel as 3D (`coin-buy.js`). |

Not in lite: combat, vehicles, fishing, the wheel, gacha, and build mode. Their landmarks are shown on the map for orientation but can't be walked to, and the danger zones are never chosen as a target.

## How people get there

1. **Automatically, before three.js loads.** An inline script in the head of `pages/play.html` sends a visitor to `/play/lite` (keeping the coin, name, symbol and image) when:
   - the device can't create a WebGL context;
   - the URL has `?lite=1`;
   - or the player ticked "Always open the lite world on this device" (`localStorage['cc-lite-pref'] === '1'`).

   `?full=1` and `?director=1` (the venue projector) always stay in 3D. The script mirrors `liteReason()` in `src/game/play-lite-core.js`, and a test runs the real inline script against that function so the two cannot drift.
2. **From the boot-error card.** If the 3D boot fails for any reason, the card's primary action is **Join the lite world**.
3. **From the slow-device offer.** In 3D, the frame watchdog first lowers the render tier. If the device is already at the `low` tier and still averages under 10 fps for 15 s of fair frames, a card offers **Switch to lite**. Fair frames exclude unfocused, power-saver and entry-burst frames. The card shows at most once per page, can be dismissed for the tab session, and can save the choice for this device. The code is `createStruggleDetector()` plus `src/game/lite-offer.js`.
4. **On purpose.** Share `https://three.ws/play/lite?coin=...` directly. Bare `/play/lite` opens the $THREE home world.

**Open in 3D** in the lite header goes to `/play?...&full=1` and clears the lite preference.

## Files

| File | Role |
| --- | --- |
| `pages/play/lite.html` | The page (`/play/lite`, Vite entry `play-lite`, route in `vercel.json`). |
| `src/game/play-lite.js` | The client: `CommunityNet` wiring, the canvas map, panels, dance-off, wall, photo, and handoff. |
| `src/game/play-lite.css` | Styles. Same `--cc-*` tokens as the 3D HUD. |
| `src/game/play-lite-core.js` | Pure logic with no DOM, unit-tested in node: URL handoff, `liteReason`, map geometry read from `multiplayer/src/world-features.js` and `dance-off.js`, safe tap targets, stepping, dance-off view, struggle detector. |
| `src/game/lite-offer.js` | The 3D "switch to lite" card. |
| `src/game/signature-wall-layout.js` | `SIGNATURE_WALL` placement, shared by the 3D wall and the lite map. |
| `tests/play-lite-core.test.js` | Unit tests, including the `pages/play.html` inline redirect run in a VM. |

## Verifying locally

```bash
npm run dev:walk-all            # Vite on :3000 plus the game server on :2567
open http://localhost:3000/play/lite
```

On localhost the client always talks to `ws://localhost:2567`. Open two browsers (or a desktop window and a phone-sized one) to see each other move, chat and react. To check the redirect, start Chromium with `--disable-3d-apis` and open `/play`.

Event audit harnesses that load `/play` stay in 3D on any browser with WebGL, including headless Chromium with SwiftShader. A harness running where WebGL is off will now be redirected to lite. Add `full=1` if it must measure the 3D boot-error path.

## Event-day notes

- Lite players count against the room cap (`WALK_ROOM_MAX_CLIENTS`, default 100) like anyone else. Overflow goes to a new shard, so check the cap before a large event.
- `?lite=1` on the event link is a quick fallback to post if venue Wi-Fi struggles: lite skips three.js, the avatar models and the world assets entirely.
