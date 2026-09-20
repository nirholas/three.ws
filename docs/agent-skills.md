# three.ws Agent Skills pack

The three.ws **Agent Skills pack** is a set of portable skill folders that teach any
Claude surface — Claude Code, the Claude apps, the Agent SDK — how to use the
three.ws platform: create and rig 3D models, run a wallet, and buy/sell services in
the x402 agent economy.

> Not to be confused with the [in-app skills system](skills.md), which extends
> avatars and agents **inside** three.ws with `manifest.json` + `tools.json` +
> `handlers.js` bundles. Agent Skills are the inverse: they extend **external**
> AI agents with three.ws capabilities.

Each skill follows the [Agent Skills open standard](https://agentskills.io/specification):
a folder with a `SKILL.md` whose frontmatter `description` is the *trigger* — the only
text the model sees when deciding to load the skill — plus optional scripts and
reference files loaded on demand (progressive disclosure).

## What's in the pack

The pack lives at [`.agents/skills/`](../.agents/skills/). The full index with every
trigger is generated into [`.agents/skills/SKILLS.md`](../.agents/skills/SKILLS.md)
(human) and [`.agents/skills/skills-pack.json`](../.agents/skills/skills-pack.json)
(machine/registry) by `node scripts/build-skills-pack.mjs`.

Three categories:

| Category | Skills | Notes |
| --- | --- | --- |
| **3d/creative** | `find-3d-assets`, `generate-3d-model`, `create-3d-avatar`, `rig-a-model` | Text→GLB on the free lane, one-call rigged avatars, auto-rigging. **Cross-platform-safe**: zero coin/wallet/payment content, so this subset is reusable on non-Claude tracks (OpenAI, etc.). |
| **platform/agents** | `create-a-three-ws-agent`, `build-an-agent-skill`, `sell-an-agent-skill`, `hire-an-agent`, `connect-three-ws-mcp` | Building ON three.ws: create an agent with a body, wallet and persona; author an in-app skill bundle; publish and price it in $THREE; hire another agent; wire a client to the MCP servers. Written against the public REST + MCP surfaces, so they work from any Claude surface. |
| **wallet/payments** | `authenticate-wallet`, `fund`, `send-usdc`, `trade`, `search-for-service`, `pay-for-service`, `monetize-service`, `query-onchain-data`, `x402`, `metamask-agent-*`, okx wallet/identity set | The x402 agent-economy set. Never bundle these on non-crypto tracks. |
| **intel/trading** | okx dex/defi market-data and execution set | Vendored partner skills (byte-identical to the vendor drop; categorized only in the pack manifest). |

`skills-pack.json` carries `category`, `origin` (`three.ws` / `okx` / `metamask`), and
`crossPlatformSafe` per skill, so a registry or a bundling script can slice the pack
without reading every folder.

## Install paths

### a) As a Claude Code plugin

The pack ships inside the `three-ws-core` plugin of this repo's
[plugin marketplace](../.claude-plugin/marketplace.json):

```
/plugin marketplace add nirholas/three.ws
/plugin install three-ws-core@three-ws
```

Skills load automatically; invoke one directly with `/generate-3d-model`,
`/send-usdc`, etc.

### b) Dropped into a project

Copy (or symlink) any skill folder into a project's `.claude/skills/`. This repo
does exactly that: on every `npm install`,
[`scripts/setup-claude-skills.mjs`](../scripts/setup-claude-skills.mjs) symlinks
every folder from `.agents/skills/` into the gitignored `.claude/skills/`:

```bash
cp -r .agents/skills/generate-3d-model  ~/my-project/.claude/skills/
```

Claude Code picks it up on the next session; the folder is self-contained, so it
works copied out of this repo.

### c) Uploaded to a Claude app / project

In the Claude apps, upload a skill folder (or its zipped form) under
**Project → Skills** (capabilities). The same `SKILL.md` drives triggering there —
no code changes needed. For the Agent SDK, pass the folder via the `skills`
option / skills directory the SDK exposes.

## Authoring rules for this pack

- **Frontmatter**: `name` (must equal the folder name, kebab-case, ≤64 chars) and
  `description` (≤1024 chars, written as a trigger: *what it does + when to use it*,
  with the phrases users actually say). Optional `when_to_use` adds routing hints.
- **Metadata tags**: native skills carry `metadata.category`,
  `metadata.cross-platform-safe`, and `metadata.pack: three-ws-skills` in
  frontmatter. Vendored skills (`okx-*`, `metamask-*`) are never edited — their
  categories live in `scripts/build-skills-pack.mjs`.
- **Progressive disclosure**: `SKILL.md` stays short (<500 lines); heavy reference
  material goes in a linked file (`reference.md`, `references/…`) loaded on demand.
- **Real content only**: every endpoint, tool name, and response shape in a skill
  is the production one; every bundled script must run. No stubs, no mock output.
- **Self-contained**: a skill folder must work when copied out of this repo — no
  relative imports into app internals.
- After adding or editing a skill, regenerate the manifest:
  `npm run build:skills-pack` (CI-style check: `npm run check:skills-pack`, wired into
  `npm run gate`). Category prose lives in one `CATEGORY_DESCRIPTIONS` map in that
  script, so a new category cannot be counted while its description is missing.

### d) Downloaded from three.ws, no clone

The 3D skills are published as a public directory anyone can read or fetch:

```bash
curl -O https://three.ws/skills/3d-studio/three-ws-3d-skills.zip   # the whole set
curl https://three.ws/skills/3d-studio/generate-3d-model/SKILL.md  # just one
```

That directory, [`public/skills/3d-studio/`](../public/skills/3d-studio/), is
generated from `.agents/skills/` and tracked in git, so it is browsable on GitHub
and served from the site. The zip is also exactly what an OpenAI Plugin Directory
submission uploads on its Skills tab.

```bash
npm run build:openai-skills     # regenerate it
npm run check:openai-skills     # fail if it drifted (wired into npm run gate)
```

Two rules the builder enforces, both of which change what ships:

**Scope.** Only skills whose frontmatter declares `metadata.category: 3d/*` and
`cross-platform-safe: true` are published. The pack's wallet and exchange skills
are not part of a 3D bundle, and OpenAI's packaging guidance asks for
instructions scoped to the plugin's purpose.

**No dead paths.** The builder reads the tool names
[`api/_mcp-studio/`](../api/_mcp-studio/) declares and drops any skill that
references one the endpoint does not serve. When run online it first checks that
the live endpoint and this checkout agree on the tool surface, and fails if they
do not, because that disagreement means production is running different code.
`find-3d-assets` is excluded today on the first rule: its `search_catalog` /
`get_catalog_item` / `get_item_source` tools live on the full MCP server, not on
the hosted studio endpoint, and inside ChatGPT there is no shell to reach the
skill's `curl` fallback. Ship those three on mcp-studio and the skill rejoins the
bundle with no edit to the builder.

Published Markdown follows the repo's dash rule; the canonical files under
`.agents/skills/` are never rewritten.

## The platform skills

The set that turns a Claude session into a three.ws build surface. Each one is written
against the public API (bearer key from
[/dashboard/api](https://three.ws/dashboard/api)) and names the exact endpoint, body
schema, and failure envelope, so the model does not have to guess.

- **`create-a-three-ws-agent`**: forge a body, save it with
  `POST /api/avatars/from-forge`, create the identity with `POST /api/agents` (the
  custodial Solana wallet is minted in that request), then set the persona with
  `PUT /api/agents/:id`. Returns the live `/agents/:id` page. Includes the
  `409 identity_conflict` path, which is the integrity gate refusing a look-alike
  identity rather than a bug to retry.
- **`build-an-agent-skill`**: author the four-file in-app bundle
  (`manifest.json` + `SKILL.md` + `tools.json` + `handlers.js`), the `ctx.*` handler
  context, the Web Worker sandbox limits, the trust policy, and how to install and test
  the bundle. Its worked example calls a real public API end to end.
- **`sell-an-agent-skill`**: publish to the catalog (`POST /api/skills`), price per call,
  price an agent's skill in $THREE (`PUT /api/monetization/prices`), metered trials and
  pay-what-you-want (`PUT /api/agents/:id/skills-pricing`), the 250 bps author split, and
  where the money lands.
- **`hire-an-agent`**: the demand side. Browse `/api/agents/economy?view=offers`, take a
  metered trial, buy over Solana Pay, or let one agent hire another with
  `POST /api/agents/a2a-hire` under per-call and daily spend caps. Carries the mandatory
  spend-confirmation card.
- **`connect-three-ws-mcp`**: wire Claude Code, Claude Desktop, the Agent SDK, or any
  JSON-RPC client to the hosted MCP servers, starting from the free one that needs no
  account. Reads the live server directory at `/.well-known/mcp.json` rather than
  trusting a hardcoded list.

## The 3D-creation skills

The platform's signature set, safe to reuse anywhere:

- **`find-3d-assets`**: search the 3,492 ready-made assets three.ws already
  publishes (511 CC0 props, 107 rigged characters, 2,874 motion clips) and get
  paste-ready code or a downloaded file. Free, and the one to try FIRST: an
  existing asset is instant where a generation is GPU minutes. Reachable three
  ways off one catalog (the `search_catalog` / `get_catalog_item` /
  `get_item_source` MCP tools, `GET /api/catalog`, or `npx @three-ws/assets`).
- **`generate-3d-model`** — text → textured GLB on the free `forge_free` lane
  (NVIDIA NIM / TRELLIS; no key, no account). Returns `glbUrl` + viewer link.
- **`create-3d-avatar`** — text/image → **rigged** avatar via `forge_avatar`
  (generate + auto-rig in one call, humanoid gate). Returns rigged `glbUrl` +
  pose-studio link.
- **`rig-a-model`** — existing GLB → animation-ready GLB via `rig_mesh` /
  `POST /api/forge?action=rig` (Make-It-Animatable). Returns `riggedGlbUrl` +
  pose-studio link.

The three generation skills run free against the hosted studio endpoint
`https://three.ws/api/mcp-studio` (JSON-RPC `tools/call`), documented with runnable
`curl` examples inside each skill.

## Standalone repos (install without cloning this one)

Cloning a 60-directory monorepo to get a skill folder is a bad first experience, so the
packs are also published as small standalone repos, each a complete Claude Code plugin
marketplace of one plugin:

| Repo | Contents | Who it is for |
| --- | --- | --- |
| `nirholas/three-ws-skills` | Every three.ws-origin skill (3D, platform, wallet/x402) | Anyone who wants the whole platform in one install |
| `nirholas/three-ws-3d-skills` | The `3d/creative` cross-platform-safe subset | 3D users who want no wallet or payment content at all |
| `nirholas/three-ws-agent-economy-skills` | `wallet/payments` + `platform/agents` | Builders monetizing agents and paying for services |

```
/plugin marketplace add nirholas/three-ws-3d-skills
/plugin install three-ws-3d@three-ws-3d
```

**They are generated, never hand-maintained.** `npm run build:skill-repos` assembles each
one into `.data/standalone-repos/<repo>/` (gitignored) straight from `.agents/skills/`,
using the same `collectSkills()` the pack manifest uses, and writes the
`.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, `skills/`, a generated
`README.md` with every trigger, the Apache-2.0 `LICENSE`, and a `.gitignore`. Because the
copies are built on demand and never committed here, they cannot drift from the canonical
folders.

`npm run check:skill-repos` validates the repo specs against the pack without writing
anything (it fails if a selector stops matching any skill, or a selected skill has no
`SKILL.md`) and is wired into `npm run gate`, alongside `npm run check:skills-pack` which
fails when `SKILLS.md` / `skills-pack.json` are stale.

Vendored partner skills are deliberately excluded from every standalone repo: they belong
to their publishers, and the `ops/production` skill is for maintainers of this repo rather
than platform users.

Publishing is owner-gated. The build prints the exact `git init` plus `gh repo create`
command per repo when it finishes; nothing is pushed automatically.

## Related

- [STRUCTURE.md](../STRUCTURE.md) — where every surface lives
- [In-app skills system](/docs/skills) - the avatar/agent skills system inside three.ws
- [MCP overview](/docs/mcp) - the three.ws MCP server the 3D skills call
- [3D Studio MCP endpoint](/docs/mcp-studio) - the free hosted endpoint the 3D skills run against
