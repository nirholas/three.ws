# What filming the product found: 2026-09-29 to 2026-09-30

Ten authors wrote stories for the @trythreews queue by using each feature end to end against
production and filming the run ([how that works](../x-story-authoring.md)). A story only exists
when the feature passed. The features that did not pass, and the defects seen along the way, are
listed here so they get fixed rather than announced. Every item was observed against the live site
on the dates above; re-check before acting, because some may have moved.

Third-party project names are left out on purpose; the pages named below carry them.

## Features that could not be announced because they do not work

| Surface | What happens | What was expected |
|---|---|---|
| `/capture` | Video to point cloud answers `503 unconfigured`: `GCP_VIDEO2SCENE_URL` is not set on the API service and no `model-video2scene` Cloud Run service exists. `docs/capture.md` says the worker is not deployed. | The page's headline feature. |
| `/cosmos` | `POST /api/cosmos` answers `503 lane_unavailable`. The stage avatar renders in a T-pose with its head out of frame. | A world generated behind the avatar. |
| `/tty` | The command on the page, `curl three.ws/tty`, prints nothing: the load balancer answers 301 to https with an empty body. After any browser visit, `curl https://three.ws/tty` gets the HTML page from the CDN for about half an hour, because the HTML variant is cached without `Vary: Accept`. In a browser the live panel never animates: the stream is brotli-compressed and fully buffered (time to first byte 5.66 s on a 5.68 s stream). The renderer itself works. | An avatar streamed into a terminal. |
| `/stream` | The progressive panel renders layer 0 correctly and then explodes into a spike ball after layer 1, for every avatar. The summary line reports "0.5x faster to first frame" when the stream is slower. The CLI on the page fails with `ERR_MODULE_NOT_FOUND` for an undeclared dependency in the published 0.1.0. | A progressively refined avatar. |
| `/validation` | The Inspect tab fails with "React is not defined". | The validator's inspect view. |
| `/concierge` | About one ask in five comes back empty ("I could not come up with an answer just now"): measured 7 of 36. In `api/concierge.js`, when the first model rung streams no content the handler sends `done` instead of falling to the next rung. The sentence splitter also speaks "[https://three." when an answer contains a link. | A grounded answer every time. |
| `/embed-doctor` | Four of four correct embeds are reported "Broken": the tutorial's canonical snippet is served a 404 page inside the sandbox, a plain GLB snippet is failed on a benign decoder abort, and live-page mode fails on the site's own pages. The findings also order a fix "above" that is printed below. | A Healthy verdict for a working embed. |
| `/nvidia` | The fleet table does not match production: one GPU service is not ready (startup probe timing out), one lane has failed every job for three days ("task orphaned: no progress within 30 minutes"), and three listed workers are not deployed as GPU services. | An accurate fleet page. |
| `/diorama`, `/world-lines`, `/crews` | Empty in production: no public dioramas, no active quests in any region, one test crew. | Something to show. |
| `/herald` (burst) | With the 3D body, five messages sent at once are all counted as delivered in 0.2 s and only the summary bubble is ever readable. The walk companion is persistent on every page and its `announce()` resolves as soon as the line is up, so Herald's one-at-a-time delivery never waits. Fix in `herald-sdk/src/presenters/avatar.js` (hold for `dwellMs` when the companion is persistent) or in the walk SDK (resolve after the hold). | One message at a time, each readable. |

## Defects on surfaces that were announced or are otherwise fine

- **`/herald`:** the documented import `import { createHerald, pollSource } from 'https://three.ws/herald.js'` has no exports in the served file; only `window.threeHerald` works. The page says the card presenter takes over under reduced motion; it does not (only without WebGL). The playground cannot show dedupe because each send gets a fresh id. The companion introduces itself with a random guest name about 9.6 s after load; the name list includes a word that reads as an exchange name.
- **`/docs/world`:** pressing `/` opens both the Docs World search and the site-wide command palette on top of it. "Shift+Enter has the world walk you there" lays a trail but the avatar does not move (the tour, the tooltip and `docs/docs-world.md` all overstate it). The social description says 14 sections; the index has 15. The Top Down camera shows only the hub, not the ring.
- **`/drive`:** `/api/tts/edge` answers 401 before the fallback succeeds, a console error on every turn. The model reply is uncontrolled and once volunteered a third-party launchpad; re-films need their frames checked.
- **`/glance`:** the SVG card in an `<img>` shows a broken-image icon where the agent thumbnail should be (an external image cannot load inside an SVG used as an image; it needs a data URI). The card prints a raw event name ("last: load-end 3d ago"). Of 600 published agents none has "Moves today" above 0, because chats do not count as moves. At 720 px the 480 px card overflows its panel. `/api/glance/token` returns 401 on every signed-out load. `?agent=` links leave the Agent dropdown on the featured agent.
- **`/3d`:** the live badge is stuck on "CHECKING…" (i18n rewrites `#liveBadge` after `setLive` runs). `footer.foot` renders `position:absolute` over the stats cards on the first screen.
- **`/inspect`:** "Non-collapsed bounds" reports raw quantized units for meshopt models, not world units.
- **`/render-lab`:** the default model is a crypto personality likeness; one model appears twice in the chips; the sheet button leaves a doubled tooltip.
- **`/avatar-sdk`:** the hero viewer shows a bind-pose T-pose, which the operating rules say never to ship, and the playground offers a real person's likeness.
- **`/avatar-engines`:** the sticky filter bar is translucent and family headings bleed through it while scrolling.
- **`/characters`:** user cards show wallet dollar values, launchpad descriptions, a public QA test account, and T-pose thumbnails.
- **`/widgets`, `/integrations`, `/timeline`:** name third-party coins, exchanges and launchpads in chips, cards and milestones, so none can be filmed under the coin gate.
- **`/wardrobe`:** the page's intro names a stablecoin above the fold; the reel starts below it.

