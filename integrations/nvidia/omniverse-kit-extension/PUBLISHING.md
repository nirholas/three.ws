# Publishing threews.forge

Owner steps to list the extension on Omniverse Exchange and make it findable on
GitHub. Everything an agent can prepare is in this folder; the steps below need
the owner's NVIDIA developer account or GitHub admin rights.

## 1. Check the package

```bash
cd integrations/nvidia/omniverse-kit-extension
pip install omniverse-kit==110.4.1.392751 --extra-index-url https://pypi.nvidia.com
scripts/run_tests.sh                                  # headless suite, must end OK
scripts/gce_gpu_run.sh --key-file ~/.cache/threews-kit-qa-key.json
                                                      # GPU VM: panel and live tests, screenshots
```

The last measured GPU run is in [docs/omniverse-extension.md](../../../docs/omniverse-extension.md).

## 2. Build the archive

The registry takes the extension folder itself (the one holding
`config/extension.toml`):

```bash
cd integrations/nvidia/omniverse-kit-extension/exts
zip -r ../threews.forge-1.0.0.zip threews.forge -x '*/__pycache__/*'
```

## 3. Submit through the Exchange publishing portal

Portal: <https://developer.nvidia.com/omniverse-exchange-publishing-portal>
(early access; request access with the NVIDIA developer account if the form is
not open yet). Field values, all taken from `config/extension.toml`:

| Field | Value |
| --- | --- |
| Extension id | `threews.forge` |
| Version | `1.0.0` |
| Title | Forge by three.ws |
| Short description | Generate a textured 3D model from a text prompt or a reference image with Forge by three.ws and drop it into the stage, upright and to scale. Browse and import the models saved in your three.ws account. |
| Category | Content |
| Keywords | 3D generation, text to 3D, image to 3D, GLB, assets, three.ws, generative |
| Kit version | 110.x (tested on Kit 110.4.1) |
| Platforms | Linux x86_64 (tested); the extension is pure Python with no native code |
| License | Apache-2.0 |
| Repository | <https://github.com/nirholas/three.ws/tree/main/integrations/nvidia/omniverse-kit-extension> |
| Icon | `exts/threews.forge/data/icon.png` (256 x 256) |
| Preview image | `exts/threews.forge/data/preview.png` (1280 x 720, a real generation in the RTX viewport) |
| Readme shown in the Extension Manager | `exts/threews.forge/docs/README.md` |
| Changelog | `exts/threews.forge/docs/CHANGELOG.md` |
| Screen capture | `media/generate-from-panel.mp4` |
| Support | GitHub issues on the repository above |

Long description (paste as is):

> Forge by three.ws turns a text prompt or a reference image into a textured 3D
> model and references it into the open USD stage. The import reads the stage's
> up axis and meters per unit, so a one meter model is one meter in a Z-up
> centimeter stage too, and it lands at the world origin, the selected prim or in
> front of the camera. Jobs run asynchronously with live progress and cancel, so
> Kit never blocks. A My models browser imports any model saved in your three.ws
> account, decoding web-optimized GLBs (meshopt, quantized attributes, WebP
> textures) locally so the Kit asset converter can read them. It signs in with a
> three.ws API key from a free account, stored in Kit settings and never logged.

Copy rules for anything sent to NVIDIA: describe what the extension does, never
imply NVIDIA endorsement, and keep pricing and account billing out of the
listing text and images.

## 4. GitHub topic

Exchange and the community lists find Kit extensions by the
`omniverse-kit-extension` GitHub topic. Add it to the repository that hosts the
extension:

```bash
gh repo edit nirholas/three.ws --add-topic omniverse-kit-extension
```

If the extension later moves to its own repository, add the topic there instead
and update `repository` in `config/extension.toml` and the table above.

## 5. After the listing is live

- Bump `version` in `config/extension.toml` and add a `docs/CHANGELOG.md`
  section for every release, then submit the new archive the same way.
- Update the Omniverse Exchange row in
  [docs/nvidia-visibility-map.md](../../../docs/nvidia-visibility-map.md).
