# The X content pipeline

How @trythreews publishes posts, threads, native video, blog shares, and full X
Articles on a human cadence, from one reviewed queue.

This is internal marketing infrastructure. Nothing reaches X unless auto-publishing
is switched on for the Cloud Run service (or the owner runs one publish by hand),
and nothing reaches X that did not pass the editorial bar. Who releases a post
that passed is the queue's `approval` setting: the owner, or a policy that only
ever releases posts filmed against the live product
([Who approves a post](#who-approves-a-post)).

To write a post, start with [Writing a story](./x-story-authoring.md). An author working one
product area at a time is handed [the author brief](./x-story-author-brief.md), and an author
writing a long-form X Article is handed [the article brief](./x-article-author-brief.md).

---

## Why it exists

Posting to X from a script is easy. Posting in a way that does not read as a
bot is the hard part. Most automated accounts give themselves away the same way:
a link card instead of real media, a launch-deck opener, a hashtag, a post at
14:00:00 every day, the same format three times in a row, and a thread that
double-posts when the job retries. Every one of those is a rule in this
pipeline, enforced before anything is sent:

| Tell | What the pipeline does |
|---|---|
| Link cards and text-only posts | The head post must carry a native image, GIF, or video (`"textOnly": true` opts out on purpose). Media is uploaded to X, not linked. |
| A clip of a feature that does not work | A post's reel is a filmed run of its own scenario against production. If a step fails there is no reel, and a review runs the scenario again ([Proof reels](#proof-reels)). |
| Rules nobody re-measured | The queue reads its own results back through the X API and ranks with what they show ([What the queue learns](#what-the-queue-learns)). |
| Missing alt text | Every image and GIF needs alt text, sent to X as media metadata. |
| Silent autoplay | `prepare-video` burns captions into the clip, because most of the feed watches muted. |
| Hype copy | [api/_lib/x-content/quality.js](../api/_lib/x-content/quality.js) rejects launch openers ("Introducing", "We're excited"), hype vocabulary, hashtags, emoji, stacked exclamation marks, all-caps shouting, and en or em dashes. |
| Repeats | A head that reads too much like another queued item, or like anything @trythreews already posted (the scraped archive in `data/archives/` plus everything this pipeline published), is rejected. |
| Clockwork timing | Three slots a day inside US hours, every day, each opening at a jittered minute, with a minimum gap and a daily cap. |
| A schedule anyone can read off the repository | The slot jitter is an HMAC under `X_CONTENT_SCHEDULE_SEED` (production only), and which post fills a slot is decided at the moment it opens. Unset, the jitter falls back to a public hash, and `plan` says its minutes are placeholders. |
| A link that cannot be checked | Every link is resolved before a post can be approved, and again seconds before it is sent. npm answers 403 to any non-browser client, so a package page is resolved against `registry.npmjs.org`, which is the authoritative record of whether that package exists and answers any client. |
| A broken post stalling the feed | A post that cannot go out (a link is down, a feature probe fails, X rejects the content) is held with the reason and a backoff, and the slot goes to the next-best post in the same run. |
| Same format on repeat | Lane (audience) and pattern (post shape) rotate. A due item waits if it would repeat the previous lane or pattern too many times, unless it has been waiting a full day. |
| Retry double-posts | Every created media id, post id, and Article id is written to the ledger the moment X returns it. A crash mid-thread resumes at the next unposted reply. |

## What it can publish

| Kind | What goes out |
|---|---|
| `post` | One post, or a thread when `posts` has more than one entry. Each post may carry up to four images, or exactly one GIF or one video. |
| `post` imported from a blog or any URL | A native-image post with the page's own image and the canonical link, drafted by `import --as post`. |
| `article` | A full X Article (title, cover, headings, lists, quotes, links, inline images, code, tables) created with `POST /2/articles/draft` and published with `POST /2/articles/:id/publish`, followed by posts that quote it. |
| `article` imported from a blog or any URL | The page converted to Markdown with its images saved locally, drafted by `import --as article`, ending with an "Originally published at" link to the canonical page. |

X Articles require the posting account to be on X Premium.

## Where things live

| Path | Role |
|---|---|
| [data/x-content/queue.json](../data/x-content/queue.json) | The queue: cadence, quality limits, and every item. |
| `data/x-content/articles/<id>.md` | Article bodies, in Markdown. |
| `public/x-media/<id>/` | Media for queue items. Media must live under `public/` or `data/` so it ships inside the production image. |
| [api/_lib/x-content/](../api/_lib/x-content/) | The engine: voice and editorial lint, media rules, live fact verification, the AI editor, review records, Markdown to Article conversion, scheduler, publisher, ledger. |
| [api/_lib/x-content/reel.js](../api/_lib/x-content/reel.js) | Proof reels: the scenario runner, the frame-stepped camera, the encoder, and the proof record. |
| `data/x-content/stories/<id>.json` | Stories being written, one to a file, before `adopt` moves them into the queue. |
| `data/x-content/proofs/<id>.json` | What the filmed run did: each step, what it read, what the server answered, and the hash of the reel. |
| `public/x-media/<id>/reel.mp4` | The reel. |
| [api/_lib/x-content/outcomes.js](../api/_lib/x-content/outcomes.js) | The learning loop: measured results of the account's head posts, and the lifts learned from them. `app_settings` row `x_content_outcomes`. |
| [api/_lib/x-content/approval.js](../api/_lib/x-content/approval.js) | The approval policy. |
| [api/_lib/x-content/overlay.js](../api/_lib/x-content/overlay.js) | Signed bundles in object storage, laid over the image's files so a post can ship without a deploy. |
| [scripts/x-outcomes.mjs](../scripts/x-outcomes.mjs), [scripts/x-bundle.mjs](../scripts/x-bundle.mjs) | `npm run x:outcomes` and `npm run x:bundle`. |
| [api/_lib/x-content/llm.js](../api/_lib/x-content/llm.js) | The model chain (Vertex, Groq gpt-oss-120b, OpenRouter, OpenAI, NVIDIA NIM) the editor and the announcement drafter share. |
| [api/_lib/announce/](../api/_lib/announce/) | The [announcement factory](./announcement-factory.md): it fills this queue from the backlog of shipped surfaces nobody has posted about. |
| `data/x-content/reviews/<id>.json` | The editorial review record for each item, bound to a hash of the exact content that was reviewed. |
| [api/cron/x-content.js](../api/cron/x-content.js) | The Cloud Scheduler tick, every 15 minutes. |
| [scripts/x-content.mjs](../scripts/x-content.mjs) | The operator CLI. |
| `app_settings` row `x_content` | The publish ledger, shared by the cron and the CLI. |

## Queue item format

```json
{
	"id": "rig-doctor-clip",
	"status": "review",
	"kind": "post",
	"tier": 2,
	"priority": 10,
	"lane": "developer",
	"pattern": "clip",
	"notBefore": "2026-09-20T15:00:00Z",
	"posts": [
		{
			"text": "Drop a .glb on Rig Doctor and it names which of 15 rig conventions the skeleton follows, with nothing uploaded: three.ws/rig-doctor",
			"media": [{ "path": "public/x-media/rig-doctor-clip/clip.mp4", "probe": { "durationSec": 18.2, "width": 1920, "height": 1080, "fps": 60, "videoCodec": "h264", "pixFmt": "yuv420p", "audioCodec": "aac" } }]
		},
		{ "text": "Every clip in the library is authored against one canonical skeleton, so a rig that maps cleanly animates on arrival." }
	],
	"claims": [
		{
			"says": "15 rig conventions",
			"evidence": [
				{ "type": "page", "url": "https://three.ws/rig-doctor", "contains": "15 rig conventions recognised" },
				{ "type": "module", "path": "src/rig-report.js", "export": "CONVENTIONS", "length": 15 }
			]
		},
		{ "says": "with nothing uploaded", "evidence": [{ "type": "page", "url": "https://three.ws/rig-doctor", "contains": "Nothing is uploaded" }] },
		{ "says": "Every clip in the library is authored against one canonical skeleton", "evidence": [{ "type": "page", "url": "https://three.ws/rig-doctor", "contains": "Every clip in the three.ws library is authored against one canonical skeleton" }] }
	],
	"mentions": {},
	"probes": [
		{ "type": "browser", "name": "the Mixamo sample diagnoses end to end", "steps": [{ "goto": "https://three.ws/rig-doctor" }, { "click": "Mixamo rig" }, { "expect": "52 of 52 canonical joints mapped" }] },
		{ "type": "api", "name": "the sample rig the demo loads is live", "url": "https://three.ws/avatars/michelle.glb" }
	]
}
```

- `status`: `draft` (may be unfinished), `review` (must pass `check`), `approved` (eligible to publish), `paused`, `posted`. Move an item to `approved` with `npm run x:content -- approve <slug>` (or `--status review` for a whole batch), which refuses anything a passing review record does not already cover. `npm run x:content -- advance` does the whole line: it films, reviews, and releases what the policy allows.
- `scenario` is the run that is filmed: see [Proof reels](#proof-reels) and [Writing a story](./x-story-authoring.md). An item with a scenario declares `{ "type": "scenario" }` in `probes`.
- `covers` lists the backlog surfaces the story speaks for, by ledger key (`/galaxy`, `@three-ws/scene-mcp`, `workers/rig`), so the announcement plan stops offering them.
- `tier`: 1 (flagship: partner news, $THREE utility, major launches), 2 (features with proof), or 3 (proof of work: short demos, stats, build notes). Each tier owns one slot a day.
- `priority` is an optional owner boost from -50 to 50 on top of the computed score. `expiresAt` marks time-sensitive news: it rises as its window closes and is dropped once it passes. `notBefore` is an embargo: the post is not ready before it.
- `lane` and `pattern` are free-form labels; the score penalizes repeating the last ones.
- `probes` prove the feature works, not just that its page loads (types in the editorial bar below). Every post needs at least one.
- `claims` is the fact ledger. Every number, ordinal, and absolute word (first, only, every, never, fastest) in the copy must sit inside some claim's `says`, every `says` must quote the copy, and every claim carries at least one piece of `evidence` (types below).
- `mentions` maps each @handle in the copy to the reason the tag is true. A tag with no reason is blocked.
- `textFrom` is optional. When set, `check` fails if the inline text differs from that announcement-pack file, so the copy that was reviewed is the copy that ships.
- An `article` item carries `"article": { "title", "body", "cover": { "path" } }`, and its optional `posts` quote the published Article. The body is copy like any post: its prose (headings, paragraphs, lists and quotes; code blocks and tables are literal samples and exempt) goes through the same language lint and claims ledger, so a number in the fourth section needs evidence like one in the title, its links are resolved at review, and its words are spell-checked. Replacing an inline image makes the review stale, the same as editing the Markdown.

Cadence lives at the top of the file: `slots` (each `{ tier, at }` in UTC), `windowMinutes` (how far a slot's opening may be jittered), `minimumMinutesApart`, `dailyCap`, and `quietHoursUtc` (a `["HH:MM", "HH:MM"]` pair, which may wrap midnight). `quality` sets the similarity limits, the maximum same-lane and same-pattern runs, and `maximumLength`: the longest a post may be, in weighted characters. @trythreews is on X Premium, so the queue sets it above the standard 280; a value under 280 is ignored. `approval` is the policy described below.

**What the cap counts:** `dailyCap` limits scheduled posts in the last 24 hours, and a scheduled post is one the scheduler placed in a slot. A post an operator sends by hand (`run --id`) carries no slot and does not count toward it, because counting those let four owner-requested posts on one afternoon hold every slot shut the following morning. Hand-sent posts do still count toward `minimumMinutesApart`, which measures from the last post of any kind, so the schedule never fires minutes after a manual post. To fill an open slot by hand and keep the schedule's bookkeeping right, run a scheduler tick (`npm run x:content -- run`, no `--id`): it takes the same lock as the cron, picks the post the cron would, and records the slot so the cron sees it as used.

## How the next post is chosen

**When:** three slots a day, one per tier, every day of the week, all inside 12:00 to 20:00 UTC: T2 at 12:00, T1 at 15:30, T3 at 19:00 (8:00, 11:30 and 15:00 in New York). The volume study measured every original post against the $THREE pool's candles and found a post in that window was followed by a volume response about 1.7 times as often as one outside it, one of the two strongest effects in the model. The owner's 2026-09-20 cadence spread the three slots eight hours apart (04:00, 12:00, 20:00), which put two of them outside the window; on 2026-10-01 the owner made pool volume the goal, so all three moved inside it, three and a half hours apart. Each slot opens at a minute only the production seed can reproduce (up to `windowMinutes` late), and stays open for three hours (`slotOpenMinutes`), so a missed run or a deploy still posts, but no slot is ever spent twice. Slots are at least `minimumMinutesApart` apart even at their latest opening, so an earlier post never blocks a later slot. There are no quiet hours: the fixed slots already say when the account posts. `flagshipWeekdaysOnly` would withhold the T1 slot on Saturday and Sunday and keep T1 posts out of the lower slots too; the queue no longer sets it, and it is the one lever that would return the account to weekdays-only flagships.

**Three a day is a quota** (owner, 2026-09-30), so a slot is never left empty while an approved post
could fill it. When the usual order finds nothing, the slot takes, in turn:

1. **A higher tier's last ready post.** The usual order keeps a tier's last post for that tier's
   own slot, which only moves the gap: a post sent now is one the later slot can still be given new
   stock for.
2. **A post the policy released that is still in its veto window.** That embargo exists so the
   owner can take the post back, and an empty slot outweighs it; an alert says it went out early.
   An embargo the owner set by hand is never shortened.

A tick that finds an open slot with nothing to post raises an alert at once, and any slot that
closed unfilled in the last day is raised once as missed. The cure for either is stock:
`npm run x:content -- advance --ship`.

**What:** the slot's own tier first, highest priority first. Priority leads with **volume**, not engagement: [`data/x-content/volume-model.json`](../data/x-content/volume-model.json) is a logistic model fitted on every original post moment, and it gives each draft a chance of being followed by a volume response on the pool (the first hour after the post running at least twice the hour before). Pool volume is what pays creator rewards, so it outranks attention. The model rewards what the data rewarded: announcing something shipped, partner or recognition language, naming a tier-1 company, more than 180 characters, and a thread rather than a single post. `npm run x:content -- plan` prints each post's chance and the attributes found on it. If the model file is missing, the older engagement estimate takes over. Refit and re-export it from the study repo with `node analyze/volume-chart.mjs --asset three --export-model <this repo>/data/x-content/volume-model.json --export-exclude cryptoNative`. An empty tier falls to the next tier down, so the best available post always gets the best time. A higher tier only fills a lower slot when it has more than one post ready, so the last flagship post is kept for prime time. When nothing is ready, nothing posts, and the tick says so loudly (see the quota paragraph above).

**Priority** is a sum of named parts, and `npm run x:content:plan` prints them for every post:

| Part | What it measures |
|---|---|
| `learned` | What the account's own head posts of the last 90 days measured for a post of this shape (media, length, thread, tags, where the link sits), read through the X API. Present once 20 posts have matured. See [What the queue learns](#what-the-queue-learns). |
| `engagement` | The fallback when nothing has been learned yet: predicted lift from the archive report. |
| `timely` | Up to +20 as an `expiresAt` window closes. |
| `boost` | The owner's `priority`. |
| `waiting` | +1 per day ready, capped at +10, so nothing starves. |
| `review` | The AI editor's average score above or below 4. |
| `variety` | -25 when the post would repeat the last lane or pattern too many times in a row. |

**Quoting an earlier post:** a post item may carry `quotes`, the numeric id of an existing post (the id, not the URL, which the validator enforces). The head becomes a quote tweet of it and any further posts thread under the head as usual. That is how a follow-up adds the detail its original left out, such as the numbers behind a page, without repeating the original's copy.

**When a post fails:** it is held, not dropped. Link or probe failures and X rejecting the content (a 4xx such as a duplicate) hold the post for 2 hours, then 6, then 24, and the slot goes to the next post in the same run. Editing the post releases the hold at once. X being down, rate limiting, rejecting our credentials, or refusing the account because its API credits are spent (402) is not the post's fault, so the run stops and the next run retries the same post. A refusal of the account (401, 402, or a 403 that is not a duplicate) is also raised once a day as a critical alert that says what to fix, because until a person acts every slot is a missed one. A thread cut off mid-way always resumes before anything else.

**Stock:** every run counts approved, ready posts per tier (one per day). When any tier has fewer than 3 days left, it raises one alert a day through the platform's ops alerts: always recorded in `ops_alerts`, and pushed to Telegram when `TELEGRAM_ALERTS_CHAT_ID` is set on the service. Running low never makes the queue post something unreviewed; it only posts less.

## Proof reels

Every post the owner has taken down had passed the fact check, because a fact check proves a page
says something and not that the feature does it. A scenario closes that gap. It is a list of steps
run against production, and the run is the probe, the video, the captions, and the evidence at
once: if a step fails there is no reel and no post.

```bash
npm run x:content -- scout https://three.ws/galaxy --format square   # what the page offers a scenario
npm run x:content -- prove galaxy-search                             # run it, film it, record the proof
npm run x:content -- prove galaxy-search --no-film                   # run it without filming
```

How it is filmed, and why:

- **The page clock is stepped, not recorded.** A headless browser renders WebGL in software at one
  to three frames a second, and a recorder pads that to 25 by repeating frames. The runner takes
  over the page clock, advances it one frame, takes a picture, and repeats, so every frame of the
  reel is a distinct frame at exactly 1/30 s of page time. Galaxy measured 1.3 distinct frames a
  second recorded in real time and 30 stepped.
- **The page is composited on the CPU.** The browser runs with `--disable-gpu-compositing` and
  `--disable-gpu-rasterization`. Without them the page itself goes through the same software
  Vulkan device as the 3D scene, and one frame measured 3.5 to 15 seconds. With them a frame is
  about 110 to 250 ms and WebGL is unaffected. A 9 second reel films in under two minutes.
- **Waiting is cut and labelled.** Anything that waits on the network runs on the real clock and
  is not filmed; the reel shows how long was cut.
- **Nothing covers the product.** Captions, the cut badge, and a stamp with the production commit
  and the date sit in a bar under the page. Only the pointer is drawn on the page.
- **The proof is bound to the post.** `data/x-content/proofs/<id>.json` records the hash of the
  scenario and of the reel. Change a step, or swap the file, and the item no longer validates. A
  proof expires after 14 days.
- **Reviews run it again.** The `scenario` probe runs the steps unfilmed. A fact the post states
  exactly must still read what the reel shows; a fact it states as a floor (`min`) must stay at or
  above it; a fact no claim cites may move. A fact that broke its rule is a stale post: film it
  again.

A scenario needs a browser and ffmpeg, so reels are made where posts are reviewed. Production
only checks the record.

## What the queue learns

The rules this pipeline started with came from a scrape taken before X had loaded the like counts
of the account's largest posts. It reported that video loses to a still and that 100 to 179
characters is the best length. The X API says the opposite on both.

So the queue measures itself. After each tick's publish attempt it reads the account's head posts
(at most once every 6 hours), describes each one by its shape, and learns what each attribute is
worth over the last 90 days. X bills every post a read returns, so a refresh reads back only as far
as metrics can still be moving (7 days before the last read) and keeps the older, settled rows from
the stored record; only the first read, or one after a long gap, reads the whole window. A failed
read is paced like a read, so a refusal is not repeated every fifteen minutes. Outcomes are recency
weighted, small samples are shrunk toward nothing, and a post counts only once it is 48 hours old.
Replies are left out of the outcome on purpose, because on this account they are mostly
`$three @grok` farming. Hand-written posts teach it as much as its own.

```bash
npm run x:outcomes                # the learned table, and the best and worst posts of the window
npm run x:outcomes -- --refresh   # read X again first
npm run x:outcomes -- --compare   # the pipeline's posts against the hand-written ones
```

## Who approves a post

`approval` in the queue file:

```json
"approval": { "mode": "auto", "tiers": [2, 3], "vetoHours": 24 }
```

`mode` is `owner` (every post waits for `approve`) or `auto`. Under `auto` a post is released
without the owner only when all of these hold; anything else waits for the owner, and `advance`
says which one stopped it:

| Condition | Why |
|---|---|
| Its tier is listed | Tier 1 carries a partner's name or $THREE, so it stays with the owner unless the queue lists it. |
| It was filmed, and the proof covers it | A post never proven against the product is never released by policy. |
| It tags no one | A tag puts a partner's name next to ours. A person decides that. |
| The review passed on the editor's own verdict | An `editorOverride` is a person's judgment, so it needs a person. |

`npm run x:content -- advance --ship` is the whole line in one command: it films what needs
filming, reviews it, releases what the policy allows, and publishes every approved post as a
bundle.

A release by policy is embargoed for `vetoHours` and written to the ops alerts (and pushed to
Telegram when `TELEGRAM_ALERTS_CHAT_ID` is set), so there is always a window to take it back:

```bash
npm run x:content -- pause <slug>
```

## Publishing without a deploy

The queue, the review records and the media are files baked into the image, so by default a post
approved today goes out after the next production deploy. Bundles remove that wait:

```bash
npm run x:bundle -- publish --approved   # ship every approved, unpublished post
npm run x:bundle -- list                 # what production will see
npm run x:bundle -- verify               # signature and every file hash
npm run x:bundle -- pull                 # build the same directory production builds, to inspect
npm run x:bundle -- remove <slug>
```

A bundle is the item, its review record, its proof, and its media, stored in object storage by
content hash, with an index signed by `X_CONTENT_BUNDLE_SECRET`. At the start of a tick the cron
builds a directory with the image's files and the bundles' files in the same layout and runs the
unchanged engine against it, so every rule on this page still applies. A posted item is never
replaced. If the signature does not verify, a file does not match its hash, or storage is down, the
tick uses the image queue and says so in its response.

It is off until both are set on the service:

```bash
gcloud run services update three-ws-api --region us-central1 \
  --update-secrets X_CONTENT_BUNDLE_SECRET=x-content-bundle-secret:latest \
  --update-env-vars X_CONTENT_REMOTE_QUEUE=true
```

## Workflow

```bash
# 1. Draft from something that already exists
npm run x:content -- import agent-3d-web-component --as post --id web-component-share
npm run x:content -- import https://three.ws/blog/agent-3d-web-component --as article --id web-component-article
npm run x:content -- import https://example.com/our-guest-post --as article --id guest-post

# 2. Video: transcode to X's spec, burn in captions, and record the probe on the item
npm run x:content -- prepare-video ~/Desktop/rig-doctor.mov --out public/x-media/rig-doctor-clip/clip.mp4 --captions ~/Desktop/rig-doctor.srt --item rig-doctor-clip

# 3. Rewrite the imported copy in your own voice, declare its claims, then validate
npm run x:content:check

# 4. Run the editorial bar: live fact checks, spelling, media quality, and the AI editor
npm run x:content -- review web-component-article
npm run x:content -- review --status review

# 5. See exactly what would be sent, and when the queue will send it
npm run x:content -- run --dry-run --id web-component-article
npm run x:content:plan
```

`import` accepts a blog slug from `blog/`, a three.ws URL (read from this checkout, so it works before a deploy), or any public URL. SVG and AVIF images are rasterized, and oversized images are recompressed to fit X's 5 MB limit. Imports always land as `draft`: the importer cannot know your voice, and the lint cannot either, so a human rewrites the copy before it moves to `review`.

Images for other channels come from [the announcement capture tool](./announcements/README.md) (`npm run announce:media`), which records frames from the live product; point queue media at those files.

## The editorial bar

Formatting rules keep a feed from looking automated. They do not stop a post from being wrong, and a wrong post from a company account costs more than no post. So nothing can be `approved` until `npm run x:content -- review <id>` passes, and the record it writes is bound to a hash of the copy, every media file's bytes, the alt text, the claims, and the mentions. Change one word or swap one image and the approval is void until the item is reviewed again. A record also expires after 14 days, because facts drift. The production cron enforces the same rule from the records that ship in the image.

A review runs five layers, cheapest first:

| Layer | What it catches | Where |
|---|---|---|
| Voice lint | Hype openers, hashtags, emoji, dashes, stacked exclamation marks, shouting, repeats of earlier posts | [quality.js](../api/_lib/x-content/quality.js) |
| Editorial lint | Brand spelling (three.ws, $THREE, GitHub, NVIDIA, glTF, X not Twitter); anything that reads as a price promise or investment pitch; crypto slang; marketing filler; engagement begging; rhetorical-question openers and one-word drumbeats; more than one link or two tags; undeclared numbers, absolutes, and tags | [editorial.js](../api/_lib/x-content/editorial.js) |
| Media quality | Images under 1200 px wide, crops X will cut in the timeline, alt text that is too short or repeats the post, and frames captured more than 21 days ago (recapture with `npm run announce:media`) | [editorial.js](../api/_lib/x-content/editorial.js) |
| Live verification | Every claim against its evidence at the moment of review, every link resolved, every @mention confirmed as a real public X account, and spelling in US or British English (add correct product terms to `quality.glossary`) | [verify.js](../api/_lib/x-content/verify.js) |
| AI editor | Whether the post is actually good: accuracy against the verified evidence, clarity for a reader who has never heard of three.ws, specificity, voice, a partner-safe professional tone, and whether the image supports the copy. It sees the images, scores six dimensions, quotes each issue with a concrete fix, and proposes a rewrite, which is linted too | [editor.js](../api/_lib/x-content/editor.js) |

Evidence types:

| `type` | Passes when |
|---|---|
| `page` | The live page, rendered in a real browser and allowed to finish rendering, contains `contains` |
| `file` | A repo file contains `contains`, or matches the `matches` regular expression |
| `module` | A repo module's `export` has `length` entries, or equals `equals` |
| `github-issue` | `repo#number` has the given `state` and `label` |
| `github-issues` | `repo` has at least `min` issues with the given `state` and `label` |
| `proof` | The item's filmed run read the `fact` off the screen (`equals`, `contains`, or at least `min`), waited for the text in `saw`, or got an answer from the path in `responded` |

Feature probes, in `probes`, run as part of every review, and the `api` ones run again seconds before a post goes out:

| `type` | Passes when | Runs |
|---|---|---|
| `api` | A URL answers 2xx (or `expect.status`), and optionally contains `expect.contains` or has a JSON value at `expect.json.path` (`equals`, `exists`, `min`) | review and pre-flight |
| `browser` | Driving the live page in a real browser (`goto`, `click`, `expect` steps) reaches the expected result | review |
| `command` | A repo test that exercises the exact behavior the post claims exits 0 (`argv`) | review |
| `scenario` | The item's scenario passes against the live product, and every fact it reads is the fact the reel shows | review |

The live product is the source of truth. When a screenshot disagrees with the live page, the screenshot is stale: recapture it and use the live number. The editor is instructed the same way, and its verdict cannot pass an item it raised a blocking issue on or scored below 4 anywhere. Where a human disagrees with a `revise` verdict that has no blocking issue, `"editorOverride": { "reason": "..." }` on the item records the decision; nothing overrides a failed fact check or blocking lint.

For a reel the editor is given four frames from it, its captions, and the record of the run, since it cannot watch video. It is calibrated against the account's best posts as the X API measured them.

The editor tries Claude on Vertex AI first, then gpt-oss-120b on Groq (skipped when the request carries an image, so a review that must see its media routes to a multimodal rung), then Claude through OpenRouter, then OpenAI, then Kimi K3 on NVIDIA NIM, falling through on any provider or billing error; each record names the model that reviewed it. The CLI reads missing credentials from the Cloud Run service and uses the signed-in `gh` session for GitHub checks.

This bar caught real errors in the first three queued posts. The Rig Doctor post said the tool knew 11 rig conventions while the live page and code said 15, called a merged fix "an open first issue" when no such issue was open, and shipped a screenshot from before the change. The AWS post was 94 characters and stated no mechanism, and an AI rewrite of it upgraded "an AWS Partner" to "a verified AWS Partner", which no evidence supports.

## Going live

Posting is owner-gated. The cron ships in preview mode: with `X_CONTENT_AUTO_PUBLISH` unset, each tick returns the exact API calls it would make, which is how the queue is verified in production first.

1. The @trythreews user tokens must be on the Cloud Run service. `X_API_KEY` and `X_API_SECRET` are already there; `X_ACCESS_TOKEN` and `X_ACCESS_SECRET` (generated for @trythreews in the X developer portal, with Read and Write) must be added with `gcloud run services update three-ws-api --region us-central1 --update-secrets` or `--update-env-vars`.
2. Deploy, which bakes the queue and media into the image, and sync the Cloud Scheduler job from `vercel.json` with [scripts/create-gcp-scheduler.mjs](../scripts/create-gcp-scheduler.mjs).
3. Read a preview tick: the scheduler job's response, or `gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" textPayload:"x-content"' --freshness=1h`.
4. Review each item (`npm run x:content -- review <id>`), set the passing ones to `approved`, commit their review records, and deploy. To publish one item by hand instead of waiting: `npm run x:content -- run --id <slug>` (needs `DATABASE_URL`, so the ledger prevents a double post).
5. To publish automatically: `gcloud run services update three-ws-api --region us-central1 --update-env-vars X_CONTENT_AUTO_PUBLISH=true`.

Queue edits reach production with the next deploy, because the cron reads the queue from the image. The ledger is in the database, so a redeploy never republishes anything.

## Limits enforced

| Media | Limit |
|---|---|
| Image (JPG, PNG, WEBP) | 5 MB, up to four per post, alt text up to 1,000 characters |
| GIF | 15 MB, alone on its post |
| Video (MP4, MOV) | 512 MB, 0.5 to 140 s, 32 px to 1920x1200, aspect 1:3 to 3:1, up to 60 fps, H.264 yuv420p with AAC audio, alone on its post |

**Recording a WebGL page:** a headless capture renders at whatever rate the page manages, which is around 3 frames a second for a 3D scene on software GL. The encoder then pads that to 25 fps by repeating frames, and the result reads as choppy: the first Portal clip shipped 1010 frames carrying 128 distinct images. `--speed <n>` on `prepare-video` drops the padding instead of the content, so the same images play over a shorter clip and the motion reads as continuous. The Portal capture went from 3.2 unique frames per second to 9.4 at `--speed 3`, and the file halved. Record with slow, deliberate camera movement and speed it up afterwards, rather than moving fast in real time. Burned-in captions are rendered before the retime and sped up with the picture, so they stay in sync, and audio is retimed with `atempo` to match. Motion interpolation was measured and rejected: at 3 fps the camera moves too far between frames for block matching to help.
| Article | Title under 100 characters, a cover image, at least three blocks, code and tables totalling 10,000 characters or fewer |

## Tests

[tests/x-content-reel.test.js](../tests/x-content-reel.test.js) covers scenario validation, the proof binding, proof as evidence, post length, and what the editor is given for a reel. [tests/x-content-approval.test.js](../tests/x-content-approval.test.js) covers the approval policy and story coverage. [tests/x-content-outcomes.test.js](../tests/x-content-outcomes.test.js) covers the learning loop, and [tests/x-content-overlay.test.js](../tests/x-content-overlay.test.js) the bundles.

[tests/x-content.test.js](../tests/x-content.test.js) covers the tiered slots, fill-down, priority scoring, holds and the fall-through that publishes the next post when one fails, stock counting, quote-tweet ids and their publish wiring, hand-sent posts counting toward spacing but not the cap, the video speed-up filter chain and its caption ordering, the voice and editorial lint, the claims ledger, media quality, review records binding approval to exact content, the editor verdict rules, the media rules, the Markdown to Article offsets, the scheduler's spacing, cap, embargo, and resume rules, and the publisher's thread chaining, crash resume, and Article draft, publish, and quote sequence.
