# 04 — On-Chain Discover Page (Hydrate Wire-Up)

## Context

Users sign in with their wallet. Behind that wallet, they may already own ERC-8004 agent NFTs that they've registered or acquired elsewhere — the product should *find* those agents and pull them into the user's library automatically. The backend endpoint `/api/erc8004/hydrate` already enumerates on-chain agents for any linked wallet; the client helper `src/erc8004/hydrate.js` wraps both `fetchDiscoveredAgents()` and `importAgent()`.

**The UI that uses these helpers does not exist.** The module is an orphan.

Your job: build a polished standalone `/discover` page that shows the signed-in user every on-chain agent they own across chains, lets them import any into the app with a click, and gracefully handles empty/error states.

## Goal

A `/discover` route that, for a signed-in user:
- Lists every agent discovered via their linked wallets across all supported chains.
- Flags ones already imported vs. importable.
- One-click imports an agent into the user's library (calls `importAgent()`).
- Shows a visual preview (thumbnail + name) for each agent.
- Handles zero linked wallets, zero discovered agents, network errors, and rate limits.

This page is how a new wallet-first user gets their existing agents into the app on first sign-in — without it, they see an empty dashboard and churn.

## Files you own

Create:
- `public/discover/index.html`
- `public/discover/discover.js`
- `public/discover/discover.css`

Edit (inside uniquely-named anchor only):
- `index.html` — add anchor block `<!-- BEGIN:DISCOVER_LINK --> ... <!-- END:DISCOVER_LINK -->` on the homepage. Inside: a single CTA link/button that routes to `/discover` (visible only when signed in — use a JS gate inside the anchor, or a CSS class toggled by existing session code). **No edits outside the anchor.**

Also ensure `/discover` resolves:
- Check [vite.config.js](../../vite.config.js) `vercel-rewrites` plugin and [vercel.json](../../vercel.json). The rewrite rules may already match `public/**` → add an entry if `/discover` does not resolve to `public/discover/index.html`. If you need to add a single line to either file, do so inside a `BEGIN:DISCOVER_ROUTE` anchor in that file. Otherwise leave both untouched.

## Files read-only

- `src/erc8004/hydrate.js` — the client helper. API: `fetchDiscoveredAgents()` and `importAgent({ chainId, agentId })`.
- `api/erc8004/hydrate.js` — learn the response shape returned to the client.
- `api/erc8004/import.js` — learn the import side-effects.
- `src/wallet-auth.js` — session helpers for detecting signed-in state.
- `src/erc8004/chain-meta.js` — chain name + explorer URL helpers for display.
- `api/_lib/auth.js` — understand what `credentials: 'include'` gets you.
- `public/dashboard/` — style reference; match the existing look-and-feel.

## UX requirements

**Page layout:**
- Header with title `On-chain Agents`, subtitle `Agents we found in your linked wallets`.
- Link back to homepage + link to dashboard.
- Grid of agent cards (1 col mobile, 2 col tablet, 3 col desktop).
- Each card: square thumbnail (glbUrl preview fallback to `image`), name, chain pill, short description, action button (`Import` or `Already in library`).
- Empty states:
  - Not signed in → page renders a single CTA `Sign in to discover your agents` → `/login.html`.
  - Signed in, no linked wallets → CTA `Link a wallet to get started` → `/dashboard/wallets.html`.
  - Signed in, wallets linked, zero agents → friendly illustration/text `No on-chain agents yet — register one from the dashboard`.
- Error states:
  - Network error → inline error with a retry button.
  - Rate-limited (429) → explicit `Too many requests. Try again in a minute.`
- Loading state: skeleton cards with shimmer animation (CSS only, no JS animation).

**Import flow:**
- Click `Import` → button enters busy state, disables, fetches `importAgent(...)` via `src/erc8004/hydrate.js`.
- On success: card flips state to `Already in library` + shows a link to `/agent/<new-id>`.
- On failure: revert button state, inline error under card.
- Imports are independent — one failing does not block others.

**Visuals:**
- Reuse the CSS tokens / design language of `public/dashboard/` (fonts, spacing, colors). Pull class names from an existing dashboard subpage and mirror them. Do not import the dashboard's CSS file; copy only the tokens you need into `discover.css`.
- All styling scoped via BEM or a single `.discover-*` prefix to avoid leakage.

## Technical requirements

- ESM only. `<script type="module">` in the HTML.
- No bundler magic — this is a plain static page that imports `src/erc8004/hydrate.js` directly via a `/@/src/erc8004/hydrate.js` or similar Vite-friendly path OR via a fetch-at-build bundled copy. Whatever resolves cleanly with the existing Vite setup. Check how other `public/*/` subpages do it.
- Session check: use whatever `src/wallet-auth.js` exposes (e.g. `getCurrentUser()`). If no helper exists for client-side session detection, call `fetch('/api/auth/me', { credentials: 'include' })` and gate on `res.ok`.
- Accessibility: every button `aria-label`ed, card images with `alt`, keyboard navigable grid (arrow keys optional; tab navigation required).
- No external CDN dependencies. No new npm deps.

## Homepage CTA gating

Inside the `DISCOVER_LINK` anchor on `index.html`:

```html
<!-- BEGIN:DISCOVER_LINK -->
<a href="/discover" id="discoverLink" class="discover-cta" hidden>
    Find my on-chain agents →
</a>
<script type="module">
    // Reveal when signed in. Non-blocking — failures stay hidden.
    fetch('/api/auth/me', { credentials: 'include' })
        .then((r) => r.ok && (document.getElementById('discoverLink').hidden = false))
        .catch(() => {});
</script>
<!-- END:DISCOVER_LINK -->
```

(Or cleaner: move that logic into `public/discover/` and just render the link unconditionally on the homepage — pick whichever keeps `index.html` tidier.)

## Deliverables checklist

- [ ] `public/discover/index.html` created, semantic HTML, valid HTML5.
- [ ] `public/discover/discover.js` created, ESM, ~150–300 LOC, JSDoc typed.
- [ ] `public/discover/discover.css` created, scoped class names, ~100–250 LOC.
- [ ] Empty/loading/error/success states all implemented.
- [ ] `fetchDiscoveredAgents()` and `importAgent()` wired correctly.
- [ ] Route resolves at `/discover` in dev (`npm run dev` → http://localhost:3000/discover).
- [ ] Homepage CTA block added, gated by session.
- [ ] Mobile layout at 360px width looks good.
- [ ] Prettier pass on all touched files.
- [ ] No new runtime deps.

## Acceptance

- `node --check` passes on `discover.js`.
- `npm run build` succeeds; the built artifact includes the new page.
- Manual: in dev with a signed-in user, visit `/discover`, confirm cards render (or an accurate empty state).
- Manual: sign out, revisit → sign-in CTA shown, no call to `/api/erc8004/hydrate` fires (check Network tab).
- `git grep -n "DISCOVER_LINK" index.html` shows exactly one BEGIN/END pair.

## Report + archive

Post the report block from `00-README.md`, then:

```bash
git mv prompts/final-integration/04-discover-page.md prompts/archive/final-integration/04-discover-page.md
```

Commit: `feat(discover): on-chain agent discovery page`.
