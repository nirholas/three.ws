# Grok with three.ws 3D tools through a LiteLLM proxy

[LiteLLM](https://github.com/BerriAI/litellm) is a self-hosted, open-source
gateway to 100+ models that also hosts an MCP gateway. This example gives you
one OpenAI-compatible endpoint that does two things:

1. Routes the model alias `grok` to xAI's Grok (`xai/grok-4.7`).
2. Registers the three.ws studio MCP server (`https://three.ws/api/mcp-studio`,
   Streamable HTTP) in LiteLLM's MCP gateway.

Any client that speaks the OpenAI Responses API gets Grok with the three.ws 3D
tools: it asks, the proxy lets Grok call `search_catalog` (and the free
generation tools), runs the calls itself, and returns Grok's final answer.
[`main.py`](main.py) is a small standard-library client that proves each hop.

Files: [`config.yaml`](config.yaml) (the whole proxy setup),
[`main.py`](main.py) (client), `requirements.in` and a fully pinned
`requirements.txt`.

## Prerequisites

- Python 3.10 or newer (3.12 pinned in `.python-version`).
- `XAI_API_KEY`: an xAI key from [console.x.ai](https://console.x.ai). The
  proxy reads it, never the client. Not needed for `--check`.
- `LITELLM_MASTER_KEY`: any secret string you choose. It is the key your
  clients present to the proxy (see "Why a master key").
- Optional `THREE_WS_API_KEY`: a free key from
  [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys). Catalog
  search needs no account; making or rigging a model does.

## Run it

```bash
cd examples/litellm-grok-gateway
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt

export LITELLM_MASTER_KEY=sk-pick-any-local-secret

# terminal 1: the proxy (add XAI_API_KEY=... for the Grok leg)
XAI_API_KEY=... litellm --config config.yaml --host 127.0.0.1 --port 4317

# terminal 2: the gateway leg only, no xAI key: list the tools, search the catalog
python main.py --check

# the full run: Grok, through the proxy, with the three.ws tools
python main.py
python main.py "find a rigged character I can animate"
```

| Variable | Default | Purpose |
|---|---|---|
| `LITELLM_MASTER_KEY` | none | Required by proxy and client. |
| `XAI_API_KEY` | none | Read by the proxy for the `grok` alias. |
| `LITELLM_BASE_URL` | `http://127.0.0.1:4317` | Where the client finds the proxy. |
| `THREE_WS_API_KEY` | none | Forwarded to three.ws per request. |
| `GROK_ALIAS` | `grok` | The `model_name` in `config.yaml`. |

Exit codes: `0` success, `1` a call failed (the message says what the proxy or
xAI answered), `2` a key is missing (the client's `LITELLM_MASTER_KEY`, or the
proxy has no `XAI_API_KEY`).

## How it works

`config.yaml`, in full:

```yaml
model_list:
  - model_name: grok
    litellm_params:
      model: xai/grok-4.7
      api_key: os.environ/XAI_API_KEY

mcp_servers:
  three_ws:
    transport: http
    url: https://three.ws/api/mcp-studio
    allowed_tools: [search_catalog, forge_free, check_job]
    allow_all_keys: true

general_settings:
  master_key: os.environ/LITELLM_MASTER_KEY
```

- **The MCP endpoint.** The gateway serves every registered server at
  `http://127.0.0.1:4317/mcp` (Streamable HTTP). Clients like Claude Code,
  Cursor or the `mcp` SDK can point straight at it. Tools are namespaced with
  the server name: `three_ws-search_catalog`. `x-mcp-servers: three_ws` scopes a
  session to one server.
- **Grok with the tools.** Send a Responses API request with a `type: "mcp"`
  tool whose `server_url` is `litellm_proxy/mcp/three_ws`. LiteLLM fetches the
  server's tools, hands them to Grok, runs the calls Grok asks for, and loops
  until Grok answers. The client never sees a tool-call round trip:

```python
body = {
    "model": "grok",
    "input": "find a wooden chair in the free catalog and give me its viewer link",
    "tools": [{
        "type": "mcp",
        "server_label": "three_ws",
        "server_url": "litellm_proxy/mcp/three_ws",
        "require_approval": "never",
    }],
}
# POST {proxy}/v1/responses with  Authorization: Bearer $LITELLM_MASTER_KEY
```

- **API key.** Send the three.ws key per request in the header
  `x-mcp-three_ws-authorization: Bearer $THREE_WS_API_KEY` (the pattern is
  `x-mcp-<server>-authorization`). `main.py` does this when `THREE_WS_API_KEY`
  is set, on the `/mcp` calls and in the Responses `tools` entry (`headers`).
  The header is verified on the `/mcp` path only; a run with a valid key was not
  made here. three.ws checks the key when it lists tools, so a key that is not
  valid makes the gateway list no tools. The alternative, a server-wide token in
  `config.yaml` (`auth_type: bearer_token` with
  `authentication_token: os.environ/THREE_WS_API_KEY`), makes LiteLLM refuse to
  list the server's tools while that variable is unset (LiteLLM 1.111.0 answers
  `MCPAuth.bearer_token requires a usable upstream credential`), which is why
  this example keeps the key on the client.
- **Why a master key.** LiteLLM scopes MCP servers to virtual keys, and a proxy
  without a database has none. With `master_key` set and `allow_all_keys: true`
  on the server (the setting LiteLLM's own database-less test config uses), the
  master key can use it, and no database is involved. For per-team
  keys and access groups you add a database (LiteLLM's virtual keys); that is
  outside this example. Nothing here needs LiteLLM's enterprise licence.
- **Tool names.** `allowed_tools` is the filter LiteLLM applies per server.
  Three tools are exposed here; delete the line to expose all of the studio
  server's tools.
- **Model id.** `xai/grok-4.7` is the id this repo uses today. Change it to any
  xAI model that supports tool calling; the alias `grok` stays the same.

## Sample output

Proxy on `127.0.0.1:4317`, LiteLLM 1.111.0, captured 2026-11-27 against
production three.ws, signed out of three.ws (nothing was generated).

`python main.py --check`, with the proxy started without any xAI key:

```text
gateway  http://127.0.0.1:4317/mcp, server three_ws
tools    3 through the gateway: three_ws-forge_free, three_ws-check_job, three_ws-search_catalog
catalog  Arm Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/ArmChair_01.glb
catalog  Bar Chair Round 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/bar_chair_round_01.glb
catalog  Barber Shop Chair 01  https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb/BarberShopChair_01.glb
ok       gateway leg is live
```

`python main.py` against that same proxy, no xAI key. LiteLLM says so itself
(exit `2`):

```text
error    the proxy answered HTTP 500: {"error":{"message":"litellm.APIConnectionError: APIConnectionError: XaiException - XAI API key is required. Set api_key, litellm.xai_key, litellm.api_key, XAI_API_KEY, or use_xai_oauth=True. ...
```

The same with an xAI key that is not valid. The request really reaches
`api.x.ai`, and the gateway surfaces xAI's own answer (exit `1`):

```text
error    the proxy answered HTTP 400: {"error":{"message":"litellm.BadRequestError: XaiException - {\"code\":\"invalid-argument\",\"error\":\"Incorrect API key provided. You can obtain an API key from https://console.x.ai.\"}\n\nLiteLLM: model group 'grok' failed with the error above. No fallback was attempted.","type":"invalid_request_error","param":null,"code":"400"}}
```

`XAI_API_KEY=... litellm ...` then `python main.py`, the full run. Grok called
`search_catalog` through the gateway and answered from the real result:

```text
tool     call-41103b37-6be8-4313-9003-793e342fa558-0: 10 matches for "wooden chair" (showing 10 from offset 0):

**Wooden Chair 01** (CC0) is in the free catalog.

Viewer: https://three.ws/viewer?src=https%3A%2F%2Fpub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev%2Fobjects%2Fpolyhaven%2Fglb%2FWoodenChair_01.glb&title=Wooden%20Chair%2001

ID: `object:WoodenChair_01`

viewer   https://three.ws/viewer?src=https%3A%2F%2Fpub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev%2Fobjects%2Fpolyhaven%2Fglb%2FWoodenChair_01.glb&title=Wooden%20Chair%2001
```

A run with a three.ws key (making a model, `forge_free`) was not captured here;
the same call path is captured without a key above, and the studio's free
generation is shown in the [curl example](../grok-curl/README.md).

## Supply chain

LiteLLM's PyPI package had compromised releases in March 2026 (1.82.7 and
1.82.8). This example pins `litellm[proxy]==1.111.0` (the GitHub "Latest"
release of 2026-11-25, present on PyPI and not yanked) and every transitive
dependency in `requirements.txt`, compiled with `pip-compile` against packages
uploaded before 2026-11-25 so nothing brand new gets pulled in. Install it in a
virtual environment, never globally, and read the diff before you bump a pin.

## Cost

- **three.ws:** free. Catalog search needs no account; making a model runs on
  the free lane and needs only a free account.
- **LiteLLM:** open source, runs on your machine. No hosted service.
- **xAI:** you pay Grok's token rates. Each tool turn sends the tool list and
  results, about 9,000 input tokens for this request (xAI reported about
  $0.014 for one).
