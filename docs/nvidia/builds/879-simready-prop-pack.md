# Design: an open pack of simulation-ready props made by Forge

**Status:** planned, not built. Work order: [879](../../../prompts/finish/879-nvidia-29-open-simready-prop-dataset.md). Written 2026-11-26. Part of the [NVIDIA build plan](README.md).

## What it is

A free, clearly licensed collection of a few hundred everyday 3D objects made by
Forge, each one ready to drop into a simulator: OpenUSD with collision shapes,
mass, labels and a validation report. It is browsable on our site and packaged
so the owner can publish it on Hugging Face with one command.

## Why build it

- Robotics and synthetic-data teams need many varied everyday objects with
  physics and labels, and there are never enough.
- NVIDIA publishes its own SimReady library as an open dataset (2,575 props, CC
  BY 4.0), which we already ingest ([simready-assets.md](../../simready-assets.md)).
  The startups it named beside its 2026 Omniverse releases make assets like
  these ([research, physical AI](../../nvidia-showcase-research.md#physical-ai-and-simulation-ready-assets)).
- A published pack is something those developers can use and link to, and it
  shows the pipeline working at scale and not on one cherry-picked model.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| Generation | [api/forge.js](../../../api/forge.js), [api/forge-batch.js](../../../api/forge-batch.js) | Text to a 3D model, one job or a group |
| OpenUSD export | [workers/usd-export/](../../../workers/usd-export/README.md) | Collision, mass, labels, validators and `report.json` |
| NVIDIA's library, ingested | [scripts/ingest-simready.py](../../../scripts/ingest-simready.py) | The reverse direction: their USD assets into our catalog. Its layout is the one robotics users already know. |
| The pack recipe | [docs/cookbook/parallel-asset-pack.md](../../cookbook/parallel-asset-pack.md) | How a developer builds a pack by hand |

## Design

```
object list (300 or more: name, prompt, real size in meters, class)
    |
builder script  -- platform's own account, one job at a time, only while no visitor is waiting
    |              resumable, daily cap, retry once with a new seed
    |-- Forge -> GLB
    |-- export worker (called as it is today) -> USD package + report
    |-- quality gate: validators clean, plausible mass, quality judge on the preview
    |
bucket + manifest
    |
    |-- /simready/props on our site: grid, search, class filter, 3D preview, downloads
    \-- assemble script -> dataset layout + dataset card -> ONE upload command (owner runs it)
```

- **Licensing is decided first, in writing.** The pack's license is the most
  permissive one that every component whose output ends up in an asset allows
  (the reference image source, the 3D model, the texture step). Each clause is
  quoted. A component that forbids open release of its outputs is routed around.
- **Only our own generations.** Every asset is made by the platform's own
  account for this purpose. A visitor's creation is never included.
- **Sizes are sourced.** Each object's real-world size comes from a cited public
  source or a stated typical range, because mass and collision depend on it.
- **The builder is polite.** The working reference-image rung serves the whole
  site at about 1 image per 45 seconds. The builder submits only while no
  interactive job is waiting, enforced by a tested check, and stops at a daily
  cap. A visitor always goes first.
- **The dataset card is honest** about how the assets were made, on what
  hardware, and their limits: generated geometry, approximate mass, convex
  collision.
- **Better with build [875](875-physics-checked-simready.md).** If the physics
  check exists when the builder runs, each asset also carries a drop-test
  result. The pack does not wait for it.

## Phases

| Phase | Exit condition |
|---|---|
| 1. License | Clauses quoted for every component; the pack's license follows from them |
| 2. Object list | 300 or more entries with sourced sizes; a schema test |
| 3. Builder | Runs for real; survives a stop and restart; the yield-to-visitors check has a passing test |
| 4. First assets | 25 or more validated assets in the bucket with reports |
| 5. Site page | `/simready/props` shows the real pack with designed loading, empty and error states |
| 6. Dataset package | The assemble script produces the layout and the card locally; the upload command is documented and not run |
| 7. The rest | The builder finishes the list over the following days, unattended |

## The numbers it leaves behind

Validated assets in the pack, pass rate by object class, exclusion reasons as
counts, and time and GPU cost per asset.

## Cost

No new service. Each asset costs one Forge job and one CPU export. The builder
takes only spare capacity, so the price is elapsed days, not money.

## Risks and fallbacks

| Risk | What we do |
|---|---|
| A component's license forbids open release of outputs | Exclude assets made with it and switch the builder to a route without it |
| Generation is slow because visitors are active | Expected. The builder is resumable and reports the date the list would finish. |
| Some classes fail validation often | They are excluded with the reason counted. Validators are never loosened. |
| A generated object resembles a real product | The object list uses generic everyday objects with no brands, and the quality gate rejects text or logos on the preview |

## Owner steps

Push and deploy for the site page. Create the Hugging Face dataset and run the
one upload command when you are happy with the pack. Publishing is always the
owner's step.

## What we can say, and when

Once published: "a free pack of validated simulation-ready props, each with its
report, generated from text on our own NVIDIA GPUs". Wording stays technical,
with no claim beyond membership of the NVIDIA Inception program.
