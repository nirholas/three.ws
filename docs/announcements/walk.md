# Announcement pack: Walk, the one-tag walking avatar

**Surface:** [`/walk`](https://three.ws/walk) · **Ledger key:** `/walk` · **Stage:** drafted
· **Shipped:** 2026-06-21 · **Announced externally:** never as a surface post

Sitemap priority 0.8. The `/walk` landing and its one-tag embed have not had their own announcement
pack. Written against [the announcement voice](../announce-voice.md).

---

## The claim, and where it is checked

> Paste one iframe tag on any site and a rigged 3D avatar walks there, in one of six built-in
> worlds chosen with a query parameter. There is no SDK to install and no build step.

Verified by reading the code and the live page on 2026-09-17 (rig fallback re-checked 2026-11-06):

| Part of the claim | Where it is real |
|---|---|
| One iframe tag | The page's own snippet is a single `<iframe src="https://three.ws/walk-embed?env=void&autoplay=true">` ([`pages/walk-landing.html`](../../pages/walk-landing.html)); the live page reads "One tag. Any site." and "Paste the iframe". |
| On any site | `vercel.json` serves `/walk-embed` with `content-security-policy: frame-ancestors *` and `cross-origin-resource-policy: cross-origin`; `curl -sI https://three.ws/walk-embed` returned that header on 2026-09-17. |
| A rigged 3D avatar that walks | [`src/walk-embed.js`](../../src/walk-embed.js) loads a humanoid GLB (`/avatars/default.glb`, or `?avatar=`/`?agent=`) and drives it with real locomotion; any humanoid rig is retargeted through `src/glb-canonicalize.js` and `src/animation-retarget.js`, and a skinned rig the clips cannot drive is swapped for the default body (the embed emits `walk:error` with `avatar_not_animatable` and `fallback: true`) rather than sliding in a bind pose. |
| Six live worlds | `ENVIRONMENTS` in [`src/walk-embed.js`](../../src/walk-embed.js) has exactly six entries: `studio`, `void`, `beach`, `sunset`, `night`, `grid`. The live page: "Six built-in environments" and "These are live, not videos." |
| Picked by a query param | `const ENV_PARAM = (params.get('env') || 'studio')` in [`src/walk-embed.js`](../../src/walk-embed.js); the live page: "set the avatar and world with query params". |
| No SDK, no build step | Literal on the live page ("No SDK, no build step."), and true of the snippet: a plain iframe with no script include. |

Related docs: [docs/walk-leaderboard.md](../walk-leaderboard.md) (the distance board the page
teases), and the `walk-sdk/` package README for the scripted companion.

## Media

Captured from the live route with `scripts/capture-doc-media.mjs`. Provenance (route, commit,
time, sha256) goes in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json)
when the recipe is merged into [`data/announce-media.json`](../../data/announce-media.json) and
`npm run announce:media` runs.

| Shot | File | Notes |
|---|---|---|
| `walk-hero` | `/announce/img/walk-hero.webp` | 1600x900 wide viewport, signed out (the page is public). The hero headline beside the live `/walk-embed` iframe with the avatar walking in it. The roaming walk companion is framed out by the capture script's standard site-chrome list, because a second avatar in the corner would confuse which one is the embed. |

**Alt text, required on the post:**

> The three.ws Walk page: a live 3D avatar walking inside a one-tag iframe embed beside the
> headline Your avatar walks anywhere on the web.

No token tickers or market data appear on this page.

## The post

Pattern: number lead. **147 weighted characters** (per `post-tweet.mjs --dry-run`), inside the
100-179 band. No tags: nothing about an iframe embed runs on a partner account we could defend.

Postable file: [`walk.post.txt`](./walk.post.txt).

```text
One iframe tag puts a rigged 3D avatar on any site, walking in one of six live worlds picked by a query param. No SDK, no build step: three.ws/walk
```

Ship it with `walk-hero` attached and the alt text above.

### Why it is written that way

"Your avatar walks anywhere on the web" is the page headline, and a close variant of it is already
one of the quotes the page cites from @trythreews (`data/walk-social.json`), so the post does not
repeat it. The developer's question is cost of adoption, and the
honest answer is small enough to be the hook: one tag, one query parameter, nothing to install. The
count of worlds is a number the code pins at six, so it will not drift.

The Chrome extension was cut. The landing pitches it, but its install path points at a docs page
rather than a store listing, and a post that sends people to install something should link the
install. The leaderboard was cut too; it is a second surface, and one post links one surface.

## Telegram variant

```text
Walk is at three.ws/walk: a 3D avatar that walks on any website from one iframe tag.

<iframe src="https://three.ws/walk-embed?env=void&autoplay=true" style="border:0;background:transparent"></iframe>

- Six built-in worlds (studio, void, beach, sunset, night, grid), picked with ?env=.
- Bring your own avatar with ?avatar= or ?agent=. Any humanoid rig is retargeted, so it walks
  rather than arriving in a T-pose, and a skeleton the walk clips cannot drive is replaced by the default body.
- WASD or a touch joystick, tap the ground to walk there, and a postMessage API so your page can
  steer it.

No SDK, no build step. Paste it and it runs.

three.ws/walk
```

## Changelog

**No new entry.** `/walk` shipped on 2026-06-21 and its `data/pages.json` entry already fed the
changelog. This pack announces an existing surface and ships nothing new.

## Notes

- **Why /walk is in this batch.** It was the second fallback. `/fits` was skipped as thin (5 settled
  sales totalling $2.50, the newest 60 days old, 2 fits tracked), `/labor-market` as empty (0 open
  bounties, 0 settled jobs, `escrow_configured: false` on the live feed), and `/oracle` because its
  live feed renders third-party launch tickers.
- **Queue item:** none yet. `walk` is not in `data/x-content/queue.json`; when it is added, use lane
  `developer` and pattern `number`, with a `notBefore` set by the owner, and schedule it with another
  lane in between since the neighbouring queue items are also `developer`.

## Posting

Owner-gated, every time. Nothing in this pipeline posts.

```bash
node scripts/post-tweet.mjs --file docs/announcements/walk.post.txt --dry-run
```
