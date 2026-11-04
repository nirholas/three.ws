---
slug: x-content-queue-clear-validator-errors
title: Clear every X content queue validator error and refilm the stale approved posts, stopping before approve
tier: P2
score: 44
area: x-content
sources: docs/announcement-factory.md#Finishing a batch, docs/announcement-factory.md#The factory, docs/announce-voice.md
---

## Why this matters

The announcement factory (`npm run announce:kit`) and the X content pipeline (`data/x-content/queue.json`) are built and enforce strict gates, but the queue itself is stuck. As of 2026-11-03 `npm run x:content -- check` reports 25 problems: nine items already at `approved` or `review` have proof reels older than 20 days and reviews older than 20 days (the pipeline refuses to publish stale proof because "the product moves"), one proof run is failing live (`render-lab-sheet` at step 11, a 45 s `locator.waitFor` timeout expecting 24 renders at 256px, which may be a real production defect), and six items are stuck at `draft` with concrete schema or claim errors. The backlog the factory was built for is large (the docs count about 300 shipped surfaces never announced), so a queue that cannot release anything wastes the whole machine. Posting stays owner-gated; this order gets everything to the owner's approve step.

## Current state (measured by the reviewer on 2026-11-03)

- `data/x-content/queue.json`: 79 items. Status counts: posted 47, review 16, approved 9, draft 6, paused 1 (`intel-globe`, deliberately held for the owner; leave it paused).
- `npm run check:announce` reports "18 pack(s) OK". `data/announce-plan/` does not exist (generated), and `data/announcements.json` is missing, so `npm run announce:plan` fails with "Build it first: npm run announce:rank -- --probe --write".
- Validator output, grouped:
  - Stale proof and review (error): `restyle-presets`, `avatar-embed-moves`, `changelog-feed`, `concierge-ask`, `docs-freshness`, `parts-studio`, `platform-analytics`, `render-lab-call`.
  - `genesis`: the copy, media or claims changed after the last review (re-review).
  - `render-lab-sheet`: last proof run failed at step 11 (expect 24 live renders at 256px), `locator.waitFor` timeout 45000 ms.
  - Claims not quoting the copy: `holo-material-article` (two claims plus an unflagged absolute "Every"), `any-skeleton-article` (three claims), `embed-article` (unverified number "2").
  - Drafts: `three-hold-article` (unverified numbers and absolutes), `three-split` (claims "undefined" and unverified numbers), `grok-bot-recipes` (head post has no media), `skill-md` (covers must list backlog keys; more than one all-caps word in the head), `studio-jobs` (media must be a list of `{ path, alt }`, not `reel`), `agents-board-article`, `voice-article`.
- Pipeline docs: `docs/x-content-pipeline.md` (commands: `check`, `plan`, `scout`, `prove`, `review`, `remix`, `advance`, `pause`, `approve`, `run`), `docs/x-story-authoring.md`, `api/_lib/x-content/{quality,verify,reel,review,queue}.js`.
- `approve`, `run`, `advance --ship` and the `/api/cron/x-content` tick are the owner gate: they publish to X.

## Step 0: re-derive the current state

```
npm run -s x:content -- check 2>&1 | grep -v '^note' | sort | uniq -c | sort -rn | head -60
python3 - <<'PY'
import json,collections
q=json.load(open('data/x-content/queue.json'))
items=q['items'] if isinstance(q,dict) and 'items' in q else q
print(collections.Counter(i.get('status') for i in items))
PY
npm run -s check:announce
curl -s https://three.ws/render-lab -o /dev/null -w '%{http_code}\n'
npx playwright --version; which ffmpeg
```

## Tasks

1. Triage `render-lab-sheet` first because it may be a product defect, not a content defect. Run `npm run x:content -- prove render-lab-sheet` with a headed or traced browser (or `scout https://three.ws/render-lab`), find why 24 renders at 256px do not appear in 45 s (lane cold start, a selector change, a real failure of `src/render-lab.js`). If the page is broken, write a failing test beside the module's tests, fix it, rerun the proof. If only the scenario is stale, update the scenario in the queue item.
2. For every stale-proof item, rerun `npm run x:content -- prove <id>` (films against production, writes `data/x-content/proofs/<id>.json` and `public/x-media/<id>/reel.mp4`) then `npm run x:content -- review <id>` (lint, live fact checks, AI editor). If a live fact no longer holds, fix the copy and claims to what production now shows rather than bypassing the check. Rebuild derived heads with `npm run x:content -- remix <id>` where the item has a `head`.
3. Fix the claim errors by editing the item (never by loosening `quality.js` or `verify.js`): each claim must quote the post text exactly, each number and absolute in the copy must be declared in `claims` with evidence drawn from the brief (`npm run announce:kit -- --id <id> --brief-only` prints the real `evidenceCandidates`), or be cut from the copy. For the draft items: attach real media as `{ path, alt }` entries (capture with `npm run announce:media` or `npm run x:content -- prove`), fix `skill-md` covers to real backlog keys from `data/announce-plan` (build it with Step 0 rank command), remove the extra all-caps word, and decide per item whether it ships (move to `review`) or stays `draft` with a one-line `note` explaining what is missing.
4. Rebuild the announcement backlog so the next batch is ready: run `npm run announce:rank -- --probe --write`, `npm run announce:plan`, then `npm run announce:kit -- --batch 2 --capture` (needs a model: `gcloud auth application-default login` is enough; with none, use `--brief-only` and hand-written drafts at `data/announce-plan/drafts/<id>.json`). Run `npm run check:announce` and `npm run x:content -- review --status review` on the result.
5. Add a regression test beside `tests/x-content.test.js` that fails when the committed queue has any `review`/`approved` item with a stale proof or review older than the configured freshness window, using the queue's own validator (so a future stale item is caught by `npm test`, not discovered at publish time). If the freshness window logic makes that flaky in CI, assert on item shape instead and document why.
6. Update `docs/x-content-pipeline.md` with the "stale proof" recovery recipe you used, and add a `data/changelog.json` entry only if a user-visible production fix landed (task 1).

## Definition of done

- [ ] `npm run -s x:content -- check` exits 0 with no `error` lines for `review` or `approved` items, and every remaining `draft` has a `note` naming what is missing.
- [ ] `npm run check:announce` passes, and `data/x-content/proofs/<id>.json` shows a run from today for every item that was stale.
- [ ] `npx vitest run tests/x-content.test.js tests/announce-factory.test.js` passes.
- [ ] No item moved to `approved` by this order and nothing posted: `git diff data/x-content/queue.json | grep '"status": "approved"'` shows no newly approved items; `intel-globe` is still `paused`.

## Never blocked

| Blocker | Resolution (act, do not ask) |
|---|---|
| No model credentials for drafting or the AI editor | Chain is Vertex Claude, Groq, OpenRouter, OpenAI, NVIDIA (`api/_lib/x-content/llm.js`). Use `gcloud auth application-default login` (approved GCP credits). Without any, run `--brief-only` and write drafts by hand; review's lint and live checks run with no model. |
| No headless browser or ffmpeg for proof reels | `npx playwright install chromium`; install ffmpeg from the OS package manager. Reels film against production with plain GETs. |
| A post's feature is genuinely broken on production | Fix the product (test first) or drop the item to `draft` with a note. Never film around a defect. |

## Gates

Publishing is the owner's step: `npm run x:content -- approve`, `run`, `advance --ship` and the cron tick post to X (external channel). This order must stop before any of them and list the ready item ids in the final report. Any item whose copy names a crypto project other than $THREE needs owner approval before it is committed.
