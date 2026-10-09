# three.ws for Grok and Grok Bot

Give Grok a 3D studio and a body. One remote MCP server lets Grok Bot, Grok
connectors and the xAI API turn text or an image into a textured 3D model, a
rigged animation-ready avatar, or a named 3D persona that lip-syncs its replies.
The studio is free: no account, no payment, no API key. Sign in once and the
same URL also manages your three.ws agents, never your wallet.

**Live page and demo:** [three.ws/grok](/grok)

| | |
|---|---|
| **URL** | `https://three.ws/api/mcp-grok` |
| **Transport** | Streamable HTTP (JSON-RPC over `POST`) |
| **Auth** | None for the studio. OAuth 2.1 or a connector API key adds your agent tools. |
| **Protocol** | MCP `2025-06-18` |
| **Tools** | The full free studio: the same fourteen tools as [`/api/mcp-studio`](./mcp-studio.md) |

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
tools a task needs, for example `["search_catalog", "forge_free", "check_job"]`.
A complete, zero-dependency Node script that also collects slow renders lives in
[examples/grok-remote-mcp](../examples/grok-remote-mcp/README.md).

## Sign in to add your agents

The URL works anonymously. To let Grok also manage the agents on your account,
connect it with a credential and the same URL lists more tools:

- **OAuth 2.1:** use `https://three.ws/api/mcp-grok?auth=oauth` as the connector
  URL. That URL answers an anonymous request with a `401` and the protected
  resource metadata at
  `/.well-known/oauth-protected-resource/api/mcp-grok`, which is what makes an MCP
  client start sign-in. After consent the connector holds a token for this
  server only.
- **API key:** create a key at [three.ws/dashboard](/dashboard) and send it as
  the bearer token. A key lists only the tools its scopes allow.

A bearer that does not verify (expired, revoked, minted for another server) gets
the same `401` challenge instead of a silent anonymous session, so the client
re-authenticates.

| Signed-in tool | What it does |
|---|---|
| `list_my_agents` | The account's agents with their ids, page URLs and public Solana addresses. |
| `create_agent`, `identity_check`, `call_agent` | Create an agent, read its identity, send another agent a message. |
| `attach_avatar_to_agent` | Give an agent a body you just generated. |
| `remember`, `recall` | Read and write an agent's memory. |
| `list_available_skills`, `list_custom_skills`, `get_custom_skill`, `create_custom_skill`, `update_custom_skill`, `import_community_skill` | Prompt-only agent skills. |
| `list_my_avatars`, `get_avatar`, `get_embed_code`, `render_avatar_image` | Your avatar library and its embed code. |

**It never moves funds.** A core tool is listed here only when it is on this
allowlist, outside the financial tier of the shared tool policy, not scoped to
wallet, payment or trade, and not priced on `/api/mcp`. A tool call runs only
if that caller's `tools/list` shows it, so a token holding a wallet scope still
cannot reach a wallet tool through this URL. Wallet, payment and launch actions
stay in the browser at [three.ws/dashboard](/dashboard). Your
[MCP tool settings](/mcp-tools) can switch any listed tool off. This surface
lists no widget templates and no `ui://` resources, since Grok renders none.

## Prompts for scheduled tasks

`prompts/list` on this URL offers guided prompts written for an unattended agent. Each names exact tools and argument shapes, never asks you a question mid-run, and tells Grok to pass an `idempotency_key` on every generation so a retried or double-fired schedule collects the original job instead of generating twice.

| Prompt | Arguments | What a scheduled run produces |
|---|---|---|
| `agent-get-started` | none | A short tour of the tools and one real example with its links. |
| `daily-3d-brief` | `topic` or `trending` | A model and a poster image for the day's topic, with the four links. |
| `asset-pack` | `theme`, `count` | A table of catalog props plus generated gap-fillers. |
| `avatar-from-photo` | `image_url` | A rigged avatar, its links and a pose studio link. |
| `agent-report` | `focus` | A read-only status report on your agents. Listed only once the connector is signed in. |

Example schedule text for Grok Bot: "Every morning at 8, run the three.ws prompt `daily-3d-brief` with topic trending and post the poster image and viewer link here." The full prompt list and arguments are in the [guided prompts](/docs/mcp) section.

## A skill file for Grok

Grok Skills and Grok Bot can read a plain Markdown file. [`https://three.ws/grok-skill.md`](https://three.ws/grok-skill.md)
is one written for them: what three.ws does, the sentence that adds the connector,
runnable `curl` JSON-RPC calls for when no connector is set up (open a session,
list tools, search the catalog, generate, collect with `check_job`), the four links
every result carries, the free limits, what needs an account, and the spend rule.
Upload it to Grok Skills or tell Grok Bot to read it.

It is generated, not hand-written. The prose lives in
[`data/grok-skill-md.template.md`](../data/grok-skill-md.template.md), and the URLs
and limits it quotes come from [`data/skill-md.facts.json`](../data/skill-md.facts.json),
the same file the general [`skill.md`](./agent-skills.md) entry point reads, so the
two cannot disagree. `node scripts/build-skills-pack.mjs` renders it,
`npm run check:skills-pack` fails when it is stale, and
`tests/grok-skill-md.test.js` checks that every URL in it resolves to a route this
server serves and that the limits match the handler.

## What Grok gets

| Tool | What it does |
|---|---|
| `forge_free` | Text to a textured 3D model (GLB). |
| `text_to_avatar`, `mesh_forge` | An avatar or an art-directed mesh from text or a reference image. |
| `forge_avatar` | Generate and rig a character in one step. |
| `rig_mesh` | Add a humanoid skeleton to any static GLB. |
| `refine_model` | Change a model in words ("make it metallic") with a version history. |
| `check_job` | Collect a render that outlived one call. |
| `look_at_model` | Render a GLB from several angles so Grok can see what it made. |
| `search_catalog`, `get_catalog_item`, `get_item_source` | Thousands of ready-made CC0 props, rigged characters and motion clips, plus paste-ready embed code. |
| `create_agent_persona`, `get_agent_persona`, `persona_say` | Save a rigged model as a named body, bring it back later, and make it speak a reply with lip-sync and emotion. |

Every finished model comes back with a `viewer_url` (an interactive viewer that
opens in any browser), a `glb_url`, a `poster_png_url` and `embed_html`. Nothing
renders inline in Grok, and the server's instructions tell Grok to hand those
links to the user.

## How it behaves under Grok

**No call hangs.** A model usually lands in under a minute, but a GPU that has
scaled to zero boots first, and a render can take a few minutes. Grok calls MCP
from xAI's cloud with no published timeout, so this surface answers every call
within 40 seconds: with the model, or with a pending job and the seconds to
wait. The server's instructions tell Grok to call `check_job(job_id)` until the
model is done and keep going without asking the user. In the Responses API,
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

**When generation is refused.** A rate-limited request answers HTTP 429 with a
`retry-after` header and a plain sentence Grok can relay.

## How it fits the platform

`/api/mcp-grok` is one of three front doors on the same handler
([`api/_mcp-studio/handler.js`](../api/_mcp-studio/handler.js)); `SURFACES` in
[`api/_mcp-studio/dispatch.js`](../api/_mcp-studio/dispatch.js) defines what each
advertises. They share one generation quota and one breaker, so the Grok door
never adds GPU spend of its own. See [the free 3D Studio MCP](./mcp-studio.md)
for the tools in depth and [MCP integration](./mcp.md) for every hosted server.
