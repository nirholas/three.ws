# Announcement pack: Voice Lab: pick or clone your agent's voice

**Surface:** [`/voice`](https://three.ws/voice) · **Stage:** drafted · **Slot:** 2026-10-17 · **Announced externally:** never

Ranked 96 of 322 never-announced surfaces by `npm run announce:rank` (score 56). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/voice.json`](../../data/announce-plan/briefs/voice.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `voice` |
| Publish slot | 2026-10-17. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / walkthrough |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/voice |
| Tracked links | Telegram `https://three.ws/voice?utm_source=telegram&utm_medium=community&utm_campaign=announce-voice&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /voice and use it |
| Media | `voice-hero`, still frame |
| KPI | route sessions that reach the second step of the flow |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (14)**: sitemap priority 0.70, which is what we already decided this surface is worth
- **visual (25)**: a showcase surface, so its frame can be a motion loop
- **partner (12)**: names a partner the surface genuinely runs on, so a tag is defensible
- **depth (5)**: documented in the tree, so there is enough to write a mechanism about and link proof for

It shipped on 2026-06-05 and has never been posted about.

The changelog has 6 entries about it, the most recent from 2026-09-08: "Every tutorial now shows you the page it is teaching".

## The claim, and where it is checked

> Pick your agent's voice from hundreds across Microsoft Edge, Gemini, NVIDIA, OpenAI and ElevenLabs, or clone your own from 20-30 seconds of clear speech: https://three.ws/voice

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| hundreds across Microsoft Edge, Gemini, NVIDIA, OpenAI and ElevenLabs | live page shows "Pick a voice from hundreds across Microsoft Edge, Google Gemini, NVIDIA, OpenAI and ElevenLabs, or record 20-30 seconds of clear speech and clone your own. Either way it works across your avatars and agents." |
| clone your own from 20-30 seconds of clear speech | live page shows "Pick a voice from hundreds across Microsoft Edge, Google Gemini, NVIDIA, OpenAI and ElevenLabs, or record 20-30 seconds of clear speech and clone your own. Either way it works across your avatars and agents." |

**Tags, and why each one is true:**

- `@nvidia`: NVIDIA is one of the voice providers listed on the Voice Lab page, so the surface genuinely serves NVIDIA voices.

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `voice-hero` | `/announce/img/voice-hero.webp` | Still frame of the live route. |

**Alt text, required on the post:**

> The Voice Lab page on three.ws, showing a searchable grid of voice options with provider filters and a recording control for cloning a voice from a short sample.

## The post

Pattern: walkthrough. **177 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`voice.post.txt`](./voice.post.txt), which is the byte-for-byte source the queue item points at.

```text
Pick your agent's voice from hundreds across Microsoft Edge, Gemini, NVIDIA, OpenAI and ElevenLabs, or clone your own from 20-30 seconds of clear speech: https://three.ws/voice
```

### Why it is written that way

The post leads on the first move a user makes, picking a voice or cloning one, which matches the walkthrough pattern and is the strongest true statement the live page supports. The provider spread is the concrete differentiator, and every number in the copy is quoted from the page itself.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
Voice Lab gives your agent a voice in one page. Browse hundreds of ready-made voices across Microsoft Edge, NVIDIA, Google Gemini, OpenAI and ElevenLabs and preview any of them, or record 20-30 seconds of clear speech and clone your own. Whichever you pick works across your avatars and agents. Try it at https://three.ws/voice
```

## Ship it

```bash
npm run announce:media -- --only voice-hero   # capture the frame from the live route
npm run x:content -- review voice               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id voice   # exactly what would be sent to X
```

The queue item is `voice` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

