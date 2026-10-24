---
name: anatomy
description: Explain how a machine works as an interactive isometric 3D cutaway. Use when the user asks how an engine, turbine, reactor, pump, clock, motor or any mechanism works and wants to see it, or types "/anatomy <machine>", for example "/anatomy explain how a big airliner turbofan engine like the A380's makes thrust, interactive". Produces a shareable three.ws link with real moving parts, shader effects (fire, exhaust, plasma, water, steam, sparks, arcs), flows, a section cut, an exploded view and a guided tour.
when_to_use: The user wants a machine or mechanism explained visually and interactively. For a static 3D object to download, use generate-3d-model. For a character, use create-3d-avatar.
license: MIT
metadata:
  category: 3d/creative
  cross-platform-safe: true
  pack: three-ws-skills
---

# Anatomy: machines as interactive cutaways

Describe a machine in one line and get back an interactive isometric wireframe
cutaway on three.ws. Visitors can rotate it, step through a guided tour, explode
it, cut it open, switch to x-ray and click any part to read what it does. Moving
parts really move, and the physics is drawn with WebGL shaders.

The result is a permalink such as `https://three.ws/anatomy/<id>`. Share it as
the answer. It works on desktop and phones, with no account needed to view it.

## Two ways to build one

### 1. You write the spec (best quality, recommended)

You know the machine. Write the spec yourself and publish it.

1. Read [reference.md](reference.md). It is the full spec format: parts and
   shapes, motion, effects, flows, the tour and the quality bar. The server
   validates against exactly these rules.
2. Write one JSON object for the machine the user asked about. If they named a
   real machine (for example the Rolls-Royce Trent 900 on the A380), model that
   machine and its real proportions, stage counts and numbers. If they were
   vague, choose the most iconic real example and say which in `subtitle`.
3. Publish it:

```bash
curl -s -X POST https://three.ws/api/anatomy \
  -H 'content-type: application/json' \
  --data-binary @- <<'JSON'
{ "action": "publish", "prompt": "<the user's request>", "spec": { ...your spec... } }
JSON
```

The response is `{ "design": { "id", "url", "title", "stats" }, "warnings": [] }`.
Give the user `design.url`. `stats` counts parts, moving instances, effects,
flows and tour steps.

`warnings` lists anything the normalizer repaired, such as an unknown parent, an
unknown focus id or a clamped value. The machine still renders. If a warning
points at something that matters (a missing part, a broken hierarchy), fix the
spec and publish again. Each publish gets a new permalink.

### 2. Ask three.ws to write it

When you cannot write the spec yourself, let the server's writer do it. This
takes one to several minutes.

```bash
curl -s -X POST https://three.ws/api/anatomy \
  -H 'content-type: application/json' \
  -d '{ "action": "generate", "prompt": "how a big airliner turbofan like the A380s makes thrust" }'
```

The response has the same `{ design, warnings }` shape. Pass `"stream": true` to
receive Server-Sent Events instead: `stage`, `delta` (the spec text as it is
written), `reset`, then one `done` (or `error`). Visitors can also type a prompt
straight into https://three.ws/anatomy and watch the machine assemble.

## Errors

| status | `error` | what to do |
| --- | --- | --- |
| 400 | `invalid_spec` | The spec is not a JSON object or has no renderable parts. `detail` lists the warnings. Fix and resend. |
| 400 | `prompt_required` | Send a prompt of at least 3 characters. |
| 413 | `spec_too_large` | Keep the spec under 400 KB. Use `repeat` instead of copying parts. |
| 429 | `rate_limited` | Wait for the `retry-after` header, then retry. |
| 503 | `writer_unavailable` / `storage_unavailable` | Retry in a minute. With path 1, the spec you wrote is still valid. |

## Reading an existing machine

- `GET https://three.ws/api/anatomy?id=<uuid>` returns `{ design }` with the full spec.
  Start from it to make a variation.
- `GET https://three.ws/api/anatomy?list=recent&q=<text>` lists recent machines
  without their specs.

## What makes a great one

- **Accurate:** real part names, proportions and figures, such as pressure ratios,
  temperatures and rpm. Describe a relationship rather than inventing a number.
- **Complete:** typically 25 to 90 parts plus repeats.
- **Built as hierarchies:** blades and discs sit under the shaft that turns them.
- **Readable at a glance:** `glass` casings and a `view.section` cutaway show the
  inside.
- **A tour that teaches:** it follows the physics in order (intake to exhaust,
  fuel to power) and focuses each step on the few parts that matter.
