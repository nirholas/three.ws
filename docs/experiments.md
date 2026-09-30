# Experiments: how we publish what we tried

[/experiments](https://three.ws/experiments) is the public log of what three.ws has tried, what it cost, what the numbers said, and what we got wrong. Every entry is measured from production data, and every number in a write-up comes with the query that produced it, so anyone can check it.

## What is on the page

Each card is one experiment: the question it asked, its status, what it cost in dollars, and the date the write-up was published. The status filter shows running, concluded or killed experiments. A card opens its full write-up, and when an experiment has a live view (for example the trading scoreboard at [/sniper/experiments](https://three.ws/sniper/experiments)) the card links to that as well.

Current write-ups:

- [How many new agents ever launch a coin?](experiments-agent-launch-funnel.md)
- [Can autonomous agents trade new coins at a profit?](experiments-autonomous-trading.md)

## Adding an experiment

1. **Measure first.** Run SELECT-only queries (or a script that only reads) against production data. Pin every time window to fixed timestamps rather than `now()`, so the queries re-run to the same answer later. Never estimate or round a number to make it look better; if something cannot be measured, say "not measured" and why.
2. **Write the write-up** at `docs/experiments-<slug>.md`, with these six sections as `## ` headings, in this order:

   | Section | What goes in it |
   |---|---|
   | The question | One question the experiment answers, and why it matters. |
   | Method | The data window, the tables or tools, the sample size, and what was excluded. |
   | Spend | What the experiment cost, in dollars, and how it was valued. $0 is a valid answer. |
   | Result | The numbers, in tables where possible, and what they say. |
   | What we got wrong | The unflattering part. Publish it. |
   | What we changed because of it | What already changed, and what will change next. |

   Close with an `## Appendix: the queries` section holding every query that produced a number above it, plus the arithmetic for any derived figure.
3. **Add an entry** to [data/experiments.json](https://github.com/nirholas/three.ws/blob/main/data/experiments.json):

   ```json
   {
   	"slug": "agent-launch-funnel",
   	"title": "How many new agents ever launch a coin?",
   	"question": "Of the agents people create on three.ws, how many go on to launch a coin, and where does everyone else stop?",
   	"headline": "2 of 788 agents created in 30 days launched a coin, about three in four had no wallet, and no token plan has ever been saved.",
   	"published": "2026-09-30",
   	"spend_usd": 0,
   	"status": "concluded",
   	"doc": "experiments-agent-launch-funnel",
   	"related": [{ "label": "Live funnel numbers", "href": "/analytics" }]
   }
   ```

   Required: `slug` (lowercase kebab-case), `title`, `question`, `published` (YYYY-MM-DD), `spend_usd` (a number, 0 or more), `status` (`running`, `concluded` or `killed`) and `doc` (always `experiments-<slug>`). Optional: `headline` (the result in one sentence), `live_url` (a site path to a live view) and `related` (extra site links).
4. **Register the page.** Add `/docs/experiments-<slug>` to `data/pages.json`, a link under "Experiments" in `docs/nav.json`, and a `data/changelog.json` entry announcing the write-up.
5. **Build.** `npm run build:pages` validates every entry and writes `public/experiments.json`, which the page reads. It fails on a missing field, an unknown status, a `doc` that does not exist, or a write-up that is missing one of the six sections or has them out of order.

The validator lives in [scripts/lib/experiments-index.mjs](https://github.com/nirholas/three.ws/blob/main/scripts/lib/experiments-index.mjs) and is covered by `tests/experiments-index.test.js`.
