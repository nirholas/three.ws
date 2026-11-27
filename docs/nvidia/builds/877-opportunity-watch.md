# Design: a watch for NVIDIA contests, calls and events

**Status:** planned, not built. Work order: [877](../../../prompts/finish/877-nvidia-27-nvidia-contest-and-event-watch.md). Written 2026-11-26. Part of the [NVIDIA build plan](README.md).

## What it is

A small scheduled job that reads NVIDIA's public feeds twice a day and tells us
when something opens that we could enter: a contest, a hackathon, a call for
speakers or posters, a startup pitch, a pavilion application, a credits
program. One alert per opportunity, with the deadline when the text states one.

## Why build it

- Contests are the one NVIDIA surface that promises in advance to feature the
  winners. The Cosmos Cookoff (early 2026, more than 1,600 participants) gave
  winners a livestream and a LinkedIn article. The 2025 G-Assist Plug-in
  Hackathon put its top three on NVIDIA's social accounts
  ([research, how NVIDIA tells startup stories](../../nvidia-showcase-research.md)).
- We entered neither, because nobody saw them open.
- It is cheap: no GPU, no new vendor, a few feed requests a day.

## What exists today

| Piece | Where | What it does |
|---|---|---|
| The pattern to copy | [api/cron/free-model-audit.js](../../../api/cron/free-model-audit.js) | A scheduled handler that checks an outside source, remembers what it has seen, and sends one alert per new item |
| Alerts | [api/_lib/alerts.js](../../../api/_lib/alerts.js) | `sendOpsAlert`, the channel the team already reads |
| Scheduling | [api/_lib/cron-tick.js](../../../api/_lib/cron-tick.js), [docs/ops/gcp-production.md](../../ops/gcp-production.md) | One Cloud Scheduler job ticks every minute and fires whatever is due from our cron list. A new cron is one entry in that list and starts with the next API deploy. No scheduler job is created by hand. |
| The LLM chain | [api/_lib/llm.js](../../../api/_lib/llm.js) | For the one-line summary of each opportunity |

## Design

```
twice a day
    |
source readers  -- NVIDIA blog feed, developer blog feed, developer forum feeds, GTC startup pages
    |              (each with a timeout and size cap; one failing source never fails the run)
classifier      -- explicit, unit-tested rules decide "is this an opportunity?" and pull out a deadline
    |              an LLM writes the one-line summary only
seen set        -- one alert per opportunity, ever
    |
alert  +  a dated row in docs/nvidia-opportunities.md
```

- **Rules decide, the model only summarizes.** Whether something is an
  opportunity is decided by explicit rules tested on real titles, including the
  two contests we missed as positive cases and ordinary product news as negative
  ones. That keeps it predictable.
- **Sources are verified by fetching them** before they are relied on, and a
  source that moves or dies is reported in the run, not silently dropped.
- **A place to look.** `docs/nvidia-opportunities.md` holds open and past
  opportunities with their sources. It is seeded with what is known today: GTC
  Washington, D.C. (2026-12-01 to 12-03), GTC 2027 (2027-03-15 to 03-18), and
  the two past contests and what their winners received.

## Phases

| Phase | Exit condition |
|---|---|
| 1. Sources | Each feed fetched and recorded with status, type and a sample item |
| 2. Readers and classifier | Parser tests on saved real feed samples; classifier tests on real titles |
| 3. The cron | One entry in the cron list; the tick's own due-check proves the schedule in a test |
| 4. Dedupe | A second run alerts nothing |
| 5. Real run | The handler run once locally against the live feeds, output in the report |
| 6. Docs | The opportunities doc and an ops note beside the other crons |

## The numbers it leaves behind

Sources watched, opportunities found on the first real run with their
deadlines, and zero duplicate alerts on the second run.

## Cost

A few HTTP requests and one small LLM call per new item, twice a day.

## Risks and fallbacks

| Risk | What we do |
|---|---|
| A feed changes shape or disappears | That source is marked failing in the run and alerted once; the others carry on |
| Too many false alarms | The rules are tightened with the false positive added as a test case |
| It only starts after a deploy | True for every cron. Until then the handler can be run by hand. |

## Owner steps

Push and deploy. After that it runs by itself. When an alert arrives, decide
whether to enter.

## What we can say, and when

Nothing public. This build exists so we are in the next contest.
