# Task: Fix double model load in the validator

## Context

The project is three.ws — a platform for 3D AI agents.

The repo is at `/workspaces/3D-Agent`.

**What exists:**

- `src/validator.js` — Validates GLB/GLTF models: checks structure, materials, meshes, animations, ERC-8004 compliance. It runs as part of the agent "validate-model" skill.

- `src/viewer.js` — ~1200-line Three.js viewer. Loads and renders GLB files. Uses `GLTFLoader` internally.

- `src/agent-skills.js` — Built-in skills including `validate-model`. When triggered, it calls the validator.

**The problem:** When a model is loaded and then validated, the GLB is fetched and parsed **twice** — once by the viewer to display it, and once by the validator to analyze it. For a 10MB GLB file on a slow connection, this is a painful double-download.

The Three.js `GLTFLoader` has a built-in cache (`THREE.Cache`) that should prevent the second fetch if the URL is the same. But the validator likely creates its own `GLTFLoader` instance or fetches the file independently, bypassing the cache.

**The goal:** Make validation reuse the already-loaded model data from the viewer rather than reloading from the network.

---

## Before starting

Read these files in full to understand the actual code before proposing or making changes:

1. `src/validator.js` — understand how it loads models. Look for `fetch()`, `GLTFLoader`, `FileReader`, or any network call.
2. `src/viewer.js` — understand how the Viewer stores the loaded model. Look for `this.content`, `this._gltf`, or any post-load cached state.
3. `src/agent-skills.js` — see how `validate-model` calls the validator and what data it passes.
4. `src/runtime/tools.js` — see how the `validate` tool is invoked.

The specific fix depends on what the code actually does. This prompt describes two likely scenarios.

---

## Likely fix scenarios

### Scenario A: Validator calls `fetch()` independently

If `validator.js` contains a `fetch(url)` call to load the GLB:

Enable the Three.js cache before the validator runs:
```js
THREE.Cache.enabled = true;
```

The Viewer already loaded the model — if Three.js caching is on, the second load hits the memory cache instead of the network. This is a one-line fix.

Check if `THREE.Cache.enabled` is already set somewhere in `src/viewer.js`. If yes, the bug is elsewhere.

### Scenario B: Validator uses a separate GLTFLoader with no cache

If the validator creates a new `GLTFLoader()` without using `THREE.Cache`:

Pass the already-parsed GLTF object from the Viewer to the Validator instead of a URL:

```js
// In viewer.js, store the parsed GLTF after load
this._loadedGltf = gltf; // the result from GLTFLoader.load()

// In agent-skills.js or runtime/tools.js, pass it to the validator
import { Validator } from './validator.js';
const validator = new Validator();
await validator.validate(viewer._loadedGltf); // pass GLTF object, not URL
```

The validator needs to accept either a URL (fallback) or a pre-loaded GLTF object.

### Scenario C: Validator reads the file from R2/IPFS separately

If the validator fetches the model from a remote URL independently of the viewer:

Use the Viewer's `THREE.Cache` (which caches ArrayBuffers by URL). Or, more robustly: in the validate-model skill handler, extract the ArrayBuffer from the viewer's cache and pass it to the validator as a `Uint8Array`.

---

## What to do

1. Read the files listed above.
2. Identify which scenario applies (or a fourth scenario not listed).
3. Implement the minimal fix.
4. Add a comment explaining the optimization.

---

## Files to edit

Likely candidates (edit only what the fix requires):
- `src/validator.js`
- `src/viewer.js` (if storing cached GLTF state)
- `src/agent-skills.js` or `src/runtime/tools.js` (if changing how validator is called)

**Do not:**
- Refactor the Viewer class
- Change the Validator's public API signature beyond adding an optional parameter
- Touch `src/agent-avatar.js` or emotion logic

---

## Acceptance criteria

1. Load a GLB model in the viewer. Open the Network tab in DevTools. Trigger model validation (via the "validate-model" skill or the validate button in the UI).
2. The GLB file is **not** fetched a second time. Network tab shows zero new requests for the `.glb` URL after the initial load.
3. Validation results are identical to before — the same warnings/errors are reported.
4. `npx vite build` passes with no new warnings.
5. `node --check src/validator.js` passes.

## Constraints

- Surgical change only — touch the minimum number of lines.
- If the fix is a one-liner (`THREE.Cache.enabled = true`), do not refactor surrounding code.
- If passing the GLTF object, keep the URL-based path as a fallback (e.g. when called standalone without a viewer context).
- Do not change the Validator's return type or error format.
