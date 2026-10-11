# 02. Market pages and share cards

Read `docs/prompts/event-markets/README.md` first.

## The problem

A market nobody can see or share does not spread. The shareable artifact is the board: the entrants, their odds, the clock, and a one-tap way to make your own call.

## Build

Check for the contract in `api/_lib/event-markets/` and the reads in `api/event-markets.js`. If absent, create the minimal seam from the README first.

1. `/event-markets`: browse page. Live, closing soon, resolved. Filters by source kind. Search. Skeleton loading, designed empty state (tells you events open markets automatically and links to the events list), designed error state with retry.
2. `/event-markets/:slug`: market detail. Entrant cards with image, label, link to the agent, project or wallet profile, implied odds bar, and your pick state. Odds-over-time chart (follow the `dataviz` skill). Countdown to lock. Plain-language resolution rule. After resolution: winner banner, who called it, your result.
3. Pick flow: choose an outcome, confirm, see odds update without a reload. Signed-out users see the market fully and are prompted to sign in only at the pick action. Keyboard and screen-reader complete.
4. Share card: `api/event-market-og.js`, an SVG 1200x630 rendered from live data, modeled on `api/arena-og.js` (read it first and match its approach). The card shows the question, the top entrants with odds, and time left. A per-entrant variant highlights one entrant ("pick Name to win"). Set OG and Twitter meta on the market page to it.
5. Share actions: copy link, post intent for X with the card, and a "challenge a friend" link that opens the market with the sharer's pick shown.
6. Entry points: link from the nav, from every event page that has a market (the Arena tournament page, the `/play` event page, launch cohort pages), and from the home page when any market is live.

## Docs and wiring

Both pages in `data/pages.json`, `docs/event-markets.md` section on the pages, `STRUCTURE.md` rows, changelog entry tagged `feature`, `npm run build:pages`.

## Acceptance

- Exercised in a real browser at phone and desktop width, no console errors, real API calls in the network tab.
- Pasting a market URL into a card validator shows the live card with current odds.
- Every state (loading, empty, error, populated, 1 entrant, 50 entrants, very long labels) renders correctly.
