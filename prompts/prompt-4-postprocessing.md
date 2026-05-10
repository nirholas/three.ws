# Task: Replace Three.js Post-Processing with pmndrs/postprocessing

## Project overview

This is a Three.js / Vite app at `/workspaces/3D-Agent`. The frontend is vanilla JS modules + Vite (`npm run dev` on port 3000). The main viewer is `src/viewer.js` (~1,720 lines). The marketplace lobby is `src/marketplace-lobby.js` (275 lines).

## What this task does

**@pmndrs/postprocessing** is a post-processing library built specifically for Three.js. Compared to Three.js's built-in `EffectComposer` (from `three/addons/postprocessing/`), it:

1. **Merges shader passes** — multiple effects (bloom, vignette, depth-of-field) compile into a single fullscreen shader program instead of N separate render passes. This is a significant performance win.
2. **Correct alpha compositing** — the library handles alpha output correctly, which matters for the avatar viewer where the canvas background is transparent.
3. **Selective bloom via layers** — objects can be assigned to a bloom layer (Three.js Layer system) so only specific objects (e.g. podium rings, avatar outline glow) bloom, not the whole scene.

The current codebase does **not** use any post-processing. This task adds it to both the main viewer and the marketplace lobby, enabling selective bloom on avatar podium rings and a subtle vignette on the main viewer.

## Part A: Main Viewer (`src/viewer.js`)

### Install

```bash
npm install postprocessing
```

The package name is `postprocessing` (npm) — the import is also `import { ... } from 'postprocessing'`.

### Add to `src/viewer.js`

#### Step 1 — Import at top of file

```js
import {
  EffectComposer,
  RenderPass,
  BloomEffect,
  VignetteEffect,
  EffectPass,
  SelectiveBloomEffect,
} from 'postprocessing';
```

Do not import `EffectComposer` from `three/addons` — the `postprocessing` package provides its own.

#### Step 2 — Create composer after renderer setup

In the `Viewer` constructor, after `this.renderer` is set up and `this.scene` / `this.defaultCamera` exist, add:

```js
this._composer = new EffectComposer(this.renderer);
this._renderPass = new RenderPass(this.scene, this.defaultCamera);
this._composer.addPass(this._renderPass);

// Subtle vignette — darkens edges, focuses attention on avatar center
const vignetteEffect = new VignetteEffect({ eskil: false, offset: 0.35, darkness: 0.4 });

// Bloom — low intensity, wide radius, for specular highlights on metallic avatars
const bloomEffect = new BloomEffect({
  intensity: 0.6,
  luminanceThreshold: 0.8,  // only pixels brighter than 80% luminance bloom
  luminanceSmoothing: 0.05,
  mipmapBlur: true,          // faster than the default multi-pass blur
});

this._effectPass = new EffectPass(this.defaultCamera, bloomEffect, vignetteEffect);
this._effectPass.renderToScreen = true;
this._composer.addPass(this._effectPass);
```

#### Step 3 — Replace `renderer.render()` calls with `composer.render()`

Search `src/viewer.js` for every call to `this.renderer.render(`. Replace each one with `this._composer.render()`. The composer internally calls `renderer.render(scene, camera)` for you via the `RenderPass`.

**Exception**: The screenshot / capture methods (`takeScreenshot`, `captureScreenshot` in `src/viewer/screenshot.js`) should keep using `this.renderer.render(...)` directly — they write to a separate canvas and compositing there would add noise. Leave those untouched.

**Exception**: The axes renderer (a secondary `WebGLRenderer` for the mini axes display) — this is a separate renderer, leave it alone.

#### Step 4 — Update camera when active camera changes

The `RenderPass` and `EffectPass` reference the camera. When `this.activeCamera` is updated (search for `this.activeCamera =` in the file), also update the passes:

```js
// Wherever this.activeCamera is reassigned:
this.activeCamera = newCamera;
this._renderPass.mainCamera = newCamera;
this._effectPass.mainCamera = newCamera;
```

#### Step 5 — Handle resize

