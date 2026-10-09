# Shipping three.ws to the App Store

End-to-end, in the order the steps actually unblock each other. Everything
before "On a Mac" can be done from this repo on any machine; everything after
needs macOS with Xcode, because Apple's code signing and `altool` upload path
exist nowhere else.

Read [`REVIEW-RISK.md`](REVIEW-RISK.md) first. Step 1 is the long pole and does
not depend on any code, so start it the day this is decided.

## 1. Apple Developer Program, enrolled as an organization

Not as an individual. Apple only allows crypto wallet functionality from
organization accounts, and three.ws has wallets everywhere.

- $99/yr, renewed annually.
- Needs a legal entity and a **D-U-N-S number** for that entity. Look it up at
  Apple's D-U-N-S lookup tool first; if the entity has one, enrollment is
  typically days. If it does not, requesting one is the step that can take a
  week or more, and nothing else can absorb that delay.
- The person enrolling must have legal authority to bind the entity, or provide
  documentation of authorization.

Record the **Team ID** (10 characters) the moment it exists: everything in
step 3 is blocked on it.

## 2. App Store Connect setup

1. Create the app record. Bundle ID `ws.three.app`, matching
   `PRODUCT_BUNDLE_IDENTIFIER` in `native/App/App.xcodeproj/project.pbxproj`
   and the `appId` in `capacitor.config.ts`.
2. Register the bundle ID in the Developer portal with the **Associated
   Domains**, **Push Notifications** and **App Groups** capabilities enabled;
   the app's entitlements declare all three and signing fails without them.
   Register `ws.three.app.share` (the share extension) and
   `ws.three.app.glance` (the widget) as well, each with **App Groups**, and
   create the group `group.ws.three.app`.
3. Fill the listing from [`../publish/listing.md`](../publish/listing.md).
4. Answer the content rights, age rating, and privacy questionnaires. The
   privacy answers must match what the app actually collects; the camera,
   photos, location and identifiers sections all apply.

## 3. Wire the Team ID into production

```bash
gcloud run services update three-ws-api \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --update-env-vars APPLE_TEAM_ID=<team id>
```

`--update-env-vars` merges. Never `--set-env-vars`, which replaces the whole
environment.

Then verify Apple can read the association, because a wrong answer here fails
silently on device and links simply keep opening in Safari:

```bash
curl -sS -D- -o- https://three.ws/.well-known/apple-app-site-association
```

It must be `200`, `content-type: application/json`, **no redirect**, and the
`appIDs` entry must read `<team id>.ws.three.app`.

## 3b. Turn on push

In the Developer portal, Keys, create a key with **Apple Push Notifications
service (APNs)** enabled. Download the `.p8` once (Apple never shows it again)
and note its Key ID. One key serves development and production builds.

Store the key in Secret Manager and point the service at it, the way every
other credential on the service is held:

```bash
gcloud secrets create apns-auth-key --project aerial-vehicle-466722-p5 \
  --data-file=AuthKey_<KEY_ID>.p8
gcloud run services update three-ws-api \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --update-secrets APNS_AUTH_KEY=apns-auth-key:latest \
  --update-env-vars APNS_KEY_ID=<KEY_ID>
```

The Team ID is read from `APPLE_TEAM_ID`, set in step 3. Confirm the server
now offers push to the app:

```bash
curl -s https://three.ws/api/config | jq .nativePush   # { "ios": true }
```

## 4. Build the web bundle

The app's WebView loads the deployed site, so "building the app" means the site
is deployed. The one build-time coupling is `src/native-bridge.js`, which is
injected into every page by the `three-ws-ios-native-bridge` plugin in
`vite.config.js`; a deploy that predates that plugin gives the app no native
behaviour at all. Confirm it landed:

```bash
grep -c native-bridge dist/create.html   # expect 1
```

Then sync the shell bundle into the Xcode project:

```bash
cd ios && npm install && npm run sync
```

## 5. On a Mac: archive, sign, upload

### Once per Mac: signing

```bash
cd ios && npm install && npm run open   # opens native/App/App.xcodeproj
```

Capacitor 8 resolves its plugins through Swift Package Manager, so there is no
`.xcworkspace` and no CocoaPods step: `App.xcodeproj` is the whole project.

1. Select the **App** target, Signing & Capabilities, choose the team. Confirm
   Associated Domains lists `applinks:three.ws` and Push Notifications is
   present; both come from `App/App.entitlements`. App Groups should list
   `group.ws.three.app` and Keychain Sharing `ws.three.shared`, which are what
   the Agent glance widget reads.
2. Select the **GlanceWidgetExtension** target and choose the same team. It
   needs the same App Group and Keychain Sharing entries; both expand from
   `DEVELOPMENT_TEAM`, so nothing else has to be typed. A build with no team on
   this target fails to sign the .appex and the archive is rejected.
3. Select the **ShareExtension** target and choose the same team. It needs
   only the App Group, which is where it parks shared photos and models for the
   app. Without the group the extension still appears in the share sheet but
   the app never finds what was shared.
