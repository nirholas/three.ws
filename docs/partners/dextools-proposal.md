# DEXTools x three.ws: a partnership proposal

*Drafted 2026-09-20. A point-in-time pitch, not a status report. Every prize figure below is linked to the DEXTools receipt it was read from; the holdings figure is what DEXTools stated in its own weekly announcement.*

**TL;DR**
The integration usually announced as a partnership, DEXTools charts live inside a partner product, is already shipped on three.ws and has been for months. What is not shipped anywhere is the other direction. three.ws renders any market as a live 3D scene, and as of today that scene is embeddable with one iframe keyed by the **pair address**, which is the identifier a DEXTools pair page already has in its URL. That is a visual layer no other chart terminal can put next to a chart, built on a relationship that already has public receipts on both sides.

---

## What already exists between us

**DEXTools has bought our token, three times, on its own initiative.** $THREE won DEXTools Social Boost twice on the daily board and once on the weekly, and DEXTools executed a buyback each time, $11,382 across the three wins:

| Win | Date | Buyback | Receipt |
|---|---|---|---|
| Weekly | 2026-06-08 | $5,543 | [DEXTools' own announcement](https://x.com/DEXToolsApp/status/2064037499060555807) |
| Daily | 2026-06-06 | $3,649 | [pair page, daily board](https://www.dextools.io/app/solana/pair-explorer/CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa?social-boost=daily-2026-06-06) |
| Daily | 2026-06-04 | $2,190 | [pair page, daily board](https://www.dextools.io/app/solana/pair-explorer/CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa?social-boost=daily-2026-06-04) |

In the weekly announcement DEXTools reported holding 2,470,000 $THREE afterwards. The $THREE market DEXTools tracks is [`CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa`](https://www.dextools.io/app/solana/pair-explorer/CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa), the three / SOL pool.

**We already ship your charts.** Every coin surface on three.ws carries a chart-source switcher, and DEXTools is one of the providers in it, through the published `/widget-chart/` route. On the [$THREE token page](https://three.ws/three) the DEXTools widget is not one option among several, it is the chart, with the pair page linked from the card header.

So the Flutch-shaped announcement (real-time DEXTools charts, native in a partner surface) is a thing we could co-announce today with zero new engineering. It is also the less interesting half.

---

## The half nobody has done

A pair-explorer page is a chart, a trade panel, and a table. Every terminal has the same three things, and they compete on data quality and speed, which is a hard place to differentiate.

three.ws renders a market as a **live 3D scene**: the token's logo on a spinning medallion, its top holders as a galaxy sized by balance, a graduation ring tracking bonding-curve progress, and real swaps arriving on a tape as they land. It is the kind of panel people screenshot.

As of this proposal it is embeddable anywhere with one tag, and, critically, it takes the identifier your page already holds:

```html
<iframe src="https://three.ws/coin3d?pair=CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa&embed=1"
        width="420" height="560" style="border:0" loading="lazy"
        title="three / SOL in 3D"></iframe>
```

That is the entire integration on your side. No key, no account, no SDK, no build step, no data contract to agree. The pair address in that URL is the same string that is already in your own pair-explorer URL.

**Why `pair` and not a mint.** You key markets by pool account; we key tokens by mint. Asking a partner to resolve one to the other before they can embed anything is a real cost, and it is a lookup we already do in the other direction, so we made the embed accept both. The resolver is public on its own if you ever want it separately: [`GET /api/coin/pair`](https://three.ws/api/coin/pair?address=CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa). Full integration notes: [Token in 3D, as an embed](https://three.ws/docs/coin3d-embed).

It degrades honestly, which matters for a surface at your traffic: where WebGL is unavailable the canvas is dropped and the panel keeps working as a data view, and a market no source has indexed says so inside the frame instead of sitting on a dead box.

---

## Four pillars, cheapest to prove first

**1. The 3D panel on pair-explorer pages. Small.**
One iframe, gated to Solana pairs to start, behind whatever flag or tab you like. You get a panel no competing terminal has; we get distribution to the audience that most wants it. Nothing about your data pipeline changes.

**2. The co-announcement you have already earned. Small.**
DEXTools charts are native in three.ws and have been for months. That post exists whenever you want it, and it is stronger with pillar 1 landing beside it: charts flowing one way, 3D flowing the other, in the same week.

**3. Every coin launched through three.ws arrives with its DEXTools pair. Small to medium.**
three.ws runs a launchpad. New coins reach a pair page in their first minutes, which is exactly the window our fallback index covers and the primary one does not. We already link launches to their DEXTools pair; making that link part of the launch flow itself puts your pair page in front of every launch's first holders by default.

**4. Social Boost, closing the loop. Medium.**
Social Boost ranks by visits to a pair page, and we already send visitors to ours from inside our own product with the mechanism explained in plain language. Generalising that into an embeddable "boost your pair" component any project on three.ws can mount points a lot of launched-coin traffic at DEXTools pair pages, which is the metric Social Boost is built to reward.

---

## Sequencing

- **Weeks 1 to 2:** pillar 1 behind a flag on a small set of Solana pairs, and pillar 2 drafted in parallel. Both are ready now on our side.
- **Weeks 3 to 6:** pillar 1 widened on whatever the first numbers justify, pillar 3 wired into the launch flow.
- **Weeks 7 onward:** pillar 4, once pillar 3 is producing the traffic it depends on.

Each pillar ships and announces on its own. None of them blocks on the next.

---

## What we are asking for

1. A front-end contact to look at the embed and say what size, theme and placement you would actually want. We will match it; the widget is ours to change.
2. A decision on pillar 1 as a flagged experiment, not a full rollout. One set of pairs is enough to know.
3. A co-announcement slot for the week 1 to 2 beat.

## What we are not asking for

No listing fee, no promotion, no endorsement, no change to how DEXTools ranks or scores anything, and no data feed. The embed is free and stays free. If the panel does not earn its space on your page, turn it off and the charts keep flowing the other way regardless.

---

*three.ws is the AI-agent layer for the open web: 3D agents with on-chain identity, pay-per-call payments, and a Solana-native token economy. Partnership contact: partners@three.ws.*
