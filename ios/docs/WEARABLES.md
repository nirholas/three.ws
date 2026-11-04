# Meta Wearables lane (glasses voice and camera)

The lens web app on Meta Ray-Ban Display has no microphone and no camera. The
Device Access Toolkit (`facebook/meta-wearables-dat-ios`) does, so the iOS app
carries a small native lane for it. Status: **code complete, unbuilt on a Mac,
no hardware run yet**. Meta's toolkit is in developer preview.

## What exists

| Piece | Where | Role |
|---|---|---|
| Web bridge | [src/irl/glasses/native-bridge.js](../../src/irl/glasses/native-bridge.js) | Feature-detects `Capacitor.Plugins.ThreeWsWearables`; absent on the plain web build, so nothing changes there. Session state, voice route, and one-frame re-localization. |
| Capacitor plugin | [ThreeWsWearablesPlugin.swift](../native/App/App/ThreeWsWearablesPlugin.swift) | `getSession`, `sessionChanged`, `startAudioRoute`, `stopAudioRoute`, `capturePhoto`. Registered in `MainViewController`. Compiles with or without the toolkit linked (`#if canImport(WearablesKit)`); without it, it reports `unavailable`. |
| Swift package | [ios/native/WearablesKit/](../native/WearablesKit) | `GlassesService` over `MWDATCore` and `MWDATCamera`, pinned to toolkit `1.0.1` (released 2026-10-09). Builds and tests on its own; the `MWDATMockDevice` test target runs on the simulator with no glasses. |
| JS tests | [tests/irl-native-bridge.test.js](../../tests/irl-native-bridge.test.js) | Fake plugin boundary; real marker pose math. |

## Spoken conversation

No new speech stack. The plugin's `startAudioRoute` puts the shared
`AVAudioSession` in `playAndRecord` with Bluetooth enabled while the glasses are
the connected device, so the WebView's own `getUserMedia` capture and `<audio>`
playback ride the glasses. The talk surface is the unchanged
[`TalkController`](../../src/voice/talk-controller.js) path (`/api/asr`,
`/api/chat`, `/api/tts`). `startVoice()` refuses with `not_connected` unless a
glasses session is live.

## Re-localization

`lane.relocalize({ anchorRoomId, vfovDeg })` takes one JPEG from the glasses,
finds the QR marker whose room id (`markerRoomId`) matches the pin's stored
marker anchor, and returns its camera-space pose through
[`markerPoseCamera`](../../src/irl/marker-pose.js). The caller transforms that
by the live camera and feeds `marker-anchor.js`, exactly as the phone marker
mode does. The frame is decoded, matched and dropped: the module has no network
code, the test suite asserts `fetch` is never called, the plugin never writes a
file, and the bitmap is closed in a `finally` (see
[THREAT-MODEL.md](../../docs/irl/THREAT-MODEL.md)). A different marker in view
returns `wrong_marker`, none returns `no_marker`, an implausible read
`bad_read`.

## Build and test (on a Mac)

```bash
cd ios/native/WearablesKit
xcodebuild test -scheme WearablesKit -destination 'platform=iOS Simulator,name=iPhone 16'
```

Link it into the app: Xcode, File, Add Package Dependencies, Add Local,
`ios/native/WearablesKit`, add the `WearablesKit` library to the App target.
Then add the `MWDAT` block, the Bluetooth/external-accessory background modes
and `NSBluetoothAlwaysUsageDescription` to `Info.plist` per the toolkit README,
and `Wearables.handleUrl` to the scene's URL handler (`GlassesService.handle`).
These are not committed ahead of the link on purpose: declaring background
modes for a toolkit the binary does not use would invite an App Review
question (see [REVIEW-RISK.md](REVIEW-RISK.md)).

## Owner steps (cannot be done in a build session)

1. Enroll in Meta's Wearables developer preview, create the organization and a
   release channel, and take the `MetaAppID` and `ClientToken`.
2. Run the `xcodebuild test` command above on a Mac and link the package.
3. Calibrate the glasses camera vertical field of view on hardware and pass it
   as `vfovDeg` (the bridge refuses to guess it: `fov_unknown`).
4. Hardware demo: a spoken turn with a street agent through the glasses and a
   pin re-snapping to its marker. TestFlight or App Store submission is
   publishing and needs approval.

## Android

Not started, deliberately. The Android app is a Trusted Web Activity
([solana-mobile/](../../solana-mobile)): it has no Capacitor bridge to host a
plugin, so the Kotlin toolkit lane needs a Capacitor Android shell or an
overlay JavaScript interface first, which is a separate decision from this lane.
The JS contract in `native-bridge.js` is platform-neutral, so a Kotlin plugin
exposing the same five methods drops in without web changes.
