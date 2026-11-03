# The card gacha machine in `/play`

A red capsule vending machine stands on the west plaza of every `/play` coin world, next to the Lucky Wheel. Walk up to it and press **E** (or tap **Pull a card** on a phone). It opens a pull screen for the real [Collector Crypt](https://collectorcrypt.com) gacha. Every card in it is a professionally graded trading card. The physical card is held in a vault and the digital copy is a Solana NFT. You pay in USDC from your own wallet and the card goes to that same wallet.

The platform never holds or moves player funds. Collector Crypt builds each transaction. three.ws checks that it is exactly the payment the player was shown, the player's wallet signs it, and three.ws relays it.

## Using it

1. **Find it.** It sits at world position `(-15, 2)`, facing the plaza centre. It is lit by a marquee and a halo ring on the floor. The prompt appears within 2.2 m of the cabinet.
2. **Pick a machine.** The first screen lists every open machine, with live prices, stock and expected value (EV). Use the chips to filter by category: Pokemon, sports, One Piece and so on. Each machine shows its odds, a value range and the stock left per rarity tier. It also shows the last pulls (refreshed every 15 s) and the cards still inside, by rarity.
3. **Pull.** A confirmation table is built from the transaction the server decoded, not from the price label. It shows:
   - the amount and token (USDC);
   - the chain (Solana);
   - the recipient (Collector Crypt's treasury for that machine);
   - the paying wallet;
   - who pays the network fee (Collector Crypt does).

   Nothing is signed until you press **Sign and pull**.
4. **Watch it vend.** The machine shakes and drops a capsule while the payment confirms. The screen then polls until the card is assigned to you. That usually takes a few seconds and can take up to a minute.
5. **Reveal.** A 3D capsule appears on screen, spins faster and shakes harder while light gathers into it, then cracks open with a flash, a shockwave and a light pillar in the tier's colour. Rare and epic capsules keep their colour hidden until the last moment, and epic pulls get a second gold burst. The real graded slab spins out and settles face up. Drag it to turn it, press **Flip card** (or Enter, or double-click) to see its real back photo, and move the pointer over it to watch the holographic foil shift. **Skip** jumps straight to the settled card. The slab inside the machine's display window shows the card too. Links go to the card on Collector Crypt, the payment on the Solana explorer, and Collector Crypt's fairness verifier for that exact pack (`/verify-selection/<memo>`).
6. **Keep it or sell it back.** For 72 hours a card can be sold back to Collector Crypt for USDC at the price it quotes. That is another confirmed, wallet-signed transaction, shown first as a table: the card you send, the USDC you receive, the recipient, the chain and the buyer. **Turbo mode** (the toggle before a pull) does that automatically: the card is sold back the moment it is assigned, and the USDC is sent straight to your wallet.

7. **My cards.** The **My cards** button in the header lists every Collector Crypt card the connected wallet holds, read straight from Solana. That includes cards pulled anywhere, not only on three.ws. The top of the list shows the card count, the total insured value and how many cards can still be sold back. Cards with an open buyback offer come first and carry a **Sell** badge with the price. Open a card to inspect it on the same 3D stage, read its grade, set, year and insured value, and sell it back with the same confirmation table. When the 72 hour window has closed, the card links to Collector Crypt, where it can still be listed or the physical slab redeemed.

If WebGL is unavailable, or the browser drops the GPU context, the stage falls back to a flat flip card with the same photos. Reduced-motion settings skip the capsule sequence and the idle motion.

Closing the screen never cancels a pull in progress. The pull keeps running and a small pill in the corner reopens it. The pack memo is also saved in `localStorage` (`threews:gacha:pending`). If the tab closes after paying, reopening the machine resumes that pack instead of starting a new one.

## Why the transaction checks exist

Collector Crypt's API returns a ready-made transaction for the player to sign. three.ws refuses to put a transaction in front of a player unless it proves exactly what it does. The checks live in `inspectPackTransaction` and `inspectBuybackTransaction` in [api/_lib/collectorcrypt-gacha.js](../api/_lib/collectorcrypt-gacha.js).

A **pack payment** is only accepted when all of these hold:

- Collector Crypt's gacha wallet is the fee payer, and it has already signed.
- There are exactly two signers: the gacha wallet and the player.
- There is exactly one token movement: a `TransferChecked` of USDC (the real mint for that network) from the player to that machine's treasury.
- The amount is exactly the machine's current price in atomic units.
- There are no SOL transfers, approvals, authority changes or other token instructions.

A **buyback** is only accepted when the only thing the player gives up is the one card. Only the programs a Collector Crypt sale uses may appear at all. Within them the player may sign for:

- exactly one transfer of that card (a Metaplex Core `TransferV1` of the asset, a Token Metadata `Transfer` of the mint, or an SPL transfer of one unit out of the card's own token account);
- closing an emptied account back to themselves, or the card's account to the documented rent destination;
- at most one account's rent in SOL in total;
- a capped priority fee when the player pays the network fee.

A USDC or SOL transfer, any other NFT, a delegate approval, an authority change, a burn or an unknown program is refused. A key loaded from an address lookup table cannot be resolved by the check, so any rule that needs one fails closed. Legacy and v0 transactions are both decoded and signed correctly.

Anything else returns `502 unverifiable_transaction` and the player is never asked to sign. The rejection is reported to the server error log with the machine code and memo.

On-chain and upstream text (card names, set names, machine names) is treated as untrusted display data. The pull screen builds every node with `textContent` (it has no `innerHTML` at all), and none of that text ever drives a payment.

## API

The browser cannot call Collector Crypt's POST endpoints directly because they send no CORS headers. [api/gacha/[action].js](../api/gacha/%5Baction%5D.js) is the same-origin bridge. Every route accepts `?net=devnet` to use Collector Crypt's test machines (devnet USDC) instead of mainnet.

| Route | Purpose |
| --- | --- |
| `GET /api/gacha/machines` | Open machines: code, name, category, price, odds and value range per tier, stock, EV, art. Also returns `usdcMint`. Cached for 15 s per instance. |
| `GET /api/gacha/winners?code=` | The most recent pulls on one machine. |
| `GET /api/gacha/pool?code=&rarity=&cursor=` | Cards still inside a machine, paged (`{cards, hasMore, nextCursor}`). |
| `POST /api/gacha/pull` `{player, code, turbo}` | Build and verify a pack payment. Returns `{memo, transaction, payment}`, where `payment` is the decoded amount, token, recipient and fee payer for the confirmation table. |
| `POST /api/gacha/submit` `{player, signedTransaction}` | Relay the signed payment through Collector Crypt and our own Solana RPC at the same time. Either path landing is enough, and the same bytes only land once. |
| `GET /api/gacha/status?memo=` | Whether the payment landed (`paid`) and whether the card was sent (`delivered`). |
| `POST /api/gacha/open` `{memo}` | Reveal the card. `state` is `won`, `waiting` (poll again), `unpaid` or `expired`. Includes `verifyUrl`. |
| `GET /api/gacha/cards?owner=&fresh=1` | Every Collector Crypt card the wallet holds: Metaplex Core assets in the card collection, plus older programmable NFTs whose metadata names the card collection as verified. Each card has front and back images, grade, set, year, category, insured value, standard and its buyback offer (checked for the first 60). Also returns `count`, `totalInsured`, `sellable`, `truncated` (more than 120 cards) and `partial` (one scan failed). Cached for 30 s per wallet; `fresh=1` skips the cache after a sale. The chain is read through the platform's rotating Solana RPC chain (Helius and the other configured providers first), because the public cluster refuses the card query under load. Metadata JSON is only fetched from Collector Crypt's published hosts and the Arweave gateways in `ARWEAVE_GATEWAYS` ([api/_lib/ipfs-gateways.js](../api/_lib/ipfs-gateways.js)). arweave.net throttles Google Cloud egress with 429, so a card falls through to the next gateway, and a gateway that failed is tried last for five minutes. Card JSON is cached for 24 hours. |
| `GET /api/gacha/buyback-quote?nft=` | The instant-buyback offer if it is still open: `{available, amountUsdc, expiresAt}`. |
| `POST /api/gacha/buyback` `{player, nft}` | Build and verify the sell-back transaction. |
| `POST /api/gacha/buyback-submit` `{player, nft, signedTransaction}` | Relay the signed sell-back. |

Errors use the standard `{error, error_description}` shape. Messages are written for the player and say whether anything was charged.

Rate limits are per IP:

- **Reads** (`gacha:read:ip`): 240 per 5 minutes. This covers `machines`, `winners`, `pool`, `status`, `buyback-quote` and `open` polling.
- **Wallet reads** (`gacha:wallet:ip`): 30 per 5 minutes, for `cards`, which scans the chain.
- **Writes** (`gacha:play:ip`): 40 per 10 minutes. This covers `pull`, `submit`, `buyback` and `buyback-submit`.

Try the read side from a terminal:

```bash
curl -s https://three.ws/api/gacha/machines | jq '.machines[0] | {code, name, category, price, ev}'
```

### Configuration

`COLLECTORCRYPT_API_KEY` (optional, server-side only). Every play endpoint works without it. With it, pulls made from `/play` are attributed to three.ws as a Collector Crypt partner. Solana RPC uses the existing `SOLANA_RPC_URL` and `SOLANA_RPC_URL_DEVNET`.

## Files

- 3D machine, proximity prompt, crank and reveal animation: [src/game/gacha-station.js](../src/game/gacha-station.js).
- Pull screen and My cards (lazy-loaded on first use): [src/game/gacha-ui.js](../src/game/gacha-ui.js), [src/game/gacha-ui.css](../src/game/gacha-ui.css) and its DOM helper [src/game/gacha-dom.js](../src/game/gacha-dom.js).
- 3D capsule reveal and card inspector (Three.js, bloom, holographic foil shader): [src/game/gacha-reveal3d.js](../src/game/gacha-reveal3d.js).
- Wallet card scan: [api/_lib/gacha-wallet.js](../api/_lib/gacha-wallet.js).
- Client API, rarity tiers and formatting: [src/game/gacha-client.js](../src/game/gacha-client.js).
- Placement and reach (shared with the server): `GACHA` and `gachaInRange` in [multiplayer/src/world-features.js](../multiplayer/src/world-features.js).
- Wiring (collider, E key, tick, dispose): [src/game/coincommunities.js](../src/game/coincommunities.js).
- Server: [api/gacha/[action].js](../api/gacha/%5Baction%5D.js) and [api/_lib/collectorcrypt-gacha.js](../api/_lib/collectorcrypt-gacha.js).
- Tests: [tests/gacha.test.js](../tests/gacha.test.js) (transaction guards, normalizers, validators, placement), [tests/gacha-wallet.test.js](../tests/gacha-wallet.test.js) (wallet scan, verified-collection filter, metadata host allowlist) and [tests/gacha-dom.test.js](../tests/gacha-dom.test.js) (the DOM helper, including tier colour custom properties).

Related: [How `/play` stays safe, honest, and light](./play-hardening.md) and [STRUCTURE.md](../STRUCTURE.md).
