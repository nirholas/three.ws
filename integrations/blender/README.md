# three.ws Blender extension

Generate a 3D model from a text prompt or a reference image with three.ws Forge,
directly inside Blender. The model is reconstructed on three.ws and imported into
your scene, selected and framed.

Since 1.1.0 the extension also sends 360 footage to three.ws and imports the
result: a video becomes a Gaussian splat, a single photo becomes a depth shell.
It works with Insta360 cameras (raw `.insv` and `.insp` files from the X3, X4,
X5 and X6) and with any 2:1 equirectangular video or photo. See
[360 Capture](#360-capture).

Requires **Blender 4.2 or newer** (the extension system). The package lives in
[`three_ws/`](three_ws/) with its `blender_manifest.toml`.

## Install from Blender Extensions (recommended)

1. In Blender: **Edit > Preferences > Get Extensions**.
2. If prompted, click **Allow Online Access** (Blender needs it to browse the
   platform, and the add-on needs it to reach three.ws).
3. Search for **three.ws Forge** and click **Install**. It is enabled right away.

Listing: <https://extensions.blender.org/add-ons/three-ws/>

Blender also installs it by dragging that listing's **Get Add-on** button into
the Blender window.

## Install from source

Build the package with Blender's own tool, then install it from disk:

```bash
cd integrations/blender/three_ws
blender --command extension build --output-dir /tmp
```

In Blender: **Edit > Preferences > Get Extensions**, open the drop-down at the
top right, choose **Install from Disk...**, and pick `/tmp/three_ws-1.1.0.zip`.
Do not commit the zip.

## Online access

The add-on only connects to three.ws when Blender allows it
(`bpy.app.online_access`). With **Preferences > System > Network > Allow Online
Access** turned off, the **Generate** and **Test connection** buttons are
disabled, their tooltip explains why, and the panel shows an **Open
Preferences** shortcut. If Blender was started with `--offline-mode`, the panel
says so instead, since the preference cannot override the command line.

The manifest declares the two permissions the add-on uses: `network` (send the
prompt, image or 360 file to three.ws and download the result) and `files`
(read your images and 360 files, save the results and import them). The 360
Capture buttons follow the same online-access rule as Generate: they grey out
with the reason in the tooltip, and a direct call is refused before any request
is made.

## Preferences

**Edit > Preferences > Add-ons > three.ws Forge**:

- **API URL**: defaults to `https://three.ws`. Point it at your own deployment
  if self-hosting.
- **three.ws API key** (required): making a model needs a free three.ws
  account. Create a key at <https://three.ws/dashboard/api-keys> and paste it
  here (it is stored as a password field). Leave it blank to use the
  `THREE_WS_API_KEY` environment variable instead. Until a key is set, the panel
  shows an **Add your three.ws API key** box with a shortcut to these
  preferences, and **Generate** explains what to do instead of sending an
  anonymous request.
- **Provider API key**: only needed for the Meshy/Tripo *geometry* pipeline.
  The default *image* pipeline (FLUX→TRELLIS) needs nothing beyond your account.

## Use

Open the 3D Viewport sidebar (press **N**), then the **three.ws** tab.

- **Text** mode: type a prompt, pick a quality tier, hit **Generate 3D model**.
- **Image** mode: choose a PNG/JPEG/WebP reference, hit **Generate**.
- **Pipeline**: *Image* (FLUX→TRELLIS) or *Geometry* (Meshy/Tripo, needs a
  provider key).
- **Test connection** confirms the deployment is reachable and lists live backends.

Generation runs on a background thread, so Blender stays responsive. The panel
shows the real job status and elapsed seconds, and **Esc** cancels. The GLB
import happens on Blender's main thread when the job completes (bpy is not
thread-safe).

## 360 Capture

The **360 Capture** panel sits under Forge in the same **three.ws** sidebar tab.
It uses the same API key.

1. **File**: pick a 360 file.
   - A 2:1 equirectangular `.mp4` or `.mov`, or a raw `.insv` (or `.lrv`)
     recording, goes to the **splat lane** and comes back as a 3D Gaussian
     splat (`scene.ply`) plus a preview video.
   - A 2:1 equirectangular `.jpg`, `.png` or `.exr`, or a raw `.insp` photo,
     goes to the **photo lane** and comes back as a depth shell (`scene.glb`).
   - A split-pair `.insv` recording (one file per lens) takes the second lens
     file in **Second file**.
