# three.ws Blender extension

Generate a 3D model from a text prompt or a reference image with three.ws Forge,
directly inside Blender. The model is reconstructed on three.ws and imported into
your scene, selected and framed.

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
top right, choose **Install from Disk...**, and pick `/tmp/three_ws-1.0.0.zip`.
Do not commit the zip.

## Online access

The add-on only connects to three.ws when Blender allows it
(`bpy.app.online_access`). With **Preferences > System > Network > Allow Online
Access** turned off, the **Generate** and **Test connection** buttons are
disabled, their tooltip explains why, and the panel shows an **Open
Preferences** shortcut. If Blender was started with `--offline-mode`, the panel
says so instead, since the preference cannot override the command line.

The manifest declares the two permissions the add-on uses: `network` (send the
prompt or image to Forge and download the model) and `files` (read the
reference image and import the generated GLB).

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
- The Forge client (`three_ws_client.py`) is a vendored copy of
  `integrations/_pyclient/three_ws_client.py`; see the
  [integrations README](../README.md).
- Publishing steps for maintainers: [SUBMITTING.md](SUBMITTING.md).
