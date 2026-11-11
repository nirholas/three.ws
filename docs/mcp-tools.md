# MCP Tools Catalog

three.ws ships several [MCP](mcp.md) servers: tool servers that AI assistants
(Claude, ChatGPT, any MCP client) can call directly. One is free and 3D-only; the
others expose paid tools that settle per call in USDC over [x402](x402.md). This
page explains how the servers are grouped and how the paid ones charge.

> **Looking for a specific tool?** The complete, always-current list lives at
> **[/mcp-tools](/mcp-tools)**: every tool on every server, searchable, with its
> price and whether an AI client can run it unattended. That page is generated
> from the source of each tool on every build, so it cannot drift. The same data
> is machine-readable at [`/mcp-catalog.json`](/mcp-catalog.json).
>
> The tables below are a curated orientation to the servers, not the full index.
> Where a figure here and the catalog disagree, the catalog is right.

[![The MCP Tool Catalog on a phone: the stat strip wraps, the filters stay reachable, and each tool card shows its safety class, price, and host server](/docs/img/mcp-catalog-mobile.png)](/mcp-tools)

*The catalog on a phone. Search, filters and the per-tool detail all work at
320px, so you can look a tool up from anywhere.*

> Source: [`api/mcp-studio.js`](../api/mcp-studio.js) (free),
> [`api/mcp-3d.js`](../api/mcp-3d.js) + [`api/_mcp3d/pricing.js`](../api/_mcp3d/pricing.js)
> (paid studio), `api/_mcp*/` + `packages/*-mcp` (agent/commerce tools).

---

## How the totals are calculated

The totals are computed, never typed. At build time `npm run build:mcp-catalog` imports the exact catalog each hosted endpoint serves, and loads every stdio package in-process and asks it for `tools/list`, `resources/list` and `prompts/list` over an in-memory MCP transport. The result is [`/tools.json`](/tools.json) and [`/mcp-catalog.json`](/mcp-catalog.json), currently <!-- mcp-count:all.tools -->794<!-- /mcp-count --> tools (<!-- mcp-count:all.uniqueTools -->672<!-- /mcp-count --> unique names) on <!-- mcp-count:all.servers -->56<!-- /mcp-count --> servers. At request time [`/api/mcp-census`](/api/mcp-census) recounts the hosted endpoints from the running code and reports whether they still match the build.

- **tools**: every tool a server can serve, including financial-tier tools the policy hides until a session enables them.
- **resources, templates, prompts**: the matching `*/list` entries, prompts rendered against that server's own catalog.
- **unique**: distinct tool names. `/api/mcp-chatgpt` and `/api/mcp-grok` serve subsets of `/api/mcp-studio`, so per-server figures overlap.

Every tool declares all four annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) and a description with a "Use this when..." line; `tests/mcp-tool-quality.test.js` fails otherwise, and `tests/mcp-prompt-references.test.js` fails when a prompt names a tool, resource or prompt that does not exist. Run both with `npm run test:mcp-surface`.

**Quoting a count in a doc.** Wrap it in a marker: `<!-- mcp-count:mcp-3d.tools -->40<!-- /mcp-count -->`. The key is `<scope>.<field>`: scope is `all`, `hosted`, `stdio` or a server id from `/tools.json`; field is `servers`, `tools`, `uniqueTools`, `resources`, `templates`, `prompts`, `free` or `paid`. `npm run check:mcp-counts` (part of `npm run gate`) fails on a marker that disagrees with the census and on an unmarked "N tools" in a living doc that is about a server; `npm run check:mcp-counts -- --fix` rewrites marker values. Add `<!-- mcp-count-ignore -->` to a line whose number is not about a three.ws server.

## Per-tool pages and releases

