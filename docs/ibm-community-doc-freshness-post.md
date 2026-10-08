---
title: "Documentation drift detection from git history: docs that tell readers, and AI agents, whether to trust them"
venue: IBM Community, Three.ws User Group (blog post)
account: nich (nich8)
description: "A long technical write-up for IBM developers, engineering leads, and platform teams: how three.ws binds every doc to the source files it names, asks git what moved since the doc was last written or reviewed, records human reviews against a specific commit, exempts dated records from rewriting, regenerates the result inside the deploy build, and shows every reader a freshness status. Includes real command output, ten weeks of measured history, a zero-dependency Node script readers can run on their own repo in an afternoon, the honest limits of git-history staleness, and the lesson for teams whose docs are now read as instructions by AI coding agents."
status: draft, not yet posted
meta_title: "Documentation Drift Detection from Git History"
meta_description: "Bind each doc to the code it names, ask git what changed since it was last checked, and show readers and AI agents a freshness status. Runnable script."
slug: documentation-drift-detection-git-history
featured_image: "https://three.ws/api/page-og?v=carbon&f=group&s=learn&t=Documentation+that+tells+you+whether+to+trust+it&d=Measure+doc+drift+against+git+history%2C+record+human+reviews+against+a+commit%2C+and+show+every+reader+a+freshness+status.&p=%2Fdocs%2Ffreshness"
framing_notes: |
  Every framing rule in docs/ibm.md applies. three.ws is an IBM Business Partner, and
  nothing in this post is an IBM product, uses an IBM service, or had IBM involvement:
  the freshness system is three.ws engineering practice built on git and Node.js. The
  affiliation line near the top says so and must survive any edit.
  Per docs/ops/seo-keyword-plan.md this is a standalone tutorial with no crypto-cluster
  content. Every quoted doc path, command row, and commit subject was chosen to carry
  none; rows of real output that did were removed and the removal is marked in the text.
  Featured image: the ?v=carbon card with &f=group, which renders the footer
  "Three.ws User Group" instead of "Built on IBM watsonx.ai" (api/page-og.js,
  CARBON_FOOTERS). That footer needs the deploy carrying the f= parameter; on an older
  revision the parameter is ignored and the watsonx footer renders, so confirm the live
  card before setting it as the featured image.
  All numbers are dated in the text. Production figures are from the deploy of commit
  76081013b (2026-10-01); local figures are from commit fe2a8b24f (2026-10-08). Re-run
  `npm run check:docs-freshness` and re-read https://three.ws/docs-freshness-summary.json
  before posting, and refresh sections 9 and 10 if they moved.
  Canonical URL: leave blank (original post).
---

# Documentation drift detection from git history: docs that tell readers, and AI agents, whether to trust them

