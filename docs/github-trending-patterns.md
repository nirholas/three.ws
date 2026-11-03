# What GitHub's trending repos share, and where three.ws falls short

Snapshot taken 2026-11-03. Sources: github.com/trending (daily, weekly and monthly lists), the GitHub REST and GraphQL APIs, and each repo's README and file tree at its default branch. After removing duplicates there are 40 repos. The same checks were run against `nirholas/three.ws`, both as GitHub serves it today and as it stands locally.

## The short version

The trending repos are not winning on repo hygiene. Their median community-health score is 71%; ours is 100%. They are winning on **distribution shape**: each one does one thing, a coding agent can install it with one command, it proves itself with a number, and it ships releases every few days.

three.ws already matches or beats them on almost every surface check: license, health files, templates, social preview, topics, demo video, comparison table, llms.txt, AGENTS.md, star history. The gaps are in what we lead with and how often we ship to GitHub. Most of them are a day of work or less.

## Who is trending

- **29 of 40 are agent tooling**: skills, Claude Code plugins, MCP servers, agent harnesses, context and memory tools. The remaining 11 are classic developer tools (a terminal, a compositor, a reverse-engineering suite), local-model runtimes, and ML libraries.
- **25 of 40 were created in 2026**, and 7 since June. Brand-new repos make the list when the pitch is sharp.
- Median: 46k stars. Languages: Python 13, TypeScript 11, then Rust, Shell and JavaScript at 3 each.
- The closest analog to us is `earthtojake/text-to-cad` (25k stars). It is a coding-agent plugin that generates 3D models (STEP, GLB, STL, 3MF) from text. Its README is 108 lines: a one-line pitch, a website link, a quickstart and a skills list. It is our Forge pitch, packaged for coding agents.

## What they have in common

Counts are out of 40.

| Pattern | Count | Notes |
|---|---|---|
| A copy-paste install command in the README | 36 | `npx x install`, `/plugin marketplace add owner/repo`, `pip install`, `brew install`, `curl \| sh`. Usually in the first screen. |
| A number in the description or the first screen | 38 | "49 agents, 72 skills", "99% fewer bytes in context", "7.4 billion tokens per month", "646 languages", a time-to-GPT-2 leaderboard. |
| Ships agent skills (`SKILL.md` somewhere in the tree) | 31 | The dominant distribution unit of 2026. |
| Publishes GitHub Releases | 31 | Most of them cut releases every few days. 14 published one in the 48 hours before this snapshot. |
| Images in the README | 34 | 11 also have a GIF or video. |
| `docs/` directory | 27 | Long-form material lives there; the README stays short. |
| Issue templates | 25 | |
| Centered hero block (logo, tagline, link row) | 24 | |
| `AGENTS.md` or `CLAUDE.md` at the root | 23 | |
| A `.claude-plugin/` marketplace manifest | 21 | Installs with `/plugin marketplace add owner/repo`. |
| Per-harness config (`.codex`, `.cursor`, `.opencode`, `.agents`) | 20 | |
| Comparison or "why not X" section | 16 | |
| README translations | 14 | Mostly Simplified and Traditional Chinese, Japanese and Korean. |
| Names other harnesses (Codex, Cursor, OpenCode, Gemini CLI, Copilot) up top | 13 | "Works with Claude Code, Codex, Cursor..." |
| Custom social-preview image | 12 | |
| Honest scope section ("What it is not", "Wait, what are you selling me?") | several | paperclip, t3code, heretic. |

Structural medians:

| Metric | Trending median | three.ws on GitHub today | three.ws locally |
|---|---|---|---|
| README length | 256 lines | **11,443 lines** | 121 lines |
| Top-level entries in the file tree | 31 | **131** | 131 |
| Repo description length | 101 chars | **244 chars** | same |
| Contributors | 41 | 13 | |
| Days spanned by the 5 most recent releases | about 25 (many under 8) | 43 (only 4 releases ever) | |

## What we already do well

Health 100%: LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, SUPPORT, FUNDING, issue and PR templates, 20 topics, homepage, custom social preview, Discussions enabled, a demo video in the hero, a comparison table, `llms.txt` and `llms-full.txt`, `AGENTS.md`, examples, a Dockerfile, Codespaces, star history and a contributors wall. The local README (commit `f410cfa5f`) already follows the trending shape: one-line pitch, "Try it in 60 seconds", one-command install, a feature table, and the full reference moved to `docs/reference.md`.

