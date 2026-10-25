# 455. `/settings/connections` 404s: a fully-built chat-pairing API has no page to land on

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". Runnable now, no gate, no owner action required.

## Operating clause (binding)

- Read CLAUDE.md first. CLAUDE.md overrides everything, including this file.
- Finish 100% in this session. Never end the turn with a question, an option list, or an unexecuted plan.
- This is a bug fix (a live 404 on a path the server itself links to): follow the test-first rule (CLAUDE.md, "Bug fixes are test-first"). Write the failing test first, confirm it fails for the stated reason, then fix the code, then confirm it passes. Commit the test with the fix.
- The only permitted stops are the CLAUDE.md stop-and-ask gates (spend/on-chain writes, push/deploy, posting externally, committing content referencing a crypto project other than `$THREE`, destroying unrecoverable data). This order touches none of them.
- Concurrent agents share this worktree: stage explicit paths only (never `git add -A` or `git add .`), re-check `git status` and `git diff --staged` before committing.
- The em-dash and en-dash characters are banned in everything you write.

## Why this matters (measured 2026-10-25)

`GET https://three.ws/settings/connections` returns a live 404 today:

    curl -s -o /dev/null -w "%{http_code}\n" https://three.ws/settings/connections

The mechanical cause is `vercel.json` (confirmed at the lines below, read today): the `/settings/` single-page app has exactly one static file, `public/settings/index.html` (`find public/settings -maxdepth 1 -iname "*.html"` returns only `index.html`), but its catch-all route treats any subpath as a literal file on disk instead of falling back to that one file:

    { "src": "/settings", "dest": "/settings/index.html" },
    { "src": "/settings/", "dest": "/settings/index.html" },
    { "src": "/settings/(.*)", "dest": "/settings/$1" },   // <-- line ~5735, the bug: looks for a file named "connections" that does not exist

Contrast with `/dashboard/(.*)` a few hundred lines earlier, which uses the identical `dest: "/dashboard/$1"` pattern correctly, because `public/dashboard/` genuinely has one real HTML file per subpath (`actions.html`, `sessions.html`, `storage.html`, etc, confirmed via `find public/dashboard -maxdepth 1 -iname "*.html"`). `/settings/` is architecturally different: it is one hash-routed SPA (`public/settings/index.html`, 1712 lines, tab nav at lines 455-467, `navigate(tab)` router at lines 1673-1706), so its catch-all needs the SPA fallback, not the dashboard pattern. The two routes were written to look alike; only one of them is actually a multi-page directory.

This 404 is not cosmetic. The exact path `/settings/connections` is hardcoded, live, and reached by real users and real bot messages across at least four independent flows, all pointing at a page that cannot load:

