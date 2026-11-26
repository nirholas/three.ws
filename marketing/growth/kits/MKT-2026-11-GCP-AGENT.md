# MKT-2026-11-GCP-AGENT: a production A2A agent with a browser-native 3D interface

**Kit status:** copy complete and **held behind three blockers.** Nothing announcing a Google Cloud
listing may post until the listing exists; this kit also carries a fallback post that is true today.

## Blockers (verified 2026-09-17)

1. **Vertex AI is billing-denied on the production project.** Cloud Run logs for `three-ws-api` at
   2026-09-17T03:12Z read `vertex imagen failed, falling back: Lightning dunning decision is deny for
   project: projects/93741856042`. Google's AI agent listing requirements ask an A2A agent to use a Model
   Garden model as its default; production cannot today. Clear the billing hold first.
2. **The Agent Card is not yet a valid Marketplace Agent Card.** `https://three.ws/.well-known/agent-card.json`
   (version 1.5.1, 10 skills) has no `protocolVersion`, no `preferredTransport`, no
   `securitySchemes`/`security` (it uses the older `authentication` key), and its `url` is the website
   `https://three.ws/`, not the A2A endpoint. Full gap table:
   [marketing/partner-packets/google-cloud-ai-agents.md](../../partner-packets/google-cloud-ai-agents.md).
3. **No Partner Network enrollment.** three.ws is a member of Google Cloud for Web3 Startups, not a Google
   Cloud Partner, and has no Marketplace listing (campaigns.csv status `awaiting_enrollment`).

## At a glance

| Field | Value |
|---|---|
| Campaign id | `MKT-2026-11-GCP-AGENT` |
| Publish date | 2026-11-10 (slides until the listing is live) |
| Summary | Enterprise agent builders can discover a three.ws A2A agent in Google Cloud Marketplace that turns a prompt into a rigged, embeddable 3D character, running on the same Cloud Run stack as three.ws |
| Audience | enterprise agent builders |
| Primary channel | Google Cloud Marketplace or the AI agent finder |
| Secondary channels | LinkedIn, X, three.ws news |
| Proof | https://three.ws/.well-known/agent-card.json |
| Tracked links | X `https://three.ws/.well-known/agent-card.json?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-gcp-agent&utm_content=fallback`; LinkedIn `https://three.ws/forge?utm_source=linkedin&utm_medium=social&utm_campaign=mkt-2026-11-gcp-agent&utm_content=post` |
| The single CTA | Inspect the Agent Card and run the live agent |
| Partner ask | AI Agents validation and finder placement |
| KPI | agent calls, listing visits, and placement |

`{{LISTING_URL}}` is the Google Cloud Marketplace product page, which exists only after Producer Portal
publication.

## Audit: what already exists

| Channel | Existing asset | State | How this kit uses it |
|---|---|---|---|
| Enrollment path, business case, architecture | [marketing/partner-packets/google-cloud-ai-agents.md](../../partner-packets/google-cloud-ai-agents.md) | Ready; records blockers 1 and 2 | Is the partner-facing material |
| Google Cloud Community long-form | [docs/google-cloud-community-post.md](../../../docs/google-cloud-community-post.md) | Draft | Optional companion; not part of this anchor |
| Production facts | [docs/ops/gcp-production.md](../../../docs/ops/gcp-production.md) | Current | Source for Cloud Run claims |
| Media | [partner-packets/images/forge.png](../../partner-packets/images/forge.png) | Exists | Fallback post image |
| X, LinkedIn, news, finder ask | none | Missing | Written below |

## X

**Launch anchor, only after the listing is live** (175 weighted characters measured with a placeholder
Marketplace URL):

```text
three.ws is listed in Google Cloud Marketplace as an A2A agent: a prompt in, a rigged, embeddable 3D character out, served from Cloud Run: {{LISTING_URL}} @googlecloud
```

**Fallback, true today, if the owner wants the campaign slot used before the listing** (177):

```text
Our Agent Card is public JSON: ten declared skills an agent can read before it calls anything, from avatar search to GLB validation. Served by Cloud Run: https://three.ws/.well-known/agent-card.json?utm_source=x&utm_medium=social&utm_campaign=mkt-2026-11-gcp-agent&utm_content=fallback
```

