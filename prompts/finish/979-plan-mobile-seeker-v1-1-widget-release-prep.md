# The Seeker app 1.1.0 (Agent glance widget) is built, signed, verified and staged so the owner's only step is the portal upload

**How to run:** paste this entire file into a fresh Claude Code chat opened in the three.ws repository (`/home/user/three.ws`) and send it. Nothing else is needed: everything this order depends on is in this file, including a verbatim copy of the planning docs it came from. It is safe to run on its own, in any order, and at the same time as any other work order. Its path in the repo is `prompts/finish/979-plan-mobile-seeker-v1-1-widget-release-prep.md`.

**Priority:** Gated, the last step needs an owner action or outside party (score 40 of 100 inside the tier). **Area:** mobile. **Written:** 2026-11-03, from a review of the planning corpus that read the source docs listed at the bottom and checked them against the code. Status claims rot, which is why Step 0 re-measures before you build anything.

## Operating clause (binding)

- Read `CLAUDE.md` at the repo root before anything else. It overrides this file wherever they disagree.
- Finish 100% in this session. Do not end the turn with a question, an option list, a plan, or "let me know". Make reasonable judgment calls, act on them, and note each in one line in the final report.
- The only permitted stops are the CLAUDE.md stop-and-ask gates: signing or sending a transaction, spending or moving funds, paying an x402 endpoint, minting or launching a coin; `git push`, production deploys, publishing or posting externally; committing content that references a crypto project other than $THREE; destroying data that cannot be regenerated. Do every other part of the work around a gate, and batch every such ask into one message at the end.
- Enterprise grade, no shortcuts. No mocks, no fake data, no placeholders, no sample arrays, no fake loading or progress, no unfinished-work markers, no stub functions, no commented-out code. Real APIs, real endpoints, real data. Errors are handled at the boundaries (network, user input) with a real recovery path.
- Bug fixes are test-first: write the test that reproduces the bug, watch it fail for the reported reason, fix the code, watch it pass, and commit the test with the fix.
- UI work meets the bar a senior design review would pass: hover, focus and active states on every interactive element, designed empty, error and loading (skeleton) states, keyboard accessible, works at phone width, and verified in a real browser.
- Solana is the home chain and leads every design. Robinhood means Robinhood Crypto only. $THREE (`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`) is the only promoted coin; tests and fixtures use it or a clearly synthetic placeholder, never a real third-party mint.
- Never write the em-dash or en-dash characters anywhere (code, docs, UI copy, commit messages). Use a period, comma, colon, parentheses, or a plain hyphen.
- Before writing any non-trivial feature or UI, load `.claude/skills/engineering-standards/SKILL.md`. Before claiming done, load `.claude/skills/changelog-and-docs/SKILL.md`.

## Running alongside other sessions

Many sessions may be working in this same worktree at once. Stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` immediately before each commit, re-read a file right before editing it, and commit your own finished work promptly. Never stash, reset, revert or reformat files you did not change. Start dev servers on a free port (`npx vite --port <free port> --strictPort`), not the default 3000, so you do not collide with another session.

## Why this matters

`ws.three.app` 1.0 is the Solana Seeker (dApp Store) and Play build of the TWA. Version 1.1.0 (versionCode 2) adds the Agent glance home screen widget. The manifest, release notes and widget code are already in the repo, but the README still says the release "ships once its API lane is deployed", the 29-line release checklist has no recorded results, and no signed 1.1.0 APK has been produced and verified from the stored keystore. The agent-doable half (build, verify, dry-run publish, truthful docs) is unfinished; the owner's half (portal credentials, release NFT) cannot complete until it is.

## Current state (measured by the reviewer on 2026-11-03; re-verify)

- `solana-mobile/twa/twa-manifest.json` has `appVersion` 1.1.0 and `appVersionCode` 2. `solana-mobile/publish/listing/new-in-version.txt` already describes the widget.
- Widget code lives under `solana-mobile/android-overlay/app/src/main/java/ws/three/` with a debug-only manifest at `android-overlay/app/src/debug/AndroidManifest.xml`. `solana-mobile/README.md` line 5 claims the API lane is not yet deployed.
- The API lane IS live: `api/glance/{mine,token,card,template}.js` exist, `GET https://three.ws/api/glance/mine?format=png` returns 200, `POST /api/glance/token` returns 401 unauthenticated (correct), and `https://three.ws/glance` returns 200. Tests exist: `tests/glance-png.test.js`, `glance-tokens.test.js`, `glance-card.test.js`, `glance-sw.test.js`.
- `https://three.ws/.well-known/assetlinks.json` is live for package `ws.three.app` with one SHA-256 fingerprint. `solana-mobile/twa/extra-fingerprints.json` holds extra signing keys (Play App Signing adds one later).
- `solana-mobile/docs/CHECKLIST.md` has 29 unchecked boxes: device checks (Seed Vault sheet, SIWS, resume, deep links, share target), portal prerequisites (publisher wallet funded, API key, release NFT), build/publish steps, and post-submit steps. None has a recorded result.
- Secret Manager holds `three-ws-seeker-release-keystore` and `three-ws-seeker-keystore-password`. `which java` works; `bubblewrap` and `apksigner` are not on the path in the sandbox.
- `scripts/publish.sh` supports `DAPP_STORE_DRYRUN=1` (prints the command without executing). It needs `SOLANA_KEYPAIR` and `DAPP_STORE_API_KEY`, neither of which an agent has.

## Step 0: re-derive the current state

Run these first. Skip any task whose outcome already exists, and say so in the report.

```bash
grep -n 'appVersion' solana-mobile/twa/twa-manifest.json
curl -s -o /dev/null -w '%{http_code}\n' 'https://three.ws/api/glance/mine?format=png'
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://three.ws/api/glance/token
curl -s https://three.ws/.well-known/assetlinks.json | head -c 300
gcloud secrets list --project aerial-vehicle-466722-p5 --filter="name~seeker" --format="value(name)"
grep -n 'API lane\|ships once' solana-mobile/README.md
ls solana-mobile/build 2>/dev/null
npx vitest run tests/glance-png.test.js tests/glance-tokens.test.js tests/glance-card.test.js
```

Skip anything already done and verified.

Before changing anything, also record the baseline so you can prove you broke nothing:

    git status --short | head -20
    git log --oneline -5
    npx vitest run 2>&1 | tail -8    # note the failing-file count; it is your baseline, not your job unless this order says so

## Tasks

