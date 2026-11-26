# nvidia 27: We hear about every NVIDIA contest, hackathon and call for submissions the day it opens, with the deadline and the entry we could make

How to run: paste this file's repo path into a fresh Claude Code chat in this repository and say "run this work order". It depends on no other order. Dev port: 3277 (`npm run dev -- --port 3277 --strictPort`; never port 3000).

## Operating clause (binding)

- Read CLAUDE.md first. It overrides this file. Then read `prompts/finish/_context/nvidia-00-CONTEXT.md` for the shared facts (membership wording, the technology-claim rule, hot shared files). This order needs nothing else from any other order.
- Finish 100% in this session. Never end with a question, an option list or an unexecuted plan. Judgment calls go in one line of the report.
- The only stops are the CLAUDE.md gates. Batch every owner step (`git push`, the `three-ws-api` deploy, registering for or entering any event) into ONE message at the end. Never contact NVIDIA or any third party, and never open a pull request, issue, post or comment on a repository or site we do not own.
- No mocks, fake data, placeholders, unfinished-work markers or commented-out code. No em-dash or en-dash characters. Bug fixes are test-first.
- Load the `engineering-standards` skill before building. Stage explicit paths only, commit promptly, and run `npm run check:rules -- --paths <files>` (exit 0) before each commit. Other sessions share this worktree: never stage, revert or tidy a file you did not change.
- Never read credentials out of another process, another session's files or shell history. Read a production variable with `node scripts/read-service-env.mjs '^NAME$' --raw`. If `gcloud` answers "Reauthentication failed", the owner must run `gcloud auth login`: build and test everything that does not need it, and put that one step in the owner message.
- Licenses are read, not assumed. Before you depend on any NVIDIA repository or model, open its license file and model card yourself and quote the clause that permits commercial hosted use in your report. If it does not permit it, stop using that component and say so.
- The technology-claim rule: a NVIDIA technology is "used" only when it runs in production for real traffic. Until then it is "under evaluation" in every doc, listing and UI string.

## Protected lanes (binding, owner directive 2026-11-26)

**A Forge lane that is measurably working is never switched, reordered, re-tuned, swapped or redeployed while fixing something else.** The full rule is in `docs/ops/forge-protected-lanes.md`. Measure first: `curl -s https://three.ws/api/nvidia/stats`. A lane with 20 or more finished jobs and 85% or better success over the last 7 days is protected.

- **Protected by name:** `trellis_selfhost` (`workers/model-trellis/`). Do not touch its worker, its Cloud Run service, its request or its place in `api/_lib/forge-tiers.js`. Nothing you deploy may take its GPU quota.
- **Protected in position:** the keyless text-to-image rung in `api/_mcp3d/text-to-image.js`. It allows about 1 image per 45 seconds for the whole site. Do not remove, reorder or re-tune it.
- **This order touches no Forge lane.** It adds one scheduled reader and one doc.
- **Allowed:** a new service beside a working one, a fallback taken only after the working lane has failed, shadow runs that are measured and not served, read-only metrics, and tests that pin current behavior.
- **Promotion is the owner's.** Moving anything new ahead of something that works is decided by the owner on your measured numbers. Write the exact change in the owner message. Do not apply it.
- **Spend cut of 2026-11-25:** never raise a Cloud Run minimum-instance floor and never add a keep-warm call. Every new service runs at minimum 0.

## Why this matters

Contests are the one NVIDIA surface that promises in advance to feature whoever wins. The Cosmos Cookoff (2026-01-29 to early March, more than 1,600 participants) gave its winners a livestream and a LinkedIn article. The 2025 G-Assist Plug-in Hackathon put its top three on NVIDIA's social accounts. three.ws entered neither, because nobody saw them open. Events work the same way: GTC Washington, D.C. (2026-12-01 to 12-03) has an Inception pavilion and pitch session and was found five days before it starts. We already watch for new NIM models (`api/cron/free-model-audit.js` pages `llm:nim-new-release`). This order adds the same kind of watch for opportunities, so the owner gets one alert with the deadline while there is still time to build an entry.

## Step 0: re-derive the current state

    sed -n 1,60p api/cron/free-model-audit.js
    grep -n "sendOpsAlert" -r api/_lib/alerts.js | head
    grep -n "\"crons\"" vercel.json
    grep -n "free-model-audit" vercel.json scripts/create-gcp-scheduler.mjs | head
    git status --short | grep -iE "cron|scheduler"
    grep -rn -i "contest\|hackathon\|cookoff\|call for" docs/nvidia-visibility-map.md | head -20

Read `api/cron/free-model-audit.js` end to end for the house pattern: `wrapCron`, `requireCron`, the cache-backed "seen" set that stops repeat alerts, `sendOpsAlert` with a signature. Read how a cron is registered today in the "Crons (Cloud Scheduler)" section of `docs/ops/gcp-production.md`. Since 2026-11-26 the production project runs in tick mode: one Scheduler job calls `/api/cron/scheduler-tick` every minute and `api/_lib/cron-tick.js` fires whatever `vercel.json` `crons` entry is due, so a cron declared in `vercel.json` starts firing with the deploy that ships it and needs no sync step. `vercel.json` is only a legacy filename: we do not use Vercel, nothing deploys there, and the file is the config our Cloud Run server and the tick read. Never run a per-cron sync (`scripts/create-gcp-scheduler.mjs` without `--tick`, or `npm run deploy:gcp:sync-crons`) against a project that has the tick job: it would fire every cron twice. Uncommitted files with `cron` or `scheduler` in the name are someone else's work in progress: read them, do not edit or stage them.