**Media:** a capture of `{{LISTING_URL}}` for the launch anchor; `forge.png` for the fallback.
**Alt text (fallback):** The Forge page: a prompt box, quality and engine selectors, and a
Generate button.

## LinkedIn (launch day)

```text
Agents built for the enterprise mostly answer in text. Some questions deserve an object.

three.ws is now available in Google Cloud Marketplace as an AI agent that speaks the A2A protocol. Other agents can read its public Agent Card, see its declared skills, and call it to turn a prompt or a photo into a textured, rigged 3D character that can be inspected, placed in a room in AR, or embedded on a page with one tag.

The agent runs on Google Cloud in production: Cloud Run serves the API, a Cloud Run GPU fleet runs 3D generation, rigging, and motion, and Cloud Scheduler runs the background jobs. Procurement goes through the Google Cloud account your organization already uses.

three.ws is a member of Google Cloud for Web3 Startups.

Find it in Marketplace: {{LISTING_URL}}
```

(128 words; tracked alternative link in the table above if the listing does not unfurl.)

## three.ws news blurb

three.ws is available in Google Cloud Marketplace as an A2A agent: other agents can read its Agent Card
and call it to generate rigged, embeddable 3D characters from a prompt or photo. It runs on the same
Cloud Run and GPU stack that serves three.ws. Listing: {{LISTING_URL}}.

## Partner message

Step 1 has no message: enroll at `https://partners.cloud.google.com/enrollment`. After enrollment, and
only after blockers 1 and 2 are closed, send this to the partner manager Google assigns (no contact name
exists in the repo):

```text
Subject: three.ws A2A agent: AI Agents program validation and agent finder placement

three.ws (Partner ID {{PARTNER_ID}}) runs its production stack on Google Cloud: Cloud Run for the API and a Cloud Run GPU fleet for 3D generation, rigging, and motion. Our A2A agent is onboarded in Producer Portal as {{PRODUCER_PORTAL_PRODUCT}}, with the Agent Card uploaded to Cloud Storage and a Model Garden model as the default.

Two asks: route the agent into AI Agents program validation (and Gemini Enterprise validation if it qualifies), and confirm how an approved listing is placed in the AI agent finder at cloud.withgoogle.com/agentfinder.

The forwardable packet, architecture, and business case are attached.
```

Attach the forwardable packet and architecture section from the Google Cloud packet, with its metrics
re-read on the day.

## T+7 result fields

| Field | Source |
|---|---|
| Listing visits | Producer Portal analytics |
| Agent calls | production logs for the A2A handler (`/api/agents/a2a-paid`) in the window |
| Agent Card fetches | production logs for `/.well-known/agent-card.json` |
| Placement | agent finder URL, or "not placed" |

## Claims check

| Claim | Proof | Verified |
|---|---|---|
| Agent Card is public, version 1.5.1, 10 skills | `curl https://three.ws/.well-known/agent-card.json` | 2026-09-17 |
| Card missing `protocolVersion`, `preferredTransport`, `securitySchemes`; `url` is the website | same fetch, key list | 2026-09-17 |
| Vertex AI billing-denied | Cloud Run log line at 2026-09-17T03:12Z | 2026-09-17 |
| Production runs on Cloud Run with a Cloud Run GPU fleet and Cloud Scheduler | [docs/partners.md](../../../docs/partners.md) Google Cloud section; `/api/version` reports service `three-ws-api` | 2026-09-17 |
| Member of Google Cloud for Web3 Startups; not a Google Cloud Partner; no listing | [docs/partners.md](../../../docs/partners.md), packet relationship wording | repo |
| Prompt or photo to textured, rigged 3D character; AR; one-tag embed | live `forge_free` generation returned GLB and AR URLs on 2026-09-17; `<agent-3d>` web component docs | 2026-09-17 |
| Enrollment and agent finder URLs resolve | both returned HTTP 200 | 2026-09-17 |

Dropped: generation totals and uptime percentages (quoted in the packet with 2026-09-16 capture dates;
re-read on sending day rather than frozen into public copy), and "Vertex AI powers the agent" (false while
billing is denied).

## Owner does

Clear the Vertex billing hold and enroll at `partners.cloud.google.com/enrollment`; the Agent Card fixes
are engineering work that needs no approval.
