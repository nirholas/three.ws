# Writing a story for the X queue

A story is one post about one thing three.ws does, with a reel of that thing being done. This is
the guide for writing one: what goes in the file, how to film it, and what makes the difference
between a post people save and a post people scroll past.

Read [the voice contract](./announce-voice.md) first. It is short, and the AI editor holds every
post to it. For how the queue schedules, reviews and publishes, see
[the pipeline doc](./x-content-pipeline.md).

---

## The idea

A post used to be written from what a page said about itself, and checked against the same page.
That proves the copy matches the page. It does not prove the feature works, and every post that has
been taken down was taken down for that gap.

So a story starts from using the feature. You write a **scenario**: the steps a person would take,
and what they would see when it worked. The pipeline runs those steps against production, and the
run is, at once:

| | |
|---|---|
| **the probe** | every step has to pass, or there is no reel and no post |
| **the video** | the run is filmed, so the media cannot show anything the product did not do |
| **the captions** | each step can carry the sentence that explains it |
| **the evidence** | what the run read off the screen, waited for, or got from the server is what your claims cite |

If the feature does not hold up when you use it, that is the finding. Do not write the post. Note
what failed and move on to a surface that works.

## One story, not one surface

The backlog lists more than 300 surfaces. It does not hold 300 stories. Seven `@three-ws/*-mcp`
packages announced one by one are seven posts of the same shape, and most packages have no users
to announce them to. Write about what a person can now do, and let the packages, workers and
services that make it possible be the detail inside that story. `covers` records which surfaces a
story speaks for, so the backlog stops offering them.

## The file

Stories live one to a file in `data/x-content/stories/<id>.json` until they are finished, so
several can be written at once. The file is a queue item:

```json
{
	"id": "galaxy-search",
	"status": "draft",
	"kind": "post",
	"tier": 2,
	"lane": "labs",
	"pattern": "walkthrough",
	"notBefore": "2026-09-30T00:00:00Z",
	"covers": ["/galaxy"],
	"scenario": {
		"format": "square",
		"steps": [
			{ "goto": "https://three.ws/galaxy", "settle": 6000, "caption": "Every published agent, placed by what it does" },
			{ "hold": 2200 },
			{ "read": "agents", "match": "([\\d,]+)\\s*agents" },
			{ "type": "trading bots", "into": "Search by meaning", "caption": "Describe what you want in plain words" },
			{ "click": "Search", "awaits": "/api/galaxy" },
			{ "expect": "Closest to", "caption": "The map flies to the closest matches" },
			{ "hold": 4000 }
		]
	},
	"probes": [{ "type": "scenario" }],
	"posts": [
		{ "text": "The head post. The reel is attached to it by `prove`." },
		{ "text": "A reply with the detail and the link: three.ws/galaxy" }
	],
	"claims": [
		{ "says": "600 agents", "evidence": [{ "type": "proof", "fact": "agents", "equals": "600" }] }
	],
	"mentions": {}
}
```

| Field | What to put in it |
|---|---|
| `id` | A lowercase slug. It names the reel, the proof and the review record. |
| `tier` | 1 for a flagship ($THREE utility, or a partner the feature runs on), 2 for a feature, 3 for developer proof of work (a package, a CLI, a worker). |
| `lane` | Who it is for: `community`, `developer`, `token`, `labs`. The queue will not run the same lane three times in a row. |
| `pattern` | The shape of the opening: `mechanism`, `number`, `walkthrough`, `correction`, `clip`. The queue will not run the same pattern twice in a row. |
| `notBefore` | The earliest it may go out. Use tomorrow's date. |
| `covers` | The backlog surfaces this story speaks for, as their keys (`/galaxy`, `@three-ws/scene-mcp`, `workers/rig`). |
| `probes` | Always includes `{ "type": "scenario" }`, so every review runs the scenario again. Add an `api` probe when the feature has an endpoint: it is the only kind that runs again seconds before the post goes out. |

## Writing the scenario

Look before you write. `scout` opens the page the way the camera will and lists what is there:

```bash
npm run x:content -- scout https://three.ws/galaxy --format square --shot /tmp/galaxy.png
```

It prints the controls you can click by their text, the fields you can type into, and the lines of
the page that carry a number. Open the screenshot as well: the list cannot tell you that a panel
covers the thing you meant to film.

### Steps

