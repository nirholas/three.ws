# `ios/`: the three.ws iOS app

The App Store build of three.ws. A Capacitor 8 shell whose WKWebView runs the
live product at `https://three.ws`, wrapped in the native layer an app needs and
a website cannot have: push notifications with an icon badge, a share
extension, home screen quick actions, universal links, the system share sheet,
deep links back from wallets, haptics, a real launch screen, and the camera /
location / motion permissions the AR and IRL surfaces depend on.

The Android counterpart is [`../solana-mobile/`](../solana-mobile), which
packages the same product as a Trusted Web Activity for the Solana dApp Store.
This directory follows its shape on purpose: detection and shims in `src/`, the
native project under a single directory, listing copy in `publish/`, and a
submission checklist in `docs/`.

## Layout

```
ios/
├── capacitor.config.ts     # appId, server URL, iOS behaviour, plugin config
├── shell/                  # local bundle: bootstrap + the designed offline screen
├── src/native-bridge.js    # web-side half; ships with the SITE, not the .ipa
├── scripts/make-icons.mjs  # derives the icon + launch images from the brand mark
├── scripts/release.mjs     # archive + upload to TestFlight (npm run ios:release)
├── native/App/             # the generated Xcode project (committed)
│   ├── App.xcodeproj
│   ├── App/SceneDelegate.swift       # roots MainViewController, quick actions, share pickup
│   ├── App/AppDelegate.swift         # APNs token forwarding, stale share sweep
│   ├── App/MainViewController.swift  # swipe-back, dark chrome, edge-to-edge insets, open(path:)
│   ├── App/QuickActions.swift        # home screen quick action types -> pages
│   ├── App/ThreeWsAppPlugin.swift    # the app's own plugin: takeShare, setBadge, openInSafari
│   ├── App/CarPlaySceneDelegate.swift # the car screen: templates + voice control
│   ├── App/DriveLink.swift           # CarPlay <-> /drive channel + audio session
│   ├── App/Info.plist                # usage strings, URL scheme, quick actions, .glb type, scenes
│   ├── App/App.entitlements          # associated domains + APNs + App Group
│   ├── App/App-CarPlay.entitlements  # the same plus CarPlay, signed only with --carplay
│   ├── App/PrivacyInfo.xcprivacy     # privacy manifest: required-reason APIs, collected data
│   ├── ShareExtension/               # the share sheet entry (ws.three.app.share)
│   │   ├── ShareViewController.swift #   copies photos (as JPEG) or a .glb out of the sender
│   │   └── SharedInbox.swift         #   App Group hand-off, compiled into app and extension
│   ├── ci_scripts/ci_post_clone.sh   # Xcode Cloud: Node, structural check, cap sync
│   └── CapApp-SPM/                   # Swift Package Manager plugin graph
└── docs/                   # SUBMISSION.md, REVIEW-RISK.md, ASSETS.md, CARPLAY.md
```

The project carries a second target, **GlanceWidgetExtension** (`ws.three.app.glance`),
which is the Agent glance home screen widget. Its sources are not in this
directory: they live in [`../apple/`](../apple/README.md) and are compiled by
both this project and the Mac app, byte for byte, so the two platforms cannot
drift. It deploys to iOS 17 while the app stays on iOS 16, so an older phone
simply never sees the widget in the gallery.

## The home screen widget

