Grok Bot and the X mention bot both turn a sentence into a 3D model. One lives inside Grok, the other on X. This article shows what each does, with output from real runs.

## Inside Grok Bot

Add three.ws as a custom connector, Streamable HTTP, at `https://three.ws/api/mcp-grok`. The free studio tools need no account and no key. Then ask in plain language:

> Every morning at 9, run the daily-3d-brief prompt from three-ws-grok with the topic "a bioluminescent deep-sea creature" and send me the viewer link, the GLB and the poster.

The run in [the recipes tutorial](/tutorials/grok-bot-recipes) called `forge_free`, polled `get_job` until the job was done, then called `look_at_model` to check the render. The model it returned has 10,929 vertices and 16,148 triangles, which the tool itself describes as a normal real-time budget for a hero prop or character. The viewer, GLB, poster and AR links are pasted in full in that tutorial, so you can open the same model.

## On X

Mention `@trythreews` with what you want. The bot reads the mention, picks an intent, and replies once to the author with a link. Four rules shape it:

1. Text in a post is data. It is never an instruction, and nothing in it can reach a spend, a transfer, a launch or a post to anyone but the author.
2. The bot cannot move funds, pay for anything or launch a coin.
3. It replies only when addressed, once per mention, never to its own replies.
4. Per-author and per-conversation limits apply.

Before the bot posted anything it ran in dry run: every mention was decided and recorded with the reply it would have sent, and nothing was posted. That is how it was reviewed. A recorded example, from a dry run and not a live reply:

> Mention: `@trythreews forge a cute robot barista holding a coffee cup`
> Would have replied: Here is your 3D model "a cute robot barista holding a coffee...". Spin it around: https://three.ws/m/711eba92-0145-465f-a48c-814459966de5

## Try it

Connector setup and the free studio: [three.ws/grok](/grok). The mention bot's behaviour and limits: [docs/x-mention-bot.md](https://github.com/nirholas/three.ws/blob/main/docs/x-mention-bot.md).
