# The announcement voice

**Status:** the contract every post in the queue is written and reviewed against, and the file
the AI editor is handed with each one. **Last measured against the live account:** 2026-09-29.

three.ws has shipped more than 400 surfaces and posted about roughly 60 of them. The backlog is
inventory, not a roadmap, and working it down means writing a lot of announcements. The failure
mode that threatens is not running out of features. It is that 300 posts written quickly all start
to sound like the same machine wrote them, and an audience that smells a template stops reading the
ones that matter.

## Where the numbers come from

The X API, read for the account's own head posts, by the learning loop in
[`api/_lib/x-content/outcomes.js`](../api/_lib/x-content/outcomes.js). Run
`npm run x:outcomes -- --refresh` and it prints the table these rules were taken from, measured
again today, so a claim here can be re-checked rather than believed. The queue ranks with the same
table on every tick.

An earlier version of this file was derived from a scrape
([`data/x-archive/trythreews-2026-08-14.json`](../data/x-archive/trythreews-2026-08-14.json)).
That scrape was taken before X had loaded the like counts of the account's largest posts, so 56 of
214 posts were dropped as having no likes, the three strongest posts among them. Two of the rules it
produced were the wrong way round, and both are corrected below.

## What the numbers actually say

Median likes of head posts published from 2026-08-10 to 2026-09-28 (53 posts; replies inside a
thread are not counted as posts):

| Signal | Median likes | Posts | What it means for a draft |
|---|---|---|---|
| Video | **149** | 14 | The strongest format, and the one people save: 11 bookmarks a post against 4 for a photo. Film the feature. |
| Photo | 101 | 25 | A still is the fallback when a feature has nothing that moves. |
| No media | 80 | 14 | The floor. |
| Over 280 characters | **140** | 21 | Say the whole thing. The account is on X Premium, and its long posts do about twice the rest. |
| 180 to 280 characters | 76 | 16 | |
| 100 to 179 characters | 75 | 7 | The band the old contract aimed every post at. It measures no better than the one above it. |
| Under 100 characters | 55 | 9 | A one-liner is missing the mechanism. |
| Tags one account | **134** | 17 | Tag the partner a feature really runs on. Never tag one it does not. |
| Tags no one | 75 | 25 | |
| A thread | 133 | 34 | The head states the point; the replies carry the detail and the link. |
| A single post | 80 | 19 | |
| Media and no link in the head | 173 | 9 | A link in the head measured about a third less reach (9,574 impressions against 6,035). Nine posts is a small sample, so the queue alternates and keeps measuring. |
| Media and a three.ws link in the head | 121 | 29 | |

These overlap: a partner announcement is usually long, filmed, and tagged. Read them as direction,
not as multipliers to stack.

One comparison matters more than the rest. In September the posts this pipeline wrote had a median
of 63 likes and 2,851 impressions, and the posts written by hand had 112 and 5,386. The pipeline's
posts were short, still, and linked in the head. That gap is what this contract exists to close.

## The five rules

1. **Film the feature.** A post's media is a reel of the feature being used, made by
   `npm run x:content -- prove <id>` from the scenario the post carries. The reel is a passing
   end-to-end run against production, so it cannot show anything the product did not do. A feature
   with nothing to film gets a frame of the real product from `npm run announce:media`. Nothing
   ships with a stock graphic, and nothing ships with no media.
2. **Write until the reader could use it.** 100 characters is the floor: under it a draft says
   that a thing exists and not how it works. There is no target ceiling. The wall is the queue's
   `quality.maximumLength`. The first 280 characters are all a reader sees before "Show more", so
   the strongest true statement goes first and the post has to stand on those 280 alone.
3. **Every claim is checkable, and checked against the product.** Every number and every absolute
   (first, only, every, never) sits inside a claim with evidence. The strongest evidence is the
   run itself: a number the scenario read off the screen, a text it waited for, or an answer it got
   from the server. If the run did not see it, the post does not say it.
4. **Tag only what is true.** `@solana` when it settles on Solana. `@IBM` when it runs on
   watsonx. A tag we cannot defend costs more than it is worth, and a post that tags anyone is
   approved by a person, never by policy.