1. Read `solana-mobile/scripts/build-apk.sh` and `scripts/setup-android-sdk.sh`. Install the Android SDK and Bubblewrap prerequisites the way those scripts prescribe (user-level, outside the repo). Fetch the keystore and password from Secret Manager into a temp directory with mode 0600 (`gcloud secrets versions access latest --secret three-ws-seeker-release-keystore`), never into the repo, and delete them at the end of the run.
2. Run `KEYSTORE_PASSWORD=... ./scripts/build-apk.sh` unattended and confirm it produces `build/three-ws-release.apk` with versionCode 2 (`aapt dump badging` or `apkanalyzer`). If it prompts interactively, fix the script so it cannot (CHECKLIST build section requires unattended runs). Add a small shell test or a vitest that runs `bash -n` on every script in `solana-mobile/scripts/`.
3. Verify the signing key matches the live Digital Asset Links file: `apksigner verify --print-certs build/three-ws-release.apk` and compare the SHA-256 against `https://three.ws/.well-known/assetlinks.json`. If they differ, update through `scripts/update-assetlinks.sh` (read it first; it edits the repo file, the deploy that ships it is the owner gate) and say so in the report.
4. Install on an emulator (the README documents the AVD flow and the debug variant for the widget loop). Run the five widget checks in `solana-mobile/README.md#The home screen widget` against the real production lane using a QA session token (the `self-unblock-playbook` skill has the QA login). Record pass/fail per check, including airplane-mode behaviour and force-stop persistence.
5. Walk `solana-mobile/docs/CHECKLIST.md`. For each item an agent can verify (emulator or script), tick it in the file with a one-line result and date. Leave device-only items (real Seeker Seed Vault sheet, Photos share target) unticked and move them to a short "Owner device checks" list at the top of the checklist so the owner sees exactly what remains. Never tick an item that was not observed.
6. Correct the stale docs: replace the "ships once its API lane is deployed" sentence in `solana-mobile/README.md` with the measured state; make sure `publish-play/listing/data-safety.md` discloses the widget's data flow (a revocable widget token stored on device, the card fetched every ~30 minutes, no extra data collected). Keep `publish/listing/*` and `publish-play/listing/*` consistent with each other.
7. Dry-run the release: `DAPP_STORE_DRYRUN=1 SOLANA_KEYPAIR=/dev/null DAPP_STORE_API_KEY=dry ./scripts/publish.sh` (read the script first so the dummy values are used only for the printed command, never sent). Confirm it refuses a reused versionCode and prints the exact upload command for APK 1.1.0.
8. Write `solana-mobile/RELEASE-1.1.0.md` only if no equivalent runbook exists: the exact owner commands (portal API key, keypair path, `./scripts/publish.sh`, then the Play Console upload steps from `publish-play/README.md`) in order, with the APK's SHA-256 and size. Add a `data/changelog.json` entry only after the owner confirms the store listing is live (the checklist's last item), not now.

## Definition of done

Every line must be verified with the actual command output or browser observation in front of you. Never claim a line you did not verify.

- [ ] `unzip -l solana-mobile/build/three-ws-release.apk | head` lists the file and `apkanalyzer manifest version-code` (or `aapt dump badging`) prints 2 and `ws.three.app`.
- [ ] The APK's signing SHA-256 equals the fingerprint in the live assetlinks.json (or the mismatch is documented and `update-assetlinks.sh` has been run).
- [ ] `grep -c '\- \[x\]' solana-mobile/docs/CHECKLIST.md` increased by the number of items verified, and each ticked line carries a result note; no tick without an observation.
- [ ] `grep -n 'ships once its API lane' solana-mobile/README.md` returns nothing.
- [ ] The DAPP_STORE_DRYRUN output is included in the report and shows the upload command with the 1.1.0 APK path.
- [ ] No keystore, password or API key exists anywhere under `/home/user/three.ws` (`git status` clean of such files; temp copies deleted).
- [ ] Every test you wrote or touched passes (`npx vitest run <those files>`; Playwright specs with `npx playwright test <spec>`). Bug fixes landed test-first: the new test failed before the fix for the reason the bug describes, and passes after.
- [ ] `npx vitest run` shows no new failing files compared with the Step 0 baseline.
- [ ] Any UI you changed was exercised in a real browser on a dev server (`npx vite --port <free port> --strictPort`): no console errors or warnings from your code, real network calls returning real data, and hover, focus, active, empty, error and loading (skeleton) states all designed and observed.
- [ ] `npm run check:rules -- --paths <every file you touched>` exits 0.
- [ ] Documentation is true: the feature doc or README describes what now exists, `STRUCTURE.md` has a row for any new surface or directory, a new page is in `data/pages.json`, and any user-visible change has a `data/changelog.json` entry followed by `npm run build:pages`. `npm run audit:docs` reports nothing new.
- [ ] You reviewed `git diff --staged` line by line before committing, and every changed line is justified.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No Android SDK or emulator image in the sandbox | Use `scripts/setup-android-sdk.sh`; if KVM is unavailable, build and verify the APK statically (aapt, apksigner, assetlinks match) and record the emulator checks as owner device checks. |
| Keystore secret fetch is denied | Use the `self-unblock-playbook` GCP row (the standing project access covers Secret Manager reads); read, never rotate or recreate it. |
| Production QA session unavailable for the widget loop | Use the debug variant against a local `npm run dev` server as the README describes, with a real QA token from the local API. |
| Bubblewrap needs interactive Android SDK licence acceptance | Pass the licences non-interactively as `setup-android-sdk.sh` does (`sdkmanager --licenses` with `yes`). |
| Missing credential or env var | Read it from the live Cloud Run service: `node scripts/read-service-env.mjs` (or `gcloud run services describe three-ws-api --region us-central1`). Never trust `vercel env pull`; it returns empty secrets. To set one key, use `gcloud run services update --update-env-vars`, never `--set-env-vars` (that replaces the whole set). Load `.claude/skills/self-unblock-playbook/SKILL.md` for the full table. |
| Database schema needed | Write the migration beside the existing ones, read `npm run db:status` first, and remember `npm run db:migrate` applies immediately with no dry run. |
| GCP resource, GPU, or quota | GCP spend for quality and reliability is pre-approved (project `aerial-vehicle-466722-p5`). Create what you need; never downgrade quality to save credits. Do not onboard a new paid third-party API without the owner. |
| Tests failing that you did not touch | Compare with your Step 0 baseline. Pre-existing failures are not yours to fix unless this order says so; report them in one line. Never delete or skip a test to get green. |
| A file changed under you | Another session edited it. Re-read it, keep their change, and apply yours on top. Never `git stash`, `git reset`, `git checkout -- <path>`, or revert work you did not write. |
| Upstream API down or rate-limited | Find the root cause, add a real fallback or retry with backoff, and keep going. Never ship fake data in its place. |

## Gates in this order

Stops before the owner's actions: the dApp Store publisher wallet keypair and portal API key (`publish.sh` without `DAPP_STORE_DRYRUN`), minting the release NFT (an on-chain action, recipient and cost to be shown first), and the Play Console upload. All such asks are batched into one message at the end.

## Close out (required)

1. Verify every Definition of done line with real output in front of you.
2. Commit with explicit paths and a message that describes the diff: `type(scope): what changed and why a reader would care`. Split unrelated changes into separate commits. If the diff references a crypto project other than $THREE, stop and ask the owner before that commit (CLAUDE.md commit gate).
3. If every Definition of done line passes, delete this work order in your final commit (`git rm prompts/finish/979-plan-mobile-seeker-v1-1-widget-release-prep.md`) and append one dated line to `prompts/finish/_context/plan-PROGRESS.md` (create it if missing): the date, `979-plan-mobile-seeker-v1-1-widget-release-prep.md`, the commit SHAs, and one sentence on what shipped.
4. If the last step belongs to the owner or an outside party, finish everything else, keep this file, add a dated "Status" paragraph directly under its title saying exactly what remains and who owns it, and append the same to `prompts/finish/_context/plan-PROGRESS.md`.
5. Never push or deploy unless the owner's message that started this session explicitly told you to. Leave the ship as one command (`git push threews main`, then `npm run deploy:gcp:full` per `.claude/skills/deploy-runbook/SKILL.md`) and name it in the report.

