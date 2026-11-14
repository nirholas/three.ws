# Glasses platform research: repos, packages and what we adopt

Everything below was checked on **2026-09-17**. Versions, availability and
shutdown dates move fast in this corner of the industry, so each row says what
was verified rather than asserting a permanent truth. Re-check before depending
on any of it.

The short version: **Meta's own toolkit is the only thing we need to adopt, and
almost everything else worth having we already own.** The 3D avatars, the
geofenced presence rail, the conversation pipeline and a tested smart-glasses
HUD protocol are already in this repository.

---

## Meta's first-party platform (adopt)

| Resource | What it is | Verdict |
|---|---|---|
| [wearables.developer.meta.com/docs](https://wearables.developer.meta.com/docs) | The source of truth for both paths. The [web apps build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/) carries the real constraints: input mapping, sensors, storage, design system. | Adopt. Check limits here, not in blog posts. |
| `https://mcp.developer.meta.com/wearables` | Meta's MCP endpoint, tool `search_webapps_docs`, which answers questions about current display constraints, setup, testing and publishing. | Adopt. Wire it into the workspace MCP config so an agent checks the platform instead of guessing. |
| [facebookincubator/meta-wearables-webapp](https://github.com/facebookincubator/meta-wearables-webapp) | Meta's AI-assisted toolkit for building display web apps: skills covering d-pad navigation, EMG pinch and continuous drag, sensors, storage, offline, deployment, QR generation. Not an npm package, a set of agent skills. | Adopt as reference. Read the skills, keep our own code. |
| [facebook/meta-wearables-dat-ios](https://github.com/facebook/meta-wearables-dat-ios) | Native toolkit for iOS over Swift Package Manager: video streaming, photo capture, display components, session lifecycle, MockDeviceKit for testing without hardware. | Adopt in Phase 6, inside [ios/](../../ios/README.md). |
| [facebook/meta-wearables-dat-android](https://github.com/facebook/meta-wearables-dat-android) | The Android twin. | Adopt at Android parity. |
| [Meta Ray-Ban Display Web App Simulator](https://chromewebstore.google.com/detail/meta-ray-ban-display-web/jpjlmmodokemlepklkdbimceggpbjcll) | Chrome extension: the 600x600 surface with additive blending, environment backgrounds, d-pad input, display tuning, recording, and QR deeplink generation. | Adopt. This is the development loop before hardware. |
| [displayglasses.dev](https://displayglasses.dev/) | Browser-hosted simulator, same idea, no extension install. | Reference. Useful for sharing a preview with someone who has no extension. |

Platform facts worth repeating because they change the architecture:

- Web apps get **no camera and no microphone**. Native gets both, plus speakers
  over Bluetooth profiles.
- The native display API is a **fixed component set**, and custom pixel or 3D
  rendering is explicitly unsupported. Video is capped under 400px per side and
  70,000 total pixels.
- **No custom Neural Band gestures.** Predefined swipes and pinches only, and
  they arrive as arrow keys and Enter. The raw sEMG stream is not exposed.
- **Publishing is closed during developer preview.** Distribution today is a
  URL and a QR code, which is enough for a demo and a pilot.
- Mock Device Kit covers the display glasses as of toolkit `1.0.1`
  (checked 2026-11-14): `GlassesModel.metaRayBanDisplay` plus a `MockDisplayKit`
  with a preview view and simulated clicks. The lens web app still needs the
  simulator or hardware, since the mock covers the native toolkit only.

## Community work worth reading (reference, not dependency)

| Repo or site | Why it is useful |
|---|---|
| [ggoonnzzaallo/meta_display](https://github.com/ggoonnzzaallo/meta_display) | Working web apps written for real Ray-Ban Display hardware. The fastest way to see what the lens actually does with a DOM. |
| [kevinCCme/XR_WEARABLE](https://github.com/kevinCCme/XR_WEARABLE) | Early third-party experiments against the toolkit. |
| [glasskit.app/docs](https://glasskit.app/docs/meta-ray-ban-display-sdk-explained) | A clear third-party explainer of the two SDK paths, useful for onboarding someone new to the platform. |

## Neuromotor input research (context, not a dependency)

We cannot read the band ourselves, so none of this ships. It is here because it
explains what the band can and cannot do, which is what makes the five-input
design defensible rather than lazy.

- [facebookresearch/emg2qwerty](https://github.com/facebookresearch/emg2qwerty):
  the open sEMG typing dataset and baselines (108 users, 1,135 sessions, 346
  hours), with character error rates under 10% once a language model refines the
  decode. That threshold is why on-glasses handwriting exists at all.
- `emg2pose`, the companion pose-estimation dataset from the same release.
- ["A generic non-invasive neuromotor interface for human-computer
  interaction"](https://www.nature.com/articles/s41586-025-09255-w), Nature,
  2025: the research line the Neural Band productises.

## Geospatial anchoring (mostly avoid, and here is why)

The obvious idea for "an avatar standing exactly here" is a visual positioning
system. The 2026 landscape does not reward that bet for a web client:

| Option | Status on 2026-09-17 | Verdict |
|---|---|---|
| 8th Wall (WebAR, hosted VPS) | Shut down. Hosted services offline, access ended 28 Feb 2026, existing hosted campaigns run until 28 Feb 2027. The engine went open source (MIT) minus SLAM. | Avoid. |
| Niantic Spatial VPS on the web | Not supported on the distributed engine binary or the open-source engine. Legacy hosted projects only, through Feb 2027. | Avoid for web. |
| Google ARCore Geospatial API | Alive and strong, but native Android and Unity, not a browser API. | Phase 6 candidate on the native lane only. |
| Immersal | Native SDKs plus a REST lane, needs site mapping per location. | Revisit if a specific venue needs centimetre placement. |
| [OpenFLAME](https://arxiv.org/html/2510.03915v1) | Research on federated VPS with a common API, exactly the interoperability gap that makes every option above a lock-in. | Watch. |
| [locar](https://www.npmjs.com/package/locar) (LocAR.js, AR.js org) | 0.2.12, MIT, the location-based part of AR.js rebuilt for current three.js. GPS to world coordinates plus device-orientation controls. | Not needed. [src/irl.js](../../src/irl.js) and [src/ar/](../../src/ar) already do this with WebXR hit-test anchoring, and the lens cannot render 3D at all. Worth reading if the phone-side geo projection is ever rewritten. |
| `geolib`, `@turf/turf` | Solid MIT geospatial maths. | Not needed. `api/_lib/geohash.js` and the IRL distance maths already cover the whole surface, and a lens app should not ship a geospatial library to compute one bearing. |

The conclusion that matters: **GPS is inside our envelope.** The web lane gives
5 to 50 m accuracy, IRL's discovery radius is 10 to 60 m, so a pin resolves
correctly today with no VPS at all. Precision is a Phase 6 upgrade on the native
camera lane, not a prerequisite for shipping.

## What we already own (the real head start)

| Ours | Where | What it removes from the plan |
|---|---|---|
| Geofenced presence rail | [api/irl/](../../api/irl/README.md), [packages/irl/](../../packages/irl/README.md) | Presence tokens, nearby reads, pins, interactions, money drops, world lines |
| Tested smart-glasses HUD protocol | [src/irl/glasses/protocol.js](../../src/irl/glasses/protocol.js) | Distance formatting, direction glyphs, wire framing, all unit tested |
| Two live BLE glasses adapters | [src/irl/glasses/](../../src/irl/glasses) | Proof the HUD model works on a real lens |
| Walk-up conversation | [src/irl/pin-talk.js](../../src/irl/pin-talk.js) | Persona, memory, voice, lipsync, barge-in |
| Server-side avatar rendering | `GET /api/avatar/render`, `GET /api/render/avatar-clip` ([media API](/docs/media-api)) | The lens portrait, CDN-cached, no client 3D |
| AR handoff | [src/ar/](../../src/ar), [api/ar.js](../../api/ar.js), [/irl](https://three.ws/irl) | WebXR anchoring, Quick Look, Scene Viewer, visit links |
| iOS app shell | [ios/](../../ios/README.md) | Where the native toolkit lands in Phase 6 |

## How to re-verify this page

```bash
# Platform limits, straight from Meta's MCP endpoint
#   endpoint: https://mcp.developer.meta.com/wearables
#   tool:     search_webapps_docs

# Package facts
npm view locar version license
```

Check the [build guide](https://wearables.developer.meta.com/docs/develop/webapps/build/)
and the [FAQ](https://developers.meta.com/wearables/faq/) for capability changes,
especially camera, microphone, audio playback and publishing, all of which are
the difference between a phase being possible and being blocked.

## Related

- [three.ws on smart glasses](/docs/glasses)
- [Meta Ray-Ban Display build plan](/docs/glasses/meta-ray-ban-display)
