# Announcement pack: Avatar CLI: GLB to live embed in four commands

**Surface:** [`/avatar-cli`](https://three.ws/avatar-cli) · **Stage:** drafted · **Slot:** 2026-10-16 · **Announced externally:** never

Ranked 93 of 322 never-announced surfaces by `npm run announce:rank` (score 57). Drafted on nvidia:moonshotai/kimi-k3 and packed by `npm run announce:kit`, from the evidence brief in [`data/announce-plan/briefs/avatar-cli.json`](../../data/announce-plan/briefs/avatar-cli.json), against [the announcement voice](../announce-voice.md). Every fact below comes from that brief; nothing in this pack was written from memory.

---

## At a glance

| Field | Value |
|---|---|
| Pack id | `avatar-cli` |
| Publish slot | 2026-10-16. The minute is decided at send time from the production schedule seed, so it is not knowable from this repository |
| Lane and pattern | developer / clip |
| Audience | Engineers who will read the code |
| Primary channel | X, @trythreews, through the reviewed content queue |
| Secondary channels | Telegram (@three_ws), the surface's own docs page |
| Proof | https://three.ws/avatar-cli |
| Tracked links | Telegram `https://three.ws/avatar-cli?utm_source=telegram&utm_medium=community&utm_campaign=announce-avatar-cli&utm_content=announcement`. The X post links the bare URL on purpose: X wraps every link in t.co and the queue's own ledger records the send, so a tagged link buys nothing and reads like marketing. |
| The single CTA | Open /avatar-cli and use it |
| Media | `avatar-cli-hero`, motion loop |
| KPI | loop completions and profile visits, then route sessions on the day |

## Why this one, and why now

The ranker scored it on signals measured against our own archive, not on taste:

- **reach (12)**: sitemap priority 0.60, which is what we already decided this surface is worth
- **visual (14)**: renders something worth a frame
- **token (18)**: touches $THREE or the agent economy, the topic band that measured highest in our own archive
- **depth (13)**: documented in the tree, so there is enough to write a mechanism about and link proof for

It shipped on 2026-07-30 and has never been posted about.

The changelog has 5 entries about it, the most recent from 2026-08-16: "The Avatar CLI page terminal is readable by a screen reader, and its recovery link is reachable by keyboard".

## The claim, and where it is checked

> Four commands take a GLB and a wallet to a hash-anchored avatar manifest and an embed snippet that renders. Offline, no API key, safe in a release script: https://three.ws/avatar-cli

Every checkable part of that is declared as a claim in the queue item, and the verifier re-checks each one against the live surface before the post can be approved:

| Claim | Checked against |
|---|---|
| Four commands take a GLB and a wallet to a hash-anchored avatar manifest and an embed snippet that renders | `docs/avatar-cli.md` contains "Four commands take you from a `.glb` file to a snippet you can paste into a page." |
| Offline, no API key, safe in a release script | `docs/avatar-cli.md` contains "Everything it does is offline and deterministic: no account, no API key, no network call." |

## Media

Captured from the live route by `npm run announce:media`, which drives the real page in a real Chromium and writes provenance (route, commit, time, sha256) beside the pixels in [`public/announce/media-manifest.json`](../../public/announce/media-manifest.json).

| Shot | File | Notes |
|---|---|---|
| `avatar-cli-hero` | `/announce/img/avatar-cli-hero.webp` | Motion loop of the live route. |

**Alt text, required on the post:**

> Screen recording of a terminal replaying the four avatar CLI commands: init scaffolds a manifest from a wallet and GLB, validate checks it, hash prints the SHA-256, and preview prints an agent-3d embed snippet.

## The post

Pattern: clip. **178 weighted characters**, inside the 100 to 179 band that measured a 3.0x lift. Postable file: [`avatar-cli.post.txt`](./avatar-cli.post.txt), which is the byte-for-byte source the queue item points at.

```text
Four commands take a GLB and a wallet to a hash-anchored avatar manifest and an embed snippet that renders. Offline, no API key, safe in a release script: https://three.ws/avatar-cli
```

### Why it is written that way

The post leads on the mechanism: four commands turning a GLB and a wallet into a hash-anchored manifest and a working embed snippet. That is the strongest true thing because it is what the motion loop shows and what makes the CLI belong in a build pipeline rather than a browser tab.

## Telegram (@three_ws)

The same facts in the channel's longer register. The changelog cron posts release notes there automatically; this is the announcement register, sent by hand or queued alongside the post.

```text
The @three-ws/avatar-cli package is terminal tooling for on-chain avatars. Four commands take you from a GLB file and a wallet to a hash-anchored manifest validated against the published schema, plus an embed snippet that actually renders. Everything runs offline and deterministically, with no account and no API key, so it is safe to gate a release script on. Docs and the live demo are at https://three.ws/avatar-cli
```

## Ship it

```bash
npm run announce:media -- --only avatar-cli-hero   # capture the frame from the live route
npm run x:content -- review avatar-cli               # lint, live fact checks, AI editor
npm run x:content -- run --dry-run --id avatar-cli   # exactly what would be sent to X
```

The queue item is `avatar-cli` in [`data/x-content/queue.json`](../../data/x-content/queue.json), at status `draft`. It becomes eligible to publish when a passing review record exists and the owner sets its status to `approved`; the Cloud Scheduler tick then sends it at its slot. Nothing here posts on its own.

