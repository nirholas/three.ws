# The X content pipeline

How @trythreews publishes posts, threads, native video, blog shares, and full X
Articles on a human cadence, from one reviewed queue.

This is internal marketing infrastructure. Nothing reaches X without two owner
decisions: an item's `status` set to `approved`, and auto-publishing switched on
for the Cloud Run service (or the owner running one publish by hand).

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
| The same picture on every post | A post leads with the product itself: a screen recording of the live site or a screenshot of it. A head whose only media is a templated card (anything a spec in `data/x-content/cards/` renders) is refused, and so is a head image or clip that another post already led with. Cards can still ride in replies. |
| Missing alt text | Every image and GIF needs alt text, sent to X as media metadata. |
| Silent autoplay | `prepare-video` burns captions into the clip, because most of the feed watches muted. |
| Hype copy | [api/_lib/x-content/quality.js](../api/_lib/x-content/quality.js) rejects launch openers ("Introducing", "We're excited"), hype vocabulary, hashtags, emoji, stacked exclamation marks, all-caps shouting, and en or em dashes. |
| Repeats | A head that reads too much like another queued item, or like anything @trythreews already posted (the scraped archive in `data/archives/` plus everything this pipeline published), is rejected. |
| Clockwork timing | Three slots a day at the hours this account's own posts performed best, each opening at a jittered minute, with a minimum gap, a daily cap, and quiet hours. |
| A schedule anyone can read off the repository | The slot jitter is an HMAC under `X_CONTENT_SCHEDULE_SEED` (production only), and which post fills a slot is decided at the moment it opens. Unset, the jitter falls back to a public hash, and `plan` says its minutes are placeholders. |
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
| [api/_lib/x-content/llm.js](../api/_lib/x-content/llm.js) | The model chain (Vertex, OpenRouter, OpenAI, NVIDIA NIM) the editor and the announcement drafter share. |
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

- `status`: `draft` (may be unfinished), `review` (must pass `check`), `approved` (eligible to publish), `paused`, `posted`. Move an item to `approved` with `npm run x:content -- approve <slug>` (or `--status review` for a whole batch), which refuses anything a passing review record does not already cover.
- `tier`: 1 (flagship: partner news, $THREE utility, major launches), 2 (features with proof), or 3 (proof of work: short demos, stats, build notes). Each tier owns one slot a day.
- `priority` is an optional owner boost from -50 to 50 on top of the computed score. `expiresAt` marks time-sensitive news: it rises as its window closes and is dropped once it passes. `notBefore` is an embargo: the post is not ready before it.
- `lane` and `pattern` are free-form labels; the score penalizes repeating the last ones.
- `probes` prove the feature works, not just that its page loads (types in the editorial bar below). Every post needs at least one.
- `claims` is the fact ledger. Every number, ordinal, and absolute word (first, only, every, never, fastest) in the copy must sit inside some claim's `says`, every `says` must quote the copy, and every claim carries at least one piece of `evidence` (types below).
- `mentions` maps each @handle in the copy to the reason the tag is true. A tag with no reason is blocked.
- `textFrom` is optional. When set, `check` fails if the inline text differs from that announcement-pack file, so the copy that was reviewed is the copy that ships.
- An `article` item carries `"article": { "title", "body", "cover": { "path" } }`, and its optional `posts` quote the published Article.

