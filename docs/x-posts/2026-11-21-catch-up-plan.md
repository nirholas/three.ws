# @trythreews catch-up plan (written 2026-11-20)

@trythreews has gone quiet because `X_CONTENT_AUTO_PUBLISH` is still unset (see
[the relaunch checklist](../x-content-relaunch-checklist.md)). Nothing in the queue goes out on its
own. These five posts are ordered for the next three days. Every draft passes the pipeline's own
`copyProblems` and `constructionProblems` lint
([quality.js](../../api/_lib/x-content/quality.js), [voice.js](../../api/_lib/x-content/voice.js)),
and every claim was checked against the live site or the repo on 2026-11-20.

## Schedule

| When (UTC) | Post | Status | Media |
|---|---|---|---|
| Fri 21 Nov, 15:20 | Grok for Startups membership (thread, below) | New draft | Fresh reel of `/grok`, filmed after the deploy |
| Fri 21 Nov, 17:00 | `give-your-ai-a-body` | Approved in the queue, reel ready | `public/x-media/give-your-ai-a-body/reel.mp4` |
| Sat 22 Nov, 15:20 | Omniverse Kit extension (thread, below) | New draft | `integrations/nvidia/omniverse-kit-extension/media/panel-live-imported.png` |
| Sat 22 Nov, 17:00 | `render-lab-sheet` | Approved in the queue, reel ready | `public/x-media/render-lab-sheet/reel.mp4` |
| Sun 23 Nov, 15:20 | Your models stay yours (single post, below) | New draft | Live capture of a model page with its manage and report menu open |

The two approved queue items are still accurate after today's account gate. `give-your-ai-a-body`
makes no no-account claim. `render-lab-sheet` says the render API needs no account or key, and
`GET /api/avatar/render` still answers 200 to an anonymous call. Both reels expire 14 days after
2026-11-16, so post them before 30 Nov or run `advance --refresh` first.

## Before the Grok post

1. Production is on `1780fe016`, which is older than `b51dcb899`, the commit that adds Grok for
   Startups to `/partners`. Right now `three.ws/partners` does not mention Grok. Deploy first
   (`npm run deploy:gcp:full`), or the post should link only to `/grok`, which is already live.
2. Do not publish the credit amount or the team ID ([partners.md](../partners.md)).
3. Do not reuse the old `grok-studio` reel or copy (see below).

## 1. Grok for Startups (thread, tag @xai)

> three.ws is now a member of xAI's Grok for Startups program, admitted today.
>
> Grok was already one of the brains a three.ws agent can think on, and the Grok connector already gives Grok Bot a 3D studio. Paste one URL into Grok as a custom MCP server and a sentence becomes a textured GLB, a rigged avatar, or a talking 3D body, each with a viewer link and an AR link. @xai

> The membership funds the Grok lane on our side, so agents that think on Grok cost us less to run. If you bring your own xAI key, your key still goes first.
>
> Grok Bot runs on its own cloud machine, so a cold GPU never hangs a task. Every call answers within 40 seconds with either the model or a job id that Grok collects later.

> Making a model needs a free three.ws account. Sign in once with OAuth or a connector API key. Setup takes one URL and is at three.ws/grok

Sources: `data/partner-programs.json` (`xai-grok-for-startups`, status `member`, admitted
2026-11-20), [grok.md](../grok.md) (auth, the 40-second answer), [llm-lanes.md](../ops/llm-lanes.md)
(your own key leads the lane).

## 2. Omniverse Kit extension (thread, tag @NVIDIAOmniverse)

> 78.5 seconds. That is how long an image-to-3D job took on an NVIDIA L4, from pressing Generate inside USD Composer to the textured model referenced into the open USD stage, upright and at real-world scale.
>
> The threews.forge extension adds a Forge panel to any Kit 110 app. Type a prompt or pick a reference image and the model lands at the world origin, on the selected prim, or in front of the camera. A My models browser pulls in anything already saved to your three.ws account. @NVIDIAOmniverse

> All 62 extension tests pass on a live L4 with zero errors in kit.log. Install steps and the full measurement table are at three.ws/docs/omniverse-extension
>
> three.ws is an NVIDIA Inception member.

Sources: [omniverse-extension.md](../omniverse-extension.md) (measurement table: 78.5 s, 62 tests,
0 errors). Wording avoids every phrase in the `forbidden` list of
`data/x-content/partners/nvidia.json`.

## 3. Your models stay yours (single post)

> Every 3D model you make on three.ws now starts unlisted. It lands in your account and stays off the public gallery until you press publish.
>
> Before anything is listed, every source photo behind it is safety-checked, not only the first one. Any model page also has a report button, and the owner can manage the model from that same page.
>
> The free text-to-3D lane is still free. It now asks you to sign in with a free account first, so everything you make is saved to you and has an owner. Browsing and sharing models still need no account.

Sources: the 2026-11-20 entries in `data/changelog.json` ("New 3D models start unlisted until you
publish them", "Public models are safety-checked before they are listed", "Manage or report any 3D
model from its page", "Making or uploading a 3D model now needs a free account").

## Stale copy in the queue

Two Grok items in `data/x-content/queue.json` still claim the studio needs no account. That stopped
being true on 2026-11-20. Neither can go out as written:

- `grok-studio` (review): "with no account and no key"
- `grok-bot-mention-bot` (draft): "The free studio needs no account and no key"

Post 1 above replaces them. Before either one is used again, rewrite that sentence and update its
claims evidence.
