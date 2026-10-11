# The brief handed to an X Article author

An author is given one or two topics and this page. An X Article is the long form of @trythreews:
a full piece with a title, a cover, headings and images, published natively on X and quoted by a
short post. Articles have their own slot, one every second evening at 22:30 UTC, and are released
by the queue's policy once they pass review on the editor's own verdict, so an article must be
right without anyone reading it before it goes out. It must tag no one anywhere in its body. Everything a post needs (the voice contract, claims with evidence, live
verification) applies to an article too, across every sentence of its body.

Several authors work at once, each in their own files, and an integrator adopts and reviews what
they finish. The boundaries below are what keep them from overwriting each other.

## Read these first, fully

1. [docs/x-content-pipeline.md](./x-content-pipeline.md): what an `article` item is and how it
   publishes.
2. [docs/announce-voice.md](./announce-voice.md): the contract the AI editor holds every word to.
3. [docs/x-story-authoring.md](./x-story-authoring.md): claims, evidence, probes and scenarios. An
   article uses the same machinery as a post.
4. **The worked example, and the standard every future Article and post is held to** (owner,
   2026-10-10): the item `keeper-article` in `data/x-content/queue.json`, its body
   [`data/x-content/articles/keeper-article.md`](../data/x-content/articles/keeper-article.md), and
   its media under `public/x-media/keeper-article/`. Read it end to end before writing a word. It
   opens on one real job told as a story with its real numbers, follows that one job through every
   stage of the pipeline, explains each mechanism in plain language before the technical detail,
   shows a call any reader can run, credits the open models it builds on, carries a full partners
   section, and ends on the pages to try. Match its shape, voice, depth and framing.
5. [docs/ops/x-story-findings-2026-09-30.md](./ops/x-story-findings-2026-09-30.md): surfaces found
   broken or not filmable. Do not build an article on one of them.
6. [docs/x-archive/trythreews-articles-readers.md](./x-archive/trythreews-articles-readers.md): what
   readers of our published Articles responded to and asked for. Choose the angle and write the
   opening with it in mind.

## The deliverable

For each article, all under its own id:

| File | What it is |
|---|---|
| `data/x-content/stories/<id>.json` | The queue item: `"kind": "article"`, `"tier": 1`, `"lane": "article"`, `"pattern": "longform"`, the `article` block, `claims`, `probes`, `posts` (the quote post), `"mentions": {}`, `"notBefore"` set to tomorrow, and `covers` naming the backlog keys it speaks for. |
| `data/x-content/articles/<id>.md` | The body, in Markdown. |
| `public/x-media/<id>/cover.png` | The cover, 1600x900, a still image with alt text in the item. |
| `public/x-media/<id>/*.png` | Inline images the body references as `![caption](/x-media/<id>/name.png)`. |

Optionally a `scenario`, filmed with `prove`, when the article's subject is a feature a reel can
show: the reel then rides on the quote post.

## Use all of the room X gives an Article

The quality gate (`articleProblems` in `api/_lib/x-content/queue.js`) refuses to review or approve an
Article that leaves X's limits unused. Every Article needs:

- A title of 80 to 100 characters (X allows 100) that carries the headline number.
- 2,400 or more words across 8 or more `##` sections, each named for what the reader learns, that
  explain the job in depth: the plain-words version first, then the mechanism.
- 3,000 or more characters of real code and tables (X allows 10,000 in code blocks and tables).
- 4 or more inline images, each a real capture of the thing described.
- A `## The partners behind ...` section that thanks every partner listed on three.ws/partners, each
  with its designation stated exactly as that page states it, and what their programme made possible.
- A `## Try it` section linking the live pages.

## Boundaries

- Only create the files above, plus the reel and proof `prove` writes. Do not edit
  `data/x-content/queue.json`; do not run `adopt`, `advance`, `review`, `approve` or `run`; do not
  edit code or other docs; do not commit or push.
- No em-dashes or en-dashes anywhere, title included. No hashtags, emoji, hype words, launch-deck
  openers ("Introducing", "We're excited") or a rhetorical question as the opening. Nothing about
  price or what a token will be worth.
- Do not name, tag or show any crypto project other than $THREE: in the title, body, captions,
  cover, images or the quote post. Solana may be named. Keep payments, wallets and stablecoins out
  of articles entirely; the public feed carries none of that.
- No scoped package names such as `@three-ws/x` in the quote post (X reads `@three` as a tag). In the
  body, inside a code block, they are fine.
