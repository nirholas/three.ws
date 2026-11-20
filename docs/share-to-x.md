# Share to X and Ask @grok

Every 3D model, avatar and anatomy cutaway on three.ws has two X actions in its share UI:

- **Share on X** posts the page's link with a short line about it.
- **Ask @grok about it** posts the link with one sentence about the thing and a question addressed to @grok. Grok answers in the replies, and the large image card under the post shows the actual model, avatar or machine.

This page covers where the buttons are, how the post text is built, how a click is counted, which card X unfurls, and how to check the whole path. For Teams, LinkedIn and the general link preview rules, see [sharing.md](sharing.md).

## Where the buttons are

| Page | How to reach the two actions | Code |
|---|---|---|
| Model, `/m/:id` | The **Share** button opens the share panel | `src/model-page.js`, `modelShareEntity()` in `src/model-lib.js` |
| Forge result card | **Share** on a finished generation opens the same panel | `src/shared/share.js` (`showSharePanel`) |
| Avatar, `/avatars/:id` | **Share on X** and **Ask @grok** sit in the top action bar | `src/avatar-page.js`, `pages/avatar-page.html` |
| Anatomy, `/anatomy/:id` | The **Share** button opens the share panel | `src/anatomy/page.js` (`openShare`) |

While something is still generating or has not been saved, it has no permalink to unfurl and nothing to ask about. Ask @grok (and the anatomy Share button) then stays visible and focusable but is marked `aria-disabled="true"`, with the reason as its tooltip, for example "Still generating. Ask @grok unlocks once it has a title and a permanent link." A disabled action does nothing when clicked and is not counted.

Both actions are real links (`<a href="https://x.com/intent/post?...">`), so they work from the keyboard (Tab, then Enter). A plain click opens a sized popup and falls back to a new tab if the popup is blocked. Ctrl, Cmd, Shift and middle clicks are left to the browser. Each action has a hover, active, focus-visible and disabled style and an accessible label.

On a browser that cannot start WebGL, the anatomy page shows the machine as a still isometric line drawing, with a note explaining why. Share still works there (`src/anatomy/still.js`).

## Building an X intent: `xIntentUrl`

Every X intent in the app is built by one function, `xIntentUrl()` in `src/shared/share-targets.js`:

```js
import { xIntentUrl, withShareUtm } from './shared/share-targets.js';

const href = xIntentUrl({
	text: 'How a Honda CD70 carburetor works, as an interactive 3D cutaway on three.ws',
	url: withShareUtm('https://three.ws/anatomy/dfebfc22-f9d8-4928-8216-c97d074113ec', 'grok-share'),
	via: 'trythreews',
});
// https://x.com/intent/post?text=How+a+Honda...&url=https%3A%2F%2Fthree.ws%2Fanatomy%2F...&via=trythreews
```

X does not count a post's length in plain characters. It uses the twitter-text v3 weighted length:

- Characters in the four "light" Unicode ranges (Latin, most punctuation, a few general punctuation blocks) count 1.
- Every other code point counts 2. That covers CJK, most emoji (a whole emoji sequence counts 2) and many scripts.
- Every URL counts 23, however long it is.
- The limit is 280.

A 200-character Japanese prompt is therefore over the limit, and X would refuse the post. `xIntentUrl` measures the text with `xWeightedLength()`, subtracts the budget the `url` and `via` take (`xTextBudget()`), and trims the text to fit with `fitXText()`. It cuts on a grapheme boundary, prefers a word boundary and ends with an ellipsis. **It never truncates the URL.** Those helpers are exported, and `tests/x-intent.test.js` pins them.

### The guard

`tests/x-intent.test.js` also scans every JS and HTML file under `src/`, `pages/`, `api/`, `server/`, `scripts/` and `public/`. Any line that contains `x.com/intent/` or `twitter.com/intent/` outside `share-targets.js` fails the test. To add a new X share link, import `xIntentUrl`. Don't concatenate a URL by hand.

The exceptions are code that cannot import a Vite-bundled module:

- `public/forever.js` and `public/changelog/entry/index.html` are raw publicDir copies, served byte for byte.
- `apps/hq` has its own TypeScript build.
- `infra/lambda` has its own deploy.

The two `public/` files are listed in the test with that reason. `apps/` and `infra/` are outside the scanned roots.

## The Ask @grok post

`src/shared/grok-ask.js` writes the text: a one-sentence description, a blank line, and one question that ends with `@grok`.

```
"A paladin in polished plate armour with a tabard...", a 3D model made on three.ws.

What backstory would fit a character that looks like this? @grok
```

