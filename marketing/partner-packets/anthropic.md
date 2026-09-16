# Anthropic: an honest packet

**There is no Anthropic partnership, program membership, or co-marketing agreement.** Anthropic is not on
`/partners`, and nothing in the repo records a contact at Anthropic. This packet covers the three
self-serve distribution surfaces that are ready, the public co-marketing routes that actually exist
(verified 2026-09-16), and a draft for the one route three.ws can use today.

**Owner's one step:** publish the three staged servers to the official MCP Registry
(`mcp-publisher login github`, review, then run
[`prompts/store-submissions/_generated/mcp-registry-republish.sh`](../../prompts/store-submissions/_generated/mcp-registry-republish.sh)).
It is the only surface with no eligibility or policy question left open; the other two each need an owner
decision first, listed below.

---

## How three.ws actually depends on Claude (checked 2026-09-16)

| Fact | Evidence |
|---|---|
| New agents default to an Anthropic brain | [`src/manifest.js`](../../src/manifest.js) sets `brain.provider: 'anthropic'` for a saved agent with no brain configured; all 8 agent templates in [`src/templates.js`](../../src/templates.js) use `claude-sonnet-4-6`; agent delegation defaults to `claude-haiku-4-5-20251001` |
| The platform can serve Claude through Vertex AI on GCP credits | [`api/_lib/vertex-claude.js`](../../api/_lib/vertex-claude.js), `VERTEX_CLAUDE_PRIMARY` puts Vertex Claude at the head of the chain |
| **Production does not serve Claude by default today** | Cloud Run has no `ANTHROPIC_API_KEY`; `VERTEX_CLAUDE_ENABLED=0` and `VERTEX_CLAUDE_PRIMARY=0`; Vertex is billing-denied on the project (logs 2026-09-16T16:15Z). A Claude-configured agent is served by the free fallback chain unless the user brings their own key |
| The MCP servers are built for Claude clients | [three.ws/docs/mcp](https://three.ws/docs/mcp) opens with "lets Claude and other MCP-compatible AI systems interact with your three.ws account" |
| Claude Code plugins and skills exist | [`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json) lists 4 plugins; `.agents/skills/` holds the skills pack |

Say "built for Claude" and "agents default to Claude models", never "powered by Claude" or "runs on
Claude", until a Claude lane serves production traffic.

---

## Dispatch checklist: the three ready surfaces

### 1. Official MCP Registry

- **Intake:** `mcp-publisher` CLI against https://registry.modelcontextprotocol.io
- **Current state (queried 2026-09-16):** 72 distinct `io.github.nirholas/*` server names are already
  live. The three staged servers, `herald-mcp`, `knock-mcp`, and `home-mcp`, are **not** in the registry.
- [ ] `mcp-publisher login github` as the `nirholas` GitHub account
- [ ] Read `prompts/store-submissions/_generated/mcp-registry-republish.sh` and confirm it publishes only
      those three
- [ ] Run it
- [ ] Re-query `https://registry.modelcontextprotocol.io/v0/servers?search=nirholas` and record the three
      new entries in [TRACKER.md](../../prompts/store-submissions/_generated/TRACKER.md)

### 2. Claude plugin marketplace (community catalog)

- **Intake:** https://platform.claude.com/plugins/submit (200 on 2026-09-16), which feeds
  https://github.com/anthropics/claude-plugins-community. The curated official marketplace has no
  public submission ([SUBMISSION.md](../../marketplace/plugins/three-ws-3d/SUBMISSION.md)).
- **Submit only `three-ws-3d`.** The repo's own marketplace file carries four plugins; one of them is
  third-party coin-launchpad tooling, which falls under the owner's commit and promotion gate for other
  crypto projects and should not be submitted to Anthropic.
- [ ] `claude plugin validate ./marketplace/plugins/three-ws-3d --strict` (the connector docs ask for this
      before submitting)
- [ ] Re-drive the install test in SUBMISSION.md section 3; the recorded evidence dates from 2026-07-08
- [ ] Submit the form with the plugin path and repository URL
- [ ] Record the submission in TRACKER.md

### 3. Claude Connectors Directory

- **Intake:** remote MCP servers submit **only** through the submission portal in Claude.ai
  organization settings, which requires a **Team or Enterprise** organization and an Owner or Directory
  permission ([submission docs](https://claude.com/docs/connectors/building/submission), read 2026-09-16).
  The "public form" fallback in the older submission sheet applies to desktop extensions (MCPB), not to
  remote servers. Escalations: `mcp-review@anthropic.com`.
- **Review criteria that bite** ([review criteria](https://claude.com/docs/connectors/building/review-criteria)):
  connectors are not accepted if they "Transfer money, cryptocurrency, or other financial assets" or
  "Generate images, video, or audio via AI models".
- **The submission sheet is stale.** [claude-submission.md](../../prompts/store-submissions/_generated/claude-submission.md)
  (2026-09-03) says `/api/mcp` has 53 tools; a live `tools/list` on 2026-09-16 returned **61 tools**
  (45 read-only, 4 destructive, all titled). It also says the market tools "do not move funds or execute
  trades", but the live list now includes a copy-trading setup tool (`copy_subscribe`) and an on-chain NFT
  mint (`mint_3d_asset`). `/api/mcp-3d` has 36 tools including `persona_tip` and `persona_send`, which move
  real funds.
- **Discovery behaviour:** `POST /api/mcp` `tools/list` with `Accept: application/json` returns 200
  without credentials; with the streamable-HTTP header `Accept: application/json, text/event-stream` it
  returns 401 with an OAuth `WWW-Authenticate` challenge. Confirm which the portal sends before relying
  on credential-free tool sync.
- [ ] **Owner decision:** get a Team or Enterprise Claude organization with Owner access, or stop here
- [ ] **Owner decision:** submit a scoped server with no fund-moving, trading, or minting tools. The
      cleanest candidate is the free, keyless `/api/mcp-studio` (3D generation only, no payment surface),
      but ask `mcp-review@anthropic.com` first whether 3D model (GLB) generation counts as media generation
- [ ] Regenerate claude-submission.md against the live server
- [ ] Generate a real `MCP_REVIEW_SECRET` and decide reviewer credentials (tracker item 3)
- [ ] Submit in the portal; record the submission id

---

## Public Anthropic co-marketing routes (researched 2026-09-16)

| Route | Is it real and self-serve? | Fit for three.ws today |
|---|---|---|
| **Claude for Startups** | Yes. https://claude.com/programs/startups, apply at https://claude.com/form/startups-application. The page offers credits and priority rate limits to venture-backed startups ("Mention your investor when you apply"), plus community and events for founders | **Best route.** Credits would directly fund the Claude lane production lacks. Funding status is not recorded in the repo, so credit eligibility is unverified; the community side does not depend on it |
| **Community meetups and demo nights** | Yes. The startups page links "Meetups and demo nights organized by founders building with Claude" at https://luma.com/claudecommunity and Anthropic-hosted events at https://www.anthropic.com/events | Good fit with the in-world event format; needs a named host and date |
| **Customer stories** | Page exists at https://claude.com/customers with published stories. **No public submission form was found**; stories appear to originate with Anthropic's own teams | Not available as a cold submission. Revisit if an Anthropic account team exists |
| **Official Claude plugin marketplace** | No public submission; Anthropic reaches out | Not available |
| **Connectors Directory and MCP Registry listings** | Yes, covered above | Distribution, not co-marketing |

---

## Draft: Claude for Startups application

The form fields were not opened (it is an external form). The program page says applicants should mention
investors; third-party guides, not Anthropic, say applicants need a Claude Console account, company
email, website, and a description. Use these blocks for whatever the form asks.

**Company description**

> three.ws is an open-source platform for 3D AI agents. It turns a text prompt into a rigged,
> animation-ready 3D character, gives it a brain, a voice, and an on-chain identity, and embeds it on any
> website with one tag. An agent with no brain configured defaults to a Claude model, our agent templates use Claude Sonnet, our MCP servers are documented for
> Claude clients first, and we ship Claude Code plugins and skills.

**What will you build with Claude**

> Make Claude the default brain that actually serves every three.ws agent in production, not only the
> configured default. Today agents are configured for Claude Sonnet but fall back to free models because
> the platform has no funded Claude lane. Credits and priority rate limits would let every embedded agent
> think, call tools, and speak through Claude, and let us publish a scoped 3D connector to the Claude
> Connectors Directory.

**Traction** (re-read on submission day)

> 74,846 avatars, 3,817 agents, and 632 embedded widgets (public stats, 2026-09-16); 39,675 3D
> generations started since June 2026; 72 servers on the official MCP Registry; OpenAI Select Partner
> and IBM Business Partner.

**Investors:** owner supplies. Not recorded in the repo.

---

## Packet fields

**One-sentence pitch:** a 3D agent platform whose agents are configured for Claude and whose MCP servers
are built for Claude clients, asking for the startup credits that would let Claude actually serve them.

**100-word abstract:** three.ws turns a text prompt into a rigged 3D AI agent embeddable on any website.
An agent with no brain configured defaults to a Claude model, its eight agent templates use Claude Sonnet, and its MCP
servers and Claude Code plugins are built for Claude clients, with 72 servers already on the official MCP
Registry. Production cannot yet serve that default: there is no funded Claude lane, so agents fall back
to free models. A Claude for Startups award would close that gap and support a scoped submission of the
free 3D connector to the Claude Connectors Directory. There is no existing Anthropic partnership.

**Working link:** https://three.ws/docs/mcp (200 on 2026-09-16)

**Screenshot:** [images/docs-mcp.png](images/docs-mcp.png), captured 2026-09-16. Alt text: "three.ws MCP
Integration docs explaining how Claude can list, render, validate, and inspect 3D avatars."

**Founder bio:** not in the repo; owner supplies.

**Two proposed dates:** not applicable for the application. If hosting a community demo night, propose
dates only after a host and venue (in-world or physical) are named.

**Requested action:** accept three.ws into Claude for Startups.

**Approved relationship wording:** none exists. Allowed: "three.ws agents default to Claude models",
"MCP servers built for Claude", "listed on the official MCP Registry". Not allowed: "Anthropic partner",
"in partnership with Anthropic", "powered by Claude" (production does not serve Claude by default), or any
Anthropic logo lockup. After acceptance: "a member of Claude for Startups".

## Metrics used

| Metric | Value | Source | Captured |
|---|---|---|---|
| Servers on the official MCP Registry | 72 distinct names | Registry API, paginated search for `nirholas` | 2026-09-16 |
| Staged, unpublished registry servers | 3 | Same query, plus TRACKER.md | 2026-09-16 |
| `/api/mcp` tools | 61 (45 read-only, 4 destructive, 61 titled) | Live `tools/list` | 2026-09-16 |
| `/api/mcp-3d` tools | 36 (16 read-only, 2 destructive) | Live `tools/list` | 2026-09-16 |
| Avatars / agents / widgets | 74,846 / 3,817 / 632 | `https://three.ws/api/platform/stats` | 2026-09-16T16:02Z |
| Claude-served production traffic | **Not measurable: no Claude lane is enabled** | Cloud Run env | 2026-09-16 |
