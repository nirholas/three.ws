# Grok for Startups announcement thread (2026-11-25)

The thread that announces three.ws joining xAI's Grok for Startups program, posted from @trythreews. Seven posts. The head image is the logo lockup; every post after it shows proof instead of telling.

House voice: one link per post, no hashtags, no emoji, no dashes. Every post fits 280 characters (X counts each link as 23).

## The thread

**1/ (media: [`public/x-media/grok-startups-announce/head.png`](../../public/x-media/grok-startups-announce/head.png))**

> three.ws is a member of xAI's Grok for Startups program. Thank you @SpaceXSI.
>
> Grok was already using us before the email landed: 5,547 tool calls through our Grok connector in 44 days, traffic every single day, 2 errors.
>
> Here is what Grok can do with it.

**2/**

> Ask Grok for a 3D model and you get a real textured GLB back, with a link to spin it in your browser.
>
> Ask for a character and it comes back rigged, ready to animate. Ask for a change like "make it chrome" and it edits that model instead of starting over.

**3/**

> Grok also checks its own work. Before it answers, it can render the model and look at it, so a broken mesh gets caught before you see it.
>
> It has done that 426 times so far.

**4/ (media: [`public/anatomy/og/ffsc-engine.png`](../../public/anatomy/og/ffsc-engine.png))**

> It can explain how things work, too. This is a full flow staged combustion rocket engine as an interactive cutaway: 47 parts, a 10 step tour, every figure sourced.
>
> Spin it, explode it, slice it. https://three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249?utm_source=x&utm_campaign=grok-startups&utm_content=announce

**5/**

> It works where you already use Grok: a custom connector on grok.com, Grok Bot, Grok Build, Cursor and the xAI API. @ericzakariasson
>
> One URL, a free account, and no tool that can spend money. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=announce

**6/**

> Building on the Grok API? Six runnable examples: curl, Node on the Responses API, Python over MCP, a remote MCP tool call, an agent with a 3D avatar, and an X search turned into a 3D model. @XDevelopers https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=announce-examples#build-examples

**7/**

> Reply with something you want to see in 3D. We will run the best ones through Grok and post the results in this thread.
>
> @grok, you go first: what should we build?

## Why it is built this way

- **Lead with usage, not the badge.** Every startup posts "we got in". Almost none can say the program's own product was already calling them every day. The 5,547 calls are the reason @SpaceXSI has to quote this rather than scroll past it.
- **Each tag sits where that account has a reason to engage** ([who reshares what](../partners/xai-comarketing-kit.md#who-reshares-what)). @SpaceXSI (the former @xai) quote-posts third-party builds on the Grok API, so it goes in the head. @ericzakariasson works on Grok Bot and posts calls for connectors, so post 5. @XDevelopers features apps built on the X API, and post 6 has the X search example. @grok answers public tags in the thread, so post 7 gets a visible Grok reply under it. Add more if you like; this is a hand post, not the automated queue.
- **Never tag @bot.** That is functional, not etiquette: tagging it starts a task for each reader's own Grok Bot.
- **Post 7 is the reach engine.** Grok's reply seeds the thread, replies with prompts keep it alive for days, and every result posted back under it is fresh proof.
- **Token-free on purpose.** xAI-facing copy never mentions $THREE, a coin or trading ([plan rules](../partners/xai-grok-startups-plan.md#rules-that-bind-every-route)). Keep $THREE posts on a separate day from this thread.
- **Voice avatar and hero clips are held back.** Each gets its own post later from the kit's queue, so this thread only shows surfaces that run on production today.

## The image

The head is our logo beside the program name in plain type, rendered by [`scripts/grok-startups-announce-card.mjs`](../../scripts/grok-startups-announce-card.mjs) at 2400x1350.

**No xAI, Grok or SpaceX logo appears on it, on purpose.** The plan only allows those marks nominatively, as plain words, and no published xAI brand kit covers a co-branded lockup. Using their logo would also read as the "xAI partner" claim the program wording forbids. If the startups team sends an approved program mark (ask in email version 1 of the kit), rerender with it:

```bash
node scripts/grok-startups-announce-card.mjs --partner-logo path/to/approved-mark.svg
```

## Wording rules

- The only approved membership line: "three.ws is a member of xAI's Grok for Startups program."
- Never write "xAI partner", "partnered with xAI", "backed by xAI", "official Grok plugin" or "endorsed by SpaceX".
- Never state the credit amount, the team ID or a staff contact.

## Where the numbers come from

All figures cover 2026-10-08 to 2026-11-20 and are traced in the [co-marketing kit appendix](../partners/xai-comarketing-kit.md#appendix-where-every-number-comes-from): 5,547 tool calls on `/api/mcp-grok`, 2 errors, traffic on 44 of 44 days, 426 `look_at_model` render checks. The cutaway's 47 parts and 10 step tour come from its live design. To refresh the window up to posting day (needs `DATABASE_URL` from `.env.local`):

```bash
node scripts/grok-comarketing-numbers.mjs --from 2026-10-08 --to 2026-11-24
```

If the refreshed totals are higher, update posts 1 and 3 before posting.

## After posting

- Read results at 48 hours and 7 days: `npm run x:outcomes -- --refresh`, then `node scripts/grok-comarketing-numbers.mjs --clicks` (filters on `utm_content=announce`).
- Send email version 1 from the [co-marketing kit](../partners/xai-comarketing-kit.md#the-startups-team-email) to the startups team the same day, with the thread link.
