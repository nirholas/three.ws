# 01-02 — Wallet connection indicator in nav

**Pillar 1 — Wallet auth.**

## Why it matters

Once a user signs in with a wallet, nothing on the page tells them they did. No chip, no address, no disconnect button. Users have reported signing in twice because they couldn't tell the first attempt worked. This is cheap to fix and unlocks trust for every higher-layer flow.

## What to build

A small **WalletChip** component rendered in the top-right of every authenticated page ([public/dashboard/](../../public/dashboard/), `/studio`, `/agent/:id` when owner, `/widgets-gallery` when signed in).

- **Signed in (wallet):** circular blockie/jazzicon (16-char seed → hsl gradient — no deps; use address hash) + short addr `0x1234…abcd` + chevron.
- **Signed in (email):** same chip shape, initials instead of blockie, no address.
- **Signed out:** "Sign in" link, no chip.
- **Menu on click:** full address with copy button, "My agents", "My avatars", "Sign out". On mobile, a bottom-sheet drawer.

Source of truth: `GET /api/auth/me` on page load + local cache invalidated on 401.

## Read these first

| File | Why |
|:---|:---|
| [api/auth/me.js](../../api/auth/me.js) | Shape of the `user` object — `{ id, email, display_name, plan, avatar_url }`. Note there is NO `wallet_address` field on the returned user today. |
| [api/_lib/auth.js](../../api/_lib/auth.js) | `getSessionUser` — source SQL. You may need to join `user_wallets` here so `/api/auth/me` returns the primary wallet. |
| [public/dashboard/dashboard.js](../../public/dashboard/dashboard.js) | Native DOM pattern to follow. |
| [public/wallet-login.js](../../public/wallet-login.js) | Wallet flow — nothing to change here, but learn what a wallet-created user's `email` looks like (`wallet-0x..@wallet.local`) so you can hide that ugly string. |
| [style.css](../../style.css) | Token palette — use `--accent`, `--bg-elevated`, etc. Don't introduce new colors. |

## Build this

### 1. Backend

Extend [api/auth/me.js](../../api/auth/me.js) to include the primary wallet:

```js
// Inside handler, after getSessionUser:
const wallets = await sql`
  select address, chain_id from user_wallets
  where user_id = ${user.id} and is_primary = true limit 1
`;
user.wallet = wallets[0] ? { address: wallets[0].address, chain_id: wallets[0].chain_id } : null;
```

Keep the response shape as `{ user }` — additive only.

### 2. Client component

Create `src/components/wallet-chip.js` (plain JS, renders a DOM subtree — follow dashboard patterns, NOT a framework component).

```js
export function mountWalletChip(containerEl, { user, onSignOut }) { ... }
```

Blockie: 8 colored cells from a hash of the address rendered as a 4x4 CSS grid (no canvas, no deps).

Short address: `${addr.slice(0,6)}…${addr.slice(-4)}`.

Menu: absolute-positioned popover. Close on outside click, Esc, or selection.

### 3. Mount on every page

Add a script tag + chip mount to:
- [public/dashboard/index.html](../../public/dashboard/) — top-right, replacing whatever's there.
- `public/studio/index.html` (if it exists from the widget-studio prompts — if not, skip).
- [public/agent/index.html](../../public/agent/index.html) — top-right.
- [public/widgets-gallery/index.html](../../public/widgets-gallery/index.html) — top-right.

Do not modify the landing page [index.html](../../index.html) — it has its own header.

### 4. Sign out

`POST /api/auth/logout` already exists. The menu's "Sign out" calls it, then `location.reload()`.

## Out of scope

- Do not add account settings pages.
- Do not add ENS resolution (even though it would look nice — add it behind a separate prompt).
- Do not add chain-id display (chain switcher is `01-04`).
- Do not touch the landing page nav.

## Deliverables

**New:**
- `src/components/wallet-chip.js`

**Modified:**
- [api/auth/me.js](../../api/auth/me.js) — include `wallet` on user.
- [public/dashboard/index.html](../../public/dashboard/) — mount chip.
- [public/agent/index.html](../../public/agent/index.html) — mount chip.
- [public/widgets-gallery/index.html](../../public/widgets-gallery/index.html) — mount chip.
- [style.css](../../style.css) — chip + menu styles (add a small `.wallet-chip` block).

## Acceptance

- [ ] Signed-in wallet user sees a chip with their short address in the top-right of every authenticated page.
- [ ] Clicking the chip opens a menu with full address + copy + sign out.
- [ ] Clicking "Sign out" signs them out and reloads → "Sign in" link appears.
- [ ] Email-auth user sees initials chip (no address).
- [ ] Signed-out user sees "Sign in" link.
- [ ] Mobile (375px): menu renders as a bottom sheet, not a broken popover.
- [ ] `npm run build` passes.

## Test plan

1. Sign in with wallet → chip shows on dashboard, agent page, gallery.
2. Copy button in menu → address is on clipboard.
3. Sign out from menu → redirected to signed-out state.
4. Sign in with email on a different account → chip shows initials.
5. Resize to 375px — menu opens as bottom sheet with scrim.