| Step | What it does | Filmed |
|---|---|---|
| `{ "goto": "https://...", "settle": 6000 }` | Loads the page and waits `settle` ms for it to finish arriving. Always the first step. | no |
| `{ "hold": 2000 }` | Films 2 seconds of the page as it is. | yes |
| `{ "click": "Search" }` | Moves the pointer to the control with that text and clicks it. `{ "click": { "selector": "#go" } }` when the control has no text. | yes |
| `{ "hover": "Preview" }` | Moves the pointer onto a control. | yes |
| `{ "upload": "data/x-content/inputs/garden-gnome.jpg", "into": "FRONT" }` | Clicks the control whose text matches `into` (or `{ "selector": "..." }`), and hands the file picker it opens that file. The file must live in the repository under `data/` or `public/`; the proof records its SHA-256, so swapping the file voids the proof. Inputs and their licenses are listed in `data/x-content/inputs/README.md`. | yes |
| `{ "type": "trading bots", "into": "Search by meaning" }` | Clicks the field whose placeholder or label matches `into`, then types. | yes |
| `{ "press": "Enter" }` | Presses a key. `{ "press": "w", "hold": 2000 }` holds it down for 2 s of page time, which is how a character is walked. | yes |
| `{ "drag": [[0.3, 0.5], [0.7, 0.5]], "ms": 1500 }` | Drags across the viewport, as fractions of its width and height. This is how you orbit a 3D scene. | yes |
| `{ "scroll": 500, "ms": 1000 }` | Scrolls by pixels, or to a text: `{ "scroll": "Pricing" }`. | yes |
| `{ "expect": "Closest to", "within": 45000 }` | Waits until the text is on screen. Add `"film": true` to film the wait. | no |
| `{ "read": "agents", "match": "([\\d,]+)\\s*agents" }` | Reads a fact off the page. The first group of the pattern is the fact. | no |
| `{ "wait": 3000 }` | Waits in real time. | no |
| `{ "caption": "..." }` | Changes the caption and does nothing else. | no |

Any step can carry `"caption"`, up to 90 characters. The caption stays until another replaces it;
`""` clears it. The bar shows two lines, and how much fits depends on the format: a square reel
holds far less than a landscape one, and the stamp and cut badge share the width. `prove` measures
every caption in the real bar before it films, beside the longest stamp and badge, and refuses a
caption that would be cut off, naming it. About 40 characters is safe in square.

An action (`click`, `type`, `press`, `upload`) can carry `"awaits": "/api/path"`: the request
the action has to cause. The run fails if no such request answers, or if it answers with an error.

### What makes a scenario prove something

- **Expect what only success shows.** "600 agents" is on the galaxy page before anyone searches,
  so waiting for it proves nothing. "Closest to" appears only when a search came back.
- **Prefer `awaits` when success is visual.** A camera flying across a map adds no text. The
  request that made it fly is the proof.
- **Click by the exact text.** "Search" is matched exactly before it is matched loosely, because
  "Search" once landed on a "Clear search" button and the reel filmed the query being wiped.
- **Read every number you intend to say.** A number in your copy is only allowed if a claim covers
  it, and the strongest claim is `{ "type": "proof", "fact": "agents", "equals": "600" }`.

### What makes a reel worth watching

- **Show the result, and hold on it.** The last hold is the longest. A reel that ends the moment
  the result appears has filmed the wait and skipped the point.
- **8 to 20 seconds.** Under 8 there was no time to read a caption. Over 20 the feature should
  have been two stories.
- **`square` for anything a phone user would do, `landscape` for a wide scene or a dashboard.** The
  page is laid out at a small logical width on purpose, so its controls come out large in the
  frame.
- **Captions say what the viewer cannot see:** what is happening and why it is hard. "Click
  Search" is a wasted caption. "Describe what you want in plain words" is not.
- **Waiting is not filmed.** Anything that waits on the network is cut, and the reel shows a badge
  saying how long was cut. Do not try to hide a slow feature. Say how long it takes.
- **Nothing is drawn over the product.** Captions, the cut badge and the stamp sit in a bar under
  the page. The stamp says which production commit was filmed and when.
- **Hide only what is not the subject.** Floating site chrome is hidden for you. `"hide":
  ["selector"]` on the scenario hides more. Never hide part of the feature to make it look better.
- **Keep chrome that is the subject.** The walk companion is hidden on every page, because it is
  chrome everywhere except on the pages about what it does. A story about Herald is a story about
  the companion, so its scenario says `"show": [".walk-companion"]`. `show` only accepts selectors
  the camera would otherwise hide.

## Filming it

```bash
npm run x:content -- prove --file data/x-content/stories/galaxy-search.json
```

It runs the scenario against production, films it, writes the reel to
`public/x-media/<id>/reel.mp4` and the proof to `data/x-content/proofs/<id>.json`, and puts the reel
on the head post. It prints each step, what the run read, and what the server answered. When a step
fails it saves a picture of the page as it was at that moment and prints where.

