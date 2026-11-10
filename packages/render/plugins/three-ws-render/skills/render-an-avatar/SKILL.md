---
name: render-an-avatar
description: Render a rigged or static glTF/GLB avatar to a PNG, an animated PNG or terminal output with no GPU, WebGL or headless browser, using @three-ws/render. Use when the user wants a thumbnail, turntable or animation frame of a GLB, or a preview of a model in the terminal.
---

# Render a GLB with @three-ws/render

`@three-ws/render` is a pure JavaScript software rasterizer for glTF/GLB with skinning and animation. It needs no GPU, no WebGL and no browser, so it runs in CI, servers and sandboxes. Node 20+.

## CLI

```bash
npx @three-ws/render <model.glb | url> [options]
```

| Flag | Meaning |
|---|---|
| `--out <file>` | Write a PNG (animated PNG when `--frames` is above 1). Without it the avatar is drawn in the terminal. |
| `--width <n>`, `--height <n>` | Output size in pixels. |
| `--focus <mode>` | `full`, `bust` or `head` (default `full`). |
| `--preset <name>` | `studio`, `terminal` or `daylight`. |
| `--clip <name or index>` | Clip to play, from the model or `--animation`. |
| `--animation <file>` | GLB or clip JSON to retarget onto this rig. |
| `--frames <n>`, `--fps <n>` | Frame count and rate (default 1, or 36 with `--spin`, `--clip` or `--loop`; 20 fps). |
| `--spin <deg>` | Turntable degrees across the loop. |
| `--yaw <deg>`, `--pitch <deg>` | Camera angles (default 26 and 6). |
| `--bg <color>` | Hex colour or `transparent`. |
| `--loop` | Keep animating in the terminal until interrupted. |
| `--blocks` | Force half-blocks even where inline images work. |
| `--clips` | List the model's clips and exit. |

## JS API

```js
import { renderAvatar, encodePng, encodeApng } from '@three-ws/render';
import { writeFile } from 'node:fs/promises';

const { frames } = await renderAvatar('model.glb', { width: 512, height: 512, focus: 'bust' });
await writeFile('avatar.png', encodePng(frames[0]));
```

Other exports: `AvatarModel.load(source)`, `model.play(clip)`, `model.setTime(s)`, `renderFrame(model, options)`, `renderFrames(model, options)`, `encodeApng(frames, { fps })`, `toHalfBlocks`, `toKitty`, `toITerm`, `detectTerminal`, `parseGlb`, `packGlb`, `retargetClip`, `normalizeBoneName`. `source` is a URL, a file path, an ArrayBuffer or a typed array. Frames are `{ width, height, data }` with straight-alpha RGBA. Hold the `AvatarModel` when rendering one avatar many times: decoding dominates the first render.

## Limits

It is a CPU rasterizer, not a path tracer: expect software-render speed and see the README's "What it does not render" section before promising a material effect. Meshopt-compressed and quantized glTF load fine. Draco geometry throws (re-export with `gltfpack -cc`), KTX2 textures fall back to the base colour, morph targets are not evaluated (skeletal animation is), and PBR is approximated with a studio light rig.

## Worked example

1. `npx @three-ws/render avatar.glb --clips` to list animations.
2. `npx @three-ws/render avatar.glb --clip walk --frames 24 --width 288 --height 288 --out walk.png` for an animated PNG.
3. `npx @three-ws/render avatar.glb --spin 360 --frames 36 --out spin.png` for a turntable.
