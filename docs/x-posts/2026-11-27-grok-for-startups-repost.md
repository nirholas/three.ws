# Grok for Startups repost thread (2026-11-27)

The thread that reposts three.ws's Grok for Startups announcement from @trythreews, with the highest-priority Grok work built since. Thirteen posts, plus a companion X Article that carries the rest. Owner decisions 2026-11-27: keep the original nine posts as written, remove only the co-marketing clause from post 1, add the new Grok work, and keep the thread short by moving the lower-priority new posts into the article. The original went out on 2026-11-25 and came down on 2026-11-27 at xAI's request (the program gives credits; it does not include co-marketing).

House voice: one link per post, no hashtags, no emoji, no dashes. The account has X Premium, so posts run long, but the timeline cuts each one at about 280 characters behind "Show more": the opening of every post (everything before its first extra paragraph) fits 280 on its own and is the hook, and the paragraphs after it are the substance for readers who open it.

## Status: final assembly runs last

The thread text and cards are final except for the refreshed usage numbers in posts 3 and 10 and the article link in post 12. Order [452](../../prompts/finish/452-grok-fix-02-repost-thread-honest.md) refreshes the numbers, confirms every surface each post names is live and checks every link. Post order on the day: delete the 2026-11-25 thread, publish the companion article, paste its link into post 12, then post the thread.

The `[NEW]` markers are notes for us, not post text. Strip them when pasting.

## What changed from the 2026-11-25 thread

- **Post 1:** "Now we're working directly with the xAI, @SpaceXSI and Cursor teams on co-marketing" is gone. The opening line now says the approval comes with credits across Grok, Grok Build, Grok Bot and the Grok API: the program terms list those as the Eligible Services and let a participant say publicly that it is in the program, while the credit amount, tranche structure and expiry in the approval email stay confidential. @SpaceXSI stays as a plain company mention at the end of the opening line, with no relationship claim.
- **Post 6:** the personal tag @ericzakariasson is gone. Tags are company accounts only, never individual staff (owner, 2026-11-27).
- **Post 10 (was 7):** "2 errors" is gone from the text, and the usage card shows the 718 distinct prompts in that slot instead (owner, 2026-11-27).
- Nothing else in the original nine (now posts 1 to 4, 6, 8, 10, 11 and 13) changed.
- **Links:** `utm_content=announce` became `utm_content=repost` (and `repost-<post>` on the new posts) so the repost's clicks count separately.
- **Added to the thread:** posts 5 (launch stack cutaway), 7 (Grok Build and Cursor plugins), 9 (Ask @grok) and 12 (the companion article).
- **Moved to the companion article:** the Grok 3D starter app, the Grok Bot task templates and one-command setup, three.ws webhooks that wake Grok Bot, 360 capture, agents on Grok with your own key, the measured evals and the public connector uptime. Their sources stay below, and their cards are drawn as `article-<topic>.png`.

[docs/x-posts/2026-11-25-grok-for-startups-announcement.md](2026-11-25-grok-for-startups-announcement.md) now holds a stricter rewrite (commit `ed86dc046`) that also cut "first crypto-native" and the marketplace line. The owner kept both, so this file is the one to post. The original thread and its full rationale (tags, image, wording) are at commit `70478517f`: `git show 70478517f:docs/x-posts/2026-11-25-grok-for-startups-announcement.md`.

## The thread

**1/ (media: [`public/x-media/grok-startups-announce/head.mp4`](../../public/x-media/grok-startups-announce/head.mp4), still [`public/x-media/grok-startups-announce/head.png`](../../public/x-media/grok-startups-announce/head.png))**

> three.ws is the first crypto-native company approved for xAI's Grok for Startups program, with credits across Grok, Grok Build, Grok Bot and the Grok API. @SpaceXSI
>
> Grok builds in 3D with us, and our plugin is headed to the Grok Bot, Grok Build and @cursor_ai marketplaces.
>
> In plain terms: you ask Grok for something in 3D, and you get back a real model you can spin, download, animate or drop into a page. No 3D software, no modeling skills, no new app to learn. Just the Grok you already use.
>
> Every number in this thread comes from our own production logs.

