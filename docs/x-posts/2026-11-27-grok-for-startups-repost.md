# Grok for Startups repost thread (2026-11-27)

The thread that reposts three.ws's Grok for Startups announcement from @trythreews, with everything we built on Grok since. Nineteen posts. Owner decision 2026-11-27: keep the original nine posts as written, remove only the co-marketing clause from post 1, and add the new Grok work. The original went out on 2026-11-25 and came down on 2026-11-27 at xAI's request (the program gives credits; it does not include co-marketing).

House voice: one link per post, no hashtags, no emoji, no dashes. The account has X Premium, so posts run long, but the timeline cuts each one at about 280 characters behind "Show more": the opening of every post (everything before its first extra paragraph) fits 280 on its own and is the hook, and the paragraphs after it are the substance for readers who open it.

## Status: final assembly runs last

This draft is complete except for post 14 and the refreshed numbers. Order [452](../../prompts/finish/452-grok-fix-02-repost-thread-honest.md) runs after orders 451, 454, 456, 457 and 458 and makes it postable: it refreshes posts 3, 15 and 16, fills post 14 from the measured evals, confirms every surface each post names is live, checks every link and prints the final thread. Post nothing until that order has run. Delete the 2026-11-25 thread first.

The `[NEW]` markers are notes for us, not post text. Strip them when pasting.

## What changed from the 2026-11-25 thread

- **Post 1:** "Now we're working directly with the xAI, @SpaceXSI and Cursor teams on co-marketing" is gone. @SpaceXSI stays as a plain company mention at the end of the opening line, with no relationship claim.
- **Post 6:** the personal tag @ericzakariasson is gone. Tags are company accounts only, never individual staff (owner, 2026-11-27).
- **Post 15:** "2 errors" is gone from the text, and the usage card shows the 718 distinct prompts in that slot instead (owner, 2026-11-27).
- Nothing else in the original nine (now posts 1 to 4, 6, 8, 15, 18 and 19) changed.
- **Links:** `utm_content=announce` became `utm_content=repost` (and `repost-<post>` on the new posts) so the repost's clicks count separately.
- **Added:** posts 5 (launch stack cutaway), 7 (Grok Build and Cursor plugins), 9 (Grok 3D starter app), 10 (Grok Bot task templates and one-command setup), 11 (three.ws webhooks wake Grok Bot), 12 (360 capture), 13 (agents on Grok with your own key), 14 (measured evals), 16 (public connector uptime) and 17 (Ask @grok).

[docs/x-posts/2026-11-25-grok-for-startups-announcement.md](2026-11-25-grok-for-startups-announcement.md) now holds a stricter rewrite (commit `ed86dc046`) that also cut "first crypto-native" and the marketplace line. The owner kept both, so this file is the one to post. The original thread and its full rationale (tags, image, wording) are at commit `70478517f`: `git show 70478517f:docs/x-posts/2026-11-25-grok-for-startups-announcement.md`.

## The thread

**1/ (media: [`public/x-media/grok-startups-announce/head.png`](../../public/x-media/grok-startups-announce/head.png))**

> three.ws is the first crypto-native company approved for xAI's Grok for Startups program.
>
> Grok builds in 3D with us, and our plugin is headed to the Grok Bot, Grok Build and @cursor_ai marketplaces.
>
> In plain terms: you ask Grok for something in 3D, and you get back a real model you can spin, download, animate or drop into a page. No 3D software, no modeling skills, no new app to learn. Just the Grok you already use.
>
> Every number in this thread comes from our own production logs.

