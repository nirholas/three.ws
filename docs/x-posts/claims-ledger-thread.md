# X thread: claims-ledger

A thread for **@trythreews** on how the account itself is run: an AI-assisted pipeline that drafts
and reviews posts with a model, while deterministic code decides what is true, what is approved,
and whether a post already went out. It is the short companion to the AWS Builder Center article
[aws-builder-center-claims-ledger.md](../aws-builder-center-claims-ledger.md), and it stands on
its own for a reader who never opens that article.

**Thesis of this thread:** a model may draft and edit; it does not get to decide what is true.
Nothing else. No token talk, no roadmap, no claims about reach.

Posting is owner-gated per [`CLAUDE.md`](../../CLAUDE.md). This file is copy waiting for a human
to send.

**Every claim below was verified on 2026-10-08**, against the code in this repository or the live
site:

| Claim in the thread | Where it was verified |
|---|---|
| Every number, ordinal and absolute word must sit inside a declared claim with evidence; an uncovered number is blocking | [`api/_lib/x-content/editorial.js`](../../api/_lib/x-content/editorial.js) (`ABSOLUTES`, `claimProblems`), [`docs/x-content-pipeline.md`](../x-content-pipeline.md) |
| The checker runs both ways (a claim not in the copy also fails) | `claimProblems` in [`editorial.js`](../../api/_lib/x-content/editorial.js) |
| Machine Atlas run read 9 cylinders before the drag and 5 after | [`data/x-content/proofs/machine-atlas.json`](../../data/x-content/proofs/machine-atlas.json) (`facts.cylinders`, `facts.cylindersAfter`) |
| Page evidence is matched in a real browser after the text stops growing; no fuzzy match, no model | `createPageReader` and the `page` case in [`api/_lib/x-content/verify.js`](../../api/_lib/x-content/verify.js) |
| Every post the owner took down had passed the fact check | [`docs/x-content-pipeline.md`](../x-content-pipeline.md) ("Proof reels"), and the header of [`api/_lib/x-content/reel.js`](../../api/_lib/x-content/reel.js) |
| A post with no probe fails review; probe kinds; a command probe must exit 0; API probes run again before sending | `verifyItem`, `probeChecks`, `commandProbe` in [`verify.js`](../../api/_lib/x-content/verify.js); `preflight` in [`api/_lib/x-content/runner.js`](../../api/_lib/x-content/runner.js) |
| One to three frames a second in software; clock stepped 1/30 s; no reel when a step fails | header, `Take.frame` and `proveItem` in [`reel.js`](../../api/_lib/x-content/reel.js) (`DEFAULT_FPS = 30`) |
| A wait of 2 s or more is cut and labelled; the stamp names commit and day | `CUT_BADGE_AFTER_SEC = 2` and the stamp in `proveItem`, [`reel.js`](../../api/_lib/x-content/reel.js) |
| The Drive reply took about 6 seconds, and the reel shows it | [`data/x-content/proofs/drive-copilot.json`](../../data/x-content/proofs/drive-copilot.json) (`cuts`: 3.9 s and 6.3 s; `/api/chat` answered 200 in 6.8 s); the frame itself reads "cut 6 s" |
| Proof stores SHA-256 of scenario and video; expires after 14 days; exact facts must match, floors must hold | `scenarioHash`, `proofProblems`, `PROOF_MAX_AGE_DAYS = 14`, `factRules` in [`reel.js`](../../api/_lib/x-content/reel.js); `factDrift` in [`verify.js`](../../api/_lib/x-content/verify.js) |
| Drafter cites only harvested evidence, copied unchanged; failures fed back, up to 3 attempts; a failing draft is not written to the queue | `draftFindings`, `draftPost` (`attempts = 3`) in [`api/_lib/announce/draft.js`](../../api/_lib/announce/draft.js) |
| Editor scores six dimensions 1 to 5, returns JSON; a blocking issue or a score under 4 turns publish into revise | `SCORE_KEYS`, `SYSTEM`, `parseReview` in [`api/_lib/x-content/editor.js`](../../api/_lib/x-content/editor.js) |
| The editor can add a blocker, not remove one | `reviewItem` in [`api/_lib/x-content/review.js`](../../api/_lib/x-content/review.js): lint and verification blockers are collected independently of the editor |
| Five rungs, in that order; Groq is text-only; no-credential rungs skipped; errors and unparseable replies fall through | `modelRungs`, `viaChatCompletions`, `callModelChain` in [`api/_lib/x-content/llm.js`](../../api/_lib/x-content/llm.js) |
| All 52 review records name the last rung; the records span three weeks | counted over [`data/x-content/reviews/`](../../data/x-content/reviews/): 52 tracked files, every `editor.model` is `nvidia:moonshotai/kimi-k3`, `reviewedAt` runs from 2026-09-18 to 2026-10-08; every record's `editor.fallbacks` lists OpenRouter 402 and OpenAI 429 `billing_not_active`, plus Vertex 403 (32) or no Google Cloud credentials (20) |
| Review bound to a SHA-256 of copy, media bytes, alt text, claims, mentions and probes; 14-day expiry | `contentHash`, `approvalProblems`, `REVIEW_MAX_AGE_DAYS = 14` in [`review.js`](../../api/_lib/x-content/review.js) |
| On 8 October the validator refused two approved posts, at 17 and 19 days | output of `npm run x:content:check` run on 2026-10-08 (items `galaxy` and `ai-3d-skills`) |
| Ledger writes every media id and post id as X returns it; a crashed thread resumes at the next reply | `uploadOnce`, `publishPosts`, `publishItem` in [`api/_lib/x-content/publisher.js`](../../api/_lib/x-content/publisher.js) |
| Policy release conditions; veto window; ops alert | `policyBlockers`, `vetoUntil` in [`api/_lib/x-content/approval.js`](../../api/_lib/x-content/approval.js); `advance` in [`scripts/x-content.mjs`](../../scripts/x-content.mjs) |
| Outcomes read at most every 6 hours over 90 days; used for ranking only | `OUTCOMES_REFRESH_HOURS = 6`, `OUTCOMES_WINDOW_DAYS = 90` in [`api/_lib/x-content/outcomes.js`](../../api/_lib/x-content/outcomes.js); read by [`priority.js`](../../api/_lib/x-content/priority.js) and as editor calibration, by no deterministic check |
| An engagement-ask phrase in the lint blocks the example post in our own docs | `PUSHY_CTAS` (`/\bdrop a\b/i`) in [`editorial.js`](../../api/_lib/x-content/editorial.js) against the "Queue item format" example in [`docs/x-content-pipeline.md`](../x-content-pipeline.md); reproduced with `lintItem` on 2026-10-08 |
| The docs page is live | [three.ws/docs/x-content-pipeline](https://three.ws/docs/x-content-pipeline) answered 200 and rendered "The editorial bar" on 2026-10-08 |

The thread also passes the pipeline's own offline gate: every post was run through
`languageProblems` and `copyProblems` (no findings, maximum 1000), and the ten posts with 22
declared claims were run through `claimProblems` (no findings), with every `file` evidence string
confirmed present.

**Re-run before posting.** Three numbers are true of a day, not of the code: the 52 review records,
the "two, at 17 and 19 days" refusal, and "three weeks". Before sending, re-count with:

```bash
npm run x:content:check
node -e 'const fs=require("fs");const d="data/x-content/reviews/";const m={};for(const f of fs.readdirSync(d)){const r=JSON.parse(fs.readFileSync(d+f));m[r.editor?.model]=(m[r.editor?.model]||0)+1}console.log(m)'
```

If either has moved, change the copy to today's numbers or cut the sentence.

**Things to NOT claim:**

1. **Do not say the pipeline runs on AWS or uses Amazon Bedrock.** It runs on Google Cloud Run, and
   the model chain is the five providers in `llm.js`.
2. **Do not call the account autonomous or unattended.** Tier 1 posts, any post that tags an
   account, and any editor override wait for a person; policy releases sit in a veto window.
3. **Do not say a reel proves the feature works in general.** It proves the steps passed once, on
   the commit and day in its stamp.
4. **Do not tie the learning loop or any model to $THREE, price, or volume.** Say it learns from
   the account's own measured posts. Nothing about pool volume belongs in this thread.
5. **Do not say the lint has no false positives, or that the lint is AI.** It is regular
   expressions, and post 10 says so.
6. **Do not say "verified AWS Partner" here.** The live [three.ws/aws](https://three.ws/aws) page
   says "AWS Partner", and nothing in this thread needs the credential.
7. **Do not give slot times or say when the account posts.** The minutes are an HMAC under a
   production-only seed on purpose.
8. **Do not say Claude reviewed these posts.** Every committed review record was written by Kimi
   K3 on NVIDIA NIM; Claude is the top rung, not the rung that answered.

---

## The thread

**Post 1 (head)** (470 weighted characters, image: `reel-stamp.png`)

> This feed is written with AI help, and no post goes out on a model's word.
>
> Every number, ordinal and absolute word in a post has to sit inside a declared claim, and every claim carries evidence a program re-checks at review: a quote from the live page, a line in our source, or a fact read off the screen while a run of the feature was filmed. A number with no claim behind it is a blocking error, so it does not ship.
>
> Here is how that works, and where it falls short.

**Post 2** (556 weighted characters)

> A claim quotes our own copy and names its evidence. "Nine cylinders to five" in the Machine Atlas post cites two facts the filmed run read off the page: 9 cylinders before a slider drag, 5 after.
>
> The checker runs both ways. A number the copy states that no claim covers fails review, and so does a claim whose words are no longer in the copy, so a verified claim cannot stay behind while the sentence changes.
>
> Page evidence is matched against the page rendered in a real browser, after its text stops growing. No fuzzy matching and no model in that loop.

**Post 3** (474 weighted characters)

> A quote proves a page says something. It does not prove the feature does it, and every post we have taken down had passed that check.
>
> So a post also needs a probe, or its review fails: an API call with an expected status or JSON value, a scripted browser session, a repo test that has to exit 0, or the post's own filmed scenario. API probes run a second time seconds before the post is sent, so a page that broke after review holds the post instead of publishing it wrong.

**Post 4** (538 weighted characters, image: `reel-cut.png`)

> The video on a feature post is a filmed test run against production, not a screen recording.
>
> With no GPU, a headless browser renders WebGL at one to three frames a second, so the camera takes over the page clock and steps it 1/30 s at a time, one screenshot per step. If any step fails, no reel is made.
>
> A wait on the network of 2 seconds or more is cut and labelled in the bar under the page, and a stamp names the production commit and the day it was filmed. In this frame the agent's reply took about 6 seconds, and the reel says so.

**Post 5** (437 weighted characters)

> The proof record stores a SHA-256 of the scenario and of the video file. Edit a step or swap the clip and the post stops validating, and a proof expires after 14 days.
>
> At review the scenario runs again without the camera. A number the post states exactly has to read the same as in the reel. A number stated as a floor ("more than 500") only has to stay at or above it, so a count that grows does not send a true post back to be filmed.

**Post 6** (557 weighted characters)

> Two jobs use a model: drafting from an evidence brief, and the editorial review.
>
> The drafter may only cite evidence that was harvested from the live page or a repo file before it wrote a word, copied unchanged. Its failures are fed back verbatim for up to 3 attempts, and a draft that still fails is never written into the queue.
>
> The editor scores six dimensions from 1 to 5 and returns JSON. Code enforces the verdict, not the model: a blocking issue or any score under 4 turns "publish" into "revise". The editor can add a blocker. It cannot remove one.

**Post 7** (651 weighted characters)

> The model chain has five rungs: Claude on Vertex AI, gpt-oss-120b on Groq (text only, so a review that must see images skips it), Claude through OpenRouter, OpenAI, and Kimi K3 on NVIDIA NIM. A rung with no credentials is skipped, and one that errors or returns something unparseable falls through.
>
> Each review record names the model that wrote it. All 52 records in the repo today name the last rung, because each rung above it was either skipped or failing on billing or credentials. The review bar kept running through three weeks of that, which is the problem: the chain needs an alert when the rung that answered is not the one that should have.

**Post 8** (488 weighted characters, image: `editorial-bar.png`)

> A passing review is bound to a SHA-256 of the copy, every media file's bytes, the alt text, the claims, the mentions and the probes. Change one word and the approval is void. Reviews expire after 14 days, and the validator refuses an approved post whose review is stale: on 8 October it refused two, at 17 and 19 days.
>
> The publish ledger writes each media id and post id the moment X returns it, so a thread cut off by a crash resumes at the next unposted reply instead of posting twice.

**Post 9** (495 weighted characters)

> A post is released without a person only if its tier allows it, it was filmed and the proof covers it, it tags no one, and the editor passed it on its own verdict rather than on an override. Even then it waits out a veto window, and the release goes to our ops alerts.
>
> The queue also reads its own posts back through the X API, at most every 6 hours, and learns what media, length and threads were worth over 90 days. That changes which ready post fills a slot. No deterministic check reads it.

**Post 10** (454 weighted characters)

> What this does not prove: a reel shows the steps passed once, on the commit and the day in its stamp. Not on your phone, not under load, not next month, which is why the stamp is there and the record expires.
>
> The voice lint is regular expressions, and it has false positives: one of its engagement-ask phrases also blocks the example post in our own docs.
>
> The whole pipeline, every rule above, and its tests are documented here: three.ws/docs/x-content-pipeline
---

## Reply to append once the AWS article is live

Post this as a reply to post 10 only after the AWS Builder Center article is published. Whoever
publishes it pastes the article's canonical Builder Center URL after the colon at the end of the
line. With the URL counted as 23, it is 160 weighted characters.

> The full write-up of this thread is now on the AWS Builder Center, with the code behind each check and the limits we have not fixed yet:

---

## Media plan

Three real images, all in [`public/x-media/claims-ledger-thread/`](../../public/x-media/claims-ledger-thread/).
Each one was looked at before it was chosen. Two are single frames cut from proof reels already in
the repository; one is a screenshot of a live three.ws page.

| Post | File | What it shows | Size |
|---|---|---|---|
| 1 (head) | `reel-stamp.png` | Frame at 11 s of the Docs World reel (`public/x-media/docs-world/reel.mp4`), with the caption and the production stamp in the bar | 1280 x 720 |
| 4 | `reel-cut.png` | Frame at 9 s of the Drive reel (`public/x-media/drive-copilot/reel.mp4`), while the `cut 6 s` badge is showing | 1280 x 720 |
| 8 | `editorial-bar.png` | Playwright screenshot of [three.ws/docs/x-content-pipeline](https://three.ws/docs/x-content-pipeline) scrolled to "The editorial bar", taken 2026-10-08 at 1280 x 720 and device scale 1.5, cropped to remove a half-cut table row | 1920 x 990 |

Alt text, ready to paste (X sends it as media metadata):

**reel-stamp.png**

> A frame from the filmed Docs World run on three.ws: glowing pavilions on a dark ring, a trail of arrows leading to the Creation studios pavilion, and a card offering the Forge page. The bar under the page reads "Shift+Enter lays a trail to the pavilion that holds the page" and is stamped "live on three.ws @ f2081d946, 2026-09-29".

**reel-cut.png**

> A frame from the filmed Drive run: a 3D avatar in red headphones and round sunglasses has answered the question "What should I listen to on a long drive?" with "For a long drive, something with a steady...". The bar under the page shows the caption, a yellow "cut 6 s" badge, and the stamp "live on three.ws @ f2081d946, 2026-09-29".

**editorial-bar.png**

> The three.ws docs page for the X content pipeline, open at "The editorial bar": a paragraph saying nothing can be approved until a review passes and that the record is bound to a hash of the copy, media bytes, alt text, claims and mentions, above a table of review layers (voice lint, editorial lint, media quality, live verification), each linked to its source file.

How the frames were cut, so they can be re-cut if a reel is re-filmed:

```bash
node_modules/ffmpeg-static/ffmpeg -ss 11 -i public/x-media/docs-world/reel.mp4 -frames:v 1 public/x-media/claims-ledger-thread/reel-stamp.png
node_modules/ffmpeg-static/ffmpeg -ss 9 -i public/x-media/drive-copilot/reel.mp4 -frames:v 1 public/x-media/claims-ledger-thread/reel-cut.png
```

Both reels were filmed on 2026-09-29. The queue's media rule treats a captured frame older than 21
days as stale, so if this thread goes out after 2026-10-20, re-film the reels (`npm run x:content
-- prove docs-world` and `prove drive-copilot`) and cut new frames, and update the commit and date
in the alt text to match the new stamp.

## Notes on framing

- **Lead with the rule, not the tooling.** "No post goes out on a model's word" is the claim a
  reader can hold us to. The reels, hashes and ledgers are how we keep it.
- **Post 7 is the limit, and it should stay in.** A thread about refusing unverifiable claims that
  hides its own failover outage would be the exact failure it describes.
- **One link, at the end.** Every other post carries mechanism instead of a link, which matches the
  one-link rule the pipeline enforces on its own posts.
- **The AWS article goes deeper** on the code and on what we would build differently. Link it only
  in the appended reply, never in the head.