Then watch the reel. `prove` cannot tell you that the interesting part happened off screen. Pull a
few frames and look at them:

```bash
node_modules/ffmpeg-static/ffmpeg -ss 6 -i public/x-media/galaxy-search/reel.mp4 -frames:v 1 /tmp/frame.jpg
```

`--no-film` runs the steps without filming, which is the fast way to get a scenario passing before
you spend time on the film.

## Writing the post

The reel shows that it works. The post says why anyone should care.

- **The first 280 characters are the post.** That is what a reader sees before "Show more". Open
  with the strongest true statement and make those 280 stand on their own.
- **Say it as news, in plain words.** "Your three.ws avatar speaks sign language now" is the
  strongest opening on the account that tags no one. It names what is new, who it is for, and
  nothing else.
- **Then the mechanism.** How it works is the interesting part, and it is the part a competitor
  cannot copy from a screenshot.
- **Go long when there is more to say.** Posts over 280 characters measure about twice the likes
  of shorter ones on this account. Long is not padded: every sentence carries a fact.
- **A thread for the detail.** The head makes the point. One or two replies carry the numbers,
  the limits, and what to do next.
- **One link, to the surface.** Put it in the head or in the first reply. The queue measures both
  placements, so alternate: if the last story you wrote linked in the head, link this one in the
  reply.
- **No hashtags, no emoji, no dashes, no launch-deck openers, no hype words.** The
  [contract](./announce-voice.md) lists them, and the gate refuses them.
- **Nothing about price.** Say what $THREE does. Never what it will be worth.

## Claims

Every number, ordinal and absolute in your copy (first, only, every, never, fastest, instant, zero)
has to sit inside a claim, every claim has to quote your copy word for word, and every claim needs
evidence:

| Evidence | Passes when |
|---|---|
| `{ "type": "proof", "fact": "agents", "equals": "600" }` | the run read that fact off the screen (`contains` also works) |
| `{ "type": "proof", "fact": "agents", "min": 500 }` | the run read a number at least that high; use it for a count that grows, written as "more than 500" |
| `{ "type": "proof", "saw": "Closest to" }` | the run waited for that text and saw it |
| `{ "type": "proof", "responded": "/api/galaxy" }` | an action in the run awaited that request and it answered without an error |
| `{ "type": "page", "url": "https://three.ws/x", "contains": "..." }` | the live page contains the text |
| `{ "type": "file", "path": "src/x.js", "contains": "..." }` | a file in the repo contains the text |
| `{ "type": "module", "path": "src/x.js", "export": "LIST", "length": 15 }` | an export has that many entries |

A count that can change (agents, entries, downloads) will change. A fact cited exactly (`equals`,
`contains`, or bare) must read the same at every review, so when it moves the review fails and the
fix is to film again. A count that only grows is better written as a floor: "more than 500 agents",
cited with `min`, stays true and only fails if the live number drops below it. Prefer facts that
hold: a price set by a tier, a limit in the code, what a tool does.

When a post does state a count, give it a probe that runs seconds before the post goes out, so a
count that moved after the review holds the post instead of publishing it wrong. An `api` probe is
the only kind that runs then. The wardrobe post says "59 pieces", and its catalog is a JSON array:

```json
{ "type": "api", "name": "the catalog still holds the 59 pieces the post counts",
  "url": "https://storage.googleapis.com/three-ws-garments/garments/catalog.json",
  "expect": { "json": { "path": "length", "equals": 59 } } }
```

## What not to write

- **Anything that names a crypto project other than $THREE.** That includes a token, a launchpad,
  an exchange, or a protocol, in the copy, the captions, or visible in the frame. Those stories
  need the owner's approval before they are committed. Solana is the chain $THREE lives on and may
  be named. If the page you are filming shows third-party market data, stop and pick another.
- **A feature that did not pass its scenario.** Not with a weaker scenario, and not with the
  failing step removed.
- **A post about a page.** `/login`, `/pricing`, `/sitemap` are not stories.
- **A surface that was already announced.** `data/x-content/queue.json` lists what has gone out.
- **A promise.** No dates, no "coming soon", nothing the run did not show.

## When it is finished

```bash
npm run x:content -- adopt galaxy-search     # the story joins the queue as a draft
npm run x:content -- advance galaxy-search   # film if needed, review, and release if the policy allows
```

`advance` takes the story as far as it can go and stops at the first thing that needs a person,
saying what that is. `npm run x:content -- advance` with no name does it for every draft and every
item under review.
