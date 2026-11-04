# Microsoft distribution and offer plan

This plan takes the live three.ws publisher profile on [Microsoft Marketplace](https://marketplace.microsoft.com/en-us/partners/d11c4453-6e12-499d-8dfe-48fcbaa22e2f/overview) and turns it into purchasable offers. It also lists every other Microsoft surface where three.ws can be listed, installed or promoted. Background and approved wording: [three.ws and Microsoft](./microsoft.md). Written 2026-11-04.

## Constraint to respect first

The backend runs on Google Cloud, not Azure, and stays there. A SaaS listing, Marketplace discovery and billing through the Microsoft invoice all work regardless. **Azure IP co-sell** status and **MACC** eligibility (customers drawing down their committed Azure spend) generally require the solution to run on Azure. Neither is claimed in this plan. This matches [microsoft.md](./microsoft.md#saying-it-correctly): no Microsoft partner tier or co-sell status appears anywhere until the owner confirms it in writing. No Google Cloud or Solana infrastructure moves for this plan.

## Priority map

Ranked by payoff against effort. "Owner" marks steps that need Partner Center or a legal signature and cannot be done from the repo.

| # | Opportunity | Surface | Effort | What exists today | Payoff |
|---|---|---|---|---|---|
| 1 | **SaaS offer, transactable** | Microsoft Marketplace | High | Plans in [`api/subscriptions/plans.js`](../api/subscriptions/plans.js), OAuth server | Enterprises buy on their Microsoft invoice. Unlocks Marketplace Rewards |
| 2 | **Apps and Agents for M365 and Copilot** (MCP certification) | Copilot Studio, Microsoft 365 Copilot, Foundry | Medium | Package drafted: [`microsoft-copilot-mcp-certification.md`](../marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md) | three.ws tools inside Copilot for every M365 tenant |
| 3 | **Professional service offers** | Microsoft Marketplace | Low | Nothing to build | Free listing, inbound enterprise leads |
| 4 | **Power Platform certified connector** | Power Automate, Power Apps, Copilot Studio, Logic Apps | Medium | REST API and OpenAPI-shaped handlers | Low-code makers call generation and agents without code |
| 5 | **Teams app** with Glance cards | Teams store (Microsoft 365 apps) | Medium | Adaptive Cards in [`api/_lib/glance-adaptive.js`](../api/_lib/glance-adaptive.js) | Agents and 3D previews in Teams chats and channels |
| 6 | **VS Code Marketplace** | Visual Studio Marketplace | Low | [`packages/vscode-3d/`](../packages/vscode-3d), [`packages/vscode-x402/`](../packages/vscode-x402) built | Developer install base |
| 7 | **Edge Add-ons** | Microsoft Edge Add-ons store | Low | Two MV3 extensions in [`extensions/`](../extensions) | Edge users get the walk avatar and checkout companion |
| 8 | **Microsoft Store (PWA)** | Windows | Low | [`public/site.webmanifest`](../public/site.webmanifest) with `standalone` display | three.ws as an installable Windows app |
| 9 | **GitHub MCP Registry and Technology Partner Program** | GitHub (Microsoft) | Low | Form drafted: [`github-technology-partner.md`](../marketing/growth/submissions/programs/github-technology-partner.md) | MCP discovery inside Copilot in VS Code and GitHub |
| 10 | **Foundry agent tools** | Azure AI Foundry Agent Service | Low | MCP endpoints live | Foundry builders attach three.ws MCP as a tool. Covered by #2 certification |
| 11 | **Microsoft 365 Certification / Publisher Attestation** | Microsoft 365 App Compliance | Medium | Security docs, OAuth | Trust badge for #2 and #5; enterprise IT reviewers check it |
| 12 | **Partner programmes and benefits** | AI Cloud Partner Program, ISV Success, Marketplace Rewards, Microsoft for Startups | Owner | Publisher account | Credits, technical support, co-marketing |
| 13 | **Bing and Copilot search visibility** | Bing Webmaster Tools, IndexNow | Low | [`api/_lib/indexnow.js`](../api/_lib/indexnow.js) already pings IndexNow | Pages indexed fast for Bing and Copilot answers |
| 14 | **Co-marketing** | Microsoft Tech Community, partner blog, Reactor events | Owner | Announcement and coverage live | Reach through Microsoft's own channels |
| 15 | **Azure Container offer** | Microsoft Marketplace | High | Worker images | Self-hosted runtime for regulated enterprises. Only on demand |

Skipped Partner Center offer types: Azure Application, Azure Virtual Machine, Managed service (all deliver resources into the customer's tenant), Dragon Copilot (healthcare), Dynamics 365 on Dataverse, Operations and Business Central (ERP verticals) and Power BI app. A **Power BI visual** that renders a GLB is plausible but niche; it is revisited after #1 to #8 ship.

---

## 1. SaaS offer

### What Microsoft requires

| Requirement | Plan |
|---|---|
| Landing page | New page that receives the `token` query param, calls `resolve` on the SaaS Fulfillment API v2, signs the buyer in with Microsoft Entra ID, and links the Microsoft subscription to a three.ws account |
| Fulfillment API v2 client | Server module: resolve, activate, get and list subscriptions, update plan, delete. Calls as the publisher with an Entra app token |
| Connection webhook | Handles `ChangePlan`, `ChangeQuantity`, `Renew`, `Suspend`, `Unsubscribe`, `Reinstate`. Verifies the caller, returns 200 fast, and processes idempotently by operation id |
| Entra ID app registrations | A multitenant app for buyer SSO on the landing page, and a single-tenant app for the publisher's Fulfillment and Metering API calls |
| Plans and pricing | Mapped to the existing plans in [`api/subscriptions/plans.js`](../api/subscriptions/plans.js). Flat monthly plans first |
| Metered dimensions | Hourly usage to the Metering API: GPU generation minutes and agent chat calls. Dimensions are declared in Partner Center before use |
| Account link | New table linking the Microsoft subscription id, tenant id and purchaser to a three.ws user and plan |
| Policies | Privacy policy, terms, support URL and email, supported countries, and a plan description procurement can read |

### Build steps

1. Register the two Entra apps. Store secrets on Cloud Run with `--update-env-vars` only.
2. Migration for the subscription link table. Read `npm run db:status` before `npm run db:migrate`.
3. Fulfillment client and landing page flow under `api/`, with tests against recorded Microsoft sandbox responses.
4. Webhook handler with caller and tenant checks, idempotency by operation id, and a retry-safe state machine (pending, active, suspended, unsubscribed).
5. Metering cron on Cloud Scheduler (`vercel.json` crons) that batches usage per subscription and dimension and retries rejected or duplicate events.
6. Entitlements: a linked subscription grants the same quotas as the matching direct plan. Nothing forks for this channel.
7. Partner Center (owner): create the offer, fill listing, plans and technical configuration, run preview with an allow-listed tenant, publish.
8. Docs: [microsoft.md](./microsoft.md), [listings.md](./listings.md), the listings registry, a changelog entry and a `STRUCTURE.md` row.

### Listing content

- Name: three.ws. Categories: AI + Machine Learning, Developer Tools.
- Lead with enterprise outcomes: text, photo or sketch to rigged 3D models; embeddable AI agents with a body (`<agent-3d>`); MCP tools for any AI client.
- Screenshots and a short demo video taken from the production app.
- Keep the listing enterprise-focused. Review Microsoft's commercial marketplace policies on cryptocurrency content before mentioning $THREE or the Solana agent economy in listing copy. The platform itself is unchanged.

### Test plan

- Preview subscriptions with an allow-listed tenant: purchase, plan change, suspend, reinstate, cancel.
- Unit tests for the webhook state machine and metering batching. One end-to-end run against Microsoft's sandbox before submitting.
- Browser check of landing page error states (expired token, tenant mismatch, already linked): each one says what went wrong and how to recover.

## 2. Apps and Agents for M365 and Copilot

The newer Partner Center offer type that carries MCP server certification. It does not appear in the category list above because it sits under the Microsoft 365 and Copilot program. The full package, manifest and eligibility table are in [`microsoft-copilot-mcp-certification.md`](../marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md).

- Endpoints: `https://three.ws/api/mcp-studio` (free 3D tools) first, `https://three.ws/api/mcp` later.
- One open gap: Microsoft does not support Dynamic Client Registration. Register one confidential OAuth client for Microsoft and store its values in an Azure Key Vault (owner step).
- The same manifest can later add a Teams bot or message extension (#5) so one offer covers Copilot, Teams and Foundry.

## 3. Professional service offers

Three fixed-scope offers, priced as "contact me" or a fixed fee:

1. **Embed a 3D agent on your site or intranet.** `<agent-3d>` integration, theming, SSO.
2. **Custom avatar and agent build.** Brand character, persona, skills, voice.
3. **Agent MCP integration.** Connect an internal system to agents through MCP tools.

Each needs a title, summary, description, contact and a pricing statement. Leads route to the existing contact channel.

## 4. Power Platform certified connector

Microsoft's ISV connector certification publishes a custom connector to every Power Platform tenant: Power Automate, Power Apps, Copilot Studio and Logic Apps.

- Source of truth: an OpenAPI 2.0 definition for a focused set of endpoints (generate a model, check job status, list agents, send an agent message) plus `apiProperties.json` with OAuth 2.0.
- Submission is a pull request to Microsoft's open `PowerPlatformConnectors` repository plus a certification package, then Microsoft's functional review.
- Build: generate the definition from the live handlers, validate with `paconn`, and keep it in-repo next to the API docs so it cannot drift.

## 5. Teams app

- A message extension that searches agents and models and posts a Glance Adaptive Card ([`api/_lib/glance-adaptive.js`](../api/_lib/glance-adaptive.js)) with a link that opens the 3D viewer in a Teams tab.
- A personal tab that embeds the `<agent-3d>` chat with Entra SSO.
- Ships inside the #2 manifest as one app package, so there is one review, not two.

## 6 to 8. Store listings that reuse finished code

| Store | Package | Steps |
|---|---|---|
| Visual Studio Marketplace | `packages/vscode-3d`, `packages/vscode-x402` | Create the publisher, `vsce package`, `vsce publish` (owner token). Listing text from [vscode.md](./vscode.md) |
| Microsoft Edge Add-ons | `extensions/walk-avatar`, `extensions/checkout-companion` | MV3 builds run on Edge unchanged. Register in the Edge Partner Center dashboard, upload the zip, add Edge store screenshots |
| Microsoft Store | PWA from `public/site.webmanifest` | Package with PWABuilder (MSIX), reserve the app name in Partner Center, submit. Add `share_target` and `shortcuts` to the manifest so the Windows app earns its install |

## 9 and 10. GitHub and Foundry

- **GitHub MCP Registry and Technology Partner Program**: form drafted in [`github-technology-partner.md`](../marketing/growth/submissions/programs/github-technology-partner.md). The curated registry feeds MCP discovery in Copilot in VS Code.
- **Foundry Agent Service**: Foundry agents attach remote MCP tools by URL today. The #2 certification is what puts three.ws in Microsoft's catalog rather than requiring a pasted URL. Add a Foundry quickstart to [MCP tools](./mcp-tools.md).

## 11. Microsoft 365 Certification

Two tiers: **Publisher Attestation** (a self-assessment questionnaire on data handling and security) and **Microsoft 365 Certification** (an audited assessment). Start with Publisher Attestation as soon as #2 or #5 is published; it shows on the listing and shortens enterprise IT review.

## 12. Partner programmes and benefits

All owner-side enrollments. Verify current terms in Partner Center before relying on any number.

| Programme | What it brings | Trigger |
|---|---|---|
| Microsoft AI Cloud Partner Program | Partner Center, benefits packages, partner tooling | Already enrolled as a publisher |
| ISV Success | Cloud credits, developer tools, technical consults, marketplace onboarding help | Building or publishing a marketplace offer |
| Marketplace Rewards | Go-to-market benefits and co-marketing that scale with marketplace sales | First transactable sale through #1 |
| Microsoft for Startups | Azure credits and startup tooling | Startup application |

Azure credits are useful for the Microsoft-specific pieces only (Key Vault for #2, preview tenants, container offer testing). They are not a reason to move production off Google Cloud.

## 13. Bing and Copilot search

[`api/_lib/indexnow.js`](../api/_lib/indexnow.js) already pings IndexNow, which Bing consumes. Remaining work: verify the site in Bing Webmaster Tools (owner sign-in), submit the sitemaps from [`api/sitemap/[type].js`](../api/sitemap/[type].js), and review the crawl report for blocked pages.

## 14. Co-marketing

- Microsoft Tech Community posts in the same format as the IBM community articles (see [ibm-community.md](./ibm-community.md)).
- A customer story or partner blog post once #1 has a first buyer.
- A Microsoft Reactor session demoing three.ws tools inside Copilot after #2 is certified.

## 15. Azure Container offer (on demand only)

Package the agent runtime and, separately, a GPU worker image. Needs a versioned image in an Azure Container Registry, a Helm or CNAB package, a support runbook and a clear statement that hosted three.ws stays the default.

---

## Sequencing

1. **Now, no build:** professional service offers (#3), Publisher Attestation prep (#11), Bing Webmaster verification (#13), programme enrollments (#12).
2. **This sprint:** VS Code, Edge and Microsoft Store listings (#6 to #8), and the #2 OAuth client and Key Vault so the certification can be submitted.
3. **Next:** SaaS fulfillment, webhook and metering (#1), then the Teams package (#5) and the Power Platform connector (#4).
4. **After first sale:** Marketplace Rewards, co-marketing (#14), and the Power BI visual or container offer only if customers ask.

## Owner steps

- Partner Center access: Entra app registrations, the Microsoft 365 and Copilot program enrollment, the preview tenant allow-list.
- Business verification of the publisher account (required for #2).
- Final plan names, prices and metered rates.
- Legal: privacy policy and terms review, the support contact.
- Publishing every offer and store listing (outward-facing, needs owner approval).
- Written confirmation of any Microsoft partner tier before it appears anywhere.

## Done when

- A Microsoft customer can find the SaaS offer, buy a plan, land on three.ws, sign in with Entra and see the entitlement active.
- Plan changes, suspension and cancellation from Microsoft reach the account within one webhook cycle, and usage appears on the Microsoft invoice.
- three.ws tools are callable from Copilot Studio and Microsoft 365 Copilot through the certified MCP offer.
- The VS Code, Edge and Microsoft Store listings are live and recorded in the listings registry.
- Docs and changelog are updated, and `npm run audit:docs` passes.
