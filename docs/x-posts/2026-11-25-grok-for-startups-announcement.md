# Grok for Startups thread: corrected repost (2026-11-27)

The thread that says three.ws is in xAI's Grok for Startups program and shows what we built on Grok, posted from @trythreews. Ten posts. It replaces the thread of 2026-11-25.

House voice: one link per post, no hashtags, no emoji, no dashes. The account has X Premium, so posts run long, but the timeline cuts each one at about 280 characters behind "Show more": the opening of every post (everything before its first extra paragraph) fits 280 on its own and is the hook, and the paragraphs after it are the substance for readers who open it.

## Correction note (2026-11-27)

The original thread went out on 2026-11-25 and came down on 2026-11-27 at xAI's request. The Grok for Startups team told us that being accepted gives access to credits and does not include co-marketing or the other items the thread claimed. This file is the corrected version. Every claim left in it has a source in [Sources](#sources); a claim with no source was cut.

What changed, and why:

- **Post 1, "the first crypto-native company approved":** removed. xAI publishes no member list, so it cannot be proven.
- **Post 1, "working directly with the xAI, @SpaceXSI and Cursor teams on co-marketing":** removed. It was false: the program is a credit program, not co-marketing and not a partnership.
- **Post 1, "our plugin is headed to the Grok Bot, Grok Build and @cursor_ai marketplaces":** removed. Nothing has been submitted to any marketplace (the submission log in the listings doc is empty).
- **Post 3, "Grok checks its own work" and "This one looks first":** now "Grok can check its own work". The render check runs only when Grok chooses to call it, so the guarantee is gone.
- **Post 3, "426 checks so far":** removed. It could not be re-run on the day of the rewrite, and it counted every caller of the tool, our own tests included.
- **Post 5, "works everywhere you use Grok":** now names only the two surfaces with recorded use, the grok.com custom connector and Grok Bot. Grok Build never ran a model turn, the xAI API refused our tools in production from 2026-11-21, and Cursor connects but lists us nowhere.
- **Post 6, "One command runs all six against production, so you know they work" and "82 seconds":** removed. Both were measured with no xAI key, so they proved our side only. The post now says exactly that.
- **Post 7, "Grok was using us before we got in", "Traffic every single day", "2 errors" and "written by people and agents we have never met":** removed. The call count includes our own testing, and the prompt figure is a text match against our repository, not proof of who wrote a prompt. The post now states what was counted.
- **Post 8, "xAI vets every applicant" and "Guides to the program say it looks for venture-backed startups":** removed. Both were unsourced statements about xAI's process.
- **Tags:** @SpaceXSI, @cursor_ai, @ericzakariasson and @XDevelopers are gone. A tag on an xAI, SpaceXSI or Cursor account implies that account took part.
- **Added, post 10:** the Ask @grok button, verified live on production the day of the rewrite.
- **Kept word for word:** posts 2, 4 and 9 (post 4 only swaps its link tag to `utm_content=repost`).

Source documents the rest of this file cites by short name:

