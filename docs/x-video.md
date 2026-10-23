# X post reader and free video tool

One keyless reader for public X posts, shared by the price-impact tools and the free `/x-video` page.

## Reader: `api/_lib/x-syndication.js`

`readXPost(postUrl)` returns `{ id, url, ts, createdAt, author, text, metrics, media, source }`.

Rungs, in order. The first that answers wins; a failing rung falls through.

1. **X syndication** (`cdn.syndication.twimg.com`): no auth, widest mp4 ladder. Gives likes and replies.
2. **fxtwitter** (`api.fxtwitter.com`): independent third party. Adds reposts, quotes, views and bookmarks.
3. **Guest-token GraphQL** (`api.x.com`): runs only when `X_BEARER_TOKEN` is set. Full metrics.

Metrics a rung does not report are `null`, never guessed.

Errors: `XPostError` with `status` 400 (not a post URL), 404 `PostUnavailableError` (deleted, private or missing), 502 (no rung reachable).

Video extraction approach adapted from `download-x-twitter-videos` (Apache-2.0).

## Callers

- `pumpfun_social_x_post_impact` in `api/pump-fun-mcp.js` and `correlateXPost` in `src/social/x-post-impact.js` return `post` with `metrics` and a media summary. In a browser the second goes through `POST /api/x-video/extract`, since X blocks cross-origin page reads.

## Endpoints

`POST /api/x-video/extract` body `{ "url": "https://x.com/<handle>/status/<id>" }`

```json
{ "post": { "...": "..." }, "videos": [{ "url": "...", "quality": "720p", "width": 1280, "height": 720, "bitrate": 2176000, "contentType": "video/mp4" }], "thumbnail": "...", "duration_ms": 12000, "source": "syndication" }
```

Errors: `invalid_url` 400, `post_unavailable` 404, `no_video` 404, `upstream_unreachable` 502, 429 when rate limited (20 per minute per IP).

`GET /api/x-video/download?url=<media url>&handle=<h>&id=<postId>` streams the file as an attachment. Only https `video.twimg.com` and `pbs.twimg.com` are accepted, with no credentials or ports, and redirects are never followed.

## Tests

`tests/x-syndication.test.js`, `tests/x-post-impact.test.js`, `tests/api/x-video.test.js`.
