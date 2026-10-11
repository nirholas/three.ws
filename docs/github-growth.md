# GitHub growth kit

Every public repository on the [nirholas](https://github.com/nirholas) GitHub account carries the same discovery layer, so a person or an AI agent landing on any one of them can find the rest. This page explains what that layer is, how it is applied, and how to keep it true.

## What every repo gets

| Layer | What | Why it helps |
|---|---|---|
| README block | A marked "Support the project" section: star call to action, one-click share links (X, Bluesky, LinkedIn, Hacker News, Reddit), an agent entry point, a link to the profile catalog, a contributors wall and a star history chart | Stars and shares are how repositories get found. The block makes both one click |
| README badges | Stars, license, last commit, PRs welcome and an AI-agent-friendly badge, added only when the README has no badges of its own | Signals an active, maintained project |
| Agent discovery | `AGENTS.md`, `llms.txt`, `llms-full.txt` and a `CLAUDE.md` that imports `AGENTS.md` | Coding agents and LLM crawlers can read the repo cold |
| Community health | `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `CITATION.cff`, issue forms, a pull request template and `.github/FUNDING.yml` | GitHub's community profile checklist, so the repo reads as maintained and safe to depend on |
| Repository settings | Topics (up to 20, always including `three-ws`, `ai-agents`, `llms-txt`, `agents-md`), description, homepage, Discussions, delete-branch-on-merge, secret scanning with push protection, Dependabot alerts and security updates | Search ranking on GitHub and the repo health signals |
| Profile catalog | [github.com/nirholas/nirholas](https://github.com/nirholas/nirholas): every public repo grouped by topic, plus `llms.txt`, `AGENTS.md` and a machine-readable `repos.json` | One place to find every repository |

`FUNDING.yml` links to the product, never to a token. A file a repo already ships is never overwritten, and no license is ever invented for a repo that has none: choosing a license is the owner's decision.

## How it is applied

The kit is one pure module, [scripts/lib/repo-growth-kit.mjs](../scripts/lib/repo-growth-kit.mjs), used two ways so the result is the same either way:

1. **Independent repos** are fixed in place by [scripts/boost-github-repos.mjs](../scripts/boost-github-repos.mjs). It walks every public, non-fork, non-archived repo from the least-starred to the most-starred, shallow-clones it, applies the kit, commits with a message describing exactly what was added, pushes the default branch, then sets the repository settings.
2. **Standalone mirrors** (see [Standalone repositories](./standalone-repos.md)) are force-pushed snapshots, so a direct edit would be erased by the next sync. `scripts/lib/standalone-kit.mjs` calls the same module while decorating each mirror README, so a sync reproduces the block instead of wiping it.

```bash
node scripts/boost-github-repos.mjs                       # plan every repo, write nothing
node scripts/boost-github-repos.mjs --apply               # run the whole fleet, lowest stars first
node scripts/boost-github-repos.mjs --apply --only a,b    # named repos
node scripts/boost-github-repos.mjs --apply --resume      # continue after an interruption
node scripts/boost-github-repos.mjs --only a --keep       # keep the clone to inspect the diff
```

The run is idempotent: a repo already carrying the current kit produces no diff and is skipped. It reads the GitHub API quota before every repo and waits for the reset instead of failing. Progress is written to `state.json` in the work directory so `--resume` skips finished repos.

Repos whose subject is another crypto project are held back by default, because committing content that references them needs the owner's approval. Pass `--include-gated` once that approval exists.

### The profile catalog

```bash
node scripts/build-github-profile.mjs --out /tmp/profile             # generate only
node scripts/build-github-profile.mjs --out /tmp/profile --publish   # create the repo if missing, commit, push
```

The catalog is built from the live GitHub listing, so it cannot drift from what is actually public. Re-run it after adding or renaming repos.

It is the owner's personal profile, so the copy stays personal: three.ws appears as one section and in its own repo listings, never as the header, badges, contact or author. The boost sweep skips the profile repo for the same reason (its generic block plugs the platform). The generator owns `README.md`, `assets/`, `llms.txt`, `llms-full.txt`, `CITATION.cff`, `AGENTS.md` and `repos.json` there.

The README carries animated charts rendered by `scripts/lib/profile-visuals.mjs` into `assets/`, one SVG per theme picked with `<picture>` and `prefers-color-scheme`:

| Asset | What it shows |
|---|---|
| `stats` | Odometer strip: repos, stars, forks, topics, languages, repos created this year |
| `planet` | A 3D sphere spinning in real time, one dot per repo sized by stars and colored by section, with a section legend |
| `top-stars` | Lollipops on a log axis for the 12 most-starred repos |
| `city` | Isometric city, one tower per repo (height is log stars), one district per section, towers rise on load |
| `growth` | Cumulative repos by creation month, stacked by section, drawn on left to right |
| `languages` | Extruded donut of primary languages that spins in 3D |
| `punchcard` | Repo creation by weekday and hour (UTC) |

GitHub shows README images through `<img>`, so there is no script or web font. The 3D is real anyway: a ring drawn in a group rotated by `animateTransform` and squashed by `scale(1, k)` is the exact projection of a ring spinning about a vertical axis, and dots and labels ride inside a counter-rotated group so they stay round and upright. The donut wall is the same rotating ring stacked every 1.5px. Section colors follow the fixed category order, so a section keeps its color in every chart.

## What GitHub's API cannot do

The repository social preview image can only be uploaded in the web UI (Settings, then Social preview). Standalone mirrors already serve a generated 1200x630 card from their docs site; set the same image as the social preview on the repos you most want shared.

## Tests

`tests/github-profile.test.js` covers the profile: every chart renders well formed in both themes, headline numbers match the repo list, section colors are stable, and the header stays personal. `tests/repo-growth-kit.test.js` covers the block (idempotence, no duplicate sections, links only to files that exist), badges, the file set (never overwrites, never invents a license), topic merging and the mirror README decoration.

## Related

- [Standalone repositories](./standalone-repos.md): the generated package mirrors
- [Contributing](./contributing.md#publishing-packages--standalone-mirrors): publishing and syncing mirrors
- [Agent skills](./agent-skills.md): the standalone skill repos