**2/ (media: [`public/x-media/grok-startups-repost/post-02.png`](../../public/x-media/grok-startups-repost/post-02.png))**

> Ask Grok for a 3D model and get a real, textured GLB you can spin in your browser.
>
> Ask for a character and it comes back rigged, ready to animate. Say "make it chrome" and it edits that model instead of starting over.
>
> Every change is saved as a new version, so you can jump back to any earlier one or branch off in a new direction. Start from a sentence or from an image.
>
> Signed out, Grok searches a library of free CC0 assets first. With a free account, everything it makes lands in your own library, unlisted until you choose to publish it.

**3/ (media: [`public/x-media/grok-startups-repost/post-03.png`](../../public/x-media/grok-startups-repost/post-03.png))**

> Grok checks its own work. Before it answers, it can render the model and look at it, so a broken mesh gets caught before you ever see it.
>
> 426 checks so far.
>
> The check returns the model from several angles, plus its triangles, materials and textures. Grok can see whether the chair actually has four legs, whether the back is finished, whether anything melted together, and then regenerate, naming the fault it found.
>
> Most AI tools hand you whatever came out. This one looks first.

**4/ (media: [`public/x-media/grok-startups-announce/ffsc-engine.mp4`](../../public/x-media/grok-startups-announce/ffsc-engine.mp4), still [`public/anatomy/og/ffsc-engine.png`](../../public/anatomy/og/ffsc-engine.png))**

> three.ws also explains how machines work. This is a full flow staged combustion rocket engine as an interactive cutaway: 47 parts, a 10 step tour, every figure sourced.
>
> Spin it. Explode it. Slice it.
>
> The tour walks the whole loop: two cryogenic propellants, two turbopumps on two shafts, a fuel-rich and an oxygen-rich preburner, and every drop of propellant driven through a turbine before it burns. Methane cools the engine, gas meets gas in the main chamber, and it all leaves through the throat and the bell.
>
> Every number cites a public source, and our build fails if one doesn't. https://three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249?utm_source=x&utm_campaign=grok-startups&utm_content=repost

**5/ (media: [`public/x-media/grok-startups-repost/post-05-launch-stack.mp4`](../../public/x-media/grok-startups-repost/post-05-launch-stack.mp4), still [`public/anatomy/og/launch-stack.png`](../../public/anatomy/og/launch-stack.png)) [NEW]**

> Then the whole rocket: a fully reusable two-stage launch system as an interactive cutaway, in proportion. 29 parts, a 10 step tour, and both stages come home to the tower.
>
> The booster carries 33 methane and oxygen engines and the upper stage carries six. The tour runs from liftoff through hot staging, where the upper stage lights its engines before it separates, to the boostback burn and the catch, where two arms on the tower close around the returning booster. Then the upper stage falls back on its heat shield, steering with four flaps.
>
> Every figure on screen is listed with its public source and date. https://three.ws/anatomy/d72da3e9-8aae-47cd-a96c-45ccd33bf1a0?utm_source=x&utm_campaign=grok-startups&utm_content=repost-launch

**6/ (media: [`public/x-media/grok-startups-repost/post-06.png`](../../public/x-media/grok-startups-repost/post-06.png))**

> It works everywhere you use Grok: a custom connector on grok.com, Grok Bot, Grok Build, Cursor and the xAI API.
>
> One URL, a free account, and no tool that can spend money.
>
> It's one remote MCP server behind all of them, so there's nothing to install twice and nothing to keep in sync. In Grok Bot, a plain request comes back with a viewer link, the GLB and an AR link. We timed the path from signing in to a finished model at 195.8 seconds on production.
>
> Grok can even give itself a body: save a rigged character as a persona, and it lip-syncs, emotes and gestures as it replies, the same body every session. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost

**7/ (media: [`public/x-media/grok-startups-repost/post-07.png`](../../public/x-media/grok-startups-repost/post-07.png)) [NEW]**