**2/**

> Ask Grok for a 3D model and get a real, textured GLB you can spin in your browser.
>
> Ask for a character and it comes back rigged, ready to animate. Say "make it chrome" and it edits that model instead of starting over.
>
> Every change is saved as a new version, so you can jump back to any earlier one or branch off in a new direction. Start from a sentence or from an image.
>
> Signed out, Grok searches a library of free CC0 assets first. With a free account, everything it makes lands in your own library, unlisted until you choose to publish it.

**3/**

> Grok checks its own work. Before it answers, it can render the model and look at it, so a broken mesh gets caught before you ever see it.
>
> 426 checks so far.
>
> The check returns the model from several angles, plus its triangles, materials and textures. Grok can see whether the chair actually has four legs, whether the back is finished, whether anything melted together, and then regenerate, naming the fault it found.
>
> Most AI tools hand you whatever came out. This one looks first.

**4/ (media: [`public/x-media/grok-startups-announce/ffsc-engine.mp4`](../../public/x-media/grok-startups-announce/ffsc-engine.mp4), still fallback [`public/anatomy/og/ffsc-engine.png`](../../public/anatomy/og/ffsc-engine.png))**

> three.ws also explains how machines work. This is a full flow staged combustion rocket engine as an interactive cutaway: 47 parts, a 10 step tour, every figure sourced.
>
> Spin it. Explode it. Slice it.
>
> The tour walks the whole loop: two cryogenic propellants, two turbopumps on two shafts, a fuel-rich and an oxygen-rich preburner, and every drop of propellant driven through a turbine before it burns. Methane cools the engine, gas meets gas in the main chamber, and it all leaves through the throat and the bell.
>
> Every number cites a public source, and our build fails if one doesn't. https://three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249?utm_source=x&utm_campaign=grok-startups&utm_content=repost

**5/ (media: [`public/anatomy/og/launch-stack.png`](../../public/anatomy/og/launch-stack.png), or a video rendered per [Media for the new posts](#media-for-the-new-posts)) [NEW]**

> Then the whole rocket: a fully reusable two-stage launch system as an interactive cutaway, in proportion. 29 parts, a 10 step tour, and both stages come home to the tower.
>
> The booster carries 33 methane and oxygen engines and the upper stage carries six. The tour runs from liftoff through hot staging, where the upper stage lights its engines before it separates, to the boostback burn and the catch, where two arms on the tower close around the returning booster. Then the upper stage falls back on its heat shield, steering with four flaps.
>
> Every figure on screen is listed with its public source and date. https://three.ws/anatomy/d72da3e9-8aae-47cd-a96c-45ccd33bf1a0?utm_source=x&utm_campaign=grok-startups&utm_content=repost-launch

**6/**

> It works everywhere you use Grok: a custom connector on grok.com, Grok Bot, Grok Build, Cursor and the xAI API. @ericzakariasson
>
> One URL, a free account, and no tool that can spend money.
>
> It's one remote MCP server behind all of them, so there's nothing to install twice and nothing to keep in sync. In Grok Bot, a plain request comes back with a viewer link, the GLB and an AR link. We timed the path from signing in to a finished model at 195.8 seconds on production.
>
> Grok can even give itself a body: save a rigged character as a persona, and it lip-syncs, emotes and gestures as it replies, the same body every session. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost

**7/ [NEW]**

> In Grok Build, xAI's coding agent, three.ws is a plugin: /make-3d, /rig and /embed right in the terminal, plus an art director agent that checks its own models.
>
> /make-3d looks in the free CC0 catalog first and only generates when nothing fits. /rig turns a humanoid GLB into an animation-ready avatar. /embed writes paste-ready HTML for any model, and /three-ws-init teaches your project's AGENTS.md how to load GLBs safely.
>
> The 3d-art-director agent makes one model to a brief, renders it from four sides, fixes the one thing that is wrong and stops after two rounds. One MCP server, nothing to execute, installed in under a second. Cursor gets the same /make-3d, /rig and /embed as a plugin of its own. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost-build#install

**8/**

> Building on the Grok API? Grab six runnable examples: curl, Node on the Responses API, Python over MCP, a remote MCP tool call, an agent with a 3D avatar, and an X search turned into a 3D model. @XDevelopers
>
> The X search one has Grok sum up what people posted about a topic this week, then design a prop for it and draft a post. It never posts on its own. From a fresh copy of the folder to a finished GLB took 82 seconds, install and tests included.
>
> One command runs all six against production, so you know they work before you copy them. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost-examples#build-examples

**9/ [NEW]**

> Want Grok and 3D in your own app? Fork our Grok 3D starter: chat with Grok, and a real textured model lands on a lit stage you can orbit.
>
> Ask for "a small brass desk lamp" and Grok calls three.ws, the GLB renders, and it appears on the page. Say "make it chrome" and Grok refines the same model.
>
> One small Node server and one page: no framework, no build step, one dependency. Your server holds the keys, so the browser never sees them. https://github.com/nirholas/three.ws/tree/main/satellites/grok-3d-starter

**10/ [NEW]**

> Not sure what to ask first? The Grok page has four Grok Bot tasks you can paste exactly as they are, each one timed against production.
>
> A home-office scene kit pulled from the free catalog in 3 seconds. A weekly game-jam prop pack that only generates what the catalog is missing. A product photo turned into a textured model, then checked from two angles against the photo. A rigged mascot avatar with a pose studio link, in under 8 minutes.
>
> Every card shows the exact prompt, the tools it calls and what came back when we ran it. Setup is one command too: npx @three-ws/cli setup --client grok-bot prints the connector fields, copies the URL and checks it live. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost-templates#build

**11/ [NEW]**

> three.ws can wake your Grok Bot. When an agent run finishes, a model is forged or an approval is waiting, a webhook starts a Grok Bot routine with the event as context.
>
> Make a routine in Grok Bot with a webhook trigger and an instruction, like "if it is approval.needed, summarize what the agent wants to do and message me." Paste its URL and key into a three.ws webhook.
>
> The key is stored encrypted and never shown again, every delivery is signed and retried, and each one shows up in your delivery log. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost-wake#gk-wake-h

**12/ [NEW]**

> Grok can turn 360 footage into a 3D scene you can walk through, and a single 360 photo into a room you can stand inside.
>
> Five tools on the connector. One turns 360 video into a Gaussian splat. Another turns one 360 photo into a depth shell: a textured GLB in real metres with the camera at the centre, plus a point cloud. The rest let Grok follow each job and find your past captures.
>
> They run on the same pipeline as our capture page, for anyone with a free account. https://three.ws/pano-scene?utm_source=x&utm_campaign=grok-startups&utm_content=repost-360

**13/ [NEW]**

> Your three.ws agent can think with Grok. Add your own xAI key once and every agent you own can answer on Grok 4.7, billed to your key, not ours.
>
> That covers the 3D avatar chat, embeds on your own site and the brain playground.
>
> Each Grok call tells xAI which conversation it belongs to, so follow-up turns reuse xAI's prompt cache, where cached input costs a quarter of the normal rate. When xAI retired Grok Build 0.1, every agent set to it moved to Grok 4.7 on its own instead of failing. https://three.ws/dashboard/account?utm_source=x&utm_campaign=grok-startups&utm_content=repost-brain

**14/ [NEW, FILLED BY ORDER 452]**

> EVAL_HOOK
>
> EVAL_BODY https://three.ws/docs/evals/grok-4-7-on-three-ws?utm_source=x&utm_campaign=grok-startups&utm_content=repost-evals

**15/**

> Grok was using us before we got in.
>
> 5,547 tool calls in 44 days. Traffic every single day. 2 errors.
>
> 1,243 of those calls made or changed a model: 517 free text to 3D runs, 283 avatars, 236 art-directed meshes, 118 rigs and 89 refinements.
>
> The number we watch most: 718 distinct prompts written by people and agents we have never met, not by our own tests or demos. That is real demand, before a single announcement.

**16/ [NEW, NUMBERS REFRESHED BY ORDER 452]**

> We watch the connector the way Grok sees it. Every 5 minutes a test client connects, lists the tools, makes a call and checks sign-in, and the results are public.
>
> Over the last 7 days, 1,628 of 1,636 checks passed, with a median handshake of 158 ms.
>
> If something breaks, the status page shows it before we say anything. https://three.ws/status?utm_source=x&utm_campaign=grok-startups&utm_content=repost-uptime

**17/ [NEW]**

> Every model, avatar and cutaway on three.ws has an Ask @grok button beside Share on X.
>
> It writes one line about what you are looking at and a question for Grok, opens the X composer, and posts nothing until you press post. Grok answers in the replies, and the link unfurls as a card that shows the model itself, on a page that carries structured data Grok can read. https://three.ws/forge?utm_source=x&utm_campaign=grok-startups&utm_content=repost-ask

**18/**

> No VC money built three.ws. When the application asked how we're funded, we told the truth: our @pumpdotfun creator rewards.
>
> xAI vets every applicant. A company funded by its own community got in. This one is for everyone who built it with us.
>
> Guides to the program say it looks for venture-backed startups. We had none. We had a product people were already using every day, and a community that paid for it to exist.

**19/**

> Your turn. Ask Grok for anything in 3D and see what comes back.
>
> A character for your game, a prop for your scene, a product for your store, a machine you want to understand.
>
> @grok, what should we build next?

## Post 14: how order 452 fills it

Post 14 is the measured result of Grok on three.ws, from [docs/evals/grok-4-7-on-three-ws.md](../evals/grok-4-7-on-three-ws.md) (order 456, Grok 4.7 as an agent brain) and, if it ran, [docs/evals/grok-imagine-ref-image.md](../evals/grok-imagine-ref-image.md) (order 457, Grok Imagine as the reference-image step before 3D). Rules:

- The hook names the model, what was measured and the headline result in one sentence under 280 characters, for example "We measured Grok 4.7 as the brain of a three.ws agent on <N> real tasks: <the headline figure>."
- The body gives two or three figures straight from the doc, with the comparison the doc makes, and says plainly where Grok lost or tied. A loss stated honestly is still a post; a cherry-picked win is not.
- If neither eval doc has a real Grok column by the time 452 runs, cut post 14 and renumber.
- If only the Imagine eval ran, the link becomes `https://three.ws/docs/evals/grok-imagine-ref-image?utm_source=x&utm_campaign=grok-startups&utm_content=repost-evals`. One link per post.

## Sources for the new posts

- **Post 5:** [api/_lib/anatomy/featured/launch-stack.js](../../api/_lib/anatomy/featured/launch-stack.js): 29 parts, 10 tour steps, 33 booster engines, 6 upper-stage engines, hot staging, boostback, the tower catch, heat shield and two forward plus two aft flaps. Sources page and audit: [docs/anatomy/rocket-engines-sources.md](../anatomy/rocket-engines-sources.md); `tests/anatomy-featured.test.js` fails if a number is unsourced. Live id `d72da3e9-8aae-47cd-a96c-45ccd33bf1a0` (200 on 2026-11-27). The post names no vehicle or company, matching the cutaway, which carries no logos or trade dress.
- **Post 7:** [integrations/grok/three-ws/](../../integrations/grok/three-ws/README.md): commands `make-3d`, `rig`, `embed`, `three-ws-init`; agent `3d-art-director` (four-side render, two-round hard stop); one MCP server, no executables. "Installed in under a second" is from the 2026-11-20 changelog entry. A live Grok Build model turn is order 458's proof.
- **Post 9:** [satellites/grok-3d-starter/README.md](../../satellites/grok-3d-starter/README.md) (one Node server, one page, one dependency `three`, keys held server side), public at `github.com/nirholas/three.ws/tree/main/satellites/grok-3d-starter`. Needs the reader's own xAI key and a free three.ws key. The quoted ask and follow-up are a real run on grok-4.7 against production, recorded with both GLBs, the tool calls and timings in [public/x-media/grok-startups-repost/src/starter.json](../../public/x-media/grok-startups-repost/src/starter.json).
- **Post 10:** [pages/grok.html](../../pages/grok.html) `#build`, the "Grok Bot task templates" cards: 3.0 s (catalog kit), 194.0 s (prop pack), 301.6 s (photo to 3D), 455.4 s (rigged mascot, under 8 minutes). Setup command from [packages/three-ws-cli](../../packages/three-ws-cli/README.md); `@three-ws/cli@0.1.1` on npm includes the `grok-bot` client (checked 2026-11-27).
- **Post 11:** [pages/grok.html](../../pages/grok.html) "Let three.ws wake your Grok Bot" and [api/_lib/webhook-dispatch.js](../../api/_lib/webhook-dispatch.js) (encrypted bearer token on each delivery, signature headers, retries, delivery log); changelog 2026-11-04.
- **Post 12:** [api/_mcp-studio/pano-tools.js](../../api/_mcp-studio/pano-tools.js): `pano_capture_start` (360 footage to a Gaussian splat), `pano_scene_create` (one 360 photo to a metric depth shell GLB with the camera at the origin, plus a PLY point cloud), and the `pano_capture_status`, `pano_capture_list`, `pano_scene_status` tools, on `/api/mcp-studio` and `/api/mcp-grok` for signed-in accounts. Through the xAI API these work only once the schema fix `a99f32c10` is deployed (order 451).
- **Post 13:** [api/_lib/agent-grok-key.js](../../api/_lib/agent-grok-key.js) (an owner's saved xAI key bills that owner's agents), the provider keys panel on `/dashboard/account`, and the 2026-11-21 changelog entries "Grok conversations reuse xAI's prompt cache" and "Agents set to Grok Build 0.1 now answer on Grok 4.7". The post promises nothing on our key: production carries no platform xAI key by owner decision.
- **Post 16:** `https://three.ws/api/status/mcp`, the Grok server's `windows.7d` (`passed`, `probes`, `handshakeP50Ms`); 1,628 of 1,636 and 158 ms on 2026-11-27. Refresh on posting day. Probe: [api/_lib/mcp-probe.js](../../api/_lib/mcp-probe.js), every 5 minutes from `api/cron/mcp-probe.js`.
- **Post 17:** the 2026-11-20 changelog entry "Ask @grok about any model, avatar or machine, straight from its page" ([src/model-page.js](../../src/model-page.js), [src/avatar-page.js](../../src/avatar-page.js), [src/forge.js](../../src/forge.js)).
- **Models on cards 2, 3 and 17:** made through `/api/mcp-grok` exactly as Grok calls it (`forge_free`, `refine_model` "make it chrome", `forge_avatar` plus `rig_mesh`, `look_at_model`), recorded in [public/x-media/grok-startups-repost/src/models.json](../../public/x-media/grok-startups-repost/src/models.json) by `node scripts/grok-startups-post-models.mjs --set repost`. The prompts describe the objects generically (an electric sports car, an electric pickup, a humanoid robot) and name no company or product.
- **Posts 3 and 15 numbers:** the [co-marketing kit appendix](../partners/xai-comarketing-kit.md#appendix-where-every-number-comes-from), refreshed on posting day with `node scripts/grok-comarketing-numbers.mjs --from 2026-10-08 --to <the day before posting>`.

## Held back until the production xAI key is on

These are built and wired but run only on a platform xAI key, which the owner is holding on purpose. None of them appears in the thread. Each gets its own post once it runs on production:

- Grok Voice speech to speech with a 3D avatar at `/voice/grok` (today it falls back to the standard voice chain).
- Grok narration of the cutaway tours (today the page reads the written step text).
- Hero clips through Grok Imagine Video, and Grok Imagine as a Forge reference-image step.
- The @-mention reply bot on X.

Also left out on purpose: the read-only Solana market tools on the Grok Bot connector (graduations, token intel, the market brief), because this thread never touches trading or tokens; and the `threejs-craft` Grok Build skill pack, which has no README or public install path yet.

## Media

One file per post in [public/x-media/grok-startups-repost/](../../public/x-media/grok-startups-repost/), each post's file named in its header above. The cards are the original thread's look (near-black ground, Inter, thin line art, the three.ws, Grok and SpaceXSI marks, an "NN / 19" counter), drawn by Claude from real data. Video only where a real render exists:

- **Post 1:** `public/x-media/grok-startups-announce/head.mp4`, the original head video (it never carried the co-marketing line).
- **Post 4:** `public/x-media/grok-startups-announce/ffsc-engine.mp4`, the original engine cutaway video.
- **Post 5:** `post-05-launch-stack.mp4`, an 18.5 second render of the live launch stack cutaway.
- **Posts 2, 3, 6 to 13 and 15 to 19:** `post-NN.png`, 1200x675 at 2x. The 3D subjects are a rocket (post 9), a red electric sports car and its chrome refine (posts 2 and 3), a rigged humanoid robot (post 2) and a stainless electric pickup (post 17), every one a real model.
- **Post 14:** order 452 adds its card once the eval has every row.

Re-render (order 452 does this on posting day, so post 16 shows that day's uptime):

```bash
node scripts/grok-startups-post-models.mjs --set repost      # once; skips models already in src/models.json
node scripts/grok-startups-repost-cards.mjs                   # every card, plus src/live.json
node scripts/grok-startups-repost-cards.mjs --smoke-passed    # only once order 458 proved all six examples live
node scripts/anatomy-cutaway-video.mjs --id d72da3e9-8aae-47cd-a96c-45ccd33bf1a0 \
  --out public/x-media/grok-startups-repost/post-05-launch-stack.mp4
```

Post 16's text must match `src/live.json` from the same render.

## Tags

Company accounts only, never individual staff (owner, 2026-11-27): `@SpaceXSI` (post 1, a plain mention), `@cursor_ai` (posts 1 and 7, on its marketplace and plugin), `@XDevelopers` (post 8), `@X` (post 17), `@grok` (posts 17 and 19) and `@pumpdotfun` (post 18, our funding source, owner decision 2026-11-25). Never tag @bot: tagging it starts a task for each reader's own Grok Bot. Never name $THREE, a contract address, a price or trading.

## Wording rules

- Never write "xAI partner", "partnered with xAI", "backed by xAI", "official Grok plugin", "endorsed by SpaceX", or anything that says xAI, SpaceXSI or Cursor is working with us on marketing.
- Never state the credit amount, the team ID or a staff contact.

## After posting

- Read results at 48 hours and 7 days: `npm run x:outcomes -- --refresh`, then `node scripts/grok-comarketing-numbers.mjs --clicks` (it groups clicks by `utm_content`, so the `repost` rows are this thread).
