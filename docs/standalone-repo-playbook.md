# Standalone repo discovery playbook (2026)

Practical checklist for making an open-source developer-tool repository (npm package, MCP server, AI-agent tooling, 3D/web) discoverable and adoptable by humans and by AI agents / LLM crawlers. Each item names the exact file and gives a minimal snippet. Items marked (verified) were checked against the primary source on 2026-10-10. Items marked (community) come from third-party guides and should be re-checked against the directory's own docs before relying on them.

Note on CI: npm provenance needs a supported cloud CI provider. This workspace does not use GitHub Actions, so a standalone repo needs either GitLab CI or an owner decision on trusted publishing. Do not add a workflow to this repo.

## 0. Order of operations

1. Repo basics and README (section 1).
2. package.json and npm publish (section 6).
3. Official MCP registry (section 5), because other directories import from it.
4. llms.txt, AGENTS.md, docs site (sections 3, 4, 7).
5. Community files and first releases (sections 8, 9).
6. Awesome-list and directory submissions last, once the repo has a real README, a release, and a license (section 10).

## 1. README: above the fold

Source: [GitHub docs on READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes). GitHub shows the first screen before any scroll, and package registries render the same file.

Checklist, in this order, all visible without scrolling on a laptop:

- [ ] H1 with the product name and one sentence that says what it does and for whom ("Generate and animate 3D avatars from an MCP client").
- [ ] Badges, one row, max 5: npm version, license, CI status, bundle size or downloads, MCP registry. Badges are signals, not decoration. Drop any that are red.
- [ ] A 5 to 10 second demo (GIF or short MP4 under 10 MB, or an animated WebP) directly under the badges. For 3D tools, show the rendered result, not a terminal.
- [ ] One-command install and one 5-line working example. The first copy-paste must run with no account.
- [ ] Links row: docs site, live demo, npm, registry entry, Discord or Discussions.
- [ ] Then: Why (3 bullets, concrete), Quick start, MCP/agent config block, API table, Examples, Compatibility matrix, Contributing, License.
- [ ] Alt text on every image. Relative links only inside the repo so forks keep working.
- [ ] Keep the README self-contained as plain Markdown. LLM crawlers and registries read the raw file, so do not rely on HTML-only layout for essential facts (install command, tool list, config).

MCP config block to include verbatim (works in most clients):

```json
{
  "mcpServers": {
    "example": {
      "command": "npx",
      "args": ["-y", "@scope/example-mcp"],
      "env": { "EXAMPLE_API_KEY": "..." }
    }
  }
}
```

## 2. Repo settings: topics, About, social preview

- [ ] **Topics**: max 20, lowercase letters, numbers and hyphens, 50 chars or fewer each (verified: [GitHub topics docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics)). Use 8 to 14. Mix three layers:
  - Category: `mcp`, `mcp-server`, `model-context-protocol`, `ai-agents`, `llm-tools`, `developer-tools`
  - Tech: `typescript`, `nodejs`, `threejs`, `webgl`, `gltf`, `web-components`
  - Use case: `3d-avatars`, `text-to-3d`, `agent-skills`, `claude`, `agents-md`
  - Prefer topics that already have a large topic page at github.com/topics/NAME over novel ones; GitHub only surfaces a topic page when enough repos use it.
- [ ] **About box**: description (one sentence, same wording as README H1 line and package.json `description`), website URL (docs site), tick Releases and Packages in the sidebar.
- [ ] **Social preview**: PNG, JPG or GIF, under 1 MB, 1280x640 recommended, 640x320 minimum (verified: [GitHub docs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)). Use a solid background (transparency renders badly in dark mode and on platforms that drop alpha). Large product name, one-line value, one real screenshot. Keep important content inside the central 80 percent because some platforms crop. Upload under Settings > General > Social preview. File to keep in repo: `docs/assets/social-preview.png` (the upload itself is manual; there is no API for it).
- [ ] Enable Discussions, enable private vulnerability reporting, add a `good first issue` and `help wanted` label set (section 9).

## 3. Docs site (GitHub Pages or any static host)

Files at the site root:

`robots.txt` (allow AI crawlers deliberately; blocking them removes you from LLM answers):

```text
User-agent: *
Allow: /

Sitemap: https://docs.example.dev/sitemap.xml
```

