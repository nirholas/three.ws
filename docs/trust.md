# Trust center

The public security and privacy answers for IT reviewers, Microsoft Marketplace buyers and Teams admins. Every claim links to the file in this repository that makes it true, or to the provider's own published page.

| Surface | Route | Source |
| --- | --- | --- |
| Trust center | [three.ws/trust](https://three.ws/trust) | [pages/trust.html](../pages/trust.html), styles [src/trust.css](../src/trust.css) |
| Subprocessors | [three.ws/trust/subprocessors](https://three.ws/trust/subprocessors) | [pages/trust-subprocessors.html](../pages/trust-subprocessors.html) + [src/trust-subprocessors.js](../src/trust-subprocessors.js), data [data/subprocessors.json](../data/subprocessors.json) |
| Disclosure contact | [/.well-known/security.txt](https://three.ws/.well-known/security.txt) (RFC 9116) | [public/.well-known/security.txt](../public/.well-known/security.txt) |
| Incident process | linked from `/trust#incidents` | [docs/incident-response.md](incident-response.md) |
| Publisher Attestation answers | not public | [marketing/growth/submissions/programs/microsoft-365-publisher-attestation.md](../marketing/growth/submissions/programs/microsoft-365-publisher-attestation.md) |

Linked from the site footer and legal drawer, the Microsoft Marketplace activation page (`/microsoft/activate`) and the Teams tab (`/microsoft/teams-tab`).

## Rules for editing

- **Cite or cut.** A sentence that cannot point at a file or a provider page does not go on the page. Quote a provider's data-use terms and link them; never paraphrase them into a stronger claim.
- **No certification claims.** The compliance table has three states: In place, In progress, Not pursued. Publisher Attestation stays "In preparation" until Microsoft shows an attested status. Never claim SOC 2, ISO 27001, a penetration test, or a Microsoft endorsement or tier.
- **Keep three things in step.** When a control changes, update `pages/trust.html`, the attestation file, and `public/legal/privacy.html` together.
- **Link evidence to GitHub**, as `https://github.com/nirholas/three.ws/blob/main/<path>`. Do not link the private audit records under `docs/security/`.

## Subprocessors

`data/subprocessors.json` is the single source. Each entry has `name`, `group` (one of `groups[].id`), `purpose`, `data[]`, `region`, `evidence[]` (repo files that call the provider) and `terms` (the provider's DPA or data page). The list was built from the environment variable names on the `three-ws-api` Cloud Run service (names only, never values) and the code that reads each one. A key that is set but not called from a production request path is not listed.

Re-review whenever a provider key is added to or removed from the service, then bump `lastReviewed`:

```bash
gcloud run services describe three-ws-api --region us-central1 \
  --format='value(spec.template.spec.containers[0].env[].name)' | tr ';' '\n' | sort
```

## security.txt

`Expires` must stay in the future and no more than a year out (RFC 9116 section 2.5.5). Renew it before 2027-04-14. The server serves `.well-known` files with `text/plain; charset=utf-8` ([server/index.mjs](../server/index.mjs)).

## Tests

[tests/trust-page.test.js](../tests/trust-page.test.js) fails when a cited repo file stops existing, when a subprocessor entry loses a field or cites a missing file, when a `/trust` section loses its evidence, when a certification claim or a banned dash appears, when the routes go missing, or when `security.txt` stops meeting RFC 9116. [tests/privacy-retention.test.js](../tests/privacy-retention.test.js) keeps the retention windows the page cites enforced.
