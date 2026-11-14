# Open-source sponsorships

*Re-read 2026-11-14 from each project's own sponsorship page (first pass 2026-10-23). This is
the working table for [work order 937](../../prompts/finish/937-partners-14-sponsorships.md).
Every sponsorship is recurring spend, so nothing here has been started, paid or announced until
the **Owner decision** column says so.*

Context: [prospects](./prospects.md) scores these projects, and the
[outreach plan](./outreach-plan.md) puts "Contribute" before every ask. Money is the fastest
contribution.

**Source of truth for decisions.** [`data/sponsorships.json`](../../data/sponsorships.json)
holds one row per project with the owner's `decision`, `decidedOn` and `startedOn`. The
[/open-source](https://three.ws/open-source) credits page (order 086) reads it at build time: a
row that is `approved` and has a `startedOn` date shows in a "Projects three.ws sponsors"
section and as a "Sponsored by three.ws since ..." badge on the matching credit cards. Pending,
declined and ended rows show nothing. How to record a decision is at the
[end of this page](#recording-a-decision).

**Reading rule.** Prices are USD per month unless stated. Where a page did not state a price or
a perk, the cell says so instead of guessing. Patreon pages refuse automated readers (HTTP 403),
so Patreon tiers were read from Patreon's public campaign JSON
(`/api/campaigns?filter[vanity]=<name>&include=rewards`), which returns the same tier titles,
prices and benefit text the page shows.

## Dependencies measured

`package.json` on 2026-11-14: `three ^0.187.0`, `@gltf-transform/core ^4.4.0` (plus
`extensions ^4.5.1`, `functions ^4.5.0`), `@pixiv/three-vrm ^3.5.5` (plus
`three-vrm-animation`), `meshoptimizer ^1.2.0`. No `@react-three/*` dependency; pmndrs is a
prospect for an R3F-native component, not a current dependency.

Licenses, read from each LICENSE file on 2026-11-14: three.js MIT, glTF-Transform MIT, three-vrm
MIT, meshoptimizer MIT, react-three-fiber MIT, OrcaSlicer AGPL-3.0 (we only hand files to it,
we ship none of its code), Mesh2Motion MIT for code and CC0 1.0 for every model, rig and
animation. Poly Haven and Quaternius assets are CC0.

## What changed since 2026-10-23

- **glTF-Transform tiers were mis-mapped last time.** The page now reads unambiguously: written
  credit starts at **$100** (not $250), logo placement at **$250**, and the Large Company tier
  is **$500** with two logos and an hour of consulting.
- **Poly Haven has a real $10 "Sponsor" tier** that puts our name and a link next to one asset of
  our choosing every month, permanently. The old $25 figure was not a tier.
- **Quaternius tiers are now read**: $3, $10, $20, $50.
- **three.js and Mesh2Motion declare a funding route in their repositories** (`.github/FUNDING.yml`)
  that our credits page did not link. Both cards on /open-source now carry a Sponsor link.
- **Revenue fell.** Trailing 30-day external revenue is $43.44, down from $150.08, so the
  recommended total is roughly halved.

## Table

| Project | What it powers in three.ws | Tiers and prices read 2026-11-14 | Payment route | Recognition by tier | Recommended | Why | Owner decision |
|---|---|---|---|---|---|---|---|
| three.js (mrdoob) | Every viewer, the `<agent-3d>` embed, all GLB rendering, the vendored Scene Studio editor | Custom, $5, $10, $50, $100, $500, $1,000 a month; a one-time tab with no listed amounts. 30 current sponsors | [GitHub Sponsors](https://github.com/sponsors/mrdoob). The repo's FUNDING.yml also lists HumanInteractive, donmccurdy, gkjohnson and WestLangley | No tier states a perk. Sponsors appear as GitHub avatars on the page; no company logo wall | **$50** | The foundation of the product. No tier buys more visibility than another, so $50 is a sizeable signal at a cost revenue can grow into | Pending |
| glTF-Transform (Don McCurdy) | Forge GLB optimisation, inspection and export | $5, $15 Supporter, $50 Developer, $100 Small Company or Agency, $250 Company or Startup, $500 Large Company, plus custom | [GitHub Sponsors](https://github.com/sponsors/donmccurdy) | $5 to $50: profile badge and a "Sponsor" label on our issues and PRs. $100: written credit on one of his repos. $250: logo on one repo. $500: logos on two repos and 1 hour a month of consulting | **$15 (Supporter)** now; **$100** when external revenue passes $500 a month | The Sponsor label shows on every upstream fix the outreach plan has us send. $100 is the first tier with public credit | Pending |
| @pixiv/three-vrm | VRM avatar loading and VRM animation | No sponsor route. No FUNDING.yml on `dev` and none at the org level | none | n/a | $0. Send upstream fixes instead (best3d order 075) | There is no payment route | No route |
| meshoptimizer (zeux) | Mesh compression across the Forge and glTF delivery (`meshoptimizer`, `gltfpack`) | No GitHub Sponsors profile for `zeux`; no FUNDING.yml on `master` | none | n/a | $0. Re-check on the next pass | There is no payment route | No route |
| Poly Haven | Every prop in `/objects` and the curated HDRI set | Patreon: Early Access + Vaults $3, Offline Access and Blender Add-on $5, Learn $7, **Sponsor $10**, Stakeholder $50 (4,214 paid members). Corporate: no price list; companies fund specific work through the contact page | [Patreon](https://www.patreon.com/polyhaven); corporate via [polyhaven.com/corporate](https://polyhaven.com/corporate) | $10 Sponsor: "Choose an asset every month to stick your name and a link next to permanently", kept even after dropping a tier. $50 adds their internal planning channels. Corporate: "acknowledgements and logo placement through to deeper collaboration" | **$10 (Sponsor)** | The cheapest tier anywhere on this list that buys a permanent, public link back to three.ws, on a site with millions of users | Pending |
| Blender Development Fund | Authoring tool for the CC0 catalog and the Blender add-on | Corporate, billed yearly: Bronze EUR 6k, Silver EUR 12k, Gold EUR 30k, Platinum EUR 60k, Titanium EUR 120k, Patron EUR 240k. Individual monthly amounts are not listed on the page; a one-time donation page exists | [fund.blender.org/corporate-memberships](https://fund.blender.org/corporate-memberships/) | Bronze and Silver: "Logo and url on website". Gold adds a social mention and credit in reports and at events. Platinum adds a developer liaison; Titanium a blender.org front-page mention and board contact; Patron a press release, a tech blog post and a dedicated product manager | **Not now** | EUR 500 a month at Bronze is about five times the recommended total | Pending |
| OrcaSlicer (SoftFever) | "Open in OrcaSlicer" handoff | One custom-amount tier, monthly or one-time; no listed prices. 50 current sponsors. FUNDING.yml also lists Ko-fi and PayPal | [GitHub Sponsors](https://github.com/sponsors/SoftFever) | "A Public Sponsor achievement will be added to your profile". Nothing else | **$10** (custom amount) | The handoff sends real users to their app; no tier buys more, so a modest amount is the right size | Pending |
| Mesh2Motion | CC0 animation library and auto-rigger source | No tiers. support.mesh2motion.org takes an open-amount tip via Venmo; the repo's FUNDING.yml names GitHub user scottpetrovic, who has no Sponsors profile | [support.mesh2motion.org](https://support.mesh2motion.org) | None. Funds "Pay an animator" and "Hosting Costs and Application Development" | **$25 one-time** | Venmo is a personal-payment route, so this is a one-off the owner makes, not a recurring line | Pending |
| Quaternius | CC0 characters and the Universal Animation Library 2 | Patreon: Supporter $3, Silver $10, Gold $20, Diamond $50 (1,007 paid members) | [Patreon](https://www.patreon.com/quaternius) | No public listing at any tier. Perks are content: claim credits for source kits (5, 15, 30, 75 a month), voting credits for the next kit, custom models at $20 and up | **$10 (Silver)** | Supports the source of our CC0 motion library. Silver's 15 source-kit claims a month are a practical bonus for the asset team | Pending |
| pmndrs collective | react-three-fiber and drei; target for an R3F-native component | GitHub Sponsors: $10 "easy", $20 "normal", $50 "hard", custom, one-time option (11 current sponsors, 3% of a $5,000 goal). Open Collective (react-three-fiber): Backer $5, Sponsor $100, custom | [GitHub Sponsors](https://github.com/sponsors/pmndrs) or [Open Collective](https://opencollective.com/react-three-fiber) | No tier states a perk; sponsor avatars appear on the GitHub page | **$10** | We do not depend on R3F yet; a small line signals intent ahead of the component and the guest-post ask | Pending |

## Recommended monthly total

**$105 a month, plus a one-time $25.**

| Line | Amount |
|---|---|
| three.js | $50 |
| glTF-Transform (Supporter) | $15 |
| Poly Haven (Sponsor) | $10 |
| Quaternius (Silver) | $10 |
| OrcaSlicer | $10 |
| pmndrs (easy) | $10 |
| **Total recurring** | **$105** |
| Mesh2Motion tip, one-time | $25 |

**Step-up when external revenue passes $500 a month:** glTF-Transform to $100 (written credit)
and three.js to $100, for $240 a month.

### How it was sized

- **Revenue evidence, read 2026-11-14.** `node scripts/x402-revenue-readout.mjs --window 30d`
  (window since 2026-10-15): $6,333.26 gross settled across 64,367 calls, of which **$43.44
  across 9,039 calls is external revenue**; 85.96% is the internal ring paying itself, which the
  script excludes from traction. Prepaid credit deposits in the same 30 days, read from
  `credit_ledger`: **none**. $43.44 a month is the only revenue figure with evidence behind it.
- **Judgment call.** $105 a month is about 2.4 times verified external revenue, so it is sized as
  a credibility line in the marketing budget, not as a share of income. Each recurring line is
  the lowest tier that either buys public recognition (Poly Haven's link, glTF-Transform's
  Sponsor label) or is a meaningful amount where no tier buys more (three.js, OrcaSlicer,
  pmndrs, Quaternius). Lines are independent: the owner can approve any subset. A total that
  stays inside revenue is Poly Haven $10, glTF-Transform $15 and three.js $10, which is $35.
- **What cannot pay for this.** The Google Cloud credits are metered cloud spend and cannot fund
  a sponsorship.

## Recording a decision

For each project, edit its row in [`data/sponsorships.json`](../../data/sponsorships.json):

1. Owner decides: set `decision` to `approved` or `declined` and `decidedOn` to the day
   (`YYYY-MM-DD`). Update the **Owner decision** column above to match.
2. Owner starts the sponsorship from their own account (it is spend, so the payer is the owner).
3. Set `startedOn` to the day the first payment went through, then run
   `node scripts/build-open-source-credits.mjs` and commit both files. The project appears on
   /open-source on the next deploy. `startedOn` on a row that is not `approved` fails the build.
4. If a sponsorship stops, set `endedOn`; the page drops it.
5. The owner sends the one-line note from message template 2 in the
   [outreach plan](./outreach-plan.md#2-an-open-source-project-we-depend-on). Nothing is sent by an agent.
