# DEXTools integration

> **Audience:** Project teams who want their community on their DEXTools pair page, developers at DEXTools or any chart terminal who want three.ws surfaces next to a pair, and three.ws contributors adding a DEXTools link to a new surface.

three.ws and DEXTools connect in both directions. DEXTools charts run inside three.ws, three.ws renders any DEXTools pair as a live 3D scene, and three.ws sends its visitors to DEXTools pair pages, where every visit counts toward DEXTools Social Boost. Everything is collected on one page, [/dextools](https://three.ws/dextools), with live traffic numbers and an embed builder.

---

## The hub: /dextools

[/dextools](https://three.ws/dextools) has four live sections:

1. **$THREE both ways.** DEXTools' own chart widget for the three / SOL pair beside the `/coin3d` 3D scene addressed by the same pair.
2. **Visits three.ws sends to DEXTools.** Totals from [`/api/coin/dextools-stats`](./api-reference.md#dextools-visit-totals) over 7, 30 or 90 days: per day, per sending surface and per coin.
3. **Embed any DEXTools pair.** Paste a link, get a live preview and an iframe snippet (below).
4. **Social Boost, already won.** The $THREE wins with their receipts, from the same record [/three-token](https://three.ws/three-token) renders ([src/pump/dextools-social-boost.js](../src/pump/dextools-social-boost.js)).

The page deep-links: `/dextools?q=<link or address>` (also `?mint=` or `?pair=`) opens the builder already resolved, so a snippet can be shared with a teammate.

---

## The embed builder

The builder accepts whatever a person copied:

| Pasted | Read as |
|---|---|
| `dextools.io/app/[en/]solana/pair-explorer/<pair>` | pair |
| `geckoterminal.com/solana/pools/<pair>` | pair |
| `pump.fun/coin/<mint>`, `birdeye.so/token/<mint>` | mint |
| `dexscreener.com/solana/<address>`, a bare address | either, resolved below |
| `three.ws/coin3d?pair=` or `?mint=`, `three.ws/launches/<mint>` | as named |

On Solana a pool account and a mint look identical, so an ambiguous address is checked against [`/api/coin/pair`](./api-reference.md#pair-resolution-pool-address-to-token): if a market index knows it as a pair, it is a pair, otherwise it is the token. Either way the builder ends with both the mint and, when one is indexed, the pair. A DEXTools pair on another chain is refused with a reason, because both embeds render Solana tokens. The parser is [src/dextools-input.js](../src/dextools-input.js), covered by [tests/dextools-input.test.js](../tests/dextools-input.test.js).

It produces one of two snippets.

**The 3D scene**, keyed by pair when one is known (that is the identifier a DEXTools page already holds):

```html
<iframe src="https://three.ws/coin3d?pair=CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa&amp;embed=1"
        width="420" height="560" style="border:0" loading="lazy"
        title="Token in 3D by three.ws"></iframe>
```

Parameters, sizing and the ready event are in [Token in 3D, as an embed](./coin3d-embed.md).

**The Boost on DEXTools card**, below.

---

## Boost on DEXTools card: /embed/dextools-boost

A small framable card that sends a token's community to its DEXTools pair page. Social Boost ranks coins by visits to that page and buys the daily and weekly winners on the open market, so a project that puts this card on its own site turns its site traffic into Social Boost visits.

```html
<iframe src="https://three.ws/embed/dextools-boost?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump"
        width="380" height="460" style="border:0" loading="lazy"
        title="Boost on DEXTools"></iframe>
```

| Parameter | Value | Effect |
|---|---|---|
| `mint` | Solana token address | The token. Takes precedence over `pair`. |
| `pair` | Solana pair address | The pair from a DEXTools URL, resolved to its token through `/api/coin/pair`. |
| `theme` | `light` | Light card. Omit for dark. The host picks the theme, never the viewer's three.ws setting. |

The card shows the token's logo, name, price and 24h change (from DexScreener's keyless API; the card still works if that is unavailable), then the shared Social Boost card: open the DEXTools page, post a ready-made rally to X, or copy the link. When three.ws has already sent visits to that coin's DEXTools page in the last 30 days, the count is shown.

Every DEXTools link in the card goes through the counted `/api/coin/dextools` redirect tagged `from=embed-boost`, so visits from embeds are attributed. Every link opens in a new tab; nothing navigates the host's frame. A missing, malformed or unindexed address renders a designed message inside the frame instead of an empty box.

When the card is ready it posts one message to the host page:

```js
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://three.ws') return;
  if (e.data?.source !== 'three.ws/dextools-boost') return;
  const { mint, name, symbol } = e.data.token;
});
```

The page is [pages/dextools-boost-embed.html](../pages/dextools-boost-embed.html) with [src/dextools-boost-embed.js](../src/dextools-boost-embed.js). The card inside it is the one component every three.ws surface mounts, `socialBoostCard()` in [src/shared/dextools-boost.js](../src/shared/dextools-boost.js); see [Listings: DEXTools](./listings.md#dextools) for how to mount it on a three.ws page.

---

## Counting visits

Every DEXTools link on three.ws, and in three.ws embeds, goes through one redirect:

```
GET /api/coin/dextools?address=<token>&network=solana&from=<surface>
```

It resolves the coin's most-liquid pool, redirects to that pair page, and adds one to the day's total for that coin and that `from` surface in `dextools_referrals`. Only aggregate counts are stored: no IP, session or account. Build these links with `dextoolsTokenUrl(token, { from })` from [src/shared/trading-terminals.js](../src/shared/trading-terminals.js) and give each new surface its own short kebab-case `from` tag, so the totals say where traffic came from.

The totals are public at [`GET /api/coin/dextools-stats`](./api-reference.md#dextools-visit-totals), which is what the hub charts. A project can check its own coin with `?token=<mint>`.

---

## Related

- [Listings: DEXTools](./listings.md#dextools): every surface that links DEXTools, and the Social Boost record.
- [Coin pages](./coin-pages.md): DEXTools as a chart source in the switcher.
- [Token in 3D, as an embed](./coin3d-embed.md): the 3D scene, by mint or by pair.
- [The DEXTools partnership proposal](./partners/dextools-proposal.md).
