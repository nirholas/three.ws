# Submitting three.ws 3D Forge to the Claude plugin marketplace

This plugin is packaged for submission to Anthropic's **community** plugin marketplace
(`anthropics/claude-plugins-community`). Anthropic runs automated validation + safety
screening, pins the approved commit to a specific SHA in the community catalog, and the
plugin becomes installable to everyone as `/plugin install three-ws-3d@claude-community`
(the public catalog syncs nightly, so expect ~24h between approval and appearance).

> The official, Anthropic-curated marketplace (`claude-plugins-official`) has **no public
> submission** — Anthropic reaches out directly to feature a plugin. The community route
> below is the one you submit to.

## 1. Pre-flight — already done in this repo

- `.claude-plugin/plugin.json` is spec-valid: kebab-case `name`, `displayName`, Apache-2.0 `license`, `mcpServers` block.
- Four skills under `skills/` (`forge-3d`, `text-to-avatar`, `mesh-forge`, `auto-rig`), each with valid YAML frontmatter.
- `README.md`, `CHANGELOG.md`, and `LICENSE` are present in the plugin root.
- All three bundled MCP servers are published to npm and resolve via `npx`: `@three-ws/mcp-server`, `@three-ws/scene-mcp`, `@three-ws/avatar-mcp`.

## 2. Validate locally (recommended)

Requires the Claude Code CLI:

```bash
claude plugin validate ./marketplace/plugins/three-ws-3d --strict
```

Fix anything it reports before submitting. The validator checks `plugin.json` JSON,
skill/agent/command frontmatter, required fields, and path rules.

## 3. Test the install end-to-end

```bash
# From the repo root, add this marketplace by local path and install:
/plugin marketplace add ./
/plugin install three-ws-3d@three-ws
/reload-plugins
```

Confirm the `three-ws-3d:` skills appear (`/help` or `/plugin list`) and the bundled MCP
tools list. A `forge-3d` call should return a `glbUrl` + viewer link.

## 4. Submit to the community marketplace

Make sure the plugin is pushed to the public repo (`github.com/nirholas/three.ws`), then
submit via **one** of:

- **Console** (individual authors): <https://platform.claude.com/plugins/submit>
- **claude.ai admin** (Team / Enterprise with directory access): <https://claude.ai/admin-settings/directory/submissions/plugins/new>

Provide:

| Field | Value |
| --- | --- |
| Marketplace / source repo | `https://github.com/nirholas/three.ws` |
| Plugin name | `three-ws-3d` |
| Plugin path in repo | `marketplace/plugins/three-ws-3d` |

## 5. After approval

Anthropic pins the approved commit SHA; their CI bumps it when you push new commits.
Users then install with:

```bash
/plugin marketplace add anthropics/claude-plugins-community
/plugin install three-ws-3d@claude-community
```

## Updating later

Bump `version` in `.claude-plugin/plugin.json` (and add a `CHANGELOG.md` entry) so
existing installs receive the update.

## Cursor Marketplace

Applied on 2026-11-21 through the Cursor publisher form (`cursor.com/marketplace/publish`),
submitted as the three.ws team. Cursor confirmed receipt and will follow up at
marketplace-publishing@cursor.com once it has reviewed the plugin. Status: **pending review**.

| Field | Value |
| --- | --- |
| Organization name / handle | `three.ws` |
| Namespace | `three-ws` |
| Contact email | nich@three.ws |
| Logotype | `https://raw.githubusercontent.com/nirholas/three.ws/main/public/brand/three-ws-app-icon-512.png` |
| GitHub repository | `https://github.com/nirholas/three.ws` |
| Website | `https://three.ws` |

This directory is not the Cursor plugin. Cursor reads `.cursor-plugin/marketplace.json` at the
repo root, which lists one plugin: `integrations/cursor/three-ws` (the hosted studio server at
`https://three.ws/api/mcp-studio?auth=oauth`, OAuth sign-in, no spend tools). Its reviewer notes
are in `integrations/cursor/three-ws/REVIEWING.md`. Check the listing against Cursor's published
schema with `node scripts/validate-cursor-plugin.mjs`. Cursor reviews the public repo, so the
change must be on `github.com/nirholas/three.ws` `main`.

Answer for the form's test-account field: sign-up is free and self-serve (email code, Google or
Microsoft) at the OAuth prompt, so reviewers need no shared credentials.