4. Check the app icon per [`ASSETS.md`](ASSETS.md); `npm run check:ios-icons`
   at the repo root confirms the catalog is complete. Xcode rejects an archive
   with a missing icon.

Skip all four on a build Mac with no Xcode account by using an App Store
Connect API key instead (below): automatic signing then creates and fetches
the profiles itself.

### Every upload: one command

From the repo root:

```bash
APPLE_TEAM_ID=<team id> npm run ios:release
```

That is [`../scripts/release.mjs`](../scripts/release.mjs), and it runs, in
order:

1. `scripts/check-ios-app.mjs`, the structural check (targets, plugins, privacy
   manifests, entitlements, build settings). A red one is a build Apple would
   reject or a feature that is silently dead on device.
2. `npm ci` and `npx cap sync ios` in `ios/`, which write the gitignored
   `capacitor.config.json`, `config.xml` and shell bundle the archive copies.
   An archive made without them launches to a blank screen.
3. `xcodebuild archive`, Release, automatic signing for `APPLE_TEAM_ID`.
4. `xcodebuild -exportArchive` with an `ExportOptions.plist` it writes itself
   (method `app-store-connect`, destination `upload`), which sends the build
   straight to App Store Connect. No Transporter step.

The build number is the UTC time of the run, `YYMMDD.HMM` (for example
`261009.1907`), so it rises on every upload without anyone tracking the last
one. All three targets read it from the same build setting, which App Store
Connect requires of an app and its extensions.

| Flag | Effect |
|---|---|
| `--dry-run` | Validates everything, writes `ExportOptions.plist`, prints every command. Runs on Linux too: `APPLE_TEAM_ID=<team id> npm run ios:release:dry` |
| `--marketing-version 1.1` | Sets `CFBundleShortVersionString` for this build. Bump it for each App Store release; TestFlight builds can share one. |
| `--build-number N` | Overrides the timestamp build number. |
| `--export-only` | Writes the `.ipa` to `ios/native/App/build/export` instead of uploading. |
| `--skip-sync` | Skips `npm ci` and `cap sync`, for a rerun right after a sync. |
| `--carplay` | Signs with `App/App-CarPlay.entitlements`. Only after Apple grants the entitlement; see [`CARPLAY.md`](CARPLAY.md). |

For a build Mac with no Xcode account, create an App Store Connect API key
(Users and Access, Integrations, App Store Connect API, role **App Manager**),
download its `.p8` once, and set all three alongside the team id. They can live
in the repo-root `.env.local`, which the script reads and git ignores:

```bash
APPLE_TEAM_ID=<team id>
ASC_KEY_ID=<key id>
ASC_ISSUER_ID=<issuer id>
ASC_KEY_PATH=/path/to/AuthKey_<key id>.p8
```

Setting only some of the three fails before anything builds.

### Or: Xcode Cloud

The project is ready for it as checked in: the **App** scheme is shared
(`App.xcodeproj/xcshareddata`), so Xcode Cloud can see it, and
[`../native/App/ci_scripts/ci_post_clone.sh`](../native/App/ci_scripts/ci_post_clone.sh)
installs Node, runs the structural check and `cap sync` before the build.

In Xcode, Integrate, Create Workflow: product **App**, start condition on
`main` (or a `release/*` branch), action **Archive** for iOS, post-action
**TestFlight Internal Testing**. Xcode Cloud numbers builds itself. To sign a
cloud build with CarPlay once the grant exists, add the environment variable
`THREEWS_CARPLAY=1` to the workflow.

## 6. TestFlight, then review

- The first upload takes 15 to 60 minutes to finish processing before it is
  testable.
- Internal TestFlight testers need no review. External testers need a
  Beta App Review, usually a day.
- App Review itself is typically 24 to 48 hours for a first submission, and
  can be longer when a reviewer opens a question. Budget for at least one
  round trip: assume the first response is a question about the crypto
  surfaces and have the answer from [`REVIEW-RISK.md`](REVIEW-RISK.md) ready.

## Verification checklist before submitting

- [ ] `curl https://three.ws/.well-known/apple-app-site-association` returns a real association
- [ ] A shared `https://three.ws/viewer?src=...` link opens the app, not Safari
- [ ] Camera prompt appears on `/create/selfie` with the string from `Info.plist`
- [ ] Location prompt appears on `/irl`
- [ ] Share on an AR capture opens the system share sheet with the image attached
- [ ] Airplane mode at launch shows `shell/offline.html`, and it recovers by itself when the network returns
- [ ] An off-site link opens the Safari sheet and returns to the app
- [ ] Account deletion is reachable in-app (guideline 5.1.1)
- [ ] No white flash between launch screen and first paint
- [ ] Value-moving surfaces open in Safari, signed in, per `REVIEW-RISK.md`: tap Launch on `/create` or Buy credits on `/credits`, choose Open in Safari, and Safari lands on the same page under the same account
- [ ] Privacy answers in App Store Connect match `App/PrivacyInfo.xcprivacy` (see `../publish/listing.md`)
- [ ] `/api/auth/handoff` is live: `curl -sI 'https://three.ws/api/auth/handoff?next=%2Flaunch'` answers `302` with `location: https://three.ws/launch`
