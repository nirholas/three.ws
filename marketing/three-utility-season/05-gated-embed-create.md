# Edition 05: What $THREE does this week, token-gated 3D content

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-10-THREE-GATE` |
| Publish date | 2026-10-16 |
| Chapter | Creation |
| Audience | creators and community |
| Campaign anchor (campaigns.csv) | https://three.ws/studio |
| Surface used in this pack | /docs/token-gated-3d-embeds |
| Verified status (2026-09-16) | **Live (API and MCP). No creation UI in `/studio`.** |

## Verification

**Substitute:** None for the utility. The link moves from `/studio` to the documentation page, because Widget Studio has no gate control; creation happens through `POST /api/embed/gate-create` or the MCP tool.

- Handlers: `api/embed/gate-create.js` and `api/embed/gate-verify.js`. An unauthenticated create returned `401 sign in required to gate an embed` (the expected guard) on 2026-09-16.
- Verify path: `POST /api/embed/gate-verify` for the existing demo gate returned a SIWS message with a nonce and `gate: { mint: FeMb...pump, minAmount: 1 }` on 2026-09-16.
- Doc: `/docs/token-gated-3d-embeds` answered 200 and shows "Verified against the code".
- Gap: `src/studio/` contains no gate-create control, so the campaign anchor `/studio` cannot perform the action.

## The three questions

- **What can a holder do now?** Sign in, pick an owned avatar, `POST /api/embed/gate-create` with `{ assetId, gate: { minAmount, chain: "solana" } }`, and paste the returned snippet on a page.
- **Where does $THREE enter?** Held, by the viewer. The server issues a single-use signed-message nonce, reads the wallet's live $THREE balance, and only then returns a short-lived access token for the scene.
- **What verifiable result comes out?** Below the bar, a designed locked teaser ("Hold N $THREE to unlock"). Above it, the interactive 3D scene. Raising the minimum invalidates earlier access tokens.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Gate defaults to $THREE when `mint` is omitted | `docs/token-gated-3d-embeds.md`, captured 2026-09-16 |

## Media

- File: [`images/05-gated-embed-docs.png`](./images/05-gated-embed-docs.png), 1600x900, captured 2026-09-16 from `/docs/token-gated-3d-embeds` by `node marketing/three-utility-season/capture.mjs --only 05`.
- Alt text (required on every post):

> The three.ws documentation page "Token-gated 3D embeds", marked Verified against the code, explaining that the scene only renders for a visitor who holds enough of a specific token, verified with a real on-chain balance read, with $THREE-holder-only content as the canonical use case.

## X post

Weighted length: **167 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
A token-gated embed renders its 3D scene only for a wallet holding enough $THREE, checked by a signed message and a live on-chain balance read. https://three.ws/docs/token-gated-3d-embeds?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-10-three-gate&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: holder-only 3D scenes.
Any avatar you own on three.ws can become an embed that only renders for wallets holding enough $THREE. The check is a signed message plus a live on-chain balance read, done on the server.
Below the bar, visitors see a locked teaser instead of the model.
Create one with the API or the MCP tool; the guide is at three.ws/docs/token-gated-3d-embeds.
https://three.ws/docs/token-gated-3d-embeds?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-10-three-gate&utm_content=utility-telegram
```

## User action

Sign in, pick an owned avatar, `POST /api/embed/gate-create` with `{ assetId, gate: { minAmount, chain: "solana" } }`, and paste the returned snippet on a page.

## KPI and where to read it

Gates created and verified unlocks. New `embed_gates` rows for the week; successful `gate-verify` phase-two responses in `three-ws-api` logs; UTM sessions for `mkt-2026-10-three-gate`.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Create one gate from a real account and open it with a wallet above and below the bar.
- [ ] Confirm `/docs/token-gated-3d-embeds` still returns 200.
- [ ] Re-run `capture.mjs --only 05`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not say "in Studio". There is no Studio control yet.
- Do not suggest gating with any other token in the post.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