## Final report

Reply with, in this order and nothing else: what Step 0 measured; what you changed (files and commit SHAs); evidence for each Definition of done line; the one batched owner message, if any gate was hit; one line per judgment call. No trailing questions.

## Source material (verbatim)

The planning docs this order was derived from, copied on 2026-11-03 so this order stands alone even if they move or are deleted. Typography was normalized to the house style (dashes become hyphens, uppercase unfinished-work markers are lowercased, and a code comment that reads like a statement gets a trailing period so the repo lint does not mistake it for commented-out code); nothing else was changed. Where a source still exists, the live file may be newer: re-read it, and trust the code over both.

### `solana-mobile/README.md` (whole file)

~~~~markdown
# `solana-mobile/`: the three.ws Android app

Everything needed to package three.ws as an Android app and publish it: the Mobile Wallet Adapter (MWA) wallet that signs through the on-device Seed Vault, the Trusted Web Activity (TWA) wrapper, the release pipeline, and the listing copy for both stores.

**Next: v1.1.0 (versionCode 2) adds the Agent glance home screen widget** ([../docs/native-widgets.md](../docs/native-widgets.md)); it is built and emulator-verified (2026-08-29) and ships once its API lane is deployed.

**Status: v1.0.0 approved and live on the Solana dApp Store** (submitted 2026-08-28, approved 2026-09-01) (release `#331044442814`, versionCode 1). The reviewed bytes are the `v1.0.0` GitHub release. Identifiers and what the portal recorded: [../docs/seeker-submission-day.md](../docs/seeker-submission-day.md).

**One package id, two channels.** `ws.three.app` ships to the Solana dApp Store (Seeker and Saga, listing copy in `publish/`) and to Google Play (every Android phone, listing copy and submission runbook in [`publish-play/`](publish-play/README.md)). Same build, same app, two store listings that must describe the same product. The Play path has one trap with no local symptom, and it is documented in `publish-play/README.md` step 6: Play re-signs the bundle with Google's own key, so Google's certificate fingerprint has to be added to `twa/extra-fingerprints.json` or every Play install loses full-screen mode.

## Layout

```
solana-mobile/
├── twa/twa-manifest.json     # Bubblewrap input: wraps three.ws as an Android TWA
├── well-known/               # assetlinks.json template (real file: /public/.well-known/)
├── src/                      # MWA wallet wrapper (drop-in for the existing Solana code)
│   ├── seeker-detect.js      #   TWA/Seeker detection + isMwaSupported() capability probe
│   ├── mwa-wallet.js         #   Phantom-shaped wallet backed by the on-device Seed Vault
│   ├── mwa-errors.js         #   normalizes MWA errors (user decline -> code 4001)
│   ├── index.js              #   single-import boot; sets window.solana when on Seeker
│   └── package.json          #   declares MWA peer/runtime deps
│   └── extra-fingerprints.json # certificates OTHER than our keystore that may sign the app
├── scripts/
│   ├── setup-android-sdk.sh  # headless machines: stage JDK 17 + Android SDK for Bubblewrap
│   ├── build-apk.sh          # generate keystore (if needed), build + sign release APK
│   ├── assetlinks.mjs        # build the Digital Asset Links file from every signing certificate
│   ├── make-media.mjs        # generate icon/banner/feature listing assets from the live product
│   ├── update-assetlinks.sh  # refresh /public/.well-known/assetlinks.json from the keystore
│   └── publish.sh            # upload the APK to the Publisher Portal (dapp-store-cli 1.x)
├── publish/                  # Solana dApp Store: Publisher Portal worksheet + listing + media
│   ├── config.yaml           #   every value the owner enters in the portal, in one place
│   ├── listing/              #   description, short description, what's new, Seeker features
│   └── media/                #   icon, banner, feature graphic (screenshots need a real Seeker)
├── publish-play/             # Google Play: submission runbook, worksheet, listing, declarations
│   ├── README.md             #   the account-type decision that sets the timeline, then the steps
│   ├── config.yaml           #   every value the owner enters in Play Console
│   └── listing/              #   title/short/full copy, data safety, content rating, financial features
└── docs/
    ├── ASSETS.md             # exact pixel specs for icon/banner/screenshots
    ├── CHECKLIST.md          # end-to-end submission checklist with verification dates
    └── INTEGRATION.md        # how the wallet is wired into the three.ws bundle
```

The web manifest is NOT duplicated here: the live one is generated by `vite-plugin-pwa` from `vite.config.js` (`webManifestUrl` in `twa/twa-manifest.json` points at it). The app-only surfaces live with the rest of the site:

- `/seeker` (`pages/seeker.html`, `src/seeker.js`): the TWA's start URL. One-tap Seed Vault sign-in, Create / Explore grid, the owner's agents, and Seeker Genesis Token verification.
- Share target: `public/share-target-sw.js` handles `POST /create/share` from the Android share sheet; `src/shared/share-target.js` hands the file to `/create/selfie` (photos) or `/create` (GLB). The APK registers the same target through `shareTarget` in `twa/twa-manifest.json` (MIME types only; Android rejects file extensions there).
- Offline: `public/offline.html` is precached and served by the workbox `precacheFallback` rule in `vite.config.js` when a navigation fails.
- Icons: `public/pwa-maskable-*.png` keep the glyph inside Android's safe zone; `build-apk.sh` serves `public/` locally during the build so the APK embeds this commit's icons rather than whatever the last deploy shipped.
- Seeker verification API: `api/seeker/[action].js`, documented in `docs/api-reference.md`. Product doc: `docs/seeker-app.md`.

## How the wallet works

The MWA wallet is already wired into the bundle: `src/wallet.js` and `src/game/play-auth.js` import `solana-mobile/src/index.js`, and `@solana-mobile/mobile-wallet-adapter-protocol-web3js` is a root dependency. Inside the TWA the import installs an `MwaWallet` at `window.threeWsWallet` (mirrored onto `window.solana`); everywhere else it is a no-op. `src/onchain/adapters/solana.js` uses the Seed Vault's one-tap Sign-In With Solana (`signIn()`) for wallet linking and falls back to the two-step `signMessage` flow on injected wallets.

The MWA auth token is persisted in `localStorage` (with a `sessionStorage` fallback), so a session survives Android killing the backgrounded TWA process: the next signature is a silent `reauthorize`, not a new Seed Vault prompt. A token the wallet has revoked is dropped on the first failed `reauthorize` and the wallet emits `disconnect`. The wrapper is unit-tested against a fake transport:

```bash
npx vitest run tests/solana-mobile-mwa-wallet.test.js \
  tests/solana-mobile-mwa-errors.test.js tests/solana-mobile-seeker-detect.test.js
```

Details: `docs/INTEGRATION.md`.

