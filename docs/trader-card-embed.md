# The trader card: put a live three.ws trader on your own page

A leader's audience is already somewhere else: a stream overlay, a link in bio,
a blog post, a Discord embed, a personal site. `<trader-card>` is the piece of
three.ws that goes to them. One script tag renders a trader's live, on-chain
record on any page, and anyone reading it can fork a coin into their own wallet
or [ghost-copy](ghost-copy.md) the trader without leaving.

Element: [public/trader-card/element.js](../public/trader-card/element.js) `→ /trader-card/element.js`
Endpoint: `GET /api/sniper/trader-card` ([api/sniper/trader-card.js](../api/sniper/trader-card.js))
Model: [api/_lib/trader-card.js](../api/_lib/trader-card.js) ·
snippet builder [src/shared/trader-embed.js](../src/shared/trader-embed.js) ·
tests [tests/trader-card.test.js](../tests/trader-card.test.js)

## Install

Grab the snippet from the trader's own profile: open `/trader/<agent id>` and
click **Embed this trader**. It carries your referral code when you have one, and
the panel renders a live preview of exactly what you are about to paste.

Or write it yourself:

```html
<script type="module" src="https://three.ws/trader-card/element.js"></script>
<trader-card agent="6287faf3-d41b-43cb-97bb-d305c1ac6e45"></trader-card>
```

That is the whole install. No build step, no bundler, no key, no account. The
element is dependency-free and renders into a shadow root, so it cannot inherit
broken styling from the page around it and cannot leak its own styling out.

## Attributes

| Attribute | Values | Default | What it does |
| --- | --- | --- | --- |
| `agent` | agent uuid | required | Which trader to show. |
| `window` | `24h`, `7d`, `30d`, `all` | `30d` | The period the record is measured over. |
| `size` | `full`, `compact` | `full` | `compact` drops the trade rows and keeps the headline record. Good for a sidebar or an overlay. |
| `theme` | `auto`, `light`, `dark` | `auto` | `auto` follows your reader's own appearance setting. |
| `ref` | 1 to 32 of `A-Z a-z 0-9 _ -` | none | A referral code, carried into every link the card renders. |
| `refresh` | seconds, `0` to disable | `120` | How often the card re-reads the record. |
| `origin` | an origin | `https://three.ws` | Point the card at a different three.ws deployment. |

```html
<trader-card agent="…" window="7d" size="compact" theme="dark" ref="yourcode"></trader-card>
```

## What it shows

- Who the trader is, whether the record is **verified**, how many people are
  copying them, and when they last traded.
- Realized profit or loss over the window, in SOL and in dollars.
- Win rate, settled round-trips, and the composite trader score.
- What they are holding right now, and their last few closed round-trips with the
  result and why the position was exited.
- A **Fork** link on every coin listed, which opens the real pump.fun trade panel
  for that mint on three.ws, and a **Ghost-copy** link that replays the trader's
  record against a budget with no money at risk.

Every number comes from `computeTraderMetrics`, the same truth layer the
[leaderboard](trading-surfaces.md) and the trader profile read, so a card
embedded on another site cannot show a record three.ws itself would dispute. A
number that was never measured renders as `n/a`, never as a zero.

## What it does not do

The card holds no funds, asks for no key, stores nothing in the reader's browser,
and signs nothing. Every action on it is a link back to three.ws, where the
visitor's own wallet does the signing behind the same safety firewall as every
other trade surface. Losses render exactly like wins: a card whose trader is down
says so, in red, at the top.

## Behaviour worth knowing

- **It stops working when nobody is looking.** Polling pauses when the tab is
  hidden or the card scrolls out of view. A widget that drains a laptop battery
  gets deleted from the page it was put on.
- **A blip never blanks a working card.** If a refresh fails, the last good card
  stays on screen with a small `offline` marker. Only a card that has never
  loaded shows the error state, and that state carries a retry.
- **A wrong id is answered as a wrong id.** A malformed agent id says so and
  offers no retry, because retrying cannot fix it. A trader that is not public
  answers `404` and the card says that instead of sitting on a spinner.

## Events

The element dispatches two bubbling events, so a host page can react:

```js
document.addEventListener('tradercard:load', (e) => console.log(e.detail.stats));
document.addEventListener('tradercard:error', (e) => console.warn(e.detail));
```

## The endpoint

```
GET /api/sniper/trader-card?agent=<uuid>&network=mainnet&window=30d&ref=<code>
```

Public, CORS open (an embed is cross-origin by definition), IP rate-limited, and
cached for two minutes at the edge. It is the compact projection of
`/api/sniper/trader`: a well-traded agent's full profile payload is a quarter of
a megabyte of history, and no widget on someone else's page should pay for that.
This one stays a couple of kilobytes however long the trader has been running,
and every link in it is absolute, because a relative link on a stranger's domain
points at their site rather than ours.

```bash
curl -s 'https://three.ws/api/sniper/trader-card?agent=<uuid>&window=7d'
```

A bad parameter is answered as a caller mistake (`400` with `invalid_agent`,
`invalid_network`, `invalid_window` or `invalid_ref`); an unknown or private
trader is a `404`.

## Related

- [Fork a trade](fork-trade.md): what the card's Fork links open
- [Ghost-copy](ghost-copy.md): what the card's primary action opens
- [Rivalries](rivalries.md): what changed on the board this trader is on
- [The trading surfaces](trading-surfaces.md): where these records come from
