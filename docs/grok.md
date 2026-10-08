# three.ws for Grok and Grok Bot

Give Grok a 3D studio and a body. One remote MCP server lets Grok Bot, Grok
connectors and the xAI API turn text or an image into a textured 3D model, a
rigged animation-ready avatar, or a named 3D persona that lip-syncs its replies.
It is free: no account, no payment, no API key. Sign the same URL in to your
three.ws account and it also manages your agents, their memory and skills,
without ever being able to spend.

**Live page and demo:** [three.ws/grok](/grok)

| | |
|---|---|
| **URL** | `https://three.ws/api/mcp-grok` |
| **Transport** | Streamable HTTP (JSON-RPC over `POST`) |
| **Auth** | None. Optional: a connector API key, or OAuth 2.1 at `https://three.ws/api/mcp-grok?auth=oauth` |
| **Protocol** | MCP `2025-06-18` |
| **Tools** | The full free studio: the same fifteen tools as [`/api/mcp-studio`](./mcp-studio.md). Signed in, also your [account's agent tools](#your-account-on-the-same-url) |

## Grok Bot

Grok Bot adds a custom MCP server from chat. Send:

```
Add a custom MCP server called three-ws at https://three.ws/api/mcp-grok
```

Say "custom server" (the sentence above does), or Grok Bot may look for a
marketplace plugin instead. It shows the name and URL and asks you to confirm.
No sign-in card appears, because there is nothing to sign in to. Then ask for 3D
in any task, or attach the server with `@three-ws`:

- "Make a 3D model of a reusable rocket booster with grid fins, then send me the viewer link and the GLB."
- "Give yourself a body: forge a friendly white robot, save it as your persona, and say hello to me with it."
- "Turn this photo into a rigged, animation-ready 3D avatar and save the GLB to my files."

Grok Bot works on its own cloud computer, so it can save the GLB to its files,
hand it to another tool in the same task, or run the request on a schedule.

## Your account on the same URL

The free studio needs no account. To let Grok Bot also work with **your**
agents, their memory and skills, and your avatars (on a schedule, say), keep the
same URL and give it a credential. Two ways:

- **Connector key (recommended for Grok Bot).** At [three.ws/dashboard/api](/dashboard/api) choose **New key**, then **For an AI agent (Grok Bot, schedules, CI)**, name it, and copy the key it shows once. Ask Grok Bot to add a custom MCP server at `https://three.ws/api/mcp-grok` with API key authentication, and store the key as a Bot secret. It is sent as `Authorization: Bearer sk_live_…`.
- **OAuth 2.1.** Use `https://three.ws/api/mcp-grok?auth=oauth` as the server URL with OAuth authentication. The `?auth=oauth` form answers an anonymous client with `401` and a `WWW-Authenticate` challenge, which is what makes an MCP client start sign-in; the plain URL serves anonymous clients and so never would. The connector registers itself, you approve the consent screen once, and every token it holds is refused the moment you revoke the app in [Connected apps](/dashboard/settings#connected-apps).

Signed in, `tools/list` adds these to the fifteen studio tools, each only when
the credential's scopes allow it and your [MCP tool settings](/settings/mcp-tools)
leave it on:

| Tool | What it does |
|---|---|
| `create_agent`, `attach_avatar_to_agent` | Create an agent on your account and give it a body you generated with `forge_avatar`. |
| `identity_check`, `call_agent` | Screen an agent identity, or send another three.ws agent a message and get its reply. |
| `remember`, `recall` | Your agents' long-term memory. |
| `list_available_skills`, `import_community_skill`, `list_custom_skills`, `get_custom_skill`, `create_custom_skill`, `update_custom_skill` | Your agents' prompt-only skills. |
| `list_my_avatars`, `get_avatar`, `get_embed_code`, `render_avatar_image` | Your avatars, their embed snippets and rendered images. |

**It never spends.** No wallet, payment, card, trading, launch or delete tool is
ever listed on this URL, whatever scopes the credential holds, and calling one by
name answers `unknown tool`. Those actions happen in a browser at
[three.ws/dashboard](/dashboard). The same tools run through the core server's
policy, scope checks and spend gate exactly as on `/api/mcp`, and the free tools
stay anonymous: signing in changes nothing about what they do, except that your
generation caps key on your account instead of the MCP session.

A credential that no longer verifies (expired, revoked, or minted for another
server) is answered with `401` and the challenge rather than served anonymously,
so a connector re-authenticates instead of quietly losing your tools. An account
tool called without signing in answers JSON-RPC `-32002` with
`data.reason: "sign_in_required"` and the OAuth URL. Scopes and the exact spend
refusal: [API key scopes](./mcp.md#api-key-scopes).

## Grok connectors

On paid Grok plans, custom connectors take a remote MCP URL (remote servers
only, which this is). Open **Connectors**, add a **custom** connector, paste
`https://three.ws/api/mcp-grok`, and leave authentication off. Business and
Enterprise workspaces may need an admin to allow custom connectors first.

## xAI API

The Responses API connects to remote MCP servers on xAI's side. Pass the server
as a tool ([xAI's Remote MCP docs](https://docs.x.ai/developers/tools/remote-mcp)):

```bash
curl https://api.x.ai/v1/responses \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "grok-4.7",
    "input": [{"role": "user", "content": "Make a 3D model of a lunar lander and give me the viewer link."}],
    "tools": [{
      "type": "mcp",
      "server_url": "https://three.ws/api/mcp-grok",
      "server_label": "three-ws"
    }]
  }'
```

With the Python SDK (`pip install xai-sdk`):

```python
import os
from xai_sdk import Client
from xai_sdk.chat import user
from xai_sdk.tools import mcp

client = Client(api_key=os.environ["XAI_API_KEY"])
chat = client.chat.create(
    model="grok-4.7",
    tools=[mcp(server_url="https://three.ws/api/mcp-grok", server_label="three-ws")],
)
chat.append(user("Make a 3D model of a lunar lander and give me the viewer link."))
print(chat.sample().content)
```

Add `allowed_tools` (`allowed_tool_names` in the Python SDK) to expose only the
tools a task needs, for example `["search_catalog", "forge_free", "get_job"]`.
A complete, zero-dependency Node script that also collects slow renders lives in
[examples/grok-remote-mcp](../examples/grok-remote-mcp/README.md).

## What Grok gets

| Tool | What it does |
|---|---|
| `forge_free` | Text to a textured 3D model (GLB). |
| `text_to_avatar`, `mesh_forge` | An avatar or an art-directed mesh from text or a reference image. |
| `forge_avatar` | Generate and rig a character in one step. |
| `rig_mesh` | Add a humanoid skeleton to any static GLB. |
| `refine_model` | Change a model in words ("make it metallic") with a version history. |
| `get_job` | Status of a render that outlived one call: `status`, `progress`, `eta_seconds`, then the model and its links. `check_job` does the same and stays for older clients. |
| `look_at_model` | Render a GLB from several angles so Grok can see what it made. |
| `search_catalog`, `get_catalog_item`, `get_item_source` | Thousands of ready-made CC0 props, rigged characters and motion clips, plus paste-ready embed code. |
| `create_agent_persona`, `get_agent_persona`, `persona_say` | Save a rigged model as a named body, bring it back later, and make it speak a reply with lip-sync and emotion. |

Every finished model comes back with a `viewer_url` (an interactive viewer that
opens in any browser), a `glb_url`, a `poster_png_url` and `embed_html`. Nothing
renders inline in Grok, so this URL lists no widget templates and no `ui://`
resources, and the server's instructions tell Grok to hand those links to the
user. Signed in, Grok also gets the [account tools](#your-account-on-the-same-url).

## How it behaves under Grok

**No call hangs.** A model usually lands in under a minute, but a GPU that has
scaled to zero boots first, and a render can take a few minutes. Grok calls MCP
from xAI's cloud with no published timeout, so this surface answers every call
within 40 seconds: with the model, or with a pending job and the seconds to
wait. The server's instructions tell Grok to call `get_job(job_id)` until the
model is done and keep going without asking the user.

**Retries never generate twice.** Every generation tool takes an optional
`idempotency_key`. A scheduled task that passes its task id as the key and
retries after a timeout gets the first run's job back (`idempotent_replay:
true`), not a second model, and the retry costs none of its quota. Keys belong to
the caller, so a task that reconnects keeps them only on a connector URL with an
install token (below). Details:
[Retries and `idempotency_key`](./mcp-studio.md#retries-and-idempotency_key). In the Responses API,
where Grok cannot wait between calls in one response, continue the conversation
with `previous_response_id`, as the example does.

**Your own quota.** Every Grok user reaches three.ws from xAI's shared egress,
so per-IP limits would ration all of Grok as a single caller. MCP Streamable
HTTP has a per-connection identity: on `initialize` the server issues an
`Mcp-Session-Id`, and a conforming client sends it back on every later request.
`/api/mcp-grok` keys the per-caller generation caps on that session. Minting a
session is free, so a per-IP pool cap and the platform-wide breaker still bound
the total, the same design the ChatGPT surface uses with OpenAI's per-user
subject. A client that never echoes the session falls back to per-IP limits.

**A quota that survives reconnects.** A session lasts one connection. For a
budget that stays yours across every Grok Bot task, add the connector with an
install token: `curl -s -X POST https://three.ws/api/mcp-studio/install` (or
**Generate my connector URL** on [/connect](/connect?server=three-ws-studio))
returns a `connector_urls.grok` of the form
`https://three.ws/api/mcp-grok?install=<token>`. The caps then key on the token,
ahead of the session and the IP. It is free, anonymous and never expires; see
[install tokens](./mcp-studio.md#connector-url-for-cloud-agents-install-tokens).

**When generation is refused.** A capped generation answers a JSON-RPC error
whose message Grok can relay as is: which limit was hit, when it resets, and the
connector URL that lifts it (an install token, or the signed-in server for a
caller that already has one).

## How it fits the platform

`/api/mcp-grok` is one of three front doors on the same handler
([`api/_mcp-studio/handler.js`](../api/_mcp-studio/handler.js)); `SURFACES` in
[`api/_mcp-studio/dispatch.js`](../api/_mcp-studio/dispatch.js) defines what each
advertises. The account tools come from the core server through
[`api/_mcp-studio/account-tools.js`](../api/_mcp-studio/account-tools.js), whose
allowlist only admits a tool the shared policy says moves no value. They share one generation quota and one breaker, so the Grok door
never adds GPU spend of its own. See [the free 3D Studio MCP](./mcp-studio.md)
for the tools in depth and [MCP integration](./mcp.md) for every hosted server.
