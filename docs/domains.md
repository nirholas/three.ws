# Web domains

Agents can search, price, check and register real web domains, and serve their public page on one. The registrar is Google Cloud Domains. Registration spends money, so it is a gated action on every surface.

- Page: [/domains](https://three.ws/domains), source [pages/domains.html](../pages/domains.html) and [src/domains/](../src/domains/)
- REST: `/api/domains/*`, handler [api/domains/[action].js](../api/domains/%5Baction%5D.js)
- MCP tools: [api/_mcp/tools/domains.js](../api/_mcp/tools/domains.js)
- Service layer: [api/_lib/domains-service.js](../api/_lib/domains-service.js), registrar client [api/_lib/cloud-domains.js](../api/_lib/cloud-domains.js), connect flow [api/_lib/domain-connect.js](../api/_lib/domain-connect.js)
- Renewals: [api/cron/domain-renewals.js](../api/cron/domain-renewals.js)

## What it does and does not do

| Fact | Detail |
|---|---|
| Term | One year. Cloud Domains registers for one year only. |
| Renewal price | Same as the yearly registration price. |
| Payment | Prepaid credits ([/credits](https://three.ws/credits)), debited at the exact price Google quotes. No markup. |
| Premium names | A name can price above its TLD base. `domain_check` and `domain_register_quote` return the exact figure for that name. |
| Supported TLDs | Cloud Domains has no list endpoint. [data/domain-tlds.json](../data/domain-tlds.json) is a snapshot probed by `node scripts/refresh-domain-tlds.mjs` (run with `DOMAINS_ACCESS_TOKEN=$(gcloud auth print-access-token)`). An unsupported TLD answers `UNSUPPORTED`. |
| Registrar quota | 300 sensitive requests per day per project, 100 per minute, 20 registrations per project. |

### The daily quota

Search, availability and register count against the 300/day quota, which resets about 07:00 UTC. The platform treats it as a first-class limit: pricing is served from the snapshot and costs no calls, search is cached 1 hour and check 5 minutes, public lookups are limited to 40 per hour per caller, and a 429 from Google trips a flag so callers get a clear `domains_quota_exhausted` answer with `resetsInSeconds` instead of repeated failures. `GET /api/domains/quota` reports the state. A raise to 3000/day was requested (quota preference `domains-sensitive-per-day`).

## MCP tools

| Tool | Tier | Purpose |
|---|---|---|
| `domain_search` | read | Names across TLDs with availability and registration and renewal price. |
| `domain_check` | read | One name: available or not, with the reason (`registered`, `unsupported_tld`, `unknown`). |
| `domain_pricing` | read | TLD price list from the snapshot, filter by `tld` or `max_price_usd`. |
| `domain_register_quote` | write | Validate-only register against the real API: exact price, term, renewal, privacy, notices, credit balance. Returns the `quote_id`. |
| `domain_register` | financial | Spend credits and register. Needs `quote_id`, `confirm_spend: true`, `expected_price_usd`, `idempotency_key`. |
| `domain_status` | read | Settle and read a registration. |
| `domain_connect` | write | Serve an agent's public page on a registered domain. |
| `domain_connect_status` | read | DNS, certificate and live state of a connected host. |

The flow an agent follows:

1. `domain_check` or `domain_search` to find a name.
2. `domain_register_quote` with the registrant contact and `auto_renew`. Show the owner the price, the one-year term, the renewal note and the balance.
3. Only after the owner says yes, `domain_register` with the same arguments, the `quote_id`, `confirm_spend: true`, the quoted price as `expected_price_usd`, and a fresh `idempotency_key`.
4. Poll `domain_status` until `active`. A failed registration refunds the credits automatically.

`domain_register` re-reads the live price and refuses with `price_changed` if it moved since the quote. A retry with the same `idempotency_key` returns the same registration and never charges twice.

## REST

```bash
curl 'https://three.ws/api/domains/check?domain=orbit.app'
curl 'https://three.ws/api/domains/search?q=orbit&tlds=com,xyz,app'
curl 'https://three.ws/api/domains/pricing?max_price_usd=15'
curl 'https://three.ws/api/domains/suggest?name=Orbit'
```

Signed-in: `POST /api/domains/quote`, `POST /api/domains/register`, `GET /api/domains/status`, `GET /api/domains/list`, `POST /api/domains/connect`, `GET /api/domains/connect-status`. Registration through an API key needs the key's spend scope.

## Registrant contact

Required: `name`, `email`, `phone` (international, `+14155550123`), `address_lines`, `city`, `postal_code`, `country` (two letters), optionally `region`. It is sent to the registrar, stored on the registration so the owner can see what it was registered to, and never returned to another account. Privacy defaults to hidden WHOIS where the TLD supports it.

## Auto-renew

If `auto_renew` is on, Google renews the name each year and bills the GCP project. To keep that from falling on the platform, [api/cron/domain-renewals.js](../api/cron/domain-renewals.js) runs daily: 14 days before expiry it debits the renewal price from the owner's credits (idempotent per term). If credits are short it switches the registration to manual renewal at the registrar, turns `auto_renew` off and writes `renewal_note`, so the name can lapse but nobody is charged unpaid. Keep credits topped up if you want a name to renew.

## From a coin page

Coin pages ([/coin/:id](https://three.ws/coin/bitcoin)) show a "Domains" panel: live-availability suggestions for the project name across `.com`, `.xyz`, `.app` and `.io`, each linking to `/domains?domain=...` to register.

## Connect a domain to an agent

`domain_connect` / `POST /api/domains/connect` runs the Cloud Run plus load balancer procedure in [docs/ops/gcp-production.md](ops/gcp-production.md#web-domains):

1. Create a Cloud DNS zone for the domain and A records for the apex and `www` at the load balancer address.
2. Point the registration's nameservers at the zone.
3. Create a Google-managed certificate and attach it to the HTTPS proxy.
4. Mark the host `live` when the certificate is `ACTIVE`.

Once live, `https://<domain>/` serves the agent's public page (`/agents/<id>`), and every other path serves the normal site. Certificates take minutes to provision after the nameservers propagate; `domain_connect_status` reports `pending_dns`, `pending_cert`, then `live`. The load balancer's HTTPS proxy holds at most 15 certificates, so connected domains are capped there until the proxy moves to certificate maps.

`docs/tutorials/deploy-to-vercel-custom-domain.md` describes the legacy Vercel path and does not apply to production, which runs on Cloud Run.

## Operations

The API's Cloud Run identity impersonates the dedicated service account `three-ws-domains@aerial-vehicle-466722-p5.iam.gserviceaccount.com`, which alone can register domains and edit DNS and certificates. See [docs/ops/gcp-production.md](ops/gcp-production.md#web-domains). Tests: [tests/domains-service.test.js](../tests/domains-service.test.js).
