# Edition 11: What $THREE does this week, utility built in public

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-11-THREE-BUILD` |
| Publish date | 2026-11-27 |
| Chapter | Transparency |
| Audience | community and open-source builders |
| Campaign anchor (campaigns.csv) | https://github.com/nirholas/three.ws |
| Surface used in this pack | `api/_lib/three-access.js` on GitHub |
| Verified status (2026-09-16) | **Live.** |

## Verification

**Substitute:** None. Primary channel is GitHub Discussions; the X post below is the secondary channel.

- Repository `github.com/nirholas/three.ws` is public; `api/_lib/three-access.js` on `main` documents the `enforced` flag (lines 30 to 46) and lists the two enforced perks.
- The `/three` page reads that flag through `/api/three/access` and renders LIVE or PLANNED (`src/three-tier-page.js`).

## The three questions

- **What can a holder do now?** Read `api/_lib/three-access.js`, compare it with `/three`, and open an issue or discussion reply.
- **Where does $THREE enter?** In code. The registry decides which holder perks the product may call live.
- **What verifiable result comes out?** Anyone can audit which $THREE perks are wired and open an issue when the page and the code disagree.

## Numbers and their sources

| Stable fact | Source and capture date |
|---|---|
| 2 of 7 perks `enforced: true` | source on `main` and `/api/three/access`, captured 2026-09-16 |

## Media

- File: [`images/11-built-in-public.png`](./images/11-built-in-public.png), 1600x900, captured 2026-09-16 from `github.com/nirholas/three.ws/blob/main/api/_lib/three-access.js#L30` by `node marketing/three-utility-season/capture.mjs --only 11`.
- Alt text (required on every post):

> Source of api/_lib/three-access.js on GitHub: a comment block explains that the enforced flag is true only when a gate is wired and live, so the tier page never makes an aspirational claim, and names forge.high and forge.gameready as the gates enforced today.

## X post

Weighted length: **172 characters** (URL counted as 23, as `scripts/post-tweet.mjs` does).

```text
Every $THREE perk in the three.ws code carries an enforced flag, so the tier page can only say Live when a gate really checks it. Read the registry: https://github.com/nirholas/three.ws/blob/main/api/_lib/three-access.js?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-three-build&utm_content=utility-post
```

## Telegram

```text
What $THREE does this week: the code behind the claims.
Every $THREE holder perk on three.ws is registered in open source with an enforced flag. The tier page only says Live when that flag is true, which today means two perks.
Read it, and open an issue if the page and the code ever disagree: github.com/nirholas/three.ws
https://github.com/nirholas/three.ws/blob/main/api/_lib/three-access.js?utm_source=telegram&utm_medium=community&utm_campaign=mkt-2026-11-three-build&utm_content=utility-telegram
```

## GitHub Discussions (primary channel)

GitHub Discussions post (title: "How $THREE holder perks are marked Live or Planned"): link `api/_lib/three-access.js`, explain the `enforced` flag in two sentences, list the two enforced gates with their handler files (`api/forge.js`, `api/forge-gameready.js`), and ask for issues where a surface claims more than the registry. Add the production configuration gaps from this season's README only if the owner approves making them public.

## User action

Read `api/_lib/three-access.js`, compare it with `/three`, and open an issue or discussion reply.

## KPI and where to read it

Repo visits, discussions, and issues. GitHub Insights traffic for the week; new issues and discussion replies that reference `three-access` or `$THREE`.

Record the 24-hour and seven-day rows in the format in [measurement.md](../growth/measurement.md).

## Posting-day checklist

- [ ] Re-open the linked surface in a clean browser and confirm it loads without errors.
- [ ] Confirm the lines and enforced count on `main` are unchanged.
- [ ] Re-run `capture.mjs --only 11`.
- [ ] Attach the image and paste the alt text.
- [ ] Owner presses publish. Nothing in this pack posts automatically.

## Do not

- Do not quote star or fork counts from the frame.
- No price, return, urgency, or "moon" language. No hashtags, no emoji.
