# Grok Bot connector listings

Researched 2026-10-23. Nothing here has been submitted. Every submission publishes
to an external site, so each one waits for the owner's yes (CLAUDE.md gate 2).

xAI itself has no connector directory with a submission process: a user adds a custom
connector by URL under Connectors in Grok ([xAI connectors docs](https://docs.x.ai/grok/connectors)).
The listings below are third-party MCP directories that Grok Bot users browse.

## The text we submit

| Field | Value |
|---|---|
| Name | three.ws |
| One line | Free 3D studio for Grok: search ready-made 3D assets, generate models and rigged avatars from text or a photo, get viewer links back. Signed in: your agents and read-only Solana market intel. Never spends. |
| Connector URL (Grok) | `https://three.ws/api/mcp-grok` |
| Connector URL (any MCP client, no auth) | `https://three.ws/api/mcp-studio` |
| Transport | Streamable HTTP |
| Auth | None for the studio server; OAuth 2.1 at `?auth=oauth`; API key (connector preset) |
| Docs | https://three.ws/docs/grok-bot |
| Website | https://three.ws/grok |
| Logo | `public/logo.png` (https://three.ws/logo.png) |
| Maintainer | three.ws, https://three.ws |

Verified live: `npm run probe:mcp-clients` passes 8 of 8 hosted servers against production
(`prompts/x-grok/_generated/connector-probe.json`).

## Directories

| Directory | Method | Requirements | Cost | Listed already |
|---|---|---|---|---|
| [mcpservers.org](https://mcpservers.org/submit) | Web form | Name, category (Design), short description, repository/website/docs link, optional official MCP Registry name, remote-connection checkbox (tick it), contact email | Free (review up to 2 weeks) or $39 premium (about 24 hours, badge). Paid is an external spend: owner decides. | Not found |
| [awesome-remote-mcp-servers](https://github.com/jaw9c/awesome-remote-mcp-servers) | Pull request | One table row: Name, Category, URL in backticks, Authentication, Maintainer link. Needs OAuth 2.0 or API key support (we have both) | Free | Not found |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Pull request | Requires a public GitHub repository users can install and run. A hosted URL with no installable package belongs in the remote list above instead. Our installable packages (`@three-ws/*-mcp`) qualify; pick one repo | Free | Not checked per entry |

## Prepared diffs (not opened)

### awesome-remote-mcp-servers, README table row

Category column uses the existing value `Design`.

```
| three.ws | Design | `https://three.ws/api/mcp-grok` | OAuth2.1 / API Key / Open | [three.ws](https://three.ws) |
```

Example usage to put in the PR body: "Ask Grok Bot: find a ready-made chair in the three.ws
catalog and give me its viewer link. The free studio server needs no account."

### mcpservers.org form values

| Form field | Value |
|---|---|
| Server Name | three.ws |
| Category | Design |
| Short Description | the one line above |
| Website/Docs | https://three.ws/docs/grok-bot |
| Remote connections | checked |
| Submission plan | Free |

### awesome-mcp-servers

Held. The entry needs the repository link of an installable server and the maintainers' category
for it; the owner picks which package repository to point at. Entry shape: a single line linking
the server name to its repository with a short description, alphabetical within the category.

## Owner approval needed

Approve per row: (1) mcpservers.org free form, (2) awesome-remote-mcp-servers PR, (3) awesome-mcp-servers PR
and which repo. After approval, run each submission, record its URL here, then retire order 929.

## xAI official plugin marketplace (Grok Build)

Researched 2026-11-04. [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace)
(319 stars, pushed 2026-11-04) is xAI's own catalog for Grok Build, 36 plugins at the time
(Vercel, Sentry, Stripe, Cloudflare, Figma, Unity, Supabase and others). It is the highest-value
Grok listing we have: Grok Build browses it in its Marketplace tab, and each entry's `keywords`
and `domains` drive the in-product suggestion that offers the plugin when a request matches.
There is no 3D plugin in it yet.

A submission is one pull request that appends an entry to `.grok-plugin/marketplace.json`,
regenerates `.grok-plugin/plugin-index.json`, and passes the repo's two checks. Rules:
[CONTRIBUTING.md](https://github.com/xai-org/plugin-marketplace/blob/main/CONTRIBUTING.md).

The plugin lives in this repo at [integrations/grok/three-ws](../../integrations/grok/three-ws/README.md):
the `three-ws` MCP server (`https://three.ws/api/mcp-grok`), six 3D skills vendored from
`.agents/skills`, and a `three-ws-tour` command. No hooks, agents, scripts or executables, which
`tests/grok-plugin.test.js` enforces, so the static security review has nothing to flag.

### Steps, once the owner approves (gate 2)

1. Push `main` so the plugin folder is public: `git push threews main`.
2. Pin that commit: `git ls-remote https://github.com/nirholas/three.ws.git HEAD` (the full 40-character SHA).
3. Fork `xai-org/plugin-marketplace`, append the entry below with that SHA, then run
   `python3 scripts/generate-plugin-index.py`, `python3 scripts/validate-catalog.py` and
   `python3 scripts/generate-plugin-index.py --check`.
4. Open the PR with the body below.

### Catalog entry

```json
{
  "name": "three-ws",
  "description": "Free 3D studio for Grok Build: turn a sentence or a photo into a textured 3D model (GLB) or a rigged, animation-ready avatar, auto-rig a GLB, search thousands of CC0 3D assets, and embed the result on a site. No account or API key.",
  "category": "media",
  "source": {
    "source": "url",
    "url": "https://github.com/nirholas/three.ws.git",
    "sha": "<the SHA from step 2>",
    "path": "integrations/grok/three-ws"
  },
  "homepage": "https://three.ws/grok",
  "keywords": ["three.ws", "three-ws", "threews", "three.ws 3d", "three.ws avatar"],
  "domains": ["three.ws"]
}
```

The `sha` is filled at submit time on purpose: it must be a commit that is already public, and
pinning one before the push would point at a commit GitHub cannot serve. The validator rejects
anything but a full lowercase SHA, so the PR cannot be opened with the marker still in it.
What the repo's `scripts/validate-catalog.py` enforces (read 2026-11-04, not yet run against
this entry): a url source needs a full 40-character lowercase `sha`, and a `path` must be a
relative subdirectory with no leading `/`, no `..` and no backslashes. The entry above meets
both once the SHA is in. Step 3 runs the real checks, including the index regeneration, which
fetches the pinned commit and so only passes after step 1.

### PR title and body

Title: `Add three.ws (free text/photo to 3D, rigged avatars, CC0 asset search)`

```markdown
## What this PR does

- Plugin name: three-ws
- Type: remote source
- Source URL + pinned SHA: https://github.com/nirholas/three.ws.git @ <sha>, path integrations/grok/three-ws
- Homepage: https://three.ws/grok

Adds a free 3D studio to Grok Build: text or a photo to a textured GLB or a rigged avatar,
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

The ownership checkbox about an official org is answered by the reviewer note: CONTRIBUTING.md
says a personal-account source "will be questioned". If review pushes back, the fallback is to
mirror the folder into a `three-ws` GitHub org repo and pin that instead; nothing else changes.

## awesome-grok-bot

[ZeroPointRepo/awesome-grok-bot](https://github.com/ZeroPointRepo/awesome-grok-bot) (95 stars,
75 commits, checked 2026-11-04) is the active Grok Bot list. Its section "Grok Bot plugins and MCP
servers" holds hosted MCP servers (imagine-mcp, tesla-fleet-mcp and others), sorted by name, so
our line goes after `tesla-fleet-mcp` and before `yourai-context-plugin`. Format per its
CONTRIBUTING.md: `- [name](repo-url) by [author](author-url) <separator> one-line description. **[tag]**`,
description under about 120 characters, tag one of production/beta/experimental/guide.

The list's separator is an em dash, which this repo's writing rules keep out of our files, so the
line below uses a hyphen: swap it for the list's em dash when pasting into their README.

```markdown
- [three.ws](https://github.com/nirholas/three.ws) by [nirholas](https://github.com/nirholas) - remote MCP for Grok Bot: free text or photo to 3D models and rigged avatars; signed in, your agents and read-only Solana market intel. **[production]**
```

PR title: `Add three.ws to Grok Bot plugins and MCP servers`. Body: connector URL
`https://three.ws/api/mcp-grok`, the one-line ask "Ask Grok Bot: find a ready-made chair in the
three.ws catalog and give me its viewer link", and a link to https://three.ws/docs/grok-bot.

Approve per row, as above: (4) xAI plugin marketplace PR, (5) awesome-grok-bot PR.

