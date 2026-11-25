# Terminal renderer

`curl three.ws/tty` streams a 3D model into your terminal. `curl three.ws/tty/walk`
is a person, walking, in profile.

The drawing uses no GPU. There is no WebGL in the terminal, and nothing to
install for the curl stream. A software rasterizer decodes the model, evaluates
its animation, blends the joint matrices per vertex on the CPU, and rasterizes
triangles into a buffer the size of your terminal. Then it writes the result as
coloured text. Making a new model, further down, is a separate step that runs
on the three.ws generator.

```bash
curl three.ws/tty
```

Press Ctrl-C to stop it. It works in any terminal that renders colour: macOS
Terminal, iTerm2, Windows Terminal, GNOME Terminal, Alacritty, WezTerm, tmux, a
VS Code terminal, an SSH session on a box with no display.

## Why it exists

three.ws gives AI agents a body. AI agents increasingly live in a terminal. This
closes the gap: the same avatar that renders in WebGL on a web page renders in
the shell where the agent actually runs, with no client to install and no
graphics stack to negotiate.

It is also useful on its own. A rigged character, animating, is a good way to
check what a GLB actually contains before you wire it into anything.

## Make a model, then draw it

The [/tty](/tty) page builds a model and draws it in the same panel. Type a
prompt, choose a photo, or choose a video. A video contributes one frame, at
most 1280 pixels wide, and that frame is reconstructed as an object. A full
walkthrough cloud is [Capture](/capture). The generator is the same free lane
as [Forge](/forge) and [Image to 3D](/image-to-3d), and it needs a free account.
When the GLB is ready the panel opens `GET /api/tty?src=` on that URL.

The CLI does the same three things from a folder on your machine. It uploads,
waits, then draws. Create a key at [/dashboard/api-keys](/dashboard/api-keys)
and export it as `THREE_WS_API_KEY`.

```bash
three-tty --prompt "a ceramic teapot"
three-tty ./photo.jpg
three-tty ./clip.mp4
three-tty --find
three-tty ~/Pictures
```

`--find`, and a directory argument, use the newest photo in that folder. A
video needs `ffmpeg` on the machine so one frame can be read. The drawing
after that is still the CPU rasterizer.

## The endpoint

`GET /api/tty` streams frames as `text/plain`, paced in real time, so the
response body *is* the animation. It starts drawing before the model has finished
loading. Every parameter is optional.

| Parameter | Meaning | Default |
| --- | --- | --- |
| `avatar` | A public three.ws avatar id. The path form `/tty/<id>` sets this. | the default model |
| `src` | Any public GLB URL. | none |
| `w`, `h` | Columns and rows. One row is two vertical pixels. | 76 x 30 |
| `frames` | How many frames to send. `1` gives a still image. | 8 seconds worth |
| `fps` | Frames per second, 4 to 30. | 18 |
| `t` | Where in the clip to start, in seconds. | 0 |
| `spin` | Turntable speed in radians per second. `0` holds still. | 0.9 |
| `clip` | Animation name to play. | the first clip |
| `color` | `truecolor`, `ansi256`, or `mono`. | `ansi256` |
| `zoom` | 1 fits the model, higher moves closer. | 1 |
| `pitch` | Camera elevation in radians. | 0.08 |
| `yaw` | Camera azimuth in radians. Added to `spin` each frame. | 0, or the scene's own |
| `scene` | A named picture. The path `/tty/<scene>` sets this. `src` wins when both are set. | the model |
| `style` | `half`, `braille`, `density`, `ascii`, `matrix`, or `points`. | `half` |
| `text` | Words drawn above the walker for `say`. A POST body is read the same way. | `gm` |

`walk`, `orbit`, `parade`, `meet`, `birds`, `donut`, `shader`, `draw`, `splats`,
and `say` are reserved names. Avatar ids are UUIDs, so a real avatar is never
one of these. An explicit `scene` that is not one of those names is a 400.
A browser asking for it is sent to `/tty` instead of a wall of escape codes.

```bash
# a person, walking, in profile
curl -L three.ws/tty/walk

# a flock, a lit torus, a raymarched solid, a counted point garden
curl -L three.ws/tty/birds
curl -L three.ws/tty/donut
curl -L three.ws/tty/shader
curl -L three.ws/tty/splats

# two walks, then two characters in one frame
curl -L three.ws/tty/parade
curl -L three.ws/tty/meet

# words above the walker. echo works if you POST the body.
curl -L 'three.ws/tty/say?text=gm'
echo gm | curl -L --data-binary @- three.ws/tty/say

# a specific avatar, wider, held still instead of spinning
curl 'three.ws/tty/8f2c1a90-1c4e-4b2b-9d77-3f0a1b2c3d4e?w=110&spin=0'

# any public GLB
curl 'three.ws/tty?src=https://example.com/robot.glb&frames=120'

# one frame of plain ASCII, for a README, a commit hook, or a motd
curl 'three.ws/tty?frames=1&color=mono&w=60'
```

