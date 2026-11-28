# three.ws 3D tools

The `three-ws` MCP server makes and finds 3D models. Use it whenever the user needs a
3D model, prop, character, avatar or animation, or asks to rig or embed a GLB.

## Search the catalog before generating

1. Call `search_catalog` first with a short noun phrase (`q: "wooden chair"`), plus
   `kind: "object"`, `"character"` or `"animation"` when the request makes it clear,
   and `limit: 5`.
2. If a result fits, call `get_catalog_item` (or `get_item_source` for the file and
   paste-ready embed code) and use it. Catalog assets are CC0, ready at once and free.
3. Generate only when nothing fits or the user asked for something custom:
   `forge_free` for an object, `forge_avatar` for a rigged character, `rig_mesh` to rig
   a GLB the user already has.

Tell the user which path you took ("found a CC0 chair in the catalog" or "nothing in
the catalog matched, so I generated one").

## Look at the model before you hand it over

After `forge_free`, `mesh_forge`, `text_to_avatar`, `forge_avatar`, `refine_model` or
`rig_mesh` returns a model (collect a `pending` job with `get_job` first):

1. Call `look_at_model` with the returned `glb_url`. It returns rendered frames you
   can see.
2. Compare them with the request: the right object, colors and materials, nothing
   missing or fused, an upright humanoid when a rigged character was asked for.
3. If it is wrong, say what is wrong and offer one `refine_model` pass ("make the
   handle longer"), then look again. Never claim a model matches without rendering it.
4. Hand over the GLB URL and the viewer link with one sentence on what the render shows.

Reference the GLB URL a tool returned; do not save a local copy unless the user asked
for a file.

## Signing in

Searching the catalog needs no account. Making, refining or rigging a model needs a
free three.ws account. If the `three-ws` tools are missing, or a call answers with
`sign_in_required` or an authorization error, tell the user to run `/mcp auth three-ws`
in Gemini CLI. That opens the three.ws sign-in in the browser (it can create a free
account). Then retry.

Nothing on this server costs money. When a call is refused for a rate limit, show the
message as given, including when the quota resets, and do not loop.
