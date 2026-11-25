# xAI co-marketing kit (Grok for Startups)

The ready-to-send material for route D of the
[Grok for Startups build and co-marketing plan](./xai-grok-startups-plan.md#d-co-marketing-and-asks):
who on X amplifies third-party builds, the two emails to the startups team, the case study,
one post and reply thread per build, the assets each post needs, and how every link is measured.

Status as of 2026-11-20: nothing here has been sent or posted. Sending email and posting on X
are owner steps. Every post draft is gated on a production deploy (production runs `35440977b`,
which contains none of the nine builds) and on the evidence its own order produces. The drafts
live in [`data/x-content/queue.json`](../../data/x-content/queue.json) as `status: "draft"` items
named `grok-startups-<order>-*`.

**Membership wording, the only approved form:** "three.ws is a member of xAI's Grok for Startups
program." Never write "xAI partner", "backed by xAI", "official Grok plugin" or "endorsed by
SpaceX", and never state the credit amount, the team ID or any staff contact. Copy aimed at xAI
stays on the product: no crypto features, no market data, no wallets.

The company was renamed twice in 2026 (xAI, then SpaceXAI in July, then SpaceXSI in October). The
domain is still `x.ai`, and its X account is **@SpaceXSI** (formerly @xai).

---

## Who reshares what

Public handles only, each with a public post that shows the account amplifying work by someone
else. Checked by hand on 2026-11-20; recheck a link before tagging, since accounts are renamed.

| Account | What it amplifies | Public example | Our builds that fit |
|---|---|---|---|
| [@SpaceXSI](https://x.com/SpaceXSI) | Quote-posts integrations that third parties built on the Grok API, especially voice (TTS, STT, realtime agents). Announces marketplaces and APIs it then points builders to. | Quote of a third-party voice integration: [x.com/SpaceXSI/status/2062209374039499178](https://x.com/SpaceXSI/status/2062209374039499178) (quoting [x.com/Vapi_AI/status/2062202760590762212](https://x.com/Vapi_AI/status/2062202760590762212)); a second quote of the same builder: [x.com/SpaceXSI/status/2067654108123910495](https://x.com/SpaceXSI/status/2067654108123910495). Marketplace launch: [x.com/xai/status/2065099299541893577](https://x.com/xai/status/2065099299541893577). Voice Agent API launch: [x.com/SpaceXSI/status/2001385958147752255](https://x.com/SpaceXSI/status/2001385958147752255). | 876 (Grok Voice), 872 (Grok Build marketplace) |
| [@ericzakariasson](https://x.com/ericzakariasson) | Works on Grok Bot at SpaceXSI; their profile names SpaceXAI as the current team and Cursor as the previous one. Posts calls for connector submissions and points to the community directory of bots and apps people built. | Submissions call: [x.com/ericzakariasson/status/2110492929920053441](https://x.com/ericzakariasson/status/2110492929920053441); community directory: [x.com/ericzakariasson/status/2123102642704675241](https://x.com/ericzakariasson/status/2123102642704675241) | 873 (Grok Bot listing) |
| [@XDevelopers](https://x.com/XDevelopers) | Features apps that developers built on the X API, in posts and X Articles. | X Article "X API Major Upgrades", which showcases builders' apps: [x.com/XDevelopers/article/2041295840325636551](https://x.com/XDevelopers/article/2041295840325636551) | 877 (the X search to 3D example); order 930's mention bot |
| [@grok](https://x.com/grok) | Does not reshare. It answers public tags in thread, so a post that asks it a real question gets a visible Grok reply under it. | Reply to a developer in thread: [x.com/grok/status/2040783994082496542](https://x.com/grok/status/2040783994082496542) | 884 (Ask @grok), creators' own posts |

**Omitted, and why:**

- An xAI developer relations account: none found that posts or reposts third-party builds.
- @bot (the Grok Bot account): no post found that amplifies a third-party build. Also, tagging
  @bot starts a task for the reader's own Bot, so our copy never tags it.
- @santiagomed (X developer platform): no status URL found that shows a reshare, so not
  verifiable to the bar above.
- @chrisparkX: left X in October 2026.

---

## The startups-team email

Sent by the owner from their own address to the Grok for Startups team contact they were given at
admission. Plain text, one ask each. Links carry
`utm_source=email&utm_campaign=grok-startups&utm_content=882` so the replies are attributable
apart from X traffic. The numbers are from the measurement in the [appendix](#appendix-where-every-number-comes-from);
rerun it the day you send and update any figure that moved.

### Version 1: after the first build ships (hero clips, order 875)

> **Subject:** three.ws on Grok: hero clips from a creator's own 3D model
>
> Hi Grok for Startups team,
>
> Thank you for admitting three.ws to the program. Our first build on it is live: hero clips. A
> creator presses one button on their 3D model, we render their own mesh, and Grok Imagine Video
> animates that render, so the shape, materials and colors stay theirs. Each clip gets a public
> page that unfurls as the video when it is shared on X:
> https://three.ws/docs/hero-clips?utm_source=email&utm_campaign=grok-startups&utm_content=882
>
> For context on who will see it: between October 8 and November 20 our Grok MCP endpoint served
> 5,547 tool calls with 2 errors, with traffic on all 44 days. Callers sent 718 distinct
> prompts for 3D models in that time that appear nowhere in our own code, tests or demos.
>
> One ask: would the SpaceXSI account quote our launch post for hero clips on X? It went out today
> from @trythreews.
>
> Thank you,
> The three.ws team

### Version 2: after the marketplace listings go live (orders 871, 872, 873)

> **Subject:** three.ws is now in the Grok Build and Grok Bot marketplaces
>
> Hi Grok for Startups team,
>
> Our 3D studio is now listed in both Grok marketplaces. In Grok Build, one install adds a plugin
> that makes textured 3D models, rigs avatars and embeds them in a page, and it renders each model
> to check it before it rigs or embeds it. In Grok Bot, the connector answers a plain request
> with a viewer link, the GLB and an AR link. We timed a reviewer's path from sign-in to a finished
> model at 195.8 seconds against production.
> https://three.ws/grok?utm_source=email&utm_campaign=grok-startups&utm_content=882
>
> From October 8 to November 20 the endpoint behind both listings served 5,547 tool calls with 2
> errors. Grok Bot registered with it 31 times over OAuth, and callers sent 718 distinct prompts
> for 3D models that appear nowhere in our own code, tests or demos.
>
> One ask: would you consider three.ws for a featured slot in the Grok Build plugin marketplace?
>
> Thank you,
> The three.ws team

---

## Case study

Committed without a quote. The proposed quote is in the owner message for order 882 and goes in
only once the owner approves it. Every figure is traced in the
[appendix](#appendix-where-every-number-comes-from).

### How three.ws runs on Grok

three.ws is a free 3D studio for AI agents. It turns a sentence or an image into a textured 3D
model, rigs characters so they can be animated, and renders any model so the agent that asked for
it can look at the result before it uses it. three.ws is a member of xAI's Grok for Startups
program.

**One endpoint for every Grok surface.** The studio is a remote MCP server at
`https://three.ws/api/mcp-grok`. Grok Bot adds it as a connector, Grok connectors and Grok Build
add it by URL, and the xAI API calls it as a remote MCP tool. Signed out, it searches a catalog
of free CC0 assets. Signed in with a free account, the same URL makes and rigs models that land in
the caller's own library, unlisted until they publish them. There is no second integration to
keep in sync.

**What callers do with it.** Between October 8 and November 20, 2026, the endpoint served 5,547
tool calls, with traffic on all 44 days and 2 errors. 1,243 of those calls generated or changed a
model: 517 free text-to-3D runs, 236 runs on the multi-model mesh chain, 211 one-step avatars, 118 rigs, 89
refinements and 72 text-to-avatar runs. Another 680 calls searched or opened the catalog first;
the search answered in 292 ms at the median and 630 ms at the 95th percentile.

The number we watch most is the prompts. Those generation calls carried 734 distinct prompts.
Sixteen of them appear somewhere in our own code, tests or demos. The other 718 were written by
the people and agents calling the server. None of those prompts is published, here or anywhere.

**Agents that check their own work.** Callers asked the server to render a model 426 times. That
tool returns pictures of the model from several angles so the agent can see whether the chair
has four legs before it embeds it on a page. The Grok Build plugin makes that check part of
every command that rigs or embeds a model.

**Who connects.** The endpoint is open to any MCP client, and it records each client that signs in
over OAuth. Grok Bot registered 31 times between October 8 and November 20. Cursor has registered 12
times since August, and Grok itself twice, both in August.

**What Grok adds next.** The builds now shipping put more of Grok inside the product:

- Hero clips: we render the creator's own mesh, then Grok Imagine Video animates that render, so
  a clip shows their model and not an imitation of it.
- Grok voice: a lip-synced 3D avatar that talks speech to speech in realtime, with latency
  measured from real timestamps on each turn.
- A blind test of Grok Imagine as the reference image step of text-to-3D: 40 prompts in 6
  categories, the same seed and TRELLIS settings for both providers, a judge that never sees which
  side is which, and metered cost. The result will be published whichever way it goes.
- An "Ask @grok" button on shared models, avatars and cutaways that drafts a question for Grok on
  X and posts nothing until the user does.

**How it is measured.** Tool calls, errors and latency come from the server's own usage log.
Prompt counts compare each prompt, case-folded, with a corpus built from our repository, and print
only the totals. OAuth registrations come from the server's client table. The query for each
figure is listed below the case study, so anyone with database access can rerun it.

---

## Post drafts per build

One head post and a reply thread per build, in the house voice the queue enforces: one link per
post, no hashtags, no emoji, no dashes, every number and absolute backed by a claim with evidence.
The text below is the queue copy, character for character. Tags follow the rules in
[Timing and rules](#timing-and-rules): as automated queue posts, at most one account per thread,
and only when the build genuinely runs on that account's product.

Order 930 already owns the Grok Bot connector walkthrough and its long-form Article (queue items
`grok-bot-mention-bot` and `grok-bot-mention-bot-article`). The 873 draft covers only the listing
and the measured reviewer path and should go out after them; nothing below repeats them.

### 871: Cursor plugin (`grok-startups-871-cursor-plugin`)

- **Tag:** none. The listing lives on Cursor's surface and no xAI account is involved.
- **Evidence it needs:** order 871's approved, public Cursor Marketplace listing, and a production
  deploy of the plugin commit.

> We ship a Cursor plugin. Ask the agent for a prop or a character and it makes a textured GLB, rigs it for animation, and renders the result so it can look at what it made before it uses it. https://three.ws/docs/mcp?utm_source=x&utm_campaign=grok-startups&utm_content=871
>
> ↳ A bundled rule tells the agent to search the free CC0 catalog before it generates anything, and to say which path it took: a match from the catalog or a new model.
>
> ↳ Making a model needs a free three.ws account. Cursor signs you in the first time it connects, and the plugin also adds a make command and a rig command.

### 872: Grok Build plugin (`grok-startups-872-grok-build-plugin`)

- **Tag:** @SpaceXSI, because it announced the Grok Build plugin marketplace this listing sits in
  ([x.com/xai/status/2065099299541893577](https://x.com/xai/status/2065099299541893577)).
- **Evidence it needs:** order 872's live marketplace entry (`grok plugin details three-ws` from a
  clean machine) and a production deploy.

> Our plugin is listed in the Grok Build plugin marketplace @SpaceXSI announced. Install it from /marketplace and Grok Build can make textured 3D models, rig avatars and embed them in a page, checking each GLB with a render before it rigs or embeds it. https://three.ws/docs/grok?utm_source=x&utm_campaign=grok-startups&utm_content=872
>
> ↳ The plugin is one MCP server, 5 commands, 1 agent and 6 skills. It is built only from those parts, with no executables of its own, so the plugin details screen lists all it can do.

### 873: Grok Bot marketplace listing (`grok-startups-873-grok-bot-listing`)

- **Tag:** @ericzakariasson, because they opened Grok Bot marketplace submissions in public and runs
  the community directory ([x.com/ericzakariasson/status/2110492929920053441](https://x.com/ericzakariasson/status/2110492929920053441)).
- **Evidence it needs:** order 873's approved listing (the submission row in
  [grok-bot-listings.md](./grok-bot-listings.md) filled with the listing link), and order 930's
  posts out first.

> We are listed in the Grok Bot marketplace that @ericzakariasson opened for submissions. We timed the path a reviewer takes, from sign in to a finished 3D model, against production: 195.8 s. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=873
>
> ↳ Signed out, the connector searches the free catalog. Signed in with your free account, the same URL makes and rigs models that land in your own library, unlisted until you publish them.

### 874: Grok Imagine reference image eval (`grok-startups-874-ref-image-eval`)

- **Tag:** none until the Grok column exists. Tagging the model's account on a method-only post
  invites a question about results we do not have yet. When the judge has run, add a third post
  with the measured result and tag @grok there.
- **Evidence it needs:** both columns of the eval (order 927 sets the xAI key on Cloud Run, then
  `npm run grok:eval-ref-image -- --prod-env --providers xai`), and the eval page deployed. The
  copy states the method only.

> We built a blind test for Grok Imagine as the reference image step of our text to 3D lane: 40 prompts across props, characters, vehicles, food, architecture and a hard set, the same seed and TRELLIS settings for both providers, and metered cost. https://three.ws/docs/evals/grok-imagine-ref-image?utm_source=x&utm_campaign=grok-startups&utm_content=874
>
> ↳ The hard set is thin structures and transparent objects: spokes, wire, wings, glass and crystal. The judge sees the two renders side by side with the sides shuffled, and a Grok model never judges its own output.

### 875: Hero clips (`grok-startups-875-hero-clips`)

- **Tag:** none. The copy names Grok Imagine Video in plain text, which is enough.
- **Evidence it needs:** order 875 deployed and one real clip with its public `/hero-clip/<id>`
  page; that clip is the head media.

> Make a hero clip from your own 3D model. We render your mesh, then Grok Imagine Video animates that render, so the shape, materials and colors stay yours. Clips run 4, 6, 8 or 10 seconds. https://three.ws/docs/hero-clips?utm_source=x&utm_campaign=grok-startups&utm_content=875
>
> ↳ Press Make a hero clip on a model page or on the forge result card. Each finished clip gets its own public page that unfurls as the video when you share the link.

### 876: Grok voice avatar (`grok-startups-876-voice-grok`)

- **Tag:** @SpaceXSI, because it announced the Grok Voice Agent API this page runs on
  ([x.com/SpaceXSI/status/2001385958147752255](https://x.com/SpaceXSI/status/2001385958147752255)),
  and it quote-posts third-party voice integrations (see the table above).
- **Evidence it needs:** `/voice/grok` deployed (404 in production today) and order 876's latency
  run from `scripts/verify-voice-grok.mjs`.

> Talk to a 3D avatar that lip syncs as it answers. The voice is Grok Voice from @SpaceXSI, speech to speech in realtime, with push to talk or open mic, a live transcript, and latency measured from real timestamps on each turn. https://three.ws/voice/grok?utm_source=x&utm_campaign=grok-startups&utm_content=876
>
> ↳ If Grok voice is off, the page offers the standard voice chain instead of failing, and the chain runs as push to talk.

### 877: Build examples (`grok-startups-877-build-examples`)

- **Tag:** none. No verified xAI developer relations account amplifies third-party examples. If
  the X search example draws replies, @XDevelopers is the account that features X API builds; tag
  it only in a separate post about that one example.
- **Evidence it needs:** the examples section deployed and order 877's run log for each example.

> Six runnable examples for building 3D into Grok apps: plain curl, Node on the Responses API, Python over MCP, a remote MCP tool call, an agent with a 3D avatar, and X search turned into a 3D model. https://three.ws/grok?utm_source=x&utm_campaign=grok-startups&utm_content=877#build-examples
>
> ↳ Each example is a small folder you can copy and run with your own xAI key.

### 883: Rocket engine cutaways (`grok-startups-883-rocket-cutaways`)

- **Tag:** none (plan route D4: post during a launch window, no ask, no tag).
- **Evidence it needs:** the featured cutaway design deployed (production serves the generic
  anatomy page for this id today) and order 883's browser screenshots.

> How a full flow staged combustion rocket engine works, as an interactive cutaway: two preburners, two turbopumps, and all of the propellant driving a turbine before it burns. Spin it, explode it and slice it. https://three.ws/anatomy/85160213-4c15-4b00-ba96-5990b9385249?utm_source=x&utm_campaign=grok-startups&utm_content=883
>
> ↳ Each figure in the cutaway cites a source, and a test fails the build if a number has none. A second cutaway walks a fully reusable two stage launch system from the booster engine ring to the tower catch.

### 884: Ask @grok (`grok-startups-884-ask-grok`)

- **Tag:** @grok, because the button ends the compose text with a question to @grok, so the post
  names the exact action users take. Expect a Grok reply in the thread; leave it, and never answer
  it with an automated reply.
- **Evidence it needs:** the share action deployed and order 884's run of
  `scripts/verify-share-to-x-browser.mjs`.

> Models, avatars and cutaways now have an Ask @grok button beside Share on X. It writes a short description and one question about what you are looking at, opens it in the X composer, and posts nothing until you press post. https://three.ws/forge?utm_source=x&utm_campaign=grok-startups&utm_content=884
>
> ↳ The question comes from a template for the model's category, and you can edit all of it before it goes anywhere.

---

## Asset checklist

Every head post needs media before the queue will release it (`npm run x:content -- check` flags
each draft as "head post has no media" until then). Each asset comes from production data, after
that build is deployed. Run from the repo root.

| Order | Asset | Command |
|---|---|---|
| 871 | Viewer and run receipt screenshots of a real `forge_free` result | `node scripts/cursor-plugin-session-check.mjs --json /tmp/cursor-session.json && node scripts/cursor-plugin-shots.mjs --session /tmp/cursor-session.json --base https://three.ws --out public/x-media/grok-startups-871-cursor-plugin` |
| 872 | Code card of the install check, built from the plugin README | `npm run x:content -- remix grok-startups-872-grok-build-plugin --as code --code "grok plugin details three-ws   # one MCP server, 5 commands, 1 agent, 6 skills" --source integrations/grok/three-ws/README.md` |
| 873 | Browser shot of the live Grok page | `npm run x:content -- remix grok-startups-873-grok-bot-listing --as shot --url https://three.ws/grok --frame browser` |
| 874 | Browser shot of the eval page once both columns and the judge have run | `npm run x:content -- remix grok-startups-874-ref-image-eval --as shot --url https://three.ws/docs/evals/grok-imagine-ref-image --frame browser` |
| 875 | The hero clip itself, prepared for X | `CLIP=$(node scripts/hero-clip-e2e.mjs --glb https://three.ws/cdn/forge/anon/3abac32f-ced2-4189-b822-d30c96dbc87e.glb --title "Chrome toy rocket" \| awk '/^stored:/{print $2}') && curl -sSfo /tmp/hero-clip.mp4 "$CLIP" && npm run x:content -- prepare-video /tmp/hero-clip.mp4 --out public/x-media/grok-startups-875-hero-clips/clip.mp4 --item grok-startups-875-hero-clips` |
| 876 | Screenshots of three real voice turns with measured latency | `node scripts/verify-voice-grok.mjs --base https://three.ws --turns 3 --out public/x-media/grok-startups-876-voice-grok` |
| 877 | Browser shot of the examples section | `npm run x:content -- remix grok-startups-877-build-examples --as shot --url "https://three.ws/grok#build-examples" --frame browser` |
| 883 | The engine cutaway's 1200x630 card, rendered from the live design | `node scripts/anatomy-featured-shots.mjs --base https://three.ws --og --only ffsc-engine` (writes `public/anatomy/og/ffsc-engine.png`) |
| 884 | The share panel and the compose text Ask @grok opens | `node scripts/verify-share-to-x-browser.mjs --base https://three.ws --anatomy 85160213-4c15-4b00-ba96-5990b9385249 --out public/x-media/grok-startups-884-ask-grok` |

The `remix` heads are written into the queue item by the command. For the screenshot and clip
rows, add the file to the head post's `media` with alt text that describes the frame (40
characters or more), then run `npm run x:content -- check`.

---

## Timing and rules

**X automation rules.**

- Queue posts (published automatically from `data/x-content/queue.json`) tag at most one account
  per thread, an account whose product the build runs on, and the validator rejects any mention
  without a recorded reason. X restricts unsolicited mentions from automated accounts. Posts the
  owner makes by hand are not bound by this and can tag whoever fits.
- No automated replies to staff or to @grok. When @grok or an xAI employee replies, the owner
  answers by hand or not at all. The mention bot (order 930) only answers people who ask it for a
  model, once each.
- Never tag @bot: it starts a task for the reader's own Grok Bot.
- Posting rate: the queue's cadence, at most 5 posts a day, at least 80 minutes apart, in the
  fixed slots of `cadence.slots` in the queue. Keep the nine Grok posts at one a day so no two
  land back to back; their `notBefore` dates start on 2026-11-24 and step one day each, and any
  draft whose build has not deployed simply waits.

**Order.** 930's walkthrough first, then the listings (871, 872, 873) as each goes live, then the
builds as each deploys. Send email version 1 the day the first build post goes out, and version 2
when the last of the three listings is live. Post 883 inside a launch window.

**Wording.** Membership is stated only as "three.ws is a member of xAI's Grok for Startups
program." The posts do not mention the membership at all; they describe what the build does.

**Owner steps, every time:** approve each draft (`npm run x:content -- review <slug>` then
`npm run x:content -- approve <slug>`), send each email, and post any reply in a staff thread.

---

## Tracking

Every link in a post carries `utm_source=x&utm_campaign=grok-startups&utm_content=<order>`, with
the query placed before any `#` fragment. Email links use `utm_source=email` with
`utm_content=882`. User share links from the product already carry their own campaigns
(`grok-share`, `grok-ask`, from `src/shared/share-targets.js`), so they never mix with this one.
No new analytics vendor is involved; these are the readouts that already exist:

| Question | Command or surface | Source |
|---|---|---|
| How did each post do on X? | `npm run x:outcomes -- --refresh`, then `npm run x:outcomes -- --compare` | Impressions and engagement for posts the queue published from @trythreews |
| Posts made by hand through a connected account | The `fetch-x-metrics` cron (`0 */6 * * *`, `api/cron/[name].js`) refreshes `x_posts.metrics` every six hours | Only posts made through the in-app composer; the table is empty in production today, so queue posts are read with `x:outcomes` |
| How many people landed from each post? | `node scripts/grok-comarketing-numbers.mjs --clicks` | Cloud Run request logs filtered on `utm_campaign=grok-startups`, per `utm_content`, crawlers and link unfurlers excluded |
| Did any of them sign up? | `npm run x:content -- plan` (prints "X signups" per landing page, last 14 days) | `api/_lib/acquisition.js`, first-touch X referrer |
| Did Grok usage move? | `node scripts/grok-comarketing-numbers.mjs --from <launch day> --to <today>` | The same usage log as the case study |

Read results 48 hours and 7 days after each post. A post that drives landings but no tool calls
points at the landing page; a post with impressions but no landings points at the copy or the
media.

---

## Appendix: where every number comes from

One command produces every figure in the emails and the case study:

```bash
node scripts/grok-comarketing-numbers.mjs --from 2026-10-08 --to 2026-11-20
```

Run on 2026-11-20 against the production database (read-only). It prints counts only; prompt
text is never printed or stored.

| Figure | Value | Query |
|---|---|---|
| Tool calls on `/api/mcp-grok` | 5,547 | `usage_events` rows for the grok surface with a tool name, `created_at` in the window |
| Errors | 2 | the same rows with an error status |
| Days with traffic | 44 of 44 | distinct days in those rows |
| Generation calls | 1,243 | the same rows for `forge_free` 517, `mesh_forge` 236, `forge_avatar` 211, `rig_mesh` 118, `refine_model` 89, `text_to_avatar` 72 |
| Catalog calls | 680 | `search_catalog` 607, `get_catalog_item` 63, `get_item_source` 10 |
| Catalog search latency | p50 292 ms, p95 630 ms (n=607) | percentiles of the recorded duration on `search_catalog` rows |
| Render checks | 426 | `look_at_model` rows |
| Distinct prompts | 734 | generation rows' prompt, trimmed and case-folded, distinct |
| Prompts of our own | 16 | distinct prompts whose first 60 characters appear in a corpus built from `git ls-files` (tests, demos, docs) |
| Prompts from callers | 718 | 734 minus 16 |
| Generation calls with a caller's prompt | 962 | generation rows whose prompt is in the 718 |
| OAuth registrations | Grok Bot 31 (2026-10-08 to 2026-11-20); Cursor 12 (2026-08-26 to 2026-11-20); Grok 2 (2026-08-28) | `oauth_clients` by client name, all time to the end of the window, with first and last registration dates |
| Reviewer path, sign-in to first model | 195.8 s | measured run recorded in [grok-bot-listings.md](./grok-bot-listings.md) |

Weekly tool calls (week starting): 2026-10-05 1,125; 10-12 180; 10-19 362; 10-26 1,552; 11-02
1,381; 11-09 473; 11-16 474.

Kept out of the copy on purpose:

- Refresh grants (Grok 35, Grok Bot 15, Cursor 7) come from one or two accounts each and are most
  likely our own testing.
- The platform-wide forge median (141 s over 12,908 jobs) mixes lanes with a high self-hosted
  failure rate, so it is not a fair Grok number.
- The per-client session census (`mcp_client_daily`) stops on 2026-10-23, when the studio handler
  wrote to a column production does not have. That was fixed in `ce46a6940`; refresh the census
  after the next deploy. The request-log census (`--logs`) needs a window of a week or less: over
  the full 44 days the Cloud Logging read ran past the script's 15-minute limit on 2026-11-20,
  because our own uptime probes post to the endpoint every few seconds. Example:
  `node scripts/grok-comarketing-numbers.mjs --from 2026-11-14 --to 2026-11-20 --logs`.
- X signups so far: 0. No campaign post has gone out.