In the resize handler (wherever `this.renderer.setSize` is called), also resize the composer:

```js
this.renderer.setSize(width, height);
this._composer.setSize(width, height);
```

#### Step 6 — Dispose in viewer cleanup

In the `dispose()` or `destroy()` method of the viewer, add:

```js
this._composer?.dispose();
```

## Part B: Marketplace Lobby (`src/marketplace-lobby.js`)

The lobby already renders a custom Three.js scene with the glowing podium ring material. Add selective bloom to make the ring's emissive glow actually appear to bloom without blooming the avatars.

### Three.js Layer system for selective bloom

Three.js has a built-in layer system (`Object3D.layers`). By default every object is on layer 0. Put objects that should bloom on layer 1.

#### Step 1 — Import from postprocessing

Add to imports at top of `marketplace-lobby.js`:

```js
import {
  EffectComposer,
  RenderPass,
  SelectiveBloomEffect,
  EffectPass,
} from 'postprocessing';
```

#### Step 2 — Create composer in `mountLobby`

After the renderer is set up:

```js
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

// Selective bloom — only objects on layer 1 bloom
const bloomEffect = new SelectiveBloomEffect(scene, camera, {
  intensity: 1.8,
  luminanceThreshold: 0.05,
  luminanceSmoothing: 0.3,
  mipmapBlur: true,
  selection: [],  // will be populated when podiums are created
});

const effectPass = new EffectPass(camera, bloomEffect);
effectPass.renderToScreen = true;
composer.addPass(effectPass);
```

#### Step 3 — Assign bloom layer to podium rings

In `makePodium()`, after creating the `ring` mesh, assign it to layer 1 and add it to the bloom selection:

```js
ring.layers.enable(1);
```

Return the ring mesh from `makePodium()` so `mountLobby` can add it to `bloomEffect.selection`. Change `makePodium()` signature to return `{ group, ring }` and collect all rings:

```js
const bloomSelection = [];

const slotMeta = slots.map((_, i) => {
  const x = startX + i * SLOT_SPACING;
  const { group: podium, ring } = makePodium();
  podium.position.set(x, 0, 0);
  podiumGroup.add(podium);
  bloomSelection.push(ring);
  // ...
});

bloomEffect.selection.set(bloomSelection);
```

#### Step 4 — Replace `renderer.render()` in the tick loop

```js
// Before:
renderer.render(scene, camera);

// After:
composer.render();
```

#### Step 5 — Handle resize

```js
function resize() {
  // ... existing ...
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  // ...
}
```

#### Step 6 — Dispose in `dispose()`

```js
composer.dispose();
```

## Constraints

- **Do not change the visual feel** of the scene beyond adding bloom glow to emissive surfaces. Bloom intensity should be conservative — this is a professional avatar marketplace, not a game. If bloom makes the scene look garish, reduce `intensity`.
- **Do not add depth-of-field** — it causes motion sickness on interactive 3D and does not apply here.
- **Screenshot capture** paths in the viewer must continue to work — they use `renderer.render()` directly and must not be changed.
- **The lobby's `dispose()` function** must clean up all new resources (composer, effect pass). No GPU leaks.
- **The `makePodium` function signature change** must not break anything — it is only called within `mountLobby`.
- All imports must work with Vite's ESM bundler. `postprocessing` ships ES modules — no special Vite config should be needed.
- Do not change any existing lighting, geometry, camera, or control logic.

## Definition of done

- `npm install` runs without errors (`postprocessing` in package.json).
- `npm run dev` starts on port 3000.
- Main viewer: load an avatar — it renders with a subtle vignette darkening the edges. No bloom on the avatar body (luminance threshold is set above normal surface brightness). Specular highlights on metallic parts may show mild bloom.
- Marketplace lobby: podium rings show a soft cyan glow/bloom around them. Avatar meshes do not bloom.
- No console errors in either scene.
- Screenshot / capture functionality in the main viewer still produces a clean image.
- `git diff` shows only `src/viewer.js`, `src/marketplace-lobby.js`, `package.json`, `package-lock.json`.