Every tool has a page at `/mcp-tools/<server>/<tool>` with its schema, an example call (curl, JSON-RPC body, client config), its price and hints. Free, read-only tools served over HTTP have a try-it form that calls the live endpoint. [`/mcp-tools#releases`](/mcp-tools#releases) shows which tools each release added, built from git history into [`/mcp-tool-history.json`](/mcp-tool-history.json).

---

## How paid MCP tools charge

The paid servers follow the MCP v2 transport convention: a `tools/call` made
**without** an x402 payment payload in `_meta` returns a `PaymentRequired`
structuredContent that quotes the price and the accepted networks. The client
settles the USDC payment (Solana or Base) and retries the call with the payment in
`_meta`. Generation tools quote by quality tier so the 402 quote, the verified
payment, and the settled charge all match the work requested.

A few tools are **free** (no payment, wallet, or key) — notably `forge_free` and
the read-only studio helpers below.

## Free 3D Studio — `/api/mcp-studio`

A free, non-crypto MCP server for the ChatGPT App Directory and any MCP client. It
exposes **only** 3D generation/inspection — no account, no payment, no token. See
[3D Studio MCP](mcp-studio.md).

### Quickstart: attach the studio to a Foundry agent

Foundry Agent Service accepts any public remote MCP server as an agent tool, so
the studio works there with no account, key, or connection secret. These steps
follow Microsoft's current guides,
[Connect agents to MCP server endpoints](https://learn.microsoft.com/azure/foundry/agents/how-to/tools/model-context-protocol)
and the unauthenticated path in
[Connect an MCP server to Foundry Agent Service](https://learn.microsoft.com/azure/azure-functions/functions-mcp-foundry-tools)
(both checked on 2026-11-11).

You need a Foundry project with a deployed chat model and the **Foundry User**
role on it.

**Portal**

1. Open the [Foundry portal](https://ai.azure.com/nextgen).
2. Select the **Build** tab and open the agent that should design 3D assets (or
   create one).
3. In the **Playground** tab, expand **Tools** and select **Add**.
4. On the **Custom** tab of **Select a tool**, select **Model Context Protocol
   (MCP)** > **Create**.
5. Fill in **Add Model Context Protocol tool**:

   | Field | Value |
   |---|---|
   | Name | `threews_studio` |
   | Remote MCP Server endpoint | `https://three.ws/api/mcp-studio` |
   | Authentication | `Unauthenticated` |

6. Select **Connect**. `threews_studio` appears under **Tools**. Select **Save**.
7. In the playground chat, try `Find a ready-made lantern, then generate a
   weathered bronze ship's lantern and give me the GLB link.` Review each tool
   call the agent requests and select **Approve**.

**Python SDK** (`pip install azure-ai-projects azure-identity openai`, then
`az login`)

```python
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import MCPTool, PromptAgentDefinition
from azure.identity import DefaultAzureCredential

# Overview page of your project: https://<account>.services.ai.azure.com/api/projects/<project>
PROJECT_ENDPOINT = "https://<account>.services.ai.azure.com/api/projects/<project>"

with AIProjectClient(endpoint=PROJECT_ENDPOINT, credential=DefaultAzureCredential(), allow_preview=True) as project:
    studio = MCPTool(
        server_label="threews_studio",
        server_url="https://three.ws/api/mcp-studio",
        # The studio is free and read-only apart from starting a free generation,
        # so this sample skips approvals. Use "always" to review every call.
        require_approval="never",
        allowed_tools=["search_catalog", "forge_free", "check_job"],
    )
    agent = project.agents.create_version(
        agent_name="prop-designer",
        definition=PromptAgentDefinition(
            model="gpt-5-mini",  # any chat model deployed in your project
            instructions=(
                "You design 3D props. Search the three.ws catalog first, then call forge_free "
                "for a custom model. If forge_free returns a pending job, call check_job with its "
                "job_id until the model is ready. Always return the real GLB and viewer links."
            ),
            tools=[studio],
        ),
    )
    with project.get_openai_client(agent_name=agent.name) as openai:
        conversation = openai.conversations.create()
        response = openai.responses.create(
            conversation=conversation.id,
            input="Generate a weathered bronze ship's lantern and give me the GLB link.",
        )
        print(response.output_text)
        openai.conversations.delete(conversation_id=conversation.id)
    project.agents.delete_version(agent_name=agent.name, agent_version=agent.version)
```

The same tool definition in REST or another SDK is
`{"type": "mcp", "server_label": "threews_studio", "server_url": "https://three.ws/api/mcp-studio", "require_approval": "never", "allowed_tools": ["search_catalog", "forge_free", "check_job"]}`.

Things to know:

- **Foundry ends a non-streaming MCP tool call after 100 seconds.** A generation
  takes longer, so when a plain (unstreamed) `forge_free` call has no model
  inside 40 seconds, the studio answers with a pending `job_id`. The agent then
  collects the model with `check_job`. Keep `check_job` in `allowed_tools`.
- **Name tools explicitly.** An empty `allowed_tools` list (`[]`) allows every
  tool the server lists, not none.
- **Toolboxes work too.** To share the studio across agents, register it once
  with `azd ai connection create threews-studio --kind remote-tool --target https://three.ws/api/mcp-studio --auth-type none`
  and reference that connection from a Foundry toolbox.
- **Code-first alternatives.** For Semantic Kernel or Microsoft Agent Framework
  in your own process, use the packages in
  [three.ws on the Microsoft agent stack](microsoft-agent-stack.md).

Microsoft, Azure, and Microsoft Foundry are trademarks of the Microsoft group of
companies.

### GitHub Copilot in VS Code and the Copilot coding agent

**VS Code, zero config.** Install the [three.ws 3D extension](vscode.md#in-github-copilot-chat)
(0.3.0 or newer). It registers the free studio server with VS Code as an MCP
server definition provider, and **3D: Connect my three.ws Account to Copilot
Agent Mode (MCP)** adds the account server. Agent mode then lists the studio's
tools beside the extension's own five.

**VS Code, by hand.** Without the extension, add the servers to
`.vscode/mcp.json` in the workspace (or to your user MCP configuration with
**MCP: Open User Configuration**):

```json
{
  "servers": {
    "threews-studio": {
      "type": "http",
      "url": "https://three.ws/api/mcp-studio"
    },
    "threews": {
      "type": "http",
      "url": "https://three.ws/api/mcp"
    }
  }
}
```

The studio needs no credentials. For `threews`, VS Code reads the server's
authorization metadata and runs the browser sign-in itself the first time the
server starts. To use an API key from
[three.ws/dashboard/api](https://three.ws/dashboard/api) instead, prompt for it
so it never lands in the file:

```json
{
  "inputs": [
    { "type": "promptString", "id": "threews-key", "description": "three.ws API key (sk_live_...)", "password": true }
  ],
  "servers": {
    "threews": {
      "type": "http",
      "url": "https://three.ws/api/mcp",
      "headers": { "Authorization": "Bearer ${input:threews-key}" }
    }
  }
}
```

**GitHub Copilot coding agent.** In the repository on GitHub, open
**Settings > Copilot > Coding agent** and paste this into **MCP configuration**:

```json
{
  "mcpServers": {
    "threews-studio": {
      "type": "http",
      "url": "https://three.ws/api/mcp-studio",
      "tools": ["*"]
    }
  }
}
```

The coding agent runs tools without asking, so list tool names instead of
`"*"` to keep it to read-only ones (`search_catalog`, `get_catalog_item`, `search_docs`) if you do
not want it starting GPU jobs. For the account server the coding agent cannot
run a browser sign-in: add the key as the secret `COPILOT_MCP_THREEWS_API_KEY`
in the repository's `copilot` environment (**Settings > Environments**) and
reference it by name:

```json
{
  "mcpServers": {
    "threews": {
      "type": "http",
      "url": "https://three.ws/api/mcp",
      "headers": { "Authorization": "Bearer $COPILOT_MCP_THREEWS_API_KEY" },
      "tools": ["*"]
    }
  }
}
```

GitHub and GitHub Copilot are trademarks of GitHub, Inc.

## Material Studio (hosted, free) — `/api/material-studio`

A free, rate-limited (not x402) REST endpoint backing the [Restyle Studio](/restyle)
web page: live PBR material editing, AI restyle, seeded colorway variants, and
texture swaps for any GLB. Not an MCP tool itself: the paid `restyle_material`
tool (listed under the agent tools below) and the web page both call it as a thin
client, so the free and paid surfaces share one implementation. See
[`api/_lib/material-studio-store.js`](../api/_lib/material-studio-store.js) and the
[Material Studio API reference](api-reference.md#material-studio-api).

Every restyle and every persisted variant set is recorded in an immutable
parent → child version lineage — the same shape `refine_model` uses
(`mcp-server/src/tools/_lineage.js`) — so a caller can revert to, or branch off,
any earlier version. Pass the `lineage` array a previous call returned back in as
`parent_lineage` to extend one thread.

## Paid 3D Studio — `/api/mcp-3d`

Generation tools price by tier (identical to `POST /api/x402/forge`); mesh-editing
and direction tools are flat per call.

| Tool | Price (USDC) | What it does |
|---|---|---|
| `text_to_3d` | tiered (draft/standard/high) | Text → textured GLB. |
| `image_to_3d` | tiered (draft/standard/high) | Image(s) → textured GLB. |
| `auto_rig_model` | $0.05 | Add an animation-ready skeleton to a GLB. |
| `capture_scene` | $0.05 | Video → 3D scene reconstruction (coloured point cloud). |
| `retexture_model` | $0.05 | Repaint a full mesh from a text prompt. |
| `retexture_region` | $0.05 | Magic-brush retexture of a masked region. |
| `stylize_model` | $0.02 | Voxel / brick / voronoi / lowpoly restyle. |
| `remesh_model` | $0.02 | Repair, simplify, or convert mesh format. |
| `segment_model` | $0.02 | Split a mesh into named parts. |
| `remove_background` | $0.01 | Cut a subject from a reference photo. |
| `pose_model` | $0.01 | Pose a rigged model from a text prompt. |
| `apply_animation` | $0.01 | Retarget a library clip onto a rigged GLB. |
| `direct_prompt` | $0.01 | Rewrite a vague idea into a tight 3D spec. |
| `generate_material` | $0.01 | PBR material parameters from a description. |
| `anchor_provenance` | $0.05 | Sign a content credential and anchor its hash on Solana. |

Free studio helpers (no charge): `getting_started`, `generation_status`,
`preview_3d`, `list_animations`, `animation_signature`, `find_similar_animations`,
`text_to_animation`, `inspect_model`, `optimize_model`, `save_avatar`, `export_ar`,
`verify_provenance`, `grade_sim_readiness` (the physics grade: whether a solver
could use a GLB as a rigid body, and exactly what is wrong when it could not,
see [Simulation readiness](sim-readiness.md); free so an agent can check ten
candidates before paying for one), `x402_preflight` (asks any x402 seller's
signed payability attestation whether it can actually settle before you pay it;
free on purpose and permanently), the persona tools (`create_agent_persona`, `get_agent_persona`,
`persona_say`, `persona_identity`, `persona_tip`, `persona_send`), and
`validate_spatial_response` (the [Spatial MCP](spatial-mcp.md) conformance gate).
Every catalog tool is either priced or on this explicit free list; a test fails
the build if a new tool is neither.

## Agent & commerce tools — `3d-agent-local`

The flagship agent server bundles avatar generation, market intel, naming,
reputation, and live agent-to-agent commerce. **`forge_free` is the one free
generation lane**; the rest are paid and quote their price in the
`PaymentRequired` challenge at call time.

| Tool | Price | What it does |
|---|---|---|
| `forge_free` | **Free** | Text → textured GLB on the free NVIDIA NIM (Microsoft TRELLIS) lane; returns a GLB URL + viewer link. |
| `crypto_news` | **Free** | Live crypto headlines from every publisher feed in the registry (`api/_lib/news-sources.js`, 27 categories, 17 languages), filterable by category, source, language, or search. |
| `crypto_news_digest` | **Free** | Clusters the last 1-72h of coverage into distinct narratives with stance, tickers, and covering outlets. |
| `news_resolve` | **Free** | Resolves one article URL into a bounded excerpt, summary, tickers and a structured trading read (assets with exposure and direction, priced-in, horizon, counter-argument). Blocked or paywalled pages are recovered from the Internet Archive, SEC EDGAR or sibling coverage; `extraction` names the lane. |
| `crypto_news_archive` | free quota, then $0.001/search | Search 660,000+ archived articles back to September 2017. Stats and trending modes are always free; search is free up to a daily per-IP quota, then $0.001 USDC per search via x402. |
| `text_to_avatar` | paid | Text → 3D avatar. |
| `mesh_forge` | paid | Text/image → 3D mesh via a Granite-directed model chain. |
| `rig_mesh` | paid | Auto-rig a GLB into an animation-ready model. |
| `forge_avatar` | paid | One call: text → rigged avatar (mesh + auto-rig, humanoid-gated). |
| `refine_model` | paid | Conversational iteration — describe a change ("make it metallic", "bigger helmet") on a prior model; anchored re-generation with a revertable/branchable version lineage. |
| `restyle_material` | paid | Re-skin a GLB without regenerating its mesh — AI PBR restyle from an instruction ("make it chrome", "wooden", "cyberpunk neon") or seeded, reproducible colorway variant fan-out from a PBR preset; parent → child lineage. See [Restyle Studio](/restyle). |
| `get_pose_seed` | paid | Pose generation. |
| `ens_sns_resolve` | paid | ENS + SNS name resolution. |
| `pump_snapshot` | paid ($0.005) | Live Solana token snapshot: Jupiter price, DexScreener volume/pair, pump.fun metadata, on-chain top-holder distribution. |
| `sentiment_pulse` | paid | Token sentiment pulse. |
| `agent_reputation` | paid | ERC-8004 agent reputation read. |
| `vanity_grinder` | paid | Solana vanity address mining. |
| `vanity_premium` | free | Browse the premium pre-ground vanity address inventory. |
| `aixbt_intel` / `aixbt_projects` | paid | Market narrative intel feed / momentum-ranked project scans. |
| `agenc_list_tasks` / `agenc_get_task` / `agenc_get_agent` | paid | [AgenC](agenc.md) coordination reads. |
| `agent_delegate_action` | paid | Agent-to-agent delegation. |
| `agent_hire_discover` | paid | Discover + reputation-rank agents to hire for a task. |
| `agent_hire` | paid | Hire an agent end to end: quote, settle USDC via x402, run it, return result + provenance receipt, with hard spend caps. |

> Free vs. paid is fixed per tool; exact USDC amounts for the paid agent tools are
> quoted in each tool's `PaymentRequired` response at call time (and are tunable by
> the operator), so always read the challenge rather than assuming a figure.

## Account status, dashboard links and X posting

On the `threews-agent` server ([api/_mcpagent/account-tools.js](../api/_mcpagent/account-tools.js)):

| Tool | Tier | What it does |
| --- | --- | --- |
| `get_account_status` | read | Plan, limits, what is left, agent count, wallet summary (needs `wallet:read`), approvals waiting. Same data as `GET /api/v1/me/status`. |
| `get_dashboard_urls` | read | Canonical same-origin page links. Pass `page` for one. |
| `connect_twitter` | write | The link the owner opens to connect an X account to an agent. Connects nothing itself. |
| `configure_twitter_posting` | write | An agent's posting policy: kinds, daily cap, minimum gap, tone rules, review-before-post. |
| `post_to_x` | write | Requests a post through the agent's policy. With review-before-post on, the post is queued and nothing is published. A refusal (paused, kind not allowed, tone, daily cap, queue full, not connected) comes back with its reason code. |
| `list_scheduled_posts` | read | Posts waiting for review and posts scheduled or recently sent. |

All X tools call `requestAgentPost` and the policy helpers in [api/_lib/x-agent-policy.js](../api/_lib/x-agent-policy.js), so the tools, `/api/x/agents` and the settings page enforce one policy.

## Other MCP servers

| Server | File | Surface |
|---|---|---|
| Agent MCP | `api/mcp-agent.js` | Agent build/control tools. |
| Bazaar MCP | `api/mcp-bazaar.js` | x402 service discovery — see [x402 bazaar](mcp-x402-bazaar.md). |
| IBM MCP | `api/ibm-mcp.js` | watsonx / Granite integration — see [IBM](ibm.md). |
| pump.fun MCP | `api/pump-fun-mcp.js` | Launch/trade tools — see [Solana pump.fun](solana-pumpfun.md). |
| Viewer Control | `api/chat/mcp.js` | Drives a live model viewer (wireframe, lighting, screenshots, load a model); tools in `api/_lib/viewer-mcp-tools.js`. |

## $THREE only

Tools that reference a coin reference **$THREE**
(`FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump`). Tools that accept an arbitrary
token (`pump_snapshot`, `sentiment_pulse`) take the mint as runtime input and
promote no specific token.

## Related

- [MCP](mcp.md) overview · [3D Studio MCP](mcp-studio.md) ·
  [3D Studio (paid)](mcp-3d-studio.md) · [x402 bazaar](mcp-x402-bazaar.md)
- [x402 paid endpoints](x402-endpoints.md) — the same capabilities over REST.
- [MCP tool safety](mcp-safety.md) - what each tool's safety annotations mean,
  and the build check that verifies them against the code.
- [The full catalog](/mcp-tools) - every tool, searchable by safety and price.
