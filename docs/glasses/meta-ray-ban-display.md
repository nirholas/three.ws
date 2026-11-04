# Meta Ray-Ban Display: agents you can walk up to

**Goal: you wear Ray-Ban Display glasses, walk down a street, and your lens
tells you a three.ws agent is standing 24 metres away. You walk up. It knows you
arrived. You talk to it with a pinch of your fingers, no phone in your hand, and
if you want to see its body you hand off to AR.**

This is the build plan for that. It rides entirely on the existing
[IRL](/docs/irl) rail: the pins, the presence tokens, the personas, and the
conversation are already live and already shipped as
[`@three-ws/irl`](https://www.npmjs.com/package/@three-ws/irl). What is new is
one client, written for a 600x600 additive panel and a wristband that speaks
four arrow keys and Enter.

Platform background and the other glasses lanes: [three.ws on smart
glasses](/docs/glasses). Verified platform facts and every repo or package
evaluated: [research](/docs/glasses/research).

---

## What the platform gives us

Verified against Meta's developer documentation on 2026-09-17. Two paths exist,
and they have opposite strengths.

| | Web Apps | Device Access Toolkit (native) |
|---|---|---|
| Runs | On the glasses, from an HTTPS URL | Inside your own iOS or Android app |
| Language | HTML, CSS, JavaScript | Swift, Kotlin |
| Display | Your own DOM at 600x600 | A fixed component set (text, image, button, icon, video, flexbox) |
| Input | Neural Band and captouch, as `ArrowUp/Down/Left/Right`, `Enter`, `Escape` | Same gestures, native callbacks |
| Sensors | `devicemotion`, `deviceorientation` (glasses), `navigator.geolocation` (phone, 5 to 50 m) | Same, plus device session state |
| Camera | Not available | Video streaming and photo capture |
| Microphone | Not available | Available |
| Speakers | Not a listed capability | Available over Bluetooth profiles |
| Storage | `localStorage` and `sessionStorage`, 5 MB each | Native |
| Custom 3D | Not available in practice (Bluetooth bandwidth) | Explicitly not supported |
| Distribution | Any HTTPS URL, added by QR or Meta AI app settings | App registration, release channels |
| Publishing | Not open during developer preview | Not open during developer preview |

Hard requirements: Meta Ray-Ban Display glasses on software v125 or later, the
Meta AI app v272 or later with Developer Mode enabled, and an HTTPS origin with
a valid certificate. HTTP is refused.

Two consequences drive the whole design:

1. **The lens is a HUD, not a canvas.** Black is transparent on an additive
   display, complex layouts lag over Bluetooth, and there is no 3D. We render
   type, one small portrait, and a direction. The avatar's body lives on the
   phone.
2. **There is no keyboard and no microphone on the web lane.** A conversation
   has to be winnable with a d-pad and a pinch. That is a design constraint, and
   it produces a better street interaction than a tiny keyboard would.

---

## The surface

A new page at **`/glass`**, served from this repo like every other page.

`/irl` is an 8,500-line three.js application. It cannot be the thing the lens
loads. `/glass` is a separate, deliberately tiny DOM surface (target: under
60 KB of JavaScript, no three.js, no WebGL) that speaks the same API and imports
the same pure helpers, so the two lanes can never disagree about what "24 m,
turn left" means.

```
pages/glass.html          the 600x600 shell, additive-safe, no chrome
src/glass/main.js         boot, view stack, lifecycle
src/glass/dpad.js         roving focus over .focusable, Enter / Escape
src/glass/presence.js     check-in, token refresh, adaptive nearby polling
src/glass/compass.js      deviceorientation to screen-relative bearing
src/glass/views/*.js      scanning, nearby, agent, talk, handoff, denied
src/glass/hud.css         the additive design system
```

Reused unchanged, not reimplemented:

- [src/irl/glasses/protocol.js](../../src/irl/glasses/protocol.js) for
  `formatDistance()`, `normalizeAngle()` and `arrowGlyph()`. The Frame lens, the
  G1 lens and the Ray-Ban Display lens all format a distance the same way
  because they call the same pure function, already covered by
  [tests/irl-glasses-protocol.test.js](../../tests/irl-glasses-protocol.test.js).
- [src/irl/proximity-cue.js](../../src/irl/proximity-cue.js) for the
  nearest-agent selection and the screen-relative bearing convention
  (0 = ahead, positive = turn right, radians).
- The `/api/irl/*` contract, through the same calls
  [`@three-ws/irl`](https://www.npmjs.com/package/@three-ws/irl) makes.

## The design system on an additive panel

- Background: pure `#000`, which is transparent glass. Never a light surface.
- One accent (`#7aa2ff`) and one alert (`#ffd479`), both high-luminance on
  black. Never a mid-grey: it reads as haze over the real world.
- Body type 20px minimum, primary type 24 to 32px. 16px is the floor Meta
  documents, and at street distance 16px is a squint.
- Every interactive element carries `.focusable` and a focus ring that is
  visible at a glance (glow plus border, not an outline).
- One portrait maximum per view, 160px square, fetched from
  `GET /api/render/avatar-clip` (posed, camera-orbited PNG of any GLB, already
  CDN-cached) with a dark background so it composites cleanly.
- No animation that runs continuously. The panel is in someone's eye while they
  cross a road.

## The interaction model

The Neural Band and the temple captouch arrive as keyboard events. That is the
whole input vocabulary:

| Gesture | Event | In `/glass` |
|---|---|---|
| Swipe up / down | `ArrowUp` / `ArrowDown` | Move focus in the nearby list or the reply list |
| Swipe left / right | `ArrowLeft` / `ArrowRight` | Previous / next view, or scrub a long reply |
| Pinch (index) | `Enter` | Select, send, confirm |
| Pinch and hold, drag | continuous | Scrub a long list without discrete steps |
| Back | `Escape` | Pop the view stack |

There are no custom gestures. Meta does not expose the raw sEMG stream to third
parties, so anything a design needs beyond these five inputs does not exist.

## The loop

```
boot
 └─ permissions (orientation needs a user gesture: the first pinch)
     └─ checkIn()                POST /api/irl/fix-token      (180 s token)
         └─ nearby()             GET  /api/irl/pins           (10 to 60 m)
             ├─ nobody near      "Scanning" with a live heading ring
             └─ someone near     name · distance · arrow, ranked by distance
                 └─ arrival      inside the pin radius: the agent greets you
                     └─ talk     POST /api/chat as that agent
                         └─ AR   hand off to the phone for the body
```

Polling cadence is adaptive, not a fixed timer: 5 s while the fix is moving,
15 s while it is not, paused entirely when the document is hidden. The presence
token is re-minted when it expires (180 s) or when the precision-7 geohash cell
changes, which is exactly the rule `@three-ws/irl` already documents.

Every state is designed, because a lens with a blank frame is worse than no
lens: permission denied, GPS unavailable, offline, scanning with nothing near,
scanning with the compass uncalibrated, list, card, talking, agent unreachable,
and handed off.

## Conversation without a keyboard or a microphone

The agent's reply comes from `POST /api/chat` in its own persona, exactly as
[src/irl/pin-talk.js](../../src/irl/pin-talk.js) does it today (the pin's
`agent_id` when it has one, the pin persona otherwise).

The visitor's side is the interesting half. Three input lanes, each capability
gated, each real:

1. **Suggested replies (always available).** The chat response carries three
   short replies the visitor could plausibly say next, generated in the same
   completion. The lens lists them; swipe to choose, pinch to send. This is the
   primary lane and it must be good enough to be the only lane.
2. **Neural Handwriting (when the composer reaches us).** Meta's web-app
   documentation lists text input as unsupported, while the on-glasses composer
   exists at the OS level. So we feature-detect it honestly: focus a real input,
   watch for a real `input` event, and only then show the "Write" affordance.
   Never a button that might do nothing.
3. **Audio out (when it plays).** Audio playback is not a documented web-app
   capability. We attempt the agent's real voice through `/api/tts` and verify
   it is actually playing (the `play()` promise resolves and `currentTime`
   advances), falling back to text-only on the lens. Both branches ship; neither
   is a stub.

The native Device Access Toolkit lane has a real microphone and real speakers,
so spoken conversation is Phase 6, not a promise made on the web lane.

## Handing off to the body

The lens cannot render the avatar, and it cannot open a browser on the phone.
So the handoff is explicit and works signed out:

- The agent card offers **See it in AR**.
- Signed-in wearers get a real push through the existing notification rail
  ([api/\_lib/feed.js](../../api/_lib/feed.js)), which opens
  `/irl?pin=<id>` on the phone, the same visit link the printable IRL sign uses.
- Signed-out wearers get a six-character code on the lens, resolving at
  `three.ws/g/<code>` to the same visit link, minted like the existing IRL share
  tokens ([api/irl/share.js](../../api/irl/share.js)).

The same code is how an account claims a lens session, since typing an email
address with a d-pad is not a thing anyone will do: the lens shows a code, the
phone claims it, and the anonymous device token upgrades to the account. Until
then the lens runs in IRL's existing anonymous device-token mode.

---

## Build plan

Each phase is shippable on its own and leaves the platform better than it found
it. Nothing here is gated on Meta approving anything, except distribution.

### Phase 0: access and proof

> Status 2026-11-04: pending hardware. Every item here needs a physical Meta Ray-Ban Display or the Chrome simulator extension and belongs to the owner. The `/glass` page itself is live, so the stub step reduces to scanning its QR code.

- [ ] Meta Ray-Ban Display glasses on v125+, Meta AI app v272+, Developer Mode on.
- [ ] Install the Meta Ray-Ban Display Web App Simulator Chrome extension and
      confirm the 600x600 additive preview against a static page.
- [ ] Add the Wearables MCP endpoint (`https://mcp.developer.meta.com/wearables`,
      tool `search_webapps_docs`) to the workspace MCP config so platform limits
      are checked against the source, not against this document.
- [ ] Serve a one-screen `/glass` stub from the live site, add it to the glasses
      by QR, and confirm it loads on the lens. Record what the lens does with
      `deviceorientation` permission prompts.

**Done when:** a page served from `https://three.ws/glass` renders on real
glasses and logs a d-pad event from a real pinch.

### Phase 1: the lens surface

> Status 2026-11-04: built and covered by `tests/glass-dpad.test.js` and `tests/e2e/glass.spec.js` (600x600, keys only). On-lens verification is pending hardware.

- [x] `pages/glass.html` with the documented viewport and
      `<meta name="mrbd-web-app-capable" content="yes">`, registered in
      [vite.config.js](../../vite.config.js), [vercel.json](../../vercel.json)
      and [data/pages.json](../../data/pages.json).
- [x] `src/glass/hud.css`: the additive design system above, as tokens.
- [x] `src/glass/dpad.js`: roving focus over `.focusable`, wrap-around, `Enter`
      to activate, `Escape` to pop, continuous-drag scrubbing. Pure and unit
      tested (no DOM assumptions beyond an element list).
- [x] `src/glass/main.js`: view stack, document-visibility lifecycle, a single
      render pass per state change (never a per-event DOM write).
- [x] Every designed state present, including the ones that are not the happy
      path.

**Done when:** the surface passes `npm run check:dist` and `npm run check:pages`,
renders correctly in the simulator at 600x600, and is fully operable with only
the five inputs.

### Phase 2: the presence loop

- [x] `src/glass/presence.js`: check-in, token expiry and geohash-cell re-mint,
      adaptive polling, request coalescing, honest error surfacing.
- [x] `src/glass/compass.js`: `deviceorientation` to a screen-relative bearing,
      `requestPermission()` behind the first pinch, a calibration state when the
      heading is unreliable.
- [ ] Scanning view: heading ring, nearby count, last-fix age.
- [x] Nearby view: ranked list, each row name + `formatDistance()` +
      `arrowGlyph()` from the shared protocol module.
- [ ] Arrival: crossing into a pin's radius promotes that agent to the lens once,
      with a real interaction logged (`POST /api/irl/interactions`, type
      `glasses`, consistent with the BLE lane's telemetry).

**Done when:** walking toward a real pin moves the distance down and the arrow
tracks the turn, on hardware, with the phone in a pocket.

### Phase 3: conversation

- [ ] Agent card: portrait from `/api/render/avatar-clip`, name, caption, the
      actions (Talk, See it in AR, and its x402 endpoint when the pin carries one).
- [x] `POST /api/chat` extended with an opt-in `suggestReplies` count, returning
      three short suggestions in the same completion. Wired for `/glass` first,
      then offered to [src/irl/pin-talk.js](../../src/irl/pin-talk.js), which
      wants it too.
- [x] Talk view: transcript, focused reply list, send on pinch, honest thinking
      and error states, conversation capped to what fits on a lens.
- [ ] Capability gates for the composer and for audio, each proven at runtime
      rather than assumed.
- [x] One `talk` interaction per conversation, never the transcript, matching
      the existing IRL privacy posture.

**Done when:** a full exchange with a real pinned agent happens on the lens with
no phone interaction, and `forge_creations`-style ground truth (the interaction
log) shows the encounter.

### Phase 4: handing off to the body

- [x] `api/glass/handoff.js`: mint a six-character code for a pin, resolve
      `three.ws/g/<code>` to `/irl?pin=<id>`, expiring, owner-free, rate limited.
- [ ] Push lane for signed-in wearers through the existing notification rail.
- [x] `api/glass/pair.js`: claim a lens session from the phone, upgrading the
      anonymous device token to the account.
- [x] `/irl` recognises an arrival that started on the lens and opens the pin
      card directly, the way the visit link already does.

**Done when:** a pinch on the lens puts the avatar in your hand in AR in under
ten seconds, signed in or not.

### Phase 5: place an agent from the lens

- [ ] Place at your current fix, choosing from your own avatars, with the
      heading taken from where you are actually looking.
- [ ] Confirmation state, then the placed agent appears in your own nearby feed.
- [ ] Honest anonymous-versus-permanent expiry copy, as `/irl` already shows.

**Done when:** an agent can be placed and rediscovered without ever opening a
phone.

### Phase 6: the native lane (camera, voice, precision)

- [ ] Add the Meta Wearables Device Access Toolkit to the iOS app
      ([ios/](../../ios/README.md)) over Swift Package Manager, behind the
      existing Capacitor shell, with MockDeviceKit covering the no-hardware path.
- [ ] Spoken conversation: glasses microphone into the same `TalkController`
      pipeline, agent voice out through the glasses speakers.
- [ ] Camera frames into a re-localisation pass so a pin lands where it was
      placed rather than where GPS guesses, keeping the presence-gated contract
      intact (frames are processed for pose, never uploaded as a location feed).
- [ ] Android parity, same toolkit.

**Done when:** you can hold a spoken conversation with a street agent, hands
free, and the agent stands in the same doorway it was left in.

### Phase 7: ship it

- [ ] `data/pages.json` entry for `/glass` (this is what feeds the changelog,
      the sitemap and `llms.txt`).
- [ ] `data/changelog.json` entry, community language, `feature` tag.
- [ ] A row in [STRUCTURE.md](../../STRUCTURE.md) for the glasses surfaces.
- [ ] `npm run audit:docs` clean, `npm test` green, `npm run check:rules` clean
      on the touched paths.
- [ ] Distribution when Meta opens publishing. Until then, the QR deeplink is
      the install path and it is a perfectly good one for a demo.

---

## Non-goals

- Rendering a three.ws avatar on the lens. The hardware cannot, and pretending
  otherwise would ship a blurry sprite that undersells the product.
- A map of every agent on earth. Presence-gated reads are the contract, on every
  client. See [docs/irl/THREAT-MODEL.md](../irl/THREAT-MODEL.md).
- Custom Neural Band gestures. Meta exposes five inputs. We design for five.
- Continuous camera capture on the native lane. Frames serve a pose fix in the
  moment and are not retained.

## Decisions taken (and their alternatives)

| Decision | Alternative rejected | Why |
|---|---|---|
| A separate `/glass` page | Responsive mode inside `/irl` | `/irl` boots three.js, nipplejs and a WebGL renderer. A lens app that downloads a 3D engine it can never use is not a lens app. |
| Suggested replies as the primary input | Waiting for text input support | A pinch-selected reply is faster on a street than handwriting, and it works today on documented capabilities. |
| Anonymous device token by default | Requiring sign-in | IRL already supports anonymous placement and discovery, and no one is typing a password with a d-pad. |
| Reuse `protocol.js` formatting | A lens-specific formatter | Three lenses that disagree about "24 m" is a bug waiting to happen. One tested pure module. |
| GPS-only in phases 1 to 5 | Visual positioning first | GPS at 5 to 50 m is what the web lane exposes, and IRL's radius is 10 to 60 m, so GPS is inside the envelope. Precision is a Phase 6 upgrade on the native lane, not a prerequisite. |

## Testing

- **Simulator:** the Meta Ray-Ban Display Web App Simulator Chrome extension
  (600x600, additive blending, environment backgrounds, D-pad input, recording).
  Everything except real GPS movement can be exercised there.
- **Desktop:** Chrome DevTools at a 600x600 viewport with sensor emulation, plus
  the repo's existing Playwright lane for the page's states.
- **Unit:** `src/glass/dpad.js`, `src/glass/presence.js` and `src/glass/compass.js`
  are pure enough to test without a DOM, the same way
  [tests/irl-glasses-protocol.test.js](../../tests/irl-glasses-protocol.test.js)
  tests the BLE HUD.
- **On hardware:** add the app by QR from the simulator or the Meta AI app, then
  walk a real pin. The [IRL street demo runbook](/docs/irl/street-demo) is the
  script for that walk.

## Related

- [three.ws on smart glasses](/docs/glasses)
- [Platform and package research](/docs/glasses/research)
- [IRL](/docs/irl), the [street demo runbook](/docs/irl/street-demo) and the
  [threat model](../irl/THREAT-MODEL.md)
- [`@three-ws/irl`](https://www.npmjs.com/package/@three-ws/irl)
