# Token in 3D, as an embed

> **Audience:** Developers at a chart terminal, launchpad, wallet, or token page who want a live 3D view of a market beside their own data. Also the three.ws side, for how the pair-to-mint bridge works.

[`/coin3d`](https://three.ws/coin3d) renders any Solana token as a live 3D scene: a coin medallion carrying the token's logo, its top holders as a galaxy sized by balance, a graduation ring tracking bonding-curve progress, and a tape of real swaps as they land. Every number in it is read from chain and from live market sources.

It is also framable anywhere, keyed by **either** identifier you already have:

```html
<!-- by mint, if your page knows the token -->
<iframe src="https://three.ws/coin3d?mint=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&embed=1"
        width="420" height="560" style="border:0" loading="lazy"
        title="$THREE in 3D"></iframe>

<!-- by pair, if your page knows the market -->
<iframe src="https://three.ws/coin3d?pair=CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa&embed=1"
        width="420" height="560" style="border:0" loading="lazy"
        title="three / SOL in 3D"></iframe>
```

No key, no account, no registration. Both snippets above render the same live scene.

---

## Why `pair` exists

A chart terminal does not think in mints. It thinks in markets, and it names a market by the **pair address**: the on-chain pool account. DEXTools, DexScreener and GeckoTerminal all key their own widgets that way, so the identifier sitting in a pair page's URL is a pool, not a token.

three.ws keys everything by mint. Requiring a partner to resolve mint-from-pool before it can embed anything is a real integration cost, and it is a lookup we already do in the other direction, so `?pair=` accepts the pool and resolves it here.

The resolution is [`GET /api/coin/pair`](./api-reference.md#pair-resolution-pool-address-to-token), which is public and usable on its own:

```bash
curl -s 'https://three.ws/api/coin/pair?address=CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa'
```

```json
{
  "network": "solana",
  "pair": "CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa",
  "token": { "address": "FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump", "name": "three.ws", "symbol": "three" },
  "quote": { "address": "So11111111111111111111111111111111111111112", "name": "Wrapped SOL", "symbol": "SOL" },
  "dex": "meteora",
  "pairName": "three / SOL"
}
```

GeckoTerminal answers first and DexScreener covers a pair GeckoTerminal has not indexed, which is every pair for its first few minutes. That matters for a launchpad: the window where a coin is most looked at is exactly the window the primary index is still empty for.

`/coin3d` itself renders Solana tokens, so the embed resolves pairs on Solana. The endpoint behind it serves the eight networks `/api/coin/pool` serves.

---

## Parameters

| Parameter | Value | Effect |
|---|---|---|
| `mint` | Solana mint address | Renders that token. Takes precedence over `pair`. |
| `pair` | Solana pool/pair address | Resolves to the token that pool trades, then renders it. |
| `embed` | `1` | Embed chrome: drops the orbit hint and the locale control the host page owns, adds one attribution link back to the full scene, and sends every outbound link to a new tab instead of navigating your frame. |
| `network` | `devnet` | Reads bonding-curve state from devnet. Omit for mainnet. |

With neither `mint` nor `pair`, an `embed=1` frame renders a designed "no token selected" panel rather than the standalone page's search-and-browse landing, which is the wrong thing to put inside someone else's panel.

---

## Sizing and behaviour

- **Minimum useful size is about 320x420.** The data HUD reflows down to 320px wide; below that the scene is the only thing worth showing.
- **The scene degrades, it does not fail.** Where WebGL is unavailable (old device, disabled, lost context) the canvas is dropped and the HUD, sparkline and live trade tape keep working as a data view.
- **Sources fail independently.** Holder scan, oracle conviction, market figures and coin intel each load after first paint and fill in when they land; a slow one never holds the frame on a spinner.
- **`loading="lazy"` is safe.** The embed's own load watchdog only starts its clock once the frame is actually on screen.

Every failure mode has a designed state inside the frame: an unresolvable pair says so and offers a way out, a malformed address says what was wrong with it, and a token no source knows says that rather than drawing an empty scene.

---

## Knowing when the scene is up

An embed on your own origin is cross-origin to three.ws, so your page cannot read into the frame. In embed mode the frame posts its ready event out instead:

```js
window.addEventListener('message', (e) => {
  if (e.origin !== 'https://three.ws') return;
  if (e.data?.source !== 'three.ws/coin3d') return;
  const { token, sceneOk } = e.data;   // token: { mint, name, symbol }
  // sceneOk is false when WebGL was unavailable and the frame fell back to
  // its data view, so a host that wants to hide its 3D panel in that case can.
});
```

The message fires once, after the token resolves and the scene is built. It carries the resolved mint, which is useful when you embedded by `pair` and want the token identity your own page did not have.

A **same-origin** host (three.ws pages embedding their own scene) can also listen for the `coin3d:ready` DOM event on the frame's window and read `frame.contentWindow.__coin3d` for the live `renderer`, `scene`, `camera` and `controls`. Neither is reachable cross-origin.

---

## Attribution

Embed mode renders one small "3D by three.ws" link in the bottom-right corner, opening the full scene for that token in a new tab. It is the only chrome the embed adds. Leave it in place.

---

## Related

- [Token in 3D](https://three.ws/coin3d): the standalone page.
- [API reference: pair resolution](./api-reference.md#pair-resolution-pool-address-to-token) and [pool resolution](./api-reference.md#on-chain-pool-resolution): the two directions of the same lookup.
- [Coin pages](./coin-pages.md): the chart terminals three.ws embeds in the other direction, on `/coin/:id` and `/launches/:mint`.
- [Share & embed](./share-and-embed.md), [Embedding guide](./embedding.md): embedding agents and avatars rather than markets.
