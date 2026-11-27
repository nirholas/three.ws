# On the timeline: X-native and Blink ideas for three.ws

Third research pass, 2026-11-26, after [grok-ecosystem-opportunities.md](grok-ecosystem-opportunities.md) and [grok-showcase-and-tools.md](grok-showcase-and-tools.md). Question: what can run or render directly in the X feed, and how do we use Blinks and other X features in ways nobody else does?

Sources are tagged. **Verified** means read from an official page on 2026-11-26. **Reported** means a secondary source; confirm in the X Developer Console or the Dialect docs before building on it.

## What the feed allows in late 2026

- **Pricing, verified** (docs.x.com `/x-api/getting-started/pricing`): pay per use, no subscriptions. Creating a post costs $0.015, a "summoned" post $0.010, and **a post containing a URL $0.200**. A DM costs $0.015. Reading your own mentions costs $0.001. The docs do not define "summoned" or say which price a summoned reply with a URL pays. Check that in the console.
- **Bot rules, verified** (docs.x.com developer guidelines): turn on the Automated label, name the human operator in the bio, reply only after the user starts the interaction, and offer an easy opt-out. Reported: since 2026-02-23, self-serve replies are accepted only when the author mentioned or quoted the account first. Design every reply as summoned.
- **Native media autoplays.** An MP4 uploaded through the API plays muted in the feed on every client. This is the only in-feed motion that needs no approval.
- **`summary_large_image` cards** render for any link with no approval. **Player cards** (an interactive iframe in the feed) need X's approval, which is reportedly rare outside established media. Our submission is ready ([partners/x-player-card-submission.md](partners/x-player-card-submission.md)); it is an owner step.
- **Blinks do not unfurl natively on X.** They render only for desktop users with the Phantom, Backpack or Dialect browser extension, and only for links registered in the Dialect Actions Registry (reported, Phantom and Dialect guides). There is no evidence of mobile rendering. Everyone else sees a link card that opens dial.to or our page. Blinks are a bonus layer for crypto-native users, not the main surface.
- **Blinks spec** (`@solana/actions-spec`, reported): linked actions of type `transaction`, `message` (sign a message, no funds move), `post` and `external-link`. Typed inputs (text, number, select, radio). A `completed` end state. Chaining through `links.next` (sRFC 28). How widely clients support chaining is unverified.
- **Community Notes AI Note Writer API, reported:** public since September 2025. A writer earns its way in through quality checks on recent notes, writes only on posts where users requested a note, and AI writers now draft a large share of proposed notes (41% in one study). The WSDM Cup 2027 note-writing agents competition started 2026-11-11, scoring begins 2026-12-12, and teams receive X and Grok API credits (noteagents.org).
- **X Chat API**, reported: public, end-to-end encrypted DMs. **X Money**, reported: a US rollout with no developer API. Do not plan on it; Solana stays the rail.
- **Grok Imagine** is now inside Grok chat, and free X accounts get daily images (reported). Public @grok image replies were limited to paid users after January 2026 (reported).

### What we already have

- Four live Blinks: avatar card, tip, hire, buy the agent's coin ([solana-actions.md](solana-actions.md), discovery at `/.well-known/solana/actions.json`). Our docs do not record a Dialect registry entry, and the registry endpoints did not answer from here. **Check on dial.to whether three.ws is registered; if not, registering is the cheapest in-feed win on this page.**
- The mention bot's "make me an avatar" and "3D this" intents ([x-mention-avatar.md](x-mention-avatar.md), [x-mention-image3d.md](x-mention-image3d.md)), in dry run until the owner turns posting on.
- 445 pages serve `summary_large_image`. The forge share and agent pages already carry `twitter:player` tags behind `X_PLAYER_CARD_APPROVED`.

### One cost fix before the mention bot goes live

Mention-bot replies carry the creation link. At $0.200 per URL post against $0.010 for a summoned post, links make every reply about 20 times dearer. Make the reply media-first: the rendered image or clip, with the short path written into the image itself, and the clickable link only on request or on the profile. Confirm in the console which price a summoned reply with a URL pays, then put the rule in the bot's reply builder with a test.

## Ideas, ranked

### 1. Video replies, never links

- **What:** every summoned reply is a 6 to 12 second native MP4: a turntable of the avatar we just made, a looping cutaway, or the avatar saying the answer aloud. It autoplays in the feed, it is the thing people repost, and it is the cheapest post X sells.
- **Builds on:** engine 1 (scene-to-clip) from the showcase doc, [api/_lib/render-clip.js](../api/_lib/render-clip.js), and Grok TTS for voiced clips.
- **Effort:** M, mostly engine 1. Posting is owner-gated.

### 2. Guess the Machine (a daily timeline game)

