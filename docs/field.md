# The Field

`/` is the Field: one zoomable map of the whole platform, drawn from live data.
At the centre is the core, every public agent placed as a star on a golden-angle
spiral (newest in the middle). Around it sit the districts, one per product
surface. Wallet moves from Pulse fly across the map as comets and land in the
district they belong to. Nothing on the map is decorative: every number, face
and trail comes from a real endpoint, and when a feed is down its district says
so and offers a retry.

The windowed desktop and the 3D campus are still one click away:
`/?view=desktop` and `/?world=1` (see [desktop.md](desktop.md)). The previous
homepage stays at `/classic`.

## Moving around

| Input | What it does |
| --- | --- |
| Drag, flick | Pan, with inertia |
| Wheel, pinch, `+` / `-` | Zoom about the cursor or the pinch centre |
| Double click | Zoom in on that spot |
| Click a district tag | Fly to the district and read its live card |
| Click an agent star | Open that agent's page in place |
| `0`, `Home`, `Esc` | Fly back to the whole map |
| Arrows | Pan |
| `/` or start typing | Search places, agents and every page in the site nav |
| `Enter` on a focused district | Open it |

Camera moves follow the van Wijk and Nuij smooth zoom path: a long hop pulls
out, travels and comes back in, so you never lose your place. Reduced motion
turns every flight into a cut.

## Semantic zoom

From afar each district is a tag holding one live readout (the newest avatar,
the $THREE price, how long since the last wallet move). Zoom past
`NEAR_K` and the tags open into cards with real content:

| District | Card | Source |
| --- | --- | --- |
| Create | Ways to make an agent | static routes |
| Forge | Prompt box that opens `/forge?prompt=` | user input |
| Gallery | Newest avatar faces, each linking to `/avatars/<slug>` | `GET /api/avatars/public` |
| Launchpad | Coins agents launched through three.ws | `GET /api/pump/launches` |
| Trenches | $THREE price, 24h change, market cap, volume, holders, contract address with copy | `GET /api/three-token/stats` |
| Pulse | The four latest agent wallet moves, linked to the explorer | `GET /api/pulse` |
| Marketplace | Skills the newest agents carry most, linking to `/marketplace?q=` | `GET /api/agents/public` |
| Chat | The most talked-to agents | `GET /api/agents/public` |
| Agent Studio | Author or edit an agent | static routes |
| Console | Your account, or sign in | `GET /api/auth/me` |

Zoomed into the core, stars become avatar thumbnails; hover shows the agent's
name and description.

## Diving in

Opening a district, agent or search result loads the real page in a full-screen
surface over the map (a same-origin iframe named `tws-os:<id>`, which tells
`public/nav.js` to drop the site header). The URL becomes `/?go=<path>`, so the
surface survives a reload and can be shared; Back, the `Field` button and `Esc`
inside the page all return to the map. "Open in new tab" leaves the Field.

Deep links:

- `/?app=<district id>` flies straight to a district and opens it.
- `/?go=/some/path` opens any same-origin page in a surface. Cross-origin and
  protocol-relative values are ignored.

## Live updates

- Pulse is polled every 12 seconds with `?since=<head_cursor>`, so only new
  events cross the wire. Each new event fires a comet into its district.
- The $THREE quote refreshes every 60 seconds.
- Agents stream in page by page (`sort=newest`, `before=<cursor>`, 48 per page,
  up to 384) and fade into the core as each page lands.

## Phones

Portrait screens use a tall ring with districts spaced evenly by height and
alternating sides, and the core draws the newest 192 agents so the ring can stay
narrow enough for every tag to be readable. The agent count moves into the
search bar's placeholder. `tests/field-logic.test.js` checks at several phone
and desktop sizes that no two tags overlap at the home view.

## Code

[src/field/](../src/field/README.md): `logic.js` (pure layout, camera, search
and formatting, unit tested), `data.js` (the feeds), `field.js` (DOM, canvas,
input, surfaces), `field.css`, and `entry.js` (picks the Field or the legacy
desktop for `pages/desktop.html`).
