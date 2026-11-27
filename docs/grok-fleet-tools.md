# three.ws with open-source agent-fleet tools

three.ws works with five open-source tools that run a fleet of coding agents: Orca, Happy, OpenMausBot, Suparagent and OpenHands. Each one can call the three.ws 3D studio over MCP, so an agent can find, check, make and rig 3D models. This page has the paste-ready setup for each tool, what we ran to check it, and what we could only read.

Facts checked on 2026-11-27. Star counts, licences and push dates come from `gh api repos/<owner>/<repo>` on that day.

## The one thing every tool needs

The studio is a remote MCP server (streamable HTTP):

```
https://three.ws/api/mcp-studio
```

- Plain URL: catalog search, docs search and job status work with no account and no key. Rendering views of a model (`look_at_model`) is free but needs an account, like making one.
- To make, refine or rig a model you need a free three.ws account. Two ways in:
  - OAuth: use `https://three.ws/api/mcp-studio?auth=oauth`. The server answers `401` with a sign-in challenge, so a client that supports MCP OAuth opens the three.ws sign-in.
  - API key: create one at https://three.ws/dashboard/api-keys and send it as `Authorization: Bearer <key>`. Keep it in an environment variable, never in a file in your repo.
- No tool on this server moves money.

Live check run today against the exact URL (script: a small Node client doing `initialize`, `notifications/initialized`, `tools/list`, then `tools/call search_catalog`):

```
plain URL     initialize 200  {"name":"three-ws-3d-studio-free","version":"1.0.1"}
              tools/list 200  forge_free, text_to_avatar, mesh_forge, rig_mesh, forge_avatar, refine_model, check_job, look_at_model, get_job, search_catalog, get_catalog_item, get_item_source, search_docs, ...
              search_catalog 200  "24 matches for \"chair\""
?auth=oauth   initialize 401  WWW-Authenticate: Bearer resource_metadata="https://three.ws/.well-known/oauth-protected-resource/api/mcp-studio" ... scope="avatars:read avatars:write profile offline_access"
bad API key   initialize 401  (a wrong key is refused, it does not fall back to free)
```

No three.ws API key was used in these checks, so the Bearer path is verified only as far as a wrong key being refused. The account-linked calls (make, rig) were not run.

### The skill subset to install

The repository `.agents/skills` folder holds many skills. For these tools install only the 3D ones:

- `find-3d-assets`
- `generate-3d-model`
- `create-3d-avatar`
- `rig-a-model`
- `embed-three-ws-avatar`

Do not install `connect-three-ws-mcp` for this purpose: it also documents the other three.ws servers, which are outside what this page covers.

`npx skills add` reads `SKILL.md` files by folder name. Run against a local checkout it found all five (it printed `Found 132 skills` for the whole repo):

```
HOME=<scratch> npx -y skills add /path/to/three.ws --list
```

It also skipped two skills in this repo because their YAML front matter does not parse (`.claude/skills/engineering-standards/SKILL.md` and `data/skills/protocol/erc8004-agent-identity/SKILL.md`: an unquoted colon inside `description:`). Neither is one of the five above, and installing with `--skill <name>` is unaffected.

## Orca

