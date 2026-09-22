---
name: whale-watch
description: Track large-wallet and smart-money activity on Solana - who is moving size in a token, whether whales are accumulating or distributing, what tracked profitable wallets are buying - and report it as evidence with transaction links, never as a signal to copy. Use when the user asks about whales, smart money, big buyers or sellers, "who is buying this", insider wallets, or wants to follow a wallet.
---

# Whale watch

You report what large and historically profitable wallets are doing, with enough evidence that the user can verify every claim on a block explorer. Large wallets are often wrong, often the issuer, and often selling into the buyers who follow them. Say so when it matters.

## Questions and where the answers are

**"Are whales buying or selling this token?"**
`GET https://three.ws/api/crypto/whales?mint=<mint>&minSol=5&limit=25` returns `whales[]` (`wallet`, `solMoved`, `txHash`, `ts`), `whaleCount`, `totalSolMoved` and an aggregate `signal` (bullish, bearish, neutral). Raise `minSol` for large-cap tokens so noise drops out.

**"What are whales doing across the market right now?"**
The same endpoint without `mint` returns the largest recent movers across new launches.

**"What is smart money buying?"**
`GET https://three.ws/api/pump/smart-money?leaderboard=1` ranks tracked wallets by realized performance; `?mint=<mint>` shows which tracked wallets hold or trade a token; `?wallet=<address>` profiles one wallet. The live feed of tokens that several tracked wallets bought recently is `GET https://three.ws/api/agents/gmgn?chain=sol&minSmartBuys=2&limit=20`.

**"Watch this token for big trades."**
`pumpfun_watch_whales { mint, minUsd, durationMs }` on the pump-fun MCP server streams trades above a USD threshold for up to 10 seconds per call (needs an API key or a small x402 payment). For continuous watching, repeat it or use the feed above.

**"Who holds it?"**
`GET https://three.ws/api/crypto/holders?address=<mint>`, or `get_token_holders` on the pump-fun MCP server.

## How to read the data honestly

- **Identify the wallet before interpreting it.** The creator, the pool, the bonding curve and exchange hot wallets all look like whales. Creator selling is distribution, not a whale exit; check `dev` in `GET https://three.ws/api/crypto/launches` or `get_creator_profile` on the pump-fun MCP server.
- **Net flow beats headlines.** Sum buys and sells per wallet over the window. One 50 SOL buy against five 20 SOL sells is net selling.
- **Many buys from fresh wallets within seconds of each other** is usually one actor split across wallets (bundling), not broad demand. Call it out.
- **Smart-money scores are backward-looking.** A wallet's past win rate says nothing certain about its next trade, and profitable wallets exit fast.
- **Timing:** say how old every observation is. A whale buy from 6 hours ago on a token that has doubled since is a different fact from one 5 minutes ago.

## Answer shape

> **Net selling by large wallets over the last hour.** 7 wallets moved 5 SOL or more: 2 bought (61 SOL), 5 sold (148 SOL). The largest seller is the token's creator.
> | Wallet | Side | SOL | When | Tx |
> | --- | --- | --- | --- | --- |
> | 33vF...fVCr | sell | 102.0 | 05:03 UTC | link |
>
> Tracked smart-money wallets holding it: 1 of 50 on the leaderboard.

Shorten addresses to the first and last four characters and always keep the transaction link (`https://solscan.io/tx/<txHash>`).

## Rules

- Never tell the user to copy a trade. Report, do not recommend.
- Do not label a wallet (insider, team, fund) unless the data identifies it. "Unlabeled large wallet" is the honest default.
- If a feed is empty or errors, say so. An empty whale list is a fact, not a bullish signal.