Colour defaults to 256 rather than truecolor on purpose. `curl` forwards neither
`COLORTERM` nor `TERM`, so the server cannot know what you are running, and
guessing truecolor wrong sprays literal escape sequences across your screen.
Pass `color=truecolor` if you know your terminal handles it.

A browser asking for `/tty` gets [the page](https://three.ws/tty) instead of the
stream, because a browser renders escape codes as literal garbage. Add `?raw=1`
to see the bytes anyway.

### Limits

40 streams per IP per 10 minutes, in their own bucket so a terminal stream and a
browser render never starve each other. A single stream is capped at 600 frames
or 45 seconds. Private avatars never render: the endpoint is unauthenticated, so
it only serves models that are already public.
A remote `src` model is fetched through the pinned, per-hop validated SSRF
fetcher with a 64 MiB cap: a URL that resolves to a private or internal address
is refused with `400 blocked_url`, and a model that cannot be read answers
`502 model_unavailable` without upstream detail.

## Running it locally

The renderer is published as [`@three-ws/tty-3d`](https://www.npmjs.com/package/@three-ws/tty-3d).

```bash
# a local file
npx @three-ws/tty-3d ./avatar.glb

# anything on the web
npx @three-ws/tty-3d https://three.ws/avatars/default.glb --spin 1.4

# a still frame, piped somewhere
npx @three-ws/tty-3d avatar.glb --once --width 80 --color mono > frame.txt
```

Arrow keys orbit, `w`/`s` tilt, `+`/`-` zoom, space pauses, `q` quits.

Piping is safe: when stdout is not a terminal the default is a single frame, not
an infinite animation, so redirecting to a file terminates.

### As a library

```js
import { loadModel, createRenderer } from '@three-ws/tty-3d';

const model = await loadModel('./avatar.glb');   // path, https URL, or bytes
const renderer = createRenderer(model, { width: 80, height: 40 });

process.stdout.write(renderer.frame(1.25));      // one string per frame
```

`frame(time)` is pure: the same time always renders the same string. Full API in
the [package README](https://github.com/nirholas/three.ws/tree/main/packages/tty-3d).

## How it works

**Half blocks, not ASCII art.** Each cell is a `▀` with its own foreground and
background colour, so one character carries two independently coloured pixels.
That doubles vertical resolution and makes pixels square, because terminal cells
are roughly 1:2. It is why a sphere comes out round rather than squashed.
`style=braille` uses a 2x4 dot cell, `density` uses block glyphs, `ascii` uses a
luminance ramp, `matrix` tints the frame green, and `points` plots vertices.

**Scenes are the same rasterizer.** `walk` plays the cesium-man clip from the
side, because that mesh reads as a blob from the front. `orbit` turns the same
clip. `parade` plays that walk, then the fox. `meet` draws both into one frame,
with the fox scaled to the walker's height. `birds` is a flock of a few dozen
chevrons. `donut` is a lit torus. `shader` raymarches a torus blended with a
sphere, and the stream runs slower on purpose (8 fps unless you ask otherwise).
`draw` revolves a 2D profile into a solid. `splats` is a generated garden, and
the banner states the real point count. `say` draws the words you pass above
the walker.

**Real skinning.** Joint matrices are evaluated per frame from the glTF animation
samplers and blended per vertex, so a rigged avatar moves its limbs. It is not a
spinning static mesh. `EXT_meshopt_compression` is decoded on the way in, because
most three.ws avatars ship compressed and a reader that skips the decoder reads
garbage vertex data rather than failing.

**Framing that holds still.** The camera radius is fixed from the widest frame of
the clip while the centre tracks the current pose. Fitting each frame alone makes
the camera breathe as the silhouette changes; fitting the union of every frame is
worse on anything with root motion, because the union is a corridor as long as
the character walks.

**Silhouette-first shading.** A key light, a fill light, and a rim term. At this
resolution the outline carries the shape, so faces turning away from the camera
are lifted rather than crushed to black.

## Related

- [Widget types](/docs/widgets) puts a live WebGL agent on a web page.
- [Avatars](/avatars) is where the models come from.
- The [roadmap](https://github.com/nirholas/three.ws#roadmap) covers native
  home-screen widgets, the other surface where an agent shows up outside a browser.
