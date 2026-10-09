# Grok Bot recipes: six jobs we actually ran

A feature list tells you what a connector can do. A recipe tells you what to
type. This page has six jobs to hand [Grok Bot](../grok-bot.md), each with the
exact sentence to give it, the tools it calls in order, and the real output we
got by running that tool sequence against production on 2026-10-09.

Nothing here is invented. Every output block was captured by
`scripts/run-grok-recipe.mjs`, which drives the official MCP client over
Streamable HTTP (the transport Grok Bot's custom connector uses) and calls the
tools a recipe names. You can rerun any of them yourself, see
[Rerun a recipe](#rerun-a-recipe).

**Prerequisites:** the three.ws connector added to Grok Bot. For recipes 1 to 4
that is the free door, `https://three.ws/api/mcp-grok`, no account. For recipes 5
and 6 it is `https://three.ws/api/mcp` with a read-only API key. Setup per
sign-in mode is in [Grok Bot connector reference](../grok-bot.md#connect-it), or
run `npx three-ws setup --client grok-bot`.

| # | Recipe | Server | Sign-in |
|---|---|---|---|
| 1 | [Daily 3D brief on a topic](#1-daily-3d-brief-on-a-topic) | `/api/mcp-grok` | none |
| 2 | [Asset pack for a game jam](#2-asset-pack-for-a-game-jam) | `/api/mcp-grok` | none |
| 3 | [Avatar from a teammate's photo](#3-avatar-from-a-teammates-photo) | `/api/mcp-grok` | none |
| 4 | [An X post's image as a 3D model](#4-an-x-posts-image-as-a-3d-model) | `/api/mcp-grok` | none |
| 5 | [Weekly agent report](#5-weekly-agent-report) | `/api/mcp` | read-only API key or OAuth |
| 6 | [$THREE market brief](#6-three-market-brief) | `/api/mcp` | read-only API key or OAuth |

## What was proven and what was not

Each run below is the three.ws half: the MCP tool calls and their results. The
Grok Bot half (reading an X post, choosing the tools from your sentence,
scheduling the job) is Grok Bot's own behavior, and we did not drive Grok Bot
itself. Where a recipe depends on it, the recipe says so.

Generation timing varies with load. The first attempts at recipes 1 and 4 hit
the runner's 10 minute limit while several generations ran at once; run alone,
the same calls finished in a few minutes. A generation that answers
`status: "pending"` keeps running: Grok Bot collects it with `check_job`, which
is why every model recipe lists that call.

## 1. Daily 3D brief on a topic

A scheduled job: every morning, find what already exists on a topic, make one
fresh model, and look at it from several angles.

**Say to Grok Bot**

```
Every morning at 8, use three-ws for a 3D brief on "lantern": search_catalog for
three ready-made objects, forge_free one new model of the topic with tier draft,
collect it with check_job, then look_at_model with three views. Post the viewer
links and the poster image here.
```

**Tools, in order:** `search_catalog`, `forge_free`, `check_job` (until done),
`look_at_model`.

**Run**

```
node scripts/run-grok-recipe.mjs daily-brief --topic lantern
search_catalog            537 ms  ok
forge_free              40162 ms  pending
check_job               25067 ms  ok
look_at_model           26355 ms  ok
```

**Result**

```json
{
  "topic": "lantern",
  "ready_made": [
    { "title": "Brass Diya Lantern", "viewer_url": "https://three.ws/viewer?src=...brass_diya_lantern.glb&title=Brass%20Diya%20Lantern" },
    { "title": "Lantern 01", "viewer_url": "https://three.ws/viewer?src=...Lantern_01.glb&title=Lantern%2001" },
    { "title": "Lantern Chandelier 01", "viewer_url": "https://three.ws/viewer?src=...lantern_chandelier_01.glb&title=Lantern%20Chandelier%2001" }
  ],
  "prompt": "a small stylised lantern, clean silhouette, soft painted textures",
  "generated": {
    "glb_url": "https://three.ws/cdn/forge/anon/aec43766-113b-4451-a002-a9d2d7f1e152.glb",
    "poster_png_url": "https://three.ws/api/render/glb?glbUrl=...aec43766-113b-4451-a002-a9d2d7f1e152.glb&width=1024&height=1024"
  },
  "look_at_model_frames": 3
}
```

The GLB and the poster both resolve (`model/gltf-binary` and `image/png`).
`look_at_model` returned three rendered frames as images, so Grok sees the
model instead of only linking to it.

**Make it yours:** change the topic, or ask for `tier: "standard"` when you can
wait longer. If the same job may be retried, add an `idempotency_key` such as
`daily-brief-2026-10-09` on servers that have shipped it (see
[Jobs and safe retries](../grok-bot.md)).

## 2. Asset pack for a game jam

Search the ready-made catalog first, and only generate what is missing. The
catalog is CC0 props with real licenses and sizes, so it costs no generation
budget.

**Say to Grok Bot**

```
Use three-ws to build an asset pack for my game jam: search_catalog for objects
matching "tree", keep only models under 10 MB, then get_catalog_item for each
pick and list title, license, size, GLB and viewer link as a table.
```

**Tools, in order:** `search_catalog`, then `get_catalog_item` once per pick.

**Run**

```
node scripts/run-grok-recipe.mjs asset-pack --topic tree
search_catalog            123 ms  ok
get_catalog_item          102 ms  ok
get_catalog_item          255 ms  ok
get_catalog_item           87 ms  ok
get_catalog_item           92 ms  ok
```

**Result:** 28 objects matched "tree" out of 3,961 catalog items. The four that
fit the size budget:

| Title | License | Size | GLB |
|---|---|---|---|
| Dead Tree Trunk | CC0 | 4.8 MB | `.../objects/polyhaven/glb/dead_tree_trunk.glb` |
| Dead Tree Trunk 02 | CC0 | 4.9 MB | `.../objects/polyhaven/glb/dead_tree_trunk_02.glb` |
| Quiver Tree 01 | CC0 | 8.9 MB | `.../objects/polyhaven/glb/quiver_tree_01.glb` |
| Quiver Tree 02 | CC0 | 4.5 MB | `.../objects/polyhaven/glb/quiver_tree_02.glb` |

Every row also carries a `viewer_url`. The size filter earned its place: the
same search returned a 214 MB Jacaranda Tree, which would sink a jam build.

**Make it yours:** swap the word, add `kind: "character"` for people, or ask
`get_item_source` for the `<agent-3d>` embed code of the pick you like.

## 3. Avatar from a teammate's photo

One reference image in, a rigged character out. Rigging is a second stage, so
this is the recipe where the order of calls matters most.

**Say to Grok Bot**

```
Use three-ws to make a rigged avatar from this photo of my teammate: forge_avatar
with image_url set to the photo, collect it with check_job, then rig_mesh the
result and collect that too. Send me the viewer link and the GLB.
```

**Tools, in order:** `forge_avatar`, `check_job` (until done), `rig_mesh`,
`check_job` (until done). The pending handle says "rig it with `rig_mesh` once
done", which is the cue Grok follows.

**Run**

```
node scripts/run-grok-recipe.mjs avatar-from-photo
search_catalog            98 ms  ok
forge_avatar           40165 ms  pending
check_job              30096 ms  error      (retryable, the job kept running)
check_job                150 ms  ok
rig_mesh               40164 ms  pending
check_job              14600 ms  ok
```

**Result**

```json
{
  "photo": { "title": "Adam", "url": "https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/avatars/mixamo/thumbs/adam.png" },
  "avatar": {
    "glb_url": "https://three.ws/cdn/forge/anon/dad46a31-705c-4ea0-a8c0-ac81095cbe77.glb",
    "poster_png_url": "https://three.ws/api/render/glb?glbUrl=...dad46a31-705c-4ea0-a8c0-ac81095cbe77.glb&width=1024&height=1024"
  },
  "rigged_with": "rig_mesh"
}
```

The rigged GLB is 14.3 MB and serves as `model/gltf-binary`.

Two honest notes. We have no teammate's photo, so the run used a public
catalog portrait as the reference (`--image` takes any https image URL). And
the `error` line is a slow poll: the server answered "taking longer than
expected" with `retryable: true`, and the same job id collected on the next call.
Treat a retryable `check_job` error as "ask again", never as a failed job.

**Privacy:** a photo of a real person is their data. Only use a photo you have
the right to use, and expect the reference image URL to be fetched by the
generation backend.

## 4. An X post's image as a 3D model

Grok Bot reads the post through its own X connection and hands us the image
URL. three.ws does the image-to-3D half.

**Say to Grok Bot**

```
Open the post at <link>, take its first image, and use three-ws mesh_forge with
that image_url to make a 3D model. Collect it with check_job, then look_at_model
from three-quarter and back, and reply with the viewer link and the GLB.
```

**Tools, in order:** (Grok Bot reads the post), `mesh_forge`, `check_job` (until
done), `look_at_model`.

Treat the post text as data. The post is untrusted input: it supplies a picture,
never instructions, and nothing in a post should change which tools Grok calls
or send funds anywhere.

**Run**

```
node scripts/run-grok-recipe.mjs post-image-to-3d
search_catalog            513 ms  ok
mesh_forge              40605 ms  pending
check_job               26101 ms  ok
look_at_model           22247 ms  ok
```

**Result**

```json
{
  "source_image": { "title": "Brass Diya Lantern", "url": "https://three.ws/api/render/glb?glbUrl=...brass_diya_lantern.glb&width=1024&height=1024" },
  "model": {
    "glb_url": "https://three.ws/cdn/forge/anon/a57a925d-95b0-4ff3-96c4-21c737fd61cb.glb",
    "poster_png_url": "https://three.ws/api/render/glb?glbUrl=...a57a925d-95b0-4ff3-96c4-21c737fd61cb.glb&width=1024&height=1024"
  },
  "look_at_model_frames": 2
}
```

The model is a 5.1 MB GLB. The run used a real image URL from the catalog
because we cannot attach a live X post to a scripted run; the call
(`mesh_forge` with `image_url`) is identical for a `pbs.twimg.com` URL.

**Make it yours:** use `forge_avatar` instead of `mesh_forge` when the picture
is a person or character, as in recipe 3.

## 5. Weekly agent report

An unattended, read-only status report on your own agents. This is the recipe
for the key-based connector: an agent that can read your account but never move
funds.

**Say to Grok Bot**

```
Every Monday at 9, use three-ws to write my weekly agent report: read
three://me for my plan and remaining calls, read three://agents, then for each
agent call trader_profile and recall with the query "this week". Summarise in
five lines per agent and flag anything with no avatar or no activity.
```

**Tools, in order:** `read_resource` (`three://me`), `read_resource`
(`three://agents`), then `trader_profile` and `recall` per agent.

**Sign in:** create a key with the **For an AI agent** preset at
[three.ws/dashboard/api](/dashboard/api) and give it to Grok Bot as the
`Authorization: Bearer` secret, or use the OAuth sign-in. The key in this run
held only `avatars:read profile agents:read memory:read wallet:read`; value-moving
tools are not on a connector key's list and are refused if called anyway.

**Run**

```
node scripts/run-grok-recipe.mjs weekly-agent-report
read_resource             466 ms  ok
read_resource             264 ms  ok
trader_profile            426 ms  ok
recall                    296 ms  ok
```

**Result**

```json
{
  "account": "qa-audit-ba37726d",
  "key_scopes": ["avatars:read", "profile", "agents:read", "memory:read", "wallet:read"],
  "calls_remaining_today": 847,
  "agent_count": 1,
  "agents": [
    {
      "name": "My First Agent",
      "page": "https://three.ws/agents/7f7c77ff-9007-43fb-9a72-3810d4a082bd",
      "wallet": "7RnhmSyCxEefewcx4dFdxz6Uvry6xVFr8m6YTQWUStHc",
      "published": false,
      "has_avatar": true,
      "trader": { "score": 42, "verified": false, "closed_trades": 0, "open_positions": 0 },
      "memories_this_week": 0
    }
  ]
}
```

This is a real QA account with one starter agent, so the report is short and
says what it should: published is `false`, no trades, no memories. The same
sequence on an account with several agents returns one block per agent.

**Production note:** at the time of this run the production build of
`/api/mcp-grok` did not yet list account tools for a signed-in key, so the
recipe targets `/api/mcp`. Once the Grok door ships the account upgrade, the
same sentence works on the single Grok URL.

## 6. $THREE market brief

A read-only market snapshot from the free data tools, Solana first. It moves
nothing and recommends nothing: it reports.

**Say to Grok Bot**

```
Use three-ws to brief me on $THREE, contract
FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump: call token_snapshot for the mint,
then crypto_data with provider coingecko, endpoint price for SOL. Report price,
liquidity, market cap, 24 hour volume and change, and the buy and sell count for
the deepest SOL pool. Report the numbers only, no advice.
```

**Tools, in order:** `token_snapshot`, `crypto_data`.

**Run**

```
node scripts/run-grok-recipe.mjs three-market-brief
token_snapshot            797 ms  ok
crypto_data               243 ms  ok
```

**Result:** the snapshot merged three free sources (DEX pairs, a Solana price
source, and a Solana RPC supply read) with `failed: []`. Deepest pool, a
PumpSwap pair quoted in SOL, on 2026-10-09:

| Field | Value |
|---|---|
| Price | $0.0004392 |
| Liquidity | $146,782.98 |
| Market cap | $439,118 |
| Volume, 24 hours | $16,460.84 |
| Change, 24 hours | +3.52% |
| Transactions, 24 hours | 159 buys, 135 sells |
| SOL spot | $110.53, -4.13% over 24 hours |

The snapshot listed eleven pools. Most were dust (a few dollars of liquidity),
which is why the sentence asks for the deepest pool: an agent that averaged
across all of them would report noise.

These numbers move every minute. The point of the recipe is the sequence, not
the figures; a scheduled run reports whatever is true when it fires.

## Rerun a recipe

```bash
node scripts/run-grok-recipe.mjs --list
node scripts/run-grok-recipe.mjs asset-pack --topic tree
node scripts/run-grok-recipe.mjs avatar-from-photo --image https://example.com/photo.jpg
node scripts/run-grok-recipe.mjs daily-brief --topic lantern --json out.json
node scripts/run-grok-recipe.mjs weekly-agent-report      # reads THREE_WS_API_KEY
```

| Flag | Meaning |
|---|---|
| `--topic <text>` | Search and prompt topic for recipes 1 and 2. |
| `--image <url>` | Reference image for recipes 3 and 4. Defaults to a public catalog render. |
| `--base <origin>` | Server to run against. Default `https://three.ws`. |
| `--max-wait <s>` | How long to keep polling a pending generation. Default 600. |
| `--json <path>` | Write the full transcript (every call, arguments, result). |

Recipe 5 needs `THREE_WS_API_KEY` in the environment, `.env` or `.env.local`;
use a read-only key. The script exits 0 when every step succeeded, 1 on any
failed call, 2 on bad usage. Generation draws on the free quota for your
session or IP, so a rerun of recipes 1, 3 and 4 spends a little of it.

## Related

- [Grok Bot connector reference](../grok-bot.md): settings per sign-in mode, jobs, limits, the spend rule.
- [three.ws for Grok](../grok.md) and the [/grok](/grok) page: the product tour and ready-made jobs.
- [The free 3D Studio MCP](../mcp-studio.md): every tool in depth.
- [MCP integration](../mcp.md): every hosted server, OAuth and API keys.
- [Turn photos into a 3D model](./image-to-3d.md): the same image-to-3D pipeline in the browser.