## Release pipeline

The full runbook, including the Publisher Portal steps the owner does once, is [docs/seeker-publishing.md](../docs/seeker-publishing.md). The short version:

Publishing is Publisher Portal backed (dapp-store-cli 1.0, May 2026). The publisher profile, KYC, the App NFT, and the listing live in <https://publish.solanamobile.com>; the CLI only uploads one signed APK per release and the portal matches it to the app by package name (`ws.three.app`).

```bash
cd solana-mobile

# 0. Headless machine (codespace/container) with no Android toolchain yet:
#    stages JDK 17 + Android SDK under ~/.bubblewrap. Idempotent.
./scripts/setup-android-sdk.sh

# 1. Restore the release keystore (it is gitignored). Both halves live in
#    Secret Manager since 2026-08-27; the password also sits in .env as
#    SOLANA_MOBILE_KEYSTORE_PASSWORD. Losing this key means the app can never
#    be updated, so never generate a second one while this one exists.
gcloud secrets versions access latest --secret three-ws-seeker-release-keystore \
  --project aerial-vehicle-466722-p5 | base64 -d > android.keystore
export SOLANA_MOBILE_KEYSTORE_PASSWORD="$(gcloud secrets versions access latest \
  --secret three-ws-seeker-keystore-password --project aerial-vehicle-466722-p5)"

# 2. Build the signed APK. Also writes /public/.well-known/assetlinks.json
#    with the key's fingerprint (98:0A:1A:AB:...:11:13:D7).
KEYSTORE_PASSWORD="$SOLANA_MOBILE_KEYSTORE_PASSWORD" ACCEPT_ANDROID_SDK_LICENSES=1 ./scripts/build-apk.sh

# 3. Deploy three.ws so assetlinks.json is live (npm run deploy:gcp from the
#    repo root; production is Cloud Run), then confirm Google sees it:
curl -fsSL https://three.ws/.well-known/assetlinks.json | jq .
curl -fsSL 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://three.ws&relation=delegate_permission/common.handle_all_urls'

# 4. First release only, in the portal (owner): create the publisher profile,
#    pass KYC/KYB, "Add a dApp" using publish/config.yaml + publish/listing/ +
#    publish/media/, mint the App NFT (~0.2 SOL in the publisher wallet), and
#    create an API key under Settings > API keys.

# 5. Submit the release.
SOLANA_KEYPAIR=~/.config/solana/publisher.json \
DAPP_STORE_API_KEY='portal-api-key' \
./scripts/publish.sh
```

For later releases, bump `appVersionCode` / `appVersion` in `twa/twa-manifest.json` (or pass `VERSION_CODE` / `VERSION_NAME`), then repeat steps 2 and 5. `publish.sh` refuses to re-submit a versionCode it already shipped from the same machine. Releases are run locally by the owner; this repo does not use GitHub Actions.

## Emulator QA

Everything except the Seed Vault itself can be verified in a stock emulator; this is how the 2026-08-27 build was checked.

```bash
# One-time: emulator, platform tools, and an Android 14 image (KVM needed: sudo chmod 666 /dev/kvm in a codespace).
SDK=~/.bubblewrap/android_sdk/cmdline-tools
$SDK/bin/sdkmanager --sdk_root=$SDK "platform-tools" "emulator" "build-tools;34.0.0" "system-images;android-34;google_apis;x86_64"
echo no | $SDK/bin/avdmanager create avd -n seeker -k "system-images;android-34;google_apis;x86_64" -d pixel_7
# The SDK root is the cmdline-tools dir, so fix the image path avdmanager writes:
sed -i 's#^image.sysdir.1=.*#image.sysdir.1=system-images/android-34/google_apis/x86_64/#' ~/.android/avd/seeker.avd/config.ini
ANDROID_SDK_ROOT=$SDK $SDK/emulator/emulator -avd seeker -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect &

adb install -r build/three-ws-release.apk
adb shell am start -n ws.three.app/.LauncherActivity        # first launch shows Chrome's welcome sheet once
adb shell dumpsys shortcut | grep -A40 "Package: ws.three.app" | grep shortLabel
adb shell pm get-app-links ws.three.app                     # state 1 after assetlinks.json is live for this key
adb push ../public/pwa-512x512.png /sdcard/Download/selfie.png
adb shell am start -a android.intent.action.SEND -t image/png \
  --eu android.intent.extra.STREAM file:///sdcard/Download/selfie.png -n ws.three.app/.LauncherActivity --grant-read-uri-permission
adb exec-out screencap -p > shot.png
```

Until the commit that adds `/seeker` and the share handler is deployed, the emulator opens production and shows the site's 404 for both; that is the deploy gate, not an app bug.

### The home screen widget

The release APK fetches its card from `https://three.ws`, so a widget in a release build shows "Fetching your agent" until `/api/glance/mine?format=png` is deployed. To exercise the whole loop against a local server before that, build the debug variant of the same overlaid project (only the debug variant allows plain http and honours the `origin` override; see `android-overlay/app/src/debug/AndroidManifest.xml`) and link it with a real token:

```bash
# After scripts/build-apk.sh (which applies android-overlay/ to build/):
(cd build && JAVA_HOME=~/.bubblewrap/jdk/jdk-17.0.20.1+1 ./gradlew assembleDebug -q)
adb install -r build/app/build/outputs/apk/debug/app-debug.apk

# A local API on :8080 (from the repo root: PORT=8080 node --env-file=.env --env-file=.env.local server/index.mjs),
# a session for the QA account, and a widget token from it:
TOKEN=$(curl -s -c /tmp/j -H 'content-type: application/json' -H 'origin: https://three.ws' \
  -d "{\"email\":\"$AUDIT_EMAIL\",\"password\":\"$AUDIT_PASSWORD\"}" http://127.0.0.1:8080/api/auth/login >/dev/null && \
  curl -s -b /tmp/j -H 'content-type: application/json' -H 'origin: https://three.ws' \
  -d '{"platform":"android","label":"emulator"}' http://127.0.0.1:8080/api/glance/token | jq -r .token)

# Link the widget (the inner quotes keep the & away from the emulator's shell) and accept the launcher's pin dialog:
adb shell am start -a android.intent.action.VIEW -d "'threews://glance/link?token=$TOKEN&origin=http://10.0.2.2:8080'"
adb shell uiautomator dump /sdcard/ui.xml && adb shell cat /sdcard/ui.xml | grep -o 'text="Add to home screen"[^>]*bounds="[^"]*"'   # then `adb shell input tap` inside those bounds

# The five checks (the widget lands on home screen page 2; `input swipe 900 1200 200 1200 300` gets there):
adb logcat -d | grep WM-WorkerWrapper                                   # SUCCESS: refreshed with no app UI open
adb shell run-as ws.three.app ls -la files/glance                        # the cached bitmap per size
adb shell am force-stop ws.three.app                                     # widget keeps its card
adb shell cmd connectivity airplane-mode enable                          # then tap "Updated …" on the widget: footer says "(offline)", card stays
adb reboot && adb wait-for-device                                        # widget comes back with its card
```

