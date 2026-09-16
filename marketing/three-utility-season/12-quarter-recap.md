# Edition 12: What $THREE does this week, verified utility outcomes (quarter recap)

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-12-THREE-QUARTER` |
| Publish date | 2026-12-04 |
| Chapter | Transparency |
| Audience | community and holders |
| Campaign anchor (campaigns.csv) | https://three.ws/three-token |
| Surface used in this pack | /three |
| Verified status (2026-09-16) | **Live (recap of live state; figures read on posting day).** |

## Verification

**Substitute:** The link moves to `/three`, where the Live and Planned count is visible.

- `/api/three/access` returns every registered perk with `enforced`; on 2026-09-16 the count was 2 of 7.
- Season results come from the seven-day result rows recorded under `marketing/growth/measurement.md` for each campaign id above.

## The three questions

- **What can a holder do now?** Open `/three`, use the most relevant LIVE perk, and reply with the next walkthrough to cover.
- **Where does $THREE enter?** Summary of the season: where $THREE was held or checked, and what each walkthrough produced.
- **What verifiable result comes out?** A count anyone can reproduce from `/api/three/access`, plus the action totals the team recorded per edition.

## Numbers and their sources

| Volatile figure (read on posting day) | Source |
|---|---|
| `{LIVE_COUNT}`: number of features with `enforced: true` | `/api/three/access`, read on posting day |
| `{TOTAL_COUNT}`: number of features listed | `/api/three/access`, read on posting day |

## Media

- File: [`images/12-quarter-recap.png`](./images/12-quarter-recap.png), 1080x1350, captured 2026-09-16 from `/three` by `node marketing/three-utility-season/capture.mjs --only 12`.
- Alt text (required on every post):

> Vertical capture of the three.ws $THREE Tiers page showing all tiers from Member to Genesis, with Bronze perks marked LIVE and Silver and Gold perks marked PLANNED.

## X post

Weighted length: **149 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does; counted with the 2026-09-16 values filled in).

```text
{LIVE_COUNT} of {TOTAL_COUNT} $THREE holder perks on three.ws are Live today and the rest are marked Planned. Which one should we walk through next? https://three.ws/three?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-12-three-quarter&utm_content=utility-post
```

## Telegram

```text
What $THREE did this quarter.
{LIVE_COUNT} of the {TOTAL_COUNT} $THREE holder perks on three.ws are Live today, and the rest are marked Planned on three.ws/three.
This season's walkthroughs: tiers, free-quota multipliers, gated 3D embeds, Forge Max, deploy fees from the MCP server, the tier API, the buyback ledger, Game-Ready export, and the open-source perk registry.
Reply with the one you want walked through next.
https://three.ws/three?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-12-three-quarter&utm_content=utility-telegram
```

## User action

Open `/three`, use the most relevant LIVE perk, and reply with the next walkthrough to cover.

## KPI and where to read it

Utility actions across the series: sum the per-edition seven-day results; replies naming a next walkthrough.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Fill `{LIVE_COUNT}` and `{TOTAL_COUNT}` from `/api/three/access` within the hour before posting.
- [ ] If any substituted edition was restored during the quarter, add it to the Telegram list only if its seven-day result row exists.
- [ ] Re-run `capture.mjs --only 12`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not add totals that were not recorded in a result row.
- Do not describe the quarter in price terms.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
