# X research store

Public posts from other X accounts that we study (demo formats, launch patterns, what earns engagement), pulled from the X API by [scripts/x-user-timeline.mjs](../../scripts/x-user-timeline.mjs). Our own accounts live in [data/x-archive/](../x-archive/README.md) instead.

Every X API post read is billed ($0.005 per post, $0.010 per user lookup, docs.x.com pricing as of 2026-11-26). This directory exists so we pay for each post once: every read is written here and committed, and every later run starts from the stored file.

## Files

- `<handle>.json`: one store per account.
  - `user`: the profile from the first lookup. The stored user id lets later runs skip the lookup charge.
  - `posts[]`, newest first: text, kind, media (photo URLs and the highest-bitrate MP4 for videos), outbound links, and the full body of any X Article in `article.text`. `metrics` is the latest measurement with `metricsAt`; `metricsHistory` keeps every distinct measurement, because engagement is a time series. `sources` records how each post arrived.
  - `pulls[]`: a ledger of every paid run, with its read count and estimated cost.

## Commands

```bash
node scripts/x-user-timeline.mjs <handle> --top 25             # rank stored posts by engagement: free, offline, no credentials
GCP_PROJECT=three-ws node scripts/x-user-timeline.mjs <handle>  # pay only for posts newer than the newest stored
node scripts/x-user-timeline.mjs <handle> --backfill           # posts older than the oldest stored, as far as the API reaches
node scripts/x-user-timeline.mjs <handle> --ids 1,2,3          # specific posts; ids already stored are skipped
node scripts/x-user-timeline.mjs <handle> --articles           # X Article bodies not stored yet (each post is read once)
node scripts/x-user-timeline.mjs <handle> --refresh-metrics    # re-measure every stored post (paid, one read per post)
node scripts/x-user-timeline.mjs <handle> --import file.json   # merge an earlier pull for free
```

`--max N` caps the paid post reads of a timeline run (default 100, ceiling 3200). Credentials come from `X_API_BEARER`, or from `X_API_KEY` plus `X_API_SECRET` (exchanged for an app-only bearer), looked up in the environment, `.env`, and then the Cloud Run service. Pin the gcloud account with `CLOUDSDK_CORE_ACCOUNT` when several are signed in.

## Limits worth knowing

- **The timeline API reaches back about 3,200 posts, and replies and reposts count toward that.** For an account that replies a lot, the reach is a few months of original posts. To get older top posts, take ids from the keyless syndication feed (`api/_lib/x-syndication.js`) and fetch them with `--ids`.
- **Media are CDN URLs.** Watching or downloading them costs no API reads, but a video disappears if the author deletes the post.
- **Other people's words.** These posts can name other tokens or projects. Under the commit gate in CLAUDE.md, a store that references a crypto project other than $THREE needs owner approval before it is committed.

## Stores

- `poteto.json`: @poteto (Grok @bot team at xAI), the account the owner named as posting the best demos. 452 posts: every original post from 2026-08-23 to 2026-11-25 plus her all-time top posts. The analysis is in [docs/x-demo-playbook.md](../../docs/x-demo-playbook.md).
