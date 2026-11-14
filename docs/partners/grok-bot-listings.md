# Grok Bot connector listings

Re-derived 2026-11-14 (first pass 2026-10-23, xAI marketplace and awesome-grok-bot added
2026-11-04). Nothing here has been submitted. Every submission publishes to an external
site, so each one waits for the owner's yes (CLAUDE.md gate 2). Owner order:
`prompts/finish/929-x-grok-48-connector-directory-listings.md`.

## How Grok Bot users find connectors (2026-11-14)

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
| One line | Free 3D studio for Grok: turn text or a photo into a textured 3D model or a rigged avatar, auto-rig a GLB, search thousands of CC0 3D assets, get viewer links back. No account. Never spends. |
| Connector URL (Grok Bot, Grok) | `https://three.ws/api/mcp-grok` |
| Connector URL (any MCP client) | `https://three.ws/api/mcp-studio` |
| Transport | Streamable HTTP |
| Auth | None (anonymous). Optional OAuth 2.1 at `https://three.ws/api/mcp-grok?auth=oauth` adds the user's own three.ws agents. |
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

### 1 and 2. Cursor Marketplace and cursor.directory

Both read a whole repository from its root, so the plugin goes out as the standalone mirror
`nirholas/three-ws-cursor-plugin` that [integrations/README.md](../../integrations/README.md)
already names. **That repository does not exist on GitHub yet** (404 on 2026-11-14), so creating
it is the first step and is itself a publish.

The export was dry-run on 2026-11-14 from `threews/main`: the tree holds
`.cursor-plugin/plugin.json`, `mcp.json`, `README.md`, `LICENSE`, `assets/logo.svg` and four
skills; the logo path resolves; `mcp.json` declares no `${VAR}`; no file names another coin.

```bash
OUT=$(mktemp -d)
git archive threews/main:integrations/cursor/three-ws | tar -x -C "$OUT"
git -C "$OUT" init -q -b main
git -C "$OUT" add -A
git -C "$OUT" commit -q -m "three.ws 3D Studio plugin for Cursor, mirrored from nirholas/three.ws integrations/cursor/three-ws"
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

The plugin folder is already public and identical to local HEAD, so the SHA can be pinned now:
`60226f15515e089f3675471b07f97a557973d11a` (`git ls-remote https://github.com/nirholas/three.ws.git HEAD`
on 2026-11-14). On a fresh clone of the marketplace with this entry appended,
`python3 scripts/validate-catalog.py` prints `Catalog OK (.grok-plugin/marketplace.json)`.
Index generation result: see "Index check" below.

Append to the `plugins` array in `.grok-plugin/marketplace.json`, matching the file's existing
two-space style:

```json
{
  "name": "three-ws",
  "description": "Free 3D studio for Grok: turn a sentence or a photo into a textured 3D model (GLB) or a rigged, animation-ready avatar, auto-rig a GLB, search thousands of CC0 3D assets, and embed the result on a site. No account or API key.",
  "category": "media",
  "source": {
    "source": "url",
    "url": "https://github.com/nirholas/three.ws.git",
    "sha": "60226f15515e089f3675471b07f97a557973d11a",
    "path": "integrations/grok/three-ws"
  },
  "homepage": "https://three.ws/grok",
  "keywords": ["three.ws", "three-ws", "threews", "three.ws 3d", "three.ws avatar"],
  "domains": ["three.ws"]
}
```

Steps: fork, append the entry, `python3 scripts/generate-plugin-index.py`,
`python3 scripts/validate-catalog.py`, `python3 scripts/generate-plugin-index.py --check`, commit
both files, open the PR. If `integrations/grok/three-ws` changes before submission, re-pin to the
new public HEAD.

PR title: `Add three.ws (free text/photo to 3D, rigged avatars, CC0 asset search)`

```markdown
## What this PR does

- Plugin name: three-ws
- Type: remote source
- Source URL + pinned SHA: https://github.com/nirholas/three.ws.git @ 60226f15515e089f3675471b07f97a557973d11a, path integrations/grok/three-ws
- Homepage: https://three.ws/grok

Adds a free 3D studio to Grok: text or a photo to a textured GLB or a rigged avatar,
auto-rigging, a searchable CC0 catalog of props, characters and motion clips, render checks so
Grok can see what it made, and embed code. One hosted MCP server plus six skills and a tour
command. There is no 3D plugin in the catalog today.

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
- Network endpoints: `https://three.ws/api/mcp-grok` (the MCP server) and the `https://three.ws`
  links its tools return (GLB downloads, viewer, pose studio). Nothing else.
- Credentials: none. The server is anonymous; an optional OAuth 2.1 sign-in, documented in the
  README but not configured by the plugin, adds the user's own three.ws agents. No tool on the
  server moves money.

## Notes for reviewers

github.com/nirholas/three.ws is the canonical source of three.ws (linked from three.ws itself),
which is why the source sits under that account rather than a separate org. The plugin is a
subfolder of the product monorepo, the same layout as the stripe and expo entries.
```

CONTRIBUTING.md says a personal-account source for a branded plugin "will be questioned". If review
pushes back, mirror the folder into a `three-ws` GitHub org repo the same way as rows 1 and 2,
re-pin, and nothing else changes. `tests/grok-plugin.test.js` enforces that the plugin ships no
hooks, agents, scripts or executables.

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
| Short Description | Free 3D studio for Grok: turn text or a photo into a textured 3D model or a rigged avatar, auto-rig a GLB, search thousands of CC0 3D assets, get viewer links back. No account. Never spends. |
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

One yes or no per row: (1+2) create `nirholas/three-ws-cursor-plugin` and submit it to the Cursor
Marketplace and cursor.directory, (3) xAI plugin marketplace PR, (4) grokbot.tools form,
(5) punkpeye remote list PR, (6) jaw9c remote list PR, (7) majiayu000 awesome-grok-bot PR,
(8) mcpservers.org free form, (9) ZeroPointRepo awesome-grok-bot PR.

## Submission log

Record each submission's URL here after it is made, then retire order 929.

| # | Submitted | URL | Outcome |
|---|---|---|---|