- **Numbers appendix:** [docs/partners/xai-comarketing-kit.md, appendix](../partners/xai-comarketing-kit.md#appendix-where-every-number-comes-from)
- **Listings doc:** [docs/partners/grok-bot-listings.md](../partners/grok-bot-listings.md)
- **Program summary:** [docs/partners/xai-grok-startups-plan.md, what membership gives us](../partners/xai-grok-startups-plan.md#what-membership-actually-gives-us)

[kit]: ../partners/xai-comarketing-kit.md#appendix-where-every-number-comes-from
[listings]: ../partners/grok-bot-listings.md
[plan]: ../partners/xai-grok-startups-plan.md#what-membership-actually-gives-us

## Before posting

1. Delete the 2026-11-25 thread.
2. Do not post while xAI refuses our tool catalog. On 2026-11-27 production (`f0eed584f`) still published a tool whose schema root is an `anyOf` union, which makes the xAI API reject every three.ws tool; the fix is commit `a99f32c10`, not yet deployed. Run this, and post only when both lines end in `rejected: []`:

```bash
for p in mcp-grok mcp-studio; do curl -s https://three.ws/api/$p -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=JSON.parse(s.replace(/^data: /m,""));const bad=m.result.tools.filter(t=>{const r=t.inputSchema||{};return r.type!=="object"||["anyOf","oneOf","allOf","not","if","then","else","enum","const"].some(k=>k in r)}).map(t=>t.name);console.log(process.argv[1],m.result.tools.length,"tools, rejected:",bad)})' $p; done
```

3. Post 6 needs more than that check: its examples call Grok through the xAI API. Post it only once a run with a real xAI key is recorded in [grok-fix-PROGRESS.md](../../prompts/finish/_context/grok-fix-PROGRESS.md). Until then, leave post 6 out; the thread reads fine without it.
4. If a later proof lands (the xAI API or Grok Build shown working live), that surface gets its own post. Do not edit it into post 5 without adding its source below.

## The thread

**1/ (media: [`public/x-media/grok-startups-announce/head.png`](../../public/x-media/grok-startups-announce/head.png), or no image; see [The image](#the-image))**

> xAI accepted three.ws into Grok for Startups, the program that gives startups credits to build on Grok.
>
> This thread is what we built on it: a connector that lets Grok make things in 3D.
>
> In plain terms: you add three.ws to Grok, ask for something in 3D, and get back a real model you can spin, download, animate or drop into a page. No 3D software and no modeling skills.
>
> Every number in this thread comes from our own production logs or our own test runs.

**2/**

> Ask Grok for a 3D model and get a real, textured GLB you can spin in your browser.
>
> Ask for a character and it comes back rigged, ready to animate. Say "make it chrome" and it edits that model instead of starting over.
>
> Every change is saved as a new version, so you can jump back to any earlier one or branch off in a new direction. Start from a sentence or from an image.
>
> Signed out, Grok searches a library of free CC0 assets first. With a free account, everything it makes lands in your own library, unlisted until you choose to publish it.

**3/**

> Grok can check its own work. The connector gives it a tool that renders a model and hands back the pictures, so it can look at what it made before it answers.
>
> The check returns the model from several angles, plus its triangles, materials and textures. Grok can see whether the chair actually has four legs, whether the back is finished, whether anything melted together, and then regenerate, naming the fault it found.
>
> It runs when Grok chooses to call it, not on every model.

**4/ (media: [`public/x-media/grok-startups-announce/ffsc-engine.mp4`](../../public/x-media/grok-startups-announce/ffsc-engine.mp4), still fallback [`public/anatomy/og/ffsc-engine.png`](../../public/anatomy/og/ffsc-engine.png))**

> three.ws also explains how machines work. This is a full flow staged combustion rocket engine as an interactive cutaway: 47 parts, a 10 step tour, every figure sourced.
>
> Spin it. Explode it. Slice it.
>
> The tour walks the whole loop: two cryogenic propellants, two turbopumps on two shafts, a fuel-rich and an oxygen-rich preburner, and every drop of propellant driven through a turbine before it burns. Methane cools the engine, gas meets gas in the main chamber, and it all leaves through the throat and the bell.
>
> Every number cites a public source, and our build fails if one doesn't. https://three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249?utm_source=x&utm_campaign=grok-startups&utm_content=repost

**5/**

> It runs as a custom connector on grok.com and in Grok Bot.
>
> One URL, a free account, and no tool that can spend money.
>
> It is one remote MCP server behind both, so there is nothing to install twice and nothing to keep in sync. A plain request comes back with a viewer link, the GLB, a poster image and embed code. Our own check script timed the path from signing in to a finished model at 195.8 seconds on production, and Grok Bot clients registered with the server 31 times between October 8 and November 20.
>
> The connector can also keep a body for Grok: save a rigged character as a persona, and its view lip-syncs, emotes and gestures each reply, the same body every session. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost

**6/ (hold until step 3 of [Before posting](#before-posting) is met)**

> Building on the Grok API? We published six runnable examples, including plain curl, Node on the Responses API, Python over MCP, an agent with a 3D avatar, and an X search turned into a 3D model.
>
> The three.ws side of each one is tested against production. The Grok side runs on your own xAI key.
>
> The X search example asks Grok to sum up what people posted about a topic this week, then designs a prop for it and drafts a post. It never posts on its own. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost-examples#build-examples

**7/**

> 5,547 tool calls on our Grok connector in 44 days, from October 8 to November 20.
>
> 1,243 of those calls asked for a model to be made or changed: 517 text to 3D requests, 283 avatar requests, 236 art-directed mesh requests, 118 rig requests and 89 refinements. Those are requests, not finished models, and the total includes our own testing.
>
> The number we watch most: 718 distinct prompts that don't match our own tests or demos.

**8/**

> No VC money built three.ws. When we applied to Grok for Startups, we listed how we are actually funded: our @pumpdotfun creator rewards.
>
> xAI accepted three.ws into the program. This one is for everyone who built it with us.
>
> We had a product people were already using, and a community that paid for it to exist.

**9/**

> Your turn. Ask Grok for anything in 3D and see what comes back.
>
> A character for your game, a prop for your scene, a product for your store, a machine you want to understand.
>
> @grok, what should we build next?

**10/**

> One more way in: models, avatars and cutaways on three.ws have an Ask @grok button beside Share on X.
>
> It writes a short description and one question about what you are looking at, opens it in the X composer, and posts nothing until you press post. https://three.ws/forge?utm_source=x&utm_campaign=grok-startups&utm_content=repost

## Why it is built this way

- **The head states membership and nothing more.** "xAI accepted three.ws into Grok for Startups" is the claim the Program Terms let a member make. The post says what the program is (credits to build on Grok) so no reader takes it for an investment, an endorsement or a joint effort.
- **"Can", never "does".** Grok decides which tools to call. Posts 3 and 5 describe what the connector makes possible and say when a behavior is Grok's choice.
- **Only surfaces with recorded use.** Post 5 names the grok.com custom connector and Grok Bot because both have OAuth registrations in production. A surface is added only with a dated live proof, as its own post.
- **Numbers say what was counted.** Post 7 gives the window, calls its figures requests, and says the total includes our own testing. The prompt figure is described by its method (prompts that match nothing in our tests or demos), not by a guess about who wrote them.
- **Post 8 says only what we put on our own application.** It makes no statement about how xAI chooses members and quotes nothing from the acceptance email.
- **Tags.** No xAI, SpaceXSI or Cursor account or employee is tagged: a tag implies that account took part. @pumpdotfun is tagged in post 8 because the post names it as our funding source (owner decision 2026-11-25, reaffirmed for this repost). @grok appears in post 9 as a public question to the bot, which answers in thread, and in post 10 as the literal name of the button.
- **Never tag @bot.** That is functional, not etiquette: tagging it starts a task for each reader's own Grok Bot.
- **Post 9 asks, it does not promise.** It commits us to nothing we would have to deliver later.
- **Token-free.** The thread says three.ws comes from crypto and names its funding source, and stops there: no $THREE, no contract address, no price, no trading.
- **Confident, not shilly.** Short declarative sentences, concrete numbers and verbs that show the product doing something. No hype words, no countdowns.

## The image

[`scripts/grok-startups-announce-card.mjs`](../../scripts/grok-startups-announce-card.mjs) renders the card into `public/x-media/grok-startups-announce/` at 2x:

| File | Look | Use |
|---|---|---|
| `head.png` (1200x675), `head-square.png` (1080x1080) | Program card: our lockup, a wireframe torus, the badge "Super Intelligence \| Grok for Startups" | Post 1, optional |
| `head.mp4`, `head-square.mp4` | The same card with the torus drifting in a seamless loop (`--motion`) | Post 1, if you want motion in the timeline |

The badge uses the SpaceXAI mark from the `SpaceXAI_Grok_Assets` kit linked at [x.ai/legal/brand-guidelines](https://x.ai/legal/brand-guidelines), drawn unaltered. The Program Terms grant the right to "state publicly that you participate in the Program", which is all the card says. Still, the mark is xAI's and they asked for the last thread to come down: if there is any doubt, post 1 goes out with no image. The script also renders `pair.png` and `pair-dark.png` (our lockup beside the Grok logo). They are not used here, because two logos side by side read as a joint announcement.

```bash
node scripts/grok-startups-announce-card.mjs            # the PNGs
node scripts/grok-startups-announce-card.mjs --motion   # head.mp4 and head-square.mp4
```

### Post 4 video

`ffsc-engine.mp4` is the live cutaway recorded from production: 1920x1080, 30 fps, about 18 seconds, captioned "Spin it", "Explode it", "Slice it" and "Take the tour" to match the post. [`scripts/anatomy-cutaway-video.mjs`](../../scripts/anatomy-cutaway-video.mjs) virtualizes the page's clock and steps it one frame at a time, so the video plays smoothly even though this machine renders WebGL in software. Rerender (about 25 minutes without a GPU; `--preview` writes one still per scene in a few minutes):

```bash
node scripts/anatomy-cutaway-video.mjs --id 85160213-4c15-4b00-ba96-5990b9385249 --out public/x-media/grok-startups-announce/ffsc-engine.mp4
```

## Wording rules

- The approved membership line is "three.ws is a member of xAI's Grok for Startups program." Post 1 uses the equivalent "xAI accepted three.ws into Grok for Startups."
- The program is a startup credit program. Nothing in the thread may say or imply more than that. The full list of banned phrasings is the "Saying it correctly" section of [grok-startups-00-CONTEXT.md](../../prompts/finish/_context/grok-startups-00-CONTEXT.md).
- Never state the credit amount, the team ID or a staff contact, and never name or quote xAI staff.

## Sources

Checked on 2026-11-27 unless a line gives another date. "Live tools/list" means `curl -s https://three.ws/api/mcp-grok -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`, which returned 21 tools.

**Post 1**

- Accepted into the program; the program gives credits: the [program summary][plan] (acceptance dated 2026-11-20; the Program Terms allow a member to state that it participates).
- Ask for 3D and get a model you can spin, download, animate or embed: live tools/list (`forge_free`, `rig_mesh`, `forge_avatar`) and the result fields in [docs/mcp-studio.md](../mcp-studio.md).
- Numbers come from production logs or our own test runs: the entries below.

**Post 2** (kept as written)

- Textured GLB from text, rigged characters, edit instead of restart, saved versions you can revert to or branch from, text or image input: live tools/list descriptions of `forge_free`, `forge_avatar`, `refine_model` and `mesh_forge`.
- Signed-out catalog search of CC0 assets, and a free account whose results stay unlisted until published: live tools/list description of `search_catalog`, and the connector fields in the [listings doc][listings].

**Post 3**

- The render check, what it returns, and that it is a tool Grok calls: live tools/list description of `look_at_model` ("Renders the GLB from several angles and returns the frames as images", with triangles, materials and textures).

**Post 4** (kept as written)

- 47 parts and the 10 step tour: [api/_lib/anatomy/featured/ffsc-engine.js](../../api/_lib/anatomy/featured/ffsc-engine.js) (30 part entries, one of them repeated 18 times, so 47 rendered parts; 10 steps, whose titles the post paraphrases).
- Every figure sourced, and a failing test otherwise: [tests/anatomy-featured.test.js](../../tests/anatomy-featured.test.js) against [docs/anatomy/rocket-engines-sources.md](../anatomy/rocket-engines-sources.md), commit `58bf8efe3`.

**Post 5**

- grok.com custom connector and Grok Bot: OAuth registrations in the [numbers appendix][kit] (Grok Bot 31, 2026-10-08 to 2026-11-20; Grok 2, 2026-08-28), run on 2026-11-20.
- No tool that can spend money: live tools/list (21 tool names, none of them a wallet, payment, transfer or trade tool).
- One remote MCP server: both surfaces add `https://three.ws/api/mcp-grok` ([listings doc][listings], "The text we submit").
- Viewer link, GLB, poster image and embed code, and the 195.8 second path: the measured run of `node scripts/grok-connector-review-check.mjs` on 2026-11-20, recorded in the [listings doc][listings] and in [docs/grok-bot.md](../grok-bot.md). It is our script driving the connector, not a session inside Grok Bot, which is why the post says "our own check script".
- Persona: live tools/list descriptions of `create_agent_persona` and `persona_say`.

**Post 6**

- Six runnable examples and what each does: [examples/grok/README.md](../../examples/grok/README.md), public at github.com/nirholas/three.ws/tree/main/examples/grok (HTTP 200).
- The three.ws side tested against production: `npm run grok:examples-smoke`, 6 of 6 passing on 2026-11-20, entry "07 examples pack" in [grok-startups-PROGRESS.md](../../prompts/finish/_context/grok-startups-PROGRESS.md). That run had no xAI key, which is why the post claims nothing about the Grok side.
- The X search example never posts: [examples/grok-x-search-to-3d](../../examples/grok-x-search-to-3d/) and its unit tests.

**Post 7**

- 5,547 tool calls, the 44 day window, 1,243 generation calls (517 `forge_free`; 211 `forge_avatar` plus 72 `text_to_avatar` as 283 avatar requests; 236 `mesh_forge`; 118 `rig_mesh`; 89 `refine_model`) and 718 prompts: the [numbers appendix][kit], from `node scripts/grok-comarketing-numbers.mjs --from 2026-10-08 --to 2026-11-20` run on 2026-11-20 against the production database.
- "Requests, not finished models": the script's own note on its generation tool list.
- "Don't match our own tests or demos": the 718 is 734 distinct prompts minus the 16 whose first 60 characters appear in a corpus built from our repository.
- Not re-run on 2026-11-27: the build machine had no database access that day. Rerun the command before posting and update the figures if they moved. The five-minute uptime probe (`api/cron/mcp-probe.js`) was not yet deployed on 2026-11-21 ([grok-startups-PROGRESS.md](../../prompts/finish/_context/grok-startups-PROGRESS.md)), so it is not in this window; probe runs we made by hand are, as part of our own testing.

**Post 8**

- No venture funding, and creator rewards listed as funding on our application: the owner's own application, as recorded in this file's earlier revision (commit `f52be3c1d`).
- Accepted into the program: as post 1.

**Post 9** (kept as written)

- A question, not a claim.

**Post 10**

- The button exists and is live: [src/shared/share.js](../../src/shared/share.js) and [src/shared/grok-ask.js](../../src/shared/grok-ask.js) (commit `c6cff9a25`); the text "Ask @grok about it" is in production's `share` bundle, which both the model page bundle (`/m/<id>`) and the cutaway page bundle import.
- Drafts a description and one question, opens the X composer, posts nothing itself: `src/shared/grok-ask.js` builds an X intent link and nothing else.

**Links** (each returned HTTP 200 on 2026-11-27)

- `https://three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249?utm_source=x&utm_campaign=grok-startups&utm_content=repost`
- `https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost`
- `https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost-examples#build-examples` (the page has an element with `id="build-examples"`)
- `https://three.ws/forge?utm_source=x&utm_campaign=grok-startups&utm_content=repost`

## After posting

- Read results at 48 hours and 7 days: `npm run x:outcomes -- --refresh`, then `node scripts/grok-comarketing-numbers.mjs --clicks` (it groups landings by `utm_content`; this thread's links carry `repost` and `repost-examples`).
- If @grok or anyone at xAI replies, the owner answers by hand or not at all.