Cadence lives at the top of the file: `slots` (each `{ tier, at }` in UTC), `windowMinutes` (how far a slot's opening may be jittered), `minimumMinutesApart`, `dailyCap`, and `quietHoursUtc` (a `["HH:MM", "HH:MM"]` pair, which may wrap midnight). `quality` sets the similarity limits and the maximum same-lane and same-pattern runs.

## How the next post is chosen

**When:** three slots a day, one per tier, all inside 12:00 to 20:00 UTC (8 AM to 4 PM New York): T3 at 12:30, T1 at 16:00 (noon New York), T2 at 19:30. The volume study measured every original post against 1-minute candles of the $THREE pool: a post inside that window was followed by a volume response about 1.7 times as often as one outside it, and it is also when the pool trades most. Each slot opens at a minute only the production seed can reproduce (up to `windowMinutes` late), and stays open for three hours (`slotOpenMinutes`), so a missed run or a deploy still posts, but no slot is ever spent twice. Slots are at least `minimumMinutesApart` apart even at their latest opening, so an earlier post never blocks a later slot. Quiet hours are 02:00 to 07:00 UTC. With `flagshipWeekdaysOnly` (on), the T1 slot does not open on Saturday or Sunday and T1 posts do not fill the lower slots either: the pool trades about two thirds of its weekday volume on a weekend and the hour after a post moves less than half the dollars, so a flagship post waits for Monday.

**What:** the slot's own tier first, highest priority first. Priority leads with **volume**, not engagement: [`data/x-content/volume-model.json`](../data/x-content/volume-model.json) is a logistic model fitted on every original post moment, and it gives each draft a chance of being followed by a volume response on the pool (the first hour after the post running at least twice the hour before). Pool volume is what pays creator rewards, so it outranks attention. The model rewards what the data rewarded: announcing something shipped, partner or recognition language, naming a tier-1 company, more than 180 characters, and a thread rather than a single post. `npm run x:content -- plan` prints each post's chance and the attributes found on it. If the model file is missing, the older engagement estimate takes over. Refit and re-export it from the study repo with `node analyze/volume-chart.mjs --asset three --export-model <this repo>/data/x-content/volume-model.json --export-exclude cryptoNative`. An empty tier falls to the next tier down, so the best available post always gets the best time. A higher tier only fills a lower slot when it has more than one post ready, so the last flagship post is kept for prime time. When nothing is ready, nothing posts: three a day is a ceiling, not a quota.

**Priority** is a sum of named parts, and `npm run x:content:plan` prints them for every post:

| Part | What it measures |
|---|---|
| `engagement` | Predicted lift from how @trythreews posts with the same signals actually performed (format, length, topic), using the same classifiers as the engagement report. Small samples are shrunk toward no effect, and overlapping signals are not stacked. |
| `timely` | Up to +20 as an `expiresAt` window closes. |
| `boost` | The owner's `priority`. |
| `waiting` | +1 per day ready, capped at +10, so nothing starves. |
| `review` | The AI editor's average score above or below 4. |
| `variety` | -25 when the post would repeat the last lane or pattern too many times in a row. |

**When a post fails:** it is held, not dropped. Link or probe failures and X rejecting the content (a 4xx such as a duplicate) hold the post for 2 hours, then 6, then 24, and the slot goes to the next post in the same run. Editing the post releases the hold at once. X being down, rate limiting, or rejecting our credentials is not the post's fault, so the run stops and the next run retries the same post. A thread cut off mid-way always resumes before anything else.

**Stock:** every run counts approved, ready posts per tier (one per day). When any tier has fewer than 3 days left, it raises one alert a day through the platform's ops alerts: always recorded in `ops_alerts`, and pushed to Telegram when `TELEGRAM_ALERTS_CHAT_ID` is set on the service. Running low never makes the queue post something unreviewed; it only posts less.

## Workflow

```bash
# 1. Draft from something that already exists
npm run x:content -- import agent-3d-web-component --as post --id web-component-share
npm run x:content -- import https://three.ws/blog/agent-3d-web-component --as article --id web-component-article
npm run x:content -- import https://example.com/our-guest-post --as article --id guest-post

# 2. Video: record the live feature in a real browser (see "Recording the product" below)
node scripts/record-x-clip.mjs --spec data/x-content/clips/web-component-share.json --item web-component-share
#    or bring your own screen recording: transcode to X's spec, burn in captions, record the probe
npm run x:content -- prepare-video ~/Desktop/rig-doctor.mov --out public/x-media/rig-doctor-clip/clip.mp4 --captions ~/Desktop/rig-doctor.srt --item rig-doctor-clip

# 3. Rewrite the imported copy in your own voice, declare its claims, then validate
npm run x:content:check

# 4. Run the editorial bar: live fact checks, spelling, media quality, and the AI editor
npm run x:content -- review web-component-article
npm run x:content -- review --status review

# 5. Run the feature itself end to end, and prove every promise the copy makes
npm run x:content -- trial web-component-article

# 6. See exactly what would be sent, and when the queue will send it
npm run x:content -- run --dry-run --id web-component-article
npm run x:content:plan
```

`import` accepts a blog slug from `blog/`, a three.ws URL (read from this checkout, so it works before a deploy), or any public URL. SVG and AVIF images are rasterized, and oversized images are recompressed to fit X's 5 MB limit. Imports always land as `draft`: the importer cannot know your voice, and the lint cannot either, so a human rewrites the copy before it moves to `review`.

Images for other channels come from [the announcement capture tool](./announcements/README.md) (`npm run announce:media`), which records frames from the live product; point queue media at those files.

## Recording the product

[scripts/record-x-clip.mjs](../scripts/record-x-clip.mjs) opens a live three.ws page in Chromium, drives it through a short list of steps, and records what the page really paints (a CDP screencast, frame times preserved) into an H.264 MP4 that `prepare-video` then probes. It also saves a full-resolution `poster.png` from the same run, for posts where a still fits better. Nothing in a clip is staged: the captions and the cursor dot are drawn over the live page, and a `cut` skips waiting time but its caption states the seconds that really passed.

A spec lives at `data/x-content/clips/<id>.json`. With no `steps`, the clip is a plain tour (the hero, down the page, back up). A flagship post deserves a scripted demo, like the Forge one:

```json
{
	"out": "public/x-media/forge-text-to-3d/clip.mp4",
	"url": "https://three.ws/forge",
	"steps": [
		{ "caption": "Type what you want." },
		{ "type": "a weathered brass diving helmet", "into": "#prompt", "delay": 70 },
		{ "click": "#generate" },
		{ "cut": { "waitFor": "#state-result:not(.is-hidden)", "timeout": 300000 }, "caption": "{seconds} seconds later" },
		{ "drag": { "on": "#viewer", "by": [360, 0] }, "ms": 2800 },
		{ "poster": true }
	]
}
```

| Step | Does |
|---|---|
| `wait`, `waitFor` | Hold for milliseconds, or until a selector is visible |
| `scroll`, `scrollTo` | Smooth scroll by pixels, or to an element |
| `move`, `hover`, `click` | Glide a visible cursor to an element or `[x, y]`, then click |
| `type` (with `into`), `press` | Type at a human pace, press a key |
| `drag` | Drag between points, or from an element's center `by` an offset (orbit a 3D model) |
| `caption` | Show a caption over the page in the site's own type; `null` clears it |
| `cut` | Stop recording until a selector appears, then resume; `{seconds}` in its caption is the real wait |
| `poster` | Save this moment as `poster.png` |

A step that fails saves `failed-step-<n>.png` next to the clip, so you can see the page at that moment. `--item <id>` attaches the clip to that item's head post. `--backfill` records every unsent draft or review item that has a three.ws page and still leads with a still. The announcement factory (`npm run announce:kit`) writes a tour spec for every page surface it packs and, with `--capture`, records it in the same pass.

Desktop clips are 720p (the screencast paints at CSS-pixel size); posters are 1080p. Recording runs a software-rendered GPU, so a WebGL-heavy page takes about a minute per clip.

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

Feature probes, in `probes`, run as part of every review, and the `api` ones run again seconds before a post goes out:

| `type` | Passes when | Runs |
|---|---|---|
| `api` | A URL answers 2xx (or `expect.status`), and optionally contains `expect.contains` or has a JSON value at `expect.json.path` (`equals`, `exists`, `min`) | review and pre-flight |
| `browser` | Driving the live page in a real browser (`goto`, `click`, `expect` steps) reaches the expected result | review |
| `command` | A repo test that exercises the exact behavior the post claims exits 0 (`argv`) | review |
| `job` | A long-running action submitted to `submit.url` finishes (`until`), polled at the URL found at `pollUrl`, and carries `expect.path`; `fail` ends it early on a failed status | review and trial |

The live product is the source of truth. When a screenshot disagrees with the live page, the screenshot is stale: recapture it and use the live number. The editor is instructed the same way, and its verdict cannot pass an item it raised a blocking issue on or scored below 4 anywhere. Where a human disagrees with a `revise` verdict that has no blocking issue, `"editorOverride": { "reason": "..." }` on the item records the decision; nothing overrides a failed fact check or blocking lint.

The editor tries Claude on Vertex AI first, then Claude through OpenRouter, then OpenAI, then Kimi K3 on NVIDIA NIM, falling through on any provider or billing error; each record names the model that reviewed it. The CLI reads missing credentials from the Cloud Run service and uses the signed-in `gh` session for GitHub checks.

This bar caught real errors in the first three queued posts. The Rig Doctor post said the tool knew 11 rig conventions while the live page and code said 15, called a merged fix "an open first issue" when no such issue was open, and shipped a screenshot from before the change. The AWS post was 94 characters and stated no mechanism, and an AI rewrite of it upgraded "an AWS Partner" to "a verified AWS Partner", which no evidence supports.

## The feature trial

Review proves the copy matches the page. A page can say anything, so that is not enough. On 2026-09-19 a Materialize post passed review with "We print it and ship it to you" because the page said so, and three.ws does not print or ship anything. The trial gate exists so that cannot happen again: **nothing is approved, and nothing is sent, unless the feature it promotes was run end to end in the last 3 days and every promise in the copy is proven.**

Each item declares its trial in `data/x-content/trials/<id>.json`:

```json
{
	"journey": "A reader types a prompt into the free Forge and gets a textured 3D model back.",
	"steps": [
		{
			"type": "job",
			"name": "a free text-to-3D generation finishes with a GLB",
			"submit": { "url": "https://three.ws/api/mcp-studio", "body": { "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "forge_free", "arguments": { "prompt": "a small green ceramic frog", "tier": "draft" } } } },
			"inline": { "path": "result.structuredContent.glbUrl" },
			"pollUrl": "result.structuredContent.pollUrl",
			"until": { "path": "status", "equals": "done" },
			"fail": { "path": "status", "in": ["failed", "error"] },
			"expect": { "path": "glb_url" },
			"timeoutMs": 600000
		}
	],
	"attestations": []
}
```

`npm run x:content -- trial <id>` runs every step against production, then the model chain lists every promise the post makes to a reader (what they can do, what they get, how fast, what it costs, who does what for them) and names the step or attestation that proves each one. A promise nothing proves, or one "proven" by a step that failed, blocks the post. The run is written to `data/x-content/trial-runs/<id>.json`, bound to the post and the trial spec, and it expires after 3 days. `approve` refuses an item without a fresh passing run, the production cron holds one whose run went stale, and the trial's `api` steps run again seconds before sending.

Steps use the probe types below, plus `job`, which submits a long-running action (a generation, a rig, a render) and polls it until it finishes. "The job was accepted" is exactly the check that passes while the worker behind it is down, so anything a user waits on is trialed as a `job`. Some endpoints finish fast work inside the submit call and only hand back a poll handle when the job outlives it (`/api/mcp-studio` does): give such a step `"inline": { "path": "result.structuredContent.glbUrl" }` and a submit answer that already carries that value counts as finished. When a submit answers with neither a result nor a poll handle, the step fails and quotes the answer, so "the generator is busy" reads as exactly that.

`attestations` cover promises no machine can check, such as a human fulfilling an order. Each names who confirmed it (`by`) and when (`at`), and expires after 30 days. They are the owner's word, never an agent's: an agent leaves such a promise unproven, and the gate sends it to the owner.

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
| Article | Title under 100 characters, a cover image, at least three blocks, code and tables totalling 10,000 characters or fewer |

## Tests

[tests/x-content.test.js](../tests/x-content.test.js) covers the tiered slots, fill-down, priority scoring, holds and the fall-through that publishes the next post when one fails, stock counting, the voice and editorial lint, the claims ledger, media quality, review records binding approval to exact content, the editor verdict rules, the media rules, the Markdown to Article offsets, the scheduler's spacing, cap, embargo, and resume rules, and the publisher's thread chaining, crash resume, and Article draft, publish, and quote sequence.
