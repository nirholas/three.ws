# The brief handed to a story author

An author is given one product area and this page. Everything else they need is in
[Writing a story](./x-story-authoring.md) and [the voice contract](./announce-voice.md). Several
authors work at once, each in their own files, and an integrator adopts and reviews what they
finish, so the boundaries below are what keep ten authors from overwriting each other.

## Read these first, fully

1. [docs/x-story-authoring.md](./x-story-authoring.md): how to write and film a story.
2. [docs/announce-voice.md](./announce-voice.md): the contract the AI editor holds every post to.
3. `data/x-content/queue.json`: the item `wardrobe` is the worked example that passed review with
   a 5 on every dimension. Match its quality. Read the text of every item with status `posted`
   so you do not repeat one.
4. [docs/ops/x-story-findings-2026-09-30.md](./ops/x-story-findings-2026-09-30.md): the surfaces
   already found broken or not filmable. Do not spend time on those.

## The deliverable

For each story: a file at `data/x-content/stories/<id>.json` whose scenario passes against
production and has been filmed, so that `public/x-media/<id>/reel.mp4` and
`data/x-content/proofs/<id>.json` exist and the story's head post carries the reel. Then a report.

## Boundaries

- Only create files under `data/x-content/stories/`, plus the reel and proof that `prove`
  writes. Do not edit `data/x-content/queue.json`; do not run `adopt`, `advance`, `review`,
  `approve` or `run`; do not edit code or docs; do not commit or push. The integrator does that.
- No em-dashes or en-dashes. No hashtags, emoji, hype words, launch-deck openers or
  rhetorical-question openers (a reply that starts with a question fails the lint). Nothing about
  price or what a token will be worth.
- Do not name, tag or show any crypto project other than $THREE, in the copy, the captions or a
  filmed frame. Solana may be named. If a page shows third-party market data or names another
  coin, do not film it; report it.
- Leave `mentions` as `{}`. A tagged post needs the owner.
- Scenarios are read-only. Do not sign in, submit a form that creates, publishes, buys, mints or
  pays for anything, or start a generation that publishes something public. Browsing, filtering,
  searching, opening, orbiting, playing and previewing are all fine.
- If a feature does not work when you use it, that is a finding. Do not weaken the scenario. Report
  what failed and move on.
- Every number and absolute word in the copy sits in a claim with evidence, and every mechanism
  sentence gets a claim too (usually `page` evidence quoting the live page). The reviewer flags
  any factual sentence no claim covers.
- `three.ws` anywhere in a post becomes a link. One link per item, so write the brand only as part
  of that link.
- Never write a scoped package name such as `@three-ws/avatar-cli` in a post: X reads `@three` as a
  tag of an unrelated account. Name the command (`the three-ws-avatar command`), or let the page
  the post links show the install line.
- A count that only grows is claimed as a floor ("more than 500 agents") with
  `{ "type": "proof", "fact": "agents", "min": 500 }`, so the post stays true as the count moves.
- Check the browser starts before you scout or prove:
  `node -e "require('playwright').chromium.launch().then(b=>{console.log('ok');return b.close()})"`.
  If it reports a missing library, run `npx playwright install-deps chromium` once. `scout`,
  `prove` and `advance` also refuse to run when the browser draws emoji as empty boxes, and print
  the one command that installs a colour emoji font it can use.

## How to work

1. Look: `node scripts/x-content.mjs scout <url> --format square --shot <scratch>/<id>-scout.png`,
   then read the screenshot. Read the page source under `pages/` or `src/` when a control is
   unclear.
2. Say the story in one sentence: what can a person do now. No sentence, no story.
3. Write the file with a first scenario and placeholder copy; iterate with
   `node scripts/x-content.mjs prove --file data/x-content/stories/<id>.json --no-film` until
   every step passes. A failed step prints where it saved a picture of the page; look at it.
4. Film: the same command without `--no-film`.
5. Watch it: pull at least four frames across the reel and look at each one.
   `node_modules/ffmpeg-static/ffmpeg -y -loglevel error -ss <sec> -i public/x-media/<id>/reel.mp4 -frames:v 1 -q:v 3 <scratch>/<id>-<sec>.jpg`
   Is the result visible and held for at least two seconds at the end? Is each caption true of
   the frame under it? Does any frame show another coin, a sign-in wall, an error, an empty state
   or a spinner that never resolves? Fix the scenario and film again if so.
6. Write the real copy and claims, then validate without touching the queue:
   `node -e "import('./api/_lib/x-content/queue.js').then(async (m)=>{const fs=await import('node:fs');const item=JSON.parse(fs.readFileSync('data/x-content/stories/<id>.json','utf8'));const q=JSON.parse(fs.readFileSync('data/x-content/queue.json','utf8'));console.log(JSON.stringify(m.validateItem({...item,status:'review'},process.cwd(),{quality:q.quality}),null,1))})"`
   It must print `[]`.
7. Check every `page` evidence string is on the live page, character for character.

## What good looks like

- Reel of 8 to 20 seconds, the action visible, the result held, at least 25% of frames changing.
  Short captions: the bar shows two lines, and `prove` refuses to film a caption that would be cut
  off in the story's format (about 40 characters is safe in square).
- Head post that opens with the strongest true statement as news, in plain words, and stands on
  its first 280 characters; then the mechanism. 250 to 600 characters is the usual range.
- One or two replies with the detail, the limits and what to do next.
- One link, in the head or the first reply as assigned; alternate between stories.
- Openings that differ from each other and from every posted item.
- `"notBefore"` set to tomorrow, `"probes"` starting with `{ "type": "scenario" }`, an `api`
  probe when the feature has a public GET (and one asserting any count the copy states), and
  `"covers"` listing the backlog keys the story speaks for.

## Writing for volume

The queue ranks every post by its chance of being followed by a volume response on the $THREE pool
(the hour after the post trading at least twice the hour before). The chance comes from
[`data/x-content/volume-model.json`](../data/x-content/volume-model.json), a model fitted on 313
original posts and the pool's 15-minute candles. What it found, strongest first:

| Attribute | Odds ratio | What it means for the copy |
|---|---|---|
| Announces something shipped | 1.96 | Lead with the launch, in plain words: "is live", "shipped", "now". The voice rules still ban "Introducing" and hype; "is live on three.ws" is neither. |
| Posted 12:00 to 20:00 UTC | 1.73 | The slots handle this; every slot sits in that window. |
| Recognition language | 1.63 | When the feature runs on, or is recognised by, a partner programme we are really in, say so: partner, listed, verified, featured, joined. |
| Names a tier-1 company by its @handle | 1.49 | Tag the company the feature genuinely runs on (@nvidia, @GoogleCloud, @OpenAI, @IBM, @awscloud ...), at most two, each with its reason in `mentions`. A tagged post waits for the owner; that is fine. |
| Longer than 180 characters | 1.47 | The head carries the news and the mechanism. |
| A thread | 1.34 | One or two replies with the detail. |
| Talks about the token | 0.97 | No effect either way. Do not lead with $THREE to move the pool. |

So the strongest story is a feature that shipped, running on a partner we are really in, told as
news. Our real programmes, as `/partners` states them: OpenAI Select Partner, IBM Business Partner,
AWS Partner (Software Path; the Marketplace listing is "coming", not live), Google Cloud (production
runs on it), NVIDIA Inception, Alibaba Cloud. Quote the status exactly as the page words it; never
upgrade it.

## The report

For each finished story: id, the one-sentence story, tier, lane, pattern, reel length and
percentage of frames changing, the facts the run read, and the head post text. For each surface
looked at and not written: why, specifically. A broken feature found is as valuable as a story.
