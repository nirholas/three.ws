# partners: shared context for every `partners-` work order

Not a work order. Never run this file; read it when an order names it.

## What the campaign is

On 2026-10-09 Tripo reached out about a partnership, and the owner asked for a much longer list
of partners and a plan to work it. Five research passes swept GitHub, npm and each company's own
pages. The results are three documents, and every order in this campaign builds something one
of them calls for:

- [docs/partners/prospects.md](../../../docs/partners/prospects.md): the scored list, about 130
  prospects in eight categories, with the "fix before we pitch" findings.
- [docs/partners/outreach-plan.md](../../../docs/partners/outreach-plan.md): the waves, the
  engagement ladder, the message templates and who does what.
- [docs/partners/tripo.md](../../../docs/partners/tripo.md): the first prospect, worked in full.

The split this campaign runs on: **agents build, the owner opens doors.** Every integration,
package, page and pull request text is built and verified by an order in the 084 to 095 band.
Every message sent, pull request opened on a third-party repository, form submitted, sponsorship
paid and key approved is an owner action in the 936 to 940 band.

## Rules (apply to every order)

- **Never contact a third party.** No email, no issue, no pull request, no form, no listing
  submission, no post. Write the exact text into the repo (the order says where) and add the
  step to the owner message. CLAUDE.md gate 2.
- **Never onboard a paid API.** An integration with a paid vendor ships wired behind its env var
  and fully tested against the vendor's real API using a free or sandbox tier where one exists.
  Putting a platform-paid key on the Cloud Run service is an owner action.
- **Never spend.** Sponsorships, memberships, print orders and paid boosts are owner actions.
  A real print order placed through a partner API is a spend.
- **Partners are named.** Unlike the best3d campaign's commercial-vendor rule, partner prospects
  are companies we are approaching openly, and they are already named in
  [`api/_providers/`](../../../api/_providers/) and the partner docs. Direct competitors stay
  unnamed, per the house rule.
- **No other crypto project in a commit.** The CLAUDE.md commit gate holds: a diff that names a
  crypto project other than $THREE needs the owner's yes first. This campaign deliberately
  keeps on-chain partners out of its committed files.
- **Licenses.** Re-read an upstream LICENSE file on the day you adopt anything:
  `gh api repos/<owner>/<name>/contents/LICENSE --jq .content | base64 -d | head -30`.
  CC0 assets need no permission but get credit anyway; that is the point of order 086.
- **Re-verify before you build on a fact.** Intake routes and terms on the prospects page were
  read on 2026-10-09 and rot fast. Re-read the page, and if it changed, fix the prospects row in
  the same commit.

## Facts every order relies on

- The proof numbers (September 2026): 12,373 maker generation and rigging requests, 7,111
  finished; 13,898 MCP tool calls at 99.4% handler success from 13 OAuth clients. Quote them
  the way [the proof brief](../../../docs/partners/proof-brief-2026-10.md) says to.
- Forge engines are registered in [`api/_lib/forge-tiers.js`](../../../api/_lib/forge-tiers.js);
  vendor lanes live in [`api/_providers/`](../../../api/_providers/).
- Print fulfillment is an adapter layer:
  [`api/_lib/print/adapters/contract.js`](../../../api/_lib/print/adapters/contract.js), with
  `manual` and `partner-cn` registered in `index.js`. A new print partner is a new adapter.
- Avatar animation is universal (CLAUDE.md stack notes): a new rig convention is a bone-name
  mapping in `src/glb-canonicalize.js` plus a test case, never a rig allowlist.
- Production env lives on the Cloud Run service; read it with
  `node scripts/read-service-env.mjs '^NAME$' --raw`.
- We do not use GitHub Actions in this repository. Where a third party's intake requires an
  Actions workflow in a separate public repository (HACS, n8n verified nodes), prepare it in
  that repository's staged files and list the exception in the owner message.

## Order map

| Order | Item | Wave |
|---|---|---|
| 084 | Tripo v3 house lane, webhooks, and the endpoints we do not use yet | 0 |
| 085 | Move the public animation library off Mixamo clips | 1 |
| 086 | Open-source credits page and in-surface credits | 1 |
| 087 | LiveKit avatar plugin and Pipecat avatar service | 2 |
| 088 | Discord Activity | 2 |
| 089 | "Get it printed" through Craftcloud, plus slicer trusted-host patches | 2 |
| 090 | Mocap migration landing for stranded mocap users | 2 |
| 091 | Shopify product-media app | 2 |
| 092 | VRoid Hub import | 2 |
| 093 | Agent tool packages and registry entries | 1 |
| 094 | WordPress, Framer and Webflow embeds | 2 |
| 095 | Home Assistant HACS package | 2 |
| 936 to 940 | Owner-gated: Tripo reply and house key, sponsorships, third-party submissions, program applications, Sketchfab re-tagging | all |

Run 085 and 086 first: they close the "fix before we pitch" findings. 084 runs any time. 093
feeds 938. The rest are independent.

Related campaigns, not duplicated here: best3d
[072](../072-best3d-06-engine-bridges.md) (engine bridges),
[075](../075-best3d-09-three-vrm.md) (three-vrm and VRM 0.x export),
[934](../934-best3d-07-orphaned-avatar-campaign.md) (orphaned avatar users) and
[935](../935-best3d-08-engine-store-publishing.md) (engine store publishing).
