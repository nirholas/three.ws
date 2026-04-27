---
name: Tests, redirects, and route QA
depends_on: 03-cross-link-and-empty-state.md
---

# Goal

Lock in the rename with automated checks and a manual QA pass so the next deploy doesn't regress redirects, nav, or service-worker caching. The repo has had route bugs before (commits `e50fd20`, `174ea92`, `05cf460`) — this task exists because handwave QA isn't enough.

# Success criteria

1. A test exists that asserts `/discover` (community) returns 200 and contains the "ERC-8004 Agent Directory" chip text.
2. A test exists that asserts `/my-agents` returns 200 and contains "On-chain Agents".
3. A test exists that asserts `/explore` returns 301 with `Location: /discover`.
4. The previous `/discover` content (the "On-chain Agents" page) is **not** served at `/discover` anymore — assertion in test.
5. `vercel.json` rewrites/redirects are reviewed for ordering bugs (redirects before catch-all rewrites).
6. The service worker does not serve a stale cached HTML for either `/discover` or `/my-agents`.
7. Sitemap (if present) lists `/discover` and `/my-agents`, and no longer lists `/explore`.

# Steps

1. **Find the existing test setup.** Check `tests/`, `vitest.config.js`, and `package.json` scripts. Identify whether route tests are HTTP-level (against a running dev server) or static (parsing HTML files).

2. **Add or extend route tests** in the appropriate test file:

    - Static check (always works): assert `public/discover/index.html` exists and contains `Discover · three.ws` and `ERC-8004 Agent Directory`.
    - Static check: assert `public/my-agents/index.html` exists and contains `My Agents · three.ws`.
    - Static check: assert `public/explore/` directory does not exist (was moved).
    - `vercel.json` parse test: assert a redirect from `/explore` → `/discover` (permanent) exists, and assert no redirect from `/discover` → `/my-agents` exists (would shadow the page).

3. **Run the test suite** and fix anything that breaks. Don't mute or skip failures.

4. **Manual QA — click every nav surface** with a checklist. For each, confirm "Discover" and "My Agents" links route correctly:

    - [ ] `/` (home, logged out)
    - [ ] `/` (home, logged in)
    - [ ] `/features`
    - [ ] `/widgets` index
    - [ ] `/dashboard` and any sub-pages with their own header
    - [ ] `/app` viewer header
    - [ ] `/agent/:id` page header
    - [ ] Footer (if any)

5. **Service worker check.** Open DevTools → Application → Service Workers. Confirm:

    - SW activated with the bumped version.
    - Cache Storage no longer contains a `/discover` entry that maps to the old "On-chain Agents" HTML.
    - Hard-refresh `/discover` → community page renders (not a stale cached personal page).

6. **Redirect verification with curl** against the deployed preview:

    ```
    curl -sI https://<preview-url>/explore | head -5
    curl -sI https://<preview-url>/discover | head -5
    curl -sI https://<preview-url>/my-agents | head -5
    ```

    Expected: `/explore` → 301, `/discover` → 200, `/my-agents` → 200.

7. **Sitemap.** If `public/sitemap.xml` or a generator exists, update entries: drop `/explore`, ensure `/discover` and `/my-agents` are present. `/my-agents` should have `<changefreq>` weekly and likely `noindex` (it's user-specific) — confirm whether the page sets `<meta name="robots" content="noindex">` and add if missing.

8. **Open a single PR** with all four task changes squashed or stacked. Title: `feat: rename Discover→My Agents, promote Explore→Discover`. PR description should list the redirects and link to this prompt directory.

# Verification

- `npm test` (or whatever the project uses) passes.
- All checklist items in step 4 are checked.
- Curl results match step 6.
- Preview deploy looks correct on desktop and mobile widths for both pages.

# Out of scope

- Performance work, SEO audits beyond the canonical/title/description fixes already done.
- Renaming CSS class prefixes left as TODOs in earlier tasks.
- Adding analytics for the new cross-links — file a follow-up if desired.