## The gaps, ranked by impact

### 1. GitHub still serves the 11,000-line README

`main` is 24 commits ahead of `threews/main`, and the README rewrite is one of them. Anyone landing on the repo today scrolls past 131 tree entries to an 11,443-line README. Every other fix below is worth less until this push lands.

**Action:** `git push threews main` (owner gate 2).

### 2. The Claude Code plugin marketplace exists, but nothing tells anyone

`.claude-plugin/marketplace.json` defines four plugins that all resolve: `three-ws-core` (51 skills), `three-ws-3d` (forge-3d, mesh-forge, text-to-avatar, auto-rig), `three-ws-developer`, and a trading pack. The README never mentions `/plugin marketplace add nirholas/three.ws`. That one line is the most common install pattern on the trending list. Two problems inside the manifest itself:

- `three-ws-core` is categorized as `payments`, and its keywords lead with wallet and DeFi terms and list an EVM chain before Solana. The hook that pulls developers in is free text-to-3D; payments are what keeps them. Lead with 3D, and put Solana ahead of any EVM chain (chain-priority rule).
- The marketplace description leads with wallet operations and trading. Rewrite it around "give your coding agent a 3D pipeline".

**Action:** add a "Use it from your coding agent" block above the fold in the README, with `/plugin marketplace add nirholas/three.ws` and `npx -y @three-ws/mcp-server`. Then re-order the manifest's descriptions, categories and keywords.

### 3. We lead with a platform; trending repos lead with one job

"What you get" lists eight product lines (Forge, Viewer, agent runtime, embed, identity and wallet, payments, MCP and A2A, Worlds). Every trending repo opens with exactly one verb: "Write HTML. Render video." "Design physical products with AI." "Computer use for AI agents." text-to-cad shows the single-job framing works for our exact capability.

**Action, pick one or both:**
- Keep this repo as the platform, but make the first screen one job: "Your agent types a prompt, gets a rigged, animated GLB. Free, no key." Leave the other seven lines below the fold.
- Ship a small standalone repo holding just the 3D skills and the plugin manifest (`nirholas/3d-skills` or similar), about 100 lines of README, installable in one line, linking back here. Small skill repos make up most of the trending list (`jakubkrehel/skills`: a 39-line README and 10k stars).

### 4. No number in the pitch

38 of 40 put a concrete figure in the description or the first screen. Ours says "26-tool MCP server", which describes the inventory, not the result. Use real, measured production figures, for example: median prompt-to-GLB time on the free lane, agents created, GLB assets in the catalog, the `<agent-3d>` bundle size in KB. Pull them from the database or analytics. Do not estimate.

**Action:** pick 1 to 3 measured figures, put them in the hero and in the GitHub description.

### 5. The repo description is a feature list

244 characters, two sentences and seven nouns. The trending median is 101 characters with one outcome. Candidate (95 characters): *Give your AI agent a 3D body: prompt to rigged GLB, LLM brain, Solana wallet, one-tag embed.* Add a measured number from gap 4 if it fits.

**Action:** `gh repo edit nirholas/three.ws --description "..."`. This is outward-facing, so it waits for owner approval.

### 6. Releases are monthly; trending repos release every few days

We have 4 releases ever, with three different tag schemes (`v1.5.2`, `forge-v0.5.0`, `desktop-v0.1.0`). The last one is from 2026-10-11. Meanwhile `data/changelog.json` gets entries every day. A release notifies every watcher, keeps "Latest release" fresh on the repo page, and is the most common activity signal on the list. `scripts/github-release.mjs` already builds filtered release notes from the changelog; it just runs by hand once a month.

**Action:** cut a weekly release with `scripts/github-release.mjs` on one tag scheme (`vYYYY.MM.DD` or semver on the root package). If the owner approves weekly publishing as a standing rule, run it from Cloud Scheduler alongside the other crons (never GitHub Actions).

### 7. The root file tree is four times the median

131 top-level entries, against a median of 31 (the largest trending repo, ECC, has 86). The file tree is the first thing GitHub shows, above the README. Tracked items that look like scratch or internal state to a visitor: `ISSUES.md`, `OAI Select Tier Assets/`, `_context/`, `tasks/`, `snapshots/`, `.data/`, `distributions/`, and nine `server-*.json` registry manifests. There are also about 14 `*-sdk/` directories at the root that would read better under `packages/`.

