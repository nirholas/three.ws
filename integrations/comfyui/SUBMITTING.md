# Publishing the three.ws nodes to the Comfy Registry

The node pack in [`three_ws_nodes/`](three_ws_nodes/) is ready to publish. Its
metadata follows the [Registry specification](https://docs.comfy.org/registry/specifications)
and the [publishing guide](https://docs.comfy.org/registry/publishing). Once it
is on the Registry, ComfyUI Manager lists it automatically.

| Field | Value |
|---|---|
| Node id (`[project] name`, immutable) | `comfyui-three-ws` |
| Publisher id (`[tool.comfy] PublisherId`, immutable) | `threews` |
| Display name | `Forge by three.ws` |
| Version | `1.0.0` |
| License | Apache-2.0 (`three_ws_nodes/LICENSE`) |
| Icon | <https://three.ws/apple-touch-icon.png> (180x180 PNG) |

Both ids were confirmed unclaimed on 2026-09-17
(`https://api.comfy.org/nodes/comfyui-three-ws` and
`https://api.comfy.org/publishers/threews` returned 404).

## What was already validated

- `comfy node validate` (comfy-cli, run from `three_ws_nodes/`) passes: the
  config parses and the ruff security rules (S102, S307, E702) report nothing.
- The package imports as a plain Python package and exposes
  `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS` with both nodes.
- The node smoke test (`python -m unittest test_nodes`) and the shared client
  suite pass against an in-process stub of the Forge contract.

## Owner steps

These need a human account, so they are the only steps left.

1. **Create the publisher.** Sign in at <https://registry.comfy.org> (GitHub or
   Google login) and create a publisher with the id **`threews`** exactly. The
   id is permanent and must match `PublisherId` in `pyproject.toml`. If
   `threews` is taken by the time you register, pick another id and change
   `PublisherId` to match before publishing.
2. **Create an API key.** On the publisher page, open **API Keys**, create a
   Registry Publishing key, and store it in the password manager. It is shown
   once.
3. **Install comfy-cli** somewhere outside the repo, for example
   `pipx install comfy-cli && pipx inject comfy-cli ruff` (ruff is what
   `comfy node validate` shells out to).
4. **Publish from the node folder** on a clean checkout of `main`:

   ```bash
   cd integrations/comfyui/three_ws_nodes
   comfy node validate
   comfy node publish --changelog "First release: Text to 3D and Image to 3D nodes backed by Forge by three.ws"
   ```

   Paste the API key when prompted (right-click paste on Windows; Ctrl+V can
   append a stray control character). comfy-cli zips only git-tracked files in
   this folder, minus `.comfyignore`, so commit everything first. The command
   leaves a `node.zip` behind; delete it, it must never be committed.

## Post-publish verification

1. `curl -s https://api.comfy.org/nodes/comfyui-three-ws` returns JSON with
   `"id":"comfyui-three-ws"` and `latest_version.version` of `1.0.0`.
2. <https://registry.comfy.org/nodes/comfyui-three-ws> renders the page with the
   three.ws icon, description, and repository link.
3. Wait for the Registry's automated scan to mark the version active (it shows a
   status badge on the page; a flagged version does not appear in Manager).
4. In a fresh ComfyUI: **Manager > Custom Nodes Manager**, search `three.ws`,
   install, restart. Confirm the **three.ws** category holds both nodes.
5. Queue **three.ws Text→3D** with the default prompt on the `image` pipeline.
   It must finish with status `done` and a `.glb` path in ComfyUI's output
   directory. That completed generation is the success evidence recorded in
   `marketing/growth/opportunities.csv`; update that row to `live` with the
   Registry URL.

## Releasing updates

Bump `version` in `pyproject.toml` (semantic versioning; the Registry rejects a
version it already has), commit, and rerun `comfy node publish` from the same
folder.
