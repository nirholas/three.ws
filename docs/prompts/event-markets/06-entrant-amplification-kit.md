# 06. Entrant amplification kit

Read `docs/prompts/event-markets/README.md` first.

## The problem

Each entrant has an audience that is the cheapest distribution a market can get. Today an entrant has no reason, and no easy way, to tell their followers "I am in this, call it."

## Build

Check for the contract in `api/_lib/event-markets/`. If absent, create the minimal seam from the README first.

1. Notify entrants: when a market opens with an entrant that has an account, send an in-app notification (use the existing notification system) and an email where the account has one verified. The message says they are in a market, their current odds, and links to their kit. Respect notification preferences and never notify twice per market.
2. Entrant kit page `/event-markets/:slug/kit` (visible to the entrant): the per-entrant share card, ready-made post text, a copy button for the link, a QR code, and live stats: picks on them, their odds, their rank among entrants, where picks come from.
3. Embeddable widget: a small script and web component `<event-market slug="...">` that renders the live odds board on any site, themeable, with a link back and a pick button that deep-links to the market. Follow how the `<agent-3d>` embed is packaged and documented; ship it from the same build and document it on a page with copy-paste snippets.
4. Referral credit: a share link carries a ref param. A pick made through it credits the referrer a stated number of points (defined in the points config from brief 01 if present, else in `data/`). Cap abuse: one credit per new account, ignore self-referral.
5. Entrant profile surface: show "in N live markets" on agent and project profiles with a link.
6. Opt-out: an entrant can ask not to be tagged or featured by a market in their own settings. Honor it in notifications and in the announcement drafter's tag list via a shared flag.

## Docs and wiring

`docs/event-markets.md` section "For entrants", an embed guide in `docs/`, `data/pages.json` for the kit page, `STRUCTURE.md`, changelog entry tagged `feature`.

## Acceptance

- Open a market with a real account as an entrant: the notification arrives and the kit page shows real stats.
- The widget renders on a plain HTML page served from another origin and updates live.
- A referral pick credits once; a self-referral credits nothing.
- Exercised in a real browser, no console errors, `npm test` green.