> In Grok Build, xAI's coding agent, three.ws is a plugin: /make-3d, /rig and /embed right in the terminal, plus an art director agent that checks its own models.
>
> /make-3d looks in the free CC0 catalog first and only generates when nothing fits. /rig turns a humanoid GLB into an animation-ready avatar. /embed writes paste-ready HTML for any model, and /three-ws-init teaches your project's AGENTS.md how to load GLBs safely.
>
> The 3d-art-director agent makes one model to a brief, renders it from four sides, fixes the one thing that is wrong and stops after two rounds. One MCP server, nothing to execute, installed in under a second. @cursor_ai gets the same /make-3d, /rig and /embed as a plugin of its own. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost-build#install

**8/ (media: [`public/x-media/grok-startups-repost/post-08.png`](../../public/x-media/grok-startups-repost/post-08.png))**

> Building on the Grok API? Grab six runnable examples: curl, Node on the Responses API, Python over MCP, a remote MCP tool call, an agent with a 3D avatar, and an X search turned into a 3D model. @XDevelopers
>
> The X search one has Grok sum up what people posted about a topic this week, then design a prop for it and draft a post. It never posts on its own. From a fresh copy of the folder to a finished GLB took 82 seconds, install and tests included.
>
> One command runs all six against production, so you know they work before you copy them. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=repost-examples#build-examples

**9/ (media: [`public/x-media/grok-startups-repost/post-09.png`](../../public/x-media/grok-startups-repost/post-09.png)) [NEW]**

> Every model, avatar and cutaway on three.ws has an Ask @grok button beside Share on X.
>
> It writes one line about what you are looking at and a question for Grok, opens the composer on @X, and posts nothing until you press post. Grok answers in the replies, and the link unfurls as a card that shows the model itself, on a page that carries structured data Grok can read. https://three.ws/forge?utm_source=x&utm_campaign=grok-startups&utm_content=repost-ask

**10/ (media: [`public/x-media/grok-startups-repost/post-10.png`](../../public/x-media/grok-startups-repost/post-10.png))**

> Grok was using us before we got in.
>
> 5,547 tool calls in 44 days. Traffic every single day.
>
> 1,243 of those calls made or changed a model: 517 free text to 3D runs, 283 avatars, 236 art-directed meshes, 118 rigs and 89 refinements.
>
> The number we watch most: 718 distinct prompts written by people and agents we have never met, not by our own tests or demos. That is real demand, before a single announcement.

**11/ (media: [`public/x-media/grok-startups-repost/post-11.png`](../../public/x-media/grok-startups-repost/post-11.png))**

> No VC money built three.ws. When the application asked how we're funded, we told the truth: our @pumpdotfun creator rewards.
>
> xAI vets every applicant. A company funded by its own community got in. This one is for everyone who built it with us.
>
> Guides to the program say it looks for venture-backed startups. We had none. We had a product people were already using every day, and a community that paid for it to exist.

**12/ (quotes the companion X Article, whose cover is the media) [NEW]**

> Everything else we built on Grok is in the article: a starter app you can fork, four Grok Bot tasks timed on production, webhooks that wake your Grok Bot, 360 capture, agents that answer on your own xAI key, and a connector whose uptime is public.
>
> ARTICLE_URL (post the article first, then paste its link here)

**13/ (media: [`public/x-media/grok-startups-repost/post-13.png`](../../public/x-media/grok-startups-repost/post-13.png))**

> Your turn. Ask Grok for anything in 3D and see what comes back.
>
> A character for your game, a prop for your scene, a product for your store, a machine you want to understand.
>
> @grok, what should we build next?

## Sources for the new work (thread posts 5, 7 and 9, and the article)

