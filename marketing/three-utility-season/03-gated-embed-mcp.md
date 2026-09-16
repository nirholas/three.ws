# Edition 03: What $THREE does this week, marketplace settlement

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-10-THREE-MARKET` |
| Publish date | 2026-10-02 |
| Chapter | Creation |
| Audience | creators and agents |
| Campaign anchor (campaigns.csv) | https://three.ws/marketplace |
| Surface used in this pack | /docs/mcp (tool `create_gated_embed`) |
| Verified status (2026-09-16) | **Not demonstrable. Substitute used.** |

## Verification

**Substitute:** Marketplace settlement in $THREE has no completed sale to show and its payment rail is switched off. The substitute is the live MCP tool `create_gated_embed`, which lets an agent (or its owner) make holder-only 3D content.

- Planned surface: `GET https://three.ws/api/marketplace/analytics` on 2026-09-16 returned `totalSales: 0`, `uniqueBuyers: 0`, `totalTrials: 11312`, `trialFunnel.converted: 0`.
- Payment rail: signed-in `POST /api/token/quote` (purposes `consumption` and `marketplace_sale`) returned `treasury_unavailable`; `GET /api/token/config` reports `treasury_configured: false`, `rewards_configured: false`.
- Listing UI: an agent with $THREE `skill_prices` in `/api/marketplace/agents/<id>` does not render those prices on its marketplace page, and the Skills tab "Paid" entries are USDC x402 skills.
- Code risk: `api/_lib/solana/gasless-tx.js` builds the purchase transfer with the legacy token program, while the $THREE mint is Token-2022 (confirmed with `getAccountInfo`: owner `spl-token-2022`).
- Substitute: tool definition at `api/_mcp/tools/embed.js` line 227, backed by `api/embed/gate-create.js`; documented at `/docs/mcp` (section `create_gated_embed`, 200 on 2026-09-16). Calling the MCP endpoint requires sign-in (OAuth); an unauthenticated `tools/list` answered with a 402 challenge, so the tool call itself was not exercised in this pass.

## The three questions

- **What can a holder do now?** Connect an MCP client to `https://three.ws/api/mcp`, sign in, and call `create_gated_embed` with an owned `asset_id` and a `min_amount`.
- **Where does $THREE enter?** Held, by the viewer. The gate defaults to the $THREE mint when `mint` is omitted; a viewer must hold at least `min_amount` to open the scene.
- **What verifiable result comes out?** A `gate_id`, the gate terms, and a paste-ready embed snippet that shows a locked teaser below the bar and the live 3D scene above it.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Omitting `mint` defaults the gate to $THREE | `docs/token-gated-3d-embeds.md` and `api/_mcp/tools/embed.js`, captured 2026-09-16 |

## Media

- File: [`images/03-gated-embed-mcp-tool.png`](./images/03-gated-embed-mcp-tool.png), 1600x900, captured 2026-09-16 from `github.com/nirholas/three.ws/blob/main/api/_mcp/tools/embed.js#L227` by `node marketing/three-utility-season/capture.mjs --only 03`.
- Alt text (required on every post):

> Source of the three.ws MCP server on GitHub, file api/_mcp/tools/embed.js, highlighting line 227: name create_gated_embed, title "Create a token-gated embed", with the description "Turn an avatar or on-chain agent you own into a holder-only interactive 3D embed".

## X post

Weighted length: **163 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Agents can gate 3D content too. The three.ws MCP tool create_gated_embed turns an avatar you own into a scene only $THREE holders can open. https://three.ws/docs/mcp?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-10-three-market&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: agents that gate content.
The three.ws MCP server has a create_gated_embed tool. Point it at an avatar you own and set a minimum; leave the mint empty and the gate uses $THREE.
The result is an embed snippet that stays locked for wallets below the bar.
Marketplace sales in $THREE are not running yet, so this week shows the part that is.
https://three.ws/docs/mcp?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-10-three-market&utm_content=utility-telegram
```

## User action

Connect an MCP client to `https://three.ws/api/mcp`, sign in, and call `create_gated_embed` with an owned `asset_id` and a `min_amount`.

## KPI and where to read it

Gates created by agents. Read UTM sessions for `mkt-2026-10-three-market`; count new rows in `embed_gates` created during the week (1 row existed on 2026-09-16).

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] From a real MCP client, call `create_gated_embed` once end to end and open the returned preview URL.
- [ ] Re-check `/api/marketplace/analytics` and `/api/token/config`. If `totalSales` is above 0 and `treasury_configured` is true, the owner can restore the marketplace story.
- [ ] Re-run `capture.mjs --only 03`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not describe the marketplace as settling in $THREE until a confirmed sale exists.
- Do not quote the trial count as usage.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
