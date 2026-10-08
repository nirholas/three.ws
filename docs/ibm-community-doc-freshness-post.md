---
title: "Documentation drift detection from git history: docs that tell readers, and AI agents, whether to trust them"
venue: IBM Community, Three.ws User Group (blog post)
account: nich (nich8)
description: "A long technical write-up for IBM developers, engineering leads, and platform teams: how three.ws binds every doc to the source files it names, asks git what moved since the doc was last written or reviewed, records human reviews against a specific commit, exempts dated records from rewriting, regenerates the result inside the deploy build, and shows every reader a freshness status. Includes real command output, two months of measured history, a zero-dependency Node script readers can run on their own repo in an afternoon, the honest limits of git-history staleness, and the lesson for teams whose docs are now read as instructions by AI coding agents."
status: draft, not yet posted
meta_title: "Documentation Drift Detection from Git History"
meta_description: "Bind each doc to the code it names, ask git what changed since it was last checked, and show readers and AI agents a freshness status. Runnable script."
slug: documentation-drift-detection-git-history
featured_image: "https://three.ws/api/page-og?v=carbon&s=learn&t=Documentation+that+tells+you+whether+to+trust+it&d=Measure+doc+drift+against+git+history%2C+record+human+reviews+against+a+commit%2C+and+show+every+reader+a+freshness+status.&p=%2Fdocs%2Ffreshness"
framing_notes: |
  Every framing rule in docs/ibm.md applies. three.ws is an IBM Business Partner, and
  nothing in this post is an IBM product, uses an IBM service, or had IBM involvement:
  the freshness system is three.ws engineering practice built on git and Node.js. The
  affiliation line near the top says so and must survive any edit.
  Per docs/ops/seo-keyword-plan.md this is a standalone tutorial with no crypto-cluster
  content. Every quoted doc path, command row, and commit subject was chosen to carry
  none; rows of real output that did were trimmed and the trim is marked in the text.
  Featured image caveat: the ?v=carbon card renders a fixed "Built on IBM watsonx.ai"
  footer (api/page-og.js, carbonCard). The platform is built on watsonx.ai, but next to
  a docs-freshness title the line can read as if this feature were. If that matters at
  posting time, use the same URL without `v=carbon` (the default dark card), or drop the
  featured image.
  All numbers are dated in the text. Production figures are from the deploy of commit
  76081013b (2026-10-01); local figures are from commit fe2a8b24f (2026-10-08). Re-run
  `npm run check:docs-freshness` and re-read https://three.ws/docs-freshness-summary.json
  before posting and refresh sections 9 and 10 if they moved.
  Canonical URL: leave blank (original post).
---

# Documentation drift detection from git history: docs that tell readers, and AI agents, whether to trust them

