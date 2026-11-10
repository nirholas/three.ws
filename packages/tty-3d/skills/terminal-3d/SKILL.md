---
name: terminal-3d
description: Render a rigged, animated GLB as coloured ANSI text in a terminal with no GPU or browser. Use to preview a 3D model or avatar over SSH or in CI, capture a still ASCII frame, or inspect a GLB's skeleton and animation clips.
---

# Terminal 3D

`@three-ws/tty-3d` is a software rasterizer with real glTF skeletal animation. GLB in, ANSI frames out. Node 18+, no GPU, no display server. `EXT_meshopt_compression` is decoded.

## CLI

```bash
npx @three-ws/tty-3d ./avatar.glb
npx @three-ws/tty-3d https://example.com/model.glb --spin 1.4
```

The installed binary is `three-tty`:

```bash
three-tty model.glb --info                                    # print what was loaded as JSON, then exit
three-tty model.glb --once --width 72 --color mono > frame.txt # one plain ASCII frame
three-tty model.glb --frames 200 --fps 25                      # 8 seconds, then exit
```

Options: `--width`, `--height` (one row is two vertical pixels), `--fps` (24), `--spin` (radians per second, 0 holds still), `--clip <name|n>`, `--no-anim`, `--once`, `--frames <n>`, `--time <s>`, `--pitch`, `--zoom`, `--color truecolor|ansi256|mono`, `--transparent`, `--info`.

Piping is safe: when stdout is not a TTY the default is a single frame, so redirects terminate. Interactive keys: arrows or a/d orbit, w/s tilt, +/- zoom, space pauses, q quits.

## Library

```js
import { loadModel, createRenderer, describeModel } from '@three-ws/tty-3d';

const model = await loadModel('./avatar.glb');   // path, https URL, or GLB bytes
describeModel(model);                            // triangles, skinned, animations, bounds
const renderer = createRenderer(model, { width: 80, height: 40, mode: 'mono' });
process.stdout.write(renderer.frame(1.25));      // one string per frame, time in seconds
```

`createRenderer` options include `width`, `height`, `animation` (clip name, index, or `false` for rest pose), `mode` and `background`.

## Worked example

To check a generated avatar animates: run `three-tty avatar.glb --info`, read the animation clip names, then `three-tty avatar.glb --clip <name> --once --color mono --width 80` and read the ASCII frame to confirm the pose. Pair with `@three-ws/see` when you need real images instead of text.