5. **Link the surface, once.** One link, to the page the post is about. It may sit in the head or
   in the first reply; the queue measures both.

## House choices

These are decisions, not measurements, and the gate enforces each one:

- **No hashtags.**
- **No emoji.** The account's hand-written posts do use them, and the data cannot separate their
  effect from the partner news they usually sit in. The queue leaves them out so that a run of
  scheduled posts never reads as decorated.
- **No em-dashes or en-dashes.** Use a period, a comma, a colon, or parentheses.
- **No launch-deck openers.** "Introducing" opened one post in 214.

## Banned openings

These are the tells that make a post read as generated. None of them appear in our best posts and
the gate rejects all of them:

> Introducing. We're excited to announce. We're thrilled. Say hello to. Meet the new. Big news.
> Today we're launching. Ever wondered. What if you could. Imagine a world where. Game-changer.
> Revolutionary. Seamless. Unlock the power of. Take your X to the next level. The future of X is
> here. And the best part? Let that sink in. Here's the kicker.

Also banned as structure, not just as phrases:

- **The rhetorical-question opener.** "What if your agent could trade for you?" Just say what it does.
- **The one-word-sentence drumbeat.** "Fast. Simple. On-chain." It reads as copywriting, and this
  audience discounts copywriting.
- **The thread that withholds.** Do not make the first post a teaser for the second. Lead with the
  strongest true statement.
- **Adjective stacking.** "A powerful, seamless, next-generation platform." Cut every adjective
  that a reader could not disagree with.

## What to write instead

Open with the mechanism or the number. The strongest posts in the archive do exactly this: they
state a specific, surprising, checkable fact in the first line and let the reader decide it is
impressive.

Three patterns for the opening, which is the part a reader sees before "Show more":

**The number lead.** Open on a figure the run read off the screen.

> Seven autonomous agents have scored 832,142 pump.fun launches on three.ws. 86% win rate on the
> top one. Every trade on the floor is live: three.ws/activity

**The mechanism lead.** Open on how it works, because the how is the interesting part.

> A sentence or a selfie becomes a rigged 3D agent holding its own custodial @solana wallet, a
> persona, and a voice. It walks and emotes on arrival: three.ws/genesis

**The correction lead**, for a feature that contradicts an assumption the reader holds.

> Most "AI agent wallets" are a key in someone's env file. Guardian makes an agent wallet
> recoverable and inheritable: name a guardian, set the timelock, and the wallet survives the
> agent. three.ws/guardian

## Uniqueness, enforced

Announcing 300 features means 300 posts that must not blur together. `npm run check:announce`
enforces one mechanical check:

- **No opening clause is reused.** The first eight words of every pack are compared against every
  other pack. A repeat fails.

The rotation between the three leads above (number, mechanism, correction) is an authoring
convention, not a mechanical check: do not give two packs written back to back the same lead
structure. The gate cannot make a post good. It stops the corpus from converging on one shape,
which is what makes a run of announcements read as automated.

## The pack

One file per feature in `docs/announcements/<slug>.md`, holding everything a post needs and
nothing it does not. See [`genesis.md`](./announcements/genesis.md) for the worked example. Every
pack carries:

- **The claim**, and the evidence for it, with a link to where it can be checked.
- **The post**, in this voice.
- **The media**, by shot id from [`data/announce-media.json`](../data/announce-media.json), with
  its alt text. Alt text is a requirement, not a courtesy: a post whose whole payload is an image
  is unreadable to a screen reader without it.
- **The Telegram variant.** The community channel takes plain text and a different register: more
  detail, no character ceiling worth worrying about, no tagging.
- **The changelog entry**, ready to paste into `data/changelog.json`.
- **Its state**, mirrored in `data/announcements.json` (generated by `npm run announce:rank`, so it is gitignored; run that first if you do not have it).

## What this file does not decide

Who releases a post. That is the queue's `approval` setting, described in
[the pipeline doc](./x-content-pipeline.md#who-approves-a-post): the owner, or the policy for posts
that were filmed, tag no one, and passed review on the editor's own verdict.
