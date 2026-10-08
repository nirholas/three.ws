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
4. The worked example: the item `three-hold-article` in `data/x-content/queue.json` and its body
   `data/x-content/articles/three-hold-to-access.md`. Plain first person plural, a concrete opening,
   real numbers, one code sample that shows the mechanism, and the limits said out loud.
5. [docs/ops/x-story-findings-2026-09-30.md](./ops/x-story-findings-2026-09-30.md): surfaces found
   broken or not filmable. Do not build an article on one of them.

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

- **Title:** under 100 characters, a plain statement of what the reader learns. Not a teaser.
- **Length:** 800 to 1,600 words. Long enough to teach something, short enough to finish.
- **Opening:** the strongest true thing first, as news, in two or three sentences. A reader who
  stops after the first paragraph should still know what we built and why it matters.
- **Shape:** three to six `##` sections. Each section earns its place with a mechanism, a number,
  a picture or a limit. One code block at most where it shows the mechanism better than prose
  (code and tables share a 10,000 character budget).
- **Images:** two to four inline images, each a real capture of the live product or a frame from a
  filmed reel, each with a caption that says what the reader is looking at. No stock art, no
  mockups, no generated illustrations of things that do not exist.
- **Cover:** 1600x900, the product itself at its most striking (a real capture with site chrome
  hidden), no words on it. X crops covers on the card, so keep the subject centred.
- **Limits:** say what it does not do yet, plainly. It is what makes the rest believable.
- **Ending:** where to try it, with the link. No call-to-action slogans.
- **Quote post:** 150 to 400 characters that stand on their own as news and point at the article.

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
