# Live events in `/play`

A live event turns the `$THREE` home town from a world you can visit into a
place something is *happening* in: a countdown you can see from anywhere in the
plaza, an agenda that tells you what is on right now and what is next, a banner
when each segment starts, and a synchronized fireworks show everyone watches
together.

Everything below is driven by one file, `public/event.json`.
Schedule a window in it, redeploy, and the event exists. Reset it and the world
goes back to normal with no code change and no dead pixels.

**Between events the file carries an explicit no-event state, and that is the
resting state.** The file always exists (four /play readers fetch `/event.json`
per load, and its absence would put a 404 in every visitor's console), but its
window is explicitly null, so every surface below mounts nothing and the world
runs as a plain world. Scheduling an event means writing a real window into the
file (`npm run event:schedule -- --start <ISO> --duration <minutes> --apply`);
ending one means resetting it (`npm run event:schedule -- --clear --apply`).
Nothing in this document is live until a real window is scheduled.

- **Surface:** `/play`, in the `$THREE` home town only (`isHomeTown()`).
- **Modules:** [`src/game/meetup-event.js`](../src/game/meetup-event.js) (the view),
  [`src/game/meetup-schedule.js`](../src/game/meetup-schedule.js) (pure schedule
  math), [`src/game/fireworks.js`](../src/game/fireworks.js) (the particle show),
  [`src/game/meetup-event.css`](../src/game/meetup-event.css) (styles).
- **Tests:** [`tests/meetup-schedule.test.js`](../tests/meetup-schedule.test.js),
  [`tests/meetup-event-ui.test.js`](../tests/meetup-event-ui.test.js).
- **Browser audit:** `npm run audit:meetup`.

---

## Configuring an event

`public/event.json` is the single source of truth. The same file feeds the lobby
banner and wayfinding pill ([`src/game/event-countdown.js`](../src/game/event-countdown.js)),
this in-world layer, and the server-side souvenir grant, so those three can never
disagree about when the event is.

Write it to schedule an event. There is no file in the repo to edit, so start
from the shape below:

```json
{
  "id": "three-first-meetup",
  "name": "$THREE First Holders Meetup",
  "tagline": "The first live gathering in the three.ws world.",
  "startsAt": "2026-08-09T17:00:00Z",
  "endsAt": "2026-08-09T19:30:00Z",
  "link": "/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three",
  "linkLabel": "Join the $THREE world",
  "souvenir": { "cosmeticId": "laurel-meetup" },
  "groupPhoto": { "atMin": 58, "emote": "av-cheering" },
  "agenda": [
    { "atMin": 0,   "title": "Doors open in the plaza", "detail": "Say hi in chat", "icon": "👋" },
    { "atMin": 20,  "title": "King of the Totem showdown", "detail": "Hold the gold ring", "icon": "👑" },
    { "atMin": 105, "title": "Fireworks finale", "detail": "Look up", "icon": "🎆" }
  ]
}
```

| Field | Meaning |
|---|---|
| `id` | Seeds the deterministic fireworks show. Change it and every client gets a different (but still shared) sky. |
| `name` / `tagline` | Shown on the chip, the agenda drawer, and the photo stamp. |
| `startsAt` / `endsAt` | ISO-8601 UTC. A missing or inverted `endsAt` defaults to six hours after the start. |
| `agenda[].atMin` | Minutes after `startsAt`. Order does not matter; segments are sorted. Invalid or untitled entries are dropped rather than breaking the event. |
| `agenda[].icon` | One emoji. Used on the segment row and its moment banner. |
| `souvenir.cosmeticId` | Optional. A free commemorative wearable granted once to everyone who joins the world named by `link` while the event is live, kept forever, never granted again after `endsAt`. Must be a `tier: 'event'` cosmetic; anything else grants nothing. See [Event souvenirs](event-souvenirs.md). |
| `groupPhoto.atMin` | Optional. Minutes after `startsAt` when the shared shutter fires. Must fall inside the event window, or there is no group photo. See [The group photo](#the-group-photo). |
| `groupPhoto.emote` | Optional. The clip every avatar plays for the shot (lowercase, digits and hyphens). Defaults to `av-cheering`. Pick a clip that runs longer than three seconds: the pose starts three seconds before the shutter and must still be playing when it fires on every neighbour's screen. |

`id`, `agenda`, and `tagline` are optional: an event with none of them still runs
its countdown, its go-live moment, and its fireworks.

## What a player sees

The layer walks six phases, all derived from the wall clock by
`eventState()` so two people standing in the plaza always agree on which one
they are in.

| Phase | When | What shows |
|---|---|---|
| `far` | more than 24 h out | nothing |
| `upcoming` | within 24 h | chip: "Starts in 6h 12m", tappable for the agenda |
| `preshow` | final 30 min | chip glows gold; a toast tells the player to stick around |
| `live` | between start and end | chip reads LIVE with the next segment's countdown; agenda marks the running segment; moment banners fire; fireworks run |
| `afterglow` | 20 min after the end | chip invites a commemorative photo |
| `ended` | after that | the layer tears itself down completely |

The chip docks itself under the King of the Totem card when that card is up, so
the two never overlap, and it hides under zen mode (`Z`) with every other
overlay. While it is mounted, the generic countdown pill stands down: one
countdown on screen at a time.

## The fireworks show

Fireworks are **deterministic, not networked**. Time is cut into four-second
buckets; each bucket is hashed with the event `id` into the same launch plan on
every machine (`fireworkPlan()`), so the whole plaza watches one synchronized
sky without a single packet. This is the same trick the shared day/night clock
([`src/shared/world-clock.js`](../src/shared/world-clock.js)) uses for the sun.

Density scales with the moment: sparse through the event, ramping into a
barrage over the closing fifteen minutes, plus one-off volleys on the go-live
moment and each segment change. Power-saver mode halves it, no more than 14
shells are ever alive at once, and a backgrounded tab never replays the backlog
it missed while `requestAnimationFrame` was paused.

## The agenda drawer

Tapping the chip opens a right-docked drawer with the full agenda (past segments
dimmed, the running one highlighted, future ones counting down in local time),
a live `$THREE` pulse row (price, 24 h change, market cap from
`/api/three-signal`, hidden entirely if that data is unavailable), a
commemorative photo action, and a Buy `$THREE` button that opens `/play`'s
existing on-chain trade widget. `Escape` closes it.

## The group photo

When `groupPhoto` is set, the whole plaza takes one photo at the same instant,
derived from the wall clock with no packet, the same way the fireworks sync
([`groupPhotoState()`](../src/game/meetup-schedule.js)):

| When | What happens |
|---|---|
| 60 s before | Gold banner: "Group photo in 1 minute. Gather at the totem." |
| 10 s before | A large 10..1 countdown overlay; the agenda drawer closes so it is not in the shot |
| 3 s before | Every avatar plays the configured emote (sent over the normal emote channel, so neighbours see the pose) and a firework volley launches to burst overhead at the shutter |
| 0 s | Each client opens photo mode on its own view; the shot is stamped with the event name and offered for download or copy |

The shot is owed only to a client that watched the countdown with the tab in
view. A frame that stalls through the instant (a model loading, a GC pause, a
throttled laptop) still takes the photo on its first frame back, up to 15 s
late. A tab hidden during the countdown, or a player who arrives after the
instant, takes no photo: a picture of a moment the player missed is not the
shared moment.

## The live headcount

While the event is mounted, the chip and the agenda drawer show how many
players are in the world right now ("LIVE · 1,204 here"). The number comes
from `/api/play/population?coin=<mint>`, the matchmaker's real room count,
polled every 20 s and skipped while the tab is hidden. When the multiplayer
server does not answer, the count is simply left off; it never shows an
invented number.

## The presenter PA

Proximity voice is a peer mesh capped at eight people. That suits a
conversation but cannot carry a keynote to a plaza of two hundred. The PA
works the other way: one host speaks, and every player in the coin's world
hears it. That covers the General and Holders worlds and every room shard
past the 100-player cap.

**Going live.**

1. Type `/host` in chat to open the presenter panel.
2. Press **Go live**. The world server decides who may take the mic:
   - the coin's on-chain creator, with a verified wallet;
   - any wallet listed in `PA_HOST_WALLETS` on the multiplayer service;
   - anyone who pastes the `PA_HOST_KEY` secret into the panel. This is the
     guest-presenter path for a host from a partner community, who has no
     wallet tied to the coin.

The key stays in the tab's session storage and is never broadcast. The panel
shows an on-air timer and an **End broadcast** button. Captions are on by
default where the browser has a speech recognizer (Chrome, Edge). Keep the
tab open while you talk.

**One mic at a time.**
- A per-coin lock in presence holds the mic. Its 20 s TTL is refreshed while
  audio flows, so a presenter whose browser crashes frees the mic on their own.
- A second host is told who is on the mic and gets **Take over the mic**,
  which ends the first broadcast and tells that presenter why.

**What listeners get.**
- A gold LIVE bar under the meetup chip names the speaker and their role.
- The bar has animated level meters, Mute, and a volume slider. Volume and
  mute are remembered.
- Captions show inside the bar.
- If the browser blocked autoplay, a **Tap to listen** button appears.
- A browser without WebCodecs audio sees a plain notice and still gets the
  captions.

**Wire format.**
- The host's browser encodes the mic to Opus with WebCodecs: 48 kHz mono,
  32 kbps, in 20 ms frames.
- It sends batches of about 100 ms as `pa:chunk`.
- The room validates each batch: speaker only, at most 16 frames, 1.5 KB per
  frame, 30 messages per second.
- The room publishes the batch on presence topic `pa:<mint>`. Every walk room
  for that coin subscribes and relays it to its own clients. The presenter's
  own socket is skipped.
- Listeners decode into a 250 ms jitter buffer and drop audio once they fall
  more than 1.2 s behind live, so delay never builds up across a long talk.

**Scaling.** Without `REDIS_URI` (single instance) the fan-out uses local
presence. With Redis it crosses instances unchanged, because frames travel as
base64.

Code:
- server [multiplayer/src/world-pa.js](../multiplayer/src/world-pa.js)
- browser [src/game/world-pa.js](../src/game/world-pa.js)
- pure core [src/game/world-pa-core.js](../src/game/world-pa-core.js)

Tests:
- [tests/world-pa.test.js](../tests/world-pa.test.js)
- [tests/world-pa-core.test.js](../tests/world-pa-core.test.js)

Set the guest key on the multiplayer service before the event (config only):

```bash
gcloud run services update <multiplayer-service> --region us-central1 \
  --update-env-vars PA_HOST_KEY=<long random secret>
```

## Previewing without waiting

Add `?meetup=now` to the `/play` URL to shift the configured event to start
twenty seconds from load, keeping its duration and agenda. `?meetup=<ISO>`
shifts it to a specific instant instead. The group photo moves with it, so
`?meetup=<now minus 57 minutes>` previews the gather banner, countdown, pose
and shutter within about two minutes. This runs through
`applyPreviewOverride()`, which every surface that reads the event shares, so a
preview never drifts from the real thing.

It shifts a configured event; it does not invent one. While `public/event.json`
carries the no-event resting state, `?meetup=now` has nothing to move and the
world loads as usual, so schedule a window first.

```
http://localhost:3000/play?coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three&meetup=now
```

## Verifying before an event

The audit drives the real layer through a real browser, so it needs a
real window in `public/event.json` before you run it (see the note under
Previewing).

```bash
npm run dev            # terminal 1: vite on :3000
npm run dev:walk-all   # terminal 2: the Colyseus world server on :2567
npm run audit:meetup   # terminal 3: drives a real browser through the whole layer
```

The audit enters the home town with `?meetup=now` and asserts the chip mounts
and counts down, the generic pill stands down, the chip clears the totem card,
the agenda opens with every segment, `Escape` closes it, the chip flips to LIVE
at the start instant, the go-live banner fires, fireworks reach the scene, zen
mode hides everything, the photo action opens photo mode, and the chip still
fits at 390 px. Screenshots land in `.meetup-audit/` (gitignored). Exit code 0
means every check passed.

Point it at another origin with `--base https://three.ws`.

## Extending it

- **A different world.** The home-town gate is one call (`isHomeTown()`) in
  `meetup-event.js`'s frame loop. Widen it to run an event in any coin world.
- **More agenda segments.** Config only; no code change.
- **A new moment type.** `_moment(icon, title, sub)` paints the gold banner;
  call it from wherever the new trigger lives.
- **Reusing the schedule elsewhere.** `meetup-schedule.js` imports neither the
  DOM nor three.js, so a landing page or jumbotron can render the same countdown
  from the same config.