Orca (https://github.com/stablyai/orca): runs a fleet of coding agents (Claude Code, Grok, Codex and others) on your own subscriptions, on desktop, mobile and a remote runtime. 142,328 stars, MIT, last push 2026-11-27.

### Add the MCP server

Orca does not keep one MCP list of its own for the agents. It writes into each agent's own MCP config, and Orca has a plugin system that can contribute MCP servers. Two routes:

1. Plugin (recommended). Orca Settings, MCP servers, lists plugin servers under "From plugins". Install the three.ws plugin from `integrations/orca/three-ws/orca-plugin.json` (see below). You pick which agents and workspaces get it.
2. Paste. Settings, MCP servers accepts a link, a `claude mcp add ...` command, or an `mcpServers` JSON block. Paste:

```
claude mcp add --transport http three-ws https://three.ws/api/mcp-studio
```

### Install skills

```
npx skills add nirholas/three.ws --skill find-3d-assets --skill generate-3d-model --skill create-3d-avatar --skill rig-a-model --skill embed-three-ws-avatar --global
```

Orca's `docs/site/content/docs/cli/skills.mdx` describes this flow. Orca's plugin manifest has a `contributes.skills` field, but upstream marks it reserved and requires it empty, so skills cannot ship inside the plugin yet.

### Per-repo config

`orca.yaml` in a repo is for workspace setup hooks only (`src/shared/workspace-setup/orca-yaml-hook-types.ts`). It has no MCP or skill field, so there is nothing to add there. Agents Orca launches read their own per-repo MCP files (for example a project `.mcp.json`), which Orca lists in `src/main/mcp-servers/agent-configs/agent-mcp-config-locations.ts`.

### three.ws surface reused

The studio MCP URL, and the `.agents/skills` folder.

### Files in this repo

`integrations/orca/three-ws/orca-plugin.json`: a `declarative` plugin (`manifestVersion` 2, `engines.orca >= 1.4.276`) whose only contribution is the MCP server above. Orca's manifest rules refuse `headers` and say not to put keys in a public manifest, so the plugin carries the plain URL. Orca's own sign-in handles servers that ask for one.

### How it was checked

We ran Orca's own plugin validator (`config/scripts/plugin-authoring/content-validation/validate-plugin-files.mjs`, the same checks as `orca plugin validate`) on a scratch git copy of the manifest:

```
.../orca-plugin.json: ok
Catalog release entry for HEAD: "execution": "declarative", "minimumOrca": "1.4.276", contributes mcpServers three-ws https://three.ws/api/mcp-studio
```

The negative case fails as expected: adding `headers` gives `contributes.mcpServers[0]: unknown key "headers"`. The `commit` and `contentHash` it printed belong to the scratch commit, not this repo.

### Status

Plugin manifest: verified against upstream's parser (ran the upstream validator). Paste route and skills route: documented from upstream source and docs only (the skills route was exercised with `skills add --list`, but not through Orca). Orca itself, a GUI app, was not run.

## Happy

Happy (https://github.com/slopus/happy): an app that drives Claude, Codex and Grok from your phone or desktop with the subscriptions you already pay for. 24,863 stars, MIT, last push 2026-11-27.

Happy has two harnesses and they differ:

- The classic Happy CLI wraps Claude Code. Anything Claude Code can load, it loads, including Claude Code plugins (`packages/happy-cli/src/claude/utils/pluginsFromArgs.ts`). Add the studio with `claude mcp add` in that folder.
- Happy Agent (the multi-model harness, `happy-agent/`) has its own MCP catalog.

### Add the MCP server (Happy Agent)

Put a `mcp.toml` at the root of the folder the session works in (`happy-agent/docs/MCP.md`). `happy.toml` and other providers' files are ignored for MCP. This repo ships one:

```toml
[mcp_servers.three_ws]
url = "https://three.ws/api/mcp-studio"
enabled = true
startup_timeout_sec = 20
tool_timeout_sec = 120
```

To make or rig models with an API key, add one line to that table and export the variable before starting Happy:

```toml
bearer_token_env_var = "THREE_WS_MCP_TOKEN"
```

For the sign-in route use `url = "https://three.ws/api/mcp-studio?auth=oauth"` instead. Happy treats a `401` as `needs_auth`, then you ask the agent to "log in to three_ws" and it runs `start_mcp_auth`. This does not work on the plain URL, because the plain URL answers `200` and never asks for a login.

### Install skills

Happy Agent discovers `.agents/skills` in the working folder (`happy-agent/docs/extending.md`), which this repo already has. Outside this repo, copy the five skill folders listed above into `<your project>/.agents/skills/`.

### Per-repo config

Yes: root `mcp.toml` as above. A folder's `mcp.toml` is read when the first session in that folder starts.

### three.ws surface reused

The studio MCP URL and `.agents/skills`.

### How it was checked

Happy Agent's config schema is in `packages/happy-agent-modules/sources/config/ConfigModule.ts` (`mcpInputSchema`, `additionalProperties: false`). We parsed `mcp.toml` with Python `tomllib` and compared every key against the keys that schema allows:

```
three_ws ['enabled', 'startup_timeout_sec', 'tool_timeout_sec', 'url'] unknown= set() exactlyOneOfCommandUrl= True
```

The timeouts are under the schema maximum of 600 seconds. Happy itself was not run (it needs its workspace install and a signed-in account), so no live session was started.

### Status

`mcp.toml`: verified against upstream's schema (key-for-key check of the source, not by running Happy). OAuth and API-key variants: documented from upstream docs only.

## OpenMausBot

OpenMausBot (https://github.com/milind-soni/OpenMausBot): an open-source Grok Bot alternative with a virtual machine that bots can use. 28,516 stars, Apache-2.0, last push 2026-11-27.

### Add the MCP server

Plugins, MCP servers, Add server. Paste into the one box (`docs/custom-mcp-servers.md`):

```
claude mcp add --transport http three-ws https://three.ws/api/mcp-studio
```

With an API key (OpenMausBot asks you for the value, it never saves a `$VARIABLE` as written):

```
claude mcp add --transport http three-ws https://three.ws/api/mcp-studio --header "Authorization: Bearer $THREE_WS_MCP_TOKEN"
```

An `mcpServers` JSON block works too:

```json
{"mcpServers":{"three-ws":{"type":"http","url":"https://three.ws/api/mcp-studio"}}}
```

### Install skills

Project skills are read from `agents/skills`, `.agents/skills` and `.claude/skills` in the project. Copy the five skill folders into `.agents/skills/`.

### Per-repo config

A project `.mcp.json` is read. This repo's root `.mcp.json` already exists and is empty, so it was left alone.

### three.ws surface reused

The studio MCP URL and `.agents/skills`.

### How it was checked

OpenMausBot's paste parser (`src/lib/mcp-paste.ts`) is self-contained, so we bundled it with esbuild and ran each paste above through `readMcpPaste`:

```
https://three.ws/api/mcp-studio                      -> ok, remote, type http, name "three"
claude mcp add --transport http three-ws <url>       -> ok, remote, type http, name "three-ws", headers []
{"mcpServers":{"three-ws":{...}}}                    -> ok, remote, type http, name "three-ws"
... --header "Authorization: Bearer $THREE_WS_MCP_TOKEN"
  -> ok, header Authorization with gap {kind: variable, names: [THREE_WS_MCP_TOKEN], before: "Bearer "}
```

So the app asks for the token value instead of saving the variable name. The one-click card path is separate: `src/lib/hosted-mcp-apps.ts` is a table of official hosted apps (a card appears by adding a row there). See "Prepared submissions" below.

### Status

Paste route: verified against upstream's parser (ran it). Skills folders and `.mcp.json` reading: documented from upstream docs only. The app was not run.

## Suparagent

Suparagent (https://github.com/Anil-matcha/suparagent): open-source, self-hosted AI coworkers (named agents) with memory, routines, an isolated computer and your approval before they act. 7,183 stars, Apache-2.0, last push 2026-11-27.

### Add the MCP server

Two routes:

1. Custom MCP server in the app (`docs/CONNECTED_APPS.md`): enter `https://three.ws/api/mcp-studio`. For making and rigging, enter your three.ws API key as the bearer token. Suparagent's catalog supports no-auth and user-entered bearer tokens only, not OAuth.
2. Community marketplace listing, once merged (see "Prepared submissions"). Connecting an entry does not grant it: the owner picks exact tools per agent and approves every call.

### Install skills

Suparagent skills are text-only per agent (`docs/SKILLS.md`). Paste the body of `find-3d-assets` and `generate-3d-model` as agent skills. There is no folder-based skill install.

### Per-repo config

None. Suparagent agents have their own isolated computer, and there is no repository config file to add.

### three.ws surface reused

The studio MCP URL.

### How it was checked

We copied the Suparagent repo to a scratch directory, added the listing at `marketplace/plugins/community/three-ws.json`, and ran the repo's own scripts:

```
$ python3 scripts/update-marketplace-index.py
Updated marketplace/catalog.json (5 community, 0 tested)
$ python3 scripts/validate-marketplace.py --changed marketplace/plugins/community/three-ws.json
Marketplace schema, fixtures, catalog, and changed listings are valid.
```

The privacy, terms and docs URLs in the listing each return `200` (https://three.ws/privacy, https://three.ws/terms, https://three.ws/docs).

### Status

Listing: verified against upstream's validator and index script (ran both on a scratch copy). Custom-server route: documented from upstream docs only. The app was not run.

## OpenHands

OpenHands (https://github.com/OpenHands/OpenHands): AI-driven development agents with an app (Agent Canvas), an SDK and a public extensions repo. 94,459 stars, MIT, last push 2026-11-27.

### Add the MCP server

In the app: MCP page, Add custom server, type SHTTP (the app also offers SSE and stdio), URL `https://three.ws/api/mcp-studio`. For an API key use the API key or token option and enter it there. The same page can install from the integrations catalog, and an OAuth-capable server shows an OAuth sign-in option (`src/components/features/mcp-page/custom-server-editor.tsx`, translation keys `SETTINGS$MCP_SERVER_TYPE_SHTTP` and `MCP$OPTION_OAUTH`).

### Install skills

The SDK loads project skills from `<repo>/.agents/skills/`, then `.openhands/skills/` and the legacy `.openhands/microagents/`. It also reads `AGENTS.md`, `CLAUDE.md` and `.cursorrules` as skills (`openhands-sdk/openhands/sdk/skills/skill.py`, `load_project_skills` and `PATH_TO_THIRD_PARTY_SKILL_NAME`). This repo already has `.agents/skills` and `AGENTS.md`, so no new file is needed. In another project, copy the five skill folders into `.agents/skills/`. A skill folder can also carry its own `.mcp.json`, which the SDK reads for that skill.

### Per-repo config

Skills yes (above). There is no per-repo MCP server file for the app: servers are added in the app. `.openhands/setup.sh` runs setup commands, not MCP. Nothing was added in `.openhands/`.

### three.ws surface reused

The studio MCP URL, `.agents/skills`, and the catalog listing already prepared in `marketing/growth/submissions/agent-registries/openhands.md`.

### How it was checked

Read the SDK loader and the extensions-repo catalog schema and an existing no-auth entry (`integrations/catalog/deepwiki.json`). The existing submission doc records that the three.ws entry passed upstream's catalog tests (117 passed). I did not re-run them: they need upstream's Python environment, and the entry is unchanged.

### Status

Skills and app flow: documented from upstream source and docs only. Catalog entry: verified against upstream's tests per the existing submission doc (draft PR https://github.com/OpenHands/extensions/pull/902, still open as a draft when last checked).

## Prepared submissions (owner step)

Nothing below has been submitted. No issue or pull request was opened.

### Suparagent community listing

Upstream file: `marketplace/plugins/community/three-ws.json`, plus the regenerated `marketplace/catalog.json` (run `python3 scripts/update-marketplace-index.py` in the Suparagent repo and commit both). Entry, exactly as validated:

```json
{
  "slug": "three-ws",
  "name": "three.ws 3D Studio",
  "version": "1.0.1",
  "summary": "Hosted three.ws 3D studio MCP. Search a catalog of ready-made 3D models, characters and animations, and read the docs with no account. Making, refining, rigging or rendering a 3D model needs a free three.ws account and is not available through this listing. Grant only the individual tools you want.",
  "publisher": "three.ws",
  "source_repo": "https://github.com/nirholas/three.ws",
  "endpoint": "https://three.ws/api/mcp-studio",
  "auth_mode": "none",
  "privacy_url": "https://three.ws/privacy",
  "terms_url": "https://three.ws/terms",
  "license": "Apache-2.0",
  "setup_instructions": "Connect this listing. No account or key is needed for the catalog and docs tools. Grant search_catalog, get_catalog_item and search_docs to an agent that needs 3D assets. To make or rig models, use the Suparagent custom MCP server form with the same URL and a three.ws API key as a bearer token (free account, create a key at https://three.ws/dashboard/api-keys). Documentation: https://three.ws/docs",
  "test_instructions": "Grant search_catalog to an agent and call it once with the query \"chair\" and a limit of 1. A successful call returns a match count and a catalog item with a title and a model link. Remove the grant if the agent does not need the tool."
}
```

The version string matches what the live server reports in `initialize` today. This exact text (not an earlier draft) is what passed the validator.

### Orca plugin catalog

Upstream file: Orca's community plugin catalog, per `docs/reference/plugin-catalog.md` and `docs/reference/plugin-listing-policy.md`. The plugin source is `integrations/orca/three-ws/orca-plugin.json` in https://github.com/nirholas/three.ws, so the catalog entry must name `source.path` as `integrations/orca/three-ws`. After the manifest is committed and pushed, run in a checkout:

```
orca plugin validate integrations/orca/three-ws
```

It prints the catalog release entry (`version`, `commit`, `contentHash`) for the committed HEAD. Use that output, not the values from the scratch run.

### OpenMausBot hosted card (optional)

Upstream files: a row in `src/lib/hosted-mcp-apps.ts` (`HOSTED_MCP_APPS`: `id`, `label`, `url`, `description`, `notice`, `keywords`, and `key.url` of `https://three.ws/dashboard/api-keys` only if shipping the API-key flavour) plus the matching `LocaleKey` strings in `src/locales`. Contributing rules are in `CONTRIBUTING.md`. A card is only worth proposing after people use the paste route, so we did not draft the locale strings.

### OpenHands integration catalog

Already prepared, see `marketing/growth/submissions/agent-registries/openhands.md` (PR #902, draft, waiting on the owner's `HUMAN:` note).

## Existing three.ws surfaces to know about

- `marketplace/plugins/three-ws-3d` (the Claude Code marketplace plugin) is not the right thing to hand to third-party tools. Its `mcp.json` also launches a second, payment-capable server and several of its skills describe paid lanes. Use the Grok Build plugin (`integrations/grok/three-ws`), the studio URL and the five skills above instead.
- The top-level description in `.claude-plugin/marketplace.json` covers payments and trading as well as 3D, so it is not suitable as the description a third party sees.
- Two skill files fail YAML parsing in `npx skills` (named above).
