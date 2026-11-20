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
| Esc | Leave the tour, or clear the selected part |
| E | Explode or collapse |
| X | X-ray |
| L | Labels on or off |
| R | Reset the view |
| F | Fullscreen |
| Space | Pause motion |
| N | Narration on or off during the tour (when the page offers it) |
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
| `POST /api/anatomy { action: "narrate", id, step }` | `{ narration: { text, source, model, audioUrl, audio, cached } }`. `source` is `grok` or `authored`. `audioUrl` is a CDN mp3 when object storage is configured; otherwise `audio` carries `{ base64, contentType }`. See [Grok narration](#grok-narration). |
| `GET /api/anatomy?list=recent[&q=][&limit=]` | `{ designs, featured, storage }`, newest first, without specs. `featured` lists the hand-written featured cutaways that match `q`. |

Errors are JSON `{ error, message, detail? }`:

| Code | Status | Meaning |
| --- | --- | --- |
| `prompt_required` | 400 | The prompt is missing or shorter than 3 characters. |
| `invalid_spec` | 400 | The spec has no renderable parts. |
| `spec_too_large` | 413 | The spec is over 400 KB. (`generate` answers 422 when the writer's output is too large to save.) |
| `rate_limited` | 429 | Too many requests from this client. |
| `writer_unavailable` | 503 | No model answered. |
| `storage_unavailable` | 503 | The database is not available. |
| `invalid_step` | 400 | `narrate` was sent a step outside the design's tour. |
| `narration_audio_failed` | 502 | The voice lane did not answer. The step text stays on screen. |

Generation is rate limited per IP and globally (`limits.anatomyIp`, `limits.anatomyGlobal`), publishing per IP (`limits.anatomyPublishIp`), and narration per IP on a cache miss only (`limits.anatomyNarrateIp`).

## Featured rocket cutaways

Two hand-written designs sit at the top of the gallery under "Featured cutaways":

| Design | Permalink | Spec |
| --- | --- | --- |
| Full-flow staged-combustion methalox rocket engine | [/anatomy/85160213-4c15-4b00-ba96-5990b9385249](https://three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249) | [ffsc-engine.js](../api/_lib/anatomy/featured/ffsc-engine.js) |
| Fully reusable two-stage super-heavy launch system | [/anatomy/d72da3e9-8aae-47cd-a96c-45ccd33bf1a0](https://three.ws/anatomy/d72da3e9-8aae-47cd-a96c-45ccd33bf1a0) | [launch-stack.js](../api/_lib/anatomy/featured/launch-stack.js) |

They are served from the registry in [api/_lib/anatomy/featured/index.js](../api/_lib/anatomy/featured/index.js), not from the database, so they work with no storage configured and cannot be overwritten by a publish.

- **The engine** shows both preburners, both turbopump shafts (each spinning its turbine, inducer and impeller), the injector, the chamber and the regeneratively cooled nozzle. Six flows are coloured by species, and the plume carries shock diamonds. It opens with a section cut and has a 10 step tour that follows the propellants through the cycle.
- **The launch stack** keeps the reference vehicle's outer proportions. Its 10 step tour runs from liftoff through hot staging and boostback to the tower catch, with moving catch arm carriages and flaps.

**Sourcing.** Every figure a visitor can read is listed, with its source and the date of the statement, in [anatomy/rocket-engines-sources.md](anatomy/rocket-engines-sources.md). The line-by-line audit of every label, with a confidence level for each, is in [anatomy/rocket-engines-review.md](anatomy/rocket-engines-review.md). `tests/anatomy-featured.test.js` fails when a spec shows a number that is not in its design's table, carries a manufacturer or vehicle trade name, or uses a dash character. Titles are generic. Real vehicles are named only as nominative references, and the models carry no logos or trade dress. A featured design shows a **Sources** button beside Copy spec.

**Share cards.** Each featured design has a 1200x630 card rendered from the real cutaway at `/anatomy/og/<slug>.png`. The page head points `og:image` at it, and `/api/anatomy-og?id=<featured id>` answers 302 to it, so every share path gets the real render. Share to X opens with the design's own share text, which carries no promotional language. Regenerate the cards with `node scripts/anatomy-featured-shots.mjs --base http://localhost:3000 --og-only`.

## Grok narration

During a tour, **Listen** (or N) speaks the current step.

- **Featured designs, key set:** the step's facts (its title, its body and the descriptions of the parts it focuses on) go to Grok (`GROK_DEFAULT_MODEL`) through `llmComplete`. The system prompt forbids adding any fact, and a numeral guard discards any answer that contains a number the facts do not. The caption then reads "Narrated by Grok from this step's verified facts" and shows the transcript.
- **No key, xAI errors, or any other design:** the authored step text is read instead, and the page never credits Grok. A missing key, a 401 `unauthenticated:no-credentials` and a 400 `invalid-argument` (bad key) all take this path.
- **Audio** comes from the free Edge TTS lane. Each narration is cached in object storage per design, step, source, model, voice and fact hash, so a step is written and synthesized once.
- **Usage** is recorded under client_id `xai-anatomy` (tool `anatomy_narrate`) and in the xAI usage ledger.

Code: [api/_lib/anatomy/narrate.js](../api/_lib/anatomy/narrate.js), the `narrate` action in [api/anatomy.js](../api/anatomy.js), `requestNarration` in [src/anatomy/api.js](../src/anatomy/api.js), and the `narrate` option of `mountAnatomy` in [src/anatomy/runtime.js](../src/anatomy/runtime.js). Tests: `tests/anatomy-narrate.test.js`.

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
- `npx vitest run tests/anatomy-featured.test.js tests/anatomy-narrate.test.js` covers the featured specs, their sourcing, the share cards and narration (facts, guard, Grok request, `xai-anatomy` attribution, and the no-key, 401 and 400 fallbacks).
- `node scripts/anatomy-featured-shots.mjs --base http://localhost:3000 --out <dir> [--og] [--tti]` captures every state of both featured designs (open, tour, exploded, section, x-ray, share panel, Sources, phone), checks the share text and phone overflow, and with `--tti` measures time to interactive on a throttled mid-range phone profile. It writes `results.json` and exits 1 on any problem.
