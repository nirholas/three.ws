Most token designs ask you to spend. Every call burns a little, the balance drains, and the thing you bought access to keeps charging you for it. We went the other way on three.ws. Holding $THREE is what unlocks the expensive lanes, and the tokens stay in your wallet while it works.

## What holding actually turns on

The ladder has five rungs, and the jump that matters most is the first one.

At Bronze, which is $25 held, two things switch on that are otherwise closed:

- High-quality generation, 200k polygons with PBR textures
- Game-ready export, Unity and Unreal retopo with PBR

Both are live today. You also take 5% off all compute priced in the token, and your free generation quota doubles.

Above that the discount and the quota keep climbing. Silver at $100 held is 10% off and triple quota. Gold at $500 held is 20% off and five times the quota. Genesis at $2,500 held is 30% off and ten times the quota.

Some perks further up the ladder are still marked planned on the page: private invite-only worlds, priority MCP routing, branded environments. We label them that way on purpose. A tier page that quietly lists unbuilt features as benefits is just a roadmap wearing a price tag.

## The floor stays free

Draft and standard generation stay free, forever, whether you hold anything or not. That is not a trial window or a monthly allowance that lapses. Text to 3D, image to 3D, the catalog of free assets, the embed, the agent runtime: none of it is behind the token.

The hold gates the lanes that cost us real GPU time. A 200k-poly generation with 4K PBR textures is a different unit of spend from a draft mesh, and the ladder is how that cost gets carried by the people who want that output.

## It is a gate, not a paywall around the product

The mechanism is ordinary and you can watch it work. Ask the API for a high-tier generation without holding, and it declines with a 402 and tells you exactly why:

```
POST /api/forge  {"prompt": "a plain wooden stool", "tier": "high"}

402  {"error": "three_hold_required",
      "feature": "forge.high",
      "required": {"id": "bronze", "min_usd": 25}}
```

No key to buy, no subscription to cancel, no per-call meter running down. The check reads your on-chain balance, and if it clears, the job runs. Sell the tokens and the lane closes again. That symmetry is the point: you are not buying credits that evaporate, you are holding an asset that carries an entitlement for as long as you hold it.

## Why we think this is the honest version

A spend-per-call token has a structural problem. The project wants you to transact, so the incentive is to make you transact more, which means the product quietly gets designed around consumption instead of around being good. A hold-to-access token inverts that. We make nothing when you use the high lane. We only benefit if holding the token is worth doing, which means the only lever we have is to keep shipping things worth unlocking.

That is a harder promise to keep, and it is the one we would rather be measured on.
