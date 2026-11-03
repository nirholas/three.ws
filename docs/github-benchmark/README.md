# Trending repos vs. nirholas: what they do that we don't

Snapshot: 2026-11-03. Sources: github.com/trending (daily, weekly and monthly, 40 unique repos) and the GitHub REST API. The top 40 trending repos were compared against the top 40 non-fork, non-archived `nirholas` repos by stars, plus a metadata pass over all 500 public repos. To re-run: `GH_TOKEN=... python3 -I collect.py data.json`.

## The one-paragraph answer

Our repos look more complete than the trending ones on paper and do worse where it counts. Every top-40 repo of ours scores 100% on GitHub's community-health checklist (code of conduct, contributing guide, templates, security policy, citation, funding). The trending median is 71%. So the checklist is not what makes a repo trend, and we have already maxed it out. The trending repos beat us on things that show the code works and keeps moving: **passing CI, tagged releases, tests, a short README with a demo, and fast iteration on a single focused idea.** More than half of our main-branch CI runs fail, and only 3 of our top 40 repos have ever published a release.

## What the trending repos have in common

1. **One idea, stated in one sentence at the top.** Superpowers opens with "a complete software development methodology for your coding agents" and gets to installation right away. Scrapling has a logo, a tagline and badges, then gets to the point. Median README length is 15.6k characters with 14 headings.
2. **They ride the current wave.** Roughly half of today's list is skills, plugins and memory for coding agents (anthropics/skills, obra/superpowers, mattpocock/skills, thedotmack/claude-mem, pbakaus/impeccable, affaan-m/ECC, cloudflare/security-audit-skill, mksglu/context-mode and others). The rest are established tools (ghostty, Hyprland, ghidra), ML releases (karpathy/nanochat, Kronos, heretic) and free LLM access. Most are young (median age 268 days) and active (88% pushed in the last 7 days).
3. **Installation for every client.** Superpowers has a separate install section for 16 agent hosts (Claude Code, Codex, Cursor, Gemini CLI, Copilot CLI, OpenCode...). People install it in one copy-paste whatever tool they use.
4. **Proof the code works.** 98% run CI, with a median of **10.5 workflows** per repo (tests, lint, release, docs). On main-branch pushes, 24% of decided runs fail. 62% have a tests directory. Badges link to live CI and coverage status.
5. **Real releases.** 78% publish tagged GitHub releases. A release creates a "what's new" moment, a changelog people can link to, and a notification for watchers.
6. **They show it working.** 28% embed a GIF or video demo, and the median README has 8 images. Scrapling uses a `<picture>` element so its cover works in light and dark mode.
7. **Distribution hooks.** Translated READMEs (Scrapling ships Arabic, Spanish, Portuguese, French and German), Trendshift and star-history rank badges, and an MCP registry marker (`<!-- mcp-name: io.github.D4Vinci/Scrapling -->`) so registries can index it.
8. **Outside contributors.** Trending CI shows 70 `action_required` runs, which are fork PRs waiting for maintainer approval. These repos get outside PRs and keep the path open for them.

## Scorecard

| Signal | Trending (40) | Ours, top 40 | Read |
|---|---|---|---|
| CI failure rate, last 10 main-branch runs | **24%** | **56%** | Biggest gap |
| Median number of CI workflows | 10.5 | 3 | Ours are mostly `pages-build` and Dependabot |
| Publishes GitHub releases | 78% | 8% | Second-biggest gap |
| Has git tags | 78% | 12% | |
| Has a tests directory | 62% | 38% | |
| GIF or video demo in README | 28% | 8% | |
| Dependabot or Renovate config | 35% | 10% | Dependabot *runs* on 25 repos without a config, so security updates only |
| Lint or format config | 20% | 48% | We lead |
| Median README length | 15.6k chars | 36.7k chars | Ours are 2.3x longer |
| Median README headings | 14 | 68 | Ours are 5x denser |
| Median topics | 6.5 | 18 | Ours look keyword-stuffed |
| Community health score (median) | 71% | 100% | Already maxed; it does not drive stars |
| CITATION.cff | 2% | 95% | Boilerplate |
| Star-history chart | 28% | 100% | Boilerplate |
| Contributors image | 2% | 72% | Boilerplate |
| CODEOWNERS | 28% | 80% | Boilerplate for single-maintainer repos |
| AGENTS.md / CLAUDE.md / llms.txt | 60% | 100% | We lead |

