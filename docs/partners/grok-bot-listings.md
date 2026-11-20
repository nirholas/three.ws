# Grok Bot connector listings

Re-derived 2026-11-14 (first pass 2026-10-23, xAI marketplace and awesome-grok-bot added
2026-11-04). Nothing here has been submitted. Every submission publishes to an external
site, so each one waits for the owner's yes (CLAUDE.md gate 2). Owner order:
`prompts/finish/929-x-grok-48-connector-directory-listings.md`.

## How Grok Bot users find connectors (2026-11-14)

- **xAI opened an official listing form (seen 2026-11-20).** [x.ai/bot/marketplace/submit-a-plugin](https://x.ai/bot/marketplace/submit-a-plugin)
  takes an MCP server URL or a public GitHub repo and lists it in Grok (coming soon), Grok Bot
  and Cursor. It is row 0 below. The points that follow describe discovery before that form.
- **Grok Bot has no connector list of its own.** Per [docs.x.ai](https://docs.x.ai/grok-bot/teams-and-enterprises),
  "Grok Bot inherits your team's Cursor connector policy. There is no separate Grok Bot connector
  list." Members find allowed connectors under **Connect apps**, and team admins enable them from
  the Cursor Team Marketplace. That makes the **Cursor Marketplace** the closest thing to an
  official Grok Bot connector catalog. Third-party reporting says it opened to third-party
  submissions on 2026-10-15.
- **Custom MCP servers** are added by telling the Bot in chat ("Add this MCP server: <url>"). The
  URL must be public HTTPS, Streamable HTTP or SSE. Plain Grok on grok.com adds one at
  grok.com/connectors (New Connector, Custom).
- **Grok Bot loads `.grok-plugin` packages**, the same format as xAI's Grok Build plugin
  marketplace, so that marketplace and the GitHub lists that index `.grok-plugin` repos are
  discovery surfaces too.
- **Third-party directories** fill the gap: grokbot.tools (tested connector directory), the
  awesome-grok-bot lists on GitHub, and the general remote-MCP lists.

## The text we submit

| Field | Value |
|---|---|
| Name | three.ws |
| One line | Free 3D studio for Grok: turn text or a photo into a textured 3D model or a rigged avatar, auto-rig a GLB, search thousands of CC0 3D assets, get viewer links back. Free account (OAuth sign-in) to generate; catalog search needs none. Never spends. |
| Connector URL (Grok Bot, Grok) | `https://three.ws/api/mcp-grok` |
| Connector URL (any MCP client) | `https://three.ws/api/mcp-studio` |
| Transport | Streamable HTTP |
| Auth | OAuth 2.1 at `https://three.ws/api/mcp-grok?auth=oauth` (free account, dynamic client registration). The plain URL answers anonymous callers, who can search the catalog but must sign in to generate. |
| Docs | https://three.ws/docs/grok-bot |
| Website | https://three.ws/grok |
| Logo, square | `public/three-ws-mcp-icon.svg` (64x64 SVG, 1.4 KB, served at https://three.ws/three-ws-mcp-icon.svg) |
| Logo, wide | `public/logo.png` (180x90 PNG, 11.6 KB, https://three.ws/logo.png) |
| Cursor plugin | `integrations/cursor/three-ws` (points at `/api/mcp-studio`, four 3D skills) |
| Grok plugin | `integrations/grok/three-ws` (points at `/api/mcp-grok`, six 3D skills, a tour command) |
| Maintainer | three.ws, https://three.ws |

Verified live 2026-11-14: `initialize` on both `/api/mcp-grok` and `/api/mcp-studio` returns
HTTP 200 with server `three-ws-3d-studio-free` 1.0.1; `/docs/grok-bot`, `/grok`, `/logo.png` and
`/three-ws-mcp-icon.svg` return 200. Both plugin folders are public on
`github.com/nirholas/three.ws` main and identical to local HEAD. No brand asset had to be
generated: every form below accepts the existing SVG or PNG.

## Directories

Ordered by value to a Grok Bot user. "Listed" was checked on 2026-11-14 by searching each list or
catalog for `three.ws`, `threews`, `three-ws` and `nirholas`.

| # | Directory | Method | Requirements | Cost | Listed | Recommendation |
|---|---|---|---|---|---|---|
| 0 | [Grok Bot marketplace (official)](https://x.ai/bot/marketplace/submit-a-plugin) | xAI web form taking an MCP server URL or a public GitHub repo; one form lists in Grok (coming soon), Grok Bot and Cursor | 1:1 logo with a background plate, organization handle, description and testing instructions up to 600 characters each, an in-app test, Cursor Marketplace Publisher Terms | Free | No | Submit first. xAI's own listing form, added 2026-11-20 (order 873). Prepared in section 0. |
| 1 | [Cursor Marketplace](https://cursor.com/marketplace/publish) | Web form (signed-in Cursor account) taking a public Git repo link | Root `.cursor-plugin/plugin.json`, kebab-case unique name, README, committed logo, open source, manual security and quality review (also on every update) | Free | No | Submit. This is the catalog Grok Bot's Connect apps inherits. |
| 2 | [cursor.directory](https://cursor.directory/plugins/new) | Web form taking a GitHub link; auto-detects MCP servers and skills | Public repo with the plugin at its root | Free | No | Submit, same repo as row 1. Cursor staff route most third-party plugins here first. |
| 3 | [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace) | Pull request | One entry in `.grok-plugin/marketplace.json` with a pinned 40-char SHA, regenerated `plugin-index.json`, both repo checks green; personal-account sources are questioned | Free | No (36 plugins, one in `media`, no 3D plugin) | Submit. xAI's own catalog, 329 stars, pin bumps daily. |
| 4 | [grokbot.tools/connectors](https://grokbot.tools/submit) | Web form | Public HTTPS MCP URL; they probe it and test it in Grok Bot before publishing | Free (optional paid "featuring", not requested) | No (55 connectors) | Submit. The only directory that tests in Grok Bot itself. |
| 5 | [punkpeye/awesome-remote-mcp-servers](https://github.com/punkpeye/awesome-remote-mcp-servers) | Pull request | Public URL that answers `initialize` (CI checks), usable by anyone, Streamable HTTP or SSE, a Glama connector badge, alphabetical, description up to 120 chars | Free | No | Submit. 3,161 stars. Our Glama connector already exists. |
| 6 | [jaw9c/awesome-remote-mcp-servers](https://github.com/jaw9c/awesome-remote-mcp-servers) | Pull request | One table row; official, production-ready, OAuth preferred | Free | No | Submit. 1,186 stars, merged 2026-11-09. |
| 7 | [majiayu000/awesome-grok-bot](https://github.com/majiayu000/awesome-grok-bot) | Pull request | One line under Skills and tools; no tools that move crypto or trade | Free | No | Submit. 168 stars, merged 2026-11-13. |
| 8 | [mcpservers.org](https://mcpservers.org/submit) | Web form | Name, category, short description, repo/website/docs link, optional MCP Registry name, remote checkbox, contact email | Free (2-week review) or $39 premium | No | Submit the free plan. Premium is a spend: not requested. |
| 9 | [ZeroPointRepo/awesome-grok-bot](https://github.com/ZeroPointRepo/awesome-grok-bot) | Pull request | One alphabetical line, under about 120 chars, a tag | Free | No | Submit, low priority: no commit since 2026-10-04 and 28 open PRs. |
| 10 | [Glama connectors](https://glama.ai/mcp/connectors/io.github.nirholas/threews-grok) | Automatic from the official MCP Registry | none | Free | **Yes**, 8 connectors under `io.github.nirholas` including `threews-grok` and `threews-3d-studio-free` | Nothing to do. Its badge powers row 5. |
| 11 | [Spidermanrobin/awesome-grokbots](https://github.com/Spidermanrobin/awesome-grokbots) | Pull request (YAML plus generated files, EN/zh-CN/JA reviews) | Schema, link check, `scripts/build.py` | Free | No | Skip: 0 stars, so the trilingual entry costs more than its reach. |
| 12 | [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Pull request | A public repo you install and run locally; hosted-only servers belong in row 5 | Free | No | Skip: Grok Bot connects remote servers, and the maintainers route hosted servers to row 5. |
| 13 | [workinsiders.com](https://workinsiders.com/grok-bot-plugins-skills-mcp-servers/) and [grok-bots.com](https://grok-bots.com/grok-bot-connectors) | No Grok-list submission route (workinsiders rebuilds its page from the community GitHub list; grok-bots.com has no form) | n/a | n/a | No | Nothing to submit. Rows 7 and 9 feed workinsiders. |

## Prepared submissions (none opened)

### 0. Grok Bot marketplace (official)

Form: https://x.ai/bot/marketplace/submit-a-plugin, fetched 2026-11-20. Its intro reads "Distribute
your plugin or MCP server to Grok (coming soon), Grok Bot, and Cursor users." Every field below is
in form order, with the form's limit and where the value comes from. The two 600-character
fields were counted by script (566 and 577 characters) and contain no em-dash.

| Field (limit) | Value | Source |
|---|---|---|
| First Name, Last Name (40 each) | The owner's name | The owner submits; the form is a person's attestation |
| Work Email (254) | The owner's work address | Owner. Never `support@three.ws`: xAI replies to the submitter |
| Organization Name (100) | `three.ws` | Brand name used on every listing above |
| Organization Handle (40, "no spaces or capitalization") | `three-ws` | Matches the plugin name in `integrations/grok/three-ws` and `integrations/cursor/three-ws`. It must equal the handle of the organization the owner creates; if xAI assigns or rejects it, use theirs and record it in the log |
| Website URL (200, optional) | `https://three.ws/grok` | The Grok landing page (`pages/grok.html`) with the connector card and task templates |
| Logotype URL (200, "1:1 SVG or PNG with a background plate") | `https://three.ws/brand/three-ws-app-icon-1024.png` | `public/brand/three-ws-app-icon-1024.png`, 1024x1024 opaque PNG rendered from `public/three-ws-mcp-icon.svg` (512 variant beside it). Live after the next deploy; until then `https://raw.githubusercontent.com/nirholas/three.ws/main/public/brand/three-ws-app-icon-1024.png` serves the same file |
| Where do you want to be listed? | Grok (coming soon), Grok Bot, Cursor: tick all three | The server speaks Streamable HTTP with OAuth 2.1, which all three clients connect |
| MCP Server URL or Public GitHub Repository (200) | `https://three.ws/api/mcp-grok?auth=oauth` | `docs/grok-bot.md` OAuth section; `node scripts/grok-connector-review-check.mjs` passes all ten steps against it |
| Brief Description (600) | Block A below | `docs/mcp-studio.md` tool list |
| Testing Instructions (600) | Block B below | Measured 2026-11-20, `docs/grok-bot.md#marketplace-review` |
| "I've tested this plugin locally and in-app" | Tick only after the owner's own Grok Bot run | The owner adds the connector in Grok Bot and runs the three prompts in Block B |
| Publisher Terms | https://cursor.com/marketplace-publisher-terms | Linked from the form; the owner reads and accepts |

**Why the hosted URL and not a repo.** A reviewer can test a hosted OAuth server from Grok Bot
with nothing to install: add the URL, create a free account, ask. A repo only becomes the better
answer once orders 871 and 872 export a standalone plugin repository (a `.grok-plugin` or
`.cursor-plugin` at its root); at that point the same form can take the repo for the Cursor
listing, and the hosted URL stays the Grok Bot answer. The `?auth=oauth` form matters: the plain
URL serves anonymous callers and never starts sign-in, so a reviewer would see generation tools
answer "sign in required" with no way to sign in from Grok Bot.

**Block A: Brief Description** (566 characters)

```text
three.ws is a 3D studio for Grok Bot. Ask in plain words and it turns text or a photo into a textured 3D model (GLB), builds rigged, animation-ready avatars, auto-rigs a GLB you already have, refines a model by instruction, and searches thousands of ready-made CC0 props, characters and motion clips. Every result comes back with a browser viewer link, a downloadable GLB, a poster image and embed code. Free with a free three.ws account (OAuth sign-in); catalog search needs no account. Long generations return a job Grok Bot checks, so scheduled tasks never stall.
```

**Block B: Testing Instructions** (577 characters)

```text
Add a custom connector: Remote HTTPS, https://three.ws/api/mcp-grok?auth=oauth, no headers, Client ID empty. At sign-in pick "Create one": any username, a 10+ character password, no email or card, usable at once. Approve. Then ask: 1) "Find a ready-made armchair on three.ws" (about 1 s, viewer link). 2) "Make a 3D model of a wooden treasure chest" (a job, about 3 to 4 min; Grok Bot checks it until the GLB link arrives). 3) "Show me the chest from the front and side" (about 15 s, two images). Full steps: three.ws/docs/grok-bot#marketplace-review. Support: support@three.ws
```

**Measured 2026-11-20** with `node scripts/grok-connector-review-check.mjs` against production (ALL PASS):
401 challenge 239 ms, protected-resource metadata 24 ms, authorization-server metadata 16 ms,
dynamic client registration 272 ms, PKCE authorize to the sign-in form 353 ms, forged code refused
(`invalid_grant`) 168 ms, initialize 279 ms, tools/list 109 ms (45 tools, none that spend),
`search_catalog` 584 ms, `forge_free` 194.8 s over 9 `check_job` polls. **Sign-in to first
generated model: 195.8 s.** `look_at_model` on that model: 14.9 s for two views.

**Before submitting.** Production must carry commit 4654a704e (sign-in carries a pending OAuth
consent through to sign-up, so a reviewer who creates an account lands back on the consent screen)
and the brand PNGs. `/api/version` on 2026-11-20 reported 35440977b, which has neither: deploy
first, then rerun `node scripts/grok-connector-review-check.mjs`.

**Templates.** xAI has no separate template submission form. A Grok Bot template is shared from the
Bot itself (Bot details, Share, Create a copy, Publish on the template card, Copy link), and
published Bots appear at `x.ai/bot/marketplace`. The four templates in
[docs/grok-bot.md#task-templates](../grok-bot.md#task-templates) are written so the owner can
create one Bot per template from that page, publish each, and paste the links into the
submission log.

### 1 and 2. Cursor Marketplace and cursor.directory

Both read a whole repository from its root, so the plugin goes out as the standalone mirror
`nirholas/three-ws-cursor-plugin` that [integrations/README.md](../../integrations/README.md)
already names. **That repository does not exist on GitHub yet** (404 on 2026-11-14), so creating
it is the first step and is itself a publish.

The export was dry-run on 2026-11-14 from `threews/main`: the tree holds
`.cursor-plugin/plugin.json`, `mcp.json`, `README.md`, `LICENSE`, `assets/logo.svg` and four
skills; the logo path resolves; `mcp.json` declares no `${VAR}`; no file names another coin.

Re-run on 2026-11-20 with `scripts/export-plugin-repo.mjs` (plugin 1.3.0): it validates the
plugin against Cursor's reference first, then writes one commit holding 20 files, adding
`REVIEWING.md`, the three commands, both rules, two listing screenshots and a `CHANGELOG.md` built
from git history. Two exports of the same source commit are byte-identical. Point Cursor's reviewers at
[REVIEWING.md](../../integrations/cursor/three-ws/REVIEWING.md), the five-minute test plan with
measured timings and the data-handling notes.

```bash
OUT=$(mktemp -d)
npm run grok:cursor-plugin-export -- --out "$OUT"
gh repo create nirholas/three-ws-cursor-plugin --public \
  --description "three.ws 3D Studio for Cursor and Grok Bot: free text or photo to 3D models and rigged avatars over MCP" \
  --homepage https://three.ws/docs --source "$OUT" --push
```

Then:

| Form | Value |
|---|---|
| cursor.com/marketplace/publish, repository | `https://github.com/nirholas/three-ws-cursor-plugin` |
| cursor.directory/plugins/new, GitHub link | `https://github.com/nirholas/three-ws-cursor-plugin` |

Questions from Cursor's marketplace team go to marketplace-publishing@cursor.com (per their
forum). The form is tied to the signed-in Cursor account, not a company.

### 3. xai-org/plugin-marketplace

The entry points at a standalone export of [integrations/grok/three-ws](../../integrations/grok/three-ws/README.md),
not at the monorepo: CONTRIBUTING.md questions personal-account sources for branded plugins, so the
proposed source is a `three-ws` GitHub organization repo, `three-ws/three-ws-grok`. Both names
were free on 2026-11-20 (`gh api orgs/three-ws` and `gh api repos/three-ws/three-ws-grok` answer
404). Creating them is the first owner step.

`scripts/export-plugin-repo.mjs` writes the plugin at the repository root with `LICENSE`, the
README (links outside the folder rewritten to github.com/nirholas/three.ws), a `CHANGELOG.md` built
from the folder's git history, runs `grok plugin validate`, and makes one commit authored by
three.ws and dated by the last source commit, so two exports of the same source commit have the same
SHA. Exported on 2026-11-20 from main at plugin 1.2.0, twice:
`179da58ef0ed3eceae141b77292e683a2224b3da` both times.

On a fresh clone of the marketplace (at `65eef14`) with this entry appended and git's `insteadOf`
pointing the proposed URL at the local export (the scripts themselves unmodified):

```text
$ python3 scripts/validate-catalog.py
Catalog OK (.grok-plugin/marketplace.json)
$ python3 scripts/generate-plugin-index.py
Wrote .grok-plugin/plugin-index.json
$ python3 scripts/generate-plugin-index.py --check
Plugin index OK (.grok-plugin/plugin-index.json)
 .grok-plugin/marketplace.json  | 13 +++++++++
 .grok-plugin/plugin-index.json | 66 ++++++++++++++++++++++++++++++++++++++++++
```

The generated `three-ws` record: version 1.2.0, agent `3d-art-director`, commands `embed`,
`make-3d`, `rig`, `three-ws-init`, `three-ws-tour`, MCP server `three-ws` (http), skills
`anatomy`, `create-3d-avatar`, `embed-three-ws-avatar`, `find-3d-assets`, `generate-3d-model`,
`rig-a-model`. Grok Build 1.0.45 built from source then added that marketplace and ran
`grok plugin install three-ws --trust` in 0.84 s, recording commit `179da58e…` from
`https://github.com/three-ws/three-ws-grok.git`; `grok inspect` lists the five commands, the six
skills, `three-ws:3d-art-director` and the `three-ws` server with source `plugin: three-ws`.

Append to the `plugins` array in `.grok-plugin/marketplace.json`, matching the file's existing
two-space style:

```json
{
  "name": "three-ws",
  "description": "Turn a sentence or a photo into a textured 3D model (GLB) or a rigged, animation-ready avatar, auto-rig a GLB, search thousands of CC0 props, characters and motion clips, render a model to check it, and embed it on a site. Catalog search is free with no account; making or rigging a model needs a free three.ws account.",
  "category": "media",
  "source": {
    "source": "url",
    "url": "https://github.com/three-ws/three-ws-grok.git",
    "sha": "179da58ef0ed3eceae141b77292e683a2224b3da"
  },
  "homepage": "https://three.ws/grok",
  "keywords": ["three.ws", "three-ws", "threews", "three.ws 3d", "three.ws avatar"],
  "domains": ["three.ws"]
}
```

Publish and pin (owner steps, in order):

```bash
OUT=$(mktemp -d)/three-ws-grok
node scripts/export-plugin-repo.mjs --src integrations/grok/three-ws --out "$OUT" --grok-bin "$(command -v grok)"
git -C "$OUT" rev-parse HEAD     # 179da58ef0ed3eceae141b77292e683a2224b3da while the folder is unchanged
gh repo create three-ws/three-ws-grok --public \
  --description "three.ws for Grok Build: text or photo to 3D models and rigged avatars, CC0 asset search, embed code" \
  --homepage https://three.ws/grok --source "$OUT" --push
git ls-remote https://github.com/three-ws/three-ws-grok.git HEAD   # must print the same SHA
```

If `integrations/grok/three-ws` changed since 2026-11-20 the export prints a new SHA: put that SHA
in the entry. Then fork the marketplace, append the entry, run
`python3 scripts/generate-plugin-index.py`, `python3 scripts/validate-catalog.py` and
`python3 scripts/generate-plugin-index.py --check`, commit both files and open the PR. A later
plugin change reaches Grok Build users only after a new export is pushed and the pin is bumped in a
follow-up PR.

PR title: `Add three.ws (text or photo to 3D models and rigged avatars, CC0 asset search)`

```markdown
## What this PR does

- Plugin name: three-ws
- Type: remote source
- Source URL + pinned SHA: https://github.com/three-ws/three-ws-grok.git @ 179da58ef0ed3eceae141b77292e683a2224b3da
- Homepage: https://three.ws/grok

Adds a 3D studio to Grok Build: text or a photo to a textured GLB or a rigged avatar,
auto-rigging, a searchable CC0 catalog of props, characters and motion clips, render checks so
Grok can see what it made, and embed code. One hosted MCP server, five commands (`/make-3d`,
`/rig`, `/embed`, `/three-ws-init`, `/three-ws-tour`), one agent (`three-ws:3d-art-director`,
limited to the three-ws server and to two iterations) and six skills. There is no 3D plugin in
the catalog today.

## Ownership

- [x] I own this plugin or have the right to distribute it.
- [x] The `source` repo is published under our official org (or I've explained why not below).

## Checklist

- [x] Added exactly one entry in `.grok-plugin/marketplace.json` (valid JSON, kebab-case `name`).
- [x] Remote source pins a full 40-char lowercase commit `sha`, and that commit is public + reachable.
- [x] Regenerated `.grok-plugin/plugin-index.json`.
- [x] `python3 scripts/validate-catalog.py` passes locally.
- [x] `python3 scripts/generate-plugin-index.py --check` passes locally.
- [x] `homepage` + clear `description` set; the plugin folder has `README.md` + `.grok-plugin/plugin.json`.
- [x] License is stated (Apache-2.0).

## Security

- [x] No `curl | bash`, remote-code download/exec, or `postinstall` RCE.
- [x] No reading/exfiltration of secrets, tokens, `.env`, or env vars.
- [x] Hooks and MCP scope are least-privilege: no hooks at all, one HTTP MCP server.
- Network endpoints: `https://three.ws/api/mcp-studio?auth=oauth` (the MCP server), the OAuth 2.1
  endpoints it advertises (`/oauth/authorize`, `/api/oauth/token`, `/api/oauth/register` on
  three.ws), and the `https://three.ws` links its tools return (GLB downloads, viewer, pose
  studio). Nothing else.
- Credentials: catalog search, docs and render checks need none. Making or rigging a model needs a
  free three.ws account: Grok Build runs the OAuth sign-in from `/mcps` and keeps the token, or the
  user adds their own API key with `grok mcp add` (documented in the README). The plugin configures
  no headers and reads no environment variables or files. No tool on the server moves money.

## Notes for reviewers

The plugin is developed in github.com/nirholas/three.ws (the canonical three.ws source, linked from
three.ws itself) under integrations/grok/three-ws and exported to this repository with one
deterministic commit per release; CHANGELOG.md links every change back to its source commit.
three.ws is a member of xAI's Grok for Startups program.
```

`tests/grok-plugin.test.js` pins the plugin layout and keeps the skills byte-identical to
`.agents/skills`, `tests/grok-build-plugin-copy.test.js` fails on any account claim that is not
true, and `tests/grok-build-plugin-tools.test.js` lists the live server's tools and fails on any
spend-capable one.

### 4. grokbot.tools

| Form field | Value |
|---|---|
| Name | three.ws |
| MCP URL | `https://three.ws/api/mcp-grok` |
| Docs URL | `https://three.ws/docs/grok-bot` |
| Category | Design |
| Logo | upload `public/three-ws-mcp-icon.svg` (SVG, 1.4 KB, under their 512 KB cap) |
| Contact email | the owner's listings address (entered by the owner at submit time) |
| Featuring checkbox | unchecked |

### 5. punkpeye/awesome-remote-mcp-servers

In `README.md`, section "Art & Design", insert after the three `Tesla Wrap Design` lines and before
`UXKIN` (case-insensitive alphabetical). The lock marker is the list's required "no
authentication" marker, kept verbatim because their CI parses it:

```markdown
- [three.ws](https://three.ws/grok) `https://three.ws/api/mcp-grok`
  [![three.ws MCP connector](https://glama.ai/mcp/connectors/io.github.nirholas/threews-grok/badges/score.svg)](https://glama.ai/mcp/connectors/io.github.nirholas/threews-grok)
  🔓 - Text or photo to textured 3D models and rigged avatars, auto-rigging, and CC0 3D asset search. No account needed.
```

The description is 113 characters. The badge URL returns `image/svg+xml` 200 and the endpoint
answers `initialize` with 200, which is what their CI checks. PR title:
`Add three.ws (Art & Design) 🤖🤖🤖` (the suffix opts an agent-prepared PR into their fast track).

### 6. jaw9c/awesome-remote-mcp-servers

In `README.md`, insert between the `ThoughtSpot` and `tl;dv` rows:

```markdown
| three.ws | Design | `https://three.ws/api/mcp-grok` | Open & OAuth2.1 | [three.ws](https://three.ws) |
```

PR title: `Add three.ws remote MCP server (Design)`. Body:

```markdown
Adds three.ws, a hosted 3D studio over Streamable HTTP: text or a photo to a textured GLB or a
rigged avatar, auto-rigging, CC0 3D asset search and render checks.

- Endpoint: https://three.ws/api/mcp-grok (anonymous); OAuth 2.1 at https://three.ws/api/mcp-grok?auth=oauth
- Official: maintained by three.ws, source at https://github.com/nirholas/three.ws
- Docs: https://three.ws/docs/grok-bot and https://three.ws/docs/mcp
- Also in the official MCP Registry as io.github.nirholas/threews-grok
- Example: "Find a ready-made chair in the three.ws catalog and give me its viewer link."
```

### 7. majiayu000/awesome-grok-bot

In `README.md`, section "Skill packs and playbooks", append after the `deed-page-skill` line (the
section is not alphabetical; new entries go at the end of the first block):

```markdown
- [three.ws](https://github.com/nirholas/three.ws/tree/main/integrations/grok/three-ws) - Official three.ws `.grok-plugin` and remote MCP so a Bot can turn text or a photo into a 3D model or rigged avatar, no account needed.
```

No catalog file changes, so their `node scripts/lint.mjs` is not triggered. PR title: `Add three.ws`.

### 8. mcpservers.org

| Form field | Value |
|---|---|
| Server Name | three.ws |
| Category | Design |
| Short Description | Free 3D studio for Grok: turn text or a photo into a textured 3D model or a rigged avatar, auto-rig a GLB, search thousands of CC0 3D assets, get viewer links back. Free account (OAuth sign-in) to generate; catalog search needs none. Never spends. |
| Repository, Website or Documentation | https://three.ws/docs/grok-bot |
| Official MCP Registry Name | io.github.nirholas/threews-grok |
| Supports remote connections | checked |
| Contact Email | the owner's listings address |
| Submission plan | Free |

### 9. ZeroPointRepo/awesome-grok-bot

Section "Grok Bot plugins and MCP servers", sorted by name: after `tesla-fleet-mcp`, before
`yourai-context-plugin`. Their format separates name and description with an em dash, which this
repo's writing rules keep out of our files, so the line below uses a hyphen: replace it with the
list's em dash when pasting.

```markdown
- [three.ws](https://github.com/nirholas/three.ws/tree/main/integrations/grok/three-ws) by [nirholas](https://github.com/nirholas) - remote MCP for Grok Bot: text or photo to 3D models and rigged avatars, auto-rigging, CC0 asset search, no account. **[production]**
```

The description is 115 characters. PR title: `Add three.ws to Grok Bot plugins and MCP servers`. Body: connector
URL `https://three.ws/api/mcp-grok`, the ask "Ask Grok Bot: find a ready-made chair in the three.ws
catalog and give me its viewer link", and https://three.ws/docs/grok-bot.

## Owner approval

One yes or no per row: (0) the owner submits the official Grok Bot marketplace form in section 0,
(1+2) create `nirholas/three-ws-cursor-plugin` and submit it to the Cursor
Marketplace and cursor.directory, (3) xAI plugin marketplace PR, (4) grokbot.tools form,
(5) punkpeye remote list PR, (6) jaw9c remote list PR, (7) majiayu000 awesome-grok-bot PR,
(8) mcpservers.org free form, (9) ZeroPointRepo awesome-grok-bot PR.

## Submission log

Record each submission's URL here after it is made, then retire order 929.

| # | Submitted | URL | Outcome |
|---|---|---|---|