`uiautomator dump` is the reliable way to read the widget's state headless: the card `ImageView` carries a content description of "<agent name>, <metric>" and the footer `TextView` (`ws.three.app:id/glance_updated`) carries the refresh time.

## What still needs a physical Seeker

Listing media is no longer on that list. Everything the portal asks for is generated and checked in under `publish/media/`: `npm run build:dapp-store-media` writes the icon, banner, feature graphic, and the 1200x1200 Editor's Choice card, and `npm run build:dapp-store-previews` builds the five 1080x1920 previews as one carousel (see `docs/ASSETS.md`). Real Seeker captures dropped into `publish/media/device/` replace the browser ones and the carousel rebuilds around them.

- **Device smoke** (install, Seed Vault sheet, suspend/resume, deep links): section 3, 4, and 9 of `docs/CHECKLIST.md`.
- **Promo video**: optional; `publish/media/video.mp4` if ever added.

Privacy policy and EULA are content of the main site and are live at `/legal/privacy` and `/legal/eula`.

## See also

- `docs/CHECKLIST.md`: the only doc you need open during submission.
- `docs/INTEGRATION.md`: how the wallet is wired and how it fails.
- `docs/ASSETS.md`: pixel specs and capture instructions.
- Solana Mobile: <https://docs.solanamobile.com/dapp-store/publishing-cli> and <https://docs.solanamobile.com/dapp-store/submit-new-app>
~~~~

### `solana-mobile/docs/CHECKLIST.md` (whole file)

~~~~markdown
# Seeker dApp Store submission checklist

Work top-to-bottom. Do not submit until every box is checked. A date after a box is when it was last verified against production; re-verify anything older than the current release.

## 1. Web app readiness (three.ws itself)

- [x] `https://three.ws/manifest.webmanifest` returns 200 with `Content-Type: application/manifest+json`. (verified 2026-08-27)
- [x] `/pwa-192x192.png`, `/pwa-512x512.png`, and `/pwa-icon.svg` return 200 with the right image type. (verified 2026-08-27)
- [x] The three TWA shortcuts resolve: `/create`, `/marketplace`, `/my-agents` all return 200. (verified 2026-08-27; `/my-agents` replaced the public `/agents` index)
- [x] Nothing blocks a TWA: the root sends no `X-Frame-Options`, and CSP `frame-ancestors` is irrelevant to a TWA (it is not an iframe). (verified 2026-08-27)
- [x] Service worker registered and ACTIVE inside the app (`navigator.serviceWorker.getRegistration()` reports an active worker scoped to `https://three.ws/`, read over Chrome DevTools inside the running TWA, 2026-08-28).
- [ ] Chrome on Android offers "Add to Home screen" and the result opens standalone (device check).
- [x] `start_url` is `/seeker?utm_source=seeker_app` and renders inside the app with no console errors (emulator, 2026-08-28; profiled cold at Pixel 5 / slow 4G: LCP 1.5 s, CLS 0.003, 546 KB).

## 2. Digital Asset Links (DAL)

- [x] `scripts/build-apk.sh` has been run so the SHA-256 fingerprint is known. (2026-08-10; keystore at `solana-mobile/android.keystore`, password in `.env` `SOLANA_MOBILE_KEYSTORE_PASSWORD`; on a fresh headless machine run `scripts/setup-android-sdk.sh` first)
- [x] `public/.well-known/assetlinks.json` contains the real fingerprint (no `{{RELEASE_SHA256}}` placeholder) and is on `main`. (2026-08-10)
- [x] `https://three.ws/.well-known/assetlinks.json` returns 200 as `application/json` AND carries the 2026-08-27 fingerprint `98:0A:...:13:D7`. (verified live 2026-08-28)
- [x] Google's statement list confirms the new key: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://three.ws&relation=delegate_permission/common.handle_all_urls` returns `98:0A:...:13:D7` and nothing else. (verified 2026-08-28) On a device, follow with `adb shell pm verify-app-links --re-verify ws.three.app`.
- [x] `cache-control` on `assetlinks.json` is at most one hour: the live response reads `max-age=3600, public`. (re-verified against the live site 2026-08-28, after the deploy and CDN purge)

## 3. APK build

- [x] Release keystore is backed up offsite. The 2026-08-10 keystore was lost with its codespace (never backed up), so a NEW key was generated 2026-08-27 and stored in Secret Manager (`three-ws-seeker-release-keystore`, base64, and `three-ws-seeker-keystore-password`, project `aerial-vehicle-466722-p5`; round trip verified by sha256). Nothing was ever published under the old key. Never generate another.
- [x] `build/three-ws-release.apk` was produced by `scripts/build-apk.sh` and is signed. (2026-08-27, 4.1 MB, versionCode 1, targetSdk 36; `build/` is gitignored, so rebuild on the release machine)
- [x] `apksigner verify --print-certs` prints the SHA-256 that is in `assetlinks.json`. (verified 2026-08-27: `98:0A:1A:AB:...:11:13:D7`)
- [x] APK installs and launches FULL-SCREEN on Android 14 (Pixel 7 emulator, 2026-08-28): once the deploy carried the new assetlinks and Chrome's cached verification was cleared (`pm clear com.android.chrome`), the app opens straight onto `/seeker` with no address bar and no custom-tab chrome.
- [ ] App icon, name, and splash colors match brand on a real launcher (`three.ws`, `#080814` background, `#000000` theme).
- [x] Long-press shortcuts Create / Discover / My agents are registered in the installed APK (`dumpsys shortcut`, 2026-08-27); each opens inside the app once DAL verifies.
- [x] The Android share sheet target is registered and baked into the APK: `LauncherActivity` carries the `SEND`/`SEND_MULTIPLE` filter for `text/plain`, `image/jpeg`, `image/png`, `image/webp`, `model/gltf-binary`, and the `METADATA_SHARE_TARGET` resource holds the `/create/share` POST config. (read back from the installed package, 2026-08-28. Bubblewrap rejects a file extension in `accept`, so `.glb` was dropped and `model/gltf-binary` carries GLB.)

## 4. MWA integration

- [x] Wrapper logic is unit-tested against a fake transport (`npx vitest run tests/solana-mobile-mwa-*.test.js tests/solana-mobile-seeker-detect.test.js`): authorize/resume, one-tap `signIn`, sign/send, error normalization, disconnect, session persistence across process death, revoked-token reset, detection boundaries. (49 tests green 2026-08-27)
- [x] `solana-mobile/src/index.js` is imported from the app entry points (`src/wallet.js`, `src/game/play-auth.js`). (verified 2026-08-27)
- [x] Emulator run against Solana Mobile's reference wallet: connect returns a real public key through the on-device flow; icon format and sign/send response shapes fixed. (2026-08, see the changelog)
- [x] `window.threeWsWallet` is defined and `isSolanaMobileTwa()` is true inside the app, INCLUDING on later in-app navigations (the detector now remembers the app entry signal; before that fix `/login` inside the app reported "No Solana wallet detected"). Verified over DevTools in the emulator, 2026-08-28.
- [x] The MWA association reaches a wallet: with Solana Mobile's reference wallet (`fakewallet`) installed, tapping Solana sign-in launches `solana-wallet:` and the wallet reports "Session active, awaiting requests from dApp". (emulator, 2026-08-28. The handshake does not finish there because Chrome 113's unverified-intent interstitial pops the tab back one history entry; that interstitial does not appear for a verified TWA on current Chrome, so completing it needs the device.)
- [ ] First sign-in triggers the Seed Vault sheet (no Phantom/Solflare prompts).
- [ ] One-tap SIWS: wallet linking shows a SINGLE Seed Vault sheet, and `/api/auth/siws/verify` accepts the wallet-built message.
- [ ] `signMessage` (two-step fallback) produces a signature `/api/auth/siws/verify` accepts.
- [ ] `signAndSendTransaction` lands on mainnet (test with a 0-lamport memo tx before any deploy flow).
- [ ] Session survives suspend/resume AND a forced stop of the app (Settings > Apps > three.ws > Force stop, relaunch, sign again: no second prompt). The token now lives in `localStorage`.
- [ ] A cancelled Seed Vault sheet surfaces as a clean "cancelled" state (`code 4001` / `reason USER_REJECTED`), not a generic failure.
- [ ] `disconnect()` removes the linked wallet from local state.

