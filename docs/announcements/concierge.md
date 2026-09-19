# Announcement pack: Concierge: a talking 3D avatar for any site

**Surface:** [`/concierge`](https://three.ws/concierge) · **Stage:** drafted · **Slot:** 2026-10-03 · **Announced externally:** never

Ranked 59 of 322 never-announced surfaces by `npm run announce:rank` (score 63). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/concierge.json`](../../data/announce-plan/briefs/concierge.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `concierge` |
| Publish slot | 2026-10-03. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | community / walkthrough |
| Audience | People who use three.ws and hold $THREE |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/concierge |
| Tracked links | Telegram `https://three.ws/concierge?utm_source=telegram&utm_medium=community&utm_campaign=announce-concierge&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /concierge and use it |
| Media | `concierge-hero`, still frame |
| KPI | route sessions that reach the second step of the flow |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (16)**: sitemap priority 0.80, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **novelty (20)**: on the coverage audit's hand-picked shortlist of strongest candidates
- **depth (13)**: documented in the tree, so there is enough to write a mechanism about and link proof for

The coverage audit's note on it: The AI concierge and assistant widgets: the embeddable business story beyond avatars.

It shipped on 2026-07-18 and has never been posted about.

The changelog has 3 entries about it, the most recent from 2026-08-17: "The Concierge page stops cutting itself off on a phone, and its install tabs work from the keyboard".

## The claim, and where it is checked

> Add the tag and your site gets a concierge: a rigged 3D avatar that reads the live page and lipsyncs answers. Edit your pricing and the next reply knows. https://three.ws/concierge

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| a rigged 3D avatar that reads the live page and lipsyncs answers | `docs/concierge.md` contains "Concierge is the three.ws support-chat widget: a floating launcher that opens a chat panel"; `docs/concierge.md` contains "Answers stream in live, are grounded in the page the widget sits on, and speak aloud with " |
| Edit your pricing and the next reply knows. | `docs/concierge.md` contains "Because the page itself is the knowledge source, the concierge is never stale: edit your p" |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `concierge-hero` | `/announce/img/concierge-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> The three.ws Concierge page rendered on a laptop, with a chat panel open in the corner showing a rigged 3D avatar mid-reply next to the install snippet for the one-tag embed.

## The post

Pattern: walkthrough. **177 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`concierge.post.txt`](./concierge.post.txt), which is the byte-for-byte source the queue item points at.

```text
Add the tag and your site gets a concierge: a rigged 3D avatar that reads the live page and lipsyncs answers. Edit your pricing and the next reply knows. https://three.ws/concierge
```

### Why it is written that way

The walkthrough leads on the first move, adding the tag, and the payoff is a concierge whose answers come from the live page itself. That self-updating grounding is the strongest true thing here: it separates this from a static chatbot and it is stated plainly in the docs.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
Concierge, the three.ws chat widget, is a talking 3D avatar for any website. It reads the live page it sits on at ask time, so there is no crawler or index to keep in sync, and editing your pricing page changes its very next answer. Visitors can talk to it by voice and hear it reply aloud, and the widget is free and open source. https://three.ws/concierge
```

## Ship it

```bash
npm run announce:media -- --only concierge-hero   # capture the frame from the live route
npm run x:content -- review concierge               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id concierge   # exactly what would be sent to X
```

The queue item is `concierge` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

