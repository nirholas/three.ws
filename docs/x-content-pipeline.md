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
| Missing alt text | Every image and GIF needs alt text, sent to X as media metadata. |
| Silent autoplay | `prepare-video` burns captions into the clip, because most of the feed watches muted. |
| Hype copy | [api/_lib/x-content/quality.js](../api/_lib/x-content/quality.js) rejects launch openers ("Introducing", "We're excited"), hype vocabulary, hashtags, emoji, stacked exclamation marks, all-caps shouting, and en or em dashes. |
| Repeats | A head that reads too much like another queued item, or like anything @trythreews already posted (the scraped archive in `data/archives/` plus everything this pipeline published), is rejected. |
| Clockwork timing | Each item lands at a stable, jittered minute inside a window after its `notBefore`, with a minimum gap, a daily cap, and quiet hours. |
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
| [api/_lib/x-content/](../api/_lib/x-content/) | The engine: quality lint, media rules, Markdown to Article conversion, scheduler, publisher, ledger. |
| [api/cron/x-content.js](../api/cron/x-content.js) | The Cloud Scheduler tick, every 15 minutes. |
| [scripts/x-content.mjs](../scripts/x-content.mjs) | The operator CLI. |
| `app_settings` row `x_content` | The publish ledger, shared by the cron and the CLI. |

## Queue item format

```json
{
	"id": "rig-doctor-clip",
	"status": "review",
	"kind": "post",
	"lane": "developer",
	"pattern": "clip",
	"notBefore": "2026-09-20T15:00:00Z",
	"windowMinutes": 90,
	"posts": [
		{
			"text": "Drop a GLB on Rig Doctor and it names the skeleton convention before the bones finish loading: three.ws/rig-doctor",
			"textFrom": "docs/announcements/open-source-friday.post.txt",
			"media": [{ "path": "public/x-media/rig-doctor-clip/clip.mp4", "probe": { "durationSec": 18.2, "width": 1920, "height": 1080, "fps": 60, "videoCodec": "h264", "pixFmt": "yuv420p", "audioCodec": "aac" } }]
		},
		{ "text": "Eleven rig conventions so far. The twelfth is an open first issue." }
	]
}
```

- `status`: `draft` (may be unfinished), `review` (must pass `check`), `approved` (eligible to publish), `paused`, `posted`.
- `lane` and `pattern` are free-form labels; rotation compares them against what was published last.
- `textFrom` is optional. When set, `check` fails if the inline text differs from that announcement-pack file, so the copy that was reviewed is the copy that ships.
- An `article` item carries `"article": { "title", "body", "cover": { "path" } }`, and its optional `posts` quote the published Article.

Cadence lives at the top of the file: `windowMinutes`, `minimumMinutesApart`, `dailyCap`, and `quietHoursUtc` (a `["HH:MM", "HH:MM"]` pair, which may wrap midnight). `quality` sets the similarity limits and the maximum same-lane and same-pattern runs.

## Workflow

```bash
# 1. Draft from something that already exists
npm run x:content -- import agent-3d-web-component --as post --id web-component-share
npm run x:content -- import https://three.ws/blog/agent-3d-web-component --as article --id web-component-article
npm run x:content -- import https://example.com/our-guest-post --as article --id guest-post

# 2. Video: transcode to X's spec, burn in captions, and record the probe on the item
npm run x:content -- prepare-video ~/Desktop/rig-doctor.mov --out public/x-media/rig-doctor-clip/clip.mp4 --captions ~/Desktop/rig-doctor.srt --item rig-doctor-clip

# 3. Rewrite the imported copy in your own voice, then validate
npm run x:content:check

# 4. See exactly what would be sent, and when the queue will send it
npm run x:content -- run --dry-run --id web-component-article
npm run x:content:plan
```

`import` accepts a blog slug from `blog/`, a three.ws URL (read from this checkout, so it works before a deploy), or any public URL. SVG and AVIF images are rasterized, and oversized images are recompressed to fit X's 5 MB limit. Imports always land as `draft`: the importer cannot know your voice, and the lint cannot either, so a human rewrites the copy before it moves to `review`.

Images for other channels come from [the announcement capture tool](./announcements/README.md) (`npm run announce:media`), which records frames from the live product; point queue media at those files.

## Going live

Posting is owner-gated. The cron ships in preview mode: with `X_CONTENT_AUTO_PUBLISH` unset, each tick returns the exact API calls it would make, which is how the queue is verified in production first.

1. The @trythreews user tokens must be on the Cloud Run service. `X_API_KEY` and `X_API_SECRET` are already there; `X_ACCESS_TOKEN` and `X_ACCESS_SECRET` (generated for @trythreews in the X developer portal, with Read and Write) must be added with `gcloud run services update three-ws-api --region us-central1 --update-secrets` or `--update-env-vars`.
2. Deploy, which bakes the queue and media into the image, and sync the Cloud Scheduler job from `vercel.json` with [scripts/create-gcp-scheduler.mjs](../scripts/create-gcp-scheduler.mjs).
3. Read a preview tick: the scheduler job's response, or `gcloud logging read 'resource.type="cloud_run_revision" resource.labels.service_name="three-ws-api" textPayload:"x-content"' --freshness=1h`.
4. Set items to `approved` and deploy. To publish one item by hand instead of waiting: `npm run x:content -- run --id <slug>` (needs `DATABASE_URL`, so the ledger prevents a double post).
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

[tests/x-content.test.js](../tests/x-content.test.js) covers the lint, the media rules, the Markdown to Article offsets, the scheduler's jitter, spacing, cap, rotation, and resume rules, and the publisher's thread chaining, crash resume, and Article draft, publish, and quote sequence.
