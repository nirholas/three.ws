# Design: one scene idea becomes a matched kit of props

**Status:** planned, not built. Work order: [873](../../../prompts/finish/873-nvidia-23-scene-kit-from-one-prompt.md). Written 2026-11-26. Part of the [NVIDIA build plan](README.md).

## What it is

A visitor types one idea ("a cozy wizard's study") and gets a set of 4 to 12
matching 3D objects: the desk, the candle, the spellbook, the owl perch. They
can edit the list before it starts, watch each object arrive, and download the
whole kit as models, a zip, one OpenUSD scene or a Blender import script.

## Why build it

- It raises what a single visit produces from one model to a usable set.
- It is the one step of NVIDIA's own
  [3D Object Generation Blueprint](../../nvidia-showcase-research.md#generative-3d-the-3d-object-generation-blueprint)
  that Forge does not have. NVIDIA's version needs an RTX PC with 16 GB of VRAM
  and 48 GB of RAM. Ours would run in a browser tab.
- The brainstorm step runs on a Nemotron model through NVIDIA NIM, so the whole
  chain is NVIDIA end to end: Nemotron, then TRELLIS on our NVIDIA GPUs, then
  OpenUSD.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| Single-model generation | [api/forge.js](../../../api/forge.js) | The Forge job API. Not changed by this build. |
| Fan-out | [api/forge-batch.js](../../../api/forge-batch.js) | Submits several ordinary Forge jobs in one call and polls the group. Each item is a full, independent Forge submission. |
| The LLM chain | [api/_lib/llm.js](../../../api/_lib/llm.js) | Where a Nemotron model on NIM is called, with the chain's fallbacks |
| OpenUSD export | [api/_lib/usd-export.js](../../../api/_lib/usd-export.js), [workers/usd-export/](../../../workers/usd-export/README.md) | Turns a model into a validated USD package with physics and labels |
| The pack recipe | [docs/cookbook/parallel-asset-pack.md](../../cookbook/parallel-asset-pack.md) | How a developer builds a pack by hand today |

## Design

```
"a cozy wizard's study"
    |
brainstorm handler  -- Nemotron on NIM, strict JSON -->  4 to 12 proposals
    |                                                    (name, prompt, size in meters, one shared style line)
visitor edits, removes, confirms
    |
kit runner (server side)
    |-- submits ONE ordinary Forge job at a time
    |-- submits the next only when no interactive visitor is waiting on the image rung
    |-- state is stored on the server, so a reload resumes
    |
delivery: each GLB, a zip, one OpenUSD stage laid out on a ground plane, a Blender script
```

- **The fairness gate is the heart of it.** The working reference-image rung
  allows about 1 image per 45 seconds for the whole site. A kit must never make
  a single-model visitor wait, so the gate is enforced on the server and proven
  by a test: an interactive request that arrives mid-kit is served before the
  kit's next object.
- **Reuse, not a second pipeline.** Every object is an ordinary Forge job, so
  every lane rule, quality gate and cache applies unchanged. The existing batch
  endpoint already does the fan-out. What is new is the brainstorm, the gate,
  the server-side kit state and the kit page. Step 0 of the order decides
  whether the batch bookkeeping can carry the kit state or a small table is
  needed.
- **A shared style line** rides on every prompt, so the objects look like they
  belong together.
- **Caps.** 12 objects per kit, one running kit per account, cancellable.
- **A new page**, linked from `/forge` by one link. `/forge` itself is not
  redesigned.

## Phases

| Phase | Exit condition |
|---|---|
| 1. Brainstorm | Strictly validated proposals; duplicates dropped; unsafe ideas refused; unit tests |
| 2. Gate and runner | Server-side fairness test passes; caps and resume tested |
| 3. Kit page | Designed empty, loading, partial-failure and error states; works on a phone and by keyboard |
| 4. Delivery | GLBs, zip, one OpenUSD stage and a Blender script; failed objects are named, not hidden |
| 5. Real run | One real kit of at most 4 objects end to end on the dev server |
| 6. Docs | `docs/scene-kit.md`, cookbook cross-link, changelog |

## The numbers it leaves behind

Time from one sentence to a finished kit, objects per kit that pass the quality
gate, and how long an interactive visitor waited while a kit was running (the
goal is no longer than without one).

## Cost

No new service. The brainstorm is one small LLM call. Each object costs what a
Forge job costs today. The limit is the image rung, not money.

## Risks and fallbacks

| Risk | What we do |
|---|---|
| Kits crowd out single-model visitors | The server-side gate. This is tested, not hoped for. |
| A kit of 12 takes many minutes | The page shows each object's real state and lets the visitor leave and come back. |
| The model returns extra text around the JSON | Structured output, validation, one retry with the validation error, then a clear failure. |
| Some objects fail | The kit finishes as "partial", names what failed, and offers a retry for those. |

## Owner steps

Push and deploy.

## What we can say, and when

Once live: the same pipeline as NVIDIA's 3D Object Generation Blueprint, hosted,
in a browser, with no RTX PC. Stated as a comparison of requirements, with no
claim of endorsement.