`sitemap.xml` (list every page with `lastmod`; submit in Google Search Console and Bing Webmaster Tools):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://docs.example.dev/</loc><lastmod>2026-10-10</lastmod></url>
</urlset>
```

Per-page `<head>` essentials:

```html
<title>Example MCP: 3D avatars for agents</title>
<meta name="description" content="One sentence, 120 to 160 chars.">
<link rel="canonical" href="https://docs.example.dev/">
<link rel="alternate" type="text/markdown" href="/index.md">
<link rel="describedby" href="/llms.txt">
<meta property="og:type" content="website">
<meta property="og:title" content="Example MCP">
<meta property="og:description" content="Same sentence as meta description.">
<meta property="og:url" content="https://docs.example.dev/">
<meta property="og:image" content="https://docs.example.dev/social-preview.png">
<meta property="og:image:width" content="1280">
<meta property="og:image:height" content="640">
<meta name="twitter:card" content="summary_large_image">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SoftwareSourceCode",
  "name": "Example MCP",
  "description": "One sentence.",
  "codeRepository": "https://github.com/ORG/REPO",
  "programmingLanguage": "TypeScript",
  "runtimePlatform": "Node.js >=20",
  "license": "https://opensource.org/license/mit",
  "url": "https://docs.example.dev/"
}
</script>
```

`SoftwareSourceCode` properties `codeRepository`, `programmingLanguage`, `runtimePlatform`, `targetProduct` are defined at [schema.org/SoftwareSourceCode](https://schema.org/SoftwareSourceCode) (verified). For the installable product page, also add a `SoftwareApplication` node (`applicationCategory: "DeveloperApplication"`, `operatingSystem`, `offers.price: 0`).

Other essentials: server-rendered or static HTML (many crawlers do not run JS), one H1 per page, stable URLs, a `404.html`, `CNAME` for the custom domain, HTTPS enforced, and a clean `.md` twin of every docs page (section 4).

## 4. llms.txt, llms-full.txt, AGENTS.md

### llms.txt (verified: [llmstxt.org](https://llmstxt.org/))

Location: `/llms.txt` at site root (a subpath such as `/docs/llms.txt` covers URLs below it; the most specific file wins). Format, in this order:

1. H1 with the project name (the only required part).
2. Blockquote with a short summary.
3. Optional prose sections (no headings inside them).
4. H2 sections that are lists of `- [name](url): notes`.
5. An H2 named `Optional` holds links an agent may skip when context is tight.

```markdown
# Example MCP

> MCP server that generates and animates 3D avatars. Node.js, MIT licensed.

Install with `npx -y @scope/example-mcp`. Works with any MCP client.

## Docs

