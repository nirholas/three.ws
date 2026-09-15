# Marketing measurement system

The measurement goal is to connect **partner validation and community attention** to a real
three.ws action. Views and likes are useful diagnostics; they are not the outcome by
themselves.

## Campaign IDs and links

Every anchor and utility campaign has an immutable ID in
[`campaigns.csv`](./campaigns.csv):

```text
MKT-YYYY-MM-SHORT-NAME
```

Every link under our control uses:

```text
utm_source=<venue-or-account>
utm_medium=<social|community|partner|event|email|directory>
utm_campaign=<campaign_id in lowercase>
utm_content=<asset-or-post-variant>
```

Example for the Open Source Friday X anchor:

```text
https://three.ws/rig-doctor?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-09-osf&utm_content=anchor-video
```

Example for an IBM Community event page:

```text
https://three.ws/play?utm_source=ibm-community&utm_medium=partner&utm_campaign=mkt-2026-09-ibm-event&utm_content=event-page
```

Use lowercase ASCII and hyphens. Do not rename a campaign after links are live. A repost by a
partner gets its own `utm_source` and `utm_content=partner-repost` while preserving the
campaign ID.

## Funnel

Measure each campaign through five layers:

| Layer                     | Definition                              | Examples                                                                    |
| ------------------------- | --------------------------------------- | --------------------------------------------------------------------------- |
| Distribution              | The content was actually delivered      | impressions, partner newsletter sends, event-page views                     |
| Engagement                | A person chose to interact              | substantive replies, reposts, saves, article reads, registrations           |
| Product action            | The visitor used the proof              | generation completed, demo started, Agent Card fetched, listing opened      |
| Community/economic action | The visitor joined the ecosystem        | event attendance, issue claimed, PR opened, utility used, paid call settled |
| Earned escalation         | A third party deepened the relationship | partner comment, repost, listing, speaker, newsletter, case-study intro     |

The north-star count is **qualified actions**: product actions, community/economic actions,
and earned escalations attributed to a campaign. Report distribution and engagement beside
it so a weak conversion can be diagnosed.

## Required campaign result

Record this at 24 hours and again at seven days:

| Field                    | Meaning                                                                  |
| ------------------------ | ------------------------------------------------------------------------ |
| Campaign ID              | Immutable ID from `campaigns.csv`                                        |
| Live URLs                | Canonical page and every published post                                  |
| Spend                    | Cash cost; organic time is recorded separately in hours                  |
| Impressions / views      | Per channel, not summed when audiences overlap                           |
| Engagements              | Likes, reposts, comments, saves, and partner interactions split out      |
| Landing sessions         | Sessions carrying the campaign UTM                                       |
| Primary product action   | Campaign-specific action and count                                       |
| Utility/community action | Campaign-specific deeper action and count                                |
| Partner response         | None, acknowledged, commented, reposted, listed, speaker, editorial lead |
| Reusable learning        | One sentence about what to repeat or stop                                |
| Next escalation          | The one ask earned by this result                                        |

## Weekly scorecard

The Monday review answers seven questions:

1. Did last week's anchor ship on its primary channel?
2. Did the partner receive the brief before publication?
3. Did it produce a qualified action?
4. Did the partner respond, and at which engagement-ladder level?
5. Which content format and opening beat the four-week median?
6. Which channel produced the highest action rate, not the most impressions?
7. What single earned placement does the proof justify asking for next?

Track these rollups:

| Metric                            |               90-day goal | Notes                                                 |
| --------------------------------- | ------------------------: | ----------------------------------------------------- |
| Anchor campaigns shipped          |                        12 | One per week                                          |
| $THREE utility proofs shipped     |                        12 | One per week                                          |
| Partner amplifications            |         4 distinct brands | Comment, repost, newsletter, or partner-authored post |
| New partner-owned live listings   |                         3 | Live URL required                                     |
| Community events held             |                         3 | Live event plus recap                                 |
| Partner briefs sent before launch | 100% of partner campaigns | Minimum 48 hours before publication                   |
| Campaigns with seven-day result   |                      100% | No result means campaign remains open                 |

## Decision rules after four weeks

- Repeat a format when its qualified-action rate beats the rolling four-week median and the
  campaign produced at least one substantive community or partner response.
- Rewrite the landing path when engagement is healthy but product-action conversion is below
  the median.
- Stop a channel-specific format after three comparable attempts below the median. Keep the
  story and move it to a better-fit venue.
- Escalate a partner ask only after giving the partner a result it can reuse: a working demo,
  useful article, attendance, customer outcome, or measured community response.
- Do not compare the small historical token and partner samples as if they were stable
  forecasts. Recalculate lift after each four-week block.

## Data sources

| Source                                    | What it supplies                                              | Cadence                                      |
| ----------------------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| `data/x-archive/`                         | X post content and engagement                                 | Refresh weekly and after large partner posts |
| `docs/x-archive/trythreews-engagement.md` | Format and topic baselines                                    | Regenerate after archive refresh             |
| Web analytics                             | UTM sessions and conversion events                            | 24 hours and 7 days                          |
| `data/changelog.json`                     | Shipping volume and story discovery                           | Weekly editorial review                      |
| IBM Community catalog                     | Members, articles, discussions, events                        | Monthly and after each event                 |
| Partner dashboards/portals                | Listing traffic, leads, installs, marketplace activity        | Weekly while launching, monthly after        |
| Public product/stat endpoints             | Utility usage and transaction proof                           | Capture at publication and seven days        |
| GitHub                                    | Stars, clones, issues, PRs, contributors, discussion activity | Seven days after builder campaigns           |

## Integrity rules

- Preserve raw counts and their capture times. Never overwrite a result with a newer count
  without retaining the date.
- Separate organic, partner-amplified, and paid delivery.
- Do not sum impressions from channels with overlapping audiences into “people reached.”
- Mark bot traffic, unreliable counters, and missing data as excluded rather than zero.
- Attribute $THREE utility only to a verifiable action; do not infer a token purchase from a
  page view.
- Never report a submission as a listing or a partner acknowledgement as endorsement.

The initial baseline window is **2026-09-15 through 2026-10-12**. Add rate targets only after
that window closes.
