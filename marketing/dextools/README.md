# DEXTools charts on three.ws

Announcement graphics for DEXTools charts being a selectable source on every
coin chart on three.ws.

| File | Size | Use it for |
| --- | --- | --- |
| [three-ws-dextools-charts-16x9.png](three-ws-dextools-charts-16x9.png) | 3200x1800 (16:9) | Timeline posts, blog headers, link previews |
| [three-ws-dextools-charts-1x1.png](three-ws-dextools-charts-1x1.png) | 3200x3200 (1:1) | Anywhere the crop is square: profile posts, Telegram, chat previews |

Both render from one layout, [partnership-card.html](partnership-card.html).

## Regenerating

```bash
npm run render:dextools-card
```

Edit `partnership-card.html`, run that, commit the PNGs. It is the same renderer
as the [pump.fun verified card](../pumpfun-verified/README.md)
(`scripts/render-pumpfun-verified.mjs --set=dextools`): the page is served over
HTTP and the run fails loudly if any asset 404s, so a card never ships in a
fallback font. Pass `--scale=3` for a 3x render or `--out=<dir>` to write
elsewhere.

## What is on the card

- **three.ws lockup**: `public/brand/three-ws-lockup-on-dark.png`, the standard
  on-dark lockup from the [brand kit](../brand/README.md).
- **DEXTools mark**: `public/marks/dextools-alpha.png`. It is DEXTools' own
  hexagon mark, taken from the 680px original CoinGecko serves for the project,
  with its white plate keyed out to alpha so it sits on black. The anti-aliased
  edge was un-mixed against the mark's own colour, so there is no pale halo. The
  mark's shape, proportions and gradient are untouched. The wordmark beside it
  is set in Space Grotesk 700 to match the weight of the three.ws lockup, the
  same call the pump.fun card makes, and is not an imitation of DEXTools' own
  lettering.
- **The pill**: the one-line claim, "Every coin on three.ws. Real-time charts."
- **Footer**: "DEXTools Charts, now live on three.ws" and "Powered by
  @DEXToolsApp".

Palette: `#0a0a0a` ground, `#22c3e6` accent (sampled from the DEXTools mark, the
way every house partner card takes its accent from the partner), `#1c1c1c` frame.
Type: Space Grotesk (wordmark), JetBrains Mono (eyebrow, pill, footer), all from
`public/fonts/`.

## Copy rules

The card says **charts, now live** and **powered by**. It does not say partner
or partnership: what is true today is that three.ws embeds DEXTools' published
chart widget as a selectable source on its coin charts, which is an integration
we shipped, not an agreement DEXTools signed. If the
[proposal](../../docs/partners/dextools-proposal.md) lands and DEXTools agrees to
co-announce, the eyebrow is the line to change.

The claim in the pill is checkable. The chart surfaces and the shared provider
list behind them are documented in [coin pages](../../docs/coin-pages.md).