- [Quick start](https://docs.example.dev/quickstart.md): install and first call
- [Tool reference](https://docs.example.dev/tools.md): every tool, inputs, outputs
- [Configuration](https://docs.example.dev/config.md): env vars and transports

## Optional

- [Changelog](https://docs.example.dev/changelog.md)
- [Architecture notes](https://docs.example.dev/architecture.md)
```

Companion convention: serve a Markdown version of each page at the same URL with `.md` appended (`page.html.md`) or the extension replaced (`page.md`; `index.md` for directory URLs). Advertise with `<link rel="alternate" type="text/markdown">` and `<link rel="describedby" href="/llms.txt">`, or a `Link:` HTTP header (verified).

### llms-full.txt (community convention, not in the llmstxt.org spec text)

`/llms-full.txt` is the same content as llms.txt but with the full Markdown bodies of the linked pages concatenated into one file, so an agent can ingest everything in a single fetch. Rules of thumb: generate it at build time from the same sources as the `.md` twins, keep it under roughly 500 KB, put a `# Title` and `> summary` header first, separate pages with a `---` line plus an `## Page title` heading, and link it from llms.txt under `Optional`. Add a build check that fails if llms.txt links a 404.

### AGENTS.md (verified: [agents.md](https://agents.md/))

Location: repo root `AGENTS.md`; nested files allowed in subprojects, nearest file wins, explicit user prompts override. Plain Markdown, no required schema. Stewarded by the Agentic AI Foundation under the Linux Foundation. Read by Codex, Jules, Aider, goose, opencode, Zed, Warp, VS Code, Devin, Junie, Cursor, RooCode, Gemini CLI, Copilot's coding agent, Windsurf and others.

```markdown
# AGENTS.md

## Project overview
One paragraph: what this repo is, main directories.

## Setup
- Install: `npm ci`
- Dev: `npm run dev`

## Test and verify
- `npm test` must pass; run `npm run lint` before finishing.

## Code style
- TypeScript strict, ES modules, no default exports.

## PR and commit rules
- Commit format `type(scope): what changed and why`.

## Security
- Never commit secrets; env vars are listed in `.env.example`.
```

If the repo already has tool-specific files (`CLAUDE.md`, `.cursorrules`), keep one source of truth and symlink the others to `AGENTS.md`.

## 5. MCP server discovery

### Official MCP registry (verified: [quickstart](https://modelcontextprotocol.io/registry/quickstart), [authentication](https://modelcontextprotocol.io/registry/authentication))

The registry is in preview and stores metadata only; the artifact must already be published (npm, PyPI, OCI, NuGet, or a remote URL). Many other directories import from it, so publish here first.

1. `package.json` must carry `mcpName` equal to the registry name:

```json
{ "name": "@scope/example-mcp", "version": "1.0.1", "mcpName": "io.github.ORG/example" }
```

2. `server.json` at repo root (generate with `mcp-publisher init`):

```json
{
  "$schema": "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  "name": "io.github.ORG/example",
  "description": "One sentence, same as README.",
  "repository": { "url": "https://github.com/ORG/example-mcp", "source": "github" },
  "version": "1.0.1",
  "packages": [
    {
      "registryType": "npm",
      "identifier": "@scope/example-mcp",
      "version": "1.0.1",
      "transport": { "type": "stdio" },
      "environmentVariables": [
        { "name": "EXAMPLE_API_KEY", "description": "API key", "isRequired": true, "isSecret": true, "format": "string" }
      ]
    }
  ]
}
```

   Remote servers use a `remotes` array with `type: "streamable-http"` and a `url` instead of `packages`.

3. Namespace verification decides the allowed `name` prefix:

| Auth | Required name prefix | Command |
| - | - | - |
| GitHub | `io.github.USER/` or `io.github.ORG/` | `mcp-publisher login github` |
| DNS TXT | reverse domain, `com.example.*/` | `mcp-publisher login dns --domain example.com --private-key KEY` |
| HTTP | reverse domain | host `/.well-known/mcp-registry-auth`, then `mcp-publisher login http --domain example.com --private-key KEY` |

   Domain proof format: `v=MCPv1; k=ed25519; p=BASE64_PUBLIC_KEY` (TXT record on the domain, or the body of the well-known file). A domain namespace is a stronger trust signal than `io.github.*`.

4. `mcp-publisher publish`, then verify: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.ORG/example"`.
5. Bump `version` in BOTH `package.json` and `server.json` on every release; the `name` must match `mcpName` or publishing fails with "Registry validation failed for package".

### Other directories (community unless noted; confirm each site's current docs)

| Directory | How a server gets listed | Prep |
| - | - | - |
| Glama | Largely auto-indexes public GitHub MCP repos and imports from the official registry (community) | Clear README with tool list, LICENSE, a `glama.json` claim file if you want ownership, Dockerfile that starts the server so it can be scanned |
| Smithery | Submit at smithery.ai/new. Remote servers need a public HTTPS URL with Streamable HTTP, OAuth if auth is required. Local stdio servers ship as a `.mcpb` bundle (verified: [Smithery publish docs](https://smithery.ai/docs/build/publish)) | If the scan fails, serve a static card at `/.well-known/mcp/server-card.json` with `serverInfo` (name, version) and optional `tools`, `prompts`, `resources`. Do not WAF-block `SmitheryBot/1.0`. Complete Settings > Verification afterward |
| mcp.so | Form plus GitHub URL; it reads README and package.json (community) | Good README, accurate `description` and `keywords` |
| PulseMCP | Reports conflict on whether submissions are open or it syncs from the official registry (community) | Publish to the official registry, then check whether it appears; submit by form only if the site accepts submissions |

General: expose a working `tools/list` with clear descriptions per tool (directories and agents rank on these strings), document every env var, and pin a tested Node version in `engines`. Remote servers should also serve `/.well-known/mcp/server-card.json`.

## 6. npm package.json

Source: [npm package.json docs](https://docs.npmjs.com/cli/v10/configuring-npm/package-json) (verified). `keywords` feed `npm search`; `repository`, `homepage`, `bugs` populate the package page and link the repo. Third-party scorers of package health (quality, popularity, maintenance) reward README presence, tests, license, recent releases and a linked repo; the exact weights were not retrievable, so treat them as general hygiene.

```json
{
  "name": "@scope/example-mcp",
  "version": "1.0.1",
  "description": "MCP server that generates and animates 3D avatars.",
  "keywords": ["mcp", "mcp-server", "model-context-protocol", "ai-agents", "3d", "gltf", "threejs", "avatar"],
  "license": "MIT",
  "author": "Name <email> (https://example.dev)",
  "homepage": "https://docs.example.dev",
  "bugs": { "url": "https://github.com/ORG/example-mcp/issues" },
  "repository": { "type": "git", "url": "git+https://github.com/ORG/example-mcp.git" },
  "funding": [{ "type": "github", "url": "https://github.com/sponsors/ORG" }],
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "bin": { "example-mcp": "./dist/cli.js" },
  "files": ["dist", "README.md", "LICENSE"],
  "engines": { "node": ">=20" },
  "mcpName": "io.github.ORG/example",
  "publishConfig": { "access": "public", "provenance": true }
}
```

Rules:

- [ ] 8 to 15 keywords, most specific first, include `mcp` and `mcp-server` for MCP packages.
- [ ] `repository.url` must be public and match the repo you publish from (case-sensitive) or provenance fails. In a monorepo add `"directory": "packages/NAME"`.
- [ ] `files` allowlist keeps the tarball small; `README.md`, `LICENSE`, `package.json` always ship.
- [ ] Ship types (`.d.ts`) and ESM via `exports`.
- [ ] **Provenance** (verified: [npm docs](https://docs.npmjs.com/generating-provenance-statements)): npm CLI 9.5.0 or later, public `repository` field, publish from a cloud-hosted runner on a supported CI (GitHub Actions or GitLab CI/CD), with the OIDC permission (`id-token: write` on GitHub). Command: `npm publish --provenance --access public`, or set `publishConfig.provenance: true`. With trusted publishing, provenance is automatic. Verify with `npm audit signatures`. Adds the "Built and signed on" badge on npmjs.com.
- [ ] Enable 2FA on the npm account; use granular tokens scoped to the package.
- [ ] Deprecate old names with `npm deprecate` rather than abandoning them.

## 7. Citation and machine-readable metadata

`CITATION.cff` at repo root (verified: [citation-file-format](https://citation-file-format.github.io/)). GitHub renders a "Cite this repository" button with BibTeX/APA when it is on the default branch.

```yaml
cff-version: 1.2.0
message: "If you use this software, please cite it as below."
title: "Example MCP"
type: software
version: 1.0.1
date-released: 2026-10-10
license: MIT
repository-code: "https://github.com/ORG/example-mcp"
url: "https://docs.example.dev"
authors:
  - family-names: Lastname
    given-names: Firstname
keywords: [mcp, 3d, agents]
```

Also keep a `LICENSE` file with an SPDX-recognized license so GitHub shows the license in the sidebar, and a `codemeta.json` only if the project targets research audiences.

## 8. Community health files

Supported locations (verified: [GitHub docs](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)): `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SUPPORT.md` in root, `.github/` or `docs/`; `FUNDING.yml` in `.github/` only; templates in `.github/ISSUE_TEMPLATE/`. An org-level `.github` repo supplies defaults for every repo; `LICENSE` must be per-repo.

File list:

- [ ] `SECURITY.md`: supported versions table, private reporting channel (GitHub private vulnerability reporting or a security mailbox), response SLA (for example acknowledge in 3 business days), disclosure policy.
- [ ] `CONTRIBUTING.md`: dev setup (same commands as AGENTS.md), test command, commit format, PR checklist, how to add a changelog entry, where to ask questions.
- [ ] `CODE_OF_CONDUCT.md`: Contributor Covenant 2.1 with a real contact.
- [ ] `SUPPORT.md`: Discussions link, docs link, what is not supported.
- [ ] `.github/FUNDING.yml`: `github: [ORG]`.
- [ ] `.github/ISSUE_TEMPLATE/bug_report.yml`, `feature_request.yml`, `config.yml` (set `blank_issues_enabled: false` and add contact links to Discussions and docs).
- [ ] `.github/PULL_REQUEST_TEMPLATE.md`: what changed, why, how tested, checklist.
- [ ] `CODEOWNERS` in `.github/` so reviews route automatically.

Minimal issue form:

```yaml
name: Bug report
description: Something is broken
labels: ["bug", "triage"]
body:
  - type: input
    id: version
    attributes: { label: Package version }
    validations: { required: true }
  - type: textarea
    id: repro
    attributes: { label: Steps to reproduce, description: Include a minimal snippet }
    validations: { required: true }
  - type: textarea
    id: logs
    attributes: { label: Logs and environment (Node, OS, MCP client) }
```

## 9. Labels, releases, changelog

- [ ] Labels: `good first issue`, `help wanted`, `bug`, `enhancement`, `docs`, `question`, `breaking`. GitHub surfaces `good first issue` on github.com/contribute and in the Issues tab for new contributors, so keep 5 to 10 open at all times, each with a scoped description, file pointers and an acceptance test.
- [ ] Releases: semantic versioning, one GitHub Release per npm version, tag `vX.Y.Z`, release notes with Added/Changed/Fixed/Breaking and upgrade steps. Attach build artifacts (`.mcpb`, tarball) and checksums. Use Releases "Generate release notes" with a `.github/release.yml` category map.
- [ ] `CHANGELOG.md` in [Keep a Changelog](https://keepachangelog.com/) format, newest first, linked from llms.txt and the README. A visible release cadence is a maintenance signal for both humans and package scorers.
- [ ] Pin a "Roadmap" or "Status" issue; respond to new issues within 48 hours; close stale ones with a reason.
- [ ] Publish a first release before submitting anywhere; empty Releases tabs look abandoned.

## 10. Awesome-list inclusion

Rules distilled from the [awesome list contribution template](https://github.com/sindresorhus/awesome/blob/main/pull_request_template.md) (verified) and a mirror of a popular MCP list's CONTRIBUTING (community; re-read the live file):

- [ ] Entry format: `- [Name](https://github.com/ORG/REPO#readme) - Short objective description.` Capitalized, ends with a period, no marketing language, no repeating the list name.
- [ ] Place the entry at the bottom of the best-fit category; alphabetical order where the list requires it; one item per line; search for duplicates first.
- [ ] The project must be maintained (not archived or deprecated) and documented, with a README that states what it does and how to install it.
- [ ] One PR per entry, title like `Add Example MCP`, body with the repo link, why it fits, and confirmation of the checklist.
- [ ] Self-hosted MCP list: public GitHub repo users run themselves. Remote-only servers belong in the separate remote-servers list. Some lists fast-track PRs from automated agents flagged in the title; follow the list's exact convention if you use it.
- [ ] Some lists exclude whole topic areas (the main awesome index does not accept blockchain-themed lists). Read the scope section before opening a PR.
- [ ] Do not open PRs for your own repo to dozens of lists at once. Pick 3 to 5 that match the repo, wait for merges, then widen.

## 11. Final verification

- [ ] `npm pack --dry-run` shows only intended files; `npx -y @scope/example-mcp` works from a clean machine.
- [ ] `curl -I https://docs.example.dev/llms.txt` returns 200 `text/plain` (or `text/markdown`); every link inside resolves.
- [ ] `curl https://docs.example.dev/robots.txt` allows crawlers and points to the sitemap.
- [ ] Rich results test and a Schema.org validator pass on the JSON-LD.
- [ ] Share the repo URL in a chat app and a social composer: the 1280x640 image and title render.
- [ ] Registry search returns the server: `curl "https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.ORG/example"`.
- [ ] GitHub Community Standards page (Insights > Community Standards) shows every item green.
- [ ] Ask a coding agent to "set up and use this package using only the repo" and fix every point where it gets stuck; that is the real agent-readiness test.

## Source index

- GitHub topics: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics
- GitHub social preview: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview
- GitHub community health files: https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file
- llms.txt spec: https://llmstxt.org/
- AGENTS.md: https://agents.md/
- MCP registry quickstart: https://modelcontextprotocol.io/registry/quickstart
- MCP registry authentication: https://modelcontextprotocol.io/registry/authentication
- Smithery publishing: https://smithery.ai/docs/build/publish
- npm package.json: https://docs.npmjs.com/cli/v10/configuring-npm/package-json
- npm provenance: https://docs.npmjs.com/generating-provenance-statements
- CITATION.cff: https://citation-file-format.github.io/
- Schema.org SoftwareSourceCode: https://schema.org/SoftwareSourceCode
- Awesome list PR template: https://github.com/sindresorhus/awesome/blob/main/pull_request_template.md
- Directory overviews (community, unverified specifics): https://dynomapper.com/blog/ai/mcp-server-directories/ and https://saascity.io/mcp-server-directories
