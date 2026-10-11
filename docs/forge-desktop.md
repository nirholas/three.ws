# three.ws Forge for desktop

three.ws Forge is a free desktop 3D studio for Windows, Linux and Apple silicon
Macs. It turns a photo into a 3D model with open-source generators running on
your own graphics card, or with the three.ws cloud when you have no GPU. It
chains mesh tools in a visual node workflow, imports free CC0 models from the
three.ws library, and publishes the result to your three.ws account in one
click.

It is based on [Modly](https://github.com/lightningpixel/modly) by
[Lightning Pixel](https://github.com/lightningpixel), used under the MIT
license. The source lives in [`apps/forge-desktop/`](../apps/forge-desktop/README.md).

Download page: [three.ws/forge-desktop](https://three.ws/forge-desktop).

## Get it

[three.ws/forge-desktop](https://three.ws/forge-desktop) offers the build for
your operating system, every other build with its size and SHA-256, and the
release notes. Until the first signed installers ship, the page leads with
running from source, which takes five commands:

```bash
git clone --depth 1 https://github.com/nirholas/three.ws
cd three.ws/apps/forge-desktop
npm install
npm run prepare-resources
npm run dev
```

You need Node.js 20 or later and Git. `prepare-resources` downloads a
standalone Python for your platform, so Forge never depends on the one your
system ships (Debian and Ubuntu leave out `ensurepip`, which breaks
`python -m venv`).

**First launch.** Forge asks where to keep its data (models, workflows, the
Python environment), then builds its Python environment and starts its local
engine on `127.0.0.1:8765`. That takes a few minutes once; later launches start
in seconds.

**Unsigned builds.** If a download on the page is marked *unsigned*, your OS
warns the first time you open it. On macOS, open System Settings, then Privacy
& Security, and choose **Open Anyway**. On Windows, choose **More info**, then
**Run anyway** in SmartScreen. Compare the SHA-256 on the page with
`shasum -a 256 <file>` (macOS), `Get-FileHash <file>` (PowerShell) or
`sha256sum <file>` (Linux) first.

## Generate

The **Generate** screen takes an image (drop it on the panel or pick a file) and
runs the selected workflow. Two kinds of generator are available:

- **On your GPU.** Install Hunyuan3D, TripoSG, TRELLIS or another model from the
  **Models** tab (any GitHub repository with a Modly-compatible `manifest.json`
  works too) and run it locally with no queue and no upload. NVIDIA GPUs use
  CUDA, AMD Radeon GPUs use ROCm on Windows and Linux, and Apple silicon uses
  Metal. Each model lists its VRAM needs.
- **On the three.ws cloud.** The built-in three.ws nodes generate from a photo,
  a text prompt or a sketch on three.ws GPUs, and add auto-rigging and
  remeshing. They work on any laptop.

The finished model opens in the viewport. The toolbar has **Import** (a file
from disk, or the three.ws library), **Export** (GLB, OBJ, STL, PLY),
**Publish**, **Smooth** and **Decimate**.

## Node workflows

The **Workflows** tab is a visual graph editor. Connect an image input to a
generator, then to repair, remeshing, smoothing, optimization, auto-rigging or
export nodes, save the workflow, and run it again on the next image from the
Generate screen. Graphs are validated before a run: a broken wire shows inline
instead of discarding the current model.

## The three.ws library

**Import, then three.ws library** opens the [CC0 object library](https://three.ws/objects):
hundreds of public-domain models you may use, remix and sell. Search by name
(chairs, trees, cars), click a thumbnail, and the model downloads and opens in
the viewport as a starting point, a reference or a workflow input. No account
is needed.

## Your three.ws account

**Settings, then three.ws** connects Forge to your account. There are two ways:

- **Sign in with your browser** (recommended). Forge shows a short code and
  opens [three.ws](https://three.ws) to approve it, the same device flow as the
  three.ws CLI. When you approve, Forge receives a key scoped to this device.
- **Paste an API key** for managed machines or CI. Create one at
  [three.ws/dashboard/developers](https://three.ws/dashboard/developers); it
  starts with `sk_live_` and needs the `avatars:write` scope to publish.

The key is encrypted with the operating system's secure storage (Keychain on
macOS, DPAPI on Windows, the desktop keyring on Linux) through Electron's
`safeStorage`, and the screen only ever shows who is signed in. On a Linux
machine with no keyring at all, Forge logs a warning and keeps the key
unencrypted in its settings file, so prefer a keyring there. **Sign out**
deletes it. The three.ws workflow nodes read the same key, so they are signed
in as soon as the app is.

## Publish

**Publish** sends the model in the viewport to your account as a shareable 3D
page (`three.ws/avatars/<id>`) you can embed, rig or give to an agent. Give it
a name and tags, choose who can see it (private, unlisted or public), and Forge
uploads the GLB. When it is done, the popover links to the new page and copies
its URL in a click. If you are not signed in, the popover offers sign-in
first.

## Command line and agents

A running Forge can be driven without the UI through the stdlib-only CLI in
[`apps/forge-desktop/tools/forge-cli/`](../apps/forge-desktop/tools/forge-cli/SKILL.md):

```bash
python apps/forge-desktop/tools/forge-cli/agent.py health
python apps/forge-desktop/tools/forge-cli/agent.py generate --image ./input.png --output ./export.glb
```

## Troubleshooting

| You see | Do this |
|---|---|
| First-run setup stops at "Creating Python environment" | Run `npm run prepare-resources` in `apps/forge-desktop`, then relaunch. It stages a Python that includes `ensurepip`. |
| "Could not reach three.ws" in Settings | Check your connection and press **Retry**. A rejected API key shows **Dismiss** instead: create a new key and paste it again. |
| The library lists models but shows no thumbnails, or a model will not open | Your network blocks `*.r2.dev`, where the library's models and previews are hosted. Allow it, or download the model from [three.ws/objects](https://three.ws/objects) on another network and open it with **Import**. |
| A local model runs out of memory | Pick a smaller variant in the Models tab (Mini or Turbo), or use the three.ws cloud nodes. |
| Something else failed | **Settings, then Logs** shows the Errors, Runtime (the Python engine) and App logs for this session and earlier ones, with a Copy button for bug reports. |

## Related

- [/forge-desktop](https://three.ws/forge-desktop): the download page.
- [Modly and three.ws](./modly.md): every way three.ws and Modly work together,
  including the three.ws nodes for an unmodified Modly.
- [Forge](./forge.md): generating 3D in the browser on three.ws servers.
- [Workbench](./workbench.md): the same kind of node workflow in a browser tab.
- Maintainers cut releases with the runbook at `docs/ops/forge-desktop-release.md` in the repository (operator docs are not published on the site).
