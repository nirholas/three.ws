# Edition 10: What $THREE does this week, creator earnings and royalties

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-11-THREE-CREATOR` |
| Publish date | 2026-11-20 |
| Chapter | Creation |
| Audience | 3D creators and community |
| Campaign anchor (campaigns.csv) | https://three.ws/marketplace |
| Surface used in this pack | /three (Game-Ready export perk) |
| Verified status (2026-09-16) | **Not live. Substitute used.** |

## Verification

**Substitute:** Creator earnings in $THREE have no confirmed sale and the payment rail is off (see edition 03). The substitute is the live Game-Ready export holder perk, which gives 3D creators an engine-ready asset by holding Bronze.

- Planned surface: same evidence as edition 03 (`totalSales: 0`, token rail `treasury_unavailable`). The marketplace skill fee knob `MARKETPLACE_PLATFORM_FEE_BPS` is unset, so a sale would pay the full list price to the creator once purchases work.
- Substitute: `api/forge-gameready.js` gates through `forge.gameready`, listed `enforced: true`, minimum Bronze, in `/api/three/access` on 2026-09-16. The client (`src/forge-gameready.js`) sends the tier pass and polls the real remesh job.

## The three questions

- **What can a holder do now?** Generate a model on `/forge`, then press Game-Ready export from a wallet holding Bronze and download the FBX.
- **Where does $THREE enter?** Held. Bronze is verified with a signed tier pass before the retopology job starts.
- **What verifiable result comes out?** A retopologized mesh delivered as GLB plus FBX for Unity or Unreal.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| Game-Ready export marked LIVE at Bronze | `/three` captured frame and `/api/three/access`, 2026-09-16 |

## Media

- File: [`images/10-gameready-holder.png`](./images/10-gameready-holder.png), 1600x900, captured 2026-09-16 from `/three (scrolled to the ladder)` by `node marketing/three-utility-season/capture.mjs --only 10`.
- Alt text (required on every post):

> The $THREE tier ladder on three.ws: Bronze lists High-quality generation and Game-Ready export (Unity/Unreal retopo plus PBR), both marked LIVE; Silver, Gold, and Genesis perks such as private worlds, branded worlds, and early access to drops are marked PLANNED.

## X post

Weighted length: **163 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Game-Ready export retopologizes a Forge model into a GLB plus FBX for Unity or Unreal. Holding $25 of $THREE (Bronze) opens it on three.ws. https://three.ws/three?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-three-creator&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: engine-ready exports for creators.
Game-Ready export on three.ws turns a Forge model into a clean GLB plus FBX for Unity or Unreal. Holding $25 of $THREE (Bronze) opens it; the balance is checked, not spent.
Earning $THREE from marketplace sales is not running yet. It will get its own walkthrough when the first sale settles.
https://three.ws/three?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-11-three-creator&utm_content=utility-telegram
```

## User action

Generate a model on `/forge`, then press Game-Ready export from a wallet holding Bronze and download the FBX.

## KPI and where to read it

Game-Ready exports by holders. `forge-gameready` job completions in `three-ws-api` logs for the week; UTM sessions for `mkt-2026-11-three-creator`.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Run one Game-Ready export from a Bronze wallet end to end.
- [ ] Re-check marketplace sales. If a confirmed $THREE sale exists, the owner can restore the creator-earnings story.
- [ ] Re-run `capture.mjs --only 10`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not mention royalties, earnings, or payouts.
- Do not describe Planned perks visible in the frame as available.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
