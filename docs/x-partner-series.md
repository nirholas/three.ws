# The daily partner spotlight

Every day @trythreews features one partner listed on [three.ws/partners](https://three.ws/partners) and one thing three.ws built on that partner's technology. Each spotlight is a thread of a head post and three to five replies, carrying a reel filmed live against production that day, plus a head built for the slot: a card, a GIF, the reel itself, or generated art. It runs inside the [X content pipeline](x-content-pipeline.md), so every rule there (the claims ledger, the language lint, the editor review, the veto window) applies to it too.

| Piece | Where |
|---|---|
| Registry: one file per partner, listing its designation, wording rules and features | [data/x-content/partners/](../data/x-content/partners/) |
| Engine: rotation, brief, drafting, series lint, claims, item | [api/_lib/x-content/partners.js](../api/_lib/x-content/partners.js) |
| CLI | [scripts/x-partners.mjs](../scripts/x-partners.mjs) (`npm run x:partners`) |
| Slot and approval | `slots` and `approval.series` in [data/x-content/queue.json](../data/x-content/queue.json) |
| Tests | [tests/x-content-partners.test.js](../tests/x-content-partners.test.js) |

## The registry

A partner file is the only source the series may draw on. The model never invents a fact: every sentence it can lean on is written here with evidence the claims ledger checks at review.

```json
{
	"id": "ibm",
	"name": "IBM",
	"order": 2,
	"designation": "IBM Business Partner",
	"designationEvidence": [{ "type": "page", "url": "https://three.ws/partners", "contains": "IBM Business Partner" }],
	"page": "https://three.ws/blog/three-ws-ibm-business-partner",
	"handle": "IBM",
	"mark": null,
	"forbidden": ["endorsed by IBM", "official IBM partner"],
	"guidance": "How to talk about this partnership, and what never to say.",
	"docs": ["docs/partners.md"],
	"features": [
		{
			"id": "user-group-in-world-meetup",
			"title": "A meetup inside a 3D world",
			"surface": "https://three.ws/...",
			"covers": [],
			"lane": "community",
			"summary": "One paragraph on what was built and why it matters.",
			"docs": [],
			"scenario": { "format": "square", "steps": [] },
			"probes": [],
			"facts": [{ "says": "a sentence the copy may use", "evidence": [] }]
		}
	]
}
```

| Field | Meaning |
|---|---|
| `order` | Position on the partners page. Ties in the rotation go to the lower number. |
| `designation` | The exact program name. Every spotlight states it word for word. |
| `page` | The partner's page on three.ws. One reply links it. |
| `forbidden` | Phrases that overstate the relationship. Any of them fails the lint. |
| `guidance` | Plain instructions for the writer: what the partnership is, and what it is not. |
| `features[].surface` | The page the head post links. |
| `features[].lane` | `community`, `developer`, `token` or `labs`, the same lanes as the queue. |
| `features[].scenario` | The proof scenario filmed for the reel ([reel.js](../api/_lib/x-content/reel.js) format). Its `read` steps become numbers the copy may quote. |
| `features[].facts` | Sentences with evidence: `page`, `file`, or `proof` (`{ "type": "proof", "fact", "equals" }` checks a value the run read; `{ "saw" }` checks text the run saw). |

`npm run x:partners -- check` validates every file and names each missing piece. A feature that cannot be filmed against production (a surface behind credentials production does not have, say) does not belong in the registry: the series only announces what it has watched working.

Adding a partner: write its file, run `check`, then `one --partner <id> --dry-run` to film and draft it once without touching the queue. Adding a feature to an existing partner works the same way with `--feature`.

## Rotation

`pickNext` chooses the partner seen least recently, breaking ties by `order`, then that partner's least recently featured feature. The head rotates through `card`, `gif`, `reel` and `art`, and the opening pattern through `mechanism`, `walkthrough`, `clip` and `number`, each avoiding the last one used. `number` is only chosen when the feature has a fact with a digit in it, so the series never leads on a number it cannot prove.

History is read from the queue itself: every item with `series: "partners"` carries `spotlight: { partner, feature, head, pattern }` and a `notBefore` day. `--overlay <dir>` adds the spotlights in a materialized production overlay, so a machine whose `queue.json` is older than production still rotates correctly.

Each spotlight takes its own day after every day already held. If today's series slot has already opened and passed, the next spotlight starts tomorrow.

## Drafting

For each missing day, `daily`:

1. Films the feature's scenario against production with `proveItem`. The run's read values (counts, statuses) become facts the copy may quote. A feature whose scenario fails is skipped for the rest of the run, and the next partner in the rotation takes the day.
2. Builds a brief from the registry entry, the head and pattern, and the names of the other partners (so the copy can be checked for partners the feature does not involve).
3. Asks the model chain (`callModelChain`) for `{ post, thread, headline, body, prompt, why }`, with the house voice ([announce-voice.md](announce-voice.md)) and the keeper exemplar in the system prompt.
4. Lints the draft and sends every finding back for a rewrite, up to three attempts.
5. Builds the queue item (`itemFor`), attaches the reel, builds the head from it (`rebuildHead`), validates it, writes the story to `data/x-content/stories/<id>.json`, and hands it to `x:content adopt` and `advance`.

The series lint (`seriesFindings`) adds these rules on top of the pipeline's own:

- The designation appears word for word. No `forbidden` phrase appears.
- No @mentions anywhere: a tag puts a partner's name next to ours, and that is a person's decision.
- The head post names the partner and links the feature's surface. One reply links the partner's page.
- Three to five replies, and at least three registry facts quoted, in plain prose rather than quotation marks.
- No copy about where the media sits ("this reply", "the card above").
- No other partner is named unless the feature's own facts name it.

`draftFindings` then runs the pipeline's copy, language and claims checks, the head spec limits (a 90-character headline, a 200-character body), and a similarity check against the queue and the archive (limit 0.34).

Claims are never taken from the model. `claimsFor` builds them from the designation evidence, the registry facts the copy actually quotes, and the values the run read, so every number in a spotlight is one the ledger can prove.

## The slot

The queue's tier 1 slot belongs to the series:

```json
"slots": [
	{ "tier": 2, "at": "12:00" },
	{ "tier": 1, "series": "partners", "at": "15:30" },
	{ "tier": 3, "at": "19:00" },
	{ "kind": "article", "at": "22:30", "everyDays": 2, "from": "2026-10-08" }
]
```

A series slot spends its series' best ready post first, ranked across every tier. Posts of a series that owns a slot are kept for that slot, so the series posts once a day and never twice. When the series has nothing ready, the slot is the ordinary tier 1 slot, so the prime-time flagship never goes empty. It counts toward `dailyCap` like any daily slot.

## Approval

Spotlights are tier 1, which normally waits for the owner. `"series": ["partners"]` in `approval` releases a listed series by policy whatever its tier, behind the veto window, and only when the other conditions hold: the post was filmed and the proof covers it, it tags no one, and the review passed on the editor's own verdict. Remove `partners` from the list and every spotlight waits for `approve` again.

## Running it

```bash
npm run x:partners -- check                     # validate the registry
npm run x:partners -- plan --days 7             # the rotation ahead and how many days are in stock
npm run x:partners -- daily --days 3 --dry-run  # film and draft three days, print them, write nothing
npm run x:partners -- daily --days 3            # write them to the queue and send them to review
npm run x:partners -- one --partner aws --feature marketplace-front-door --head gif
```

`--ship` on `daily` or `one` passes `--ship` to `advance`, which bundles approved spotlights for production through the overlay ([x-content-pipeline.md](x-content-pipeline.md), "Publishing without a deploy"). Shipping publishes, so it is an owner-approved step.

To keep the series in stock unattended, run `daily` once a day on a machine with a browser and ffmpeg, after materializing production's overlay:

```bash
npm run x:bundle -- pull --dir /tmp/x-overlay
npm run x:partners -- daily --days 3 --overlay /tmp/x-overlay --ship
```

Keeping three days in stock means a failed run, a flaky surface, or a model outage costs nothing: the slot still has a reviewed spotlight waiting.
