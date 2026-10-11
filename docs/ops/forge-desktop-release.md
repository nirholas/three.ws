# Releasing three.ws Forge for desktop

How a three.ws Forge version gets from `apps/forge-desktop/` to the download
page at [three.ws/forge-desktop](https://three.ws/forge-desktop) and to the
in-app updater. User guide: [docs/forge-desktop.md](../forge-desktop.md).

Publishing is owner-gated (CLAUDE.md, stop-and-ask gate 2). Every step below
defaults to a dry run that builds and stages without touching the live feed.

## How the pieces fit

| Piece | Where | What it does |
|---|---|---|
| Release history | [`apps/forge-desktop/releases.json`](../../apps/forge-desktop/releases.json) | Version, date and notes, newest first. A build refuses to run without an entry for `package.json`'s version. |
| Manifest | [`apps/forge-desktop/scripts/release-manifest.mjs`](../../apps/forge-desktop/scripts/release-manifest.mjs) | Hashes the built artifacts and writes `release.json`, merging the platforms an earlier build already published. Shares its classifier with three.ws Desktop. |
| Linux and Windows | [`apps/forge-desktop/cloudbuild.yaml`](../../apps/forge-desktop/cloudbuild.yaml) | AppImage, .deb and the NSIS installer on Cloud Build. Signs Windows when the certificate secrets exist. |
| macOS | [`apps/forge-desktop/scripts/release-mac.sh`](../../apps/forge-desktop/scripts/release-mac.sh) | The .dmg and .zip on a Mac (Cloud Build has no macOS workers). Signs and notarizes when the Apple secrets exist. |
| Bucket | `gs://three-ws-desktop-releases`, prefix `releases/forge/` | Shared with three.ws Desktop (`releases/desktop/`). Staged builds land in `staging/forge/<version>/<build>/`. |
| CDN route | [`apps/desktop/scripts/setup-release-cdn.mjs`](../../apps/desktop/scripts/setup-release-cdn.mjs) | One-time: serves `/releases/*` on the production load balancer from the bucket through Cloud CDN. |
| Download page | [`pages/forge-desktop.html`](../../pages/forge-desktop.html), [`src/forge-desktop.js`](../../src/forge-desktop.js) | Reads `https://three.ws/releases/forge/release.json`. A 404 shows the "run it from source" state. |
| Updater | [`apps/forge-desktop/electron/main/updater.ts`](../../apps/forge-desktop/electron/main/updater.ts) | electron-updater on the generic feed (`latest.yml`, `latest-linux.yml`). Patch versions install themselves; minor and major versions prompt. Off on macOS until builds are Developer ID signed. |

## One-time setup

The bucket and the `/releases/*` route are shared with three.ws Desktop, so if
Desktop already ships, skip this.

```bash
node apps/desktop/scripts/setup-release-cdn.mjs          # plan: prints every command
node apps/desktop/scripts/setup-release-cdn.mjs --apply  # owner-gated: edits the production URL map
curl -sI https://three.ws/releases/forge/release.json    # 404 until the first publish, from the bucket rather than the app
```

## Cut a version

1. Bump `version` in `apps/forge-desktop/package.json`.
2. Add the matching entry at the top of `apps/forge-desktop/releases.json`
   (version, date, notes with `title`, `summary`, `tags`). The notes are what
   the download page shows, so write them for users.
3. Commit both.

## Build Linux and Windows

From the repo root:

```bash
# Dry run: builds, writes release.json, stages under staging/forge/<version>/<build id>/
gcloud builds submit --config apps/forge-desktop/cloudbuild.yaml \
  --ignore-file apps/forge-desktop/.gcloudignore \
  --region us-central1 --project aerial-vehicle-466722-p5

# Publish (owner-gated)
gcloud builds submit --config apps/forge-desktop/cloudbuild.yaml \
  --ignore-file apps/forge-desktop/.gcloudignore \
  --region us-central1 --project aerial-vehicle-466722-p5 \
  --substitutions _PUBLISH=1
```

Inspect a dry run with `gcloud storage ls gs://three-ws-desktop-releases/staging/forge/<version>/`
and download `release.json` from there to check the file list and hashes.

**Windows signing** reads `desktop-windows-csc-link` (the .pfx, base64) and
`desktop-windows-csc-password` from Secret Manager, the same publisher identity
as three.ws Desktop. Without them the installer is unsigned, `release.json`
marks it `"signed": false`, and the download page shows the SmartScreen steps.

## Build macOS

On a Mac with Xcode command line tools, Node 20+ and `gcloud` signed in to
`aerial-vehicle-466722-p5`, after the Linux and Windows build so the manifest
merges into theirs:

```bash
bash apps/forge-desktop/scripts/release-mac.sh            # build and stage
PUBLISH=1 bash apps/forge-desktop/scripts/release-mac.sh  # also publish (owner-gated)
```

Signing reads `desktop-macos-csc-link` and `desktop-macos-csc-password`;
notarization reads `desktop-apple-api-key`, `desktop-apple-api-key-id` and
`desktop-apple-api-issuer`. Without them the app is ad-hoc signed, the page
marks it unsigned and shows the **Open Anyway** steps, and the in-app updater
stays off on macOS.

## Publish order

Both publish paths upload in the same order so no client ever sees a feed entry
before its file exists:

1. Binaries, under versioned names, cached for a year (`immutable`).
2. `versions/<version>.json`, a permanent copy of this release's manifest.
3. `release.json` and the `latest*.yml` updater feeds, uncached.

## Verify

```bash
curl -s https://three.ws/releases/forge/release.json | jq '{version, files: [.files[] | {platform, kind, size, signed}]}'
curl -sI "$(curl -s https://three.ws/releases/forge/release.json | jq -r '.files[0].url')" | head -1
```

Then open [three.ws/forge-desktop](https://three.ws/forge-desktop): the hero
offers your platform's build, and **All downloads** lists every file with its
size and SHA-256. Check one hash against the downloaded file.

## Roll back

Point the feed back at the previous version's manifest. The binaries it names
are still in the bucket because versioned names are never deleted:

```bash
gcloud storage cp gs://three-ws-desktop-releases/releases/forge/versions/<previous>.json \
  gs://three-ws-desktop-releases/releases/forge/release.json --cache-control="no-cache, max-age=0"
```

The `latest*.yml` updater feeds must be rolled back the same way from the
previous build's staging directory, or installed apps keep offering the bad
version.
