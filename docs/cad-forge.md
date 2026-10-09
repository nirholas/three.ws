# CAD Forge

Describe a mechanical part in a sentence and get real CAD: a parametric [build123d](https://github.com/gumyr/build123d) program that the OpenCascade geometry kernel has built, with exact dimensions you can change, STEP for engineering tools, STL for printers, a GLB at true scale for the web and AR, and a drawing sheet.

- **Page:** [three.ws/cad](https://three.ws/cad), with each design at `/cad/<id>`
- **API:** `POST /api/cad` and `GET /api/cad` (below)
- **MCP:** `cad_generate` and `cad_rebuild` on the [3D Studio server](./mcp-3d-studio.md)
- **Builder:** [workers/cad-forge](../workers/cad-forge/README.md)

## Why it is different from text to 3D

[Text to 3D](./forge.md) makes a mesh that looks like the thing you described, which suits characters, props and scenery. A functional part needs something else. A phone mount has to fit the phone, the screw holes have to clear an M4 screw, and the wall has to be thick enough to print. CAD Forge produces a boundary-representation solid built from real operations (extrusions, holes, fillets, booleans), so every size in it is exact and editable.

| | Text to 3D | CAD Forge |
| --- | --- | --- |
| Output | Textured mesh (GLB) | B-rep solid (STEP) plus STL, GLB, SVG drawing |
| Dimensions | Approximate, normalised scale | Exact millimetres, true scale |
| Editable | Retexture, remesh | Every key dimension is a slider; refine in words |
| Source | None | The Python program, yours to run anywhere |
| Best for | Characters, props, decoration | Brackets, enclosures, mounts, gears, knobs, adapters |

## How a design is made

1. **Write.** A coding model writes a build123d program for the request, declaring the key dimensions as annotated constants (see [Parameters](#parameters)).
2. **Build.** The [cad-forge worker](../workers/cad-forge/README.md) runs the program on the OpenCascade kernel in a sandbox and exports the files.
3. **Repair.** If the kernel rejects the program, the real error (kind, message, failing line) goes back to the model, which rewrites it. This repeats up to three times. If a part builds as several disconnected solids, which almost always means a feature was left floating, the model gets one extra round to connect them; the first build is kept if that round fails.
4. **Save.** The program, its parameters, the kernel's measurements and the files are stored. The design gets a permanent page.

The page shows each of these stages live, including the kernel's actual error text during a repair. Nothing is shown to you until the kernel has accepted it.

The writer is a model ladder in [`api/_lib/cad/writer.js`](../api/_lib/cad/writer.js): Kimi K3 on NVIDIA NIM first, then Nemotron Super, then gpt-oss-120b on Groq, then the platform's general LLM chain. The order came from a bake-off against the real kernel.

### Kernel adjustments

The worker shrinks a fillet or chamfer the kernel refuses, first to half and then to a quarter of its size, and leaves the edge sharp if no size works. Every adjustment is listed on the design page under **Kernel adjustments** and returned in the API's `adjustments` array, so you always know when the part differs from what the program asked for.

### Standard parts

Programs can use [bd_warehouse](https://github.com/gumyr/bd_warehouse) for parts that should never be modeled by hand: involute spur gears, ISO threads, ISO 4032 nuts, ISO 4762 cap screws, washers and deep-groove ball bearings. Ask for "a 20-tooth module 1.5 gear with a 5 mm bore" and you get a correct involute profile.

## Parameters

Each design declares its tunable dimensions as plain top-level constants with a label and a range:

```python
# title: Wall-mounted phone holder
# summary: A cradle that screws to the wall and holds a phone upright.
from build123d import *
import math

WIDTH = 80  # Overall width [40..160 mm]
WALL = 2.4  # Wall thickness [1.2..6 mm]
SLOTS = 6  # Slot count [2..12 count]
```

The format is `NAME = number  # Label [min..max unit]`. The page turns each line into a slider and a number field. Moving one rebuilds the same program with only that value changed, on the kernel, with no model involved, so the result is exact and repeatable. Each set of values is cached and gets its own link (`/cad/<id>?v=<key>`), and the downloads, measurements and drawing follow the configuration you are looking at.

Because the parameters are ordinary Python, the downloaded program runs unchanged anywhere build123d is installed:

```bash
pip install build123d bd_warehouse
python wall-mounted-phone-holder.py
```

That includes [text-to-cad](https://github.com/earthtojake/text-to-cad), which uses the same kernel, so a design can move into a local agent workflow without conversion.

## The design page

- **3D view** with real-millimetre grid, edge lines and dimension callouts that read the kernel's exact extents. Orbit, zoom, reframe.
- **Drawing** tab: front, right, top and isometric hidden-line views on one sheet.
- **Dimensions:** the sliders. **Reset** returns to the original values.
- **Measurements:** size, volume, surface area, topology, the kernel's validity check, and the mass if made solid in PLA, PETG, nylon, aluminium, steel or brass. Picking a material also changes the 3D finish.
- **Files:** STEP, STL, GLB, the drawing SVG and the Python program.
- **View in your space** opens the GLB in AR at true scale through [`/api/ar`](./ar.md). **Print it** hands the GLB to [Materialize](./materialize.md) for a printability check and a quote. **Open in Scene Studio** loads it into the scene editor.
- **Refine:** describe a change ("add a cable slot in the back, make the walls 3 mm"). The current program, at the values you have set, is rewritten and rebuilt as a new design linked to this one, so every part keeps its history.

## HTTP API

### Generate a design

`POST /api/cad`

```json
{ "action": "generate", "prompt": "L bracket, 90 degrees, 3 mm thick, four M4 holes", "stream": false }
```

| Field | Type | Notes |
| --- | --- | --- |
| `prompt` | string, 3-600 chars | The part, or the change when refining. Name key sizes in mm. |
| `parentId` | uuid, optional | Refine this design instead of starting fresh. |
| `values` | object, optional | With `parentId`: start from these parameter values. |
| `stream` | boolean | `true` answers `text/event-stream` with `stage` events, then `done` or `error`. |

Response `201`:

```json
{
  "design": {
    "id": "d71c75cc-b878-4ea7-bf29-b44638a1eea6",
    "title": "Wall-Mounted Phone Holder",
    "summary": "A wall-mounted phone holder with a cradle base and two countersunk screw holes for secure attachment.",
    "prompt": "Wall-mounted phone holder with two countersunk screw holes",
    "code": "# title: Wall-Mounted Phone Holder\n...",
    "params": [{ "name": "WIDTH", "label": "Overall width", "value": 80, "min": 60, "max": 120, "step": 1, "unit": "mm", "line": 6 }],
    "metrics": { "size_mm": [80, 100, 27], "volume_mm3": 24488.2485, "area_mm2": 17691.5323, "solids": 2, "faces": 32, "edges": 82, "valid": true },
    "files": { "step": "https://...", "stl": "https://...", "glb": "https://...", "thumb_svg": "https://...", "drawing_svg": "https://..." },
    "adjustments": [],
    "url": "https://three.ws/cad/d71c75cc-b878-4ea7-bf29-b44638a1eea6"
  },
  "attempts": 1
}
```

Streamed stages are `writing`, `building`, `repairing` (with `error: { kind, message, line }`), `built` and `saving`, each with its `attempt` number.

Errors: `400 prompt_required`, `404 parent_not_found`, `422 design_failed` (with `lastError`, the kernel's final complaint), `429` rate limited (12 designs per 10 minutes per IP), `503 cad_unavailable` or `writer_unavailable`.

```bash
curl -s https://three.ws/api/cad -H 'content-type: application/json' \
  -d '{"action":"generate","prompt":"Knob for a 6 mm D-shaft with grip ridges, 25 mm across"}' | jq '.design.url, .design.files.step'
```

### Rebuild at new values

`POST /api/cad`

```json
{ "action": "rebuild", "id": "<design id>", "values": { "WIDTH": 120 } }
```

Returns `{ "ok": true, "variant": { "key", "values", "metrics", "files", "adjustments", "url" }, "cached": false }`. Values are clamped to each parameter's range and snapped to its step. A value set that has been built before returns instantly with `cached: true`. When the kernel cannot build those values the answer is still `200`, as `{ "ok": false, "error": "rebuild_failed", "message", "buildError": { "kind", "message", "line" } }`.

### Read

| Request | Returns |
| --- | --- |
| `GET /api/cad?id=<uuid>` | `{ design, lineage: { parent, children }, variant: null }` |
| `GET /api/cad?id=<uuid>&v=<key>` | The same plus the cached `variant` |
| `GET /api/cad?id=<uuid>&format=py[&v=<key>]` | The program as a `.py` download, at the variant's values if given |
| `GET /api/cad?list=recent\|featured[&q=][&limit=]` | `{ designs: [card], available }`, cards carry `thumb` and `sizeMm` |

## MCP

`cad_generate(prompt, parent_id?, values?)` and `cad_rebuild(id, values)` on `https://three.ws/api/mcp-3d` run the same pipeline and return the files, measurements, parameters and the program. `cad_generate` is synchronous and usually takes 20 to 90 seconds; raise your client's per-call timeout if it is shorter. Pricing and access follow the rest of the [3D Studio server](./mcp-3d-studio.md#access--pricing): free with a three.ws sign-in, or $0.05 and $0.01 per call over x402.

## Safety

The program is written by a model from a request anyone can send, so the builder treats it as hostile. It runs in a one-use process with no network, no exec, no fork, an unprivileged user, hard resource limits and a static policy on what the code may touch. The worker holds no cloud credentials and runs as a service account with no IAM roles. Details: [workers/cad-forge](../workers/cad-forge/README.md#isolation).

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `GCP_CAD_FORGE_URL` | three-ws-api | Base URL of the cad-forge Cloud Run service |
| `CAD_FORGE_KEY` | three-ws-api | Bearer secret for the worker (`cad-forge-key` in Secret Manager) |
| `CAD_WRITER_MODEL` | three-ws-api, optional | Override the leading NIM writer model |
| `CAD_FORGE_GLOBAL_HOURLY` | three-ws-api, optional | Global hourly design ceiling (default 400) |

Without the worker URL and key, or without a database and object storage, `/api/cad` answers `503 cad_unavailable` and the page says so while still showing existing designs.

## Related

- [Text to 3D](./forge.md) for organic and decorative models
- [Machine Atlas](../src/assembly/README.md): machines generated from code in the browser
- [Materialize](./materialize.md): print any model
- [AR & WebXR](./ar.md): true-scale placement
