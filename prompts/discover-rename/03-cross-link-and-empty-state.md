---
name: Cross-link Discover ↔ My Agents and refine empty states
depends_on: 02-rebrand-explore-as-discover.md
---

# Goal

After tasks 01 and 02, the two pages exist with clear separate purposes but don't reference each other. Add the natural cross-links so a user on one page can find the other, and refine empty-state copy so the relationship between the two is obvious.

# Success criteria

1. **From `/discover` (community)**, when the user is signed in, a chip / secondary CTA reads **"View my agents →"** and links to `/my-agents`. When unsigned, the chip is hidden (don't tease an auth-walled page).
2. **From `/my-agents`**, the empty state ("No wallets linked") gains a secondary link below the primary "Link a wallet" button: **"Or browse community agents →"** linking to `/discover`.
3. **From `/my-agents`**, when the user *has* linked wallets but the result list is empty (no agents found), surface an inline message: "No agents found in your linked wallets yet. [Browse the community directory →](/discover)".
4. Auth detection uses the existing client-side mechanism — do not add a new auth check pattern. Find how `index.html` decides to show `#discoverLink` and reuse that.

# Steps

1. **Identify the auth-detection pattern** used in `index.html` for the nav link. Likely a fetch to `/api/auth/me` or a session cookie check. Document the function/module and reuse it.

2. **`/discover` (community page) — add "View my agents" chip:**
   - Add chip markup in `public/discover/index.html`, near the "ERC-8004 Agent Directory" chip. Hidden by default (`hidden` attribute).
   - In `public/discover/discover.js`, on page load, run the auth check. If authed, unhide the chip.
   - Style: reuse the existing `.explore-hero-chip` (now `.discover-hero-chip` if classes were renamed in 02 — they shouldn't have been; if not, leave class name and add a TODO).

3. **`/my-agents` — empty-state secondary link:**
   - In `public/my-agents/my-agents.js`, locate the no-wallets-linked render block. Below the "Link a wallet" `<a>` button, add a smaller secondary link: `<a class="my-agents-secondary" href="/discover">Or browse community agents →</a>`.
   - Add a CSS rule for `.my-agents-secondary` in `public/my-agents/my-agents.css`: smaller font, muted color, top margin. Match existing muted-text tokens — don't introduce new colors.

4. **`/my-agents` — empty-results inline message:**
   - In the render path that fires when `wallets.length > 0 && agents.length === 0`, render: "No agents found in your linked wallets yet." with a follow-up link to `/discover`.
   - If this branch doesn't currently exist (e.g., the page silently renders an empty grid), add it.

5. **Copy review.** Read every user-visible string on both pages end-to-end. Fix any remaining "Explore"/"discover" verb confusion introduced by tasks 01–02.

# Verification

Manual click-through:
- Logged out: visit `/discover` → no "View my agents" chip. Visit `/my-agents` → empty state shows "Link a wallet" + "Or browse community agents →" link, both work.
- Logged in, no wallets: same as above plus "View my agents" chip on `/discover`.
- Logged in, wallets linked, no agents: `/my-agents` shows the new "no agents found" inline message with the `/discover` link.
- Logged in, wallets linked, has agents: `/my-agents` renders the agent grid as before; no empty-state text leaks in.

# Out of scope

- Adding a community-search filter for "agents owned by my wallets" on `/discover` (would duplicate `/my-agents`).
- Persistent header nav redesign — nav stays as updated in tasks 01 and 02.