- **Questions** come from `GROK_ASK_TEMPLATES`. Models have a set per category (vehicle, creature, scene, avatar, accessory, item, other). Avatars and anatomy have one set each. Anatomy questions name the machine ("How does a Honda CD70 carburetor actually work, step by step?"). The question is picked by a stable hash of the entity id, so the same page always asks the same question, and different pages ask different ones.
- **Fitting:** only the description is shortened to fit X's limit. The question and its closing `@grok` always survive.
- **Token-free:** the text never names a coin. Cashtags (`$XYZ`) are stripped from titles and prompts before anything is composed. That rule is pinned in `tests/grok-ask.test.js`.
- **Readiness:** `grokAskState(entity)` returns `{ ready, reason }`. It is ready only with an id and a prompt, caption or title to ask about. `reason` is the disabled tooltip.

## Attribution: UTM

The link in each post is tagged by `withShareUtm(url, campaign)`, so a visit from X is attributable in analytics:

| Action | Query string added to the page link |
|---|---|
| Share on X | `utm_source=x&utm_medium=share&utm_campaign=grok-share` |
| Ask @grok about it | `utm_source=x&utm_medium=share&utm_campaign=grok-ask` |

Existing query parameters are kept.

## Counting clicks

A click on either action sends one beacon through the existing share funnel: `src/shared/share-beacon.js` posts to `POST /api/share-funnel`, which increments an aggregate daily counter. No user, page or entity identifier is stored: just the day, a surface and a kind.

| Surface | Counted when |
|---|---|
| `x_share_model`, `x_share_avatar`, `x_share_anatomy` | Share on X is clicked on that kind of page |
| `grok_ask_model`, `grok_ask_avatar`, `grok_ask_anatomy` | Ask @grok about it is clicked on that kind of page |

The kind is always `action`. The surfaces were added by migration `api/_lib/migrations/20261120203000_share_funnel_x_surfaces.sql`.

Read the numbers with the funnel report, which prints X share and Ask @grok clicks per kind for the window:

```bash
node scripts/forge-funnel-report.mjs --days 7
```

Or query the table directly:

```sql
select surface, sum(count) as clicks
from share_funnel_daily
where kind = 'action'
  and (surface like 'x_share_%' or surface like 'grok_ask_%')
  and day >= current_date - 7
group by surface
order by surface;
```

## The card X unfurls

Each page's server-rendered head carries `twitter:card=summary_large_image` and a 1200x630 image of the entity itself, never a stock site image:

| Page | `og:image` / `twitter:image` | Rendered by |
|---|---|---|
| `/m/:id` and `/forge/share/:id` | `/api/render/glb?glbUrl=<model>&width=1200&height=630`, a render of the GLB | `server/creation-head.mjs`, `api/forge-share.js` |
| `/avatars/:id` | `/api/avatars/:id/og` | `api/avatar-detail-og.js`, which `vercel.json` serves to link-preview crawlers |
| `/anatomy/:id` | `/api/anatomy-og?id=<id>`, the machine's isometric line drawing on a branded card | `server/anatomy-head.mjs`, `api/anatomy-og.js` |

The heads cache each lookup, misses included, for five minutes. A design saved a moment ago can show the generic head until that entry expires.

An X **player** card (the model playable inside the post) is built but switched off. `api/forge-share.js` emits it only when the environment has `X_PLAYER_CARD_APPROVED=1`, which is set once X approves the player card. Until then every page uses `summary_large_image`.

## Checking

Unit tests (intent building, the guard, the Ask @grok text, the cards):

```bash
npx vitest run tests/x-intent.test.js tests/grok-ask.test.js tests/share-cards.test.js tests/model-page-share.test.js tests/anatomy-still.test.js
```

Live head and card checks against a running server. These fetch real pages and images and assert `summary_large_image` with an entity image for all three page types:

```bash
SHARE_CARDS_BASE=http://localhost:3284 npx vitest run tests/share-cards.test.js
```

Browser check of both actions on a real model, avatar and anatomy design. It replaces `window.open` before any page script runs, so nothing reaches X, and it answers the funnel beacon locally, so no production counter moves. It records each intent URL, checks the link, the UTM campaign and the `@grok` ending, confirms both beacons, and writes one screenshot per page with the share UI open, plus `results.json`:

```bash
node scripts/verify-share-to-x-browser.mjs --base http://localhost:3284 --no-webgl
```

Pass `--model`, `--avatar` or `--anatomy` with an id to check other entities, and `--out <dir>` to choose where the screenshots go (the default is the OS temp directory). `--no-webgl` runs Chromium without WebGL. On a loaded machine the software WebGL renderer can starve the compositor so badly that screenshots time out, and the share UI is plain DOM either way.
