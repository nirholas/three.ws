# Submitting the three.ws extension to Blender Extensions

The add-on in [`three_ws/`](three_ws/) is packaged as a Blender extension and
follows the [extension getting-started guide](https://docs.blender.org/manual/en/latest/advanced/extensions/getting_started.html)
and the [add-on guidelines](https://developer.blender.org/docs/handbook/extensions/addon_guidelines/).

Version 1.0.0 was prepared but never uploaded (the platform index had no
`three_ws` entry on 2026-11-21), so **1.1.0 is the first upload**. If a 1.0.0
listing exists by the time you read this, upload 1.1.0 as a new version of it
instead, with the changelog below.

| Manifest field | Value |
|---|---|
| `id` | `three_ws` (confirmed unused on extensions.blender.org, 2026-09-17 and 2026-11-21) |
| `name` | `three.ws Forge` |
| `version` | `1.1.0` |
| `tagline` | `3D from text or images, and 360 footage to splats` (49 chars) |
| `type` | `add-on` |
| `blender_version_min` | `4.2.0` |
| `license` | `SPDX:GPL-3.0-or-later` (full text in `three_ws/LICENSE`) |
| `tags` | `Import-Export`, `Add Mesh` |
| `permissions` | `network`: "Send prompts and 360 footage to three.ws, get results back"; `files`: "Read your images and 360 files, save and import results" (both under 64 chars) |

## Build of record

| | |
|---|---|
| File | `three_ws-1.1.0.zip` (44,339 bytes, 8 files) |
| SHA-256 | `0aafc744f5c62e26fbca2500505c1c625ece4eb9fac424abe81cdf7daceafd2a` |
| Built with | `blender --command extension build` on Blender 4.2.23 LTS |
| Contents | `blender_manifest.toml`, `__init__.py`, `three_ws_client.py`, `capture360_client.py`, `capture360_import.py`, `capture360_ui.py`, `ply_reader.py`, `LICENSE` |

Rebuilding from the same source gives the same files. Check the SHA-256 of the
zip you upload against this table, or rebuild and record the new value here if
the code changed since.

## Changes in 1.1.0

- New **360 Capture** panel in the three.ws sidebar tab.
- A 360 video (2:1 equirectangular `.mp4`/`.mov`, or raw `.insv` recordings
  from Insta360 X3, X4, X5 and X6 cameras) is uploaded in parallel parts with
  resume, turned into a 3D Gaussian splat on three.ws, and imported.
- A single 360 photo (2:1 `.jpg`/`.png`/`.exr`, or raw `.insp`) becomes a depth
  shell GLB, imported with the glTF importer.
- Splats import through the KIRI Engine 3DGS Render add-on when it is enabled
  (Blender 4.3 or newer), otherwise as a coloured point cloud with a Geometry
  Nodes view.
- Quality presets, trim in and out, up axis, Cancel that stops the server job,
  and a **Your captures** list with Import, Preview video (a sequencer strip)
  and Open on three.ws.
- The manifest's tagline and permission reasons now cover 360 files.

### Listing changelog (paste into the version's release notes)

```text
1.1.0
- New 360 Capture panel: send 360 footage to three.ws and import the result.
- Works with Insta360 cameras: raw .insv video and .insp photos from the X3, X4, X5 and X6, plus any 2:1 equirectangular video or photo.
- Video becomes a 3D Gaussian splat. It renders through the KIRI Engine 3DGS Render add-on when installed (Blender 4.3+), otherwise it imports as a coloured point cloud.
- A single 360 photo becomes a depth shell mesh (glTF).
- Resumable parallel upload, quality presets, trim, up axis, Cancel, and a list of your captures with one-click import and preview video.
- Uses the same three.ws API key and respects Blender's Allow Online Access setting.
- Insta360 is a trademark of its owner. This add-on is not affiliated with or endorsed by Insta360.
```

## Compliance checklist

- **Online access:** every network path (Generate, Test connection, Send to
  three.ws, Refresh captures, Import, Preview video) checks `bpy.app.online_access` in
  `poll()` and again in `execute()`, and refuses with a message that
  distinguishes the preference from a `--offline-mode` launch. The panel shows
  the reason and an Open Preferences shortcut.
- **Namespace:** preferences use `bl_idname = __package__` and are read through
  `context.preferences.addons[__package__]`; all modules import relatively.
- **No `bl_info`:** the manifest replaces it. Blender 4.2 is the minimum, so
  there is no legacy install path to keep.
- **Self-contained:** stdlib only, no wheels, no pip, no `sys.path` changes.
  The PLY reader uses numpy, which ships with Blender.
- **Read-only install safe:** nothing is written into the add-on directory.
  Upload resume files go to `bpy.utils.extension_path_user(__package__)`;
  capture results go next to the `.blend` (`three_ws_captures/`) or to the temp
  directory for an unsaved file; Forge's GLB goes to the temp directory and is
  deleted after import.
- **Threads:** network work runs on a worker thread; bpy is only touched from a
  main-thread timer that reads a queue five times a second.
- **Trademark:** Insta360 appears only nominatively ("works with Insta360
  cameras"), never in the product name, and with no logo.
- **License:** GPL-3.0-or-later, as the platform requires for add-ons.

## What was validated for 1.1.0 (Blender 4.2.23 LTS, Linux, 2026-11-21)

- `blender --command extension validate` passes on the source folder and on the
  built zip; the zip installs with `extension install-file` into a throwaway
  profile and enables as `bl_ext.user_default.three_ws`
  (`tests/run_blender_tests.sh`).
- Headless import test (`tests/blender_import_test.py`, 53 checks): real 3DGS
  PLYs import as point clouds with the right vertex count, colours and
  orientation per up axis; a depth shell GLB imports; the preview becomes a
  sequencer strip; files land in `three_ws_captures/` or the temp directory.
- Windowed timer test under Xvfb (`tests/blender_timer_test.py`) against a
  local server that speaks the capture contract: the main thread stayed
  responsive for 15.3 s of polling (p95 gap 26 ms over 1,135 ticks), the 3D
  viewport repainted twice in that time, Cancel stopped the worker thread in
  144 ms, and the sidebar drew the panel on the active three.ws tab. A
  screenshot of the panel is written to `dist/panel-1.1.0.png`.
- `pytest` (15 tests) on the client and PLY reader, including resume after a
  failed part and Cancel aborting the upload.
- Live, against a real three.ws server (the production `server/index.mjs` on an
  isolated database, writing to the production object store,
  `tests/blender_live_check.py`): the installed extension uploaded a 360 clip,
  the job succeeded, the 14,526-Gaussian splat imported, and Your captures
  listed it.
- Production `https://three.ws`: sign-in with an API key works (catalog in
  0.10 s); the 360 capture routes are not deployed yet, and the panel answers
  "does not offer 360 capture yet" instead of an error. Run the live check
  against production once they are deployed.
- Forge (text and image to 3D) is unchanged from 1.0.0, which reached
  https://three.ws and imported a real generated GLB on 4.2.9.

## Owner steps

1. **Blender ID.** Sign in at <https://extensions.blender.org> with the Blender
   ID that should own the listing (create one at <https://id.blender.org> if
   needed).
2. **Smoke test locally** (optional; the tests above already ran):

   ```bash
   integrations/blender/tests/run_blender_tests.sh
   ```

   It rebuilds `integrations/blender/dist/three_ws-1.1.0.zip`; compare its
   SHA-256 with the build of record. In Blender: **Edit > Preferences > Get
   Extensions > Install from Disk...**, pick the zip, open the 3D Viewport
   sidebar (N) > **three.ws**, click **Test connection**, and send a short 360
   clip from the **360 Capture** panel.
3. **Upload.** Go to <https://extensions.blender.org/submit/>, upload
   `three_ws-1.1.0.zip`, and accept the terms.
4. **Complete the listing** on the draft page:
   - Description: reuse the intro, Use, 360 Capture and Online access sections
     of `README.md`.
   - Release notes for 1.1.0: the listing changelog above.
   - Screenshots: the sidebar with an imported model, and
     `dist/panel-1.1.0.png` (the 360 Capture panel) or a fresh capture of an
     imported splat.
   - Support link: `https://github.com/nirholas/three.ws/issues`.
5. **Submit for review.** The listing enters the approval queue
   (<https://extensions.blender.org/approval-queue/>). Reply to moderator
   comments on that page; any code change means bumping `version` in the
   manifest, rebuilding, and uploading the new zip as a new version.
6. Build archives are never committed (`dist/` is gitignored).

## Post-publish verification

1. <https://extensions.blender.org/add-ons/three-ws/> is public and shows
   version 1.1.0, GPL-3.0-or-later, and the network and files permissions.
2. `curl -s https://extensions.blender.org/api/v1/extensions/ | grep -o '"id": *"three_ws"'`
   finds the listing in the platform index Blender reads.
3. In a fresh Blender profile: **Get Extensions**, allow online access, search
   `three.ws Forge`, install, and confirm it enables without errors in the
   console.
4. Generate a model from text with the default image pipeline. The imported,
   selected object is the "first completed generation" evidence for the
   Blender Extensions row in `marketing/growth/opportunities.csv`; set that row
   to `live` with the listing URL.
5. Once the capture routes are on production, run `tests/blender_live_check.py`
   against `https://three.ws` (README, Tests) with a real 360 clip.
