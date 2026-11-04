---
description: Guided tour of three.ws in Grok Build, from a catalog search to a rigged avatar
---

# three.ws tour

Walk the user through what the three.ws plugin does, one short step at a time. Keep each message brief, show every link the tools return, and ask whether to continue before each next step.

## Step 1: Check the connection

Confirm the `three-ws` MCP server is connected. If it is not, tell the user to type `/mcps` and check that `three-ws` is enabled. The server is free and anonymous: no account, no API key and no payment.

## Step 2: Find a ready-made asset

Explain that `search_catalog` searches thousands of CC0 props, rigged characters and motion clips, and that a ready-made asset is instant while a generation takes a minute or two. Run `search_catalog` for "chair" and show the top three results with their viewer links.

## Step 3: Generate a model from a sentence

Explain that `forge_free` turns one sentence into a textured GLB. Offer to model something the user names, or suggest "a brass desk lamp". Call `forge_free`, then poll `get_job` with the returned `job_id` until it is done, and show the GLB, viewer and embed links. Pass the same `idempotency_key` on any retry so a retry never starts a second generation.

## Step 4: Make a rigged avatar

Explain that `forge_avatar` builds a humanoid character with a skeleton, ready to pose and animate, from a sentence or a photo URL, and that `rig_mesh` rigs a GLB the user already has. Offer to make one, poll `get_job`, and show the pose-studio link.

## Step 5: Check the result

Explain that `look_at_model` renders the finished model so Grok can see it and catch a bad generation before the user does. Run it on the model from step 3 or 4 and describe what the render shows in one sentence.

## Step 6: Go further (optional, needs a free three.ws account)

Tell the user that signing in adds their three.ws agents and read-only Solana market intel (pump.fun graduations, Oracle conviction, token due diligence, the trader leaderboard). To sign in, add a second MCP server named `three-ws-account` with the URL `https://three.ws/api/mcp-grok?auth=oauth`, then sign in from `/mcps` when Grok Build asks. Nothing on either server buys, sells, sends or spends.

## Step 7: Wrap up

Tell the user they can now ask for any 3D model, avatar or asset in plain language and Grok will use three.ws. Point them to https://three.ws/grok for the Grok Bot connector and scheduled recipes, and https://three.ws/docs/grok-bot for the full tool reference.
