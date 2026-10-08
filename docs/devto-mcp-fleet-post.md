---
venue: dev.to (cross-post to Hashnode and Medium with canonical back to three.ws)
account: three.ws / nichxbt
suggested_title: "We published 72 MCP servers. Here are the principles we build them to."
description: "A practical guide from running a large MCP fleet: how we came to publish 72 servers, the four design principles that keep them safe and clear (enforcement on the server, consent where a person can see it, discovery metadata verified from outside, and free tools kept free by construction), how we organise the fleet for people and agents, and the one pattern that mattered most."
tags: [mcp, ai, agents, opensource]
canonical: https://three.ws/docs/mcp
status: draft, owner approval required before posting (external-channel gate in CLAUDE.md)
---

# We published 72 MCP servers. Here are the principles we build them to.

Hi DEV! I work on [three.ws](https://three.ws), an open-source platform where AI agents get 3D bodies: you describe a character, and you get a rigged, animated avatar that can talk, act, and live on any web page.

If you have not met MCP yet, here is the one-line version. The Model Context Protocol is a standard way to hand an AI assistant a set of tools. You run (or connect to) an MCP server, and Claude, ChatGPT, Cursor, or your own agent can call its tools: "generate a 3D model", "rig this mesh", "turn on the kitchen light".

Along the way we published **72 MCP servers in the official Model Context Protocol registry** under one namespace, and **91 npm packages**, 39 of them MCP servers in the main repo. Avatars, 3D generation, scenes, voice, vision, market data, notifications, billing, naming, provenance, home control, and more: every capability that felt independently useful became its own server, because publishing a server is quick and MCP lets each one stand alone.

Running a fleet that size taught us a lot about making servers safe, clear, and easy to find. This post is everything I would hand to someone publishing their second, fifth, or fiftieth server.

## The short version

1. **Enforce on the server.** Tool annotations describe; a server-side check decides.
2. **Ask for consent where a person can see it.** Keep the most consequential verbs on surfaces with a real human prompt.
3. **Verify your discovery metadata from outside, after every deploy.** It takes one curl.
4. **Keep free tools free by construction.** Different origin, different code, no payment imports.

Then organise the fleet by audience, share one typed tool layer across every server, and publish everywhere clients look.

## Principle 1: annotations describe, the server decides

MCP gives you `readOnlyHint`, `destructiveHint`, and `openWorldHint`. Set them accurately on every tool: reviewers check them, directory platforms rely on them, and clients use them to shape their UI.

They are **metadata for the client's interface**, and they shine at that job. Enforcement is a separate job, and it belongs on the server. That matters most for actions with real-world weight: "this spends forty dollars" and "this unlocks a door" each deserve their own explicit, server-side rule.

So we write the server-side check first and the interface second. A guard that lives in code holds whatever the conversation says. An assistant can be persuaded by a sentence; a 403 stays a 403.

## Principle 2: consent belongs where a person can see it

We publish a server that gives any assistant control of a real Home Assistant house: read the house, list entities, list scenes, run one, and call a service.

The most consequential calls (locks, primarily) pass through one physical-action gate, and **over stdio, that gate keeps door-opening for surfaces where a person can approve it.** A local stdio MCP server has no screen of its own and no session, so a meaningful approval belongs on a surface where a real person is shown a real prompt. The local server explains this clearly when asked, and owners who want their own assistant to open one specific door can grant that single entity explicitly through an environment variable.

We tested it the way an attacker would: spawned the server as a child process, spoke MCP to it, and tried to smuggle `{confirmed: true}` into the service data three different ways. The door stayed locked each time, and the explicit per-entity allowance opened exactly the door it named.

The pattern applies far beyond homes, to any stdio server that can spend money, send messages as a user, or move something physical.

## Principle 3: verify discovery metadata from outside

Our hosted server at `https://three.ws/api/mcp` sits behind OAuth 2.1, and a client's auth handshake starts by fetching `/.well-known/oauth-protected-resource` and its neighbours. Those documents are what make a correct server *discoverable* as a correct server.

So we check them from outside our network, in production, with curl, after every deploy:

```bash
curl -s https://three.ws/.well-known/oauth-protected-resource
```

It is a one-line check, it confirms the route table and the file layout agree in production exactly as they do locally, and it gives every client a smooth first connection.

## Principle 4: keep free tools free by construction

We ship a free 3D server and a paid one. The free one contains **no payment code at all**: different origin, different codebase, different deploy. Its claim to be free is something anyone can verify by reading its import list, which makes it a claim that stays true over time and makes directory review straightforward.

We allow one deliberate crossover, and it runs in the generous direction: a few assurance tools on the **paid** server are permanently free. The physics-readiness grade (`grade_sim_readiness`) is free, read-only, and idempotent on every track, because a free check gets run on every asset, which is exactly where it does the most good.

## How we organise the fleet

**1. One tightly scoped server per audience.** Our ChatGPT-facing server (`https://three.ws/api/mcp-chatgpt`) is exactly eight 3D tools and the model viewer, nothing else: keyless, no wallet, no account. Directories reward tightly scoped apps, so we submit one focused server per directory and document the rest as direct connections.

**2. One free studio server for every MCP client.** `https://three.ws/api/mcp-studio` carries fourteen keyless tools: the 3D tools, a ready-made asset catalog, and persona tools that turn a rigged model into a living agent body that speaks with lip-sync, emotion, and gesture.

**3. One hosted server for clients that want everything**, behind real OAuth 2.1, with discovery metadata verified on every deploy (Principle 3).

**4. Typed tool authoring, shared across servers.** We publish `@three-ws/tool-sdk`: `defineTool` declares a tool's identity, Zod schemas, and permission manifest once (JSON Schema is derived automatically), `defineExecutor` routes every call through one entry point that validates params, enforces the declared rate limit, and normalises success and failure into one result shape, and `toMcpTools` adapts the result into the registration shape our servers use. One error shape across every server means an agent learns it once and handles all of them well.

**5. Publish where clients look.** The official registry is the foundation: our servers live under `io.github.nirholas/*`. From there they are indexed on PulseMCP, Glama, and the LobeHub MCP marketplace, and installable as Claude Code plugins from our own plugin marketplace. Each surface brings a different audience, so we treat distribution as part of shipping.

## The one pattern that mattered most

If you take a single idea from this post, take this one.

A text-to-3D tool naturally answers with a **URL to a binary file**. A human clicks it and sees a model. An agent reads text and images, so we shipped a tool that renders a model into frames returned as MCP image content blocks. Now the agent can look at what it made, judge it, and iterate.

```bash
curl -s -X POST https://three.ws/api/3d/look \
  -H 'content-type: application/json' \
  -d '{"glb_url":"https://three.ws/avatars/cesium-man.glb"}'
```

It was a weekend of work and it transformed what the pipeline can do, because a loop thrives on a signal the agent can perceive. Pair it with `refine_model` (describe a change in words, get a new version with a branchable lineage) and you have a full generate, look, judge, refine cycle inside any MCP client.

**Any tool that hands an agent a binary benefits from a companion that renders it into the agent's own modality.** PDFs, spreadsheets, audio, CAD, compiled artifacts. Give your agent a way to perceive its own output and it moves from guessing to iterating.

## Partners across the fleet

three.ws takes part in eight partner programmes, and several of them meet the MCP fleet directly:

- **OpenAI (Select Partner).** The keyless 3D Studio connector brings three.ws 3D tools into ChatGPT, rendered interactively inline, and our custom GPT calls the same capabilities through an Actions contract. We also publish Spatial MCP, an open, CC0 response shape that makes a 3D scene a native MCP result, with three.ws as the reference implementation.
- **IBM (Business Partner).** The IBM Granite x402 MCP lets an MCP client reach Granite inference and settle per call from a wallet it already controls. Our Granite tools are independent developer tools built on IBM's publicly available Granite models.
- **Alibaba Cloud.** Our community-built `@three-ws/alibaba-cloud-mcp` exposes Qwen chat, embeddings, and model discovery on your own DashScope account to any MCP client, and Qwen models are first-class lanes in the platform's model router. three.ws is live on the Alibaba Cloud International Marketplace.
- **NVIDIA (Inception).** Every 3D generation tool in the fleet runs on NVIDIA GPUs, and NVIDIA-hosted models serve chat, vision, embeddings, and speech behind the scenes.
- **Google Cloud.** three.ws is a member of Google Cloud for Web3 Startups. Every hosted MCP server in this post is served from Cloud Run.
- **AWS (Partner), HackerNoon (Media), and Quicknode (Infrastructure)** complete the eight. HackerNoon syndicates our engineering posts, and Quicknode adds capacity to the Solana RPC chain behind agent wallets.

These are programme designations; the views here are our own. The full map is at [three.ws/partners](https://three.ws/partners).

## Try any of it

```bash
# 14 keyless tools, no account
curl -s https://three.ws/api/mcp-studio \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Everything is Apache-2.0 at [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws). The MCP docs are at [three.ws/docs/mcp](https://three.ws/docs/mcp).

If you publish MCP servers at any scale, I would love to hear how you handle namespacing and discovery. This approach works well for us, and I am always keen to compare notes.
