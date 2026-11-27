# Grok + three.ws in raw HTTP (curl and jq)

The whole flow in one shell script with no SDK: search the three.ws catalog, ask
Grok (xAI Responses API with three.ws as a remote MCP tool) to find or make a
chair, then render the GLB to a PNG. Every request is printed before it is sent,
with keys masked, so you can copy the shapes into any language.

`--three-ws-only` runs the three.ws calls Grok would make, straight over REST:
search, generate, poll, render. Use it to see the 3D side work before you have
an xAI key.

## Prerequisites

- `bash`, `curl` 7.76 or newer, and `jq` 1.6 or newer (versions in `versions.txt`).
- `XAI_API_KEY`: an xAI API key from [console.x.ai](https://console.x.ai), for the Grok run.
- `THREE_WS_API_KEY`: a free three.ws account key from
  [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys), to make a model.

## Run it

```bash
cd examples/grok-curl

# no key at all: catalog search and a render
./run.sh --three-ws-only --catalog-only

# three.ws only: search, make "a low-poly wooden chair", poll, render
THREE_WS_API_KEY=... ./run.sh --three-ws-only

# Grok drives it
XAI_API_KEY=... THREE_WS_API_KEY=... ./run.sh

# another prop, another output file
XAI_API_KEY=... THREE_WS_API_KEY=... OUT=lamp.png ./run.sh "a brass desk lamp"
```

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` (or `GROK_API_KEY`) | none | Required for the Grok run. |
| `THREE_WS_API_KEY` | none | Required to make a model. |
| `XAI_MODEL` | `grok-4.7` | Any xAI model that supports remote MCP tools. |
| `XAI_BASE_URL` | `https://api.x.ai/v1` | The xAI API base. Point it at a proxy or a test server. |
| `OUT` | `model.png` | Where the render is saved. |
| `THREE_WS_MCP_URL` | `https://three.ws/api/mcp-studio` | The MCP server Grok calls. |
| `THREE_WS_API` | `https://three.ws` | The REST base for catalog, forge and render. |

Exit codes: `0` success, `1` a call failed, `2` no xAI key for the Grok run.

When xAI answers with an error (a rejected key, a tool schema it will not
accept, a failed response, a gateway page), the script prints one line,
`error    xAI answered HTTP <status>: <message>`, with xAI's own message, and
exits `1`.

## The calls

| Step | Request | Key |
|---|---|---|
| Catalog | `GET /api/catalog?q=chair&kind=object&limit=3` | none |
| Grok | `POST https://api.x.ai/v1/responses` with `tools: [{type: "mcp", server_url, server_label, allowed_tools, authorization}]` | xAI |
| Continue | the same body with `previous_response_id` | xAI |
| Generate | `POST /api/forge {"prompt", "backend": "nvidia", "path": "image"}` | three.ws (Bearer) |
| Poll | `GET /api/forge?job=<job_id>` until `status` is `done` | none |
| Render | `GET /api/render/glb?glbUrl=<url>&width=1024&height=1024` returns `image/png` | none |

## Sample output

`XAI_API_KEY=... ./run.sh`, the Grok run, captured 2026-11-27 against
production with no three.ws key, so Grok answered from the free catalog:

```text
> GET https://three.ws/api/catalog?q=chair&kind=object&limit=3
catalog  Arm Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb
catalog  Bar Chair Round 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/bar_chair_round_01.glb
catalog  Barber Shop Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/BarberShopChair_01.glb
note     THREE_WS_API_KEY is not set: catalog search works, but making a model needs a free key from https://three.ws/dashboard/api-keys

> POST https://api.x.ai/v1/responses  authorization: Bearer <XAI_API_KEY>
{
  "model": "grok-4.7",
  "input": [
    {
      "role": "user",
      "content": "Use three-ws to find a chair in the free catalog, and if none fits, make a low-poly wooden chair. A generation can come back pending with a job_id: collect it with check_job. When you have the model, reply with one line per field: 'GLB: <url>' and 'Viewer: <url>'."
    }
  ],
  "tools": [
    {
      "type": "mcp",
      "server_url": "https://three.ws/api/mcp-studio",
      "server_label": "three-ws",
      "server_description": "Free 3D studio: search CC0 3D assets, or make a textured GLB from one sentence.",
      "allowed_tools": [
        "search_catalog",
        "forge_free",
        "check_job"
      ]
    }
  ]
}
tool     search_catalog {"q":"chair","kind":"object","limit":12}

GLB: https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/painted_wooden_chair_01.glb
Viewer: https://three.ws/viewer?src=https%3A%2F%2Fpub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev%2Fobjects%2Fpolyhaven%2Fglb%2Fpainted_wooden_chair_01.glb&title=Painted%20Wooden%20Chair%2001

glb      https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/painted_wooden_chair_01.glb

> GET https://three.ws/api/render/glb?glbUrl=<glb>&width=1024&height=1024
png      model.png (144478 bytes)
```

`THREE_WS_API_KEY=... ./run.sh --three-ws-only`, captured 2026-11-20 against
production. The poll lines are trimmed to the first and last:

```text
> GET https://three.ws/api/catalog?q=chair&kind=object&limit=3
catalog  Arm Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb
catalog  Bar Chair Round 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/bar_chair_round_01.glb
catalog  Barber Shop Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/BarberShopChair_01.glb

> POST https://three.ws/api/forge  authorization: Bearer <THREE_WS_API_KEY>  {
  "prompt": "a low-poly wooden chair",
  "backend": "nvidia",
  "path": "image"
}

> GET https://three.ws/api/forge?job=<job_id>   (every 5s)
job      running after 57s
job      running after 149s
glb      https://three.ws/cdn/forge/anon/efefc9dc-5ed9-445f-8e87-fdc608826f39.glb  (made in 180s)
viewer   https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fcdn%2Fforge%2Fanon%2Fefefc9dc-5ed9-445f-8e87-fdc608826f39.glb

> GET https://three.ws/api/render/glb?glbUrl=<glb>&width=1024&height=1024
png      model.png (211249 bytes)
```

The Grok run with an xAI key that is not valid, captured 2026-11-27. The
request reaches `api.x.ai` and the script prints xAI's own message, then exits `1`:

```text
error    xAI answered HTTP 400: Incorrect API key provided. You can obtain an API key from https://console.x.ai.
```

## Cost

- **three.ws:** free. Catalog, polling and rendering need no account. Making a
  model runs on the free lane with a free account. A cold GPU can take a few
  minutes, as in the sample above. A warm one usually answers in under a minute.
- **xAI:** Grok's input and output tokens at your model's
  [xAI rate](https://docs.x.ai/docs/models), a few thousand tokens per round.
