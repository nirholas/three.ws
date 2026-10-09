# three.ws on iOS

three.ws ships to the App Store as a native iOS app (`ws.three.app`). Like the
[Seeker app](./seeker-app.md), it is a shell around the live web product rather
than a second implementation of it: a Capacitor 8 container whose WKWebView runs
`https://three.ws`, wrapped in the native layer a website cannot have. For a
WebGL product that is the right shape, and it means the app is never a version
behind the site. What makes it an app is everything around that shell.

This page is the user-facing map. Packaging, signing, App Review posture and the
submission checklist live in [`ios/README.md`](../ios/README.md).

**Status: in-repo, not yet submitted.** The Xcode project builds and the web
side is live in every deploy. What is outstanding is an Apple Developer
organization account and the APNs signing key that comes with it. See "What is
missing" below.

## What the app does differently from the website

| Surface | In the iOS app | Where it lives |
|---|---|---|
| Sharing out | The system share sheet, with AR captures attached as real image files | `ios/src/native-bridge.js` (`navigator.share` shim) |
| Sharing in | three.ws in every app's share sheet. One to three photos open the selfie-to-avatar flow as the front, left and right angles; a `.glb` from Files opens the upload flow | `ios/native/App/ShareExtension/`, `src/shared/share-target.js` |
| Push notifications | Sales, purchases, follows and every other notification you left push on for, delivered over APNs with the same preference center as the web. A tap opens the page it is about | `api/_lib/apns.js`, `api/push/device.js`, `src/push-notifications.js` |
| Icon badge | The home screen icon shows your unread count, and reading notifications in the app clears it | `ios/src/native-bridge.js`, `ThreeWsAppPlugin.swift` |
| Quick actions | Press and hold the icon: Create avatar, Discover, My agents, Notifications | `ios/native/App/App/QuickActions.swift`, `Info.plist` |
| Deep links | Any `https://three.ws/...` link opens in the app once the app association is live | `ios/native/App/App/App.entitlements`, `api/wk.js` |
| Wallet returns | A wallet or OAuth redirect comes back to the exact page that started it, over `threews://` | `ios/src/native-bridge.js` (`appUrlOpen`), `Info.plist` URL types |
| Off-site links | Open in an in-app Safari sheet and return, instead of navigating the app away with no way back | `ios/src/native-bridge.js` |
| Offline | A designed screen that polls `/api/healthz` and recovers on its own, instead of the WebKit error page | `ios/shell/offline.html`, `server.errorPath` |
| Camera, mic, photos, location, motion | Real iOS permission prompts with real usage strings, which is what `/create/selfie`, `/ar/studio` and `/irl` need on iOS | `ios/native/App/App/Info.plist` |
| Launch | The launch screen holds until the first real frame, so a three.js scene never opens onto a black void | `ios/src/native-bridge.js`, `SplashScreen` config |
| Haptics | A tick on primary and destructive actions, quiet on a disabled or busy one | `ios/src/native-bridge.js` |
| Back navigation | Edge-swipe back and forward, which `WKWebView` ships with off and iOS has no button for | `ios/native/App/App/MainViewController.swift` |
| Status bar | The sticky header clears the notch and the clock. The site's own compensation is behind `@media (display-mode: standalone)`, which a WebView loading a remote URL never matches | `ios/src/native-bridge.js` (injected stylesheet) |
| Forms | Fields never fall below 16px, so focusing one cannot zoom the page and strand it zoomed | `ios/src/native-bridge.js` |

## How the web half reaches the app

Capacitor injects its native bridge into the remote page at document start, so
`window.Capacitor` exists on `https://three.ws` whenever the site is being
viewed inside the app, and nowhere else. `ios/src/native-bridge.js` keys every
behaviour above off that, and ships with the **site**: the
`three-ws-ios-native-bridge` plugin in [`vite.config.js`](../vite.config.js)
copies it into `dist/` under a content-hashed name and injects a script tag into
every built page except the third-party embed entries.

Two consequences worth knowing:

- **App behaviour ships on a web deploy, not an App Store release.** Fixing the
  share sheet or adding a deep-link route is a normal deploy.
- **An old web deploy means an app with no native behaviour.** The app degrades
  to a plain WebView rather than breaking, but the shims are simply absent.

## Compared with the Android app

The [Seeker app](./seeker-app.md) is a Trusted Web Activity, so it inherits
Chrome's Web Push and the web manifest's share target and shortcuts. The iOS
WebView inherits none of those, so each one is rebuilt natively, and in two
places the iOS version goes further:

| | Android (Seeker, Play) | iOS |
|---|---|---|
| Launcher shortcuts | Create, Discover, My agents | The same three plus Notifications |
| Share into three.ws | Photos and `.glb` through the web share target | Photos and `.glb` through a share extension. HEIC photos are converted to JPEG on the phone before the page ever sees them |
| Push | Web Push through Chrome | APNs, with the unread count on the icon badge |
| Home screen widget | Agent glance | Agent glance, small, medium and large |
| Car | Android Auto | CarPlay (voice-based conversation) |
| Wallet sign-in | Seed Vault through Mobile Wallet Adapter | The site's wallet flows, with wallet and OAuth redirects returning to the page that started them over `threews://` |