2. **Quality**: *Preview* (1 fps, 120 frames, a short training run),
   *Standard* (2 fps, 300 frames) or *High* (3 fps, 600 frames, more Gaussians).
3. **In / Out**: trim the clip in seconds. Out at 0 sends the whole clip.
4. **Up axis**: how the splat file is oriented. Captures from three.ws come out
   of the reconstruction Y down, which is the default.
5. **Send to three.ws**. The file (up to 8 GiB) goes up in parts of at least
   8 MiB, four at a time, straight to object storage, with a progress bar per
   stage: uploading,
   stitching, extracting frames, solving camera positions, training, exporting.
   An interrupted upload resumes from the first missing part the next time the
   same file is sent. **Cancel** stops the job on the server too.

When the job finishes, the result is imported and selected:

- **Splat**: with the KIRI Engine **3DGS Render** add-on installed and enabled
  (Blender 4.3 or newer), the splat is imported through it and renders as
  Gaussians. Without it, the splat becomes a coloured point cloud with a small
  Geometry Nodes view, and the panel offers a **Get KIRI 3DGS Render** link.
  Up to 1,000,000 points are read.
- **Depth shell**: imported with Blender's glTF importer (+Y up converted to +Z
  up, metres).
- Files are saved in `three_ws_captures/<job id>/` next to the `.blend`. An
  unsaved file keeps them in the temp directory, and the panel says to save the
  `.blend` to keep them.

**Your captures** lists the captures on your account (refresh button). Each
row has **Import**, **Preview video** (adds the preview as a movie strip in the
sequencer) and a link that opens the capture on three.ws.

The work runs on a background thread. Blender's main thread only reads a queue
five times a second and repaints the sidebar when the stage or the progress
changes, so the viewport stays smooth during a long job.

## Tests

```bash
# Client and importer logic, no Blender needed (15 tests):
cd integrations/blender && python3 -m pytest tests -q

# Validate, build, install into a throwaway profile, then run the headless import
# test (real 3DGS PLYs and a GLB) and the windowed timer test under Xvfb:
integrations/blender/tests/run_blender_tests.sh
```

`run_blender_tests.sh` uses `blender` from `PATH`, or downloads Blender 4.2 LTS
into `~/.cache/blender` and checks it against the published SHA-256. It needs
`ffmpeg` and `xvfb-run`. The built zip and a panel screenshot land in
`integrations/blender/dist/` (gitignored). The timer test drives the real
operators against a local server that speaks the capture contract. It fails if
the main thread stalls, if the 3D viewport repaints more than once per job
update, or if Cancel takes more than a second.

`tests/blender_live_check.py` runs the installed extension against a real
deployment: it clicks **Send**, waits for the job, and checks the imported
splat and the captures list.

```bash
xvfb-run -a -s "-screen 0 1600x1000x24" blender --online-mode --python-exit-code 1 \
  --python integrations/blender/tests/blender_live_check.py -- \
  --api-url https://three.ws --video clip-2to1.mp4 --result live.json
```

## License

The extension is distributed under **GPL-3.0-or-later** (`three_ws/LICENSE`),
the license the Blender Extensions platform requires for add-ons. The rest of
the repository stays Apache-2.0, which is GPLv3-compatible.

## Notes

- Nothing is mocked: the panel reflects the real job state, and failures
  (unreachable deployment, missing or refused three.ws API key, missing
  provider key, generation error) surface as
  Blender error reports, never a fake model.
- The image pipeline requires object storage configured on the deployment for
  upload; if it isn't, the add-on reports that clearly.
- A deployment without the 360 capture routes answers 404. The panel shows "does
  not offer 360 capture yet" instead of a raw error.
- `capture360_client.py` (upload and jobs), `capture360_import.py` (scene
  import), `capture360_ui.py` (panel, operators, timer) and `ply_reader.py`
  hold the 360 code. Only the client and the PLY reader are free of `bpy`.
- Insta360 is a trademark of its owner. This extension is not affiliated with,
  endorsed by or sponsored by Insta360. It reads the files their cameras record.
- The Forge client (`three_ws_client.py`) is a vendored copy of
  `integrations/_pyclient/three_ws_client.py`; see the
  [integrations README](../README.md).
- Publishing steps for maintainers: [SUBMITTING.md](SUBMITTING.md).