_Posted in the [Three.ws User Group](https://community.ibm.com/community/user/groups/community-home?communitykey=e71510cc-d953-408f-9a1c-019f5c0a7016) on IBM Community._

Nobody edits a document to make it wrong. The code it describes moves, and the page keeps saying what used to be true. For most of software history the only signal that a doc had rotted was a confused reader.

That was tolerable when every reader was a person who could notice a failed command and go ask someone. It is not tolerable anymore, because documentation now has a second reader: the AI coding agent. Agents read your README, your runbooks, and your agent instruction files, and they act on what those say. A human treats a stale sentence as a hint that something is off. An agent treats it as an instruction.

This post is a complete tour of how three.ws handles that. Every doc in our repository is bound to the source files it names, and git decides whether any of those files moved after the doc was last written or last reviewed. The result is a status per doc, a ranked work queue for the people who fix docs, and a small badge at the top of every published doc page that tells the reader how much to trust it. The measurement is regenerated inside the deploy build, so the badge describes the commit that is actually serving.

It is a general engineering practice, not a product. Nothing here depends on our stack beyond git and Node.js, and section 11 gives you a zero-dependency script you can run against your own repository this afternoon.

**The affiliation, stated exactly.** three.ws is an IBM Business Partner. The system described here is three.ws's own engineering practice, built on git and Node.js. It is not an IBM product, it does not use any IBM service, and IBM had no involvement in it. I am sharing it because the problem it solves is one every team adopting AI coding agents will meet.

**Contents**

1. Why stale docs got more expensive
2. The model in one paragraph
3. What "stale" is computed from
4. Five statuses, and why two of them are not failures
5. The second clock: recording a review against a commit
6. Records of a moment: why dated docs are exempt
7. Working the queue
8. Where it runs, and why it runs before the frontend build
9. What readers see
10. What ten weeks of history say
11. Build your own in an afternoon
12. The neighbors: link audits and an instruction file that checks itself
13. Honest limits
14. The lesson for teams adopting AI coding agents
15. Questions for the group

---

## 1. Why stale docs got more expensive

three.ws is built by a small human team working alongside AI coding agents. The agents write code, run builds, prepare deploys, and, as you will see, do most of the documentation repair. They all start from an operating file at the root of the repository (ours is `CLAUDE.md`; many teams use [AGENTS.md](https://agents.md/) or a similar convention) plus whatever docs the task leads them into.

That file has a section called "Keeping this file true," which opens with the clearest statement of the problem I know:

> This file is the operating brain for every agent here, and agents execute what it says verbatim. A stale line in it does not read as stale, it reads as an instruction, and the cost is a wasted session per drift.

The script that guards that file (section 12) records in its comments the drifts that actually happened:

- The file once described a database migration command as a dry run. The npm wrapper hardcodes `--apply`, so the "dry run" writes to the production database immediately. An agent told a command is safe will run it.
- The file quoted a scheduled-job count. The real list in the config grew from 89 to 100 without anyone updating the sentence.
- The file told agents to push with `git push threews main`. On 2026-07-30 one worktree had no remote by that name, so the exact command the file prescribes failed.

None of these was dramatic. Each was a small truth that stopped being true, read by a reader that does not second-guess. The same applies to every runbook that names a script, every tutorial that says "run this," and every API reference that lists a route. "Is this doc still true?" stopped being a documentation-quality question and became an operational one.

---

## 2. The model in one paragraph

A doc already tells you what it is about: it names files, `npm run` commands, and `/api/` routes in its own text. Read those references, resolve the ones that point at real source files, and treat them as the doc's dependencies. Ask git one question per dependency: was this file committed to after the doc was last written or last reviewed? Code that moved since then is code the page has never been checked against. Weight each moved file by how exclusively this doc claims it, sum the weights, turn the sum into a status, rank the stale docs into a queue with the exact commits to read, let a reviewer record "I read it and it was right" against a specific commit, and publish the result to every reader.

Everything below is detail, and most of it exists because a simpler version produced noise that taught people to ignore it.

---

## 3. What "stale" is computed from

The implementation is one script, [`scripts/doc-freshness.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/doc-freshness.mjs), run as `npm run docs:freshness`. It needs no annotations. It reads the references authors already write.

**Which docs.** Every Markdown file under `docs/`, plus `README.md`, `STRUCTURE.md` (the map from product surface to directory), and `CLAUDE.md`. Generated aggregates that restate the whole corpus are skipped, for a reason section 3.3 measures.

**What a doc depends on.** Three reference shapes, because those are the three ways our docs name code: literal paths (in backticks, links, or bare prose), `npm run <script>` commands, and `/api/` routes. The `npm run` rule is the one people underestimate. A doc that says "run `npm run docs:review`" never names `scripts/docs-review.mjs`, but depends on it completely, so the script reads `package.json` and binds the files that command executes:

```js
// scripts/doc-freshness.mjs (excerpt)
// npm scripts: a doc telling you to run something depends on what it runs.
for (const m of markdown.matchAll(/npm run ([\w:-]+)/g)) {
	for (const rel of scriptTargets(m[1])) deps.add(rel);
}
```

Each candidate must then survive a resolver that rejects what would flood the graph: files without a code extension, paths outside the directories that hold shippable code, directories, paths that do not exist, and the doc's own filename echoing back at it.

**One pass over history.** Asking git about each dependency separately would be thousands of invocations, so the script reads the whole log once (`git log --format=%x1e%H|%ct|%s --name-only --no-renames`) and indexes it by file and by commit. The committer timestamp, `%ct`, becomes the clock. Section 13 covers what that choice costs.

### 3.1 The baseline and the weight

For each doc, the baseline is whichever is newer: the doc's last commit, or its last recorded review (section 5). Every dependency committed to after that baseline is drift.

Not all drift means the same thing. Our route table, `vercel.json` (a legacy filename; it is the live route config for our own server), is named by 72 docs. If all 72 went red whenever a route was added, the dashboard would be red everywhere and nobody would read it. Excluding shared files outright is wrong too, because the doc that really is about the route table should notice when it changes. So each drifted file is weighted by how exclusively this doc claims it, and the sum becomes a status:

```js
// scripts/doc-freshness.mjs (excerpt)
const specificity = (share) => 1 / Math.max(1, share);

function classify(deps, signal) {
	if (!deps.length) return 'unverifiable';
	if (signal <= 0) return 'fresh';
	if (signal >= 1) return 'stale';
	return 'watch';
}
```

A file only one doc names counts fully; a file forty docs name counts for a fortieth. The source comment calls it what it is: the inverse-document-frequency idea from search ranking, applied to the binding between docs and code. The threshold of 1.0 reads directly as "the equivalent of one file that only this doc documents has changed," which is exactly when a human should re-read the page.

### 3.2 Exclude, do not down-weight

Three classes of file are removed from the graph entirely:

- **Build outputs**: the sitemap, `llms.txt`, changelog feeds, page indexes. The changelog gaining an entry is not evidence that a tutorial went wrong.
- **The machine-translated locale tree.** Until commit `2bf55b582` (2026-08-14), "a translation pass touching a hundred files was reading as a hundred docs going stale."
- **The system's own bookkeeping.** The doc explaining the system names the review store and the budget file, so recording a review pushed that doc straight back to stale: a false positive produced by using the system as intended. Commit `302d0ae31` (2026-09-18) removed both.

### 3.3 One generated file can hide half your drift

Generated aggregates (a concatenated handbook, a generated reference) name nearly every file every other doc names. That does not just make them permanently stale. It doubles the share count of almost every file, which halves every weight, which pushes real drift below the threshold everywhere.

I measured it with the script from section 11, against our repository at commit `fe2a8b24f` on 2026-10-08. With our aggregate `docs/ALL.md` included (it names 2,089 files):

```
809 docs: 58 stale, 359 watch, 165 verified, 227 conceptual, 0 snapshot
```

With it excluded (`--ignore '^docs/(ALL|EVERYTHING)\.md$'`):

```
808 docs: 122 stale, 294 watch, 165 verified, 227 conceptual, 0 snapshot
```

Removing one generated file more than doubled the stale count. Nothing about the other docs changed; the aggregate was diluting everyone's evidence. If you build this, finding your own aggregates is step one.

---

## 4. Five statuses, and why two of them are not failures

| Status | Readers see | Meaning |
|---|---|---|
| `fresh` | Verified | Nothing it documents has changed since it was written or reviewed. |
| `watch` | Watch | Some movement, below the threshold. Worth a skim, not urgent. |
| `stale` | Stale | The equivalent of one file only this doc documents has changed. |
| `unverifiable` | Conceptual | Names no code, so there is nothing to check. Not counted as drift. |
| `snapshot` | Record | A dated record of a moment. Code moving under it is not drift. |

**Conceptual** exists because many good docs name no code: architecture rationale, product narrative, design principles. Calling those stale would be noise that trains people to ignore the signal. They are counted separately (128 of 809 in production on 2026-10-01) so coverage stays visible. **Record** is section 6.

---

## 5. The second clock: recording a review against a commit

The first version had one clock, the doc's last commit, and that clock is wrong in a very common case. Someone reads a page end to end, checks every claim, and finds nothing to fix. The work happened and the doc is verified, but the measurement still says stale because there is no diff. The only ways out were a cosmetic edit, which lies in the history, or a permanent false positive, which teaches everyone that the dashboard cries wolf. Our 2026-08-05 sweep ended with 8 docs stuck like that, and the 2026-09-01 sweep with 10.

A review stamp is the second clock:

```bash
# You read the doc, checked it against the code, and it was right.
npm run docs:review -- docs/forge-pipeline.md --note "lanes, timeouts and failover verified"

# Several at once, against the commit you actually reviewed.
npm run docs:review -- docs/a.md docs/b.md --at 53f2a200f --note "checked in the September sweep"

# A dated record that must not be rewritten to match today's code.
npm run docs:review -- docs/security/review-2026-06-24.md --snapshot
```

Stamps live in one JSON file, sorted by path on write "so two agents stamping different docs never fight." The real entry for the doc that describes this system:

```json
"docs/doc-freshness.md": {
	"commit": "302d0ae31",
	"kind": "verified",
	"by": "agent",
	"note": "re-read against the exclusion change"
}
```

Three decisions worth copying:

- **A stamp records a commit, not a date.** "Reviewed Tuesday" says nothing about which code the reviewer read. "Reviewed against `302d0ae31`" does, and anyone can check that commit out.
- **A stamp naming a commit the repository does not have is a hard error, not a silent skip.** It means a hand edit or a branch that never landed, and a fictional baseline silently suppresses real drift, which is exactly what the system exists to prevent. The gate fails on one, and a unit test (`tests/docs-freshness-reviews.test.js`) checks on every test run that each stamp names an existing Markdown doc, a real commit, and a known kind.
- **The newer clock wins.** A doc edited after its review is measured from the edit, and stamping a doc with uncommitted edits prints a warning, because the stamp cannot mask the pending change.

---

## 6. Records of a moment: why dated docs are exempt

Some docs record a moment rather than describe current behavior: a dated security review, an incident writeup, a test log, a finished work order, an upstream bug report. They name plenty of code, so they always look stale, and they must never be "fixed," because rewriting a security review to match today's code destroys the record it exists to keep.

These get `--snapshot`. Their status becomes `snapshot` regardless of drift, their evidence stays visible, and they are never ranked as work. Six docs carry it today, including two security reviews and an upstream issue draft. Readers see: "This page records what was true at that point, so it is kept as written rather than updated to match today's code."

This matters more with agents in the loop. An agent asked to "bring the docs up to date" will happily rewrite an audit to match current code, because to it the audit is just another stale doc. The snapshot status is a machine-readable statement that the document is history.

---

## 7. Working the queue

The command a writer reaches for is `--doc`, which explains one page and prints its reading list. Real output from 2026-10-08, for the doc about how avatar preview images are rendered:

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

The arithmetic is visible. The regeneration script is named only by this doc, so it counts 1.0; the animation file is shared with 21 other docs, so it counts 1/22. Total 1.045, and the line was crossed by the file this doc alone is responsible for.

Is the doc wrong? I read the commit. It added a two-minute cap per render so one model that never finishes cannot hold a whole pass hostage. Everything the doc says about the script (dry run by default, `--apply` to overwrite, resumable with `--offset`) is still true; it just does not mention the cap. That is the typical case: not a lie, but a missing fact an operator would want. One added sentence or a stamp with a note clears it honestly. That judgment is the part the tool cannot make, and it does not try.

### 7.1 The gate and the ratchet

`npm run check:docs-freshness` is the same measurement in gate mode. It writes nothing, counts stale docs against `maxStale` in a budget file, and fails when over. When under, it prints the slack and tells you to lower the budget, because "a number nobody sees is a number nobody lowers." The budget's history is recorded in the file: 50 at the first measurement (2026-07-31), 15 after the first sweep (2026-08-05), 5 after the sweep that reached zero (2026-09-17).

The gate on 2026-10-08, at commit `fe2a8b24f`, took about two seconds and exited 1. I removed ten of its fifteen table rows because they concern product areas outside this post; the rows shown are untouched:

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

Note who is on that list. `docs/guards.md` and `docs/ops/guard-wiring.md` describe our repository's quality checks, and `STRUCTURE.md`, the map of the whole repo, is in the omitted rows. The docs about the machinery that keeps docs honest drift like everything else, which is the best argument I know for measuring instead of trusting.

### 7.2 Sweeps, run by agents

The queue is drained in sweeps, and ours are run by AI coding agents through a three-phase workflow script:

1. **Queue.** One agent runs the measurement and groups stale docs into batches of at most five by subject, so one reviewer reads each product surface's code once.
2. **Review.** One agent per batch, in parallel. Each must read the drifted commits and the current source, check every concrete claim (routes, environment variables, function names, numbers, paths, UI copy), correct rather than rewrite, and return one verdict per doc: `EDITED`, `VERIFIED`, or `SNAPSHOT`.
3. **Stamp.** One agent records every verdict. Stamping is centralized because the store is one file, and parallel writers would lose stamps to a last-write-wins race.

The workflow's own comment states the point of the second clock: "A doc that was read and found correct is as finished as one that needed a fix... without VERIFIED the queue can only be drained by editing."

---

## 8. Where it runs, and why it runs before the frontend build

The gate (`check:docs-freshness`) belongs to `npm run gate`, our umbrella of repository health checks, which is run on demand. Section 13 is honest about what that has cost.

The measurement itself (`docs:freshness`) runs inside the production build, which is one chained script whose order is load-bearing:

```
check:conflicts → check:browser-graph → check:tdz-bootstrap → ensure:avatar-studio
→ build:info:snapshot → docs:freshness → build:lib:full → build:avatar-sdk → build:chat
→ build → publish:lib → build:info → check:dist → check:pages
```

`docs:freshness` writes the report into `public/`, and the frontend build (`build`, a Vite build) copies `public/` into the deployable output. So the measurement must run before the frontend build, and it does. That placement is what makes the badge honest: every deploy measures the commit being deployed.

You can check this from outside. On 2026-10-08 the live version endpoint and the live summary agreed:

```
$ curl -s https://three.ws/api/version
{"status":"ok","version":"1.5.2","commit":"76081013b368d6754c427f304c14ee58bbc1112e",
 "commitShort":"76081013b", ..., "commitTime":"2026-10-01T19:30:12+00:00",
 "builtAt":"2026-10-01T19:31:45.051Z", ...}

$ curl -s https://three.ws/docs-freshness-summary.json | head -5
{
	"$generated": "npm run docs:freshness (scripts/doc-freshness.mjs)",
	"$doc": "/docs/freshness",
	"generatedAt": "2026-10-01T19:30:52.693Z",
	"commit": "76081013b",
```

Same commit, measured about 40 seconds after the commit and about 52 seconds before the build finished. If you take one idea into your own pipeline, take this one: generate trust signals at build time, from the commit being shipped, and ship them with the artifact.

---

## 9. What readers see

### 9.1 The badge

Every published doc page and tutorial renders a small freshness line above the article, from [`public/doc-freshness.js`](https://github.com/nirholas/three.ws/blob/main/public/doc-freshness.js), loaded by dynamic import so pages without a doc never pay for it. Real badge text, read from the live site with a headless browser on 2026-10-08 (status glyphs omitted):

| Page | Badge |
|---|---|
| [/docs/forge](https://three.ws/docs/forge?utm_source=ibm-community) | **Verified against the code.** Last written Sep 30, 2026. None of the 12 source files this page documents has changed since. |
| /docs/doc-freshness | **Lightly out of date.** Checked against the code Sep 18, 2026. 1 file it documents changed since, so a detail here may have moved. *See what changed* |
| /docs/guards | **The code this page describes has changed.** Checked against the code Sep 17, 2026. 18 files it documents changed since, and nobody has re-checked the page against them. *See what changed* |

The wording rules are written into the module, and they are worth stealing:

- **Say what happened, never what the reader did wrong.** "18 files changed since, and nobody has re-checked the page" is a fact the reader can weigh.
- **A review leads when there is one.** "Checked against the code Sep 17" is a stronger promise than "last written."
- **Only drifted pages link out.** On a verified page the dashboard is a distraction.
- **A missing entry renders nothing.** In the source's words, "an empty box that says 'unknown' is worse for the reader than no box."
- **Never block the content.** The reader came for the doc. Tell them how much to trust it while they read.

### 9.2 Keeping it cheap

The full report carries every drifted file and commit, and on 2026-10-08 the live file was 1.63 MB raw (about 238 KB gzipped). A badge needs five fields per doc, so the script also writes a summary with single-letter keys: 97 KB raw and about 13 KB gzipped for 809 docs, fetched once per page load. A real entry:

```json
"docs/doc-freshness.md": {"s":"watch","g":0.014,"d":"2026-09-18","f":1,"n":5,"v":"2026-09-18"}
```

Status, signal, last edited, files drifted, files known, last reviewed. That signal of 0.014 is 1/72: the one drifted file is the route table. "Lightly out of date" in the most honest sense.

### 9.3 The dashboard

[The docs freshness dashboard](https://three.ws/docs/freshness?utm_source=ibm-community) is the same data for the people who fix docs. On 2026-10-08 its header read "809 docs bound to 4101 source files. Measured at 76081013b on Oct 1, 2026," with one toggle filter per status (64 stale, 472 watch, 139 verified, 128 conceptual, 6 records), a text filter that also matches drifted source files ("which docs moved when this file changed?"), and four sort orders. Each row expands to every drifted file with its weight ("only this doc documents it" or "also documented by N other docs"), the commits behind it, who last checked the page against which commit, and a button that copies that page's `--doc` command.

---

## 10. What ten weeks of history say

The report is committed alongside the code, so its own git history is a time series of documentation health. Totals from committed versions of the report, read with `git show` on 2026-10-08:

| Report date | Docs | Stale | What happened |
|---|---|---|---|
| 2026-07-31 | 469 | 50 | Measurement and dashboard ship; budget set to 50 |
| 2026-08-05 | 484 | 55 to 8 | First sweep: 47 corrected, 8 verified as written |
| 2026-08-14 | 551 | 148 | Nine days of feature work |
| 2026-09-01 | 628 | 174 to 14 | Second sweep: 164 corrected or extended, 10 verified |
| 2026-09-15 | 718 | 106 | Two weeks of feature work |
| 2026-09-18 | 733 | 0 | Third sweep plus review stamps: 82 corrected, 22 verified, 6 records |
| 2026-09-21 | 747 | 13 | Three days later |
| 2026-10-01 | 809 | 64 | Production deploy of `76081013b` |
| 2026-10-08 | 809 | 69 | Local measurement at `fe2a8b24f` |

Three things stand out.

**When it says stale, the doc is usually wrong.** Across the three sweeps, 339 flagged docs were read against the code and 293 were corrected or extended: about 86 percent. The commit messages list what was wrong, and it is the kind of thing readers act on: an environment-variable reference listing two variables no code reads, a runbook whose teardown command now refuses to run without `--force`, a command documented as writing two files when it writes four to two destinations, a tutorial whose sanity check pointed at the hosted platform instead of the stack the reader had just built, retired model names, outdated tool and job counts, and the deploy runbook's build chain.

**The corpus grows fast.** 469 docs to 809 in ten weeks, every new one naming code and drifting from the day it lands.

**Drift comes back on a schedule.** Zero on 2026-09-18, 13 three days later, 64 at the next deploy. A sweep is not a fix. It is maintenance, and it has to recur.

---

## 11. Build your own in an afternoon

Here is a complete, zero-dependency Node.js script implementing the core model: extraction, the one-pass history index, specificity weighting, the five statuses, review stamps with a hard error on unknown commits, a budget gate, and JSON output. It needs Node 18 or newer and git, and it runs from inside any git repository. It is deliberately smaller than ours, and it closes one blind spot ours has (section 13.3) by resolving `../` links against the doc's own directory.

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

One bug from writing it, left in as a comment because you would hit it too: an early version called `process.exit(0)` right after printing the JSON, and piping that output into another program cut it off at exactly 128 KB.

Against our repository (809 docs, 12,267 commits on 2026-10-08) it runs in 2 to 3 seconds.

### 11.1 The full lifecycle in sixty seconds

This builds a throwaway repository with a setup guide, an incident record, and a design note that names no code. (The `sleep 1` calls matter; section 13.4 explains why. On macOS use `sed -i ''`.)

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

Real output from running exactly that on 2026-10-08 (your hashes will differ); the exit code is 1:

```
3 docs: 2 stale, 0 watch, 0 verified, 1 conceptual, 0 snapshot

  1.00  docs/incident-2026-03-02.md
        src/boot.js (weight 1.00): 9d2b1369d feat: port 9090, five boot retries
  1.00  docs/setup.md
        src/server.js (weight 1.00): 9d2b1369d feat: port 9090, five boot retries

2 stale docs, budget 0.
```

Resolve each the right way: fix the setup guide, and mark the incident as a record, because "retried 3 times" was true on the day and must stay that way.

```
$ sed -i 's/8080/9090/' docs/setup.md && git commit -qam "docs(setup): the port is 9090 now"
$ node doc-drift.mjs --stamp docs/incident-2026-03-02.md --snapshot
Stamped docs/incident-2026-03-02.md as snapshot at 7af8a68a8.
$ node doc-drift.mjs --check 0
3 docs: 0 stale, 0 watch, 1 verified, 1 conceptual, 1 snapshot
```

Now the false positive every team meets in week one, a commit that changes nothing the doc says, and the stamp that clears it honestly:

```
$ echo '// bind on all interfaces' >> src/server.js && git commit -qam "chore(server): add a comment"
$ node doc-drift.mjs
3 docs: 1 stale, 0 watch, 0 verified, 1 conceptual, 1 snapshot

  1.00  docs/setup.md
        src/server.js (weight 1.00): c029f69ba chore(server): add a comment
$ node doc-drift.mjs --stamp docs/setup.md
Stamped docs/setup.md as verified at c029f69ba.
$ node doc-drift.mjs --check 0
3 docs: 0 stale, 0 watch, 1 verified, 1 conceptual, 1 snapshot
```

Commit `.doc-reviews.json` with your doc edits, so reviews are history like everything else. Finally, prove the store cannot lie:

```
$ echo '{"docs/setup.md":{"commit":"deadbeef0","kind":"verified"}}' > .doc-reviews.json
$ node doc-drift.mjs
Error: docs/setup.md: stamped at deadbeef0, which is not a commit in this repo
```

Exit code 1. One more thing to see for yourself: in my first draft of this demo, both docs named `src/server.js`, each got a weight of 0.5, and both landed in watch instead of stale. That is the specificity rule working as designed.

### 11.2 Adapting it to your repository

1. **Point it at your docs.** Edit the `docs` filter if yours live elsewhere.
2. **Teach it your reference shapes.** If your docs name Make targets, Gradle tasks, CLI subcommands, or REST routes, add a rule mapping each to the file that implements it, the way the `npm run` rule does.
3. **Exclude generated output first.** Run it once with `--json`, look for docs with absurd dependency counts and files named by hundreds of docs, and `--ignore` them. Section 3.3 shows this changes the answer, not just the noise.
4. **Set a budget you can hold.** Start `--check` at today's stale count and ratchet it down after each sweep, recording why.
5. **Run it in the build that ships the docs.** Write the JSON into what your docs site publishes, from the commit being built, and render a badge from it.
6. **Give your agents the same view.** Tell them, in their instruction file, to check a page's drift before trusting it, and to stamp or fix rather than make cosmetic edits.

---

## 12. The neighbors: link audits and an instruction file that checks itself

Freshness measures whether prose may have drifted. Two sibling checks cover what can be verified exactly.

### 12.1 `npm run audit:docs`

[`scripts/audit-docs.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/audit-docs.mjs) catches the doc rot that has a yes-or-no answer: relative links that resolve to no file, site links that match no route, `npm run` commands naming scripts that no longer exist, `packages/` and `workers/` directories missing a README, and published docs missing from the page catalog (or catalog entries with no doc behind them). It skips code spans, external URLs, and generated aggregates. Real output on 2026-10-08, in about a second:

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

It is red. One of the seven, `workers/browser-gateway`, is an empty directory on the machine I ran it on and is not in git; the other six are real, committed directories. Hold that thought.

### 12.2 `npm run check:claude`

This is the piece most relevant to teams adopting coding agents. [`scripts/check-claude-md.mjs`](https://github.com/nirholas/three.ws/blob/main/scripts/check-claude-md.mjs) treats the agent operating file as code with assertions, because when it drifts, "agents follow instructions into dead ends... and burn a session discovering the drift." It does not judge prose. It **re-derives each checkable claim from its source of truth** on every run:

- every `npm run` script and repo path the file names must exist;
- the quoted scheduled-job count must equal the length of the config's job list;
- the deploy runbook must list every step of the real build chain from section 8, in the real order;
- the migration warning must match whether the npm script actually passes `--apply`;
- the documented push remote must actually be configured;
- every cloud build config must pin the service account the file says it must;
- the agent subagent definitions are held to the same standard.

Real output on 2026-10-08:

```
$ npm run check:claude
[check-claude] OK: every script, path, and typography rule in CLAUDE.md matches the repo
```

That "OK" turns out to be the most instructive line in this post. See section 13.8.

---

## 13. Honest limits

### 13.1 It detects movement, not wrongness

A comment-only commit makes a doc stale, as the demo shows. Our sweeps measured about an 86 percent hit rate, so roughly one flagged doc in seven was already right. Good enough to act on, and bad enough that you need the second clock or people learn to ignore the signal.

### 13.2 It cannot see claims that name nothing

If a doc says "the server listens on 8080" without naming the file that sets the port, there is no edge to follow. Behavior that lives in environment configuration, infrastructure, a database, or a third-party API is not in the file graph either. The practical consequence is a writing rule: **name the file that is the source of truth**, because a named file is a checkable claim.

### 13.3 Extraction has blind spots

Our extractor binds references by repo-relative path and does not resolve `../` against the doc's directory. A link like `[selfie-capture.js](../src/selfie-capture.js)` therefore binds in neither form. On 2026-10-08 our avatar creation doc linked three such source files, all of which exist, and none appeared among the 7 files the live report says it documents. The section 11 script binds 10 files for the same doc; the difference is exactly those three. Your repo will have its own gaps, which is why the first `--json` run is worth reading by hand.

### 13.4 Timestamps are not ancestry

The clock is the committer timestamp, compared strictly. A code change in the same second as the doc edit is invisible (hence the `sleep 1` in the scripted demo). Rebases and cherry-picks rewrite committer dates. And a commit made on a long-lived branch before a doc was edited on main, then merged after, keeps its older timestamp and is filtered out even though it landed later. The fully correct question is "is this commit an ancestor of the doc's baseline?" (`git merge-base --is-ancestor`). For trunk-based teams the date approximation is close; for long-lived branches it is worth the extra calls.

### 13.5 Weighting hides shared-file drift by design

When the route table changes, each of its 72 docs moves by 0.014, and the one doc that really is the route reference will not cross the line on that file alone. In production on 2026-10-01, 472 of 809 docs sat in watch, a large quiet bucket nobody works. A deliberate tradeoff, but a tradeoff.

### 13.6 A review stamp is trust, not proof

A stamp records that someone claims to have checked a doc against a commit, not what they checked. All 111 stamps in our store today say `"by": "agent"`, the default, and the sweeps that recorded them were run by AI coding agents. If your reviews need accountability, require a named reviewer and keep stamps in your normal review process.

### 13.7 A gate that is not in the ship path drifts red

This is the one I most want other teams to learn from us rather than repeat. The budget check runs on demand. The deploy regenerates the report (section 8) but does not enforce the budget. Stale went from 0 on 2026-09-18 to 64 at the 2026-10-01 deploy and 69 on 2026-10-08, more than ten times the budget, and the 2026-10-01 deploy shipped normally because nothing in the deploy path asks. `audit:docs` is in the same position. The badges told readers the truth throughout, which is the system working, but the queue was not worked because nothing forced it. Put the budget in the path that ships, or schedule the sweep like dependency updates.

### 13.8 A guard keyed to wording stops guarding when the wording changes

Now the "OK." The agent operating file states that README coverage under `packages/`, `workers/`, and `services/` is 100 percent, and one assertion exists to check that claim. It only fires when the file contains the phrase "is currently 100%":

```js
// scripts/check-claude-md.mjs (excerpt)
if (coverageGaps.length && /Coverage under `packages\/`, `workers\/`, and `services\/` is currently 100%/.test(md)) {
```

On 2026-09-10, commit `5a431ea37` reworded that sentence for a good reason: it quoted directory counts that kept going stale, so the counts were replaced with a command that prints the gaps, exactly the file's own advice ("name the source of truth instead of quoting a number from it"). The new sentence says "is 100%," not "is currently 100%." The pattern stopped matching, so the assertion stopped asserting, silently.

Between 2026-09-21 and 2026-09-25, seven directories were committed without a README: the six real ones `audit:docs` lists, plus one under `services/`, which `audit:docs` does not cover. Until 2026-10-08 the operating file said coverage was 100 percent, the guard said OK, and an agent reading the file had no reason to doubt it.

We found it while writing this post, and fixed it the same day. The fix is the lesson. The pattern now accepts the sentence with or without "currently", a rewording that drops the claim entirely is itself a failure rather than a skip, and only directories with committed files count, so an empty scratch directory in a shared worktree cannot fail it:

```js
// scripts/check-claude-md.mjs (excerpt, after the fix)
const claimsFullCoverage = /Coverage under `packages\/`, `workers\/`, and `services\/` is (?:currently )?100%/.test(md);
if (!claimsFullCoverage) {
	failures.push('CLAUDE.md no longer states the 100% README-coverage standard this check enforces; restore the sentence or update check 4d');
} else if (coverageGaps.length) {
```

The first run after the fix went red immediately, naming the directories still without a README. That red is the check working.

The lesson generalizes. **A check that skips itself when its trigger text is missing has a failure mode that looks exactly like success.** When you assert things about prose, make a missing claim an error, the way the same script already does for its job-count sentence. And treat a green check on an instruction file as proof that the assertions which ran passed, not that the file is true.

---

## 14. The lesson for teams adopting AI coding agents

If your team is bringing coding agents into its workflow, your documentation changed category. It used to be reference material people consulted with judgment. It is now, in part, a program agents execute. Three things follow.

**Treat the agent instruction file like code.** Every checkable claim in it (a script name, a path, a count, an order of steps, a safety property like "this command does not write") should be re-derived from its source of truth by a check that runs often. Prefer wording that cannot go stale, and make checks fail loudly when the claim they guard disappears.

**Give every doc a machine-readable trust signal, where the agent will see it.** A human skims "Lightly out of date" and adjusts. An agent can be told to run the per-doc explanation before trusting a page, and to treat stale as "verify before acting." It costs one build step and a few kilobytes per page.

**Let agents do the maintenance, inside guardrails that keep it honest.** Our sweeps work because the guardrails are mechanical: reviewers must read the exact drifted commits, a verified verdict counts as much as an edit so nobody fakes a change, dated records cannot be rewritten, and a stamp against a nonexistent commit fails the build. Agents are very good at reading 110 docs against 110 sets of commits in an afternoon. They are not good at knowing which docs are history unless something tells them.

A document that cannot tell you whether to trust it is asking for blind trust, and that has always been a bad deal. What is new is that some readers now extend blind trust by default. Give them, and your people, a signal that is honest about its own age.

---

## 15. Questions for the group

To see the moving parts, the [doc freshness reference](https://three.ws/docs/doc-freshness?utm_source=ibm-community) describes the system end to end, the [live freshness dashboard](https://three.ws/docs/freshness?utm_source=ibm-community) shows every drifted file and commit, and the [three.ws changelog](https://three.ws/changelog?utm_source=ibm-community) carries the 2026-09-17 entry where this shipped to readers, titled "Documentation that tells you whether to trust it."

I would like to hear how other teams here handle this:

1. **How do you keep agent instruction files true?** If your coding agents read an `AGENTS.md`, a rules file, or a runbook before acting, what checks it, and how often? Has an agent ever followed a stale instruction into a real incident?
2. **Where does your docs check live relative to your ship path?** We regenerate the signal on every deploy but enforce the budget only on demand, and section 13.7 shows the result. Has anyone made a docs budget a hard deploy gate without it becoming a number everyone just raises?
3. **What do your docs depend on that is not a file?** Environment configuration, infrastructure definitions, third-party API behavior, schemas: if you have bound docs to any of those, I would love to compare approaches.

Run the section 11 script against your own repository and post your stale count and your strangest false positive. Mine is a doc that went stale because someone added a comment.