## 5. Listing copy (entered in the Publisher Portal)

- [x] `publish/listing/description.md` describes only features that exist in the app: selfie (one frontal + two optional angles) to rigged avatar, text and GLB creation, chat, marketplace, Metaplex Core deploy, USDC skills/tips, embeds, Seed Vault SIWS. (rewritten 2026-08-27)
- [x] `publish/listing/new-in-version.txt` reflects this exact build, no "coming soon". (2026-08-27)
- [x] `publish/listing/saga-features.md` cites Seed Vault signing, camera capture, and deep links / shortcuts, each verifiable in the APK. The earlier Web Share Target claim was removed: the live manifest declares none. (2026-08-27)
- [x] No third-party vendor names in the copy or media. (2026-08-27)
- [ ] The text in the portal matches the files in `publish/listing/` byte for byte (copy from git, not from memory).

## 6. Publisher Portal (owner, one-time)

- [x] Publisher profile created at <https://publish.solanamobile.com> as an Organization, KYB submitted 2026-08-27 and **Approved** (name `three.ws`, website `https://three.ws`). Confirmed in the portal 2026-08-28.
- [ ] Publisher wallet connected (Phantom/Solflare/Backpack extension) and funded with at least 0.2 SOL for the App NFT, release NFT, and Arweave uploads.
- [ ] Storage provider chosen (ArDrive recommended).
- [ ] "Add a dApp" completed with `publish/config.yaml` values, `publish/listing/`, and `publish/media/` (all eight images); App NFT minted.
- [ ] API key created under Settings > API keys and stored in the owner's password manager (never in the repo).
- [ ] The publisher wallet's keypair file is available to `scripts/publish.sh` as `SOLANA_KEYPAIR` and backed up offsite.

## 7. Policy compliance

- [x] Privacy policy is live at `https://three.ws/legal/privacy` and EULA at `https://three.ws/legal/eula`. (both 200 on 2026-08-27)
- [ ] Privacy policy discloses wallet address collection (re-read before submitting).
- [x] No US-restricted activities (gambling, securities offerings, derivatives) in the copy. (2026-08-27)
- [x] Payment flows use SOL/USDC on-chain; no fiat onramp is surfaced inside the app. (2026-08-27)
- [ ] Camera permission shows a visible justification at first prompt (device check on `/create/selfie`).
- [x] A wallet rejection (`USER_REJECTED`) is handled without crashing: `src/wallet.js` swallows it with no toast, everything else gets a retry toast. (unit + code review 2026-08-27)

## 7b. Home screen widget (1.1+)

- [x] `build-apk.sh` printed `[apply-overlay] overlay applied` before `bubblewrap build` (2026-08-29, versionCode 2, 1.1.0, 4.4 MB, same release key `98:0A:1A:AB:…:11:13:D7`); a build without that line has no widget and must not ship.
- [x] `aapt dump badging build/three-ws-release.apk` lists `ws.three.app.glance.GlanceWidget` as a receiver and `uses-permission: android.permission.INTERNET` (2026-08-29, read back from the R8-minified release APK).
- [x] Emulator (Pixel 7, Android 14, 2026-08-29): the release APK registers **Agent glance** with the launcher (`dumpsys appwidget`), the link intent opens the pin dialog and places a 3x2 instance, and WorkManager runs the refresh with no app UI open. The debug variant against a local API with a real token then passed all five checks: card downloaded and painted (content description "My First Agent, 0 Moves today"), refreshed without opening the app, kept after `am force-stop`, back after `adb reboot`, and held with a "From 5:38 AM (offline). Tap to retry." footer in airplane mode, refreshing again once it was off. Recipe: `README.md#the-home-screen-widget`.
- [x] `/api/glance/mine?format=png` and `/api/glance/token` are deployed before the APK is published; the widget shows "Fetching your agent" until they are. (Live in production as of 2026-09-03: `mine?format=png` answers `200 image/png` with `x-glance-state: signed-out` unauthenticated, `token` answers `401` without a session, and a real mint against the QA account returned a working token that fetched every card size.)

## 8. Repeat builds

- [ ] `KEYSTORE_PASSWORD=... ./scripts/build-apk.sh` runs end-to-end unattended on the release machine (no interactive prompts).
- [ ] Keystore path and password live in the owner's password manager, not in the repo.
- [ ] `appVersionCode` was bumped in `twa/twa-manifest.json` (or via `VERSION_CODE`); the dApp Store rejects a re-used versionCode, and `scripts/publish.sh` refuses one it already shipped.
- [ ] `scripts/publish.sh` completes with the publisher wallet's keypair and the portal API key.

## 9. Pre-submit smoke (real Seeker)

- [ ] Fresh install: onboarding to a deployed agent takes under 3 minutes.
- [ ] Camera capture under poor lighting degrades gracefully (the quality gates in `src/selfie-gates.js` explain what to fix; no infinite spinner).
- [ ] Airplane mode: the app shows a clear network error, not a broken white page.
- [ ] Deep links (`https://three.ws/agents/...`) open inside the app, not in Chrome. (App-link state is `verified` on the emulator, so this should hold; confirm on the device.)
- [ ] Share a photo from the device's Photos app into three.ws and confirm it lands in `/create/selfie` already attached, then share a `.glb` and confirm it lands in `/create`. This CANNOT be verified over adb: `am start --grant-read-uri-permission` cannot confer a MediaStore URI grant, so android-browser-helper's re-grant to Chrome throws `SecurityException: UID does not have permission to content://media/...` before the web layer runs (observed 2026-08-28). A real sharing app grants the URI first. The web half is covered by `tests/share-target.test.js` and by the live `POST /create/share` fallback answering 303 to `/create?shared=nosw`.
- [x] Five 1080x1920 previews built and committed to `publish/media/` (2026-08-28). They are one 5400x1920 carousel sliced into five, so upload them in numbered order; see `docs/ASSETS.md`. Optional upgrade: drop real Seeker captures into `publish/media/device/` and rerun `npm run build:dapp-store-previews`.

## 10. Post-submission

