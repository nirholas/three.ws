# Seasonal drops: free gifts you claim once and keep forever

A seasonal drop is a short list of gifts that any signed-in account can claim
inside one fixed window. After the window closes, nothing new is ever granted.
Accounts that claimed in time keep everything permanently. The gifts are never
sold.

The first drop is **Halloween Weekend 2026** (`halloween-2026`). Its claim page
is [three.ws/halloween](https://three.ws/halloween), and the same weekend also
themes the web desktop, the classic homepage and `/play`.

## Halloween Weekend 2026

| | |
| --- | --- |
| Window | `2026-10-30T10:00:00Z` to `2026-11-02T12:00:00Z`: Saturday 00:00 in the earliest timezone (UTC+14) to Sunday 24:00 in the latest (UTC-12), so the whole weekend counts wherever the visitor lives. |
| Pumpkin Cap | `pumpkin-cap-halloween-2026`: an event-tier headwear item with a real GLB (`public/accessories/pumpkin-cap-halloween-2026.glb`), wearable in every `/play` world. |
| Witchlight Aura | `aura-witchlight-halloween-2026`: an event-tier aura (`#ff7a1a`). |
| Halloween 2026 badge | a `user_badges` row (`BADGES.HALLOWEEN_2026`), shown on the public profile. |
| Haunted wallpaper | the desktop wallpaper `haunted` (`public/wallpapers/haunted.svg`). Claimers keep it in desktop Settings after the weekend. |

## Where you can claim

All four claim surfaces call the same endpoint, and the server alone decides
whether a claim lands.

- **`/halloween`**: the full page ([pages/halloween.html](../pages/halloween.html),
  [src/halloween/page.js](../src/halloween/page.js),
  [src/halloween/halloween.css](../src/halloween/halloween.css)). It shows a
  live countdown on the server's clock, the four gifts (the cap as a rotating
  3D model), and a claim panel for each state: signed out, ready, claimed,
  still syncing, upcoming, ended and error. When a phase boundary passes, the
  page re-reads the drop without a reload.
- **The desktop**: the Halloween Gifts app is listed while the drop is live
  and opens `/halloween` in a desktop window.
- **The classic homepage, `/play` and Settings**: these use the shared widget
  [src/shared/gift-claim.js](../src/shared/gift-claim.js) through
  [src/home-gifts.js](../src/home-gifts.js),
  [src/game/gift-claim-play.js](../src/game/gift-claim-play.js) and the
  Settings gift card.

## API

`GET /api/seasonal/:id` returns the drop: its window, phase, server time and
gifts. It also returns a `claim` object for the viewer, which says whether
they are signed in and, if they are, whether and when they claimed.
Responses are `private, no-store`.

`POST /api/seasonal/:id` claims the drop for the session user. It is
same-site only and rate-limited per user (`limits.dropClaimUser`). Calling it
again does nothing new.

| Status | Meaning |
| --- | --- |
| 200 | Claimed. `claim.newlyClaimed` is true on the first claim. `claim.wearablesSynced` is false if the `/play` grant did not land; a repeat POST retries it. |
| 401 | Not signed in. |
| 403 | Cross-site request. |
| 409 `drop_not_open` | Before the window opens. |
| 410 `drop_closed` | After the window closes, for an account that never claimed. |
| 429 | Rate limited; honor `retry-after`. |

The handler is [api/seasonal/[id].js](../api/seasonal/%5Bid%5D.js), and the
rules live in [api/_lib/seasonal-drops.js](../api/_lib/seasonal-drops.js).
The endpoint is deliberately not under `/api/drops/`: that directory already
has `[action].js` for generative collections, and two sibling dynamic
handlers can't both be reached.
[tests/api-dynamic-route-collisions.test.js](../tests/api-dynamic-route-collisions.test.js)
now fails the build on any such collision.

## How "forever" works

- **The badge row is the claim record.** `user_badges` is unique on
  `(user_id, code)` and its rows are never deleted, so a claim needs no new
  table and no migration.
- **Wearables reach `/play` through the grant ledger.** Claiming adds the
  cosmetic ids to the Redis set `cosmetics:granted:u:<userId>`. When a player
  joins a room, the game server merges this set into their profile with
  `mergeGrantedFromLedger` (in `multiplayer/src/economy.js`). That function
  only accepts event-tier ids, so the ledger can never mint a paid item.
- **The ledger heals itself.** If Redis is unavailable during the claim, the
  badge is still written and the response reports `wearablesSynced: false`.
  Any later POST, even after the window, re-grants exactly what the badge
  proves the account owns.

## The seasonal look

While the drop is live, three surfaces dress themselves for it.

- **Desktop (`/`)**, from [src/desktop/seasonal.js](../src/desktop/seasonal.js):
  - The boot and lock screens get the night palette and Creepster headings.
  - The desktop shows the haunted wallpaper with fog, a bat flock and a
    pumpkin accent.
  - It adds the Halloween Gifts app and posts one notification.
  - `pickWall` paints the haunted wallpaper over a built-in one without
    changing the saved preference, and never paints over a personal photo.
  - After the weekend, claimers keep Haunted as a choice in Settings; for
    everyone else a saved Haunted falls back to the default.
  - A claim made in another tab reaches the desktop at once. A claim made
    in another browser is picked up by a once-a-day check, which keeps
    running until 2027-01-31.
- **Classic homepage (`/classic`)**: a self-contained IIFE in
  [public/seasonal.js](../public/seasonal.js) adds:
  - a ribbon and Creepster headings;
  - a bat and ember sky over the hero, which pauses when the hero is
    offscreen and shows a still frame under reduced motion;
  - Halloween prompt suggestions;
  - a "Trick or treat" chip that sends a flock of bats out of the hero
    avatar.
- **`/play`**: a moonlit vignette and the lobby claim card, from
  [src/game/halloween.js](../src/game/halloween.js).

### Turning the look off

Turning the look off is per browser and shared by every surface. It is the
localStorage key `twx_season_off:halloween-2026`.

- **On the desktop:** use Settings > Personalization > Season > Halloween look.
  Picking an accent, a non-seasonal wallpaper or a custom photo also turns the
  look off; a toast says so and tells you where to turn it back on.
- **On `/play`:** use the Halloween look button.

## Adding the next drop

1. **Server.** In [api/_lib/seasonal-drops.js](../api/_lib/seasonal-drops.js),
   add a frozen drop object (id, window, badge, gifts) and register it in
   `DROPS`. Add its badge to `BADGES` in `api/_lib/streaks.js`.
2. **Wearables.** Add each wearable to `multiplayer/src/cosmetics-catalog.js`
   with `tier: 'event'`. Ship the GLB and thumbnail under
   `public/accessories/`.
3. **Client mirror.** Mirror the id and window in
   [src/shared/seasonal-drops.js](../src/shared/seasonal-drops.js). If the
   classic homepage gets a look, copy the instants into the IIFE in
   `public/seasonal.js` too.
4. **Pin every copy.** Extend
   [tests/seasonal-drops.test.js](../tests/seasonal-drops.test.js) so all
   copies of the window are checked against the server, as they are for
   Halloween. If the copies drift, a page would invite claims the server then
   refuses.
5. **Deploy and route.** Deploy the API, and redeploy the multiplayer
   service so the new wearables reach `/play`. Add a page route in
   `vercel.json`, `vite.config.js` and `data/pages.json` if the drop gets its
   own page.
