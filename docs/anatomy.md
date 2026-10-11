# Anatomy

Describe a machine in one line and get an interactive isometric wireframe cutaway of it. Try it at [three.ws/anatomy](https://three.ws/anatomy):

> explain how a big airliner turbofan engine like the A380's makes thrust, interactive

The page writes the machine as a spec, draws it while it is being written, and saves it to a permalink (`/anatomy/<id>`). Every machine has:

- **Real 3D motion.** Individual parts spin, rock, pulse or run on true slider-crank travel. Children inherit their parent's motion, so blades turn with their shaft.
- **Shader effects.** WebGL shaders draw flame, exhaust plumes with shock diamonds, plasma, water, smoke, steam, sparks, electric arcs and glow.
- **Flows.** Particles stream along the real passages (air, fuel, coolant, current), with direction arrows.
- **A guided tour.** Each step frames the parts it explains and fades the rest.
- **Inspection tools.** Rotate, zoom, explode, section cut on any axis, x-ray, isometric/front/side/top views, a parts list grouped by system, click-to-read part descriptions, playback speed, a PNG export, fullscreen, keyboard control and light and dark themes.

## Using it

| Key | Action |
| --- | --- |
| Left / Right | Previous / next tour step |
| Esc | Leave the tour |
| E | Explode or collapse |
| X | X-ray |
| Space | Pause motion |
| Drag, scroll | Rotate, zoom |

On a phone the parts panel and tour sit under the stage.

## Agent skill

Anatomy ships as an open agent skill: [`.agents/skills/anatomy`](../.agents/skills/anatomy/SKILL.md). Any Claude surface that loads Agent Skills can answer "/anatomy how does a steam locomotive work" with a permalink. The skill's [reference.md](../.agents/skills/anatomy/reference.md) is generated from the same guide the server sends to its writer model (`node scripts/build-anatomy-skill.mjs`), and `tests/anatomy.test.js` fails if the two drift.

The skill has two paths:

1. **The agent writes the spec** following reference.md, then saves it with `POST /api/anatomy { action: "publish", spec, prompt }`.
2. **The server writes it** with `POST /api/anatomy { action: "generate", prompt }`.

## API

| Request | Response |
| --- | --- |
| `POST /api/anatomy { action: "generate", prompt, stream? }` | `{ design, warnings }`. With `stream: true`, Server-Sent Events: `stage`, `delta { text }`, `reset`, then `done { design, warnings }` or `error`. |
| `POST /api/anatomy { action: "publish", spec, prompt? }` | `{ design, warnings }`. No model call. |
| `GET /api/anatomy?id=<uuid>` | `{ design }` including the full spec. |
| `GET /api/anatomy?list=recent[&q=][&limit=]` | `{ designs, storage }`, newest first, without specs. |

Errors are JSON `{ error, message, detail? }`:

| Code | Status | Meaning |
| --- | --- | --- |
| `prompt_required` | 400 | The prompt is missing or shorter than 3 characters. |
| `invalid_spec` | 400 | The spec has no renderable parts. |
| `spec_too_large` | 413 | The spec is over 400 KB. |
| `rate_limited` | 429 | Too many requests from this client. |
| `writer_unavailable` | 503 | No model answered. |
| `storage_unavailable` | 503 | The database is not available. |

Generation is rate limited per IP and globally (`limits.anatomyIp`, `limits.anatomyGlobal`).

## How it is built

| Piece | File |
| --- | --- |
| Spec contract, normalizer, limits | [src/anatomy/spec.js](../src/anatomy/spec.js) |
| Partial-JSON scanner used for progressive drawing | [src/anatomy/stream.js](../src/anatomy/stream.js) |
| Shape builders: fill mesh plus technical line drawing | [src/anatomy/shapes.js](../src/anatomy/shapes.js) |
| Effect and flow shaders | [src/anatomy/effects.js](../src/anatomy/effects.js) |
| Renderer, camera, picking, explode, section, focus | [src/anatomy/viewer.js](../src/anatomy/viewer.js) |
| Toolbar, parts panel, tour and keyboard UI (`mountAnatomy`) | [src/anatomy/runtime.js](../src/anatomy/runtime.js), [src/anatomy/anatomy.css](../src/anatomy/anatomy.css) |
| Page: prompt, gallery, permalinks | [pages/anatomy.html](../pages/anatomy.html), [src/anatomy/page.js](../src/anatomy/page.js) |
| Endpoint | [api/anatomy.js](../api/anatomy.js) |
| Service, writer ladder, store, spec guide | [api/_lib/anatomy/](../api/_lib/anatomy) |

**The spec is the whole artifact.** A design is one row in `anatomy_designs`: the normalized spec plus metadata. There are no files. The normalizer is forgiving. A bad part becomes a warning, every number is clamped and every string capped, so a stored spec can never make the viewer allocate unbounded geometry.

**Progressive drawing.** The writer streams JSON in a fixed key order with parents before children. The page rescans the text as it arrives and adds each part the moment its closing brace lands. If the model stops early, the server salvages every complete part once at least 12 have arrived.

**The writer ladder** is in quality order: Claude on Vertex AI (when entitled), then Claude on the Anthropic API, then Claude through OpenRouter, then Kimi K3 and Nemotron Ultra and Super on NVIDIA NIM, then the platform's general chain. A rung that fails before writing anything is skipped. One that fails partway sends `reset` so the page clears the half-drawn machine. Two guards move the ladder on early: no output within 45 seconds, and degenerate sampling (one token repeated).

**Frame rate.** Edges are fat screen-space lines. Rotor stages draw each blade as an outline rather than as its triangle mesh, so a 64-blade compressor stage costs about 500 segments. The viewer measures frame time while parts move and lowers the render resolution (down to 0.5x) when frames run long. It raises it again when there is headroom.

**Opening view.** Every machine is framed by projecting its bounds, effects included, into the camera. A `view.section` request across a machine's long axis is read as "open it lengthwise", so a turbofan shows every stage from fan to nozzle rather than a single slice.

## Verifying

- `npx vitest run tests/anatomy.test.js` covers the normalizer, the streaming scanner, salvage, the writer's stream readers, the opening cutaway, the rotor line budget and skill drift.
- `node scripts/verify-anatomy-browser.mjs --base http://localhost:3000 --id <design uuid>` drives the gallery, a machine, the tour, explode, section, x-ray, a part click, the light theme, a phone viewport and the not-found state in a real browser. It fails on any console error.
