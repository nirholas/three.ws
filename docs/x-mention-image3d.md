# X mention bot: "3D this" on a picture

When someone posts a photo and mentions the account with "3D this", the bot turns that picture into a 3D model and replies with a rendered image and a viewer link. This is the `image3d` intent of the X mention bot. It runs in dry run only: each reply is recorded on the mention's `x_mention_events` row and nothing is posted to X until the account goes live.

## Which picture is used

1. A photo attached to the mention itself.
2. Otherwise the photo in the post the mention replies to, or quotes.

The picture is only used when its poster is the person who wrote the mention. Anyone else's picture is recorded as a skip with reason `not_own_image` and gets no reply.

## What happens to it

1. Fetch from X's photo CDN only (`pbs.twimg.com/media/...`, https, the `large` rendition). Redirects are refused. The download has a 5 MB cap (`X_MEDIA_MAX_BYTES` in `api/_lib/x-media-image.js`), a 15 second timeout, a JPEG or PNG Content-Type check and a magic-byte check. A URL on any other host is a skip with reason `image_rejected:not_cdn` and no request is made. A too-large, wrong-type or stalled picture gets a reply pointing at https://three.ws/forge.
2. Review with a vision model for ages-13+ safety and for one reconstructable subject. This fails closed: with no vision provider the bot replies with the /forge link and generates nothing. An unsafe picture gets a fixed refusal that echoes nothing from the post. Text typed after "3D this" also passes the studio prompt safety check.
3. Store the picture and run the image-to-3D lane, attributed to the system bot account and the X author (`forge_creations.x_author_id`) so the author can claim it later. Creations are unlisted.
4. Reply with the rendered PNG and `/m/<creation id>`. A job that outlives `X_MAKE_BUDGET_MS` is recorded as `pending` and `finishPendingImage3d` replies once when it completes, or with the failure reply after `X_MAKE_GIVE_UP_MS`.

## Code

- `api/_lib/x-media-image.js`: `fetchXImage`, `xMediaUrl`, `XMediaError`.
- `api/_lib/x-mention-image3d.js`: `handleImage3d`, `finishPendingImage3d`, `reviewImage`, `isOwnImage`, `composeImage3dReply`.
- `tests/x-mention-image3d.test.js`: own image, someone else's image, non-CDN URL, oversized image, moderation and the pending follow-up.
- `scripts/x-mention-image3d-dry-run.mjs`: real dry runs from real mentions that carry photos; writes `prompts/x-grok/_generated/image3d-dry-run.json`.

## Run it

    node --env-file=.env.local scripts/x-mention-image3d-dry-run.mjs --base https://three.ws

Related: [X mention bot safety rules](x-mention-bot.md).
