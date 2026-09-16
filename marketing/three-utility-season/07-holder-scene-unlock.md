# Edition 07: What $THREE does this week, live world access and purchases

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-10-THREE-WORLD` |
| Publish date | 2026-10-30 |
| Chapter | Community |
| Audience | community and holders |
| Campaign anchor (campaigns.csv) | https://three.ws/play |
| Surface used in this pack | live gated embed (`/embed/v1/gated.html`) |
| Verified status (2026-09-16) | **Not live for $THREE. Substitute used.** |

## Verification

**Substitute:** `/play` is open to everyone and its $THREE purchases are switched off. The substitute is the viewer side of a real holder gate: a community member unlocks a holder-only 3D scene with one signature.

- World access: the `/play` holder gate is off because neither `PLAY_GATE_MINT` nor `THREE_MINT` is set on `three-ws-api` or `three-ws-multiplayer` (`api/_lib/play-pass.js`: "An empty mint means the gate is OFF").
- Purchases: the `three-ws-multiplayer` service env holds only `NODE_ENV`, `ALLOWED_ORIGINS`, `HOLDER_PASS_SECRET`, and Redis settings. Without `GAME_TOKEN_TREASURY` or `PAYMENT_RECIPIENT_SOLANA`, `multiplayer/src/game-token.js` `treasuryWallet()` throws in production, so boutique sales and paid spins cannot settle.
- Substitute: `https://three.ws/embed/v1/gated.html?asset=avatar%3Abf2d5c4b-...` renders the locked teaser for the platform's demo gate (min 1 $THREE); `POST /api/embed/gate-verify` issued a SIWS nonce for it on 2026-09-16.

## The three questions

- **What can a holder do now?** Open the gated embed link, connect a Solana wallet holding 1 $THREE, sign the message, and view the scene.
- **Where does $THREE enter?** Held, by the visitor. Connecting a wallet and signing one message lets the server read the $THREE balance; at 1 or more the scene opens.
- **What verifiable result comes out?** The locked teaser is replaced by the interactive 3D scene. No tokens move.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Demo gate minimum: 1 $THREE | `gate-verify` response and captured frame, 2026-09-16 |

## Media

- File: [`images/07-holder-scene-unlock.png`](./images/07-holder-scene-unlock.png), 1600x900, captured 2026-09-16 from `/embed/v1/gated.html?asset=avatar%3Abf2d5c4b-2536-4593-bf15-ec934a6c9f48` by `node marketing/three-utility-season/capture.mjs --only 07`.
- Alt text (required on every post):

> A locked three.ws 3D embed: a padlock icon, the heading "Hold 1 $THREE to unlock", the note that "Gate Demo Avatar" is a token-gated 3D embed on three.ws, a Connect wallet button, and the $THREE contract address beneath.

## X post

Weighted length: **165 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
This 3D scene stays locked until a wallet proves it holds 1 $THREE. Connect, sign one message, and it opens. Nothing is spent or transferred. https://three.ws/embed/v1/gated.html?asset=avatar%3Abf2d5c4b-2536-4593-bf15-ec934a6c9f48&utm_source=x&utm_medium=social&utm_campaign=mkt-2026-10-three-world&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: open a holder-only scene.
This three.ws embed stays locked until a wallet proves it holds 1 $THREE. Connect, sign one message, and the 3D scene opens. Nothing is spent or transferred.
Contract address: FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump
The /play world is open to everyone. Its $THREE shop is not switched on yet.
https://three.ws/embed/v1/gated.html?asset=avatar%3Abf2d5c4b-2536-4593-bf15-ec934a6c9f48&utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-10-three-world&utm_content=utility-telegram
```

## User action

Open the gated embed link, connect a Solana wallet holding 1 $THREE, sign the message, and view the scene.

## KPI and where to read it

Verified unlocks. Successful phase-two `POST /api/embed/gate-verify` responses for gate `6ohPMCQSv5LY` in `three-ws-api` logs; UTM sessions for `mkt-2026-10-three-world`.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Unlock the demo gate once with a real wallet holding 1 $THREE and confirm the scene renders.
- [ ] Re-check `three-ws-multiplayer` env. If a treasury is configured and a boutique sale settles, the owner can restore the world-purchase story.
- [ ] Re-run `capture.mjs --only 07`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not say $THREE buys cosmetics or spins in `/play` yet.
- Do not mention the wheel of fortune in any edition.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