- [x] Submitted 2026-08-28: v1.0.0 (versionCode 1), release `#331044442814`, In Review. Release NFT `25YeiFrv…khvcDDhQ` in app collection `GHJv3tR6…LUJSzTnD`, mint tx `3aCYSrDe…1gxSDdZj`, APK uploaded by URL from the `v1.0.0` GitHub release. Full record: `docs/seeker-submission-day.md`.

- [ ] Review results arrive by email from `publishersupport@dappstore.solanamobile.com` within 3-5 business days; watch the portal dashboard.
- [ ] On approval, verify the store listing renders all five screenshots and the feature graphic.
- [ ] Add a `data/changelog.json` entry announcing the store listing with its link.
~~~~

### `solana-mobile/publish-play/listing/data-safety.md` (whole file)

~~~~markdown
# Data safety form answers

Play Console > App content > Data safety. Google cross-checks these answers against the
privacy policy at <https://three.ws/legal/privacy>, and a mismatch is a rejection, so change
both together or neither.

Terms used below are Play's, not ours. **Collected** means the data leaves the device to our
servers. **Shared** means it is transferred to a third party. **Processed ephemerally** means
it is used to service the request and not retained.

## Blocking issue before this form can be submitted

**The live privacy policy does not mention photo or camera data at all.** It documents account
identifiers, uploaded 3D models, on-chain data, usage data, session data and legal acceptance
records (version 2, effective July 16, 2026), and the selfie capture flow predates none of
that: it is simply missing. The declaration below says photos are collected and retained,
because `api/_lib/likeness-store.js` reads capture URLs back out of the stored generation
params, so they persist. A Data safety form that declares photo collection against a privacy
policy that is silent on photos is exactly the mismatch Google rejects.

Draft clause for the owner to review and publish before either store submission. It states
what the code already does and adds no new commitment:

> **Photos you capture or upload.** If you use the selfie flow, the photos you capture (one
> frontal image and up to two optional side angles) are uploaded to our reconstruction service
> and used to build your 3D avatar. They are stored with the generation record so the result
> can be reproduced, re-rigged and re-scored for quality, and they are visible only to your
> account. They are deleted when you delete the generation or your account, subject to the
> retention windows in Section 5. We do not use them to train models, we do not share them
> with advertisers, and we do not derive or store a face template or any other biometric
> identifier from them.

The last sentence is verifiable in code: `api/_lib/likeness-score.js` computes face embeddings
in memory to score likeness and files only the resulting 1 to 5 number, never the embedding,
the crop, or the capture URL.

## Data types

| Play data type | Collected | Shared | Required | Purposes | Notes |
| --- | --- | --- | --- | --- | --- |
| Personal info > Email address | Yes | No | Optional | Account management, app functionality | Only if the user registers with email; wallet-only accounts never provide one |
| Personal info > User IDs | Yes | Yes | Optional | Account management, app functionality | Username, display name, and wallet address. Shared is **Yes** because deploying an agent writes the wallet address to a public blockchain, which is disclosure and cannot be retracted |
| Photos and videos > Photos | Yes | Yes | Optional | App functionality | Selfie captures. Shared is **Yes** because generation is forwarded to upstream model providers named in the privacy policy. Collected only when the user chooses the selfie flow |
| Files and docs > Files and docs | Yes | No | Optional | App functionality | GLB/glTF models the user uploads |
| App activity > Other actions | Yes | No | Optional | App functionality, analytics, fraud prevention | API calls and widget load events, for quota and abuse limits |
| App info and performance > Crash logs | Yes | No | Optional | Analytics | Client error reports posted to `/api/client-errors` |
| Device or other IDs | No | No | | | No advertising ID, no device fingerprinting. Session records store a hashed IP and the user agent, which Play does not classify as a device ID |

