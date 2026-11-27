# Reply to the Grok Bots "specialized roles" post (2026-11-27)

A reply from @trythreews to Elon Musk's post of 2026-11-27, and the build the reply commits us to. Not posted yet. Posting is an owner step.

## The post we are replying to

> When using Grok Bots, it is important to create Bots with specialized roles, just like a human company. You can then have a manager bot oversee and coordinate their work.
>
> Just like a human employee, if you overload a single bot with a massive array of work, it will start dropping some of the balls.

## The idea: a 3D studio staffed by Grok Bots

One Bot that does everything in 3D drops balls the same way: it skips the catalog search, forgets to check the mesh, or rigs a model nobody approved. So we split the three.ws connector into the jobs a real 3D studio has, one Bot per job, with the user's primary Bot as the producer.

- **Producer (the primary Bot).** Takes the brief, splits it into tasks, tracks every job and delivers the finished pack.
- **Scout.** Searches the free CC0 catalog first, so nothing is generated that already exists (`search_catalog`, `get_catalog_item`).
- **Sculptor.** Makes and edits models (`forge_free`, `mesh_forge`, `refine_model`).
- **Rigger.** Turns approved characters into animation-ready avatars (`rig_mesh`, `forge_avatar`, `text_to_avatar`).
- **Art director.** Makes nothing. Renders each model, looks at it and sends it back with the fault named (`look_at_model`).

The part only a 3D platform can add: the studio floor. A live page where every Bot has a body at its own desk and the brief moves across the room as the work is handed over, so you watch the company work instead of reading five chat logs.

## The reply

**Recommended (opening fits 280 characters, one link):**

> We're building exactly this for 3D: a studio staffed by Grok Bots, one job each.
>
> A scout that searches free assets before anything gets generated. A sculptor that makes the model. A rigger. An art director that makes nothing, only renders the work and sends it back with the fault named. Your primary Bot runs the brief.
>
> And because it's 3D, you can watch the company work: every Bot gets a body and a desk. The tools are live on our connector today. The crew is next. https://three.ws/grok?utm_source=x&utm_campaign=grok-bots-crew&utm_content=reply

**Short alternate (no link, for speed and reach):**

> One Bot that scouts, one that sculpts, one that rigs, one that only checks the work, and a manager that runs the brief.
>
> We're building that 3D studio crew for Grok Bots on three.ws, with a floor where you can watch them work.

Reply within the first minutes if possible. Replies under a post this size are buried fast, and the early ones collect most of the views.

## Follow-up when it ships

Reply to our own reply with a screen recording of the studio floor running one real brief end to end (for example "a game-jam prop pack with one rigged mascot"), the measured time, and the link to the role cards. Media is what makes the follow-up travel, and it has to be a recording of the real thing on production, never a concept render.

## What the reply commits us to build

What exists today, and is what "the tools are live" refers to:

- The connector at `https://three.ws/api/mcp-grok` with every tool named above ([docs/grok-bot.md](../grok-bot.md)).
- The render-and-check loop (`look_at_model`), and the Grok Bot task templates on [/grok](../../pages/grok.html).
- A body for a Bot: a rigged persona saved with `create_agent_persona` that lip-syncs and gestures.
- Lead-and-team orchestration for three.ws agents, with a live task graph ([api/_lib/agent-orchestrate.js](../../api/_lib/agent-orchestrate.js), [src/shared/collab-graph.js](../../src/shared/collab-graph.js)), and a 3D presence room ([docs/crews.md](../crews.md)).

What is new work:

1. **Role cards.** One paste-ready first message per Bot on `/grok` and in [docs/grok-bot.md](../grok-bot.md). Grok Bot has no instructions field: a Bot learns its job from its first message, so the card is that message. Each card names the only tools that Bot may call and what it hands to the next Bot.
2. **A shared production board on the connector.** Bots keep separate memory, so the handover needs shared state rather than chat: a brief, tasks tagged by role, claim, deliver, review, sign-off. A handful of new MCP tools over one table, so the producer always knows what is open and the art director's rejection lands on the sculptor's list.
3. **The studio floor.** A live 3D page per brief: a desk and a body per role, the task graph we already draw for agent collaboration, and the model on each desk as it changes.
4. **One measured run on production** before the follow-up post: a real brief, real Bots, the time and the result.

## Facts this rests on

- A user can create several Bots, each with its own name, picture, conversation and memory. "Most Bots work best with one clear job." ([docs.x.ai/grok-bot/bots](https://docs.x.ai/grok-bot/bots), read 2026-11-27)
- The primary Bot "checks in with you on its own and coordinates work with your other Bots." That is the manager in the post. ([docs.x.ai/grok-bot/bots](https://docs.x.ai/grok-bot/bots))
- Bots "pass context through direct messages, group chats, and shared files", and they share one computer. xAI says Bots are not separated from each other, so the role cards limit what a Bot does by instruction, not by access. Do not claim per-Bot isolation.
- Whether a connector belongs to one Bot or to all of a user's Bots is not stated in the docs. Confirm it on a real account before writing the role cards.

## Wording rules

- Same as the repost thread ([2026-11-27-grok-for-startups-repost.md](2026-11-27-grok-for-startups-repost.md#wording-rules)): never "xAI partner", "official", "endorsed" or anything that says xAI is working with us on marketing. The reply does not mention the Grok for Startups program at all.
- Never tag @bot (it starts a task for each reader's own Bot). No hashtags, no emoji, no dashes. Never name $THREE, a contract address, a price or trading.
- Everything not yet built stays in the future tense. The only present-tense claim is that the tools are live on the connector.