1. **Telegram/Discord bot pairing.** `api/_lib/gateway/core.js`'s `pairingPrompt()` sends every person who starts a pairing flow in a bot DM a message containing `` `Open ${appOrigin()}/settings/connections?code=${code}` `` as the primary (only UI) way to redeem their pairing code. `api/_lib/gateway/commands.js` sends the same URL (no query) as the bot's "manage paired chats" help text. Both land on a 404 today.
2. **Dashboard notification settings.** `src/dashboard-next/pages/settings.js` lines 720, 784, and 792 tell the user, in the UI itself, to "Pair a chat at /settings/connections" before the Telegram/Discord notification toggle will enable. Same 404.
3. **Sign-in-with-X OAuth connect flow.** `api/auth/x/[action].js` line 160 allowlists `/settings/connections` as a valid OAuth return surface, and `connectReturnUrl()` (lines 175-191) builds `` `/settings/connections?${q}#x` `` for the `target === 'agent'` branch. Same 404. `api/_lib/x-agent-policy.js` lines 326 and 428 build the same return URL.
4. **The backend feature itself is 100% built and already labeled "behind /settings/connections."** `api/gateway/connections.js` lines 1-13 (its own header comment) describe a complete REST surface: `GET` (list paired chats + the account's agents + bot usernames), `POST {action:'issue'}` (mint a pairing code), `POST {action:'redeem', code}` (pair the chat that printed it), `PATCH {id, notify, default_agent_id}`, `DELETE ?id=` (unpair). Confirmed today: `grep -rln "api/gateway/connections" src/` returns **zero matches** anywhere in the frontend. This is a fully working, authenticated, CSRF-gated, rate-limited API with no caller.

`docs/ux-flows/11-account-dashboard.md` line 167 already documents this exact gap in its own words, written before this order: "Their disabled tooltip reads 'Pair a Telegram (or Discord) chat at /settings/connections to enable', but no page is served at that path yet, so pairing currently happens through the gateway API and the bot's `/link <code>` command." That sentence is itself now stale once this order ships (the page will exist), and must be updated.

This is a new finding, not a duplicate: `grep -rln "settings/connections\|gateway/connections" prompts/finish/` before this order returns nothing. It outranks a new feature under the RUN-ORDER rule (live production defect, four independent call sites, backend already shipped) and it is Solana-neutral infrastructure (account/notification plumbing), so it does not compete with or displace Solana-first work.

## Task

1. Read `public/settings/index.html` in full (1712 lines), focusing on:
   - lines 455-467 (the `<aside>` tab nav: `<a href="#profile" data-tab="profile" ...>` through `<a href="#danger" data-tab="danger" ...>`)
   - the `tab-connected-accounts` panel markup starting at line 634, as the closest existing pattern (a panel that calls a backend list endpoint and renders rows with actions)
   - lines 1672-1706 (`navigate(tab)`, the click handler that does `history.pushState(null, '', '#' + tab)`, the `popstate` listener, and the init IIFE that resolves the starting tab from `?tab=` then `location.hash` then `'profile'`)
2. Read `api/gateway/connections.js` in full (its header comment plus the handler body) to confirm the exact request/response shapes for `GET`, `POST {action:'issue'}`, `POST {action:'redeem', code}`, `PATCH`, and `DELETE`.
3. Write the failing test first, in a new file `tests/settings-connections-route.test.js`: read `vercel.json`, locate the rule whose `src` is `"/settings/(.*)"`, and assert its `dest` is the literal string `"/settings/index.html"` (not `"/settings/$1"`). Follow the plain-JSON-read pattern already used in `tests/pages-routes.test.js` (`JSON.parse(readFileSync(...))`, no server boot). Run `npx vitest run tests/settings-connections-route.test.js` and confirm it fails against the current `"/settings/$1"` value.
4. Fix `vercel.json`: change the `/settings/(.*)` rule's `dest` from `"/settings/$1"` to `"/settings/index.html"`. Do not touch the `/settings/api-keys/?` redirect rule or the plain `/settings` and `/settings/` rules immediately above it; they already work and must stay in the same relative order (the redirect rule must still be evaluated before the catch-all).
5. Re-run `npx vitest run tests/settings-connections-route.test.js`; it must pass.
6. Add a `connections` tab to `public/settings/index.html`, following the exact pattern of the existing tabs:
   - A new nav link in the `<aside>` block: `<a href="#connections" data-tab="connections" data-i18n="settings_index.connections">Connections</a>`, placed after the `#sessions` link and before `#danger` (matches the existing ordering: identity/security tabs first, danger zone last).
   - A new `<div class="page" id="tab-connections">` panel, placed after the `tab-sessions` panel, containing: a heading and one-line description ("Chats paired with your agents, and X accounts connected for memory seeding" or similar, matching the tone of the `connected-accounts` panel's description), a `data-slot="links-list"` container for paired chats (platform, chat title, paired agent, notify toggle, an "Unpair" button), a `data-slot="issue"` section with a button that calls `POST {action:'issue'}` and displays the returned pairing code plus the bot usernames from the `GET` response's `bots` field (so a user who lands on the page without a code can still start a pairing from here), and a `data-slot="redeem"` section that is only shown/used when the page loads with a `code` in the query string (see step 7).
   - Implement `loadConnections()` (mirroring `loadConnectedAccounts()`'s shape: fetch, render, wire button handlers with `fetch(..., {credentials:'include'})` and the existing CSRF/toast helpers already used elsewhere in this file) that calls `GET /api/gateway/connections` and renders the `links`, `agents`, and `bots` arrays into the panel.
   - Wire `PATCH` for the notify toggle and `DELETE` for the "Unpair" button on each row, following the same optimistic-update-plus-toast pattern `renderConnectedApps()` uses for its "Revoke" button (read that function in `src/dashboard-next/pages/settings.js` lines 572-626 for the pattern; it is a sibling page, not this one, but the fetch/toast/confirm idiom is the same project-wide convention).
   - Add `if (tab === 'connections') loadConnections();` inside `navigate(tab)` alongside the existing `if (tab === 'sessions') ...` and `if (tab === 'connected-accounts') ...` lines.
7. Fix the tab-resolution collision this uncovers: the X-connect flow's `target === 'agent'` branch (`api/auth/x/[action].js` line 181) returns to `` `/settings/connections?${q}#x` ``, where `#x` is an outcome marker, not a tab name. Once `/settings/connections` serves the SPA, the init IIFE's existing priority (`?tab=` then `location.hash` then `'profile'`) would try to `navigate('x')`, find no `#tab-x` element, and leave the page blank. Fix this by adding a pathname check ahead of the hash check: if `location.pathname === '/settings/connections'` (or starts with it), resolve the starting tab as `'connections'` regardless of any trailing hash, and read `_urlP.get('x')` inside `loadConnections()` to show the appropriate X-connect outcome toast (reuse the existing outcome-to-message mapping style already used for Telegram outcomes at lines 309-324, or inline a small equivalent map for the `x` outcomes this endpoint sends: `linked`, `already_linked`, `failed`, etc, matching whatever `api/auth/x/[action].js` actually emits as `outcome` values, confirm by reading that file's `outcome` assignments). Also read `code` and `agent` query params the same way, for the bot-pairing and agent-prefill flows respectively.
8. Confirm the three message-copy call sites do not need text changes now that the page is real: re-read `src/dashboard-next/pages/settings.js` lines 720, 784, 792, `api/_lib/gateway/core.js`'s `pairingPrompt()`, and `api/_lib/gateway/commands.js`'s help text. All of them already say exactly `/settings/connections` (with `pairingPrompt` additionally appending `?code=${code}`); once the route and page exist, these become correct as written and need no edits. State this explicitly in your report rather than silently skipping it.
9. Update `docs/ux-flows/11-account-dashboard.md` line 167: remove the clause "but no page is served at that path yet, so pairing currently happens through the gateway API and the bot's `/link <code>` command" (now false) and replace it with a short accurate statement that `/settings/connections` now serves the pairing UI directly.
10. Run `npm run check:rules -- --paths vercel.json public/settings/index.html tests/settings-connections-route.test.js docs/ux-flows/11-account-dashboard.md` and fix anything it flags.
11. Add a `data/changelog.json` entry (tag `fix` or `feature`, whichever the existing convention uses for a previously-404ing settings surface, link `/settings/connections`) describing that chat pairing and X-connect returns now land on a working page, then run `npm run build:pages` and confirm only the expected generated files change.
12. Read the full diff (`git diff vercel.json public/settings/index.html tests/settings-connections-route.test.js docs/ux-flows/11-account-dashboard.md data/changelog.json`) and confirm every changed line is one of the changes above.

## Done when

- `tests/settings-connections-route.test.js` exists, asserts the `/settings/(.*)` rule's `dest` is `"/settings/index.html"`, and is confirmed to have failed against the pre-fix `"/settings/$1"` value before the fix landed.
- `curl -s -o /dev/null -w "%{http_code}" https://three.ws/settings/connections` cannot be tested against production from this session (no deploy), but `vercel.json`'s rule change is verified by the passing test above, and `server/index.mjs`'s route-table loader (confirmed it reads `vercel.json`'s `routes` array at boot) needs no separate change.
- `public/settings/index.html` has a `data-tab="connections"` nav link, a `id="tab-connections"` panel, and a `loadConnections()` function that calls `GET /api/gateway/connections` and wires issue/redeem/patch/delete against the real endpoint (no mock data).
- The pathname-based tab resolution added in step 7 is present and the `#x`/`code`/`agent` query params are read inside the `connections` tab's load path.
- `docs/ux-flows/11-account-dashboard.md` line 167's stale "no page is served" clause is gone.
- `npm run check:rules -- --paths vercel.json public/settings/index.html tests/settings-connections-route.test.js docs/ux-flows/11-account-dashboard.md` reports no violations.
- A changelog entry exists and `npm run build:pages` ran cleanly.
- `npx vitest run tests/settings-connections-route.test.js` passes.

## Never blocked

| Apparent blocker | Resolution |
| --- | --- |
| "Should this live at `/settings/connections` (a path) or as a `#connections` hash tab, since the rest of this SPA is hash-routed?" | Both: fix the route so the path resolves to the SPA shell (step 4), and make the SPA's own tab router recognize that path (step 7). Every existing hardcoded reference uses the full path, so the path must work; the hash-tab mechanism is this page's existing internal routing convention, so the tab must also exist in it. Do not invent a third convention. |
| "Should per-API-key overrides, or a UI for `PATCH default_agent_id`, be in scope?" | `default_agent_id` PATCH: yes, it is a one-line addition to the row's edit affordance and the API already supports it. Per-API-key chat-pairing overrides: out of scope, not referenced by any of the four call sites this order fixes; chat pairing is inherently account-wide (a chat is paired with the account, then assigned a default agent), unlike the MCP tool-policy per-key overrides in a separate system. |
| "The `#x` outcome vocabulary in `api/auth/x/[action].js` might not match what I guess." | Do not guess. Read the file's actual `outcome` literal assignments (`grep -n "outcome:" api/auth/x/\[action\].js` or equivalent) and use those exact strings. |
| "This duplicates order 438/439/442/443/453/454." | No. Checked: none of those orders mention `/settings/connections`, `gateway/connections`, or the X-connect return-URL branches. This is a distinct, previously unfiled defect. |

## Report format

State: the vercel.json line changed (before/after `dest` value), the test file added and its pass/fail-then-pass sequence, which tabs/panels were added to `public/settings/index.html` with line ranges, the docs line fixed, the changelog entry, and the commit hash. Note explicitly that step 8's three message-copy sites needed no text changes (already correct once the route works).
