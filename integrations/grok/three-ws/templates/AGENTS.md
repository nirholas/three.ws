## 3D assets (three.ws)

This project uses three.ws for 3D models through the `three-ws` MCP server (installed by the three-ws Grok Build plugin).

### Getting a model

1. Search the free catalog first with `search_catalog`; catalog search needs no account. The catalog holds CC0 props, rigged characters and motion clips. Use `get_item_source` with the framework this project uses to get paste-ready code.
2. Only when nothing fits, generate: `forge_free` for an object or prop, `forge_avatar` for a rigged humanoid character, `rig_mesh` to rig a GLB we already have. These need a free three.ws account; if a tool answers `sign_in_required`, sign in from `/mcps`.
3. Always pass an `idempotency_key` to a generator and reuse it on a retry, so a retry never starts a second generation. Poll `get_job` with the returned `job_id`, waiting the `eta_seconds` it reports between calls.
4. Before using a generated model, call `look_at_model` on it and check the render: the subject is complete, the back is finished, nothing is fused. If it is wrong, use `refine_model` once with a specific instruction naming the fault.

### Using a model in this project

- Reference GLBs by their returned `https://` URL, or download them into the assets folder and commit them. Keep the original URL in a comment or a manifest next to the file so the source is traceable.
- Keep runtime models small: prefer the `draft` or `standard` tier for background props and `high` only for a hero model.
- Characters: use the `<agent-3d>` element (pinned version with its `integrity` hash). Objects: use `<model-viewer>` or the project's existing Three.js loader. Load each viewer script once per page.
- Give every model element an accessible name (`alt` on `<model-viewer>`) and a fixed height so the page does not jump while the GLB loads.
- Never call a three.ws tool in a loop without a stop condition; stop polling a job after 10 minutes and report its `job_id`.