_Posted in the [Three.ws User Group](https://community.ibm.com/community/user/groups/community-home?communitykey=e71510cc-d953-408f-9a1c-019f5c0a7016) on IBM Community._

Nobody edits a document to make it wrong. The code it describes moves, and the page keeps saying what used to be true. For most of software history the only signal that a doc had rotted was a confused reader, usually days after the rot set in.

That was tolerable when the only reader was a person who could notice that a command failed and go ask someone. It is not tolerable anymore. On a growing number of teams, documentation now has a second reader: the AI coding agent. Agents read your README, your runbooks, and your agent instruction files, and they act on what those say. A human treats a stale sentence as a hint that something is off. An agent treats it as an instruction.

This post is a complete tour of how three.ws handles that. Every doc in our repository is bound to the source files it names. Git decides whether any of those files moved after the doc was last written or last reviewed. The result is a status per doc (verified, watch, stale, conceptual, or record), a ranked work queue for the people who fix docs, and a small badge at the top of every published doc page that tells the reader how much to trust what they are about to read. The measurement is regenerated inside the deploy build, so the badge describes the commit that is actually serving.

It is a general engineering practice, not a product. Nothing here depends on our stack beyond git and Node.js, and section 11 gives you a zero-dependency script you can run against your own repository this afternoon.

**The affiliation, stated exactly.** three.ws is an IBM Business Partner. The system described in this post is three.ws's own engineering practice, built on git and Node.js. It is not an IBM product, it does not use any IBM service, and IBM had no involvement in it. I am sharing it here because the problem it solves is one every team adopting AI coding agents will meet.

**Contents**

1. Why stale docs got more expensive: your docs now have a second reader
2. The model in one paragraph
3. What "stale" is computed from
4. Five statuses, and why two of them are not failures
5. The second clock: recording a human review against a commit
6. Records of a moment: why dated docs are exempt from rewriting
7. Working the queue
8. Where it runs: the gate, and inside the deploy build
9. What readers see
10. What two months of history say
11. Build your own in an afternoon
12. The neighbors: link audits and an instruction file that checks itself
13. Honest limits
14. The lesson for teams adopting AI coding agents
15. Questions for the group

---

## 1. Why stale docs got more expensive: your docs now have a second reader

three.ws is built by a small human team working alongside AI coding agents. The agents write code, run builds, prepare deploys, and, as you will see, do most of the documentation repair. They all start from the same place: an operating file at the root of the repository (ours is `CLAUDE.md`; many teams use `AGENTS.md` or a similar convention) plus whatever docs the task leads them into.

That operating file contains a section called "Keeping this file true", and its opening paragraph is the clearest statement of the problem I know:

> This file is the operating brain for every agent here, and agents execute what it says verbatim. A stale line in it does not read as stale, it reads as an instruction, and the cost is a wasted session per drift.

That is not hypothetical. The guard script that checks the file (`scripts/check-claude-md.mjs`, covered in section 12) carries comments recording the drifts that actually happened:

- The file once described a database migration command as a dry run. The npm wrapper hardcodes `--apply`, so the "dry run" writes to the production database immediately. A human might hesitate. An agent told it is safe will run it.
- The file quoted a scheduled-job count. The real list in the config grew from 89 to 100 without anyone updating the sentence.
- The file told agents to push with `git push threews main`. On 2026-07-30 one worktree had no remote by that name, so the exact push command the file prescribes failed. As the script's comment puts it, a push instruction that does not resolve "fails at the moment the owner asked to ship."

Each of those cost a session. None of them was a dramatic failure. They were small truths that stopped being true, read by a reader that does not second-guess.

The same is true of every other doc an agent is pointed at. A runbook that names a script, a tutorial that tells you to run a command, an API reference that lists a route: all of them are now executable in a loose sense. So the question "is this doc still true?" stopped being a documentation-quality question and became an operational one.

---

## 2. The model in one paragraph

A doc already tells you what it is about: it names files, `npm run` commands, and `/api/` routes in its own text. Read those references, resolve the ones that point at real source files, and treat them as the doc's dependencies. Then ask git one question per dependency: was this file committed to after the doc was last written or last reviewed? Code that moved after the page was last checked is code the page has never been checked against. Weight each moved file by how exclusively this doc claims it, sum the weights, and turn the sum into a status. Rank the stale ones into a queue, give each one the exact commits to read, let a reviewer record "I read it and it was right" against a specific commit, and publish the result to every reader.

That is the whole system. Everything below is detail, and most of the detail exists because a simpler version produced noise that taught people to ignore it.

---

## 3. What "stale" is computed from

The implementation is one script, [`scripts/doc-freshness.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/doc-freshness.mjs), run as `npm run docs:freshness`. It needs no annotations in the docs. It reads the references authors already write.

### 3.1 Which docs

Every Markdown file under `docs/`, plus three root files that matter: `README.md`, `STRUCTURE.md` (the map from product surface to directory), and `CLAUDE.md`. Three generated aggregates that restate the whole corpus (`docs/ALL.md`, `docs/EVERYTHING.md`, `EVERYTHING.md`) are skipped. More on why in section 3.5, because the reason is one of the most useful lessons in this post.

### 3.2 What a doc depends on

Three reference shapes, because those are the three ways our docs actually name code:

```js
// scripts/doc-freshness.mjs (excerpt)
function extractDeps(markdown, selfPath) {
	const deps = new Set();

	// Explicit paths. The character class is deliberately narrow so a sentence
	// ending in a period does not swallow the next word into the match.
	for (const m of markdown.matchAll(/(?:^|[\s`("'[<])((?:\.\/)?[\w.-]+(?:\/[\w.-]+)*\.\w{1,5})/g)) {
		const rel = resolveRef(m[1], selfPath);
		if (rel) deps.add(rel);
	}

	// npm scripts: a doc telling you to run something depends on what it runs.
	for (const m of markdown.matchAll(/npm run ([\w:-]+)/g)) {
		for (const rel of scriptTargets(m[1])) deps.add(rel);
	}

	// API routes documented as endpoints map to their handler. The two shapes
	// this repo uses are api/<route>.js and api/<route>/index.js.
	for (const m of markdown.matchAll(/\/api\/([\w/-]+)/g)) {
		const route = m[1].replace(/\/$/, '');
		for (const candidate of [`api/${route}.js`, `api/${route}/index.js`]) {
			if (existsSync(path.join(ROOT, candidate))) deps.add(candidate);
		}
	}

	return [...deps];
}
```

The `npm run` rule is the one people underestimate. A doc that says "run `npm run docs:review`" never names `scripts/docs-review.mjs`, but it depends on it completely. The script reads `package.json`, finds the files that script command executes, and binds them to the doc.

Each candidate path then has to survive `resolveRef`, which rejects anything that would flood the graph with false positives: a file without a code extension, a path outside the top-level directories that hold shippable code, a directory rather than a file, a path that does not exist, and the doc's own filename echoing back at it.

### 3.3 One pass over history

Asking git about each dependency separately would be thousands of invocations. Instead the script reads the whole history once and indexes it two ways, by file and by commit:

```js
// scripts/doc-freshness.mjs (excerpt)
const raw = execFileSync(
	'git',
	['log', '--format=%x1e%H|%ct|%s', '--name-only', '--no-renames'],
	{ cwd: ROOT, maxBuffer: 256 * 1024 * 1024 },
).toString();
```

The `%x1e` record separator keeps a commit subject containing odd characters from corrupting the parse. `%ct` is the committer timestamp, which becomes the clock everything is compared against. (Section 13 covers what that choice costs.)

### 3.4 The baseline, and the weight

For each doc, the baseline is whichever is newer: the doc's last commit, or its last recorded review (section 5). Every dependency committed to after that baseline is drift.

Not all drift means the same thing, and this is the refinement that made the ranking usable. Our route configuration file, `vercel.json` (a legacy name; the file is the live route table for our server), is named by 72 docs. If every one of them went red whenever a route was added, the dashboard would be red everywhere and nobody would read it. But excluding shared files outright is wrong too, because the doc that really is about the route table should notice when it changes.

So each dependency is weighted by how exclusively this doc claims it:

```js
// scripts/doc-freshness.mjs (excerpt)
const specificity = (share) => 1 / Math.max(1, share);
```

A file only one doc names counts fully. A file forty docs name counts for a fortieth. The comment in the source calls it what it is: the inverse-document-frequency idea from search ranking, applied to the binding between docs and code. The doc that is uniquely responsible for a file rises above the doc that happened to mention a busy one.

The signal is the sum of the weights of the drifted files, and the status falls out of it:

```js
// scripts/doc-freshness.mjs (excerpt)
function classify(deps, signal) {
	if (!deps.length) return 'unverifiable';
	if (signal <= 0) return 'fresh';
	if (signal >= 1) return 'stale';
	return 'watch';
}
```

The threshold of 1.0 reads directly: "the equivalent of one file that only this doc documents has changed." That is exactly when a human should re-read the page.

### 3.5 What is excluded, and why exclusion beats down-weighting

Three classes of file are removed from the graph entirely rather than weighted lightly:

- **Build outputs.** The sitemap, the machine-readable `llms.txt`, the changelog feeds, page indexes, build info. The changelog gaining an entry is not evidence that a tutorial went wrong. Their churn is mechanical, not semantic.
- **The machine-translated locale tree.** Locale files are extracted from annotated HTML and machine-translated into other languages. A translation pass that touches a hundred files was reading as a hundred docs going stale until commit `2bf55b582` (2026-08-14) excluded them.
- **The system's own bookkeeping.** The review store and the budget file are rewritten by every review and every budget change. The doc that explains the system names both, so recording reviews pushed that very doc straight back to stale: a false positive produced by using the system exactly as intended. Commit `302d0ae31` (2026-09-18) removed them.

The generated aggregates (`docs/ALL.md` and friends) are excluded as docs for a reason that is easy to miss and worth measuring. They restate the whole corpus, so they name nearly every file every other doc names. That does not just make them permanently stale. It **doubles the share count of almost every file in the repo**, which halves every weight, which quietly pushes real drift below the threshold everywhere.

I measured this with the minimal script from section 11, run against our repository at commit `fe2a8b24f` on 2026-10-08. With `docs/ALL.md` included (it names 2,089 files):

```
809 docs: 58 stale, 359 watch, 165 verified, 227 conceptual, 0 snapshot
```

With it excluded (`--ignore '^docs/(ALL|EVERYTHING)\.md$'`):

```
808 docs: 122 stale, 294 watch, 165 verified, 227 conceptual, 0 snapshot
```

Removing one generated file more than doubled the number of docs that cross the stale line. Nothing about the other docs changed. The aggregate was simply diluting everyone's evidence. If you build this yourself, finding and excluding your own aggregates (generated API references, concatenated handbooks, search-index dumps) is the first thing to do.

---

## 4. Five statuses, and why two of them are not failures

| Status | Shown to readers as | Meaning |
|---|---|---|
| `fresh` | Verified | Nothing it documents has changed since it was written or reviewed. |
| `watch` | Watch | Some movement, below the threshold. Worth a skim, not urgent. |
| `stale` | Stale | The equivalent of one file only this doc documents has changed. Someone should re-read it. |
| `unverifiable` | Conceptual | Names no code, so there is nothing to check. Not a problem, and not counted as drift. |
| `snapshot` | Record | A dated record of a moment. Code moving under it is not drift. |

The two that are not failures matter as much as the three that might be.

**Conceptual** exists because plenty of good docs name no code at all: architecture rationale, product narratives, design principles. Calling those stale, or calling them unknown in a way that looks like a warning, would be noise that trains people to ignore the signal. They are counted separately so coverage stays visible (128 of 809 docs in production on 2026-10-01) without polluting the queue.

**Record** exists because some docs are not descriptions of current behavior at all. Section 6 covers them.

---

## 5. The second clock: recording a human review against a commit

The first version of this system had one clock: the doc's last commit. That clock is wrong in one very common case. Someone reads a page end to end, checks every claim against the source, and finds nothing to fix. The work happened. The doc is verified. The measurement still says stale, because there is no diff to show for it.

Before review stamps existed, the only ways to clear such a page were a cosmetic edit, which lies in the history about what happened, or leaving a permanent false positive, which teaches everyone that the dashboard cries wolf. The sweep on 2026-08-05 ended with 8 docs in exactly that state, and the 2026-09-01 sweep ended with 10.

A review stamp is the second clock:

```bash
# You read the doc, checked it against the code, and it was right.
npm run docs:review -- docs/forge-pipeline.md --note "lanes, timeouts and failover verified"

# Several at once, against the commit you actually reviewed.
npm run docs:review -- docs/a.md docs/b.md --at 53f2a200f --note "checked in the September sweep"

# A dated record that must not be rewritten to match today's code.
npm run docs:review -- docs/security/review-2026-06-24.md --snapshot

npm run docs:review -- --list     # every stamp, newest first
npm run docs:review -- --prune    # drop stamps for docs that no longer exist
```

Stamps live in one JSON file, `data/docs-freshness-reviews.json`, keyed by doc path and sorted on write "so two agents stamping different docs never fight." This is the real entry for the doc that describes the freshness system itself:

```json
"docs/doc-freshness.md": {
	"commit": "302d0ae31",
	"kind": "verified",
	"by": "agent",
	"note": "re-read against the exclusion change"
}
```

Three design decisions are worth copying.

**A stamp records a commit, not a date.** "Reviewed on Tuesday" says nothing about which version of the code the reviewer read. "Reviewed against `302d0ae31`" does. The freshness clock uses that commit's timestamp, and anyone can check out that commit and see exactly what the reviewer saw.

**A stamp naming a commit the repository does not have is a hard error, not a silent skip.** It means someone hand-edited the store, or stamped against a branch that never landed. Either way the baseline it claims is fiction, and a fictional baseline silently suppresses real drift, which is the precise failure the system exists to prevent:

```js
// scripts/doc-freshness.mjs (excerpt)
const commit = byCommit.get(entry.commit);
if (!commit) {
	problems.push(`${docPath}: stamped at ${entry.commit}, which is not a commit in this repo`);
	continue;
}
```

The gate refuses to pass with a broken stamp outstanding, and a separate unit test (`tests/docs-freshness-reviews.test.js`) checks the store on every test run: every stamped doc exists, every stamp names a Markdown file, every stamp names a commit the repository has, and every stamp declares a kind the analyzer understands. That test runs in the normal suite precisely because the full measurement is too slow for it, and a careless bulk commit or a hand edit is exactly what would break the store.

**The newer clock wins, in both directions.** A doc edited after its last review is measured from the edit. A doc reviewed after its last edit is measured from the review. And if you stamp a doc that has uncommitted edits, the review script tells you so, because the stamp cannot mask the pending edit: the measurement will still count the doc's real last commit.

The dashboard and the badge both surface the stamp. A row on the dashboard says who checked the page and against which commit, and a page nobody has checked says so plainly and gives the command to record a check after reading it.

---

## 6. Records of a moment: why dated docs are exempt from rewriting

Some docs record a moment rather than describe current behavior: a dated security review, an incident writeup, a test log, a finished work order, an upstream bug report draft. They name plenty of code, so they will always look stale. And they must never be "fixed," because rewriting a security review to match today's code destroys the record it exists to keep.

These get `--snapshot`. Their status becomes `snapshot` regardless of drift, and they are never ranked as work:

```js
// scripts/doc-freshness.mjs (excerpt)
// A snapshot documents a moment, so today's code cannot make it wrong.
// Its dependencies stay visible (the evidence is still useful) but it is
// never ranked as work.
status: review?.kind === 'snapshot' ? 'snapshot' : classify(deps, signal),
```

Six docs carry this status today, including two security reviews, a production test log, and an upstream issue draft. The readers' badge says: "Written [date]. This page records what was true at that point, so it is kept as written rather than updated to match today's code."

There is a subtle benefit here beyond silencing noise. An agent asked to "bring the docs up to date" will happily rewrite an audit to match the current code, because from its point of view the audit is just another stale doc. The snapshot status is a machine-readable statement that this document is history, and our sweep workflow (section 7) tells its reviewers in so many words that a record must not be rewritten.

---

## 7. Working the queue

`npm run docs:freshness` ranks everything and writes the report. The command a writer actually reaches for is `--doc`, which explains one page and prints its reading list: every drifted file, the commits behind it, and their subjects.

Here is real output from 2026-10-08, for a doc about how avatar preview images are rendered:

```
$ npm run docs:freshness -- --doc docs/avatar-thumbnails.md

Avatar thumbnails
docs/avatar-thumbnails.md

  status        stale (signal 1.045)
  last edited   2026-10-01 (68c8ec4db), 6d ago
  documents     29 file(s)

  2 of them changed after this doc was last edited:

  scripts/regenerate-avatar-thumbnails.mjs  (1 commit)
      2026-10-01  309cb37e8  fix(avatars): give each thumbnail re-render two minutes, so one stuck model cannot stall the regeneration

  src/animation-retarget.js  (1 commit, also documented by 21 other doc(s))
      2026-10-03  8561d5c5d  fix(animation): re-aim limb rest direction so A-pose rigs stop clipping through the torso

  Read those commits, fix anything the doc gets wrong, then record the check:
      npm run docs:review -- docs/avatar-thumbnails.md --note "<what you checked>"
```

The arithmetic is visible in the output. The regeneration script is named only by this doc, so it counts 1.0. The animation file is shared with 21 other docs, so it counts 1/22, about 0.045. Total 1.045: just over the line, and the line was crossed by the file this doc is uniquely responsible for.

Is the doc wrong? I read the commit. It added a two-minute cap per render, so one model that never finishes no longer holds a whole regeneration pass hostage (the commit's own comment says one once held a pass for seven hours). The doc's existing claims about the script (dry run by default, `--apply` to overwrite, resumable with `--offset`) are all still true. What it does not mention is the new cap. That is the typical case: not a lie, but a missing fact an operator would want. The reviewer's choice is a one-sentence addition or a stamp with a note saying the omission is deliberate, and either one clears the page honestly.

That judgment is the part the tool cannot make, and it is designed not to try.

### 7.1 The gate and the budget

`npm run check:docs-freshness` is the same measurement in gate mode. It does not write anything. It counts stale docs against a budget in `data/docs-freshness-budget.json` and fails when the count is over:

```js
// scripts/doc-freshness.mjs (excerpt)
if (over > 0) {
	printTable(results, 15);
	console.error(
		`\nOver budget by ${over}. Either refresh a doc above (run ` +
			`\`npm run docs:freshness -- --doc <path>\` for the exact commits to read), ` +
			`or raise maxStale in data/docs-freshness-budget.json with a reason.`,
	);
	process.exit(1);
}
// The budget only ever ratchets down. Reporting the slack is what makes that
// happen: a number nobody sees is a number nobody lowers.
if (over < 0) console.log(`${-over} under budget. Lower maxStale to lock the gain in.`);
```

The budget is a ratchet with its reasons recorded in the file itself: 50 on 2026-07-31 (the first measurement), 15 on 2026-08-05 (after the first full sweep), 5 on 2026-09-17 (after the sweep that reached zero, with 5 kept "as deliberate headroom for normal churn between passes rather than a backlog allowance").

Here is the gate as it stands on 2026-10-08, at commit `fe2a8b24f`. It took about two seconds, exited 1, and is honest about why. I removed ten of the fifteen table rows because they concern product areas outside this post's scope; the rows shown are untouched:

```
$ npm run check:docs-freshness
docs freshness: 69 stale / 470 watch / 144 fresh / 128 unverifiable / 6 snapshot (budget 5 stale)

15 doc(s) describing code that changed since they were written:

  !!  docs/guards.md                                 signal   5.33  18 file(s) since 2026-09-21
      scripts/build-openai-portal-fields.mjs, public/tour-builder/tour.global.js, pages/tour-atlas.html, +15 more
  !!  docs/announcement-factory.md                   signal   5.31  13 file(s) since 2026-09-21
      api/_lib/announce/draft.js, api/_lib/announce/ledger.js, api/_lib/announce/kit.js, +10 more
  !!  docs/ops/guard-wiring.md                       signal   2.67  10 file(s) since 2026-09-17
      tests/deploy-artifacts.test.js, scripts/check-gcloudignore.mjs, public/tour-builder/tour.global.js, +7 more
  !!  docs/prompts/13-chat-gateways.md               signal   2.35   5 file(s) since 2026-09-22
      api/gateway/telegram.js, api/gateway/discord.js, api/cron/changelog-push.js, +2 more
  !!  docs/notifications.md                          signal   2.33   6 file(s) since 2026-09-17
      src/notifications-page.js, src/notifications.js, src/push-notifications.js, +3 more

Over budget by 64. Either refresh a doc above (run `npm run docs:freshness -- --doc <path>` for the exact commits to read), or raise maxStale in data/docs-freshness-budget.json with a reason.
```

Note who is on that list: `docs/guards.md` and `docs/ops/guard-wiring.md` are the docs that describe our quality gates. `STRUCTURE.md`, the map from every product surface to its directory, is in the omitted rows. The docs about the system that keeps docs honest drift like everything else, which is the strongest argument I know for measuring instead of trusting.

### 7.2 Sweeps, run by agents

The queue is drained in sweeps, and on our team the sweeps are run by AI coding agents through a workflow script (`.claude/workflows/docs-freshness.js`). It has three phases:

1. **Queue.** One agent runs the measurement and groups the stale docs into batches of at most five by subject area, so one reviewer reads each product surface's code once.
2. **Review.** One agent per batch, in parallel. Each must read the exact drifted commits and the current source, check every concrete claim (routes, environment variables, script and function names, behavior, numbers, paths, UI copy), correct rather than rewrite, and return one verdict per doc from a three-word vocabulary: `EDITED`, `VERIFIED`, or `SNAPSHOT`.
3. **Stamp.** One agent records every verdict with `npm run docs:review`. Stamping is deliberately centralized: the store is one file, and several agents writing it at once would lose stamps to a last-write-wins race.

The comment above the verdict schema states the point of the whole second clock: "A doc that was read and found correct is as finished as one that needed a fix... without VERIFIED the queue can only be drained by editing."

---

## 8. Where it runs: the gate, and inside the deploy build

The measurement runs in two places, and the second is the one I would most encourage you to copy.

**In the gate.** `check:docs-freshness` is part of `npm run gate`, our umbrella of repository health checks. The gate is run on demand, not by the deploy pipeline. Section 13 is honest about what that has cost.

**Inside the deploy build, before the frontend build.** Our production build is one chained npm script, and its order is load-bearing:

```
check:conflicts → check:browser-graph → check:tdz-bootstrap → ensure:avatar-studio
→ build:info:snapshot → docs:freshness → build:lib:full → build:avatar-sdk → build:chat
→ build → publish:lib → build:info → check:dist → check:pages
```

`docs:freshness` writes `public/docs-freshness.json` and its compact summary. The frontend build (`build`, a Vite build) copies `public/` into the deployable output. So the freshness step must run before the frontend build, and it does. That one placement decision is what makes the badge honest: every deploy measures the commit being deployed, and the published dashboard and badges describe exactly that code, not whatever a person last measured by hand.

You can check this from outside. On 2026-10-08, the live version endpoint reported:

```
$ curl -s https://three.ws/api/version
{"status":"ok","version":"1.5.2","commit":"76081013b368d6754c427f304c14ee58bbc1112e",
 "commitShort":"76081013b", ..., "commitTime":"2026-10-01T19:30:12+00:00",
 "builtAt":"2026-10-01T19:31:45.051Z", ...}
```

And the live freshness summary:

```
$ curl -s https://three.ws/docs-freshness-summary.json | head -8
{
	"$generated": "npm run docs:freshness (scripts/doc-freshness.mjs)",
	"$doc": "/docs/freshness",
	"generatedAt": "2026-10-01T19:30:52.693Z",
	"commit": "76081013b",
```

Same commit. The measurement ran about 40 seconds after the commit and about 52 seconds before the build finished, inside the build. If you take one idea from this post into your own pipeline, take this one: generate trust signals at build time, from the commit being shipped, and ship them with the artifact.

---

## 9. What readers see

### 9.1 The badge

Every published doc page and every tutorial renders a small freshness line above the article. It is mounted by [`public/doc-freshness.js`](https://github.com/nirholas/three.ws/blob/main/public/doc-freshness.js), which the docs reader and the tutorial viewer load with a dynamic import, so pages that never show a doc never pay for it.

These are real badge texts, read from the live site with a headless browser on 2026-10-08 (status glyphs omitted):

| Page | Badge |
|---|---|
| [/docs/forge](https://three.ws/docs/forge?utm_source=ibm-community) | **Verified against the code.** Last written Sep 30, 2026. None of the 12 source files this page documents has changed since. |
| /docs/doc-freshness | **Lightly out of date.** Checked against the code Sep 18, 2026. 1 file it documents changed since, so a detail here may have moved. *See what changed* |
| /docs/how-it-works | **Lightly out of date.** Last written Aug 13, 2026. 6 files it documents changed since, so a detail here may have moved. *See what changed* |
| /docs/guards | **The code this page describes has changed.** Checked against the code Sep 17, 2026. 18 files it documents changed since, and nobody has re-checked the page against them. *See what changed* |

Notice the wording rules, which are written into the module:

- **It says what happened, never what the reader did wrong.** "18 files it documents changed since, and nobody has re-checked the page against them" is a fact the reader can weigh. It does not tell them to go away.
- **A review leads when there is one.** "Checked against the code Sep 17" is a stronger promise than "last written," so the review date is shown first when a stamp exists.
- **Only drifted pages link out.** On a verified page the dashboard is a distraction from what the reader came for, so the "See what changed" link appears only on watch and stale.
- **A missing entry renders nothing.** A brand-new page, or a build where the generator never ran, shows no badge at all. The comment in the source: "an empty box that says 'unknown' is worse for the reader than no box."
- **It never blocks the content.** The reader came for the doc. The honest thing is to tell them how much to trust it while they read.

### 9.2 Keeping the badge cheap

The full report is large because it carries every drifted file and every commit behind it. On 2026-10-08 the live file was 1.63 MB raw (about 238 KB gzipped). A badge needs five fields per doc, so the script writes a separate summary with single-letter keys, documented in place:

```js
// scripts/doc-freshness.mjs (excerpt)
// Short keys: this file is fetched by every docs page that renders a
// badge, so its bytes are on the reader's critical path.
// s status, g signal, d date last edited, f files drifted, n deps known,
// v date last reviewed (absent when the doc has never been stamped)
```

That summary was 97 KB raw and about 13 KB gzipped for 809 docs, fetched once per page load and cached. A real entry:

```json
"docs/doc-freshness.md": {"s":"watch","g":0.014,"d":"2026-09-18","f":1,"n":5,"v":"2026-09-18"}
```

That `g` of 0.014 is 1/72: the one drifted file is the route table, named by 72 docs. The doc is "lightly out of date" in the most honest sense possible.

### 9.3 The dashboard

[The docs freshness dashboard](https://three.ws/docs/freshness?utm_source=ibm-community) is the people-who-fix-docs view of the same data. On 2026-10-08 its header read "809 docs bound to 4101 source files. Measured at 76081013b on Oct 1, 2026." Each status is a toggle filter showing its count (64 stale, 472 watch, 139 verified, 128 conceptual, 6 records on that deploy), and there is a text filter that matches a title, a path, or a source file that drifted, so you can ask "which docs moved when this file changed?" Sorting covers most drift, most files drifted, oldest doc, and path.

Each row expands to the evidence: every drifted file with its weight ("only this doc documents it" or "also documented by N other docs"), the commits behind it, who last checked the page and against which commit, a link to read the page, a link to edit it, and a button that copies the exact `--doc` command for that page.

---

## 10. What two months of history say

Because the report is committed alongside the code, its own git history is a time series of documentation health. These are the totals from every committed version of the report, read with `git show` on 2026-10-08 (selected rows; the rest follow the same pattern):

| Report date | Docs | Stale | What happened |
|---|---|---|---|
| 2026-07-31 | 469 | 50 | Measurement and dashboard ship; budget set to 50 |
| 2026-08-05 | 484 | 55 to 8 | First full sweep: 47 corrected, 8 verified accurate as written |
| 2026-08-14 | 551 | 148 | Nine days of feature work |
| 2026-09-01 | 628 | 174 to 14 | Second sweep: 164 corrected or extended, 10 verified |
| 2026-09-15 | 718 | 106 | Two weeks of feature work |
| 2026-09-18 | 733 | 0 | Third sweep plus review stamps: 82 corrected, 22 verified, 6 records |
| 2026-09-21 | 747 | 13 | Three days later |
| 2026-10-01 | 809 | 64 | Production deploy of `76081013b` |
| 2026-10-08 | 809 | 69 | Local measurement at `fe2a8b24f`; gate over budget by 64 |

Three things stand out.

**When the tool says stale, the doc is usually actually wrong.** Across the three sweeps, 339 flagged docs were read against the code, and 293 of them were corrected or extended: about 86 percent. The commit messages list what was wrong, and it is exactly the kind of thing a reader acts on: an environment-variable reference listing two variables no code reads, a runbook whose teardown command now refuses to run without `--force`, a command documented as writing two files when it writes four to two destinations, a tutorial whose sanity check pointed at the hosted platform instead of the stack the reader had just built, retired model names, outdated tool and job counts, and the deploy runbook's build chain. A signal with that hit rate is worth putting in front of readers.

**The corpus grows faster than you think.** 469 docs to 809 in ten weeks. Every one of the new ones names code, and every one of them starts drifting the day it lands.

**Drift comes back on a schedule.** Zero on 2026-09-18, 13 three days later, 64 at the next deploy two weeks after that. A sweep is not a fix. It is maintenance, and it has to recur. Section 13 is about what that means for where the gate lives.

---

## 11. Build your own in an afternoon

Here is a complete, zero-dependency Node.js script that implements the core model: extraction, the one-pass history index, specificity weighting, the five statuses, review stamps with a hard error on unknown commits, a budget gate, and JSON output. It needs Node 18 or newer and git. Save it anywhere and run it from inside any git repository.

It is deliberately smaller than ours, and it fixes one blind spot ours has (section 13.3): it resolves `../` links relative to the doc's own directory.

```js
#!/usr/bin/env node
// doc-drift.mjs: rank Markdown docs by how much the code they name has changed
// since each doc was last edited (or last reviewed). Zero dependencies.
//
//   node doc-drift.mjs                 rank docs/ and README.md, print the queue
//   node doc-drift.mjs --top 25        show more rows
//   node doc-drift.mjs --json > r.json machine-readable report
//   node doc-drift.mjs --check 10      exit 1 when more than 10 docs are stale
//   node doc-drift.mjs --ignore '^docs/generated/'   leave generated files out
//   node doc-drift.mjs --stamp docs/setup.md [--snapshot]   record a review at HEAD
//
// Optional review stamps live in .doc-reviews.json at the repo root:
//   { "docs/setup.md": { "commit": "1a2b3c4", "kind": "verified" },
//     "docs/incident-2026-03.md": { "commit": "1a2b3c4", "kind": "snapshot" } }
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const git = (...args) =>
	execFileSync('git', args, { maxBuffer: 512 * 1024 * 1024 }).toString();
const ROOT = git('rev-parse', '--show-toplevel').trim();
process.chdir(ROOT);

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
	const i = argv.indexOf('--' + name);
	return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const IGNORE = new RegExp(opt('ignore', '$^'));
const CODE = /\.(js|mjs|cjs|ts|tsx|jsx|py|go|java|kt|rb|rs|cs|sh|sql|json|ya?ml|toml)$/;
const tracked = new Set(git('ls-files').split('\n').filter(Boolean));
const docs = [...tracked].filter((f) => ((f.startsWith('docs/') && f.endsWith('.md')) || f === 'README.md') && !IGNORE.test(f));
const npmScripts = existsSync('package.json')
	? JSON.parse(readFileSync('package.json', 'utf8')).scripts || {}
	: {};

// 1. What does each doc claim to document? Any token that resolves to a tracked
//    code file, read relative to the repo root or to the doc's own directory.
function depsOf(doc, text) {
	const deps = new Set();
	const add = (rel) => {
		const p = path.posix.normalize(rel);
		if (p !== doc && p !== '.doc-reviews.json' && CODE.test(p) && tracked.has(p) && !IGNORE.test(p)) deps.add(p);
	};
	for (const [, raw] of text.matchAll(/(?:^|[\s`("'[<])((?:\.{1,2}\/)*[\w.-]+(?:\/[\w.-]+)*\.\w{1,5})/g)) {
		const clean = raw.replace(/^\//, '');
		add(clean);
		add(path.posix.join(path.posix.dirname(doc), clean));
	}
	for (const [, name] of text.matchAll(/npm run ([\w:.-]+)/g)) {
		for (const [file] of (npmScripts[name] || '').matchAll(/[\w./-]+\.(?:mjs|cjs|js|ts|sh|py)/g)) add(file);
	}
	return [...deps];
}

// 2. One pass over history: file -> commits that touched it (newest first).
const byFile = new Map();
const byCommit = new Map();
for (const chunk of git('log', '--format=%x1e%H %ct %s', '--name-only', '--no-renames').split('\x1e')) {
	const [header, ...files] = chunk.trim().split('\n');
	if (!header) continue;
	const [sha, ts, ...subject] = header.split(' ');
	const commit = { sha, ts: Number(ts), subject: subject.join(' ') };
	byCommit.set(sha, commit);
	for (const f of files) if (f) (byFile.get(f) || byFile.set(f, []).get(f)).push(commit);
}

// 3. Review stamps: a second clock. A stamp naming an unknown commit is fatal,
//    because a baseline nobody can check would silently hide real drift.
const stamps = existsSync('.doc-reviews.json') ? JSON.parse(readFileSync('.doc-reviews.json', 'utf8')) : {};
if (opt('stamp', null)) {
	const doc = opt('stamp');
	if (!tracked.has(doc)) throw new Error(`${doc} is not a tracked file`);
	stamps[doc] = { commit: git('rev-parse', '--short=9', 'HEAD').trim(), kind: argv.includes('--snapshot') ? 'snapshot' : 'verified' };
	writeFileSync('.doc-reviews.json', JSON.stringify(stamps, null, 2) + '\n');
	console.log(`Stamped ${doc} as ${stamps[doc].kind} at ${stamps[doc].commit}.`);
	process.exit(0);
}
const stampOf = (doc) => {
	const s = stamps[doc];
	if (!s) return null;
	const commit = [...byCommit.values()].find((c) => c.sha.startsWith(s.commit));
	if (!commit) throw new Error(`${doc}: stamped at ${s.commit}, which is not a commit in this repo`);
	return { ...commit, kind: s.kind === 'snapshot' ? 'snapshot' : 'verified' };
};

// 4. Score. Each drifted file counts 1/N, where N is how many docs name it.
const parsed = docs.map((doc) => ({ doc, deps: depsOf(doc, readFileSync(doc, 'utf8')) }));
const share = new Map();
for (const { deps } of parsed) for (const d of deps) share.set(d, (share.get(d) || 0) + 1);

const report = parsed.map(({ doc, deps }) => {
	const stamp = stampOf(doc);
	const baseline = Math.max(byFile.get(doc)?.[0]?.ts || 0, stamp?.ts || 0);
	const drift = deps
		.map((file) => ({ file, weight: 1 / share.get(file), since: (byFile.get(file) || []).filter((c) => c.ts > baseline) }))
		.filter((d) => d.since.length)
		.sort((a, b) => b.weight - a.weight);
	const signal = drift.reduce((sum, d) => sum + d.weight, 0);
	const status =
		stamp?.kind === 'snapshot' ? 'snapshot'
		: !deps.length ? 'conceptual'
		: signal === 0 ? 'verified'
		: signal >= 1 ? 'stale'
		: 'watch';
	return { doc, status, signal: +signal.toFixed(3), deps: deps.length, drift };
}).sort((a, b) => b.signal - a.signal);

const count = (s) => report.filter((r) => r.status === s).length;
const max = opt('check', null);
if (argv.includes('--json')) {
	// exitCode, not process.exit(): exiting early can cut off a large piped write.
	console.log(JSON.stringify(report.map((r) => ({ ...r, drift: r.drift.map((d) => ({ ...d, since: d.since.map((c) => `${c.sha.slice(0, 9)} ${c.subject}`) })) })), null, 2));
} else {
	console.log(`${report.length} docs: ${['stale', 'watch', 'verified', 'conceptual', 'snapshot'].map((s) => `${count(s)} ${s}`).join(', ')}\n`);
	for (const r of report.filter((x) => x.status === 'stale').slice(0, Number(opt('top', 10)))) {
		console.log(`${r.signal.toFixed(2).padStart(6)}  ${r.doc}`);
		for (const d of r.drift.slice(0, 2)) console.log(`        ${d.file} (weight ${d.weight.toFixed(2)}): ${d.since[0].sha.slice(0, 9)} ${d.since[0].subject.slice(0, 70)}`);
	}
}
if (max !== null && count('stale') > Number(max)) {
	console.error(`\n${count('stale')} stale docs, budget ${max}.`);
	process.exitCode = 1;
}
```

One bug I hit while writing it, kept in as a comment because you will hit it too: the first version called `process.exit(0)` right after printing the JSON report, and piping that output into another program cut it off at exactly 128 KB. Setting `process.exitCode` and letting Node exit on its own fixed it.

### 11.1 Watch it work in sixty seconds

This builds a throwaway repository with three docs (a setup guide, an incident record, and a design note that names no code) and walks the full lifecycle. The `sleep 1` calls matter; section 13.4 explains why.

```bash
mkdir drift-demo && cd drift-demo && git init -q
cp /path/to/doc-drift.mjs .
mkdir -p docs src
echo 'export const PORT = 8080;' > src/server.js
echo 'export const RETRIES = 3;' > src/boot.js
printf '# Setup\n\nThe server in `src/server.js` listens on port 8080.\n' > docs/setup.md
printf '# Incident 2026-03-02\n\nBoot retried 3 times (`src/boot.js`) and gave up.\n' > docs/incident-2026-03-02.md
printf '# Design notes\n\nWhy we chose a monolith.\n' > docs/design.md
git add docs src && git commit -qm "docs: setup guide, incident record, design notes"; sleep 1

# The code moves. Neither doc does.
echo 'export const PORT = 9090;' > src/server.js
echo 'export const RETRIES = 5;' > src/boot.js
git commit -qam "feat: port 9090, five boot retries"; sleep 1
node doc-drift.mjs --check 0
```

Real output from running exactly that on 2026-10-08 (your hashes will differ):

```
3 docs: 2 stale, 0 watch, 0 verified, 1 conceptual, 0 snapshot

  1.00  docs/incident-2026-03-02.md
        src/boot.js (weight 1.00): 9d2b1369d feat: port 9090, five boot retries
  1.00  docs/setup.md
        src/server.js (weight 1.00): 9d2b1369d feat: port 9090, five boot retries

2 stale docs, budget 0.
```

The exit code is 1. Now resolve both, the right way for each: fix the setup guide, and mark the incident as a record, because an incident writeup that said "retried 3 times" was true on the day and must stay that way.

```bash
sed -i 's/8080/9090/' docs/setup.md && git commit -qam "docs(setup): the port is 9090 now"; sleep 1
node doc-drift.mjs --stamp docs/incident-2026-03-02.md --snapshot
node doc-drift.mjs --check 0
```

```
Stamped docs/incident-2026-03-02.md as snapshot at 7af8a68a8.
3 docs: 0 stale, 0 watch, 1 verified, 1 conceptual, 1 snapshot
```

(On macOS, use `sed -i ''` instead of `sed -i`.) Now the false positive every team meets in week one: a commit that touches the file without changing anything the doc says.

```bash
echo '// bind on all interfaces' >> src/server.js && git commit -qam "chore(server): add a comment"; sleep 1
node doc-drift.mjs
```

```
3 docs: 1 stale, 0 watch, 0 verified, 1 conceptual, 1 snapshot

  1.00  docs/setup.md
        src/server.js (weight 1.00): c029f69ba chore(server): add a comment
```

The setup guide is still correct. Without a second clock you would have to make a cosmetic edit to clear it. With one, you read it and record the fact:

```bash
node doc-drift.mjs --stamp docs/setup.md
node doc-drift.mjs --check 0
```

```
Stamped docs/setup.md as verified at c029f69ba.
3 docs: 0 stale, 0 watch, 1 verified, 1 conceptual, 1 snapshot
```

Commit `.doc-reviews.json` along with any doc edits, so the review is part of history like everything else. Finally, prove the store cannot lie. Hand-edit a stamp to point at a commit that does not exist:

```
$ echo '{"docs/setup.md":{"commit":"deadbeef0","kind":"verified"}}' > .doc-reviews.json
$ node doc-drift.mjs
Error: docs/setup.md: stamped at deadbeef0, which is not a commit in this repo
```

Exit code 1, as it should be. One more thing worth seeing for yourself: in an earlier version of this demo, both docs named `src/server.js`. Each then got a weight of 0.5 and both landed in watch rather than stale. That is the specificity rule working exactly as designed, and it is why the demo gives each doc its own file.

Against our real repository (809 docs, 12,267 commits of history on 2026-10-08), the script runs in about 2 to 3 seconds.

### 11.2 Adapting it to your repository

A checklist for the afternoon:

1. **Point it at your docs.** Change the `docs` filter on line 33 if your docs live elsewhere (a `handbook/` tree, `*.adoc`, per-package READMEs).
2. **Teach it your reference shapes.** Paths and `npm run` are covered. If your docs name Make targets, Gradle tasks, CLI subcommands, or REST routes, add a rule that maps each to the file that implements it. The route rule in section 3.2 is a ten-line template.
3. **Exclude generated output first.** Run it once with `--json`, look for docs with absurd dependency counts and files that appear in hundreds of docs, and add them to `--ignore`. Section 3.5 shows why this changes the answer, not just the noise.
4. **Pick a budget you can hold.** Run it, take today's stale count, and set `--check` to that number. Ratchet it down after each sweep, and record the reason when you do.
5. **Put it in the build that ships the docs.** Write the JSON into whatever your docs site publishes, at build time, from the commit being built. Then render a badge from it.
6. **Give your agents the same view.** If your coding agents have an instruction file, tell them to run the `--doc`-style explanation before trusting a page, and to stamp or fix rather than make cosmetic edits.

---

## 12. The neighbors: link audits and an instruction file that checks itself

Freshness measures whether a doc's prose may have drifted. Two sibling checks cover what can be verified exactly.

### 12.1 `npm run audit:docs`: the mechanical layer

[`scripts/audit-docs.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/audit-docs.mjs) catches the classes of doc rot that have a yes-or-no answer:

1. Relative links in Markdown resolve to a real file on disk.
2. Site links (`/create`, `/docs/x`) resolve to a real route: declared in the page catalog, matched by a route rule, or backed by a file.
3. `npm run <script>` references name a script that exists, and `node scripts/<x>` references name a file that exists.
4. Every directory under `packages/` and `workers/` carries a README.
5. Every public doc is registered in the page catalog, so it reaches the sitemap and `llms.txt` instead of being live and invisible to every crawler.
6. The mirror of that: every doc route declared in the catalog has a Markdown file behind it.

It deliberately skips fenced code and inline code spans (those show templates, not links), external URLs (network-dependent), and generated aggregates. Real output on 2026-10-08:

```
$ npm run audit:docs

Directories required to carry a README.md (7):
  packages/agent-cli  directory has no README.md
  packages/agents-sdk  directory has no README.md
  packages/mcp  directory has no README.md
  packages/mcp-policy  directory has no README.md
  workers/agent-gateway  directory has no README.md
  workers/browser-gateway  directory has no README.md
  workers/signal-bridge  directory has no README.md

docs audit: 7 finding(s) across 1803 files.
```

It ran in just over a second, and yes, it is currently red. One of the seven, `workers/browser-gateway`, is an empty directory on the machine I ran it on and is not in git at all (the audit reads the disk, which is the right call for a local check). The other six are real, committed directories. Hold that thought for section 13.

### 12.2 `npm run check:claude`: the agent instruction file checks its own claims

This is the piece most directly relevant to teams adopting coding agents. [`scripts/check-claude-md.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/check-claude-md.mjs) treats the agent operating file as code with assertions. Its header explains why:

> CLAUDE.md is the operating brain for every agent in this workspace: it names npm scripts, file paths, and runbook steps that agents execute verbatim. When the repo moves and CLAUDE.md doesn't, agents follow instructions into dead ends (a renamed script, a moved runbook, a deleted directory) and burn a session discovering the drift. This check makes that drift a red build instead of a wasted session.

It does not check prose by vibes. It **re-derives each checkable claim from its source of truth** on every run:

- Every `npm run <script>` and every backticked script name in the file must exist in `package.json`.
- Every concrete repo path must exist on disk (placeholders, globs, URLs, and build artifacts are skipped, so it only fails on paths an agent would try to open and not find).
- The scheduled-job count quoted in prose must equal the length of the `crons` array in the config.
- The deploy runbook must list the real build chain, every step, in the real order. This is the assertion that keeps the chain in section 8 honest:

```js
// scripts/check-claude-md.mjs (excerpt)
const chain = (scripts['build:gcp'] || '').match(/npm run ([a-z0-9:._-]+)/g)?.map((s) => s.replace('npm run ', '')) ?? [];
const runbookOrder = chain.filter((step) => md.includes(`\`${step}\``));
const positions = runbookOrder.map((step) => md.indexOf(`\`${step}\``));
const documentedInOrder = positions.every((p, i) => i === 0 || p > positions[i - 1]);
```

- The migration warning must match what the migration script actually does: if the npm script passes `--apply`, the file must say it applies immediately, and if it stops passing `--apply`, the warning must go.
- The documented push remote must actually be configured.
- Every cloud build config must pin the service account the file says it must.
- The subagent definition files are held to the same standard as the main file.

Real output on 2026-10-08:

```
$ npm run check:claude
[check-claude] OK: every script, path, and typography rule in CLAUDE.md matches the repo
```

That "OK" turns out to be the most instructive line in this post. Keep reading.

---

## 13. Honest limits

Everything above is useful. None of it is magic. Here is what git-history staleness cannot do, with a real example for each where we have one.

### 13.1 It detects movement, not wrongness

A comment-only commit makes a doc stale (the demo in 11.1 shows exactly that). A refactor that changes nothing observable makes a doc stale. Our sweeps measured about an 86 percent hit rate (section 10), which means roughly one flagged doc in seven was already right. That is good enough to act on and bad enough that you need the second clock, or people will learn to ignore the signal. The real example from section 7, the avatar thumbnails doc, is typical: the drifted commit added a behavior the doc does not mention, and a human has to decide whether that omission matters.

### 13.2 It cannot see claims that name nothing

If a doc says "the server listens on 8080" without naming the file that sets the port, the measurement has no edge to follow. The same goes for behavior that lives in environment configuration, infrastructure, a database, or a third-party API: none of it is in the file graph. Docs that name no code at all are honestly labeled conceptual and never measured. The practical consequence is a writing rule: **name the file that is the source of truth**, because a named file is a checkable claim and an unnamed one is not.

### 13.3 Extraction has blind spots

Our extractor binds a reference by its repo-relative path. A link like `[selfie-capture.js](../src/selfie-capture.js)` has a bare filename as its visible text and a parent-relative path as its target, and the extractor does not resolve `../` against the doc's directory, so neither form binds. I confirmed this on 2026-10-08 with our avatar creation doc: it links three such source files, all of which exist, and none of the three appears among the 7 files the live report says it documents. The script in section 11 resolves relative links against the doc's own directory and binds 10 files for the same doc; the difference is exactly those three links. There will be others in your repo, which is why the first `--json` run is worth reading by hand.

### 13.4 Timestamps are not ancestry

The clock is the committer timestamp, and comparisons are strict. That has three consequences. A code change committed in the same second as the doc edit is invisible (hence the `sleep 1` calls in the demo, which you will never need in a real repo but will notice in a scripted one). Rebases and cherry-picks rewrite committer dates. And a commit made on a long-lived branch before a doc was edited on main, then merged after, carries its older timestamp, so it is filtered out even though it landed after the doc was last checked. A fully correct version would ask "is this commit an ancestor of the doc's baseline commit?" instead of comparing dates. For trunk-based teams the date approximation is very close. For teams with long-lived branches, it is worth the extra `git merge-base --is-ancestor` calls.

### 13.5 The weighting hides shared-file drift by design

The route table is named by 72 docs. When it changes, each of them moves by 0.014, and the one doc that really is the route-table reference will not cross the line on that file alone. In production on 2026-10-01, 472 of 809 docs sat in watch. Watch is a large, quiet bucket, and in practice nobody works it. That is a deliberate tradeoff, but it is a tradeoff.

### 13.6 A review stamp is trust, not proof

A stamp records that someone claims to have checked a doc against a commit. It does not record what they checked. Every one of the 111 stamps in our store today says `"by": "agent"`, which is the default, and the sweeps that recorded them were run by AI coding agents. The note field is free text. If your team needs reviews to carry accountability, require a named reviewer and keep stamps in the same review process as code.

### 13.7 A gate that is not in the ship path drifts red

This is the one I most want other teams to learn from us rather than repeat. `check:docs-freshness` runs in `npm run gate`, which is run on demand. The deploy pipeline regenerates the report (section 8) but does not enforce the budget. Stale went from 0 on 2026-09-18 to 64 at the 2026-10-01 deploy and 69 on 2026-10-08, more than ten times the budget of 5, and the 2026-10-01 deploy shipped normally with the gate in that state, because nothing in the deploy path asks. `audit:docs` is in the same position and is red today with 7 findings. The badges kept telling readers the truth the whole time, which is the system working. But the queue was not worked, because nothing forced it to be. If drift matters to you, either put the budget check in the path that ships, or schedule the sweep the way you schedule dependency updates.

### 13.8 A guard keyed to the wording of a claim stops guarding when the wording changes

And now the "OK" from section 12.2. The agent operating file states that README coverage under `packages/`, `workers/`, and `services/` is 100 percent. One of its assertions exists to check exactly that claim, and it only fires when the file contains the phrase "is currently 100%":

```js
// scripts/check-claude-md.mjs (excerpt)
if (coverageGaps.length && /Coverage under `packages\/`, `workers\/`, and `services\/` is currently 100%/.test(md)) {
```

On 2026-09-10, commit `5a431ea37` reworded that sentence for a good reason: it quoted directory counts that kept going stale, so the counts were replaced with a command that prints the gaps. That is exactly the advice the file gives itself ("name the source of truth instead of quoting a number from it"). The new sentence says "is 100%" instead of "is currently 100%". The assertion's pattern stopped matching, so the assertion stopped asserting, silently.

Between 2026-09-21 and 2026-09-25, seven new directories were committed without a README: the six real ones `audit:docs` lists in section 12.1, plus one under `services/`, which `audit:docs` does not cover. On 2026-10-08 the operating file still says coverage is 100 percent, the guard says OK, and an agent reading the file has no reason to doubt it.

The lesson generalizes well beyond our repo. **A check that skips itself when its trigger text is missing has a failure mode that looks exactly like success.** If you write assertions about prose, make a missing claim an error ("the README-coverage sentence is gone, either restore it or remove this assertion"), the way the same script already does for its cron-count sentence. And do not take a green check on an instruction file as proof that the file is true; take it as proof that the specific assertions that ran passed.

---

## 14. The lesson for teams adopting AI coding agents

If your team is bringing coding agents into its workflow, your documentation just changed category. It used to be reference material that people consulted with judgment. It is now, in part, a program that agents execute. Three things follow.

**Treat your agent instruction file like code.** Every checkable claim in it (a script name, a path, a count, an order of steps, a safety property like "this command does not write") should be re-derived from its source of truth by a check that runs often. Prefer wording that cannot go stale: point at the source of truth rather than quoting a number from it. And make your checks fail loudly when the claim they guard disappears, not quietly pass.

**Give every doc a machine-readable trust signal, and put it where the agent will see it.** A human skims a "Lightly out of date" badge and adjusts. An agent can be told to run the per-doc explanation before trusting a page, and to treat a stale status as "verify before acting." The signal costs one build step and a few kilobytes per page.

**Let agents do the maintenance, inside guardrails that keep it honest.** On our team the documentation sweeps are run by agents: a queue agent, parallel reviewers with a three-word verdict vocabulary, and a single stamping agent. That works because the guardrails are mechanical. Reviewers must read the exact drifted commits. A verified verdict is as good as an edit, so nobody fakes a change. A dated record cannot be rewritten. A stamp against a commit that does not exist fails the build. Agents are very good at reading 110 docs against 110 sets of commits in an afternoon. They are not good at knowing which docs are history unless something tells them.

The underlying point is older than any of this. A document that cannot tell you whether to trust it is asking for blind trust, and blind trust in a document has always been a bad deal. The new part is that some of the readers now extend blind trust by default. Give them, and your people, a signal that is honest about its own age.

---

## 15. Questions for the group

If you want to see the moving parts, the [doc freshness reference](https://three.ws/docs/doc-freshness?utm_source=ibm-community) describes the system end to end, the [freshness dashboard](https://three.ws/docs/freshness?utm_source=ibm-community) shows the live ranking with every drifted file and commit, and the [three.ws changelog](https://three.ws/changelog?utm_source=ibm-community) carries the 2026-09-17 entry where this shipped to readers, titled "Documentation that tells you whether to trust it."

I would genuinely like to hear how other teams in this group handle this:

1. **How do you keep agent instruction files true?** If your coding agents read an `AGENTS.md`, a rules file, or a runbook before they act, what checks it, and how often? Have you had an agent follow a stale instruction into a real incident?
2. **Where does your docs check live relative to your ship path?** We regenerate the signal on every deploy but only enforce the budget on demand, and section 13.7 shows the result. Has anyone made a docs budget a hard deploy gate without it turning into a rubber stamp that everyone raises?
3. **What do your docs depend on that is not a file?** Environment configuration, infrastructure definitions, third-party API behavior, database schemas: if you have bound docs to any of those, I would love to compare approaches.

Run the script from section 11 against your own repository and post your stale count and your weirdest false positive. Mine is a doc that went stale because someone added a comment.
