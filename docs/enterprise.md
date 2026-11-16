# /enterprise: the procurement page

`/enterprise` is the one page a company buyer or vendor-review team needs: how to buy, how identity works, the security and compliance answers, which Microsoft surfaces are live, what support is offered, a printable procurement packet, and a contact form.

| Piece | File |
| --- | --- |
| Page | [pages/enterprise.html](../pages/enterprise.html) (route `/enterprise` in `vercel.json` and the Vite dev middleware) |
| Renderer | [src/enterprise.js](../src/enterprise.js) |
| Styles, including the print stylesheet | [src/enterprise.css](../src/enterprise.css) (builds on [src/trust.css](../src/trust.css)) |
| Data | [data/enterprise.json](../data/enterprise.json), plus [data/microsoft-surfaces.json](../data/microsoft-surfaces.json) and [data/subprocessors.json](../data/subprocessors.json) |
| Validation and claim rules | [src/enterprise-model.js](../src/enterprise-model.js) |
| Contact endpoint | [api/enterprise/contact.js](../api/enterprise/contact.js) `POST /api/enterprise/contact`, shaping in [api/_lib/enterprise-contact.js](../api/_lib/enterprise-contact.js) |
| /pricing company row | [pages/pricing.html](../pages/pricing.html) + [src/pricing-enterprise-cta.js](../src/pricing-enterprise-cta.js) |
| Tests | [tests/enterprise.test.js](../tests/enterprise.test.js) |

## Every status comes from data

Nothing on the page states a status in HTML. Edit `data/enterprise.json`:

- `marketplace.publisher_profile_url`: the live Microsoft Marketplace publisher profile.
- `marketplace.offer_url`: empty until the SaaS offer is published in Partner Center. Once set, the Marketplace buy card, the hero button and the /pricing "Buying for a company?" row link straight to the offer, and the page emits an `Offer` in its structured data. While it is empty, /pricing links to `/enterprise` and no `Offer` is emitted.
- `publisher.legal_entity`: empty until the registered entity is confirmed. The packet then says the entity name and country come with the order form, and never invents one.
- `attestation.status`: one of `in preparation` or `submitted`. Nothing else validates.
- `identity[]`: each feature is `built, not switched on` or `available on request`. Items with `"probe": "sso"` show `live` only when `/api/microsoft-marketplace/status` reports the Microsoft sign-in app switched on in production.
- `surfaces[]`: ids from `data/microsoft-surfaces.json`. Each card shows that file's status, today text and evidence, so the Microsoft hub and this page never disagree.
- `security[]`, `support[]`, `buy[]`, `contacts`: rows rendered as written. Support lists only what is actually offered.

The in-Marketplace purchase line on the buy card reads the same live probe (`ready`), so it flips on by itself once the offer is published and the env is set.

## The claim gate

The only approved Microsoft wording is "three.ws and Microsoft have announced a partnership" and "three.ws is live on Microsoft Marketplace". `FORBIDDEN_CLAIMS` in `src/enterprise-model.js` rejects certification, co-sell, partner-tier, endorsement, "approved by Microsoft" and SOC 2 / ISO 27001 report claims. `tests/enterprise.test.js` runs it over every string in `data/enterprise.json` and over the status text of every surface the page shows, so a forbidden phrase fails `npm test` with the field path and the reason.

## The procurement packet

The `#packet` section is the printable packet: vendor, website and source, hosting regions (GCP us-central1), encryption in transit and at rest, SSO and SCIM, retention, backups, compliance, how to buy, contacts, and the full subprocessor table with its review date. The print button (or the browser's print) hides everything else, prints black on white, and spells out every link's URL so the paper copy stands alone.

## The contact form

The form posts to `POST /api/enterprise/contact`. A valid submission becomes a lead in the Microsoft Marketplace leads pipeline with source `Website` (`Website-PLT`): stored once, the owner notified, a reply drafted and never sent automatically, and visible at `/admin/microsoft/leads` under "Enterprise page". See [docs/ops/microsoft-marketplace-leads.md](ops/microsoft-marketplace-leads.md).

- Limits: 5 messages per IP per 10 minutes (`limits.enterpriseContactIp`), 16 KB body.
- A hidden honeypot field returns 200 and stores nothing.
- `400 invalid_fields` returns `fields` so the form marks each field; 429 and other failures show a banner with the support@three.ws fallback.
- Nothing beyond the form fields is kept (no IP, no headers).

To exercise it locally against a real database, run the API server and point Vite's proxy at it:

```bash
PORT=3131 node --env-file=.env.local server/index.mjs
DEV_API_PROXY=http://localhost:3131 npx vite --port 3130 --strictPort
```
