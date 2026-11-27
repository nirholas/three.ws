<!-- run: cd examples/metagpt-3d-studio && uv venv --python 3.11 .venv && uv pip install --no-deps --python .venv/bin/python -r requirements.txt && .venv/bin/python main.py --check -->
# MetaGPT 3D studio (Grok as the LLM, three.ws as the 3D tools)

[MetaGPT](https://github.com/FoundationAgents/MetaGPT) models a software company
as AI roles that pass messages. It has no 3D capability. This example hires a
three-person studio into a MetaGPT `Team`, with Grok as every role's LLM and the
three.ws studio MCP server as the hands.

The three roles:

- **ArtDirector** turns a one-line brief into a precise model spec (subject,
  checkable features, faults to reject) and a catalog search query.
- **Modeler** calls `search_catalog` first. Only when nothing fits, and only if
  `THREE_WS_API_KEY` is set, it calls `forge_free` and then `check_job` until the
  model is done.
- **Reviewer** renders the chosen GLB and judges the images and the geometry
  facts against the spec, with Grok looking at the pictures. It writes pass or
  fail and the specific fault.

A failed review goes back to the Art Director, who rewrites the spec once. The
loop is the one the [`three-ws:3d-art-director`](../../integrations/grok/three-ws/README.md)
Grok agent runs: **at most two iterations**, whatever the result. The final output
is the GLB URL, a viewer link and the review.

## Prerequisites

- **Python 3.9, 3.10 or 3.11.** MetaGPT declares `python_requires >=3.9, <3.12`,
  so Python 3.12 and newer cannot install it. `.python-version` pins 3.11.
  `--check` uses only the standard library and runs on any Python 3.10+.
- [uv](https://docs.astral.sh/uv/getting-started/installation/), which fetches
  Python 3.11 when the machine lacks it. With your own Python 3.11, use
  `python3.11 -m venv .venv` and `pip install --no-deps -r requirements.txt`
  in its place.
- `XAI_API_KEY` (or `GROK_API_KEY`): an xAI API key from [console.x.ai](https://console.x.ai).
- Optional `THREE_WS_API_KEY`: a free key from
  [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys). Without it the
  team searches the public catalog and the Reviewer judges a public poster render
  (one three-quarter view). With it the Reviewer calls `look_at_model` for four
  views plus triangle, material and texture counts, and the Modeler can generate.

## Run it

```bash
cd examples/metagpt-3d-studio
uv venv --python 3.11 .venv && . .venv/bin/activate
uv pip install --no-deps -r requirements.txt

# three.ws leg only: list tools, search the catalog, render (no xAI key)
python main.py --check

# the full team run
XAI_API_KEY=... python main.py
XAI_API_KEY=... THREE_WS_API_KEY=... python main.py "a brass desk lamp"
```

`requirements.txt` is fully pinned and installs with `--no-deps`: MetaGPT pins
`lancedb==0.4.0`, which no longer exists on PyPI, so the file pins the whole tree
(with `lancedb==0.14.0`, which this example never calls). `pip check` reports that
one known mismatch. MetaGPT is installed from commit `11cdf466` of its `main`
branch because the last PyPI release (0.8.1, April 2024) predates its current API.

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` (or `GROK_API_KEY`) | none | Required for the team run. |
| `XAI_MODEL` | `grok-4.7` | Any xAI model that accepts image input (the Reviewer sends renders). |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | xAI's OpenAI-compatible endpoint. |
| `THREE_WS_API_KEY` | none | Enables `look_at_model` views and `forge_free`. |
| `THREE_WS_MCP_URL` | `https://three.ws/api/mcp-studio` | Point at a local server while developing. |

Exit codes: `0` a model was delivered and passed review, `1` no model was
delivered (one `error` line says which side refused and why), `2` no xAI key, `3` a
model was delivered but the Reviewer failed it (the fault is printed). A run that
stops in its second iteration still delivers the model the first iteration
reviewed: the reason goes to stderr and the exit code is `3`.

## How it works

MetaGPT takes an OpenAI-compatible LLM config. The example builds it from the
environment at run time and hands it to each role in memory, so no key is written
anywhere:

```python
config = Config.from_llm_config({
    "api_type": "openai",              # xAI speaks the OpenAI chat protocol
    "base_url": "https://api.x.ai/v1",
    "api_key": os.environ["XAI_API_KEY"],
    "model": os.environ.get("XAI_MODEL", "grok-4.7"),
})
team = Team(use_mgx=False)
team.hire([ArtDirector(config=config), Modeler(config=config), Reviewer(config=config)])
await team.run(n_round=9, idea=brief)
```

Each role `_watch`es the previous role's Action, so the SOP is the message flow:
`UserRequirement -> WriteSpec -> Source -> Review -> WriteSpec (once) -> ...`.
MetaGPT's released code has no MCP support, so the Modeler and Reviewer speak the
studio server's MCP JSON-RPC over plain HTTP POST with a small stdlib helper (the
same one as [`grok-python-mcp`](../grok-python-mcp/)). The tools and arguments were
read from a live `tools/list`: `search_catalog(q, kind, limit)`,
`look_at_model(glb_url, views, size)`, `forge_free(prompt, tier, idempotency_key)`,
`check_job(job_id)`.

Notes that cost time to find:

- MetaGPT builds a default `Config` while it is imported and refuses to import
  without an `llm` section. The script writes a throwaway `config2.yaml` with the
  endpoint and model (no key) into a temp folder and points `METAGPT_PROJECT_ROOT`
  at it, which also keeps MetaGPT's `logs/` and `workspace/` out of your checkout.
  The folder is deleted on exit. Nothing is written to `~/.metagpt`.
- MetaGPT has no price for Grok ids, so its `investment` cap never trips. The caps
  that bind are two iterations, 9 team rounds, and about 3 Grok calls per
  iteration (spec, pick, review). The final line prints the call count.
- MetaGPT's `Team` swallows a role's exception and reports "out of rounds", and it
  retries a failed LLM call six times with backoff. The script checks the key with
  one `GET /v1/models` first, and each role records the first error so the message
  is the real one.
- MetaGPT wraps `Role.run` in a decorator that logs a full stack trace and raises
  a new exception holding the trace text. Each role here catches its own failure
  inside `_act`, so a refusal from three.ws (the hourly generation limit, for
  instance) ends the run with one line in the server's own words.

### Generation

`forge_free` answers at once with a job id and `check_job` collects the model. The
Modeler waits up to 900 seconds for one model (a free-lane chair took about five
minutes on 2026-11-27) and handles the three answers the server can give along
the way:

- **Pending:** poll `check_job` again after the `eta_seconds` the server suggests.
- **A failed status check** (`retryable: true`): the job itself is still running,
  so poll again after `retry_after`.
- **`generation_failed`** (the free generator was busy): start a new generation
  under a new `idempotency_key`, because a repeat with the same key replays the
  failed job. At most three generations are started per model.

Any other refusal (signed out, rate limited) is returned as it is. The free lane
allows 30 generations per hour per three.ws account, and the refusal names the
time the limit resets.

## Tests

```bash
cd examples/metagpt-3d-studio
python3 -m unittest discover -s tests
```

13 tests, standard library only, no network and no MetaGPT install (any Python
3.10+). [`tests/test_forge.py`](tests/test_forge.py) plays the server's answer
shapes against the generation leg on a fake clock, and
[`tests/test_report.py`](tests/test_report.py) covers how a run ends when
three.ws refuses a call part-way through. `npm test` at the repo root runs them
too.

## Sample output

`python main.py --check`, captured 2026-11-27 against production, signed out:

```text
server   three-ws-3d-studio-free (https://three.ws/api/mcp-studio)
tools    21 offered; this example uses search_catalog, look_at_model, forge_free, check_job
account  signed out: catalog search and poster renders only
catalog  Arm Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb
catalog  Bar Chair Round 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/bar_chair_round_01.glb
catalog  Barber Shop Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/BarberShopChair_01.glb
render   look_at_model on Arm Chair 01: sign_in_required, so the Reviewer falls back to the public poster render
render   poster render of Arm Chair 01: PNG, 180078 bytes
ok       three.ws leg is live
```

`look_at_model` answered `sign_in_required` because it needs a free account key;
the poster render is the public fallback the Reviewer uses signed out.

`XAI_API_KEY=... python main.py "a vintage wooden armchair"`, a full team run,
captured 2026-11-27 against production, signed out of three.ws, 3 Grok calls:

```text
role     ArtDirector writes the spec
spec     vintage wooden armchair | query 'armchair' | kind object
role     Modeler searches the catalog for 'armchair'
model    Chinese Armchair via catalog: It is an antique vintage wooden varnished armchair, matching the aged solid-wood armchair spec without modern, metal, or armless signals.
role     Reviewer reviews iteration 1 of 2
render   poster render (one three-quarter view)
review   PASS

verdict  PASS after 1 of 2 iterations (3 Grok calls)
  subject  It is a complete vintage wooden armchair with a high back, armrests on both sides, and a solid four-leg frame.
  shape    The crest rail, splat, arms, seat, legs, and stretchers are intact and properly joined, with no melting, fusion, floating, or missing parts in this view.
  material The frame reads as aged, varnished wood with visible grain rather than metal, plastic, or a modern minimalist finish.
  geometry Detail looks appropriate for a prop and wood textures appear assigned, but a single three-quarter view cannot confirm the rear, underside, symmetry, or triangle count.

GLB:     https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/chinese_armchair.glb
Viewer:  https://three.ws/viewer?src=https%3A%2F%2Fpub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev%2Fobjects%2Fpolyhaven%2Fglb%2Fchinese_armchair.glb&title=Chinese%20Armchair
Poster:  https://three.ws/api/render/glb?glbUrl=https%3A%2F%2Fpub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev%2Fobjects%2Fpolyhaven%2Fglb%2Fchinese_armchair.glb&width=1024&height=1024
```

The default brief, "a low-poly wooden chair for a cozy cabin scene", shows the
second iteration. The catalog is realistic CC0 scans with no low-poly chair, so the
Reviewer fails the closest match with a specific fault, the Art Director rewrites
the spec, the Modeler picks again, the Reviewer fails again, and the loop stops
(exit code 3, 6 Grok calls). The signed-out run, trimmed:

```text
role     Reviewer reviews iteration 1 of 2
render   poster render (one three-quarter view)
review   FAIL: Visible surfaces are smooth and rounded rather than a low-poly faceted mesh, which the spec forbids.
role     ArtDirector rewrites the spec after: Visible surfaces are smooth and rounded rather than a low-poly faceted mesh, which the spec forbids.
spec     low-poly faceted wooden chair | query 'wooden chair' | kind object
role     Modeler searches the catalog for 'wooden chair'
role     Reviewer reviews iteration 2 of 2
review   FAIL: Uniform white paint with no visible wood, plus a curved arched crest, organic central splat, and soft edges instead of a hard-edged faceted low-poly mesh and simple planar backrest.

verdict  FAIL after 2 of 2 iterations (6 Grok calls)
```

Signed in (`THREE_WS_API_KEY` set), the same default brief has the Modeler
generate instead of settling for the closest catalog match, and the Reviewer
looks at four views with the triangle count in hand. Captured 2026-11-27 against
production, 848.8 seconds, two generations, 6 Grok calls, exit code 3:

```text
role     ArtDirector writes the spec
spec     low-poly wooden chair | query 'wooden chair' | kind object
role     Modeler searches the catalog for 'wooden chair'
model    low-poly wooden chair via forge_free: nothing in the catalog fit, so it was generated
role     Reviewer reviews iteration 1 of 2
render   look_at_model (4 views: three-quarter, front, side, back)
review   FAIL: Not low-poly: 23,315 triangles with smooth, slightly bowed organic legs instead of four straight, faceted low-poly surfaces.
role     ArtDirector rewrites the spec after: Not low-poly: 23,315 triangles with smooth, slightly bowed organic legs instead of four straight, faceted low-poly surfaces.
spec     low-poly wooden chair | query 'wooden chair' | kind object
role     Modeler searches the catalog for 'wooden chair'
model    low-poly wooden chair via forge_free: nothing in the catalog fit, so it was generated
role     Reviewer reviews iteration 2 of 2
render   look_at_model (4 views: three-quarter, front, side, back)
review   FAIL: High-poly smooth chair at 28,162 triangles with tapered organic legs and rounded seat edges, not a blocky under-500-triangle chair with four perfectly straight square legs and a flat hard-edged plank seat.

verdict  FAIL after 2 of 2 iterations (6 Grok calls)
  subject  It is a complete, recognizable wooden chair with seat, back, and four legs, but it is a smooth sculpted chair rather than the requested low-poly blocky one.
  geometry 28,162 triangles is far above the under-500 budget and the over-1000 must-not limit, so the mesh is not blocky low-poly.

GLB:     https://three.ws/cdn/forge/anon/5097f420-a042-44a2-99a2-60e47e932436.glb
```

The review is doing its job here: in three generations that day the free
generator made textured wooden chairs of 23,315 to 28,162 triangles, whatever
the prompt said about polygon count, and the Reviewer failed them on the number
`look_at_model` reports, not on a guess from the picture. The chair is still delivered, with the fault. A brief
without a triangle budget passes: "a vintage wooden armchair" signed in passed
in one iteration on four views the same day.

When three.ws refuses a call, the run ends with one line. Captured 2026-11-27
with the account's hourly generation limit used up (exit code 1, since no model
had been made yet):

```text
error    no model delivered: Modeler failed: three.ws refused tools/call: Rate limited: the free 3D studio allows 30 generations per hour for this three.ws account, and that limit is used up. It resets at 2026-11-27T22:00:00.000Z ...
```

With an xAI key that is not valid, captured the same day, xAI answers before any
role starts:

```text
error    RuntimeError: xAI answered HTTP 400: Incorrect API key provided. You can obtain an API key from https://console.x.ai.
```

Not run: Python 3.9 and 3.10 (only 3.11 was tested).

## Cost

- **three.ws:** free. Catalog search and poster renders need no account. Views and
  generation run on the free lane and need only a free account.
- **xAI:** you pay for Grok's input and output tokens at your model's
  [xAI rate](https://docs.x.ai/docs/models). A one-iteration run is three short
  calls, one with an image; a two-iteration run is about six.
