# Engine QA: a real-time-engine fitness grade for 3D assets

A renderer and a game engine ask different questions about the same GLB. [Simulation readiness](./sim-readiness.md) tells you whether a physics solver can integrate the mesh. Nothing tells you whether a real-time engine will actually run it at 60fps, until it stutters on a phone three weeks after import.

**Engine QA is that grade, computed from the file itself.** Point it at a GLB and it answers the import-time questions an engine's own profiler would eventually raise anyway: how many draw calls does the default scene actually cost, how many materials does it carry, is the texture resolution matched to the mesh's real-world size, does each level of a LOD chain fit its triangle budget and shrink monotonically, and is the mesh cheap enough, and closed enough, to use as its own physics collider.

- **Free grade:** `GET /api/3d/engine-qa?url=<glbUrl>`
- **Pure core (isomorphic, zero imports):** [`api/_lib/engine-qa-core.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/engine-qa-core.js)
- **Server grader (full report):** [`api/_lib/engine-qa.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/engine-qa.js)
- **Browser-only partial grader (zero network):** [`src/engine-qa-client.js`](https://github.com/nirholas/three.ws/blob/main/src/engine-qa-client.js)

No account, no payment, no wallet. Same reasoning as every other free grade on this platform: a check that costs money is a check nobody runs before shipping.

## The four verdicts

| Verdict | Glyph | What it means |
|---|---|---|
| `pass` | ✓ Engine ready | Draw calls, materials, and texel density all sit inside the real-time budget. |
| `warn` | ⚠ Needs tuning | Nothing here breaks on import, but at least one check is past the comfortable range for a 60fps target. |
| `fail` | ✕ Will stutter | At least one check is past the band a real-time engine can absorb without dropping frames or splitting batches. |
| `skip` | ◇ Engine QA | Nothing measurable yet (no check has run, or a check found nothing it could measure, like a mesh with no UV-mapped texture). |

The overall verdict is the worst non-skip verdict across all five checks. A file with four `pass` checks and one `fail` is a `fail` overall: a single blown budget is enough to stutter, no matter how clean the rest of the mesh is.

## Grade an asset

```bash
curl "https://three.ws/api/3d/engine-qa?url=https://three.ws/avatars/cesium-man.glb"
```

```jsonc
{
  "url": "https://three.ws/avatars/cesium-man.glb",
  "sizeBytes": 1283324,
  "report": {
    "version": "threews.engine.qa.v1",
    "overall": "warn",
    "materialCount": 1,
    "textureCount": 4,
    "drawCalls": 1,
    "checks": {
      "drawCalls": { "value": 1, "verdict": "pass", "thresholds": { "good": 20, "warn": 60 } },
      "materialCount": { "value": 1, "verdict": "pass", "thresholds": { "good": 8, "warn": 20 } },
      "texelDensity": { "value": 1842, "verdict": "warn", "thresholds": { "minPxPerMeter": 128, "maxPxPerMeter": 2048 } },
      "triangleBudget": { "value": null, "verdict": "skip", "reason": "no LOD chain supplied" },
      "collider": {
        "value": { "watertight": true, "manifold": true, "shells": 1, "openEdges": 0, "triangleCount": 3148, "budget": 5000 },
        "verdict": "pass",
        "reason": null
      }
    }
  },
  "ts": "2026-10-12T09:14:02.118Z"
}
```

Every number traces back to the file: draw calls are counted by walking the default scene graph once (one draw call per node + triangle-primitive pair actually reachable from the root, so a mesh referenced by two nodes correctly costs two draws), texel density is `sqrt(UV-triangle-area-in-texels / world-triangle-area-in-m²)` summed across every textured triangle after applying the node's world transform, and the collider check reuses the print pipeline's own manifold/watertight analyzer (the same one [`format=stl`](#export-a-collider-ready-stl) uses to decide whether an export would even be printable).

### Build and grade a LOD chain

`triangleBudget` is `skip` unless you ask for a chain. Pass `lods=1` and the endpoint builds a real `MSFT_lod` chain with [`packages/glb-tools`'s `buildLodChain`](./forge-pipeline.md#the-lod-variant-opt-in-because-decimation-is-real-work) (meshoptimizer decimation, not a stand-in) before grading it:

```bash
curl "https://three.ws/api/3d/engine-qa?url=https://three.ws/avatars/cesium-man.glb&lods=1"
```

```jsonc
{
  "report": {
    "checks": {
      "triangleBudget": {
        "value": [
          { "name": "LOD0", "triangleCount": 4672, "budget": 100000, "verdict": "pass" },
          { "name": "LOD1", "triangleCount": 2103, "budget": 40000, "verdict": "pass" },
          { "name": "LOD2", "triangleCount": 743, "budget": 12000, "verdict": "pass" }
        ],
        "monotonicDecrease": true,
        "verdict": "pass"
      }
    }
  },
  "lods": [
    { "name": "LOD0", "ratio": 1, "triangleCount": 4672, "vertexCount": 2338 },
    { "name": "LOD1", "ratio": 0.45, "triangleCount": 2103, "vertexCount": 1091 },
    { "name": "LOD2", "ratio": 0.16, "triangleCount": 743, "vertexCount": 412 }
  ]
}
```

Each level is checked two ways: its own triangle count against that level's ceiling, and the chain as a whole against the rule every LOD chain must satisfy, strictly decreasing triangle counts from highest detail to lowest. A chain that fails either check fails `triangleBudget` outright, because a LOD1 that is heavier than LOD0 is not a LOD chain, it is a bug.

### Export a collider-ready STL

`format=stl` exports the same mesh as binary STL (millimeters) when the collider check's own `watertight` field is true:

```bash
curl -s -o model.stl "https://three.ws/api/3d/engine-qa?url=https://three.ws/avatars/cesium-man.glb&format=stl"
```

A non-watertight mesh never produces a silently broken STL. Instead it answers `422 not_watertight` with the exact defect count:

```jsonc
{ "error": "this mesh is not watertight; an STL export would be unprintable", "openEdges": 18, "nonManifoldEdges": 0, "shells": 1 }
```

## Why the checks say what they say

| Check | Measures | Thresholds | `skip` when |
|---|---|---|---|
| `drawCalls` | One draw per (node, triangle-primitive) pair actually in the default scene, so instancing and node reuse are counted honestly. | `pass` ≤ 20, `warn` ≤ 60, `fail` above | Never (every mesh has a scene graph). |
| `materialCount` | Distinct materials across the whole document. | `pass` ≤ 8, `warn` ≤ 20, `fail` above | Never. |
| `texelDensity` | Texels per meter of real-world surface, summed across every textured triangle. | `fail` below 128 px/m, `warn` above 2048 px/m, `pass` between | No UV-mapped texture found to measure. |
| `triangleBudget` | Each LOD level's triangle count against its ceiling (`LOD0` 100k, `LOD1` 40k, `LOD2` 12k; an unrecognized level name falls back to `LOD0`'s ceiling), plus the monotonic-decrease rule across the whole chain. | Per-level `pass`/`fail` at its ceiling; chain `fail` if any level fails or the sequence does not strictly decrease. | No LOD chain supplied (`lods=1` not sent). |
| `collider` | Reuses the print pipeline's watertight/manifold analysis; `fail` if not watertight, `warn` if watertight but over 5,000 triangles (heavier than a mesh collider should be), `pass` otherwise. | Budget: 5,000 triangles. | The mesh could not be loaded for collider analysis. |

The texel-density window is deliberately wide: below the floor, textures visibly smear up close; above the ceiling, the asset is paying storage and bandwidth for resolution nobody's eye resolves at normal viewing distance. Both bands assume the mesh's glTF units are real meters, which [simulation readiness](./sim-readiness.md) is the tool to confirm when you are not sure.

## Where you will see it

- **[The GLB viewer](https://three.ws/viewer)** (`public/viewer.html`) shows the `<engine-qa>` badge beside the simulation-readiness badge for any `https://` model you open. Grading is one click (`"Check engine fitness"`), not automatic, because scoring an arbitrary URL means fetching the whole file; the LOD-chain upgrade (`"Build & grade LOD chain"`) is a second, explicit step because it is real decimation work.
- **[Rig Doctor](./rig-doctor.md)** runs the same badge, but its first pass never touches the network: [`src/engine-qa-client.js`](https://github.com/nirholas/three.ws/blob/main/src/engine-qa-client.js) grades draw calls, material count, and texel density straight from the mesh already loaded in the tab for rigging, using the exact same thresholds as the server (both import [`api/_lib/engine-qa-core.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/engine-qa-core.js), so the two can never disagree). Collider fitness and a real LOD chain still need the server endpoint, offered as the same upgrade button.
- **The shared `<engine-qa>` component** ([`public/engine-qa-panel.js`](https://github.com/nirholas/three.ws/blob/main/public/engine-qa-panel.js)) is what both surfaces mount: one custom element, four states (`loading`, `ungraded` with the offer button, a graded `report`, or `failed` with retry), so the viewer and Rig Doctor can never drift in how the grade is presented.

## A LOD chain alongside your generation

Generating through `POST /api/forge` with `{ "lods": true }` builds and stores a real `MSFT_lod` chain as a third object (`lod_glb_url`) alongside the delivered mesh, the same `buildLodChain` pipeline this endpoint runs on demand. See [the LOD-variant section of the forge pipeline doc](./forge-pipeline.md#the-lod-variant-opt-in-because-decimation-is-real-work) for the storage shape and the opt-in reasoning.

## Status codes

| Case | Status | Body |
|---|---|---|
| Graded | 200 | the report above |
| No `url` on GET, no `url` in a JSON POST body | 400 | `{ "error": "missing_url", ... }` |
| POST JSON body is malformed or wrong content-type | 400 / 415 | `{ "error": "invalid_json", ... }` |
| POST raw body is empty | 400 | `{ "error": "empty_body", ... }` |
| `format` is neither `json` nor `stl` | 400 | `{ "error": "bad_format", ... }` |
| `url` is not a public https URL | 400 | `{ "error": "invalid_url", ... }` |
| Asset over 32 MB | 413 | `{ "error": "too_large", ... }` |
| The upstream fetch failed | 502 | `{ "error": "fetch_failed", ... }` |
| Not valid glTF/GLB | 422 | `{ "error": "invalid_model", ... }` |
| `lods=1` chain build failed | 422 | `{ "error": "lod_build_failed", ... }` |
| `format=stl` on a non-watertight mesh | 422 | `{ "error": "not_watertight", "openEdges": ..., "nonManifoldEdges": ..., "shells": ... }` |
| More than 60 requests/minute from one address | 429 | `{ "error": "rate_limited" }` with `Retry-After` |
| More than 10 `lods=1` requests in 5 minutes from one address | 429 | `{ "error": "rate_limited", ... }`: grade without `lods=1`, or retry shortly |

The `lods=1` limit is separate from, and tighter than, the base limit: building a chain runs the real meshoptimizer simplifier, far heavier than grading alone, so a handful of chain-building callers can never exhaust the generic grading budget for everyone else.

## Reproducing it yourself

Both graders, server and browser, import their thresholds and verdict math from the same zero-dependency core, [`api/_lib/engine-qa-core.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/engine-qa-core.js): `ENGINE_QA_THRESHOLDS`, `worstVerdict`, `verdictFromBand`, and `gradeTriangleBudget`. Nothing in either grader hardcodes a number outside that module, so a mesh graded in Rig Doctor's browser-only pass and the same mesh graded by the server endpoint can never land on two different verdicts for the checks they share.

- The same bytes always produce the same report: no sampling, no randomness.
- Draw calls and texel density are computed from the default scene's actual node transforms, so two GLBs with identical mesh data but different node scales grade differently, correctly.
- `triangleBudget` is `skip`, never a fabricated `pass`, when no LOD chain was supplied. An absent measurement is reported as absent.

## Related

- [Simulation readiness](./sim-readiness.md): the other physics-adjacent grade for the same file. Simulation readiness asks "can a solver integrate this"; engine QA asks "will a renderer run it at 60fps."
- [Rig Doctor](./rig-doctor.md): where the browser-only partial grade runs today, alongside rig diagnosis and retargeting.
- [The forge pipeline](./forge-pipeline.md): how a generated mesh becomes a delivery variant, an optional web-sized variant, and now an optional LOD-chain variant.
- [Verifiable 3D provenance](./provenance.md): a signed claim about who made a model and whether the bytes were altered, the same pattern simulation readiness rides inside.
