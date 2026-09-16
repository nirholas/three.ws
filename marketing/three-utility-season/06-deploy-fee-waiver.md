# Edition 06: What $THREE does this week, holder deployment benefits

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-10-THREE-DEPLOY` |
| Publish date | 2026-10-23 |
| Chapter | Access |
| Audience | agent developers and holders |
| Campaign anchor (campaigns.csv) | https://three.ws/deploy |
| Surface used in this pack | on-chain deploy MCP server (package `@three-ws/...-agent-mcp`) |
| Verified status (2026-09-16) | **Live in the MCP server only.** |

## Verification

**Substitute:** None for the utility, but the link changes: `/deploy` is the 3D model viewer (`vercel.json` routes it to `app.html`), and the browser deployer at `/deploy-onchain` charges no deploy fee, so it has nothing for holding to discount. The post is scoped to the MCP server and links the fee schedule in source.

- Verified on 2026-09-16 by running the package's own `resolveDeployFee()` against Solana mainnet: a wallet holding over 250,000 $THREE resolved `tier: holder_free, sol: 0`; a wallet with 0 $THREE resolved `tier: standard, sol: 0.02, next_tier at 50,000`.
- Schedule in source: `DEPLOY_FEE_SOL = 0.02`, `THREE_HALF_PRICE_AT = 50_000`, `THREE_FREE_AT = 250_000` (config.js lines 119 to 129, on GitHub `main`).
- Gap 1: `src/deploy-onchain.js` calls `buildAgentMint(umi, p)` with no fee, so the browser path is free for everyone. The 2026-08-19 changelog entry says the browser page carries the fee; it does not.
- Gap 2: the fee is paid to the wallet the buyback lane spends from, but `/api/three-token/stats` reports `buyback.enabled: false`, so fees do not currently become $THREE buys. The post does not claim they do.

## The three questions

- **What can a holder do now?** Run the deploy MCP server (`npx -y` with the package name shown on `/deploy-onchain`), call `three_status` with your wallet, and read the quoted fee.
- **Where does $THREE enter?** Held. The server reads the paying wallet's $THREE balance when it builds the deploy transaction; nothing is staked or spent.
- **What verifiable result comes out?** The deploy fee shown before signing: 0.02 SOL, 0.01 SOL at 50,000 $THREE held, or free at 250,000. The `three_status` tool returns the price for any wallet without signing.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| 0.02 SOL / 50,000 / 250,000 | package config on GitHub, captured 2026-09-16 |

## Media

- File: [`images/06-deploy-fee-waiver.png`](./images/06-deploy-fee-waiver.png), 1600x900, captured 2026-09-16 from `github.com/nirholas/three.ws/blob/main/packages/.../src/config.js#L110` by `node marketing/three-utility-season/capture.mjs --only 06`.
- Alt text (required on every post):

> Source code on GitHub for the three.ws on-chain deploy MCP server: comments explain that holding $THREE makes the deploy fee cheaper or free, and constants set DEPLOY_FEE_SOL to 0.02, THREE_HALF_PRICE_AT to 50_000, and THREE_FREE_AT to 250_000.

## X post

Weighted length: **175 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Deploying an agent on-chain through the three.ws MCP server costs 0.02 SOL on mainnet. 50,000 $THREE in the paying wallet halves it; 250,000 waives it. https://github.com/nirholas/three.ws/blob/main/packages/metaplex-agent-mcp/src/config.js?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-10-three-deploy&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: cheaper agent deploys from the MCP server.
Deploying an agent on-chain through the three.ws MCP server carries a 0.02 SOL mainnet fee. 50,000 $THREE in the paying wallet halves it and 250,000 waives it. The balance is read, not spent.
Ask the server's three_status tool to price any wallet before you sign.
This applies to the MCP server. The browser deployer does not charge a fee.
https://github.com/nirholas/three.ws/blob/main/packages/metaplex-agent-mcp/src/config.js?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-10-three-deploy&utm_content=utility-telegram
```

## User action

Run the deploy MCP server (`npx -y` with the package name shown on `/deploy-onchain`), call `three_status` with your wallet, and read the quoted fee.

## KPI and where to read it

Deploy quotes and completed deployments. `three_status` has no server-side log (it runs on the user's machine), so read npm weekly downloads for the package and the `/deployments` feed for new mainnet agents during the week.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Owner decision before posting: either wire the fee and waiver into `/deploy-onchain` or keep this post scoped to the MCP server as written.
- [ ] Run `three_status` once against a real wallet on mainnet.
- [ ] Re-run `capture.mjs --only 06` and confirm the constants on `main` are unchanged.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not say deploying buys $THREE while `buyback.enabled` is false.
- Do not link `/deploy`; it is the model viewer.
- The package directory and the GitHub frame name a third-party registry protocol; confirm with the owner that this is acceptable before publishing (commit gate in CLAUDE.md).
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