## Turning on push

Push is off until you ask for it, the same as on the web: open the bell in the
header and tap **Turn on push**, or use the toggle in the notification
preferences. iOS then shows its permission prompt once. Behind the scenes the
app registers with Apple, sends the device token to `POST /api/push/device`,
and from then on every notification whose `push` channel is on in your
preferences arrives on the phone. Turning push off removes that one device and
leaves your other devices alone.

The app re-sends its token once per launch, because Apple can issue a new one
after a restore or an OS update. That refresh only succeeds for the account
that turned push on: if someone else signs in on the same phone, the device is
forgotten rather than moved to their account, and they get push only by
turning it on themselves.

## Sharing into the app

Share a photo from Photos, Camera or any other app and pick three.ws in the
share sheet. The sheet confirms the photo is ready; open three.ws and it is
waiting in Create as the front view of a selfie-to-avatar run. Two more photos
shared together fill the left and right angles. A `.glb` shared from Files
lands in the upload flow instead.

The extension cannot open the app on its own (Apple does not give share
extensions that ability), so the files wait in the app's shared container for
ten minutes and the app collects them the next time it comes forward. If you
have push turned on, the sheet also leaves a notification you can tap to go
straight there. A share is used once: reloading the page does not bring it back,
and anything not collected within a day is deleted.

## The app association

`GET /.well-known/apple-app-site-association` ([`api/wk.js`](../api/wk.js)) is
what tells iOS that three.ws links belong to the app, and that the login form
inside the app may offer a saved three.ws password. It is served from the API
rather than `public/.well-known/` because Apple requires an exact path, a JSON
content type, and no redirect.

The app identifier is `<Team ID>.ws.three.app`, and the Team ID comes from
`APPLE_TEAM_ID` on the Cloud Run service. Until that is set the endpoint answers
`503 not_configured` on purpose: publishing an association for a team that
cannot sign anything fails silently on device, where links just keep opening in
Safari and nothing errors.

```bash
curl -sS -D- https://three.ws/.well-known/apple-app-site-association
```

The `applinks` components hand every path to the app except `/api/*` (OAuth and
x402 callbacks must finish in the browser that started them) and the `/embed*`
and `/widget*` entries (they exist to render inside someone else's page).

## Payments open in Safari

App Review does not allow buying digital goods, launching coins or trading
inside an iOS app outside In-App Purchase (guidelines 3.1.1 and 3.1.5). So in
the app, every step that spends money shows a **Continue in Safari** sheet, and
Open in Safari carries the visitor to the same page in real Safari, still
signed in, through a 60-second single-use code
([`/api/auth/handoff`](./api-reference.md#session-handoff-to-safari-ios-app)).
Wallet custody (viewing, depositing, withdrawing, claiming) stays in the app.
Which surfaces leave, and why, is in
[`ios/docs/REVIEW-RISK.md`](../ios/docs/REVIEW-RISK.md).

## What is missing

- **`APPLE_TEAM_ID`**, which needs an Apple Developer Program account enrolled
  as an organization. Apple only permits wallet functionality from organization
  accounts, and that enrollment needs a legal entity and a D-U-N-S number.
- **The APNs signing key.** Push is built end to end: the device endpoint,
  the sender, the fan-out, the in-app enrolment and tap routing. It stays
  dormant (`nativePush.ios: false` in `/api/config`, so the app never offers
  it) until a `.p8` key from the same Apple Developer account is set on the
  Cloud Run service as `APNS_KEY_ID` and `APNS_AUTH_KEY`. Steps in
  [`ios/docs/SUBMISSION.md`](../ios/docs/SUBMISSION.md).
- **Listing screenshots**, which have to be captured on a real device. The icon
  and launch images are generated from the brand mark (`npm run ios:icons`) and
  a guard keeps them from drifting (`npm run check:ios-icons`).
- **A signed build.** Everything up to signing is in place: privacy manifests
  for the app and the share extension, a shared scheme, Xcode Cloud's
  `ci_scripts/`, and `npm run ios:release`, which archives with automatic
  signing and uploads to TestFlight in one command once `APPLE_TEAM_ID` exists.
  Steps in [`ios/docs/SUBMISSION.md`](../ios/docs/SUBMISSION.md).
- **Service workers**, which `WKWebView` runs only for app-bound domains. The
  app declares none, so the site's offline caching and share-target worker do
  not run inside it; the native offline screen covers the case that matters.
  Same doc has the trade.

## Related

- [three.ws on Solana Seeker](./seeker-app.md): the Android app
- [`ios/README.md`](../ios/README.md): building and shipping this one
- [`STRUCTURE.md`](../STRUCTURE.md): where every surface lives
