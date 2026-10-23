# Open-source sponsorships

*Read 2026-10-23 by fetching each project's sponsorship page. This is the working table for
[work order 937](../../prompts/finish/937-partners-14-sponsorships.md). Every sponsorship is
recurring spend, so the **Owner decision** column is left blank on purpose. Nothing here has
been started, paid or announced.*

Context: [prospects](./prospects.md) scores these projects, and the
[outreach plan](./outreach-plan.md) puts "Contribute" before every ask. Money is the fastest
contribution.

**Reading rule.** A GitHub Sponsors page shows prices to a signed-out reader but often not what
a tier gives. Where a page did not state a price or a perk, the cell says `not verified on
2026-10-23` rather than guessing. Prices are USD per month unless stated.

## Dependencies measured

`package.json` today: `three ^0.184.0`, `@gltf-transform/core ^4.4.0` (plus `extensions`,
`functions`), `@pixiv/three-vrm ^3.5.5` (plus `three-vrm-animation`), `meshoptimizer ^1.2.0`.
No `@react-three/*` dependency; pmndrs is a prospect for an R3F-native component, not a
current dependency.

## Table

| Project | What it powers in three.ws | Tiers and prices read today | Payment route | Recognition by tier | Recommended | Why | Owner decision |
|---|---|---|---|---|---|---|---|
| three.js (mrdoob) | Every viewer, the `<agent-3d>` embed, all GLB rendering | Custom, $5, $10, $50, $100, $500, $1,000 a month; monthly or one-time toggle | [GitHub Sponsors](https://github.com/sponsors/mrdoob) | Page states no per-tier perks. It lists 31 current sponsors by GitHub username and avatar; no company display shown | **$100 (the 100 tier)** | The foundation of the product; $500 and up is not justified by revenue today | |
| glTF-Transform (Don McCurdy) | Forge GLB optimisation and inspection | Custom, $5, $15, $50, $100, $250, $500, plus a Large Company tier whose price was not captured (verify on the live page, tier-to-price mapping was inferred from layout). Rewards read: $5 profile badge and Sponsor label on issues and PRs; $250 written credit on one personal repo; $500 logo on one personal repo; Large Company logo on two repos plus 1 hour a month of consulting | [GitHub Sponsors](https://github.com/sponsors/donmccurdy) | As listed in the tiers column; no tier includes a link to the sponsor's site | **$250 (Small Company or Agency)** once revenue allows; **$50 (Supporter)** to start | $250 buys a written credit, the first tier with public recognition; the $500 company tier is the long-term target | |
| @pixiv/three-vrm | VRM avatar loading and VRM animation | No sponsor tiers found. The pixiv org page shows no funding link, and `.github/FUNDING.yml` returned 404 on the `dev` branch. not verified on 2026-10-23 | none found | n/a | $0. Send upstream fixes instead | There is no payment route to use | n/a |
| meshoptimizer (zeux) | Mesh compression across the Forge and glTF delivery | The GitHub Sponsors page for `zeux` showed no tiers and `.github/FUNDING.yml` returned 404 on `master`. not verified on 2026-10-23 | none found | n/a | $0 for now. Re-check the repository's Sponsor button | Cannot recommend a tier that cannot be read | n/a |
| Poly Haven | Source of the `/objects` library | Corporate page lists no prices or levels: companies fund specific work (HDRI trips, textures, scanning gear, hardware, infrastructure); the Patreon tiers page returned 403, not verified on 2026-10-23 | Contact via [polyhaven.com/corporate](https://polyhaven.com/corporate); Patreon for individuals | "From acknowledgements and logo placement up to deeper collaboration"; levels not defined | **$25 on Patreon** after the credit ships (order 086), once the owner reads the live tiers | Credit first (prospects page), money second; a Sponsored Project needs a conversation, which is outreach and owner-sent | |
| Blender Development Fund | Blender is the authoring tool for the CC0 catalog and the Blender add-on | Corporate memberships are annual: Bronze EUR 6,000, Silver EUR 12,000, Gold EUR 30,000, Platinum EUR 60,000, Titanium EUR 120,000, Patron EUR 240,000 | [fund.blender.org](https://fund.blender.org/) (Platinum and above go through the foundation chairman) | Bronze and Silver: logo and URL on the website. Gold adds a social mention and credit in reports and events. Platinum adds a developer liaison. Titanium adds a front-page mention and board contact. Patron adds a press release, a blog post and a dedicated product manager. Individual tiers exist but their prices were not on the page, not verified on 2026-10-23 | **Not now** | EUR 500 a month at the lowest corporate tier is more than twice the recommended monthly total; revisit if revenue grows | |
| OrcaSlicer (SoftFever) | "Open in OrcaSlicer" handoff | Page shows one tier with the price blank and monthly or one-time options; the only stated reward is a Public Sponsor achievement on your profile. Prices not verified on 2026-10-23 | [GitHub Sponsors](https://github.com/sponsors/SoftFever) | Public Sponsor achievement only | **$25** (a sizing assumption, since no price was readable) | The handoff sends real users to their app; the owner sets the amount once the tier list loads while signed in | |
| Mesh2Motion | CC0 animation library and auto-rigger source | No tiers. The support site takes a free-amount tip, routed through Venmo; funds animators for the shared library plus hosting. The GitHub Sponsors and Patreon routes were not found | [support.mesh2motion.org](https://support.mesh2motion.org) (Venmo) | None offered to donors | **$25 one-time tip** | Venmo is a personal-payment route, so it is a one-off the owner makes, not a recurring line | |
| Quaternius | CC0 characters and the Universal Animation Library | The site links Patreon (`patreon.com/quaternius`), but tiers, prices and perks were not readable (the page fetch returned no tier data). not verified on 2026-10-23 | Patreon | not verified on 2026-10-23 | **$10** (a sizing assumption) | Fastest way out of the Mixamo licensing risk; the owner picks the tier on the live Patreon page | |
| pmndrs collective | react-three-fiber and drei ecosystem; target for an R3F-native component | GitHub Sponsors (pmndrs): Easy $10, Normal $20, Hard $50, custom monthly, one-time option; perks not stated. Open Collective (react-three-fiber): Backer $5, Sponsor $100, custom one-time or recurring; perks not stated | [GitHub Sponsors](https://github.com/sponsors/pmndrs) or [Open Collective](https://opencollective.com/react-three-fiber) | Sponsor names and avatars appear on the GitHub page; no tier is tied to a logo or link | **$20 (Normal)** | We do not depend on R3F yet; a modest tier signals intent ahead of the component | |

## Recommended monthly total

**$250 a month ceiling.** The line items are:

| Line | Amount |
|---|---|
| three.js | $100 |
| glTF-Transform (Supporter) | $50 |
| pmndrs (Normal) | $20 |
| OrcaSlicer | $25 |
| Poly Haven Patreon | $25 |
| Quaternius Patreon | $10 |
| **Total recurring** | **$230** |

Plus a one-time $25 tip to Mesh2Motion. Moving glTF-Transform to the $250 Small Company tier
raises the total to $430 a month and is the next step once revenue supports it.

### How it was sized

- **Revenue evidence.** `node scripts/x402-revenue-readout.mjs --window 30d`, run 2026-10-23,
  separates real revenue from the x402 ring paying itself. Of $5,467 gross settled volume,
  **$150.08 across 28 calls from 5 external buyers** is real; 99.92% is internal ring
  dogfooding that the script's own header says never counts as traction. No other revenue
  source (subscriptions, skill-marketplace fees) was read in this pass, so $150 a month is the
  only revenue figure with evidence behind it.
- **Judgment call.** $230 a month exceeds the verified external revenue, so this is sized as a
  deliberate credibility and marketing line, comparable to the 1.5x trailing external revenue,
  not as a share of income. The Google Cloud credits cannot pay a sponsorship (they are
  metered cloud spend). Each line is independent: the owner can approve any subset, and a
  lower total just drops lines from the bottom of the table.
- **Where amounts are assumptions.** OrcaSlicer, Poly Haven and Quaternius prices could not be
  read, so those three amounts are placeholders for the owner to replace with a real tier on
  the live page. They are labelled as such above.

## What happens after approval

1. The owner starts each approved sponsorship from their own account (it is spend, and the
   payer must be the owner).
2. The agent adds "sponsored by three.ws" for each started project to the credits page (order
   086) and sends nothing externally.
3. The owner sends the one-line note from message template 2 in the outreach plan.
