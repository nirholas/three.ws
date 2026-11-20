# Grok + three.ws in Python (xai-sdk, remote MCP)

Grok finds a chair in the free three.ws catalog and, if none fits, makes a
low-poly wooden chair. It uses the official xAI Python SDK
([`xai-sdk`](https://pypi.org/project/xai-sdk/)) with the three.ws studio server
attached as a **remote MCP tool**. xAI connects to the server and runs the tool
calls on its own side. The script streams each call as it happens and prints the
final GLB URL.

## Prerequisites

- Python 3.10 or newer (3.12 pinned in `.python-version`).
- `XAI_API_KEY`: an xAI API key from [console.x.ai](https://console.x.ai).
- `THREE_WS_API_KEY`: a free three.ws account key from
  [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys). Catalog
  search works without it, but making a model needs it. xAI forwards it to the
  MCP server as the `authorization` token.

## Run it

```bash
cd examples/grok-python-mcp
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

# three.ws leg only: list the server's tools and search the catalog (no xAI key)
python main.py --check

# the full run
XAI_API_KEY=... THREE_WS_API_KEY=... python main.py

# any other request
XAI_API_KEY=... THREE_WS_API_KEY=... python main.py "make a brass desk lamp"
```

With [uv](https://docs.astral.sh/uv/): `uv venv && uv pip install -r requirements.txt && uv run main.py --check`.

| Variable | Default | Purpose |
|---|---|---|
| `XAI_API_KEY` (or `GROK_API_KEY`) | none | Required for the Grok run. |
| `THREE_WS_API_KEY` | none | Required to make a model. Catalog search is public. |
| `XAI_MODEL` | `grok-4.7` | Any xAI model that supports remote MCP tools. |
| `THREE_WS_MCP_URL` | `https://three.ws/api/mcp-studio` | Point at a local server while developing. |

Exit codes: `0` success, `1` a call failed (the message says which side and why), `2` no xAI key.

## How it works

```python
chat = client.chat.create(
    model="grok-4.7",
    tools=[mcp(
        server_url="https://three.ws/api/mcp-studio",
        server_label="three-ws",
        allowed_tool_names=["search_catalog", "forge_free", "check_job"],
        authorization=os.environ["THREE_WS_API_KEY"],
    )],
    include=["verbose_streaming"],   # stream the server-side tool calls too
)
for response, chunk in chat.stream():
    for call in chunk.tool_calls:
        print(call.function.name, call.function.arguments)
```

A generation on a cold GPU can outlast one call. The server never holds a call
past 40 seconds: it answers with a pending `job_id`, and the script continues
the same chat every 20 seconds, asking Grok to collect it with `check_job`, for
up to 8 rounds.

## Sample output

`python main.py --check`, captured 2026-11-20 against production:

```text
server   three-ws-3d-studio-free (https://three.ws/api/mcp-studio)
tools    16 offered; this example allows search_catalog, forge_free, check_job
catalog  Arm Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb
catalog  Bar Chair Round 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/bar_chair_round_01.glb
catalog  Barber Shop Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/BarberShopChair_01.glb
ok       three.ws leg is live
```

The full run with an xAI key that is not valid shows how xAI answers. The
request really reaches `api.x.ai`:

```text
note     THREE_WS_API_KEY is not set: catalog search works, but making a model needs a free key from https://three.ws/dashboard/api-keys
error    xAI answered INVALID_ARGUMENT: Incorrect API key provided. You can obtain an API key from https://console.x.ai.
```

The free generation the server runs for `forge_free` was captured the same day
through the [curl example](../grok-curl/README.md): "a low-poly wooden chair"
became `https://three.ws/cdn/forge/anon/efefc9dc-5ed9-445f-8e87-fdc608826f39.glb`
in 180 seconds.

## Cost

- **three.ws:** free. Catalog search needs no account. Making a model runs on the
  free lane and needs only a free account.
- **xAI:** you pay for Grok's input and output tokens at your model's
  [xAI rate](https://docs.x.ai/docs/models). A run is one short prompt plus the
  tool results, a few thousand tokens per round.
