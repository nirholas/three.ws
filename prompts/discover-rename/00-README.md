---
name: Discover → My Agents rename + community Discover
goal: Resolve the naming conflict where `/discover` shows the user's *own* on-chain agents (a personal view) while a community feed at `/explore` already exists. End state: `/discover` is renamed to `/my-agents` (personal), and `/explore` is rebranded as the community **Discover** page. Nav and links across the app are updated. No lazy redirects without route preservation; no broken nav links.
---

# Context

Today the app has two overlapping concepts:

- **`/discover`** (file: `public/discover/index.html`, JS: `public/discover/discover.js`)

    - Heading: "On-chain Agents"
    - Subtitle: "Agents we found in your linked wallets"
    - Empty state: "No wallets linked / Link a wallet to discover your on-chain agents"
    - Data source: `GET /api/erc8004/hydrate` — agents owned by the _current user's_ linked wallets only.
    - Linked from `index.html` via `#discoverLink` (visible only when authed).

- **`/explore`** (file: `public/explore/index.html`, JS: `public/explore/explore.js`)
    - Heading: "Every agent, every chain."
    - Chip: "ERC-8004 Agent Directory"
    - Data source: cross-chain index of ALL ERC-8004 agents, with search/filter.
    - Linked from the public-facing nav (Features/Widgets header).

**Problem:** "Discover" semantically means _community browse_, not _my own agents_. The current naming is backwards. `/explore` is the real "Discover" feature; `/discover` is really "My Agents".

# Target end state

| URL          | Label               | Purpose                                                  |
| ------------ | ------------------- | -------------------------------------------------------- |
| `/my-agents` | My Agents           | Agents owned by the signed-in user's wallets             |
| `/discover`  | Discover            | Community browse of all ERC-8004 agents (was `/explore`) |
| `/explore`   | (301 → `/discover`) | Back-compat redirect                                     |

Rationale for swapping `/explore` → `/discover` rather than just renaming `/discover` → `/my-agents` and leaving `/explore` alone: "Discover" is the more discoverable, marketing-friendly word for the community feed; "Explore" is fine but inferior. If the team prefers to keep `/explore` as the community URL and only rename `/discover` → `/my-agents`, do **task 01 only** and skip 02.

# Tasks

Run tasks in order. Each task is a standalone prompt file an agent can pick up.

1. [01-rename-discover-to-my-agents.md](01-rename-discover-to-my-agents.md) — Move `/discover` → `/my-agents`, update nav link in `index.html`, update header in the page itself, add a 301 from `/discover` → `/my-agents` so existing bookmarks survive.
2. [02-rebrand-explore-as-discover.md](02-rebrand-explore-as-discover.md) — Move `/explore` → `/discover` (community feed), update nav across `features.html`, `widgets`, header partials, and SEO/canonical tags. Add `/explore` → `/discover` 301.
3. [03-cross-link-and-empty-state.md](03-cross-link-and-empty-state.md) — From the new community `/discover`, add a "View my agents" CTA when authed. From `/my-agents` empty state, add a "Browse community agents" link to `/discover`. Tighten copy.
4. [04-tests-and-qa.md](04-tests-and-qa.md) — Add/adjust route tests, verify redirects, click through every nav surface, check `vercel.json` rewrites, check service-worker cache for stale `/discover` HTML.

# Non-negotiables

- **No broken links.** Grep the entire repo for `/discover` and `/explore` and update every reference, including: HTML anchors, JS `location.href`/`router.push`, `vercel.json`, sitemap, service worker, `og:url`, `canonical`, README, docs, prompt files referencing the old route.
- **301 redirects** for the old paths so external links and shared URLs keep working. Do not rely on client-side JS redirects alone.
- **Service worker invalidation.** The repo recently had a bug where the SW served `index.html` for all navigations (commit `05cf460`). After renaming, bump the SW cache version so stale `/discover` HTML doesn't ghost-serve the old page.
- **No copy-paste duplication.** When moving files, `git mv` so history is preserved. Don't leave both old and new copies of the same JS in the tree.
- **Auth gating preserved.** `/my-agents` requires a signed-in user (current `/discover` behavior). `/discover` (community) must be public.
