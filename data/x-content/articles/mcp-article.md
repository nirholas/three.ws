three.ws runs an MCP server that needs no account and no API key. Add its address to Claude Code, or to any client that speaks MCP over HTTP, and the assistant you are talking to gets fifteen free tools for 3D work: turn text or an image into a textured model, generate a rigged avatar, rig a model you already have, refine one by describing the change, search a catalog of ready-made assets, give the assistant a persistent body that speaks, and render a model from several angles so the assistant can see what it made. We connected to it while writing this, and the session below is that run, captured against production.

This article is the long version. It starts with the two lines that connect a client, walks the fifteen tools by what they are for, follows one real call to its last byte, and then covers the parts a builder needs before relying on it: how long jobs are collected, how retries stay safe, what the quotas are, and how an unattended agent gets a budget of its own.

## Connecting a client in one block

In Claude Code, put this in `.mcp.json` at the root of a project, and the tools are there the next time a session starts:

```json
{
  "mcpServers": {
    "three-ws-studio": {
      "type": "http",
      "url": "https://three.ws/api/mcp-studio"
    }
  }
}
```

Restart the session after adding it, because the file is read when a session starts. In the Claude apps, the address goes in as a custom connector with authentication set to None. Any other client only needs the facts in this table, which come straight from the server's reference page:

| Property | Value |
|---|---|
| URL | `https://three.ws/api/mcp-studio` |
| Transport | Streamable HTTP, JSON-RPC over `POST` |
| Auth | None, open and free |
| Protocol | MCP `2025-06-18` |
| Manifest | `server-studio.json` |

The server answers every request synchronously over `POST`, so there is no stream to hold open and no session to resume. A plain `curl` is a complete client for discovery:

```bash
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

The same tools are also served at two sibling addresses that share one generation quota: a ChatGPT-focused address with a reviewed subset of nine 3D tools and the model viewer, and a Grok address that answers every call within forty seconds. This article uses the main address, which serves all fifteen.

## What the fifteen tools do

The tools split into five groups, and each group answers a different question an assistant has while it works on a 3D task.

| Group | Tools | The question it answers |
|---|---|---|
| Generate | `forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`, `refine_model` | Make me this, rig this, change this |
| Collect | `check_job`, `get_job` | Is that long generation finished yet |
| Inspect | `look_at_model` | What does this model actually look like |
| Catalog | `search_catalog`, `get_catalog_item`, `get_item_source` | Does a ready-made one already exist |
| Persona | `create_agent_persona`, `get_agent_persona`, `persona_say` | Give the assistant a body that keeps its identity |

In more detail:

- **forge_free** turns a text prompt into a textured GLB. It takes a draft, standard or high tier, and standard is what you get when you leave the tier out.
- **text_to_avatar** and **mesh_forge** generate an avatar or an art-directed mesh from text or from a reference image.
- **rig_mesh** adds a skeleton to a model you already have, so it can be animated.
- **forge_avatar** generates a rigged, animation-ready avatar in one call.
- **refine_model** takes a model and a sentence describing a change, such as "make it metallic" or "add wings", and returns the refined model with its version lineage.
- **search_catalog**, **get_catalog_item** and **get_item_source** search the platform's free asset catalog of CC0 props, rigged characters and motion clips, read one item in full, and return paste-ready code that renders it on any site.
- **create_agent_persona**, **get_agent_persona** and **persona_say** save a rigged model as a persistent agent body, reload it by id in a later session, and speak a reply through it with lip-sync, emotion and gesture.

The server annotates its tools honestly. Five of the fifteen are marked read-only: `look_at_model`, the three catalog tools and `get_agent_persona`. A client that asks its user before running anything that writes can therefore run those five without a prompt, and that is the reason the run below used `look_at_model`.

## A real session, byte for byte

We used the official MCP TypeScript SDK to connect with no credentials at all, list the tools, and call `look_at_model` on a model hosted by three.ws itself: the expressive robot from the platform's shared animation library, a small orange character with a domed head and two round eyes. The whole client is a few lines:

```js
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const client = new Client({ name: 'look', version: '1.0.0' });
await client.connect(
  new StreamableHTTPClientTransport(new URL('https://three.ws/api/mcp-studio'))
);

