# X post reader

One official reader for public X posts, shared by the price-impact tools.

## Reader: `api/_lib/x-syndication.js`

`readXPost(postUrl)` returns `{ id, url, ts, createdAt, author, text, metrics, media, source }` with `source: "x-api"`.

It calls the official X API v2 (`GET /2/tweets/:id`) through `api/_lib/x-api.js`, with this deployment's own credentials and an honest `three.ws/1.0` user agent. Set `X_BEARER_TOKEN` (or `TWITTER_BEARER_TOKEN`, or the `X_API_KEY` and `X_API_SECRET` pair). There is no keyless or scraped fallback.

Metrics X does not report are `null`, never guessed.

Errors: `XPostError` with `status` 400 (not a post URL), 404 `PostUnavailableError` (deleted, private or missing), 502 (X unreachable or rate limited), 503 (no X API credentials configured, so reading posts is unavailable).

## Callers

- `pumpfun_social_x_post_impact` in `api/pump-fun-mcp.js` and `correlateXPost` in `src/social/x-post-impact.js` return `post` with `metrics` and a media summary. When the reader is unavailable the post is omitted and the price analysis continues.

## Removed

The public X video downloader (`/x-video`, `/api/x-video/*`) was removed: downloading third-party video is not something the platform offers.

## Tests

`tests/x-syndication.test.js`, `tests/x-api.test.js`, `tests/x-post-impact.test.js`.
