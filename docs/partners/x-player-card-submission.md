# X player card submission

Checked 2026-10-23 against production (build `45c768d07`, 2026-10-13) and the repo, and re-checked
2026-11-04 against production build `0a913e8a7`: the framing blocker below is gone.
Submitting to X is external, so the owner submits or approves.

## Submission details

| Item | Value |
|---|---|
| Card type | `player` |
| Page carrying the card | `https://three.ws/forge/share/:id` (served by `api/forge-share.js`) |
| Player URL pattern | `https://three.ws/forge/embed?src=<glb>&poster=<image>&title=<prompt>` |
| Player size | 480 x 480 (`twitter:player:width`, `twitter:player:height`) |
| Site and creator | `@trythreews` |
| Fallback for crawlers without approval | `summary_large_image` tags on the same page; an unfinished creation never gets a player tag |

X's player-card docs page (developer.x.com) answered HTTP 402 to an automated fetch, so the
requirement list below is the long-standing documented set (HTTPS player URL, fixed size,
poster image, no Flash, content that does not autoplay with sound) and must be re-read in the
developer console before submitting.

## Requirement checklist

| Requirement | Status | Evidence |
|---|---|---|
| `twitter:card` is `player` for finished creations | Met in code | `api/forge-share.js` (the `twitter:card` meta, line 137), tests in `tests/api/forge-pipeline-endpoints.test.js` |
| `twitter:player` is an HTTPS URL | Met in code | `embedUrl` is built from the request origin |
| `twitter:player:width` and `height` set | Met in code | 480 and 480 |
| `twitter:image` poster present | Met in code | preview image or render poster or `/api/forge-og` |
| Player page allows framing by X | Met in production as of 2026-11-04 | see below |
| Player does not autoplay sound | Met | the viewer has no audio track |
| Public, unauthenticated page | Met | share pages for `public` and `unlisted` creations |

## Former blocking finding (resolved 2026-11-04)

On 2026-10-23 the finding below blocked submission. Production build `0a913e8a7` now answers
`frame-ancestors *` on `/forge/embed`, so only the owner's submission remains. What was found:

Local `server/index.mjs` serves `/forge/embed` with `content-security-policy: frame-ancestors *`
(the route in `vercel.json`, pinned by `tests/share-panel.test.js`). Production at build
`45c768d07` answers the same URL with `frame-ancestors 'self' https://ibm.com https://*.ibm.com
https://*.seismic.com`, which is the site-wide default, so X cannot frame the player and the card
would not play. Reproduce:

    curl -s -D - -o /dev/null "https://three.ws/forge/embed?src=https%3A%2F%2Fthree.ws%2Fx.glb" | grep -i frame-ancestors

The route was in the deployed route table, so the cause was in how the production container
applied the collected route headers to this page, not in the route itself. A later deploy cleared
it: the command above printed `frame-ancestors *` on 2026-11-04.

## Steps for the owner

1. Rerun the curl above and confirm it still prints `frame-ancestors *` (it did on 2026-11-04).
2. Pick a finished public creation id and run X's card validator or request form with its
   `https://three.ws/forge/share/<id>` URL and the details above, contact `@trythreews`.
3. After approval, post a share link and send a screenshot to retire order 931.
