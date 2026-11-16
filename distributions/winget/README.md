# winget: ThreeWs.Agent

The [winget](https://learn.microsoft.com/windows/package-manager/) package for
`three-ws-agent`, the three.ws agent CLI ([packages/agent-cli](../../packages/agent-cli)).
It installs one self-contained `three-ws-agent.exe` (Node.js built in, nothing
else to install) and puts `three-ws-agent` on PATH, on Windows 10 1809 /
Server 2019 or later, x64 and arm64.

```powershell
winget install ThreeWs.Agent          # once the package is in microsoft/winget-pkgs
three-ws-agent --version
three-ws-agent login
```

Until the package is merged into the community repository, install from the
manifests in this folder (winget needs local manifests enabled once, as admin):

```powershell
winget settings --enable LocalManifestFiles
winget install --manifest distributions\winget\manifests\t\ThreeWs\Agent\0.2.0
```

or download the zip for your architecture from the release archive (URLs and
SHA256 in [data/agent-cli-releases.json](../../data/agent-cli-releases.json))
and run `three-ws-agent.exe` from wherever you unzip it.

## What is here

| Path | What it is |
|---|---|
| `manifests/t/ThreeWs/Agent/<version>/` | The three manifests (`ThreeWs.Agent.yaml`, `.installer.yaml`, `.locale.en-US.yaml`) for each released version, in exactly the layout of [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs). Generated, never hand-edited. |
| `scripts/manifests.mjs` | The manifest content as data: identifier, installer type (`zip` with a nested `portable` exe and the `three-ws-agent` alias), descriptions, links. |
| `scripts/generate-manifests.mjs` | Writes the manifests for a version from the release ledger, or for a local build staged anywhere (`--release-json --base-url --out`). |
| `schemas/1.28.0/` | The winget manifest JSON schemas (version, installer, defaultLocale), vendored from [microsoft/winget-cli](https://github.com/microsoft/winget-cli/tree/master/schemas/JSON/manifests/v1.28.0) at commit `dafe5e7795c6b36e2a8cea86aa9fddec898df795` (MIT). [tests/winget-manifests.test.js](../../tests/winget-manifests.test.js) validates every generated and committed manifest against them. |

The installers themselves live in the write-once public archive
`gs://three-ws-lib-releases/agent-cli/<version>/` (served from
`https://storage.googleapis.com/three-ws-lib-releases/agent-cli/<version>/`).
That bucket has a retention policy and every upload uses an
`if-generation-match=0` precondition, so a published installer URL always
serves the same bytes and its SHA256 in a merged manifest can never go stale.

## Releasing a new version

1. Bump the CLI version (this also names the zips):

   ```bash
   npm version <x.y.z> --no-git-tag-version --workspace packages/agent-cli
   ```

2. Build both executables and zips. Downloads the pinned Node.js release's
   official `node.exe` for each architecture, checks it against `SHASUMS256.txt`,
   bundles the CLI with esbuild, injects it with `node --build-sea`, strips the
   now-invalid OpenJS signature and writes reproducible zips plus `SHA256SUMS`
   and `release.json` to `packages/agent-cli/dist/windows/`. `--host` also
   builds and smoke-runs a Linux executable from the same bundle.

   ```bash
   npm run agent-cli:build-windows -- --host
   ```

3. Prove the build on real Windows before it becomes permanent. Stage the zips
   anywhere public (a throwaway bucket is fine), generate manifests that point
   at them, and run the GCE check. It creates a short-lived Windows Server 2025
   VM, installs winget if needed, runs `winget validate` and
   `winget install --manifest`, runs the installed `three-ws-agent` (`--version`,
   `--help`, `sessions`, and against production with a two-hour QA key,
   `whoami` and `doctor`), uninstalls it, deletes the VM and revokes the key.

   ```bash
   node distributions/winget/scripts/generate-manifests.mjs \
     --release-json packages/agent-cli/dist/windows/release.json \
     --base-url https://storage.googleapis.com/<staging-bucket>/agent-cli/<x.y.z> --out /tmp/winget-staging
   npm run winget:verify -- --manifests /tmp/winget-staging
   ```

4. Archive the zips (write-once) and record them in the ledger. The script reads
   every file back through its public URL and checks the SHA256 before it writes
   `data/agent-cli-releases.json`. `--dry-run` shows what would be uploaded.

   ```bash
   npm run agent-cli:release-windows
   ```

5. Generate the final manifests from the ledger, check them, and verify once
   more against the archive URLs:

   ```bash
   npm run winget:manifests
   npx vitest run tests/winget-manifests.test.js
   npm run winget:verify -- --manifests distributions/winget/manifests/t/ThreeWs/Agent/<x.y.z> --log distributions/winget/verification/<x.y.z>.log
   ```

6. Commit the ledger, the manifest folder and the verification log, then submit
   the folder to microsoft/winget-pkgs (below).

## Submitting to microsoft/winget-pkgs

The generated folder is the whole submission. Either route works; both open a
pull request from the publisher's own GitHub account.

- **By hand:** fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs),
  copy `manifests/t/ThreeWs/Agent/<x.y.z>/` to the same path in the fork, commit
  as `New package: ThreeWs.Agent version <x.y.z>` (later versions:
  `New version: ThreeWs.Agent version <x.y.z>`), and open the PR using the
  repository's PR template checklist.
- **With [wingetcreate](https://github.com/microsoft/winget-create):**
  `wingetcreate submit --token <github-token> distributions\winget\manifests\t\ThreeWs\Agent\<x.y.z>`
  for the folder as generated, or for later versions
  `wingetcreate update ThreeWs.Agent --version <x.y.z> --urls <x64-zip-url> <arm64-zip-url> --submit`.

The winget-pkgs pipeline validates the manifests, downloads both zips, checks
the hashes and installs the package in a sandbox. Moderators may ask questions
on the PR; the first version of a new publisher folder (`ThreeWs`) gets a
manual review.

## Code signing and SmartScreen

The executables are not Authenticode-signed yet: injecting the CLI into the
official `node.exe` invalidates the OpenJS Foundation signature, and the build
removes it so Windows sees a plainly unsigned file rather than a tampered one.
winget accepts unsigned portable packages. Installed through winget, the exe
runs from PATH without a prompt; run from a zip downloaded in a browser, it
carries the Mark of the Web, so SmartScreen asks for confirmation on first run.
Signing each `three-ws-agent.exe` (for example with Azure Trusted Signing)
between steps 2 and 4 removes that prompt; the build already leaves the
certificate table empty, ready for `signtool sign`.

## Why a single executable

The npm package needs Node.js 22.13+ already installed, which is the usual
reason a Windows install fails. The single executable is the same code
(`bin/three-ws-agent.js` and everything it imports, bundled), run by an
embedded Node.js 26 LTS; the session store uses the built-in `node:sqlite`, so
there is no native addon to ship. The Draco decoder that `--avatar` uses for
compressed GLBs is embedded as a SEA asset.

## Known behaviour on Windows Server

On the Windows Server 2025 GCE image (winget 1.29), the first `winget install`
of any zip package fails with "Failed to extract the contents of the archive"
(exit `-1978335140`) because winget's default Shell extraction needs a desktop
shell the server image lacks. The package is fine: the archive lists and expands
with `tar` and `Expand-Archive`, and the hash check passes. The verification
script records that failure, sets `installBehavior.archiveExtractionMethod` to
`tar` in the user settings and installs again, which succeeds. On Windows 10 and
11 desktops the default method works; if a user sees the same error, the same
setting is the fix (`winget settings`).
