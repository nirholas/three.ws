# What top and trending GitHub repos do that nirholas repos don't

Snapshot: 2026-11-03. **6,880 repos scanned** with the GitHub GraphQL API:

| Group | Repos (non-fork, non-archived) | How it was picked |
|---|---|---|
| Top 500 all-time | 487 | Most stars on GitHub |
| Top 4000 all-time | 3,788 | Most stars on GitHub, paged by star range |
| Trending | 841 | github.com/trending, 31 languages x daily/weekly/monthly |
| Rising, made last 30 days | 999 | Most stars among repos created since 2026-10-04 |
| Rising, made last 6 months | 995 | Most stars among repos created since 2026-05-05 |
| nirholas, all public | 433 | Every public source repo (155 private repos excluded) |
| nirholas, top 40 | 40 | The 40 public repos with the most stars |

About 70 signals were collected per repo: CI status of the last 10 default-branch commits, releases, commit and PR activity, file tree, README structure and community files. The full tables are in [Appendix: full tables](#appendix-full-tables). Per-repo fixes for all 433 public repos, ordered least to most stars, are in [own-repos.md](own-repos.md).

## The answer in five lines

1. **GitHub Actions has been locked on this account for a billing issue since 2026-09-15.** 85 public repos show red CI only because their jobs never start. That is the single biggest cause of red CI across the account, and nothing in the code is broken. Clearing it at github.com/settings/billing turns most of the red green with no code change.
2. **They ship releases; we don't.** 69% to 79% of top, trending and breakout repos publish GitHub releases, and over half released in the last 90 days. 8 of our 433 public repos have ever cut a release.
3. **They iterate in public, through pull requests.** Breakout repos (the top quarter of repos created in the last 6 months) have a median of 72 commits in the last 30 days and 62 merged PRs. Our top 40: 7.5 commits and 3 merged PRs.
4. **Their READMEs are a third of the size of ours.** About 14.7k characters and 16 headings, against 36.7k and 71 for our top 40. They use 6 topics; we use 18.
5. **We already over-deliver on community boilerplate.** CITATION.cff, star-history charts, contributor images, CODEOWNERS and the full template set are on 75% to 100% of our top repos and on 2% to 53% of breakout repos. More of it will not move anything.

## What the top and trending repos have in common

Ranked by how strongly each trait separates breakout repos (the top quarter by stars among repos made in the last 6 months, 5,438+ stars) from the bottom quarter (2,034 stars or fewer). The two groups are about the same age, so this filters out "old repos have everything". It shows correlation, not cause: popular repos attract contributors, and contributors bring PRs and Discord servers.

| Trait | Breakout top quarter | Bottom quarter | Gap | Our top 40 |
|---|---|---|---|---|
| Active CI on recent commits | 82% | 60% | +22 | 85%, but 73% of runs fail (mostly the billing lock) |
| Commits to main, last 30 days (median) | 72 | 18 | 4x | 7.5 |
| Merged PRs, lifetime (median) | 62 | 11 | 6x | 3 |
| Dark/light `<picture>` hero art | 33% | 17% | +16 | 5% |
| Skills or plugins directory (agent packaging) | 33% | 18% | +15 | 12% |
| Discord link | 24% | 10% | +14 | 2% |
| Publishes GitHub releases | 69% | 56% | +14 | 8% |
| Released in the last 90 days | 62% | 50% | +12 | 2% |
| Latest commit CI green | 63% | 52% | +11 | 38% |
| Translated READMEs | 34% | 25% | +10 | 12% |
| Dependabot or Renovate config | 23% | 15% | +8 | 10% |
| Community templates (PR, issue, CONTRIBUTING, security) | 40% to 53% | 26% to 40% | +11 to +15 | 92% to 95% |
| GIF or video demo | 31% | 39% | -8 | 8% |
| One-line install command | 56% | 54% | +2 | 78% |

In plain terms, the repos that break out:

1. **Show that the code works.** CI runs on every push and is mostly green: about 20% of recent runs fail across every comparison group, against 73% for our top 40.
2. **Ship visibly and often.** They tag versions, publish release notes, and push most days. Watchers get a notification on each release, which pulls people back.
3. **Work in the open.** Changes land as PRs, outside contributors get merged, and there is a Discord (24% of breakout repos) and a docs site (42%).
4. **Ride the current wave.** Coding-agent skills, plugins and rules are the largest category of breakout repos: 29% of the 6-month set and 18% of the 30-day set. Agent frameworks are next at 15%. A third of breakout repos ship a `skills/`, `plugins/` or `.claude-plugin/` folder, and 28% give install steps for 3 or more agent hosts (Claude Code, Codex, Cursor, Gemini CLI, OpenCode...).
5. **Keep the README tight and polished.** A logo that works in light and dark mode, a 15-word intro, badges, 5 code blocks, then links out to docs. 34% of breakout repos also offer translated READMEs, which reach the large Chinese-, Japanese- and Korean-speaking audiences.
6. **Keep topics accurate.** The median is 5 to 8 topics, against our 15 (all public repos) and 18 (top 40).

A demo GIF is not a differentiator among new repos: the bottom quarter has them slightly more often. A tagline image or screenshot above the fold matters more than motion.

## What we are not doing yet, ranked by impact

| # | Gap | Repos affected | Fix |
|---|---|---|---|
| 1 | **Actions locked by billing** | 85 | Clear the billing issue at github.com/settings/billing (failed payment, expired card or spending limit). The API token cannot read billing, so this has to be done in the browser. |
| 2 | **No releases** | 403 (8 have one) | Tag `v0.1.0` or higher on every repo with a package manifest. Use `.github/release.yml` for categorized auto-notes, and add a tag-triggered publish workflow for npm or PyPI packages. |
| 3 | **Dependabot security updates failing** | 18 | A parent package pins the vulnerable version (`conflicting-dependencies`), so Dependabot cannot bump it alone. Upgrade the parent, or add an `overrides` (npm) or `resolutions` (yarn) entry. Affects pump-fun-sdk, PAI, crypto-vision, boosty and 14 others (see own-repos.md). |
| 4 | **Commits straight to main, no PRs** | Top 40 median: 3 merged PRs | Land changes through PRs so the repo shows activity, review and a contribution path. Label `good first issue`s and link a Discord or Discussions space. |
| 5 | **Topic stuffing** | 404 repos have more than 10 topics | Trim each to the 5 to 8 most accurate. |
| 6 | **No dependency-update config** | 403 | Add `.github/dependabot.yml` with grouped weekly minor and patch updates, so security PRs arrive as one batch. |
| 7 | **No tests or no CI on package repos** | 185 without tests, 90 without CI | Smoke test: import the package and call its main entry point. CI: install, lint, test, build on push and PR. |
| 8 | **README bloat** | 33 over 30k chars | Keep pitch, hero image, install, 10-line example and links. Move the rest into `docs/`. |
| 9 | **Agent packaging** | 12% of top 40 have a skills/plugin layout | Our MCP and agent repos (XActions, agenti, universal-crypto-mcp, PAI and others) are in the hottest category. Ship them as Claude Code plugins or skills with one copy-paste install block per agent host. |
| 10 | **Hero art and translations** | 5% dark/light art, 12% translations | Add a `<picture>` hero with light and dark variants, then translated READMEs (zh, ja, ko, es) for the top 10. |

**Stop adding:** CITATION.cff (95% of our top 40, 2% of breakout), contributor images (75% vs 9%), star-history charts (100% vs 25%), and CODEOWNERS on single-maintainer repos (78% vs 14%). Leave the existing files; spend the effort on items 1 to 4.

## Where we already lead

Descriptions, homepages and licenses on nearly every public repo. Agent instruction files (AGENTS.md, CLAUDE.md, llms.txt) on all of our top 40, against 54% of breakout repos. CHANGELOG files (88% vs 27%), lint configs (45% vs 21%), examples folders, docs folders and Docker files. Nothing in our public set has gone more than 180 days without a push.

## Suggested order of work

1. **Today:** clear the Actions billing lock. Re-run CI on the top 20 repos and note which ones are still red for real.
2. **This week:** fix the 18 Dependabot conflicts with overrides or parent upgrades. Cut a first release on the top 20 repos that have a package manifest, and add `release.yml` plus a publish-on-tag workflow.
3. **Next week:** trim topics across all public repos (a scripted `PUT /repos/{repo}/topics` pass), and add grouped Dependabot configs.
4. **Then:** rewrite the top 10 READMEs to the short format with light and dark hero art. Package the MCP and agent repos as plugins or skills with multi-host install blocks. Start landing work through PRs.
5. **Monthly:** re-run the scan and compare against this snapshot.

## Method and caveats

- CI health comes from the commit status rollup on the last 10 default-branch commits. It includes GitHub Actions and any external check app. Failure reasons for our repos were classified from the latest failed run's jobs and annotations (`ci_reasons.py`).
- README traits are regex heuristics over the raw README: install commands, headings, media, links. They are directionally right but not exact.
- Categories come from description, topics and repo name. "Other" is large (27% to 44%) because many repos have no description or describe themselves in languages the keyword buckets do not match, so treat the category shares as lower bounds.
- Trending covers 31 language pages, so its language mix is spread evenly by design. The rising sets show the real mix: Python 28%, TypeScript 21%, JavaScript 12%, Rust 10%.

## Reproduce

```bash
cd docs/github-benchmark
export GH_TOKEN=...            # fine-grained token with public-repo read access
python3 -I collect_wide.py data/wide --top 4000   # about 30 minutes, resumable
python3 -I ci_reasons.py data/wide                 # why our failing CI fails
python3 -I categorize.py data/wide                 # what kinds of repos are trending
python3 -I analyze_wide.py data/wide               # tables on stdout, writes own-repos.md
```

`data/` is git-ignored. The first, smaller pass (40 trending repos against our top 40, REST API) is `collect.py`.

## Appendix: full tables

### Every group, every signal

| Signal | Top 500 all-time | Top 4000 all-time | Trending (all langs) | Rising, made last 30d | Rising, made last 6mo | nirholas, all (public) | nirholas, top 40 |
|---|---|---|---|---|---|---|---|
| Has any CI status on recent commits | 79% | 69% | 83% | 55% | 70% | 76% | 85% |
| Latest commit CI green | 59% | 53% | 66% | 47% | 57% | 52% | 38% |
| Has 1+ GitHub releases | 72% | 72% | 79% | 55% | 61% | 2% | 8% |
| Released in last 90 days | 51% | 44% | 61% | 52% | 56% | 1% | 2% |
| Has git tags | 77% | 78% | 84% | 58% | 66% | 3% | 12% |
| Tests directory | 45% | 40% | 43% | 39% | 39% | 52% | 35% |
| Package manifest at root | 67% | 65% | 52% | 47% | 58% | 95% | 85% |
| One-line install in README | 49% | 41% | 34% | 45% | 55% | 54% | 78% |
| Install/usage section | 57% | 54% | 58% | 55% | 61% | 64% | 88% |
| GIF/video demo | 40% | 34% | 30% | 32% | 35% | 2% | 8% |
| Dark/light `<picture>` art | 22% | 13% | 17% | 14% | 26% | 2% | 5% |
| Docs site link | 68% | 59% | 55% | 24% | 37% | 24% | 38% |
| Discord link | 28% | 21% | 25% | 9% | 16% | 0% | 2% |
| Translated READMEs | 22% | 15% | 13% | 20% | 31% | 1% | 12% |
| Benchmark/comparison section | 7% | 7% | 7% | 10% | 10% | 6% | 45% |
| Multi-client install (3+ agent hosts) | 17% | 8% | 11% | 12% | 23% | 16% | 22% |
| Skills/plugins dir | 20% | 11% | 17% | 16% | 26% | 3% | 12% |
| Agent files (AGENTS/CLAUDE/llms.txt) | 44% | 30% | 43% | 31% | 42% | 99% | 100% |
| Examples dir | 19% | 20% | 14% | 18% | 21% | 25% | 35% |
| Docs dir | 55% | 51% | 60% | 65% | 68% | 93% | 90% |
| Docker | 25% | 23% | 23% | 8% | 14% | 9% | 32% |
| Makefile/justfile | 17% | 17% | 18% | 7% | 9% | 1% | 12% |
| Dependabot/Renovate config | 40% | 31% | 37% | 8% | 17% | 2% | 10% |
| Lint/format config | 42% | 38% | 31% | 11% | 18% | 7% | 45% |
| CHANGELOG file | 28% | 28% | 30% | 23% | 28% | 17% | 88% |
| CONTRIBUTING | 66% | 56% | 56% | 34% | 45% | 97% | 95% |
| Issue templates | 70% | 60% | 66% | 26% | 38% | 97% | 95% |
| PR template | 52% | 38% | 40% | 16% | 30% | 96% | 92% |
| Code of conduct | 46% | 36% | 39% | 9% | 17% | 97% | 95% |
| Security policy | 53% | 39% | 43% | 20% | 33% | 97% | 95% |
| FUNDING | 39% | 31% | 37% | 8% | 13% | 93% | 92% |
| CODEOWNERS | 24% | 17% | 20% | 4% | 9% | 9% | 78% |
| CITATION.cff | 6% | 4% | 3% | 3% | 2% | 96% | 95% |
| Star-history chart | 16% | 10% | 12% | 7% | 18% | 97% | 100% |
| Contributors image | 9% | 7% | 7% | 1% | 5% | 92% | 75% |
| Table of contents | 12% | 11% | 8% | 5% | 5% | 5% | 22% |
| Homepage URL set | 75% | 72% | 73% | 39% | 55% | 98% | 98% |
| Discussions on | 57% | 50% | 53% | 11% | 25% | 99% | 100% |
| License | 93% | 91% | 94% | 88% | 93% | 97% | 100% |

| Median | Top 500 all-time | Top 4000 all-time | Trending (all langs) | Rising, made last 30d | Rising, made last 6mo | nirholas, all (public) | nirholas, top 40 |
|---|---|---|---|---|---|---|---|
| CI failure share, last 10 commits (repos with CI) (mean) | 25% | 25% | 23% | 17% | 20% | 37% | 73% |
| Commits to default branch, last 30d | 49 | 7 | 60 | 40 | 30 | 2 | 7.5 |
| Merged PRs (lifetime) | 935 | 410 | 522 | 1 | 22 | 0 | 3 |
| Workflows | 5 | 3 | 5 | 1 | 2 | 0 | 0 |
| Topics | 8 | 7 | 7 | 0 | 5 | 15 | 18 |
| README length (chars) | 12,802 | 9,443 | 8,239 | 10,839 | 12,889 | 10,358 | 36,721 |
| README headings | 15 | 12 | 12 | 13 | 16 | 18 | 71 |
| README images | 7 | 6 | 5 | 4 | 6 | 7 | 6 |
| Badges | 5 | 4 | 3 | 0 | 5 | 6 | 6 |
| Code blocks | 3 | 2 | 2 | 4 | 5 | 4 | 18 |
| Intro paragraph words | 15 | 14 | 16 | 16 | 15 | 19 | 16 |
| Root files/dirs | 27 | 23 | 26 | 16 | 19 | 22 | 38 |
| Stars | 76,941 | 19,410 | 8,742 | 430 | 3,004 | 7 | 32 |

### Breakout lift (repos made in last 6 months): top quartile (5,438+ stars, n=248) vs bottom quartile (<= 2,034, n=248)

| Signal | Top quartile | Bottom quartile | Gap (pts) | nirholas top 40 |
|---|---|---|---|---|
| Has any CI status on recent commits | 82% | 60% | +22 | 85% |
| Dark/light `<picture>` art | 33% | 17% | +16 | 5% |
| Skills/plugins dir | 33% | 18% | +15 | 12% |
| PR template | 40% | 26% | +15 | 92% |
| Discord link | 24% | 10% | +14 | 2% |
| Has 1+ GitHub releases | 69% | 56% | +14 | 8% |
| Agent files (AGENTS/CLAUDE/llms.txt) | 54% | 40% | +14 | 100% |
| Discussions on | 32% | 19% | +14 | 100% |
| CONTRIBUTING | 53% | 40% | +13 | 95% |
| Has git tags | 74% | 61% | +13 | 12% |
| Star-history chart | 25% | 13% | +12 | 100% |
| Released in last 90 days | 62% | 50% | +12 | 2% |
| Issue templates | 46% | 35% | +12 | 95% |
| Security policy | 44% | 32% | +11 | 95% |
| Latest commit CI green | 63% | 52% | +11 | 38% |
| Package manifest at root | 64% | 54% | +10 | 85% |
| Translated READMEs | 34% | 25% | +10 | 12% |
| Dependabot/Renovate config | 23% | 15% | +8 | 10% |
| Contributors image | 9% | 1% | +8 | 75% |
| Docs dir | 73% | 65% | +8 | 90% |
| GIF/video demo | 31% | 39% | -8 | 8% |
| Docker | 18% | 10% | +8 | 32% |
| CODEOWNERS | 14% | 6% | +7 | 78% |
| Homepage URL set | 62% | 55% | +7 | 98% |
| Multi-client install (3+ agent hosts) | 28% | 21% | +6 | 22% |
| Examples dir | 26% | 19% | +6 | 35% |
| Lint/format config | 21% | 16% | +5 | 45% |
| Docs site link | 42% | 37% | +4 | 38% |
| License | 97% | 92% | +4 | 100% |
| Code of conduct | 20% | 16% | +4 | 95% |
| Tests directory | 39% | 35% | +4 | 35% |
| Table of contents | 5% | 7% | -2 | 22% |
| CHANGELOG file | 27% | 29% | -2 | 88% |
| CITATION.cff | 2% | 1% | +2 | 95% |
| Benchmark/comparison section | 13% | 11% | +2 | 45% |
| One-line install in README | 56% | 54% | +2 | 78% |
| FUNDING | 13% | 14% | -1 | 92% |
| Install/usage section | 61% | 62% | -1 | 88% |
| Makefile/justfile | 9% | 10% | -0 | 12% |
| median CI failure share, last 10 commits (repos with CI) | 22% | 19% | | 73% |
| median Commits to default branch, last 30d | 72 | 18 | | 7.5 |
| median Merged PRs (lifetime) | 62 | 11 | | 3 |
| median Workflows | 3 | 1 | | 0 |
| median Topics | 6 | 4 | | 18 |
| median README length (chars) | 14,666 | 13,047 | | 36,721 |
| median README headings | 16 | 16 | | 71 |
| median README images | 8 | 6 | | 6 |
| median Badges | 6 | 3 | | 6 |
| median Code blocks | 5 | 5 | | 18 |
| median Intro paragraph words | 16 | 17 | | 16 |
| median Root files/dirs | 24 | 18 | | 38 |

### Categories

- Trending (all langs) (n=848): Other 42%; Coding-agent skills, plugins, rules 10%; Web, UI and design 8%; Dev tools, CLIs, terminals, editors 7%; Self-hosted apps and infra 6%; LLM apps, chat UIs, gateways 6%; Agent frameworks and autonomous agents 6%; Learning resources and lists 4%; MCP servers and tooling 3%; Security and reverse engineering 2%; Models, training, inference 2%; Agent memory, context and RAG 1%; Voice, image, video generation 1%; Finance and trading 1%; Scraping, browser automation 1%
- Rising, made last 30d (n=1000): Other 44%; Coding-agent skills, plugins, rules 18%; Agent frameworks and autonomous agents 10%; LLM apps, chat UIs, gateways 6%; Models, training, inference 4%; MCP servers and tooling 4%; Web, UI and design 3%; Dev tools, CLIs, terminals, editors 3%; Security and reverse engineering 2%; Voice, image, video generation 2%; Learning resources and lists 2%; Self-hosted apps and infra 1%; Agent memory, context and RAG 1%; Scraping, browser automation 1%; Finance and trading 0%
- Rising, made last 6mo (n=1000): Coding-agent skills, plugins, rules 29%; Other 27%; Agent frameworks and autonomous agents 15%; LLM apps, chat UIs, gateways 7%; Models, training, inference 4%; Web, UI and design 4%; Dev tools, CLIs, terminals, editors 4%; MCP servers and tooling 3%; Self-hosted apps and infra 2%; Learning resources and lists 2%; Security and reverse engineering 1%; Agent memory, context and RAG 1%; Voice, image, video generation 1%; Scraping, browser automation 0%; Finance and trading 0%