Everything not listed is **not collected**: no location, no contacts, no calendar, no SMS, no
call logs, no health data, no financial account or payment information (all value transfer is
on-chain and settled by the user's own wallet), and no audio recordings.

## Security practices

- **Encrypted in transit:** yes. HTTPS everywhere, HSTS with `preload` on the apex.
- **Users can request data deletion:** yes. Deletion is available in-product and at
  <https://three.ws/legal/privacy>. Deleted accounts are soft-deleted for 30 days, then purged.
- **Committed to the Play Families Policy:** not applicable, the app is 18+.
- **Independent security review:** no. Do not claim one.

## Data deletion URL

<https://three.ws/legal/privacy> (Section 5 covers retention and the deletion path).
~~~~

### `solana-mobile/publish-play/README.md` (whole file)

~~~~markdown
# `publish-play/`: three.ws on Google Play

Everything the owner types or uploads into Play Console, kept in git so the console never
drifts from what was reviewed. The Solana dApp Store worksheet is next door in
[`../publish/`](../publish/); this is the Play twin of it.

**One app, one package id, two channels.** `ws.three.app` is the same APK content on both
stores. Do not fork the package name, and do not let the two listings describe different
products.

## The one decision that sets the timeline

Everything else here is a checklist. This is a fork in the road, and it is worth ten minutes
before anything is created.

| | Personal account | Organization account |
| --- | --- | --- |
| Requires | Government ID | A D-U-N-S number and business documents |
| Closed testing before production | **12 testers opted in continuously for 14 days** | **Exempt** |
| Realistic time to live | About 4 weeks | About 2 weeks, if the D-U-N-S already exists |
| The catch | The 14-day clock cannot be shortened or bought | A new D-U-N-S is free but can take up to 30 days |

The 12-tester rule applies to personal accounts created after 13 November 2023, per
[Play Console Help](https://support.google.com/googleplay/android-developer/answer/14151465).
Invited testers who never install do not count, the same twelve people can cover every future
app, and once an app has production access its updates never need testers again.

**Do this first:** look up three.ws at <https://www.dnb.com/duns/get-a-duns.html>. If a D-U-N-S
already exists or is issued immediately, take the organization account and skip fourteen days
of waiting. If it would take weeks, take the personal account and start the tester clock the
same day, because that clock is the critical path and nothing else in this file is.

## Steps

1. **Create the account** ($25 one time) and complete identity or business verification. Set
   `developer.account_type` in `config.yaml` to whichever you chose.
1a. **Device verification: do NOT use the Seeker that holds funds.** New personal
   accounts must prove access to a real Android device by signing into the Play
   Console mobile app on it. Any non-rooted physical device running Android 10 or
   newer qualifies, an emulator does not, and the check takes under a minute.

   Use a cheap dedicated handset, not the cold-storage Seeker. The Seed Vault is
   a secure element, so a Google account on the device cannot read the seed and
   no installed app can extract it. That is not the risk. The risk is that a
   Google account on the device enables Find My Device, so a compromise of that
   Google account can remotely wipe the phone, and a wipe with no offline seed
   backup is a permanent loss that never touched the secure element. The same
   compromise can push apps to the device from the web Play Store, which is the
   setup for an overlay attack against a signing prompt the owner does approve.
   A test device is needed for closed testing anyway.

   Organization accounts appear to skip this step along with the 12-tester rule;
   confirm it in the live flow before buying hardware.

2. **Create the app** with the title in `listing/title.txt` and the default language in
   `config.yaml`.
3. **Fill the App content forms.** Every answer is written down already: `listing/data-safety.md`,
   `listing/content-rating.md`, `listing/financial-features.md`. Read the blocking issue at the
   top of the data safety file before starting; it needs a privacy policy change that only the
   owner can approve, and Google cross-checks the two.
4. **Build the bundle.** Play takes an AAB, not an APK, and `scripts/build-apk.sh` already
   produces `build/app-release-bundle.aab` beside the APK. Our release key is the *upload* key
   here.
5. **Upload to the closed testing track** and roll it out. On a personal account this starts
   the 14-day clock, so do it before the store listing is polished, not after.
6. **Add Google's signing certificate to Digital Asset Links. This step is not optional and it
   has no local symptom.** Play App Signing is mandatory for new apps, so Google re-signs the
   bundle with its own key and a Play install presents *that* certificate, not ours. Copy the
   SHA-256 from **Test and release > Setup > App integrity > App signing key certificate** into
   [`../twa/extra-fingerprints.json`](../twa/extra-fingerprints.json), rerun
   `scripts/update-assetlinks.sh`, and deploy three.ws so the new statement file is live.
   Skip it and every Play user gets three.ws with the Chrome address bar across the top,
   while the dApp Store build stays perfect and nothing in local QA looks wrong.
7. **Verify on a device installed from Play**, not from `adb install`. `adb shell pm get-app-links ws.three.app`
   must report state 1, and the app must open with no address bar.
8. **Apply for production access** (personal accounts only) once twelve testers have been opted
   in for fourteen continuous days. Google's review of that application is usually under a week.
9. **Promote to production.**

## Graphics

Play's sizes are not the dApp Store's, so `../publish/media/` cannot be reused as-is.

| Asset | Size | Required |
| --- | --- | --- |
| App icon | 512 x 512, 32-bit PNG, no transparency | yes |
| Feature graphic | 1024 x 500 | yes |
| Phone screenshots | 2 to 8, between 320 px and 3840 px on each side, 16:9 or 9:16 | yes |
| 10-inch tablet screenshots | up to 8, between 1080 px and 7680 px on each side | optional, and Play ranks listings that have them higher |
| 7-inch tablet screenshots | up to 8, between 320 px and 3840 px on each side | same |
| Chromebook screenshots | 4 to 8, between 1080 px and 7680 px on each side | optional |
| Android XR screenshots | 4 to 8, between 720 px and 7680 px on each side | optional |

The icon at `../publish/media/icon.png` is already 512 x 512 and can be copied. The feature
graphic must be regenerated at 1024 x 500 (the dApp Store one is the same size, so check it
before rebuilding).

**The feature graphic slot rejects transparency.** Play takes a JPEG or a 24-bit PNG with no
alpha channel there, so `media/feature-1024x500.png` is flat on purpose and is the file that
goes in the console. For the surfaces that do want the lockup over their own background, two
transparent variants sit beside it:

```bash
node solana-mobile/scripts/make-media.mjs --target=play
# media/feature-1024x500-alpha-on-dark.png    white type
# media/feature-1024x500-alpha-on-light.png   dark type
```

Two of them, because ink cannot be transparent: a white wordmark over nothing disappears the
moment it lands on a light ground, and nothing in the render warns you, since on a dark canvas
it looks right. Pick the variant that matches the ground you are compositing over. Their
tagline is read from `listing/short-description.txt`, so the artwork cannot claim something the
store listing does not say.

Every screenshot on this listing is generated, not hand-captured:

```bash
node solana-mobile/scripts/make-screenshots.mjs --target=play           # media/phone/screen-1..5.png at 1080x1920
node solana-mobile/scripts/make-screenshots.mjs --target=play-tablet    # media/tablet/{10-inch,7-inch}/screen-1..5.png
node solana-mobile/scripts/make-screenshots.mjs --target=play-landscape # media/landscape/screen-1..5.png at 2560x1440
```

The landscape set fills BOTH the Chromebook and the Android XR slot: same 16:9, same app on a
flat surface, and 2560x1440 clears both floors, so the same five files are uploaded twice
rather than rendered twice. Nothing in them draws headset chrome or a fabricated room. An
Android app on XR is a flat panel floating in the user's space, and inventing an immersive
frame for it would misrepresent the app to a reviewer who owns the hardware.

Both targets capture the live site, compose the five panels as one continuous strip, and slice
it, so the uploads read as one photograph of a shelf of devices rather than five unrelated
stills. Upload the sliced panels in numerical order; `carousel.png` beside them is the master
strip and is not an upload. The tablet run is not the phone run upscaled: it drives the browser
at a 768 px viewport with the mobile flag off, so the frames hold the layout three.ws actually
serves a tablet, and any headline that names the hardware carries a `tabletTitle` override in
the script. One 1440x2560 composition serves both tablet slots, downscaled to 1260x2240 for the
7-inch one.

Neither target needs a device or an emulator. Unlike the dApp Store, Play does not require a
Seeker, and the two Seeker-specific frames (Seed Vault sheet, mint confirmation) are not
appropriate for a Play listing that ships to every Android phone anyway.

## Translations

`listing/translations.csv` holds the store listing in 21 languages and is the file Play
Console's **Main store listing > Manage translations > Import translations** card takes. One row
per locale, Play's own locale codes, RFC 4180 quoting so the multi paragraph descriptions survive.

Regenerate it from the English source files:

```bash
export NVIDIA_API_KEY="$(node scripts/read-service-env.mjs '^NVIDIA_API_KEY$' --raw)"
node scripts/play-listing-translations.mjs                    # all 21 locales
node scripts/play-listing-translations.mjs --locales=de-DE,ja-JP
node scripts/play-listing-translations.mjs --provider=groq     # nvidia is the default
```

Three things that file cannot get wrong, and each one is a check in the script rather than a
convention to remember:

- **Play's limits are per locale, not per source.** The English title is 28/30 and the short
  description 79/80, and almost every language runs longer, so a translation that reads perfectly
  still lands at 94 characters and the console flags the locale. Every field is measured and
  re asked until it fits, and a field that never fits falls back to English rather than to a
  sentence cut mid word.
- **The app name is never translated.** It is a brand plus a three word descriptor already using
  28 of its 30 characters, and Play accepts the same name in every locale.
- **Product, chain and format names survive byte for byte** (`three.ws`, `glTF`, `GLB`, `Solana`,
  `Metaplex Core`, `Mobile Wallet Adapter`, the support address and URLs). A localised domain or a
  translated `glTF` is a broken listing, not a localised one.

The em dash and en dash are banned repo wide, including in translated copy, which several of
these languages reach for by default: the script says so in the system prompt and strips any
that survive, so the generated CSV passes `npm run check:rules` like any other file.

## What Play will reject

Read [`listing/financial-features.md`](listing/financial-features.md) before building anything
that touches money on this channel. Short version: three.ws passes review because it is not a
wallet and not an exchange, and adding an in-app wallet, an in-app swap, or a fiat on-ramp
would move it into a category that needs a jurisdictional license. Adding a paid tier inside
the Android build would pull in Play Billing.
~~~~