const { tools } = await client.listTools();
console.log('tools:', tools.length);

const result = await client.callTool({
  name: 'look_at_model',
  arguments: { glb_url: 'https://three.ws/animations/robotexpressive.glb' },
});
for (const block of result.content) {
  console.log(block.type === 'text' ? block.text : `IMAGE ${block.mimeType}`);
}
```

The handshake reported the server as `three-ws-3d-studio-free`, version `1.0.0`, and `listTools` returned all fifteen. The call returned as one synchronous answer, and the capture below records how long it took, because the frames are rendered on the server rather than taken from a cache.

![The run, unedited apart from line wrapping. The client connects to the free 3D Studio server with no key, lists all fifteen tools with the five read-only ones marked, then calls look_at_model on a GLB of an orange robot and prints the text blocks and image frames that came back.](/x-media/mcp-article/session.png)

The result is one text block followed by four image frames, each introduced by a short text block naming the angle. The first text block opens with the angle list, then four plain links that every model result carries, then a reading of the geometry. For the robot it said:

```text
Rendered this model from 4 angle(s): three-quarter, front, side, back.

Geometry: 3,237 triangles, a normal real-time budget for a hero prop or character.
Carries 14 animation clip(s). No textures: the surface is untextured or
vertex-coloured only.

Look at the frames below and judge the model: is the subject complete and
recognisable, is the far side finished, is anything melted, fused, or missing?
If it needs work, generate again with a prompt that names the specific fault.
```

The four frames arrived as PNG images over the same JSON-RPC response, so a client with no file system still sees them. Here they are as the client received them:

![The four frames look_at_model returned for the robot, as the client received them: three-quarter, front, side and back, each rendered on the server and labelled with the camera angle it was taken from.](/x-media/mcp-article/four-views.png)

Two more angles are one argument away. Asking for `top` and `bottom` instead of the default four returns the views a character sheet usually leaves out. The top frame shows the dome of the head and how far the two round eyes sit forward of it, and the bottom frame shows the feet, the underside of the torso and the arms hanging from the shoulders:

![The robot from above and from below, rendered by a second look_at_model call that asked for the top and bottom views at 640 pixels, the two angles outside the default four.](/x-media/mcp-article/top-bottom.png)

## Why the assistant needs to look

A GLB file is opaque to a language model. Before this tool, an assistant that generated a model could hand you a link and had no way to check its own work. With frames in hand it can answer the questions a person would ask at a glance: is the subject complete and recognisable, is the far side finished, is anything melted, fused or missing. In the robot run, the back view shows the finished rear of the head and the shoulder joints, which is exactly the side a front-only preview would never have shown.

The text that comes back ends by telling the model to generate again with a prompt that names the specific fault, which turns one-shot generation into a loop the assistant can run by itself: generate, look, name what is wrong, refine, look again.

By default the tool renders four views at 512 pixels, which is enough to judge form without flooding the conversation. A caller can ask for up to six angles, adding top and bottom, and frames from 128 up to 1024 pixels. It works on any public GLB over https, not only on models made by the platform, and its structured result carries a link that opens the same model in the browser viewer.

A short note on the tiers, because they are the one choice a caller makes before any work starts. `forge_free` accepts `draft`, `standard` or `high`. Standard is the balanced free lane and the default. High runs on a self-hosted GPU worker for denser geometry, and it is opt-in on purpose: that worker shuts down when idle, so a cold container pays a spin-up before the generation begins. If the high lane declines or its submit times out, the call degrades to standard rather than failing the conversation, so an assistant that asks for high still comes back with a model.

## Four plain links on every result

Not every client draws a widget. A scripted agent, a cron job or a hosted bot sees only the JSON and the text, so every result that carries a model also carries four absolute links under fixed names:

| Field | What it is | Use it to |
|---|---|---|
| `viewer_url` | The interactive three.ws viewer for the model | Open the model in any browser, or hand a user a link |
| `glb_url` | The model file itself | Download it, re-host it, feed it to `rig_mesh` or `look_at_model` |
| `poster_png_url` | A rendered 1024 pixel PNG of the model | Attach a picture to a reply, a card or a markdown image |
| `embed_html` | A paste-ready snippet with its script tag pinned to a version and an integrity hash | Put the model on a web page |

For the robot, the `embed_html` field came back as a `<model-viewer>` tag, with the script pinned to version 4.4.0 and carrying a `sha384` integrity attribute, ready to paste. The same four lines open the text content, so a client that ignores the structured result still reads them first. An avatar or persona gets the `<agent-3d>` element instead, which is the web component covered in the embed guide.

## Collecting long generations without losing them

A detailed model can take longer than a single tool call should block for. When that happens the generating tool does not fail: it returns a success result carrying a handle for polling, and the job keeps running on the server. The pending envelope looks like this:

```json
{
  "status": "pending",
  "jobId": "f1.eyJwIjoiZ2NwIiw…",
  "viewer_url": "https://three.ws/viewer?job=f1.eyJwIjoiZ2NwIiw…",
  "stage": "mesh",
  "etaRemainingSeconds": 42,
  "prompt": "a friendly round robot mascot, glossy white plastic"
}
```

`stage` names which half of the pipeline is still running, mesh or rig, and `etaRemainingSeconds` is the live estimate for the lane running the job, so the assistant knows how long to wait rather than retrying blind. The `viewer_url` in a pending result is a page that polls the job itself and opens the model the moment it lands, so an assistant can give its user that link straight away.

Two tools collect the job. `check_job` returns the ordinary success envelope when the job is done, or a fresh pending envelope with an updated estimate. `get_job` is its machine-readable twin, reshaped so a script can branch on a single `status` field:

| `status` | Meaning |
|---|---|
| `queued` | Accepted and waiting for a worker; a cold GPU worker counts |
| `running` | Rendering, with `progress` and `eta_seconds` |
| `done` | Finished, with the four links |
| `failed` | The generation failed, with `error`, `retryable` and a `remedy` |
| `not_found` | The id is not recognised or has expired; final |
| `unknown` | The status check itself failed; the job is unaffected |

Neither collector counts against the generation quota, so collecting a slow model can never be rate limited by the generation that created it.

## Safe retries and live progress

A scheduled agent has needs that a one-shot chat does not have. It has to retry a timed-out call without starting a second generation, and it has to hear about progress while it waits.

Every generation tool accepts an optional `idempotency_key`. The same caller sending the same key with the same arguments within a day gets the original job back instead of a new generation, and the result carries `"idempotency": { "key": "…", "replayed": true }`. A different request under the same key is refused with a clear code, and a failure is never remembered, so the same key retries a failed attempt as a fresh job.

For progress, a call that carries a `progressToken` and accepts an event stream is answered as a stream, with a notification each time the job moves and the final result as the last event:

```text
event: message
data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"p1","progress":39,"total":100,"message":"Rendering, about 22s left"}}

