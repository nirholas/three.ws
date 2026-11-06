# three.ws on smart glasses

Agents already stand at real GPS coordinates. [IRL](/docs/irl) pins them to a
park bench, a shop doorway, a conference table, and anyone who physically walks
up can see the avatar in AR, talk to it, and pay it. The missing half is the
walking up: today you only find an agent if you are already holding a phone with
`/irl` open.

Smart glasses close that gap. They are the sense organ. You wear them, and the
world tells you an agent is thirty metres to your left before you ever reach for
a phone.

This page is the map of that work: what ships today, what is being built, and
the one architectural constraint every glasses lane obeys.

---

## The constraint that shapes everything

**No smart-glasses display in 2026 can render a three.ws avatar.** Not one.

- Brilliant Labs Frame and Even Realities G1 are thin Bluetooth screens. No
  browser, no WebGL, no WebXR.
- Meta Ray-Ban Display is a 600x600 additive monocular panel driven over
  Bluetooth from the phone. Its native SDK offers a fixed component set (text,
  image, button, icon, video, flexbox) and states plainly that custom pixel and
  3D rendering are not supported. The web-app lane gives you a DOM at 600x600,
  but the same Bluetooth bandwidth ceiling applies: Meta's own guidance is to
  keep layouts to text and small images, and caps video at 400px per side and
  70,000 total pixels.
- Everything with real 6DoF passthrough (Quest, Vision Pro) is a headset you do
  not wear down the street.

So we never try. The division of labour is fixed:

| Layer | Runs on | Carries |
|---|---|---|
| **The signal** | The glasses | Who is near, which way, how far, what they said |
| **The body** | The phone (or the headset) | The 3D avatar, standing in the real world, in AR |
| **The truth** | `api/irl/*` | Presence tokens, pins, conversation, interactions |

The glasses give you the summons. The phone gives you the meeting. The one time
this is not a compromise is the best moment in the product: you are walking,
your lens quietly says `Scout, 24 m, turn left`, and you decide whether to stop.

---

## Lane 1: companion BLE glasses (live)

Live in [/irl](https://three.ws/irl) behind the "Connect glasses" button.

`/irl` already computes the nearest-agent cue for its on-screen directional
nudge ([src/irl/proximity-cue.js](../src/irl/proximity-cue.js)). The bridge
reshapes that same signal into a compact heads-up frame and streams it to a lens
over Web Bluetooth.

| Piece | File |
|---|---|
| Pure HUD protocol (formatting, arrow glyphs, wire framing) | [src/irl/glasses/protocol.js](../src/irl/glasses/protocol.js) |
| Device-agnostic controller (rate limiting, heartbeat, recovery) | [src/irl/glasses/bridge.js](../src/irl/glasses/bridge.js) |
| Web Bluetooth transport + capability gate | [src/irl/glasses/transport.js](../src/irl/glasses/transport.js) |
| Brilliant Labs Frame adapter | [src/irl/glasses/frame.js](../src/irl/glasses/frame.js) |
| Even Realities G1 adapter (two-arm staged pairing) | [src/irl/glasses/g1.js](../src/irl/glasses/g1.js) |
| Connect sheet (capability gate, picker, connected preview, retry) | [src/irl/glasses/connect-ui.js](../src/irl/glasses/connect-ui.js) |
| Tests | [tests/irl-glasses-protocol.test.js](../tests/irl-glasses-protocol.test.js) |

Push discipline: 3 Hz ceiling on display writes, single-flight (BLE writes never
overlap), a 4 s heartbeat that re-sends an unchanged frame to recover a dropped
write, and transient announcements that hold the lens for 3.5 s. A connected
link stamps its interaction telemetry as a `glasses` encounter, so the analytics
rollup can tell a lens discovery from a screen one.

Web Bluetooth is Chromium-only, so this lane does not exist on iOS Safari. The
connect sheet says so honestly instead of failing at pair time.

## Lane 2: Meta Ray-Ban Display web app (in build)

The inversion of lane 1. Ray-Ban Display exposes no Bluetooth API to third
parties; instead **the glasses run our web app**. A publicly hosted HTTPS page
loads on the lens with GPS from the paired phone, motion and orientation from
the glasses, and Neural Band input delivered as arrow keys and Enter.

That is enough to run the whole IRL discovery loop natively on your face, with
no phone in your hand. The build plan, the interaction design for the Neural
Band, and the phased checklist live in
[Meta Ray-Ban Display](/docs/glasses/meta-ray-ban-display).

## Lane 3: native Device Access Toolkit (in build)

The web-app lane has no camera and no microphone. Meta's native toolkit does:
camera streaming, photo capture, mic, and speakers over Bluetooth profiles, from
inside an existing iOS or Android app. We already ship an iOS app shell
([ios/](../ios/README.md)), which is where that integration belongs.

What it unlocks that lane 2 cannot: **spoken** conversation with a street agent
(the same `TalkController` that powers
[src/irl/pin-talk.js](../src/irl/pin-talk.js)), and camera frames good enough
for visual re-localisation, so an agent stands where it was placed to the
centimetre rather than to the five metres GPS gives you.

The web half is already written: [src/irl/glasses/native-bridge.js](../src/irl/glasses/native-bridge.js)
feature-detects the `ThreeWsWearables` Capacitor plugin in the iOS shell
([ios/docs/WEARABLES.md](../ios/docs/WEARABLES.md)) and routes voice and
re-localisation through it, so the plain web build never loads native code.

---

## What every lane rides on

Nothing above re-implements IRL. All three lanes speak the same presence-gated
contract, documented in [IRL](/docs/irl) and shipped as
[`@three-ws/irl`](https://www.npmjs.com/package/@three-ws/irl):

- `POST /api/irl/fix-token` mints a short-lived (180 s) proof-of-presence token
  from a real fix, anchored to a coarsened (~110 m) point.
- `GET /api/irl/pins?lat=&lng=&radius=` answers only for the area that token was
  minted in, radius clamped to 10 to 60 m, at most 50 pins, sweep-detected.
- `POST /api/chat` carries the conversation in the agent's own persona.
- `POST /api/irl/interactions` logs the encounter, never the transcript, never
  the caller's position.

There is no browseable map and no "query any point on earth", on a lens or
anywhere else. You see what is around you because you are there. The reasoning
is in [docs/irl/THREAT-MODEL.md](irl/THREAT-MODEL.md).

## Related

- [IRL: agents in the real world](/docs/irl)
- [IRL street demo runbook](/docs/irl/street-demo)
- [World Lines: proof of presence](/docs/world-lines)
- [AR Studio](/docs/ar-studio) and [AR exports](/docs/ar)
- [Platform and package research for the glasses lanes](/docs/glasses/research)