- Every number, absolute word and mechanism sentence in the body sits in a claim with evidence:
  `page` evidence quoting the live page character for character, `file` evidence quoting the code,
  or `proof` evidence from a filmed run. A count that only grows is claimed as a floor ("more than
  2,500") with `"min"`. The reviewer flags any factual sentence no claim covers.
- `three.ws` anywhere in the quote post becomes a link; write the brand there only as that link.
- Read-only on production: browse, open, play, preview. Never sign in, buy, mint, publish or pay.
- If the feature does not work when you use it, that is a finding: report it and pick a different
  angle. Do not write around a broken feature.

## What good looks like

Every bullet below is something the keeper article does; open it beside your draft and check each one.

- **Title:** under 100 characters, a plain statement of what the reader learns, with the headline
  number in it when there is one. Not a teaser. Keeper: "One sentence to a rigged, talking 3D
  character in 197 seconds: each stage, as it ran".
- **Opening:** one real run, told as a short story, in plain words anyone can follow: what we sent,
  what came back, how long it took, with the real numbers. Then one paragraph that says what the
  article covers and that every number in it can be checked. A reader who stops there still knows
  what we built and why it matters.
- **One thread through the whole piece:** pick one real job (one prompt, one avatar, one request)
  and follow it from start to finish, quoting what the server actually said at each stage. Every
  section advances the same job, so the article reads as one story rather than a feature list.
- **Plain first, technical after:** each section opens with what the stage does and why it exists in
  a sentence a newcomer understands ("A mesh is a statue. To move, it needs joints"), then gives
  the mechanism, the model, the hardware and the measured numbers.
- **Length:** expand. 1,800 to 2,800 words, as much relevant, verified information as the subject
  holds. Never trim a draft for length; cut only what is untrue or unverifiable.
- **Shape:** eight to twelve `##` sections, each named for what the reader learns in it. One or two
  short code blocks where they show the mechanism better than prose, ideally a request the reader
  can paste and run unchanged (code and tables share a 10,000 character budget).
- **Images:** three or four inline images, each a real capture of the live product or a frame from a
  filmed run, each with a caption that says exactly what the reader is looking at. No stock art, no
  mockups, no generated illustrations of things that do not exist.
- **Cover:** 1600x900, the product itself at its most striking (a real capture with site chrome
  hidden), no words on it. X crops covers on the card, so keep the subject centred.
- **Positive framing only:** nothing negative is posted. No losses, outages, incidents, bugs,
  "honest limitations" sections or disparaging contrasts. A fallback is told as resilience ("the
  ladder delivered a reference picture without waiting on any single provider"), a boundary as a
  design choice, and anything unfinished as what is next ("rolling out", "on the roadmap"). Never
  fabricate to fill the gap: if a fact cannot be framed positively and truthfully, leave it out.
- **Credit open work:** name the open models and research the feature builds on, with their licence
  and venue, in their own short section.
- **Partners section, every time:** a `## The partners behind ...` section near the end, one bold
  paragraph per programme, each stating the designation exactly as
  [three.ws/partners](https://three.ws/partners) states it and then how that partner shows up in
  this article's feature. Never upgrade a designation, and never present a pending listing as live.
  Copy the keeper article's list as the starting point and re-verify each line against `/partners`.
- **Ending:** a `## Try it` section with the live pages to use, each as a link: the browser version,
  the developer docs, and the free tools that let a reader check the result. No call-to-action
  slogans.
- **Quote post:** 150 to 400 characters that stand on their own as news: the headline result with
  its numbers, then what the article covers.

## How to work

1. Use the feature end to end against production first. Scout pages with
   `node scripts/x-content.mjs scout <url> --format landscape --shot <scratch>/<id>-scout.png` and
   read the code under `src/`, `api/` and `pages/` that the article explains. Write down every
   number you will use and where it came from.
2. Capture images with Playwright against `https://three.ws` (headless Chromium works here; check
   with `node -e "require('playwright').chromium.launch().then(b=>{console.log('ok');return b.close()})"`).
   Hide the walk companion and site chrome when they are not the subject. Look at every image before
   using it: no sign-in walls, spinners, errors, empty states, T-posed avatars or third-party coins.
3. Write the body, then the claims for every factual sentence in it.
4. Validate without touching the queue; it must print `[]`:
   `node -e "import('./api/_lib/x-content/queue.js').then(async (m)=>{const fs=await import('node:fs');const item=JSON.parse(fs.readFileSync('data/x-content/stories/<id>.json','utf8'));const q=JSON.parse(fs.readFileSync('data/x-content/queue.json','utf8'));console.log(JSON.stringify(m.validateItem({...item,status:'review'},process.cwd(),{quality:q.quality}),null,1))})"`
5. Check every `page` evidence string is on the live page, character for character.

## The report

For each article: id, title, word count, the one-sentence point, the images and what each shows,
the facts and where each came from, and the quote post text. For each angle you dropped: why. A
broken feature found is as valuable as an article.
