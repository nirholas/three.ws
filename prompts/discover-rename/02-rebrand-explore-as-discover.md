---
name: Rebrand /explore as community /discover
depends_on: 01-rename-discover-to-my-agents.md
---

# Goal

Promote the existing community ERC-8004 directory from `/explore` to `/discover`. After task 01, the `/discover` URL is free (it 301s to `/my-agents`). Replace that redirect with the real community page; redirect `/explore` → `/discover` instead.

# Pre-flight

This task **must** run after 01. Verify before starting:

- `/discover` 301 redirect to `/my-agents` exists in `vercel.json`.
- `/my-agents` is live and tested.

If 01 isn't done, stop and run 01 first.

# Success criteria

1. `/discover` renders the community ERC-8004 directory (the page formerly at `/explore`).
2. `/explore` returns a **301** to `/discover`.
3. The `/discover` → `/my-agents` redirect from task 01 is **removed** (it would now shadow the community page).
4. Page `<title>` becomes "Discover · three.ws". `<h2>` text "Every agent, every chain." is preserved (good copy).
5. The "ERC-8004 Agent Directory" chip stays — it's a useful sub-label.
6. Canonical URL `<link rel="canonical">` is updated to `https://three.ws/discover`.
7. All nav surfaces show "Discover" pointing to `/discover` — no leftover "Explore" links.
8. Static asset paths inside the page (CSS, JS, images) all resolve.

# Steps

1. **Move files** (`git mv`):

    - `public/explore/index.html` → `public/discover/index.html`
    - `public/explore/explore.js` → `public/discover/discover.js`
    - (No `explore.css` — confirm with `ls`. The page uses `/style.css`.)
    - **Conflict alert:** task 01 moved the old `public/discover/` directory contents to `public/my-agents/`. Confirm `public/discover/` is empty before moving the explore files in. If not, stop and reconcile.

2. **Update page chrome** in the new `public/discover/index.html`:

    - `<title>Explore · three.ws</title>` → `<title>Discover · three.ws</title>`
    - `<meta name="description">` — replace "Browse every ERC-8004 agent…" with the same sentence but starting "Discover every ERC-8004 agent registered on-chain across 20+ EVM networks." (keeps SEO weight).
    - `<link rel="canonical" href="…/explore">` → `…/discover`.
    - Update `<script src="/explore/explore.js">` → `<script src="/discover/discover.js">`.
    - Nav inside the header: change `<a href="/explore" class="active">Explore</a>` → `<a href="/discover" class="active">Discover</a>`.

3. **Update internal references in `discover.js`** (formerly `explore.js`):

    - Search for any `'/explore'` strings, `pushState` calls, analytics event names, log strings. Update URL strings; keep analytics event names stable (see "Out of scope" below) unless they leak into the URL.

4. **Update redirects in `vercel.json`**:

    - **Remove** the `/discover` → `/my-agents` redirect added in task 01 (the community page now lives at `/discover` and would be unreachable otherwise).
    - **Add** `/explore` → `/discover` (permanent: true).

5. **Update nav across the app.** Grep:

    ```
    rg -n '/explore\b|>Explore<' --hidden -g '!node_modules' -g '!dist' -g '!dist-*'
    ```

    Likely files: `features.html`, `home.html`, `widgets/*.html`, `index.html`, any shared header partial, README, docs, sitemap. For each: change href to `/discover` and visible label to "Discover".

6. **Update marketing copy** that mentions "Explore" as a feature name (README headings, docs/marketing pages). Search for the proper noun "Explore" in markdown:

    ```
    rg -n '\bExplore\b' README.md docs/
    ```

    Use judgment — only change places that refer to the page/feature, not generic English uses.

7. **Service worker** — bump cache version again (yes, even though task 01 did it; this is a separate deploy and a separate SW asset list).

# Verification

- `/discover` renders the community directory, with search/filter chips, agent cards, etc.
- `/explore` 301s to `/discover`.
- `/my-agents` still works (task 01 unaffected).
- Nav across `/`, `/features`, `/widgets`, `/dashboard` shows "Discover" linking to `/discover`. No "Explore" links remain.
- View source of `/discover` — `<link rel="canonical">` points to `/discover`.

# Out of scope

- Analytics event renames. If existing events are named `explore_search`, `explore_filter_clicked`, etc., leave them — renaming breaks dashboards. Add a TODO instead.
- Any change to the agent indexing/data layer.
- Visual redesign of the community page.