- **What:** each day @trythreews posts a clip that starts deep inside an unrecognisable part and slowly pulls back, plus a native four-option poll: "What machine is this?" The next day the reveal posts as a full narrated cutaway, with yesterday's poll result shown as a 3D podium, and the next puzzle.
- **Why it works:** a recurring daily ritual, native polls (cheap engagement with no link), and a reveal that is our product. The zoom engine is the same one as "Zoom to the atom".
- **Grok part:** Grok picks the day's machine (optionally from what X is curious about through `x_search`), writes the spec and the decoy options, and code execution keeps the scale honest.
- **Effort:** S to M once engine 1 exists. Posting is owner-gated; the queue already exists (`data/x-content/queue.json`).

### 3. A Grok-powered Community Notes writer that cites receipts

- **What:** enrol a three.ws AI note writer. Grok drafts neutral, sourced notes on posts users have flagged, with sources taken from data we hold: the 660k-article crypto archive back to 2017, on-chain facts (a Tx Anatomy page as evidence that a wallet did or did not sell), and anatomy and science explainers.
- **Why it is strong:** it is the one AI surface built into X itself, it earns reputation through X's own rating system, and the WSDM Cup 2027 competition gives us a public scoreboard plus X and Grok credits, on a deadline that is open now. It is also the honest answer to "@grok is this true?" being uncited.
- **Rules:** notes must be neutral and never promote $THREE or any product. Our sources are cited only because they are evidence.
- **Effort:** M. Enrolling and entering the competition are owner steps.

### 4. Sign-to-vote Blinks: interaction without spending

- **What:** the `message` action type lets a wallet sign a statement with no funds moving. That gives in-feed interactions that are one vote per wallet and resistant to fake accounts, with nothing at risk:
  - **Forge-Off vote:** pick a favourite from three renders; the result posts as a 3D podium clip.
  - **Anatomy quiz:** answer the question on a cutaway card and sign to record it; correct answers collect a badge on the agent profile.
  - **Proof of presence** for a Living Stage show or a `/play` event.
- **Why it is new:** almost every Blink in the wild asks for money. A Blink that costs nothing and still proves a real wallet acted is the friendliest possible first touch for new users.
- **Builds on:** the existing Actions handlers and envelope pattern ([api/actions/avatar.js](../api/actions/avatar.js)).
- **Effort:** S per Blink. No funds move, so no spend gate.

### 5. Build-your-avatar chained Blink

- **What:** a card shows a rendered avatar. You pick a pose and a colourway from select inputs, the next card shows the re-render, you sign a message to claim it, and the `completed` card shows your avatar with its share link. The whole creation happens in the feed for extension users and on dial.to for everyone else.
- **Builds on:** restyle presets ([api/material-studio.js](../api/material-studio.js)), pose presets, `render-clip.js` for per-step images.
- **Caveat:** chaining support varies by client. Ship it so every step also works as a normal page.
- **Effort:** M.

### 6. A storefront in every answer

- **What:** when an agent answers on X (the mention bot or Grok Bot), the clip ends on a card naming that agent. Users who reply "hire" get the agent's hire Blink in a follow-up reply. They asked for it, so it is summoned and worth the URL price. Paying in the Blink stays the buyer's own signed action.
- **Builds on:** the hire Blink ([api/actions/agent-hire.js](../api/actions/agent-hire.js)).
- **Effort:** S.

### 7. Poll-directed serial forge

- **What:** a weekly character built by the timeline. Monday's clip shows a base model; a poll picks the material, Tuesday's picks the prop, Wednesday's the move, and Friday's finale is the finished rigged character, given to the account whose reply the community liked most.
- **Why:** serial formats keep people coming back, and the audience owning the outcome drives replies.
- **Effort:** S per episode once engine 1 exists. Posting and any giveaway are owner-gated.

### 8. DM concierge over X Chat

- **What:** after a public summoned reply, the heavy delivery moves to DM: the GLB file, a claim link to put it on a three.ws agent, and a pose-studio link. The public reply stays a clean clip; links travel in DM. DM price with a URL is unverified, so check it.
- **Effort:** M. Reported API.

### 9. Register and polish the Blinks we have

- **What:** register the four live Blinks (and new ones) in the Dialect registry. Give each a rendered 3D icon per agent: the avatar Blink already uses [api/actions/avatar-icon.js](../api/actions/avatar-icon.js).
- **Effort:** S. Registry submission is an owner step if it needs an account.

### 10. Player card, if X says yes

- **What:** a forge share link plays a spinning, draggable 3D model in the feed. Everything is built and gated behind `X_PLAYER_CARD_APPROVED`. Submit and do not plan around approval.

## Gated

Owner yes every time: any post, reply, poll or DM from our accounts; enrolling as a Community Notes writer and entering WSDM Cup 2027; Dialect registry submission; the player card submission; any giveaway. Blink transactions are always the user's own signature. Sign-message Blinks move no funds.