event: message
data: {"jsonrpc":"2.0","id":3,"result":{"content":[…],"structuredContent":{"status":"pending",…}}}
```

A client that sends no token gets the ordinary single JSON response, unchanged, so adding progress never breaks a simple client.

## Quotas, and a budget of your own

The server is free, so it is rate limited, and the limits are stated plainly:

| Limit | Value |
|---|---|
| Generation burst | 4 per minute per IP |
| Generation hourly | 30 per hour per IP |
| Persona writes | 20 per minute per IP |
| Transport | 300 requests per minute per IP |

In words, the limits are four generations a minute and thirty an hour for each IP address, twenty persona writes a minute, and three hundred requests a minute across the transport. `look_at_model` rides the generation quota, because it renders frames on the server. Discovery calls such as `initialize` and `tools/list`, along with `check_job` and the catalog tools, are never throttled by it. A capped call returns HTTP 429 with a JSON-RPC error that names the limit, when it resets and how to lift it, so an assistant can read the reply and wait the right amount of time instead of guessing.

Hosted agents call from a shared cloud address, where a per-IP cap would ration every user behind it as one caller. For them the server mints an install token, which is free, anonymous and needs no account:

```bash
curl -s -X POST https://three.ws/api/mcp-studio/install
```

The response carries a `connector_url` with the token appended. Paste that URL as the connector address and the installation gets its own burst and hourly budget. Keep it private, because whoever holds the URL spends that installation's budget.

## Why the catalog tools live on this server

The platform's main MCP server lists the same three catalog tools, but a protocol client that connects there is sent through sign-in first, because most of that server's tools act on an account. With no account, the free server is where a client reaches the catalog, and the server's own instructions tell the assistant to search it before generating anything. A prop that already exists as CC0 is faster than a generation and costs no quota, since the catalog tools never count against it.

`get_item_source` is the tool that closes the loop for a builder. It returns paste-ready code for an item: the `<agent-3d>` tag pinned to a release and its integrity hash, a `<model-viewer>` tag, three.js or React. An assistant that finds a model can therefore also hand the user the exact markup to show it on their own site.

## Built on open work

The server speaks the Model Context Protocol, an open specification that any client can implement, and the example client above is the official TypeScript SDK from that project. Models are delivered as glTF binaries (GLB), the open format from the Khronos Group, which is why the same file opens in the three.ws viewer, in `<model-viewer>`, and in any engine that reads glTF. The rendered frames come from the open-source three.js library. The result also carries a Spatial MCP artifact, an open description of the model that any renderer built to that spec can display.

## The partners behind the studio

three.ws builds alongside a group of cloud, AI, hardware, infrastructure and media programmes. Each is an independent company, and each designation below is stated as the [partners page](https://three.ws/partners) states it.

**OpenAI.** three.ws is an OpenAI Select Partner in the OpenAI Partner Network. The studio server was built for the ChatGPT app directory as well as for any MCP client, which is why it has a ChatGPT address with its own reviewed tool set.

**IBM.** IBM is listed as a Strategic partner. three.ws 3D agent identity integrates with IBM watsonx and IBM Granite, so a persona made through this server can run an enterprise model behind its body.

**Amazon Web Services.** AWS is listed as a Cloud partner. three.ws is deployed on AWS infrastructure with Marketplace availability, so the models this server returns can sit inside a site hosted there.

**Google Cloud.** Google Cloud is listed as a Cloud partner. Google Cloud powers three.ws inference, storage, and real-time serving, and Vertex AI integration lets agents use Gemini models.

**Alibaba Cloud.** Alibaba Cloud is listed as a Cloud partner. It extends three.ws into APAC markets with Qwen model integration and regional MCP server deployment, which is the same protocol this article is about.

**NVIDIA.** three.ws is a member of NVIDIA Inception, NVIDIA's program for startups building on accelerated computing. Every 3D generation lane already runs on NVIDIA silicon, which is where the models these tools return come from.

**HackerNoon.** HackerNoon is listed as a Media partner: a builder-focused publishing partnership of feature articles, tutorials, and developer guides for people shipping with AI, which is where a guide like this one reaches builders.

**Quicknode.** Quicknode is listed as an Infrastructure partner, and three.ws is a member of the Quicknode Startup Program with approved infrastructure credits. Quicknode's globally distributed RPC endpoints add capacity and redundancy to the chain access behind agent wallets, for the agents that carry an on-chain identity.

## Try it

The reference page for this server is the one the table of properties above was read from, and it is where the tiers, the response shapes and the persona tools are written out in full.

![The 3D Studio MCP page on three.ws as it renders in a browser: the title, a short description of the free keyless server, the note that the paid studio is a separate server, and the connection table with URL, transport, auth and protocol.](/x-media/mcp-article/docs-page.png)

Add `https://three.ws/api/mcp-studio` to your client, ask the assistant to list its tools, and then ask it to look at any public GLB you have, or at the robot from this article at [three.ws/animations/robotexpressive.glb](https://three.ws/animations/robotexpressive.glb). The full reference for the tools, tiers, quotas and response shapes is the [3D Studio MCP page](https://three.ws/docs/mcp-studio), and ready-made prompts that drive these tools are in the [prompt library](https://three.ws/prompts). To see what a finished model looks like in the browser, open it in the [viewer](https://three.ws/viewer?src=https%3A%2F%2Fthree.ws%2Fanimations%2Frobotexpressive.glb), and to put a living body on a page, the [`<agent-3d>` documentation](https://three.ws/docs/web-component) takes it from there.
