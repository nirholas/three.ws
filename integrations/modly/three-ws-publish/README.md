# Publish to three.ws (Modly process node)

A [Modly](https://github.com/lightningpixel/modly) workflow node that saves the
mesh coming out of any Modly node into your three.ws account. The model gets
its own page at `three.ws/avatars/<id>` with a 3D viewer, an embed snippet, and
everything else a dashboard upload gets (humanoid meshes are auto-rigged).

The mesh passes through unchanged, so the node can sit in the middle of a
workflow. Its text output is the new model's page URL, and the same URL is
written to Modly's run log.

Use this node to publish any GLB from any generator, including meshes Modly
made on your own GPU with its local models. The [three.ws Cloud
extension](../three-ws/) in this folder also has a `publish` node; that one is
meant as the last step of a three.ws chain (generate, rig or remesh on three.ws
GPUs, then publish). Install this standalone node when you only want
publishing, or when the rest of your workflow runs locally.

Modly is MIT licensed, by [Lightning Pixel](https://github.com/lightningpixel).

## Install

1. Copy this folder somewhere permanent:

   ```bash
   git clone --depth 1 https://github.com/nirholas/three.ws /tmp/three.ws
   cp -r /tmp/three.ws/integrations/modly/three-ws-publish ~/modly-three-ws-publish
   ```

2. In Modly open the **Models** page, click **Link local folder**, and pick
   `~/modly-three-ws-publish`. Modly links the folder in place (so keep it) and
   reads `manifest.json` from its root.
3. The node appears in the workflow editor as **Publish to three.ws**.

The three.ws Forge desktop app (`apps/forge-desktop`) ships this node built
in, signed in with your account, so there is nothing to install there.

## Use

1. Create an API key with the `avatars:write` scope at
   <https://three.ws/dashboard/api>.
2. Wire a mesh node (for example **Generate Mesh**) into **Publish to three.ws**.
3. Set the node's fields:

   | Field | Default | Meaning |
   |---|---|---|
   | Name | file name | Title on three.ws |
   | Visibility | `private` | `private`, `unlisted` (anyone with the link) or `public` (listed) |
   | Tags | `modly` | Comma separated, up to 20 |
   | API Key | empty | Paste once. It is saved to your user profile, so you can clear the field before sharing the workflow |

4. Run the workflow. The node's output text is the page URL, for example
   `https://three.ws/avatars/be5ac3e2-40dc-4645-a8bb-9789f97edcf2`.

### Where the API key comes from

The first non-empty source wins:

1. The node's **API Key** field. A typed key is also saved to
   `$XDG_CONFIG_HOME/three-ws/modly-api-key` (Linux/macOS, default
   `~/.config`, file mode 600) or `%APPDATA%\three-ws\modly-api-key` (Windows).
2. The `THREE_WS_API_KEY` environment variable. The Forge desktop app injects
   its signed-in account's key here.
3. The saved key file from step 1.

`THREE_WS_BASE_URL` points the node at another deployment (default
`https://three.ws`).

## Limits and errors

- The input must be a `.glb`. Place the node before any export to another
  format.
- Files up to 50 MB go through the three.ws upload proxy; larger files (up to
  the account's plan limit) use a presigned direct upload.
- A refused key reports that it may be revoked, expired, or missing
  `avatars:write`, with the link to create a new one. Plan quota errors are
  shown as three.ws reports them.

## How it runs

Modly runs process extensions as a Python subprocess
(`electron/main/process-runner.ts`):

- **stdin:** one JSON line,
  `{"input": {"filePath": "..."}, "params": {...}, "workspaceDir": "...", "tempDir": "..."}`.
  A relative `filePath` resolves against `workspaceDir`.
- **stdout:** JSON lines, `{"type": "progress", "percent": 30, "label": "..."}`,
  `{"type": "log", "message": "..."}`, then `{"type": "done", "result": {"filePath": "...", "text": "<page url>"}}`
  or `{"type": "error", "message": "..."}`.

The node is standard library only, so it runs on Modly's bundled Python with
no setup. You can drive it by hand the same way Modly does:

```bash
echo '{"input":{"filePath":"/path/to/model.glb"},"params":{"visibility":"private"},"workspaceDir":"/tmp","tempDir":"/tmp"}' \
  | THREE_WS_API_KEY=sk_live_... python3 processor.py
```

## Files

| File | Role |
|---|---|
| `manifest.json` | Modly extension manifest (`"type": "process"`, one `publish` node) |
| `processor.py` | The node: key resolution, input checks, upload, progress |
| `three_ws_client.py` | Vendored copy of `integrations/_pyclient/three_ws_client.py`; `publish_glb` does the upload and create. Never edit it here: edit the canonical file and re-copy (`integrations/_pyclient/test_no_drift.py` fails on drift) |
| `test_processor.py` | Spawns `processor.py` exactly like Modly against a local stand-in server: `python3 -m pytest test_processor.py` |