Across all 500 repos: 64 are forks, 4 are archived, and every source repo has a description, topics, a license and a push in the last year. Repo metadata is not the problem.

## What we are not doing yet, ranked by impact

1. **Keep main green.** 56% of our recent main-branch runs fail. A red badge or a failing Actions tab is the first thing an evaluating developer sees. Repos where 9 or 10 of the last 10 runs failed:
   - XActions (10/10, our #2 repo at 640 stars), lyra-tool-discovery (10/10), lyra-intel (10/10), lyra-web3-playground (10/10)
   - pump-fun-sdk, agenti, defi-agents, boosty, plugin.delivery, xspace-AI (9/10)
   - clawdbot (7 failed, 3 cancelled, nothing passed)

   Fix each one or delete the broken workflow. A missing CI is better than one that is always red.
2. **Ship releases.** 37 of our top 40 have never cut a release. Tag a version on every repo that ships a package (npm or PyPI), use `.github/release.yml` for categorized auto-generated notes, and add a release workflow that runs on tag push. A release also triggers the watcher notifications that bring people back.
3. **Real CI, not just Pages.** Our most common workflows are `pages-build-deployment` (35 repos) and `Dependabot Updates` (25). Only 12 have a workflow named `CI`. Each repo with code needs at least install, lint, test and build running on push and pull requests.
4. **Tests.** 62% of trending repos have them and 38% of ours do. Start with smoke tests that import the package and call its main entry point. CI then means something.
5. **Cut the README by half and add a demo.** Use a single sentence of what it does, a GIF or screenshot, a one-command install, a 10-line example, then links to docs. Move the remaining 60 headings into `docs/`. Reaching 28% demo coverage means about 8 more GIFs across the top 40.
6. **Install sections per client for agent and MCP repos.** Many of our repos are MCP servers and agent tools (universal-crypto-mcp, github-to-mcp, mcp-notify, agenti, PAI). Copy the Superpowers pattern: one copy-paste config each for Claude Code, Claude Desktop, Cursor, Codex, Gemini CLI and VS Code. Also add the `mcp-name` marker and list them in the official MCP registry.
7. **Dependabot or Renovate config for version updates**, not just security alerts. Group minor and patch updates into one weekly PR so the queue doesn't pile up.
8. **Trim the topics to 5 to 8 accurate ones.** 18 topics reads as SEO spam and weakens GitHub topic-page ranking signals.
9. **Stop adding boilerplate.** CITATION, contributor images, star-history charts and CODEOWNERS on single-maintainer repos add noise and don't help discovery. Leave the existing files, and spend that effort on items 1 to 5.

## Where we already lead (keep doing it)

Descriptions, homepages, licenses and topics on all 500 repos. Agent instruction files (AGENTS.md / CLAUDE.md) on every top repo. Lint configs. Discussions enabled. Docs folders. Every source repo pushed within the last year.

## Suggested order of work

1. **Week 1:** fix or remove CI on the 11 always-red repos above, starting with XActions.
2. **Week 2:** add a `ci.yml` (lint, test, build) and a tag-triggered release workflow to the top 10 repos by stars, and cut a `v1.x` release on each.
3. **Week 3:** rewrite the READMEs of the top 10 to the short format, with a GIF, and add per-client install blocks to the MCP repos.
4. **After that:** run `collect.py` monthly and compare the scorecard against this snapshot.
