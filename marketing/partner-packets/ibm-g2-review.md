# G2 review draft: IBM watsonx.ai (with Granite)

**Status: needs the reviewer's own confirmation.** This is a fact sheet and a first draft for a real
watsonx.ai user at three.ws to rewrite in their own words. G2's review page says "Be Authentic... allowing
[generative AI] to write everything does not benefit our community", and asks for a screenshot proving
use of the software. Do not paste this verbatim.

**Target:** G2 product page for IBM watsonx.ai
**Verified intake:** https://www.g2.com/products/ibm-watsonx-ai/take_survey (renders "Login or create an
account to review IBM watsonx.ai", read 2026-09-16). G2 also lists IBM Granite separately at
https://www.g2.com/products/ibm-granite/take_survey; review one product, not both with the same text.
**Deadline:** none published. The September 2026 Partner Plus mailer offered a USD 25 gift card for a G2
review ([docs/partners/ibm-partner-plus.md](../../docs/partners/ibm-partner-plus.md)); the mailer itself
is not in the repo, so its terms and closing date are unverified.
**Owner's one step:** the person at three.ws who actually used watsonx.ai signs in to G2 with their work
email, attaches their own watsonx.ai console screenshot, and submits a review written from the notes
below.

---

## The honest framing, before any draft

| Fact | Evidence | Captured |
|---|---|---|
| three.ws built a real watsonx.ai integration: IAM token exchange, chat, embeddings, TimeSeries forecasting, vision, and Guardian | [`api/_lib/watsonx.js`](../../api/_lib/watsonx.js), [`api/_lib/granite-guardian.js`](../../api/_lib/granite-guardian.js), [`api/_lib/watsonx-forecast.js`](../../api/_lib/watsonx-forecast.js); first commit "feat: watsonx integration for brain/chat + agent wiring" dated 2026-06-02 | repo |
| Models wired | `ibm/granite-3-8b-instruct`, `ibm/granite-embedding-278m-multilingual`, `ibm/granite-ttm-512-96-r2` (plus 1024 and 1536 context variants), `ibm/granite-vision-3-2-2b`, `ibm/granite-guardian-3-8b` | [docs/ibm.md](../../docs/ibm.md) |
| **The hosted platform is not calling watsonx.ai today** | `GET https://three.ws/api/ibm/galaxy` returned `watsonx_not_configured`; `/api/watsonx/embed` answered from an NVIDIA model; no `WATSONX_*` variables on the Cloud Run service; commit `2effca36a` on 2026-07-29 records the credentials "exist nowhere" | 2026-09-16 |
| Open-source connectors that call watsonx.ai with the user's own credentials are published and used | `@three-ws/ibm-watsonx-mcp` 494 downloads and `@three-ws/ibm-x402-mcp` 483 downloads, 2026-08-13 to 2026-09-11 (npm downloads API) | 2026-09-16 |

So the review must be written in the **past tense for hosted production use** (roughly June to July
2026; the exact end date is not recorded) and must not say "we run Granite in production". If watsonx
credentials are restored before the review is written, re-run `curl https://three.ws/api/ibm/galaxy` and
update the tense.

---

## Draft notes for the G2 questions

G2's survey text behind the login was not readable from a logged-out browser, so the prompts below are
the three G2 open-text questions as they have long appeared on its review form. Confirm the exact
wording on screen.

**Review title (draft):**
> Granite on watsonx.ai gave our 3D agents a governance layer, not just another chat model

**What do you like best? (draft notes)**
- Granite Guardian returns calibrated `Yes`/`No` log-probabilities, so we could score each named risk
  (jailbreak, harm, social bias, violence, profanity, and more) and collapse them into an
  allow/review/block decision before an agent took an autonomous action. That was more useful to us
  than a single moderation flag.
- The Granite TimeSeries (TinyTimeMixer) models encode context and horizon in the model id
  (`ttm-512-96`, `-1024-96`, `-1536-96`), which made it trivial to pick the largest model the available
  history could fill.
- `granite-embedding-278m-multilingual` was good enough for semantic agent discovery and
  impersonation checks on names and descriptions.
- One IBM Cloud API key exchanged for a short-lived IAM token, cached for about an hour, covered chat,
  embeddings, vision, and forecasting behind one client.

**What do you dislike? (draft notes)**
- The reviewer should supply real friction from their own experience. Code-level facts that may
  help them remember: the IAM token exchange is an extra round-trip we had to cache and coalesce
  across concurrent requests; region-specific hosts and a separate version contract for some
  endpoints needed per-account overrides; watsonx.ai credentials are project-scoped, so every call
  needs a project or space id alongside the key.
- Say plainly if the credentials lapsed for a business reason; that is the most useful thing a reader
  can learn from this review.

**What problems is watsonx.ai solving and how is that benefiting you? (draft notes)**
- A governed "brain" option for embodied 3D agents: an agent could think on Granite and have an
  autonomous money action vetoed by Granite Guardian before it executed.
- Forecast, narrate, and govern in one vendor stack for the Granite Oracle experiment, which then
  notarized governed forecasts on Solana.
- The open-source MCP connector lets other developers reach watsonx.ai from Claude, Cursor, or any MCP
  client with their own credentials and no intermediary backend.

**Ratings, likelihood to recommend, role, company size, time used:** reviewer only. Do not estimate
these for them. Company size is not recorded in the repo.

---

## Packet fields

**One-sentence pitch:** a practitioner review of watsonx.ai from a team that wired five Granite model
families, including Guardian, into an embodied agent platform.

**100-word abstract:** three.ws integrated IBM watsonx.ai in June 2026 and used Granite models for
chat, multilingual embeddings, time-series forecasting, vision, and governance. Its most distinctive
use was Granite Guardian as an action veto: log-probability risk scores collapsed into allow, review,
or block before an AI agent could act. The team also published two open-source MCP connectors that
reach watsonx.ai with a developer's own credentials, downloaded 977 times in the 30 days to
2026-09-11. The hosted platform is not currently configured with watsonx credentials, so this review
describes production use during mid-2026 and continuing developer use through the connectors.

**Working link:** https://three.ws/docs/ibm (200 on 2026-09-16)

**Screenshot:** G2 wants a screenshot of the reviewer using watsonx.ai itself (the IBM console). Only
the reviewer can capture that; no three.ws page proves watsonx.ai usage today, so none is attached.

**Two proposed dates:** not applicable.

**Requested action:** publish the review on G2.

**Approved relationship wording:** three.ws is an **IBM Business Partner**, a designation, not an
endorsement. G2 asks reviewers to disclose relationships with the vendor: select the partner/reseller
disclosure if G2 offers it, and do not describe the review as IBM-requested beyond what the mailer
actually said.
