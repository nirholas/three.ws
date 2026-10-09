# X mention bot: "make me an avatar"

When someone mentions the account with "make me an avatar", the bot turns their own X profile picture into a rigged 3D avatar and replies with a rendered image, the creation link and a link that opens the avatar in the pose studio. This is the `avatar` intent of the X mention bot. It runs in dry run only: each reply is recorded on the mention's `x_mention_events` row and nothing is posted to X until the account goes live.

## Whose picture

Only the author of the mention. The picture comes from the mention's own author object (the user expansion the reader attaches to every post), never from the text. A mention that names another account ("make me an avatar using @someone profile picture") parses to the same intent with no handle in its arguments, so there is no path by which another account's picture can be fetched. The handler also requires the author object to be the person who asked, and records `not_own_image` as a skip otherwise.

## What happens to it

1. A default profile picture (X's grey placeholder) gets a reply that links to https://three.ws/create and is recorded with reason `default_avatar`. Nothing is generated.
2. The `_normal` (48 px) URL is upgraded to the `_400x400` file and fetched from X's photo CDN only (`pbs.twimg.com/profile_images/...`, https, redirects refused, 5 MB cap, 15 second timeout, JPEG or PNG check and magic-byte check). Any other host is a skip with reason `image_rejected:not_cdn` and no request is made.
3. A vision model reviews it for ages-13+ safety and for showing a person, character or creature. This fails closed: with no vision provider the bot replies with the /create link and generates nothing (`review_unavailable`). An unsafe picture gets a fixed refusal that echoes nothing.
4. The studio's rigged-avatar lane runs: image to 3D at the avatar tier, then auto-rig, the same two stages as the `forge_avatar` MCP tool. The creation is attributed to the system bot account and the X author (`forge_creations.x_author_id`) and is unlisted.
5. The reply carries the render of the rigged model as media, `/m/<creation id>` and `/pose?src=<rigged glb>`. If the rig fails, the unrigged mesh is returned (reason `avatar_done_unrigged:*`).
6. A job that outlives `X_MAKE_BUDGET_MS` is recorded as `pending` with its stage (`mesh` or `rig`). Every cron tick, `finishPendingAvatars` probes it once: a finished mesh starts its rig, a finished rig replies, and a failed or overdue job (`X_MAKE_GIVE_UP_MS`) gets the mesh if one exists or the failure reply.

## Code

- `api/_lib/x-mention-avatar.js`: `handleAvatar`, `finishPendingAvatars`, `reviewProfileImage`, `composeAvatarReply`, `isDefaultProfileImage`, `poseLink`.
- `api/_lib/x-media-image.js`: `xProfileImageUrl`, and `fetchXImage(url, { profile: true })`.
- `api/_lib/x-mention-poll.js`: dispatches `avatar` mentions and runs the follow-up each tick.
- `tests/x-mention-avatar.test.js`: own image, named-other-account cases, default image, moderation, CDN rules, pending follow-up.
- `scripts/x-mention-avatar-dry-run.mjs`: real dry runs from the real profile pictures of recent mentions; writes `prompts/x-grok/_generated/avatar-dry-run.json`.

## Run it

    node --env-file=.env.local scripts/x-mention-avatar-dry-run.mjs --base https://three.ws

Related: [X mention bot safety rules](x-mention-bot.md), [photo to 3D](x-mention-image3d.md).
