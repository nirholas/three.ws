---
title: "The claims ledger: an AI-assisted publishing pipeline that refuses to post what it cannot prove | three.ws on AWS"
venue: AWS Builder Center
account: three.ws (official organization account, byline "three.ws")
status: draft, owner approval required before publishing (external-channel gate in CLAUDE.md)
description: "How three.ws runs its X account from a reviewed queue where a language model may draft and edit, but deterministic code decides what is true: a claims ledger that holds every number and absolute word to checked evidence, probes that prove a feature works, proof reels filmed against production, a model failover chain, review records bound to a content hash, an idempotent publish ledger, and a learning loop that only changes the order posts go out in."
tags: [generative-ai, agentic-ai, llm, automation, open-source]
index: docs/aws-builder-center.md
---

# The claims ledger: an AI-assisted publishing pipeline that refuses to post what it cannot prove

A language model can write a competent product announcement in seconds. That is no longer the hard part of running a company account. The hard part is that a fluent, wrong sentence from a company account costs more than no sentence, and fluent sentences whose relationship to the product is approximate are exactly what a model produces when nothing holds it to the product.

We run the [@trythreews](https://x.com/trythreews) account for [three.ws](https://three.ws), an open-source (Apache-2.0) platform for 3D AI agents, from a reviewed queue. A model drafts posts from an evidence brief, and a model reviews every post before it can be approved. Neither decides whether a post is true. The principle, stated once so the rest of this article can be about mechanism: **a model may draft and edit; deterministic code decides what is true, what is approved, when it posts, and whether it already posted.** Every claim below points at readable source in [the repository](https://github.com/nirholas/three.ws), because an article about refusing unverifiable claims should be checkable in the same sitting.

**Status, plainly, because AWS builders check.** three.ws is a verified AWS Partner. This pipeline does not run on AWS: the platform's runtime is on Google Cloud Run, the publishing tick is a Cloud Scheduler job calling an HTTP handler every 15 minutes, and the ledger lives in Postgres. The model chain's providers are exactly the five that [`api/_lib/x-content/llm.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/llm.js) lists: Claude on Vertex AI, gpt-oss-120b on Groq, Claude through OpenRouter, OpenAI, and Kimi K3 on NVIDIA NIM. There is no Amazon Bedrock rung today. Nothing in the design depends on where it runs, and section 14 maps the pieces onto AWS services for anyone lifting them.

**Contents**

1. The gap a fact check leaves open
2. The pipeline in one picture
3. The claims ledger
4. Probes: proving the feature works, not that the page loads
5. Proof reels: a camera that cannot film a failure
6. Where the models sit, and what they may not decide
7. The model chain, and what failover looked like in practice
8. The voice lint: cheap, deterministic, and sometimes wrong
9. Review records bound to a content hash
10. The publish ledger: retries that cannot double-post
11. An unreadable schedule, and the approval policy
12. The learning loop, and the limits of what it learned
13. What we would build differently
14. What to lift from this
15. Try it

---

## 1. The gap a fact check leaves open

The first version of this pipeline had a good fact check. Every number in a post had to quote a page on the live site, and the check confirmed the quote was there. It caught real errors: one early post said a tool recognised 11 rig conventions when the live page and the code both said 15.

Posts were still taken down, and the pipeline's documentation records the uncomfortable pattern: every post the owner had taken down had passed the fact check. The copy matched the page. The feature did not live up to the page. A quote proves that a page *says* something; it cannot prove that the product *does* it.

The design that follows closes that gap in layers, cheapest first: an offline lint that costs nothing, live evidence checks that cost a browser, feature probes and filmed runs that cost minutes, and a model review that costs a model call. A post that fails a cheap layer never pays for an expensive one, and a post that passes gets a record bound to the exact bytes that passed.

## 2. The pipeline in one picture

```
story file (scenario + copy + claims)
        |  prove: run the scenario against production, film it, write a proof record
        v
queue item  -->  check: voice lint, editorial lint, claims ledger (offline)
        |
        |  review: live evidence, probes, links, mentions, spelling, AI editor
        v
review record (bound to a SHA-256 of the item)  -->  approval: owner, or policy
        |
        v
scheduler tick (every 15 min)  -->  pre-flight: links + API probes again
        |
        v
publisher  -->  publish ledger (every X id written the moment it exists)
        |
        v
outcomes: read the account's own posts back, learn, re-rank the queue
```

The queue is one JSON file, [`data/x-content/queue.json`](https://github.com/nirholas/three.ws/blob/main/data/x-content/queue.json). On 8 October 2026 it held 54 items (45 posts and 9 long-form X Articles) carrying 678 declared claims, 1,031 pieces of evidence, and 127 feature probes. The operator CLI and the production cron call the same validator, so "passes locally" and "publishable in production" are one rule.

## 3. The claims ledger

Every number, ordinal and absolute word in the copy must sit inside a declared **claim**. A claim quotes the copy and carries at least one piece of **evidence** a program can re-check. The detector for absolute words is one regular expression in [`api/_lib/x-content/editorial.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/editorial.js):

```js
export const ABSOLUTES = /\b(?:first|only|fastest|largest|biggest|best|leading|never|always|every|no one|nobody|zero|unlimited|instant(?:ly)?|world['’]s|#1|number one)\b/gi;
```

Numbers are found the same way, with exceptions for names that contain digits ("3D", "GPT-5"). Then the ledger is checked in both directions:

```js
const covered = (fragment) => claims.some((claim) => String(claim.says || '').toLowerCase().includes(fragment.toLowerCase()));
for (const text of texts) {
	const { numbers, absolutes } = assertionsIn(text);
	for (const number of numbers) if (!covered(number)) problems.push({ rule: 'claims', severity: 'blocking', message: `"${number}" is an unverified number; declare it in claims with evidence` });
	for (const word of absolutes) if (!covered(word)) problems.push({ rule: 'claims', severity: 'blocking', message: `"${word}" is an absolute; declare the claim it makes, with evidence, or cut it` });
}
```

An uncovered number is blocking. So is a claim whose `says` is not in the copy, and a claim with no evidence. The second direction matters more than it looks: without it, the verified claim can stay in the ledger while the copy quietly says something else.

Here is a real claim from the Machine Atlas post (a Labs page that builds a radial engine from code). The copy says "Nine cylinders to five", and the claim cites two facts a filmed run read off the page:

```json
{
  "says": "Nine cylinders to five",
  "evidence": [
    { "type": "proof", "fact": "cylinders", "equals": "9" },
    { "type": "proof", "fact": "cylindersAfter", "equals": "5" }
  ]
}
```

[`api/_lib/x-content/verify.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/verify.js) checks each evidence type at the moment of review:

| `type` | Passes when |
|---|---|
| `page` | The live page, rendered in a real browser, contains the quoted text |
| `file` | A repository file contains the text, or matches a regular expression |
| `module` | A module's export has a stated length, or equals a stated value |
| `github-issue` / `github-issues` | An issue has a stated state and label, or a repository has at least N matching issues |
| `proof` | The filmed run read the fact off the screen, waited for a text, or got an answer from a named request |

The `page` check renders the page in Chromium through Playwright, waits for network idle, then polls once a second until the body text stops growing, because a client-rendered page can still be empty at network idle. The match is word for word after collapsing whitespace and ignoring case, and nothing looser: no fuzzy matching, no embeddings, no model in the loop.

```js
case 'page': {
	const { status, text } = await pages.text(evidence.url);
	if (status < 200 || status >= 300) return { ...base, ok: false, detail: `page answered HTTP ${status}` };
	const found = text.includes(normalize(evidence.contains));
	return { ...base, ok: found, detail: found ? `live page shows "${evidence.contains}"` : `live page does not show "${evidence.contains}"` };
}
```

## 4. Probes: proving the feature works, not that the page loads

A claim proves the copy. A **probe** proves the feature. A post with no probe fails review with "no feature probe declared; add one to `probes` that proves the feature works, not just that its page loads". Four kinds exist:

| `type` | Passes when | Runs |
|---|---|---|
| `api` | A URL answers 2xx (or an expected status), optionally with a text or a JSON value at a path | at review, and again seconds before publishing |
| `browser` | A scripted session (`goto`, `click`, `expect`) reaches the expected text | at review |
| `command` | A repository test that exercises the claimed behaviour exits 0 | at review |
| `scenario` | The post's filmed scenario passes against production again, and its facts still match | at review |

The `api` probe is cheap and dependency-free enough to run in production, which is why it runs twice. A post that states a count from a live catalog carries a probe on the catalog's JSON length; if the count moved after review, the pre-flight fails and the post is held instead of published wrong.

One lesson from running this: click by exact text before partial text. A step that said "Search" once resolved to a "Clear search" button earlier in the page, and the run filmed the query being wiped instead of run.

## 5. Proof reels: a camera that cannot film a failure

The strongest probe is the one whose output is also the post's media. A **scenario** is a list of steps a person would take on the live site: go to a page, type, click a control by its text, drag across a 3D scene, wait for a text that only appears on success, and read a fact off the screen with a pattern. [`api/_lib/x-content/reel.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/reel.js) runs those steps against production and films them, so one list is the probe, the video, the captions and the evidence at once. If a step fails, no reel is encoded, and a post without its reel does not validate.

**The page clock is stepped, not recorded.** The filming machines have no GPU, and a headless browser renders WebGL in software at one to three frames a second; a screen recorder pads that by repeating frames, which reads as a slide show. So the runner pauses Playwright's page clock and advances it one frame at a time:

```js
async frame() {
	await this.pause();
	await this.page.clock.runFor(this.frameMs);
	if (this.badgeFrames > 0 && --this.badgeFrames === 0) await this.bar.set({ badge: '' });
	if (!this.film) return;
	const shot = await this.page.screenshot({ type: 'png', scale: 'device', timeout: 60_000 });
	// Motion is measured on the product alone, so a caption changing never
	// counts as the feature doing something.
	const hash = createHash('sha1').update(shot).digest('hex');
	if (this.lastHash && hash !== this.lastHash) this.changes++;
	this.lastHash = hash;
	const frame = await this.compose(shot, this.bar.shot, this.size);
	writeFileSync(join(this.framesDir, `f${String(++this.count).padStart(6, '0')}.jpg`), frame);
}
```

Every frame is distinct and exactly 1/30 s of page time apart; the machine's speed only decides how long filming takes. The Machine Atlas reel is 477 frames and 15.9 seconds, and one drag step in it filmed 84 frames in 55.2 seconds of wall time. A browser flag made this practical: with the page composited through the same software Vulkan device as the 3D scene, one frame of a plain list page measured 3.5 to 15 seconds, and with GPU compositing and rasterization disabled it takes about 250 ms while WebGL still runs on SwiftShader.

**Waiting is cut and labelled.** Network waits run on the real clock with the camera off. A wait of 2 seconds or more puts a badge such as `cut 6 s` in the bar for the next 45 frames, so a slow feature is shown as slow. The Drive reel, where an agent answers a spoken question, records cuts of 3.9 and 6.3 seconds and a chat request that answered 200 in 6.8 seconds.

**Nothing is drawn over the product.** Captions, the badge, and a stamp reading `live on three.ws @ <commit>, <date>` sit in a bar under the page. The commit comes from the site's own [`/api/version`](https://three.ws/api/version) endpoint at filming time. Only the pointer is drawn on the page.

**The proof is bound to the post.** The proof record stores hashes of the scenario and of the encoded file, and production checks them without a browser:

```js
if (proof.scenarioHash !== scenarioHash(item.scenario)) problems.push('the scenario changed after it was filmed; prove it again');
const age = (now - Date.parse(proof.ranAt)) / 86_400_000;
if (age > PROOF_MAX_AGE_DAYS) problems.push(`the reel was filmed ${Math.floor(age)} days ago; the product moves, so film it again`);
```

Change a step, swap the file, or let 14 days pass, and the item no longer validates. A reel in which fewer than 15% of frames change is refused too: it is a still with a progress bar, and a still image is the honest format for it.

**Reviews run it again, and hold each fact to how the copy used it.** A fact cited exactly must read today what the reel shows. A fact cited as a floor (`min`) only has to stay at or above it, so a growing count does not send a true post back to be filmed. A fact no claim cites may move freely, because the reel is stamped with its day.

```js
for (const [name, rule] of Object.entries(factRules(item))) {
	const filmed = proof?.facts?.[name];
	const live = facts[name];
	if (rule.exact && live !== filmed) problems.push(`${name} is now "${live}", the reel shows "${filmed}"`);
	if (Number.isFinite(rule.min) && !(factNumber(live) >= rule.min)) problems.push(`${name} is now "${live}", under the floor of ${rule.min} the post claims`);
}
```

That exact-versus-floor distinction is the most reusable idea here. It forces the author to decide whether a number is a fact about today or a promise about a minimum, and the checker holds them to that decision.

## 6. Where the models sit, and what they may not decide

Two jobs call a model, and both are fenced the same way: the model proposes, deterministic code judges.

**The drafter** ([`api/_lib/announce/draft.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/announce/draft.js)) writes a post from an evidence brief: lines harvested from the live page and from repository files before a word is written. Its claims may cite only those candidates, copied exactly, and code enforces it, because a paraphrased candidate is a claim the verifier will fail on the live page:

```js
const allowed = new Set((brief.evidenceCandidates || []).map(candidateKey));
for (const claim of draft.claims) {
	for (const evidence of claim.evidence || []) {
		if (!allowed.has(candidateKey(evidence))) {
			findings.push(`claims: evidence ${JSON.stringify(evidence).slice(0, 120)} is not one of the brief's evidenceCandidates; copy a candidate exactly or drop the claim`);
		}
	}
}
```

Each draft runs through the queue's own lints and claims ledger. Findings go back to the model verbatim, up to 3 attempts. A draft that still fails is returned with its findings rather than written into the queue; the module's comment says it "never decides that something is good enough". The drafter cannot invent a fact, only choose among facts a program already harvested.

**The editor** ([`api/_lib/x-content/editor.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/editor.js)) judges what a lint cannot: whether the first line earns the second, whether the image shows what the copy claims, whether a sentence is literally true but misleading. It sees the copy, images, alt text, the claims with every live verification result, the house voice contract, and the account's best-measured posts for calibration. It cannot watch video, so for a reel it gets four still frames, the captions, and the run record, and is asked whether each caption is true of its frame. It returns a verdict, six scores from 1 to 5 (accuracy, clarity, specificity, voice, professionalism, visual), quoted issues with fixes, and a rewrite. The model does not get the last word on its own verdict:

```js
// The model does not get the last word on its own verdict: a blocking issue
// or a low score always means revise.
if (review.verdict === 'publish' && (review.issues.some((issue) => issue.severity === 'blocking') || SCORE_KEYS.some((key) => review.scores[key] < 4))) {
	review.verdict = 'revise';
}
```

Its rewrite is linted like any draft, with every uncovered number or absolute listed for the human. That rule has a history: an early AI rewrite upgraded our partner credential to stronger wording than the evidence for that post supported, and the review bar caught it. A model that "improves" copy reaches for the more impressive phrase that still sounds true. The editor's prompt now names that exact upgrade as forbidden, and the pipeline never applies a rewrite: the editor never edits the queue, and a person adopts its suggestion or does not.

The asymmetry is deliberate: **the editor can add a blocker, but it cannot remove one.** A failed fact check or blocking lint finding fails the review whatever the model says. A human who disagrees with a `revise` that carries no blocking issue can record an `editorOverride` with a reason, and the approval policy (section 11) then refuses to release that post without a person.

## 7. The model chain, and what failover looked like in practice

Both jobs share one transport, an ordered list of rungs:

```js
export function modelRungs(request, env = process.env) {
	return [
		() => viaVertex(request),
		() => viaChatCompletions(request, { url: 'https://api.groq.com/openai/v1/chat/completions', key: env.GROQ_API_KEY, model: 'openai/gpt-oss-120b', label: 'groq', textOnly: true }),
		() => viaChatCompletions(request, { url: 'https://openrouter.ai/api/v1/chat/completions', key: env.OPENROUTER_API_KEY, model: `anthropic/${EDITOR_MODEL}`, label: 'openrouter', extraHeaders: { 'http-referer': 'https://three.ws', 'x-title': 'three.ws editorial review' } }),
		() => viaChatCompletions(request, { url: 'https://api.openai.com/v1/chat/completions', key: env.OPENAI_API_KEY, model: 'gpt-5.5-pro', label: 'openai' }),
		() => viaChatCompletions(request, { url: 'https://integrate.api.nvidia.com/v1/chat/completions', key: env.NVIDIA_API_KEY, model: 'moonshotai/kimi-k3', label: 'nvidia', maxTokens: RUNG_MAX_TOKENS }),
	];
}
```

Four rules make it behave. **A rung with no credentials returns `null` and is skipped.** **A text-only rung refuses a request that carries an image**: Groq sits high because it is fast and serves the drafter's text brief, while a review that must see its media skips it and so never gets an image-blind verdict from that rung. **A parse failure is a rung failure**: the caller passes a `parse` function, and prose where JSON was requested falls through to the next rung. **Retries are classified, not blind**: a dropped connection, a 5xx or a plain 429 gets 3 attempts with a growing pause, while a 429 about billing will only repeat, so it falls through at once:

```js
export function isRetryable({ status = null, body = '', networkError = false } = {}) {
	if (networkError) return true;
	if (status >= 500) return true;
	return status === 429 && !/billing|credit|quota|insufficient|not active/i.test(String(body));
}
```

Every review record names the model that wrote it and the failure of every rung above it, which turned out to be the most useful field in the record. All 52 review records committed on 8 October name the last rung, Kimi K3 on NVIDIA NIM. Every one lists OpenRouter answering 402 (out of credits) and OpenAI answering 429 with `billing_not_active`; 32 list Vertex answering 403 for insufficient authentication scopes, and the other 20 found no Google Cloud credentials on the reviewing machine. The bar never stopped, because the chain did its job. The chain also hid, for the three weeks those records span, that three of its four paid rungs were unusable. Section 13 returns to that.

## 8. The voice lint: cheap, deterministic, and sometimes wrong

Formatting rules do not make a post true, but they keep a feed from reading as generated, and they cost nothing. [`quality.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/quality.js) rejects launch-deck openers ("Introducing", "We're excited"), hype phrases, hashtags, emoji, en and em dashes, stacked exclamation marks, and shouting. [`editorial.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/editorial.js) adds brand spelling, anything that reads as a price promise or investment pitch, slang, marketing filler, engagement begging, rhetorical-question openers, more than one link, and media rules (images under 1200 px wide, alt text under 40 characters).

Two rules came from the platform rather than taste. Length is measured as X measures it: every URL counts 23 characters, including a bare domain X decides to link, a lesson from the first test post, where X linked the brand name "three.ws" and created a second link the one-link rule never saw. And X refuses a post with more than one cashtag with a 403 no retry can fix, so that rule moved left into the lint, where it fails at review with a message saying what to write instead.

The honest part: a regular-expression lint has false positives. The engagement-ask list bans "drop a" (as in "drop a comment"), and the same rule blocks "Drop a .glb on Rig Doctor", the sentence our own pipeline documentation uses as its example post. "Awesome" is banned as filler, which made a post about a surface named Awesome 3D Agents unwritable until the rule learned to ban the adjective and keep the proper noun. Deterministic rules are worth their false positives, because a false positive is visible, specific and fixable in a one-line diff, while a model's inconsistent judgment is none of those. They need an escape hatch with a paper trail: the glossary for spelling, the editor override for judgment.

## 9. Review records bound to a content hash

`npm run x:content -- review <id>` runs every layer and writes `data/x-content/reviews/<id>.json`. An item can only be `approved` while a passing record exists whose hash matches the item as it is now. From [`api/_lib/x-content/review.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/review.js):

```js
const subject = {
	kind: item.kind,
	posts: (item.posts || []).map((post) => ({ text: String(post.text || '').trim(), media: (post.media || []).map(media) })),
	article: item.kind === 'article'
		? { title: item.article?.title, body: fileHash(root, item.article?.body), cover: item.article?.cover ? media(item.article.cover) : null, images: articleImages(root, item).map(media) }
		: null,
	claims: item.claims || [],
	mentions: item.mentions || {},
	probes: item.probes || [],
	// Absent on an item with no scenario, so the hash of every item reviewed
	// before scenarios existed is unchanged.
	scenario: item.scenario,
};
return createHash('sha256').update(JSON.stringify(subject)).digest('hex');
```

`media` hashes each file's bytes with its alt text and video probe, so swapping an image is as visible as editing a word, and an Article's inline images are hashed even though the Markdown that names them did not change. The `scenario` comment is a lesson of its own: adding a field to a hashed subject silently invalidates every record ever written, unless the field is absent when unused.

A record also expires after 14 days, because facts drift, and the production cron enforces both rules from the records shipped in the container image. On 8 October, `npm run x:content:check` refused two approved posts outright because their reviews were 17 and 19 days old; a scheduled tick skips them the same way. The hash also drives holds: a post that fails pre-flight is held against its hash, and any edit releases the hold at once, because a new hash means somebody fixed something.

## 10. The publish ledger: retries that cannot double-post

The most embarrassing automation failure on a social account is a thread posted twice because a job retried. The publisher writes every identifier X returns to a ledger the moment it exists, and consults it before every call. From [`api/_lib/x-content/publisher.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/publisher.js):

```js
for (let index = 0; index < posts.length; index++) {
	if (progress.postIds[index]) continue;
	const post = posts[index];
	const mediaIds = [];
	for (const media of post.media || []) mediaIds.push(await uploadOnce({ client, root, media, progress, persist }));
	const payload = { text: post.text.trim() };
	if (mediaIds.length) payload.media = { media_ids: mediaIds };
	const replyTo = index === 0 ? null : progress.postIds[index - 1];
	if (replyTo) payload.reply = { in_reply_to_tweet_id: replyTo };
	if (index === 0 && quoteId) payload.quote_tweet_id = quoteId;
	const { data } = await client.tweet(payload);
	progress.postIds[index] = data.id;
	await persist();
}
```

A crash between the third and fourth reply resumes at the fourth, threaded under the third's real id. Media ids are cached and re-uploaded only after 23 hours, inside X's 24-hour expiry. An Article's draft id and published id are persisted separately, so a crash between the two never creates a second draft. A half-published item resumes ahead of every pacing rule on the next tick and skips pre-flight, because finishing what was started matters more than re-checking it.

The ledger is one row in a Postgres `app_settings` table, shared by the cron and the CLI, and both take the same lease lock:

```sql
INSERT INTO app_settings (key, value)
VALUES (${LOCK_KEY}, jsonb_build_object('until', extract(epoch from now()) + ${LOCK_TTL_S}))
ON CONFLICT (key) DO UPDATE
	SET value = excluded.value, updated_at = now()
	WHERE (app_settings.value->>'until')::numeric < extract(epoch from now())
RETURNING key
```

The `WHERE` on the conflict branch lets a caller take the row only when the previous lease has expired, and `RETURNING` says whether it won. The lease is 900 seconds, longer than the slowest video processing. The CLI refuses to publish without a database connection, because a publish with no shared ledger is the one way to get a double post.

Failures are classified like the model chain's. A post-specific refusal (a 4xx such as a duplicate) holds that post for 2 hours, then 6, then 24, and the slot goes to the next-best post in the same tick, up to 5 attempts. A refusal of the account (401, 402 for spent API credits, or a non-duplicate 403) stops the tick, because every post would fail the same way, and raises one critical alert a day naming what a person must fix.

## 11. An unreadable schedule, and the approval policy

The queue is a committed file in a public repository, so the day an item is eligible is public by construction. If the posting minute were a plain hash of the item id, it would be public too, and an announcement whose minute is knowable days ahead can be camped. So the jitter is an HMAC under a seed that exists only in production:

```js
export function jitterMinutes(id, windowMinutes, seed = null) {
	const digest = seed
		? createHmac('sha256', String(seed)).update(String(id)).digest()
		: createHash('sha256').update(String(id)).digest();
	return digest.readUInt32BE(0) % Math.max(1, windowMinutes);
}
```

The HMAC is stable per slot, so a preview, a retry and the real tick agree on the minute, while nobody without the seed can compute it. Without the seed it falls back to the public hash, which keeps tests deterministic, and the planning command says its minutes are placeholders. Which post fills a slot is decided when the slot opens, so a correct guess at the minute would not say which post goes out. The account has three slots a day, one per tier (flagship, feature, proof of work), plus a slot for long-form X Articles every second day.

**Who approves** is [`api/_lib/x-content/approval.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/approval.js). In `owner` mode every post waits for a person. In `auto` mode a post is released without one only when all of these hold:

| Condition | Why |
|---|---|
| Its tier is listed in the policy | Flagship posts carry a partner's name or $THREE, so tier 1 stays with the owner unless the queue lists it |
| It was filmed, and the proof covers it | A post never proven against the product is never released by policy |
| It tags no one | A tag puts a partner's name next to ours, and a person decides that |
| The review passed on the editor's own verdict | An override is a person's judgment, so it needs a person |

X Articles have their own switch: long-form writing rarely has a reel to film, so the review stands in for it (every probe re-run, every link resolved, every sentence of the body held to the claims ledger), while the tag, verdict and proof rules still apply. A release by policy is never immediate: the post waits out a veto window (the code's default is 24 hours; the queue sets its own), the release is written to the ops alerts, and one command takes it back. Human attention goes to tags, flagship claims and disagreements with the editor, not to re-reading a filmed, verified, linted post.

## 12. The learning loop, and the limits of what it learned

The pipeline's original style rules came from a scrape taken before X had loaded the like counts of the account's largest posts. It concluded that video loses to a still and that 100 to 179 characters is the best length. The X API said the opposite on both. So the queue now measures itself.

After a publishing tick, at most once every 6 hours, [`api/_lib/x-content/outcomes.js`](https://github.com/nirholas/three.ws/blob/main/api/_lib/x-content/outcomes.js) reads the account's head posts back through the X API, describes each by attributes a draft can be checked for in advance (media kind, length band, link placement, thread, tags), and learns what each was worth over 90 days. The outcome is a log, because a post with 400 likes is not 100 times the post with 4:

```js
export function outcomeOf(row) {
	return Math.log1p(row.likes || 0) + 0.5 * Math.log1p(row.bookmarks || 0) + 0.25 * Math.log1p(row.reposts || 0);
}
```

The guard rails are the part to copy. A post counts once it is 48 hours old, because likes arrive for about two days. Outcomes are recency-weighted with a 45-day half-life. Each attribute's measured difference is shrunk by `n / (n + 8)`, and a value seen on fewer than 3 posts moves no score. The learned part is ignored until 20 posts have matured and is clamped to between -15 and +15 ranking points, so it cannot overrule the owner's explicit boost. Overlapping attributes are not summed: the estimate is the strongest reason for, the strongest against, and the mean of the rest. Because X bills each post a read returns, a refresh only re-reads as far back as metrics can still move (7 days before the last read).

A second model ranks by a different measured outcome: [`data/x-content/volume-model.json`](https://github.com/nirholas/three.ws/blob/main/data/x-content/volume-model.json) is a logistic regression fitted on 313 post moments, 54 of which were followed by a volume response on the $THREE pool. Read honestly, it is weak evidence: of its 9 features, only three (announcing a shipped thing, posting inside US working hours, posting from the company account) have confidence intervals that exclude no effect. It also rewards the word "introducing", which the voice lint bans as an opener. The lint wins, because it is a blocker and the model is a ranking term.

The boundary that matters: no deterministic check reads any of this. The learned lifts and the volume model change which ready post fills a slot, and the best-measured posts are what the editor sees as calibration. A learned preference can reorder true posts; it cannot make a false one publishable.

## 13. What we would build differently

**Alert on degraded failover, not only on total failure.** The chain never stopped the bar, which is why nobody noticed that all 52 reviews ran on the last rung while three paid providers refused us. The records named the model the whole time, and nothing read that field. A chain should alert when the rung that answered is not the rung that should have.

**Keep time-dependent truth out of unit tests.** The suite has a test asserting the committed queue is valid for every approved item. On 8 October it fails, because an approved item's review turned 19 days old. That is the 14-day expiry working as designed, and also a red build in a shared repository that nobody's change caused. Freshness belongs in an operational check with an alert; the unit test should pin `now`.

**Put exact-versus-floor in the schema from day one.** We added `min` evidence after counts that only grow kept sending true posts back to be filmed. If numbers will be held to live data, decide per number whether it is a snapshot or a floor.

**Give every regular-expression rule a corpus of sentences it must accept**, starting with every example in your own docs. The "drop a" false positive sat in the lint while the documentation's example post used the phrase.

**Bind facts to the run, not the page.** Of our 1,031 evidence entries, 519 are file evidence and 410 are page quotes; 95 are facts from a filmed run. Page and file evidence prove the copy matches something we wrote. Only run evidence proves the product did it, and the mix still leans toward the weaker kind.

## 14. What to lift from this

All Apache-2.0, none of it tied to the rest of the platform:

1. **The claims ledger as a schema.** A list of `{ says, evidence[] }`, checked in both directions, with one regular expression for absolute words. It fits release notes, changelogs, docs and sales copy as well as social posts, and it is the cheapest guard rail to put behind a generative step: a model drafting into it can be told its failures verbatim and asked again.
2. **The asymmetric judge.** The model may add blockers and never remove them; code demotes its `publish` when its own scores or issues disagree; its rewrites are linted like any draft.
3. **The model chain as a list of functions.** Each rung returns `null` when it cannot serve a request, throws on failure, and the caller's parser decides whether a reply counts. An Amazon Bedrock rung would be one more function calling the Bedrock runtime; we do not run one today.
4. **Content-hash approval with an expiry.** Hash every byte a reader or a fact depends on, store it in the approval, refuse to act on a mismatch.
5. **The write-ahead publish ledger.** Persist every external id the moment it exists, check before each call, and take a lease lock with a conditional upsert.
6. **Frame-stepped capture.** If you film anything rendered in a headless browser, take over the page clock instead of recording real time.

The tick is a stateless HTTP handler behind a scheduler, a lock row, and files in a container image (with signed, content-addressed bundles laid over them so a post approved after a deploy can still ship). On AWS the same shape would be an EventBridge Scheduler schedule invoking a Lambda function or a container, with the ledger in any transactional database. We have not built that variant, so treat it as a mapping, not a recipe.

## 15. Try it

Everything below is read-only and runs in a fresh clone. None of it posts, edits the queue, or needs an X account.

```bash
git clone https://github.com/nirholas/three.ws && cd three.ws && npm install

# 1. Validate the whole queue offline: voice lint, editorial lint, claims ledger,
#    proof bindings, and review-record hashes and ages. Exits 1 and prints each
#    problem if any item under review or approved has one.
npm run x:content:check

# 2. Run the claims ledger and the voice lint on a draft of your own.
node --input-type=module -e '
import { lintItem } from "./api/_lib/x-content/review.js";
const item = {
  id: "try-it", kind: "post",
  posts: [{ text: "Introducing the fastest 3D viewer ever: it loads 40 models in 2 seconds. three.ws/viewer" }],
  claims: [],
};
for (const f of lintItem(item, { maximum: 1000 })) console.log(f.severity.padEnd(8), f.rule.padEnd(10), f.message);
'

# 3. Watch the content hash change when one word changes.
node --input-type=module -e '
import { contentHash } from "./api/_lib/x-content/review.js";
const a = { kind: "post", posts: [{ text: "Nine cylinders to five." }], claims: [] };
const b = { kind: "post", posts: [{ text: "Nine cylinders to four." }], claims: [] };
console.log(contentHash(a, process.cwd()).slice(0, 16), contentHash(b, process.cwd()).slice(0, 16));
'

# 4. Read a real proof record and the review record bound to it.
node -e 'const p = require("./data/x-content/proofs/machine-atlas.json"); console.log(p.target, p.facts, p.video)'
node -e 'const r = require("./data/x-content/reviews/machine-atlas.json"); console.log(r.contentHash, r.passed, r.editor.model, r.editor.scores)'

# 5. The pipeline's own tests: scheduling, holds, the ledger, the lint, the hash binding.
npx vitest run tests/x-content
```

Step 2 prints four blocking findings: the banned opener, the two numbers no claim covers ("40" and "2 seconds"), and the absolute "fastest". Declare a claim whose `says` quotes the copy and whose evidence a program can check, and they clear one by one. Step 5 includes the time-dependent test from section 13, so expect it to fail whenever an approved item's review is older than 14 days.

The operator guide is [the pipeline doc](https://github.com/nirholas/three.ws/blob/main/docs/x-content-pipeline.md), and the guide to filmed stories is [Writing a story](https://github.com/nirholas/three.ws/blob/main/docs/x-story-authoring.md). Both are rendered on the live site at [three.ws/docs/x-content-pipeline](https://three.ws/docs/x-content-pipeline).

The part we would most like other builders to argue with is section 6: a model as an editor that may add blockers but never remove them. It is the cheapest way we have found to get a model's judgment without inheriting its confidence.

---

*three.ws is a verified AWS Partner and an open-source platform for 3D AI agents. Previously from us here: [how we metered a SaaS product through AWS Marketplace with the AWS SDK for JavaScript v3](https://builder.aws.com/content/3ESpll50BdSp9eiCEIxcfG9pGUN/how-we-metered-a-saas-product-through-aws-marketplace-with-the-aws-sdk-for-javascript-v3).*
