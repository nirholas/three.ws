---
name: compose-ar-scene
description: Generate or find 3D models, arrange several into one scene and hand back links that open it in augmented reality on a phone, using the 3D AR Studio MCP server. Use when the user wants to see a model in their room, build an AR scene, or add AR to a web page.
---

# Compose AR scenes with 3D AR Studio

This plugin's `.mcp.json` starts `npx -y 3d-ar-studio-mcp` (server name `ar-studio`). It is free and keyless: no tool takes a credential. Requires Node.js.

Optional env vars (exported in the shell before starting Claude Code): `AR_STUDIO_PAGE_URL` (studio page used in links, default the hosted demo), `AR_STUDIO_ASSETS` (model catalogue URL, default the free CC0 library), `AR_STUDIO_MCP_ENDPOINT` (text-to-3D endpoint) and `AR_STUDIO_ORIGIN` (origin used for AR launch links, default `https://three.ws`).

## Tools

- `search_models`: `query` (words matched on name, category, tag), `limit` (1-50, default 12), optional `catalogue` URL. Searches a few hundred public-domain CC0 props. Search before generating.
- `generate_3d_model`: `prompt` (3-600 characters, ONE object or character), optional `kind` (`model` default, `avatar` for a rigged character, `mesh`) and `tier` (`draft`, `standard`, `high`). Returns the GLB URL plus an AR launch link, a viewer link and a studio link.
- `check_generation`: `job_id` from a generation that was still rendering. Call again until it returns the model.
- `compose_ar_scene`: `models` (1 to 20 entries of `src` https .glb URL, optional `title`, `x`, `z`, `yaw`, `scale` 0.25-4), optional `page_url` and `title`. Coordinates are metres: x is right, negative z is further away (default z is -1.6). Returns one link that reopens the exact arrangement.
- `export_ar`: `glb_url` (public https GLB or glTF), optional `title`, `kind`, `user_agent`. Returns a "View in your space" link that routes to Apple Quick Look on iOS, Google Scene Viewer on Android and a WebGL viewer on desktop.
- `create_ar_page`: optional `title`, `assets`, `accent`, `models`, `generate`. Returns a complete static HTML page embedding the studio. Save it as `index.html` and publish it on any static host.

## Workflow

1. For a common object call `search_models`. If nothing fits, call `generate_3d_model` with a single-object prompt. If the result is pending, poll `check_generation`.
2. For one model, call `export_ar` and give the user the AR launch link to open on their phone.
3. For several models, collect their GLB URLs and call `compose_ar_scene`, spacing them with `x` and `z`.
4. For "add AR to my site", call `create_ar_page` and write the returned `html` to a file.

Example: "put a lamp and a chair in my room" becomes `search_models` for `lamp` and `chair`, then `compose_ar_scene` with `models: [{"src": "<lamp glb>", "x": -0.6, "z": -1.6}, {"src": "<chair glb>", "x": 0.6, "z": -1.6}]`. Tell the user to open the link on a phone and tap Camera.

Only https `.glb` URLs can be placed. Generation prompts go to a public service, so keep them free of private details.
