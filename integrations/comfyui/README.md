# three.ws ComfyUI nodes

Two nodes that drive the Forge pipeline on three.ws from a ComfyUI graph:

- **three.ws Text→3D**: prompt in, `glb_path` out
- **three.ws Image→3D**: `IMAGE` in, `glb_path` out

The `glb_path` STRING output is a real `.glb` written to ComfyUI's output
directory. Feed it to any 3D node (for example ComfyUI-3D-Pack viewers and
savers) or keep it as the final artifact.

## Install from the Comfy Registry (recommended)

The node pack is published to the [Comfy Registry](https://registry.comfy.org)
as `comfyui-three-ws` under the `threews` publisher.

**ComfyUI Manager:** open **Manager > Custom Nodes Manager**, search for
`three.ws`, click **Install**, then restart ComfyUI.

**comfy-cli:**

```bash
comfy node install comfyui-three-ws
```

Restart ComfyUI. Both nodes appear under the **three.ws** category.

Registry page: <https://registry.comfy.org/nodes/comfyui-three-ws>

## Install from source

Copy the node folder into `ComfyUI/custom_nodes/`:

```bash
git clone --depth 1 https://github.com/nirholas/three.ws /tmp/three.ws
cp -r /tmp/three.ws/integrations/comfyui/three_ws_nodes ComfyUI/custom_nodes/three_ws_nodes
```

Restart ComfyUI. The nodes use only numpy and Pillow (already shipped with
ComfyUI) plus the Python standard library, so there is nothing else to install.

## Inputs

- **tier**: `draft` / `standard` / `high`.
- **pipeline**: `image` (free, FLUX→TRELLIS) or `geometry` (Meshy/Tripo, bring
  your own key).
- **backend**: `auto`, or a specific backend.
- **api_url**: defaults to `https://three.ws`.
- **provider_key**: required only for the geometry pipeline.

## Caching

ComfyUI re-runs a node only when its inputs change, and the node also
short-circuits to the on-disk GLB when an identical request was already
generated (status `cached`). Change any input to force a fresh generation.

## Package layout

`three_ws_nodes/` is the publishable node pack. It carries its own
`pyproject.toml` (Registry metadata), `LICENSE` (Apache-2.0, same as the
repository), and `.comfyignore` (keeps the stub-server smoke test out of the
published archive). Publishing steps for maintainers live in
[SUBMITTING.md](SUBMITTING.md).

## Notes

- Failures raise a clear `RuntimeError` (shown in the ComfyUI error toast). The
  node never emits a placeholder model.
- The Forge client (`three_ws_client.py`) is a vendored copy of
  `integrations/_pyclient/three_ws_client.py`; see the
  [integrations README](../README.md).