- **Post 5 (launch stack):** [api/_lib/anatomy/featured/launch-stack.js](../../api/_lib/anatomy/featured/launch-stack.js): 29 parts, 10 tour steps, 33 booster engines, 6 upper-stage engines, hot staging, boostback, the tower catch, heat shield and two forward plus two aft flaps. Sources page and audit: [docs/anatomy/rocket-engines-sources.md](../anatomy/rocket-engines-sources.md); `tests/anatomy-featured.test.js` fails if a number is unsourced. Live id `d72da3e9-8aae-47cd-a96c-45ccd33bf1a0` (200 on 2026-11-27). The post names no vehicle or company, matching the cutaway, which carries no logos or trade dress.
- **Post 7 (Grok Build plugin):** [integrations/grok/three-ws/](../../integrations/grok/three-ws/README.md): commands `make-3d`, `rig`, `embed`, `three-ws-init`; agent `3d-art-director` (four-side render, two-round hard stop); one MCP server, no executables. "Installed in under a second" is from the 2026-11-20 changelog entry. A live Grok Build model turn is order 458's proof.
- **Article, Grok 3D starter:** [satellites/grok-3d-starter/README.md](../../satellites/grok-3d-starter/README.md) (one Node server, one page, one dependency `three`, keys held server side), public at `github.com/nirholas/three.ws/tree/main/satellites/grok-3d-starter`. Needs the reader's own xAI key and a free three.ws key. The quoted ask and follow-up are a real run on grok-4.7 against production, recorded with both GLBs, the tool calls and timings in [public/x-media/grok-startups-repost/src/starter.json](../../public/x-media/grok-startups-repost/src/starter.json).
- **Article, Grok Bot task templates:** [pages/grok.html](../../pages/grok.html) `#build`, the "Grok Bot task templates" cards: 3.0 s (catalog kit), 194.0 s (prop pack), 301.6 s (photo to 3D), 455.4 s (rigged mascot, under 8 minutes). Setup command from [packages/three-ws-cli](../../packages/three-ws-cli/README.md); `@three-ws/cli@0.1.1` on npm includes the `grok-bot` client (checked 2026-11-27).
- **Article, webhooks that wake Grok Bot:** [pages/grok.html](../../pages/grok.html) "Let three.ws wake your Grok Bot" and [api/_lib/webhook-dispatch.js](../../api/_lib/webhook-dispatch.js) (encrypted bearer token on each delivery, signature headers, retries, delivery log); changelog 2026-11-04.
- **Article, 360 capture:** [api/_mcp-studio/pano-tools.js](../../api/_mcp-studio/pano-tools.js): `pano_capture_start` (360 footage to a Gaussian splat), `pano_scene_create` (one 360 photo to a metric depth shell GLB with the camera at the origin, plus a PLY point cloud), and the `pano_capture_status`, `pano_capture_list`, `pano_scene_status` tools, on `/api/mcp-studio` and `/api/mcp-grok` for signed-in accounts. Through the xAI API these work only once the schema fix `a99f32c10` is deployed (order 451).
- **Article, agents on your own xAI key:** [api/_lib/agent-grok-key.js](../../api/_lib/agent-grok-key.js) (an owner's saved xAI key bills that owner's agents), the provider keys panel on `/dashboard/account`, and the 2026-11-21 changelog entries "Grok conversations reuse xAI's prompt cache" and "Agents set to Grok Build 0.1 now answer on Grok 4.7". The post promises nothing on our key: production carries no platform xAI key by owner decision.
- **Article, connector uptime:** `https://three.ws/api/status/mcp`, the Grok server's `windows.7d` (`passed`, `probes`, `handshakeP50Ms`); 1,652 of 1,660 and 159 ms on 2026-11-27. Refresh on posting day. Probe: [api/_lib/mcp-probe.js](../../api/_lib/mcp-probe.js), every 5 minutes from `api/cron/mcp-probe.js`.
- **Post 9 (Ask @grok):** the 2026-11-20 changelog entry "Ask @grok about any model, avatar or machine, straight from its page" ([src/model-page.js](../../src/model-page.js), [src/avatar-page.js](../../src/avatar-page.js), [src/forge.js](../../src/forge.js)).
- **Models on cards 2, 3 and 9:** made through `/api/mcp-grok` exactly as Grok calls it (`forge_free`, `refine_model` "make it chrome", `forge_avatar` plus `rig_mesh`, `look_at_model`), recorded in [public/x-media/grok-startups-repost/src/models.json](../../public/x-media/grok-startups-repost/src/models.json) by `node scripts/grok-startups-post-models.mjs --set repost`. The prompts describe the objects generically (an electric sports car, an electric pickup, a humanoid robot) and name no company or product.
- **Posts 3 and 10 numbers:** the [co-marketing kit appendix](../partners/xai-comarketing-kit.md#appendix-where-every-number-comes-from), refreshed on posting day with `node scripts/grok-comarketing-numbers.mjs --from 2026-10-08 --to <the day before posting>`.

## Held back until the production xAI key is on

These are built and wired but run only on a platform xAI key, which the owner is holding on purpose. None of them appears in the thread or the article. Each gets its own post once it runs on production:

- Grok Voice speech to speech with a 3D avatar at `/voice/grok` (today it falls back to the standard voice chain).
- Grok narration of the cutaway tours (today the page reads the written step text).
- Hero clips through Grok Imagine Video, and Grok Imagine as a Forge reference-image step.
- The @-mention reply bot on X.

Also left out on purpose: the read-only Solana market tools on the Grok Bot connector (graduations, token intel, the market brief), because this thread never touches trading or tokens; and the `threejs-craft` Grok Build skill pack, which has no README or public install path yet.

## Media

One file per post in [public/x-media/grok-startups-repost/](../../public/x-media/grok-startups-repost/), each post's file named in its header above. The cards are the original thread's look (near-black ground, Inter, thin line art, the three.ws, Grok and SpaceXSI marks, an "NN / 13" counter), drawn by Claude from real data. Video only where a real render exists:

- **Post 1:** `public/x-media/grok-startups-announce/head.mp4`, the original head video (it never carried the co-marketing line).
- **Post 4:** `public/x-media/grok-startups-announce/ffsc-engine.mp4`, the original engine cutaway video.
- **Post 5:** `post-05-launch-stack.mp4`, an 18.5 second render of the live launch stack cutaway.
- **Posts 2, 3, 6 to 11 and 13:** `post-NN.png`, 1200x675 at 2x. The 3D subjects are a white electric sports car and its chrome refine plus a rigged humanoid robot (posts 2 and 3) and a stainless electric pickup (post 9), every one a real model.
- **Post 12:** none of its own; it quotes the article, whose cover shows.
- **Article images:** `article-starter.png` (a rocket and its "make it stainless steel" refine from a live grok-4.7 run), `article-templates.png`, `article-wake.png`, `article-360.png`, `article-brain.png` and `article-uptime.png`, the same look without a counter.

Re-render (order 452 does this on posting day, so the uptime image shows that day's figures):

```bash
node scripts/grok-startups-post-models.mjs --set repost      # once; skips models already in src/models.json
node scripts/grok-startups-repost-cards.mjs                   # every card and article image, plus src/live.json
node scripts/grok-startups-repost-cards.mjs --smoke-passed    # only once order 458 proved all six examples live
node scripts/anatomy-cutaway-video.mjs --id d72da3e9-8aae-47cd-a96c-45ccd33bf1a0 \
  --out public/x-media/grok-startups-repost/post-05-launch-stack.mp4
```

The article's uptime figures must match `src/live.json` from the same render.

## Tags

Company accounts only, never individual staff (owner, 2026-11-27): `@SpaceXSI` (post 1, a plain mention), `@cursor_ai` (posts 1 and 7, on its marketplace and plugin), `@XDevelopers` (post 8), `@X` and `@grok` (post 9), `@pumpdotfun` (post 11, our funding source, owner decision 2026-11-25) and `@grok` (post 13). The article tags no one. Never tag @bot: tagging it starts a task for each reader's own Grok Bot. Never name $THREE, a contract address, a price or trading.

## Wording rules

- Never write "xAI partner", "partnered with xAI", "backed by xAI", "official Grok plugin", "endorsed by SpaceX", or anything that says xAI, SpaceXSI or Cursor is working with us on marketing.
- Never state the credit amount, tranche structure, expiry date, the team ID or a staff contact: the program terms keep the approval email's non-public details confidential. Saying we are in the program, and that it comes with credits across Grok, Grok Build, Grok Bot and the Grok API, is allowed.
- The terms say the program creates no partnership, joint venture or agency, so never imply one.

## After posting

- Read results at 48 hours and 7 days: `npm run x:outcomes -- --refresh`, then `node scripts/grok-comarketing-numbers.mjs --clicks` (it groups clicks by `utm_content`, so the `repost` rows are this thread).
