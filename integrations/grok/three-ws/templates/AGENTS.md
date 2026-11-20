## 3D assets (three.ws)

This project gets its 3D models from three.ws through the `three-ws` MCP server (installed by the three-ws Grok Build plugin). three.ws supplies the GLB files; this project's own code loads and displays them.

### Getting a model

1. Search the free catalog first with `search_catalog`; catalog search needs no account. The catalog holds CC0 props, rigged characters and motion clips. Use `get_item_source` with the framework this project uses to get paste-ready code.
2. Only when nothing fits, generate: `forge_free` for an object or prop, `forge_avatar` for a rigged humanoid character, `rig_mesh` to rig a GLB we already have. These need a free three.ws account; if a tool answers `sign_in_required`, sign in from `/mcps` (select `three-ws`, press `i`).
3. Always pass an `idempotency_key` to a generator and reuse it on a retry, so a retry never starts a second generation. Poll `get_job` with the returned `job_id`, waiting the `eta_seconds` it reports between calls. Stop polling after 10 minutes and report the `job_id`.
4. Before using a generated model, call `look_at_model` on it and check the render: the subject is complete, the back is finished, nothing is fused. If it is wrong, use `refine_model` once with a specific instruction naming the fault.

### Loading a GLB in this project

- Reference GLBs by their returned `https://` URL, or download them into the assets folder and commit them. Keep the original URL in a comment or a manifest next to the file so the source is traceable. A downloaded file is served by this project's own host, so it needs no CORS setup.
- With Three.js, load through `GLTFLoader` with both decoders registered, because three.ws can deliver Draco or meshopt-compressed variants as well as plain GLB:

  ```js
  import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
  import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
  import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  const loader = new GLTFLoader().setDRACOLoader(draco).setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(glbUrl);
  scene.add(gltf.scene);
  ```

  With React Three Fiber, `useGLTF(glbUrl)` from `@react-three/drei` registers both decoders for you.
- Without Three.js: use `<agent-3d>` for a character (the pinned version with its `integrity` hash, as the `/embed` command prints it) and `<model-viewer>` for an object. Load each viewer script once per page.
- Keep runtime models small: the `draft` or `standard` tier for background props, `high` only for a hero model.
- Give every model element an accessible name (`alt` on `<model-viewer>`) and a fixed height so the page does not jump while the GLB loads.

### Keeping keys out of client code

- Displaying a GLB needs no key: the URLs three.ws returns are public. Only generation and rigging need a three.ws account.
- If this project calls three.ws from its own code (not through Grok), the API key lives on the server only: an environment variable such as `THREE_WS_API_KEY` read by a backend route or serverless function that calls `https://three.ws/api/...` and returns the GLB URL to the browser.
- Never put the key in browser code, in an environment variable the bundler inlines into the client (`VITE_`, `NEXT_PUBLIC_`, `PUBLIC_`, `REACT_APP_` prefixes), in a committed `.env` file, or in a URL query string. Keep `.env` in `.gitignore`.
- Grok's own MCP connection signs in with OAuth and keeps its token itself; nothing about it belongs in this repository.
