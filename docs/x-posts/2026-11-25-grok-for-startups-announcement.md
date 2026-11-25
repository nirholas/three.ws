# Grok for Startups announcement thread (2026-11-25)

The thread that announces three.ws joining xAI's Grok for Startups program, posted from @trythreews. Nine posts. The head image is the program card; every post after it shows proof instead of telling.

House voice: one link per post, no hashtags, no emoji, no dashes. Every post fits 280 characters (X counts each link as 23).

## The thread

**1/ (media: [`public/x-media/grok-startups-announce/head.png`](../../public/x-media/grok-startups-announce/head.png))**

> three.ws is a member of xAI's Grok for Startups program. Thank you @SpaceXSI.
>
> Grok was already using us before the email landed: 5,547 tool calls through our Grok connector in 44 days, traffic every single day, 2 errors.
>
> What the program is, and what Grok already does with us:

**2/**

> Grok for Startups gives a startup one credit balance across Grok, Grok Build, Grok Bot and the Grok API, sized to six to twelve months of real use, plus hands-on onboarding and a direct line to the startups team.
>
> We are putting it into 3D that works inside Grok.

**3/**

> Ask Grok for a 3D model and you get a real textured GLB back, with a link to spin it in your browser.
>
> Ask for a character and it comes back rigged, ready to animate. Ask for a change like "make it chrome" and it edits that model instead of starting over.

**4/**

> Grok also checks its own work. Before it answers, it can render the model and look at it, so a broken mesh gets caught before you see it.
>
> It has done that 426 times so far.

**5/ (media: [`public/anatomy/og/ffsc-engine.png`](../../public/anatomy/og/ffsc-engine.png))**

> It can explain how things work, too. This is a full flow staged combustion rocket engine as an interactive cutaway: 47 parts, a 10 step tour, every figure sourced.
>
> Spin it, explode it, slice it. https://three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249?utm_source=x&utm_campaign=grok-startups&utm_content=announce

**6/**

> It works where you already use Grok: a custom connector on grok.com, Grok Bot, Grok Build, Cursor and the xAI API. @ericzakariasson
>
> One URL, a free account, and no tool that can spend money. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=announce

**7/**

> Building on the Grok API? Six runnable examples: curl, Node on the Responses API, Python over MCP, a remote MCP tool call, an agent with a 3D avatar, and an X search turned into a 3D model. @XDevelopers https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=announce-examples#build-examples

**8/**

> Building a company on Grok? Apply for Grok for Startups. The form takes about five minutes, and approved teams get their first credits the same day. https://x.ai/startups

**9/**

> Reply with something you want to see in 3D. We will run the best ones through Grok and post the results in this thread.
>
> @grok, you go first: what should we build?

## Why it is built this way

- **Lead with usage, not the badge.** Every startup posts "we got in". Almost none can say the program's own product was already calling them every day. The 5,547 calls are the reason @SpaceXSI has to quote this rather than scroll past it.
- **Post 2 sells their program, post 8 sends founders to it.** A thread that explains what Grok for Startups gives a company and links the application is marketing for xAI, which is the strongest reason for @SpaceXSI to repost it. Every fact in post 2 is from their program page: one balance across the four Eligible Services, six to twelve months of real usage, hands-on onboarding, a direct line to the startups team. Post 8's "about five minutes" and "first credits the same day" are from the application page. Cursor is left out of post 2 because the Program Terms do not list it as an Eligible Service, even though the program page mentions it.
- **Each tag sits where that account has a reason to engage** ([who reshares what](../partners/xai-comarketing-kit.md#who-reshares-what)). @SpaceXSI (the former @xai) quote-posts third-party builds on the Grok API, so it goes in the head. @ericzakariasson works on Grok Bot and posts calls for connectors, so post 6. @XDevelopers features apps built on the X API, and post 7 has the X search example. @grok answers public tags in the thread, so post 9 gets a visible Grok reply under it. Add more if you like; this is a hand post, not the automated queue.
- **Never tag @bot.** That is functional, not etiquette: tagging it starts a task for each reader's own Grok Bot.
- **Post 9 is the reach engine.** Grok's reply seeds the thread, replies with prompts keep it alive for days, and every result posted back under it is fresh proof.
- **Token-free on purpose.** xAI-facing copy never mentions $THREE, a coin or trading ([plan rules](../partners/xai-grok-startups-plan.md#rules-that-bind-every-route)). Keep $THREE posts on a separate day from this thread.
- **Voice avatar and hero clips are held back.** Each gets its own post later from the kit's queue, so this thread only shows surfaces that run on production today.

## The image

[`scripts/grok-startups-announce-card.mjs`](../../scripts/grok-startups-announce-card.mjs) renders every option into `public/x-media/grok-startups-announce/` at 2x:

| File | Look | Use |
|---|---|---|
| `head.png` (1200x675), `head-square.png` (1080x1080) | Program card in the format SpaceXSI members post: our lockup, a wireframe torus, the badge "Super Intelligence \| Grok for Startups" | Post 1 (default) |
| `head.mp4`, `head-square.mp4` | The same card with the torus drifting in a seamless loop (`--motion`) | Post 1, if you want motion in the timeline |
| `pair.png`, `pair-dark.png` (1200x675) | Our lockup and the Grok logo split by a rule, in the format of Grok's integration announcements | Alternative head, or a reply |

The Grok and SpaceXAI marks are the owner-approved files from the `SpaceXAI_Grok_Assets` kit linked at [x.ai/legal/brand-guidelines](https://x.ai/legal/brand-guidelines), drawn unaltered with nothing beside them that reads as a combined mark ([plan rule](../partners/xai-grok-startups-plan.md#rules-that-bind-every-route)). The Program Terms grant the right to "state publicly that you participate in the Program" and say the program creates no partnership, so the copy around the image still never says partner. If SpaceXSI sends an official program badge, it replaces the badge block in the script.

```bash
node scripts/grok-startups-announce-card.mjs            # the four PNGs
node scripts/grok-startups-announce-card.mjs --motion   # head.mp4 and head-square.mp4
```

## Wording rules

- The only approved membership line: "three.ws is a member of xAI's Grok for Startups program."
- Never write "xAI partner", "partnered with xAI", "backed by xAI", "official Grok plugin" or "endorsed by SpaceX".
- Never state the credit amount, the team ID or a staff contact. The terms make the Approval Communication's non-public details confidential; membership itself is public by right.
- Full program terms and what they allow: [the plan](../partners/xai-grok-startups-plan.md#what-membership-actually-gives-us).

## Where the numbers come from

All figures cover 2026-10-08 to 2026-11-20 and are traced in the [co-marketing kit appendix](../partners/xai-comarketing-kit.md#appendix-where-every-number-comes-from): 5,547 tool calls on `/api/mcp-grok`, 2 errors, traffic on 44 of 44 days, 426 `look_at_model` render checks. The cutaway's 47 parts and 10 step tour come from its live design. To refresh the window up to posting day (needs `DATABASE_URL` from `.env.local`):

```bash
node scripts/grok-comarketing-numbers.mjs --from 2026-10-08 --to 2026-11-24
```

If the refreshed totals are higher, update posts 1 and 4 before posting.

## After posting

- Read results at 48 hours and 7 days: `npm run x:outcomes -- --refresh`, then `node scripts/grok-comarketing-numbers.mjs --clicks` (filters on `utm_content=announce`).
- Send email version 1 from the [co-marketing kit](../partners/xai-comarketing-kit.md#the-startups-team-email) to the startups team the same day, with the thread link.
