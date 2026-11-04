# Releasing 1.1.0 (versionCode 2)

Built 2026-11-04 by `scripts/build-apk.sh`, unattended, from the release key in Secret Manager (`three-ws-seeker-release-keystore`, base64, and `three-ws-seeker-keystore-password`).

| Field | Value |
| --- | --- |
| Package | `ws.three.app` |
| Version | 1.1.0, versionCode 2 |
| File | `solana-mobile/build/three-ws-release.apk` (gitignored; rebuild on the release machine) |
| Size | 4,481,700 bytes |
| SHA-256 of the APK | `1afd05e963d0f5264c00130361776e085ccedf4181083be35b7911e0024103d4` (changes on every rebuild, so recompute with `sha256sum` before upload) |
| Signing certificate SHA-256 | `98:0A:1A:AB:A3:ED:28:D6:3D:06:69:86:7F:9A:C1:4D:EC:05:F7:78:6D:3A:30:0F:84:00:4D:E8:55:11:13:D7` |
| Live `assetlinks.json` | carries the same certificate, no deploy needed |

## Rebuild (if the APK is missing)

```bash
cd solana-mobile
mkdir -p ~/seeker-release && chmod 700 ~/seeker-release
gcloud secrets versions access latest --secret three-ws-seeker-release-keystore --project aerial-vehicle-466722-p5 | base64 -d > ~/seeker-release/android.keystore
gcloud secrets versions access latest --secret three-ws-seeker-keystore-password --project aerial-vehicle-466722-p5 > ~/seeker-release/pw
bash scripts/setup-android-sdk.sh
KEYSTORE_PATH=~/seeker-release/android.keystore KEYSTORE_PASSWORD="$(tr -d '\n' < ~/seeker-release/pw)" \
  ASSETLINKS_OUT=/tmp/assetlinks.check.json ACCEPT_ANDROID_SDK_LICENSES=1 bash scripts/build-apk.sh
rm -rf ~/seeker-release
```

The build must print `[apply-overlay] overlay applied`; a build without it has no widget.

## Solana dApp Store (owner)

1. In the Publisher Portal, create an API key (Settings > API keys) and fund the publisher wallet with at least 0.2 SOL (the release NFT and uploads spend SOL, which is why an agent never runs this).
2. Dry run first, nothing is sent:
   `DAPP_STORE_DRYRUN=1 SOLANA_KEYPAIR=<keypair file> DAPP_STORE_API_KEY=dry ./scripts/publish.sh`
3. Publish: `SOLANA_KEYPAIR=<publisher keypair> DAPP_STORE_API_KEY=<key> ./scripts/publish.sh`. It refuses a versionCode it already shipped from this machine.
4. After approval, add the `data/changelog.json` entry with the store link.

## Google Play (owner)

Follow [publish-play/README.md](publish-play/README.md). Add Google's Play App Signing fingerprint to `twa/extra-fingerprints.json` before the first Play install (step 6 there), or Play installs lose full-screen mode.

## Not verifiable from an agent sandbox

The sandbox has no KVM, so no emulator ran this time. The widget was emulator-verified on 2026-08-29 (see CHECKLIST section 7b). Re-check on a Seeker: Seed Vault sheet and SIWS, force-stop persistence, deep links, and the Photos share target.