## Pipeline defects found and fixed during the run

- The camera's clock pause had a 50 ms window that a busy WebGL page overran ("Cannot fast-forward to the past"); the margin is now generous with retries.
- The fact checker crashed on a page whose body had not mounted; it now reads an empty page and fails the check.
- The walk companion was hidden as chrome on every page, including the one whose subject it is; a scenario can now `show` it.
- A tap-only `press` could not walk a character; a key can now be held for a filmed stretch.
- A loose control-name match clicked "Clear search" for "Search"; exact names are matched first.
- The caption bar clamps at two lines; captions over about 90 characters were cut off, and the validator now refuses them.

## Surfaces judged not to be stories

`/login`, `/register`, `/pricing`, `/sitemap`, `/features/scan` (a marketing page with a stock sample), `/companion` (marketing when signed out), `/smart-home` and its subpages (sign-in walls with no demo house), `/voice/home` (needs a microphone), `/irl` (camera and location gates by design), `/app` (the viewer with "Sign in to save").

## Added 2026-10-01

A second wave of authors covered labs, voice, restyle, agents and the marketplace. The same rule
holds: a surface that did not pass is listed here instead of being posted.

### Could not be announced

| Surface | What happens |
|---|---|
| `/pocket` | Cartridge 01 stays in a T-pose and slides when steered; the A button reports a wave as played while the character stays idle; cartridge 03 renders with its arms locked straight overhead. Walking and turning with the D-pad work. |
| `/agent-identities` | "View in 3D" spins on "Loading the rigged avatar" forever: the page loads only the decoder shim (`/model-viewer-meshopt.js`) and never the `model-viewer` library, so the element never starts (`ensureModelViewer` in `src/agent-identities.js`). |
| `/create/video` | Signed-out visitors get the sign-in page, and `GET /api/avatar/video-generate` answers `"available": false, "reason": "worker_unconfigured"`: the talking-video renderer is not deployed, while `docs/talking-avatar-video.md` shows `"available": true`. |
| `/motion-swap` | The only way in is a video upload, with no public sample and no finished job to reopen. |
| `/playground` | The default model renders in a bind-pose T-pose. |
| `/restyle` | Works, but the default sample avatar stands in a T-pose, so its reel shows one. The story is filmed and held as paused until the sample idles. The lower presets, seeded variants and Reset sit far below the 3D view, so using them scrolls the model away; "18 PBR material presets" on `/docs/restyle` is only in the meta description. |
| `/globe` | Works, and the story is filmed, but held for the owner: it shows conflict and force-posture layers over military bases and nuclear sites, and the conflict layer misclassifies (a story about US House district maps tagged as conventional military force). The 30-day request takes 4 to 16 s. |
| `/sonar` | Works and was filmed, then withdrawn: the stage avatar (`/avatars/cz.glb`, used by `src/animations-live-preview.js`) is the likeness of a figure tied to another crypto project. After a push zoom the head leaves the frame. |
| `/labs` | `categorize()` in `src/labs.js` files every page it does not recognise as x402, so Animation Gallery and Character Library are badged and filtered as x402. A filter scrolls a heading naming another coin into view, and that heading contains an em-dash. Its live card previews slow the browser so badly that a 9 second scenario took 11 minutes. |
| `/rankings` | The Creations board shows the public QA account and T-pose thumbnails; medal emoji render as empty boxes. |
| `/walk-leaderboard`, `/daily-match`, `/reputation/market` | Effectively empty (one walker, one competitor, no stakes). |
| `/search`, `/ledger`, `/showcase` | Results, decision rows and chain chips name third-party coins and chains. `/search` returns twelve generations all titled the same for one query. |
| `/hydrate`, `/bundles` | A connect-wallet wall and a sign-in wall, with nothing to show signed out. |

### Defects on surfaces that were announced

- **Voice:** Gemini voices fail synthesis with 502 or 503 ("the provider rejected this deployment's credentials") while the catalog lists them as available, so the catalog moves between 357 and 327 voices. A cached clip's status line drops its billing note because the billing header is missing on cache hits.
- **Drive:** the agent reached "Speaking" in every run on a quiet machine and timed out at 60 s twice under heavy load; worth watching, not yet a defect.
- **Spelling gate:** rejects "metalness", "GDELT" and "chokepoints"; authors worded around them.

### The X account

On 2026-10-01 the X API answered `402 credits depleted` to every read and every post, so nothing could be published until the account's API credits are topped up in the X developer console. The credits belong to the app, and the app is shared by the content queue, the changelog's X lane, the Sentiment Scout's recent search (billed per returned post, guarded only by rate limits), and users' connected-X features (scheduled posts, triggers, and a metrics fetch every six hours). The console's usage breakdown says which of them spent it.
