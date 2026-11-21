# three.ws 360 Capture for Adobe Premiere Pro

A Premiere Pro panel that sends a 360 clip from your project to three.ws, waits while it is turned into a Gaussian splat scene, and brings the results back into your project: `preview.mp4`, `poster.jpg`, `scene.ply` and `scene.spz` in a bin called **three.ws captures**. A single 360 photo goes to the pano-scene lane and comes back as a depth-shell GLB.

It works with stitched equirectangular video and photos (2:1) and with raw files from Insta360 cameras (`.insv`, `.insp`, including split-pair `_00_` / `_10_` lens files). Insta360 is a trademark of Arashi Vision Inc.; this panel is made by three.ws, is not affiliated with or endorsed by Arashi Vision, and only reads files your camera already wrote.

Requires Premiere Pro 25.6 or later (UXP, manifest v5) and a free three.ws account.

## Install (development load)

1. Install the **UXP Developer Tool** from Creative Cloud Desktop (Apps, "All apps", Developer Tools).
2. Open Premiere Pro 25.6+, then open the UXP Developer Tool and press **Connect** next to Premiere Pro. If Premiere is not listed, enable "Enable Developer Mode" under Premiere Pro Settings, Plugins, and restart it.
3. In the UXP Developer Tool choose **Add Plugin** and select `integrations/premiere-uxp/manifest.json` from this repository.
4. Press **Load** on the "three.ws 360 Capture" row. The panel appears under **Window, Extensions, three.ws 360 Capture**.

To install a built package instead, run `npm run build` in this folder and double-click `dist/ws.three.capture-<version>.ccx` (Creative Cloud Desktop installs it).

## Use

1. **Sign in.** Press **Get an API key** (opens https://three.ws/dashboard/api), create a key, paste it into the panel and press **Save key**. The key is kept in the operating system's secure storage through UXP `secureStorage`, never in a file.
2. **Choose footage.** Select a clip in the Project panel and press **Use selected clip**, or press **Choose file** to pick one from disk. The panel reads the frame size from the file header: a 2:1 frame, `.insv` or `.insp` counts as 360. Anything else needs you to tick **This is a stitched 360 file** before it will send.
3. **Optional trim and quality.** If the clip has In and Out points set in Premiere, **Use the clip's in and out points** is ticked and sends them as `trim`. Quality is **Preview**, **Standard** or **High**.
4. **Send.** The panel uploads in 8 MiB parts, four at a time, each retried with backoff. A cancelled or crashed upload resumes from the parts the server already has (resume state is in the plugin data folder). Processing progress is polled and shown with a stage label (fetching, stitching, extracting frames, solving cameras, training, exporting, saving). **Cancel** stops the upload or the job.
5. **Results.** Files are saved to `<project name>_three.ws/<job id>/` next to the project file (the project must be saved; otherwise they go to the plugin data folder and the panel says so), imported into the **three.ws captures** bin, and the viewer link is shown. **Insert preview at playhead** places `preview.mp4` on the active sequence at the playhead.
6. **Your captures** lists your recent jobs from `GET /api/pano-capture?mine=1`, each with Import and Open buttons.

## Permissions, and why

| Permission | Value | Why |
|---|---|---|
| `network.domains` | `three.ws`, `*.three.ws`, `*.r2.cloudflarestorage.com`, `*.r2.dev`, `storage.googleapis.com` | the API, the multipart upload targets and the result downloads. Nothing else is reachable. |
| `localFileSystem` | `fullAccess` | reading a selected clip needs its path, and saving results next to the project file needs write access to the project folder. `request` (picker only) cannot do either by path. The panel only reads the file you send and writes inside `<project>_three.ws/`. |
| `launchProcess` | `https` scheme, no file extensions | opens the viewer and the API key page in your browser. It cannot launch programs or documents. |

## Troubleshooting

- **"Your three.ws API key was not accepted."** Create a new key at https://three.ws/dashboard/api and save it again.
- **"You already have 3 uploads in progress" / "2 captures processing".** Wait for one to finish or cancel it. Open uploads expire on their own.
- **"This does not look like a 360 clip."** The frame is not 2:1. If it is stitched 360 footage, tick the confirmation box.
- **"Capture processing is not available right now."** The service is temporarily off. Nothing is lost, send again later.
- **The panel does not appear.** Check the Premiere version (25.6 or later) and that the plugin shows as Loaded in the UXP Developer Tool; press Debug to see its console.
- **Results landed in the plugin data folder.** The project had not been saved. Save it and press Import on the job in Your captures.
- **A file did not import.** The files are still in the folder shown in the result card. Use File, Import in Premiere.

## Develop

```
cd integrations/premiere-uxp
npm test               # node --test: client logic against a local server that speaks contract C4
npm run build          # validates manifest.json and writes dist/ws.three.capture-<version>.ccx (gitignored)
node scripts/package-ccx.js --check
```

Layout: `manifest.json`, `index.html`, `styles.css`, `src/core/` (pure client logic: errors, retry, client, upload, detect, probe, poll, results, stream, session), `src/host/` (UXP adapters for storage, files and `premierepro`), `src/panel.js` (the controller), `test/`, `scripts/` (packaging, manifest schema, live proof).

Adobe's own packager (`@adobe/uxp-devtools-cli`) depends on the UXP Developer Tool service, which runs on macOS and Windows only. `scripts/package-ccx.js` builds the same layout deterministically on any OS (fixed timestamps, sorted entries) and validates the manifest against `scripts/manifest.schema.json`. Loading the panel inside Premiere Pro cannot be verified from a Linux build machine; follow the install steps above on a Mac or Windows machine.

The server contract is C4 in `prompts/finish/_context/insta360-00-CONTEXT.md`: `/api/capture-upload/{create,sign,parts,complete,abort}`, `/api/pano-capture`, `/api/pano-scene`. The handlers are `api/capture-upload/`, `api/pano-capture.js` and `api/pano-scene.js`; each documents its request and response shapes in its header comment.

Licence: Apache-2.0 (same as the repository's integrations).