**Action:** move the registry manifests to a `registry/` directory and the SDKs under `packages/`, and untrack or relocate the scratch directories. Each move needs its build, publish and `vercel.json` references updated in the same commit, so do it as a dedicated, tested change, not a sweep.

### 8. Other harnesses are not named

13 trending repos name Claude Code, Codex, Cursor, OpenCode and Gemini CLI in the first screen, and 20 ship per-harness config. We say "Claude (or any MCP client)". Developers search by harness name.

**Action:** a short "Works with" row plus a collapsible install snippet per client (Claude Code plugin, Claude Desktop MCP JSON, Cursor `mcp.json`, Codex `config.toml`, OpenCode). The `connect-three-ws-mcp` skill already has the content.

### 9. No translations

14 of 40 ship translated READMEs, nearly always Chinese, Japanese and Korean first. Those communities drive a large share of trending traffic. Now that the README is 121 lines, translations are cheap to keep in sync.

**Action:** add `docs/readme/README.zh-CN.md`, `README.ja.md` and `README.ko.md`, with a language row under the hero. Generate the drafts with Gemini on Vertex (pre-approved GCP spend), then have a native speaker check them before committing.

### 10. No "How it works" diagram, and no plain statement of the business model

Most trending READMEs have a "How it works" section with a diagram. Several build trust with a frank scope section ("What Paperclip is not", t3code's "Wait, what are you selling me? Nothing."). A platform that has a wallet, payments and a promoted coin gets more skepticism from developers, not less, so a plain answer pays off.

**Action:** add a Mermaid diagram (prompt, Forge, GLB, agent runtime, embed, with the wallet and x402 on the side). Add a three-line "How three.ws makes money" note: what is free, what costs money, and what $THREE is for. It should state $THREE plainly, not market it.

### 11. Community depth

13 contributors and 6 Discussions threads, against a median of 41 contributors on the trending list. Our onboarding (`docs/first-contribution.md`, labeled good first issues, Codespaces) is already better than most of the list. The gap is volume, which the fixes above feed. One cheap lever several trending repos use: a "Showcase" section or Discussions category where users post what they built, linked from the README.

## Suggested order

1. Push the local README (gap 1). Owner gate.
2. Add the coding-agent install block, rewrite the manifest framing, add the "Works with" row (gaps 2 and 8). Local edits, no gate.
3. Pull real production numbers, then rewrite the hero and the repo description (gaps 4 and 5). The description change needs owner approval.
4. Start the weekly release cadence (gap 6). Publishing needs owner approval.
5. Root tree cleanup as its own tested change (gap 7).
6. The standalone 3D-skills repo, translations, diagram and business-model note (gaps 3, 9 and 10).

## Appendix: the repos

Daily: vercel-labs/agent-desktop, thedotmack/claude-mem, D4Vinci/Scrapling, hyprwm/Hyprland, Donchitos/Claude-Code-Game-Studios, FlashML-org/FreeToken, pingdotgg/t3code, shiyu-coder/Kronos, kornia/kornia, JustVugg/colibri, mattpocock/skills, max-sixty/worktrunk, paperclipai/paperclip, karpathy/nanochat, p-e-w/heretic.

Weekly (new entries only): Nutlope/hallmark, pbakaus/impeccable, AgriciDaniel/claude-seo, obra/superpowers, JetBrains/thinkrail, cloudflare/security-audit-skill, jakubkrehel/skills, multica-ai/andrej-karpathy-skills, anthropics/skills, Leonxlnx/taste-skill, TauricResearch/TradingAgents, ghostty-org/ghostty, affaan-m/ECC, heygen-com/hyperframes.

Monthly (new entries only): morluto/rea, tester-army/e2e, debpalash/VoiceStudio, anthropics/knowledge-work-plugins, ranxianglei/billion-context, NationalSecurityAgency/ghidra, earthtojake/text-to-cad, michael-denyer/pstack-claude, anthropics/claude-plugins-official, mksglu/context-mode, tashfeenahmed/freellmapi.

For the account-wide view (the same trending set compared against the top 40 `nirholas` repos, including CI and release coverage), see [github-benchmark/](github-benchmark/README.md).

Method notes: the "install command", "number up top" and "names other harnesses" signals came from pattern matching on README text, so treat them as close approximations, not exact counts. Tree signals come from each repo's full recursive file listing. The three.ws figures come from the GitHub API (what visitors see today) and from the local checkout.