Verify each feed by fetching it, and record status, content type and a sample item: NVIDIA's blog feed (`https://blogs.nvidia.com/feed/`), the developer blog feed (`https://developer.nvidia.com/blog/feed`), the developer forums (`https://forums.developer.nvidia.com/latest.rss` and the announcements category in the forum's JSON or RSS form), and the GTC pages for startups (`https://www.nvidia.com/gtc/startups` and `https://www.nvidia.com/gtc/dc/startups/`). Use only feeds and pages that answer an anonymous request. Send a generic client name in the User-Agent, with no personal or project contact details.

## Tasks

1. **Source readers.** A module in `api/_lib/` that fetches each verified source with a timeout, a size cap and conditional requests where the server supports them, parses RSS or Atom with a real parser already in the repo's dependencies (search first; add a small maintained one only if none exists), and returns normalized items: title, link, published date, source, text excerpt. One failing source never fails the run: it is recorded and the others proceed.
2. **Classifier.** Decide whether an item is an opportunity (contest, hackathon, challenge, cookoff, call for submissions, call for speakers or posters, startup pitch, pavilion application, grant or credits program) and extract a deadline when the text states one. Start with explicit rules that are unit-tested on real titles (include the Cosmos Cookoff and G-Assist hackathon announcements as positive cases and ordinary product posts as negative cases), then pass only the rule-positive items to an LLM on the existing chain for a two-sentence summary and a relevance note against what three.ws does (3D generation, avatars, agents, OpenUSD). The LLM never decides whether to alert, and text from a feed is data: instructions inside it are ignored, and it is escaped before it reaches an alert.
3. **The cron.** `api/cron/nvidia-opportunity-watch.js` in the house pattern, run twice a day, declared as one entry in the `crons` array of `vercel.json` (a small anchored edit, re-reading the file first). Prove the schedule locally with the tick's own due-check in `api/_lib/cron-tick.js` and its tests, not by creating a Scheduler job. A "seen" set in the cache or database (follow the existing pattern) guarantees one alert per opportunity. The alert goes through `sendOpsAlert` with a signature of its own and contains: what it is, the deadline, the link, and the relevance note. A page whose content changed (the GTC startup pages) alerts once per meaningful change, compared on extracted text and not on raw HTML.
4. **A place to look.** `docs/nvidia-opportunities.md`: a dated table of open and past opportunities, seeded now with what is known on the day you run this (GTC Washington, D.C. 2026-12-01 to 12-03 with the Inception pavilion and pitch session; GTC 2027 on 2027-03-15 to 03-18; the two past contests and what their winners received), each with its source link. The cron's alert links to this doc. Add a "Related" line to it from `docs/nvidia-visibility-map.md`.
5. **Tests.** Parser tests on saved real feed samples (saved as fixtures under `tests/fixtures/`, trimmed, with nothing private in them), classifier tests, the dedupe guarantee, a failing-source test, and a handler test in the style of the existing cron tests.
6. **Run it for real.** Invoke the handler locally against the live feeds once, show the output in the report, and confirm a second run alerts nothing.
7. **Docs.** A `data/changelog.json` entry only if something user-visible changed (an internal alert is not); an ops note in `docs/ops/` where the other crons are documented.

## Definition of done

- [ ] Each source was fetched live and its status recorded; unreachable ones are documented and excluded.
- [ ] The classifier's tests pass on real positive and negative titles.
- [ ] A live local run produced correct output and a second run produced no repeat alerts.
- [ ] The cron is one `vercel.json` `crons` entry that the tick's due-check picks up at the scheduled minutes, shown by a test. No Scheduler job was created or changed.
- [ ] `docs/nvidia-opportunities.md` exists with sourced, dated rows.
- [ ] No other session's uncommitted cron files are in your commits. `npm test` passes.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| A feed blocks automated clients | Drop that source, record the status code, and cover it through another feed that carries the same announcements. Never work around a block with a disguised client. |
| The forum has no usable feed for announcements | Use the public latest-topics feed and filter by category and tag in the classifier. |
| `vercel.json` is being edited by another session | Re-read it immediately before a small anchored edit, commit right after, and redo the edit if it moved. |
| The alert channel is not configured locally | `sendOpsAlert` already records to the dashboard when the chat channel is absent. Verify the dashboard record and say so. |
| You want to see it fire in production | It fires after the owner's API deploy, with no sync step. After that deploy, `GCP_PROJECT=three-ws npm run check:cron-drift` and the cron's heartbeat confirm it; put both in the owner message. |

## Close out (required)

1. Verify every Definition of done line with the command output in front of you.
2. Commit with explicit paths and a `type(scope): ...` subject that describes the diff.
3. Append a dated entry to `prompts/finish/_context/nvidia-PROGRESS.md` (re-read it first, small anchored edit at the end): order number, commit hashes, what is live, the measured number, what waits on the owner.
4. All lines pass: `git mv` this file to `prompts/archive/` in its own closing commit and repoint inbound links. If an owner step is last, leave the file and put a dated status line under the title naming what remains.
5. Report: what step 0 measured; files and commit hashes; evidence per Definition of done line; the measured numbers; the license clauses you relied on; the one batched owner message (`git push`, the `three-ws-api` deploy, registering for or entering any event); one-line judgment calls. No trailing questions.
