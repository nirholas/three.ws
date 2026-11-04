# Partner shoutout playbook

How three.ws earns public mentions from partners and prospective partners without paying for posts. Rule of thumb: **give something real first, make the post a natural byproduct of using it, and never ask for a post as the price of the thing.** A partner's social team shares what makes them look good, so the job is to make three.ws the easy thing to share.

Nothing here is sent or posted automatically. Every outreach and every post is an outward-facing action that needs owner approval.

## Already built

| Lever | Who it reaches | Status |
|---|---|---|
| $25 credit for startup-program members, +$10 for a public post ([details](./nvidia-inception-perk.md)) | Members of NVIDIA Inception, and the programs added next | Built, awaiting migration and deploy |
| Pre-filled post with the partner's hashtag | Same | Built |

## Levers to build next, ranked by effort against payoff

1. **Partner-branded share card.** After a member generates a model, render a card (the model, "Generated free with <program> on three.ws") sized for X and LinkedIn. People post things that look good. The generator for page cards already exists (`/api/page-og`); this adds a model-turntable variant.
2. **Case study per partner.** A short page showing a real company's real output on the partner's stack (for NVIDIA: the L4 and Blackwell fleet, already documented in the engineering post). Partners amplify case studies, because it is content they do not have to write. Offer them the draft and the numbers; they choose whether to share.
3. **Featured-founder wall.** A `/startups` gallery of approved members' best models, linked back to their sites. Free distribution for the member, and a reason to tag us when they share it.
4. **Co-marketing asset kit.** Logos, a one-paragraph boilerplate and three ready-to-post drafts per partner, in the same format as [/press](https://three.ws/press). NVIDIA reopened its co-branded marketing assets benefit on 2026-09-14; use it before inventing anything.
5. **Partner leaderboards and showcases.** A monthly "built on three.ws" roundup naming member startups. The named startups post it.
6. **Open-source credit.** Companies that contribute a skill, model or fix to the repo get named in the changelog and the README credits. [data/open-source-credits.json](../data/) already drives that surface.
7. **Early access.** Members get new lanes (rigging, Editable parts, Materialize) first, with the expectation, not the requirement, that they say what they thought.

## Asking partners directly

- **NVIDIA.** Email `inceptionprogram@nvidia.com` with the request their 2026-09-14 reply invited: complete the Shipping product record, and ask whether three.ws credit can appear in the Inception benefits catalog next to the Crusoe, DeepInfra and Modal offers. Their catalog lists partner offers for members; a three.ws offer is a legitimate listing request, and a listing is the highest-reach shoutout available.
- **Google for Startups, AWS, IBM.** Same shape: ask whether their startup-program benefit pages list partner offers, and what the process is. Do not describe the perk as theirs.
- **Prospects.** Offer a free Materialize or Forge batch for something they would show anyway (a product line, a mascot) and send the finished GLB. Never attach a request for a post.

## Guardrails

- Credit is for using the product. A post earns a small bonus only after a person verifies it, and the bonus is disclosed on the form so the post can carry normal sponsored-content disclosure where a platform requires it.
- Do not imply endorsement. Membership in a program is not a partnership, and the wording must say so.
- Do not offer anything for a post about a coin. $THREE is the only promoted coin and shoutouts here are about the product.