Long press the home screen, **Edit**, **Add Widget**, **three.ws**, and the
agent's card is there in small, medium or large. It authenticates with a widget
token the owner mints on [three.ws/glance](https://three.ws/glance), which
arrives as `threews://glance/link?token=…` and is claimed in
[`SceneDelegate`](native/App/App/SceneDelegate.swift) before Capacitor sees it,
so a live credential never reaches the WebView. Everything about it, including
how to build and verify it without a Mac, is in
[`../apple/README.md`](../apple/README.md) and
[`../docs/native-widgets.md`](../docs/native-widgets.md).

## Push notifications

The WebView has no service worker, so Web Push cannot reach it. The app
registers with APNs instead and every "turn on push" control on the site works
unchanged, because [`src/push-notifications.js`](../src/push-notifications.js)
takes the native path inside the app:

1. `enablePush()` asks iOS for permission through the PushNotifications plugin,
   calls `register()`, and waits for the device token that
   [`AppDelegate`](native/App/App/AppDelegate.swift) forwards to Capacitor.
2. The token goes to `POST /api/push/device`
   ([`api/push/device.js`](../api/push/device.js)), stored in `apns_devices`.
3. [`api/_lib/notify.js`](../api/_lib/notify.js) sends every push-enabled
   notification to Web Push and to APNs
   ([`api/_lib/apns.js`](../api/_lib/apns.js)) in parallel, with the unread
   count as the icon badge. A token APNs reports gone is pruned; a development
   build's sandbox token is found on the sandbox host automatically.
4. A tap reaches `native-bridge.js`, which opens the page with
   `?source=push&n=<id>` so the re-engagement funnel records it, or opens an
   off-site link (an explorer) in the Safari sheet.

It needs `APNS_KEY_ID` and `APNS_AUTH_KEY` on the Cloud Run service (plus the
Team ID, read from `APNS_TEAM_ID` or the existing `APPLE_TEAM_ID`). Without
them `/api/config` reports `nativePush.ios: false` and the app never offers push.

## Sharing into the app

`ShareExtension/` puts three.ws in every app's share sheet for one to three
photos or one `.glb`, the same things the Android app's web share target takes.
The extension copies the files out of the sending app, converts photos to an
upright JPEG no larger than 2048px, and parks them in the App Group through
[`SharedInbox`](native/App/ShareExtension/SharedInbox.swift). Share extensions
cannot open their host app, so when the app next becomes active
`SceneDelegate` claims the pending share and loads
`/create/selfie?shared=1&inbox=<id>` or `/create?shared=glb&inbox=<id>`, and
[`src/shared/share-target.js`](../src/shared/share-target.js) reads the files
through `ThreeWsApp.takeShare`. A share is claimable for ten minutes, consumed
once, and swept after a day.

## Quick actions

Press and hold the icon: Create avatar, Discover, My agents, Notifications.
They are declared in `Info.plist` so they exist from install, and
[`QuickActions.swift`](native/App/App/QuickActions.swift) maps each type to its
page. The first three mirror the Android launcher shortcuts in
[`../solana-mobile/twa/twa-manifest.json`](../solana-mobile/twa/twa-manifest.json).

## CarPlay

The app carries a second scene for **three.ws Drive**, the agent in the car. Apple's
voice-based conversational category grants templates and an audio session and no drawing
surface, so the car screen shows four controls and the Voice Control template while the
phone's WebView runs `/drive` with the actual agent in it. The two are joined by the
`threeWsDrive` WebKit message channel.

It is inert without the `com.apple.developer.carplay-voice-based-conversation` entitlement,
which Apple grants per app on request, so nothing about the phone app changes before then.
Builds leave the key out unless released with `--carplay`, because signing fails on a key
the provisioning profile does not carry.
Read [`docs/CARPLAY.md`](docs/CARPLAY.md) before touching any of it, and
[`../docs/carplay.md`](../docs/carplay.md) for why the architecture is shaped this way.

## Why the WebView loads the live site

The alternative is baking `dist/` into the `.ipa` and serving it from
`capacitor://localhost`. That breaks the product: 733 call sites in `src/` fetch
same-origin `/api/...`, and the session cookie, the OAuth callbacks and the x402
payment headers are all issued for the `three.ws` origin. Rewriting every one of
them behind an API base is a larger and riskier change than shipping the app,
and it would fork the web and app code paths permanently.

What keeps this from being a bookmark (and from failing App Review guideline
4.2) is the native layer in `src/native-bridge.js` and the entitlements: share
sheet, universal links, wallet deep links, haptics, offline screen, and the
native permission prompts. Read [`docs/REVIEW-RISK.md`](docs/REVIEW-RISK.md)
before changing any of it; the crypto surfaces carry real rejection risk and
that document is where the reasoning lives.

`shell/` is still a real bundle: `shell/offline.html` is wired as
`server.errorPath`, so a launch with no network gets a designed screen that
polls `/api/healthz` and recovers on its own instead of the WebKit error page.

## The web-side half

`src/native-bridge.js` is loaded by the **site**, not the app: Capacitor injects
its bridge into the remote page at document start, so `window.Capacitor` exists
on `https://three.ws` whenever it is being viewed inside the app. The
`three-ws-ios-native-bridge` plugin in [`../vite.config.js`](../vite.config.js)
injects the module into every built page except the embed entries. It is a no-op
in every browser.

What it installs, and the breakage each one fixes:

| Shim | Without it |
|---|---|
| `navigator.share` / `canShare` over the native sheet | WKWebView has no Web Share API, so every share button on the platform silently does nothing |
| Off-site links to an in-app Safari sheet | A tap on an explorer link navigates the app's only WebView away from three.ws with no back button |
| `appUrlOpen` routing (universal links + `threews://`) | A wallet or OAuth redirect reopens the app on whatever page it was last showing |
| Splash hide on first paint | `launchAutoHide` fires on WebView load, minutes before a three.js scene renders |
| `html.ios-app` + safe-area custom properties | Install prompts render inside the installed app; bottom controls sit under the home indicator |
| Haptics on primary actions | No tactile feedback anywhere |
| Status-bar padding on the sticky header | The nav renders under the system clock: the site's own compensation is behind `@media (display-mode: standalone)`, which a WKWebView loading a remote URL never matches |
| 16px minimum on form fields | iOS zooms the page on focus and never zooms back out |
| Safari handoff for payments (`window.threeWsNative`) | Buying, launching, trading and paying run inside the app, which App Review rejects under guideline 3.1.1 |

### Payments open in Safari

Inside the app, anything that spends money hands off to Safari, signed in, on the
same page. A link to a payment page (`/launch`, `/credits`, `/pay` and the rest of
`HANDOFF_EXACT`), the agreements gate for a trade or launch, and every paid flow that
calls `leaveAppForPayment()` from
[`../src/shared/native-handoff.js`](../src/shared/native-handoff.js) show a
**Continue in Safari** sheet instead. Open in Safari mints a 60-second single-use code
at `POST /api/auth/handoff` and opens `GET /api/auth/handoff?code=...` in real Safari,
which signs Safari in and lands on the page. Wallet custody (deposit, withdraw,
claim) stays in the app. The policy, and how to add a surface, is in
[`docs/REVIEW-RISK.md`](docs/REVIEW-RISK.md).

## The native half

`native/App/App/MainViewController.swift` replaces Capacitor's stock bridge
controller. `SceneDelegate` builds the window in code, which overrides whatever
`Main.storyboard` names, so the scene delegate is what has to create it;
`npm run check:ios-app` fails if it ever goes back to the stock class. It
exists first for one thing JavaScript cannot do:

- **Edge-swipe back and forward.** `WKWebView` ships with them off, and iOS has
  no back button. Without this the app is a one-way trip: follow a link into a
  detail page and the only way out is killing the app.
- **Dark, edge-to-edge chrome.** The container, the WebView and its scroll view
  all take the product's `#080814` so there is no white flash behind a loading
  three.js scene and none at the edges of an over-scroll.
- **`contentInsetAdjustmentBehavior = .never`**, which is what makes
  `env(safe-area-inset-*)` non-zero inside the page. The padding the bridge
  installs has nothing to react to without it.

It also registers the app's own `ThreeWsApp` plugin in `capacitorDidLoad`
(the plugin is not a Swift package, so the SPM graph never discovers it) and
exposes `open(path:)`, which native entry points use to navigate the WebView
and which refuses anything that does not resolve to `https://three.ws`.

The app icon and launch images are generated, not hand-exported:

```bash
npm run ios:icons        # re-derive from public/pwa-512x512.png
npm run check:ios-icons  # verify the committed assets match (wired into `npm run gate`)
```

## Working on it

```bash
cd ios
npm install          # Capacitor CLI + plugins
npm run sync         # copy shell/ into the Xcode project, resolve plugins
npm run open         # open App.xcodeproj in Xcode (macOS only)
```

`npm run sync` works on Linux: Capacitor 8 resolves plugins through Swift Package
Manager, so there is no CocoaPods step and no macOS requirement for anything
except compiling, signing and uploading.

From the repo root:

```bash
npm run ios:sync     # same as the above, without changing directory
```

## Verifying without a Mac

`npm run check:ios-app` ([`../scripts/check-ios-app.mjs`](../scripts/check-ios-app.mjs),
wired into `npm run gate`) is what a Linux machine can prove about the Swift
half: every source is a member of a target, the share extension is embedded and
versioned with the app, the extension and the app agree on the App Group and
the `.glb` type, every quick action routes to a live page, the `ThreeWsApp`
plugin's methods match their web callers, both targets bundle a privacy
manifest covering every required-reason API they call, CarPlay stays out of
the default entitlements, every target shares one build number, and push is wired from the app
delegate to the notification fan-out. It is a structural check, not a build.
The web half is unit tested: `tests/ios-native-*.test.js`,
`tests/push-notifications-native.test.js`, `tests/share-target.test.js`,
`tests/apns.test.js`, `tests/push-device-endpoint.test.js`,
`tests/ios-safari-handoff.test.js` and `tests/auth-handoff.test.js`. The release
script's planning is tested in `tests/ios-release.test.js`, and
`npm run ios:release:dry` prints the exact commands a release would run.

## What is not wired yet

Everything here builds and runs; these are the pieces that need an Apple
Developer account before they can exist at all, listed so nobody rediscovers
them at submission time:

- **`APPLE_TEAM_ID`** on the Cloud Run service. `/.well-known/apple-app-site-association`
  ([`../api/wk.js`](../api/wk.js)) answers `503 not_configured` until it is set,
  and universal links keep opening in Safari until it serves a real association.
  Set it with `gcloud run services update three-ws-api --region us-central1 --update-env-vars APPLE_TEAM_ID=<id>`.
- **The APNs key.** Push is built end to end and dormant until `APNS_KEY_ID`
  and `APNS_AUTH_KEY` are set; see "Push notifications" above and
  [`docs/SUBMISSION.md`](docs/SUBMISSION.md).
- **Signing.** The team. Once it exists, `APPLE_TEAM_ID=<id> npm run ios:release`
  archives with automatic signing and uploads to TestFlight; Xcode Cloud works
  from the checked-in shared scheme and `ci_scripts/`. See
  [`docs/SUBMISSION.md`](docs/SUBMISSION.md).
- **Screenshots** for the listing, which have to be captured on a real device.
  Specs in [`docs/ASSETS.md`](docs/ASSETS.md).

Two findings that are decisions rather than missing work, both written up in
[`docs/REVIEW-RISK.md`](docs/REVIEW-RISK.md): the app currently has no service
workers (`limitsNavigationsToAppBoundDomains: false` disables them in
`WKWebView`, which is why the offline screen is native rather than the site's
own), and the set of surfaces that leave the app for Safari.

## Related

- Product doc: [`../docs/ios-app.md`](../docs/ios-app.md)
- Android / Seeker app: [`../solana-mobile/README.md`](../solana-mobile/README.md)
- Where everything lives: [`../STRUCTURE.md`](../STRUCTURE.md)
