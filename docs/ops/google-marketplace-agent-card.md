# Google Cloud Marketplace Agent Card: upload runbook

**Owner-run.** Every step that touches Cloud Storage, Producer Portal or the
billing account is the owner's: uploading the card publishes listing content,
and Producer Portal access comes with the Partner Network enrollment and the
Marketplace Vendor Agreement. An agent may build and validate the card (step 2)
and run the read-only checks (steps 1 and 6).

The Marketplace listing takes the Agent Card as a JSON object in Cloud Storage,
in the same project as the listing, attached with **Save and validate** in
Producer Portal ([Agent Card doc](https://docs.cloud.google.com/marketplace/docs/partners/ai-agents/agent-card)).
The public card at `https://three.ws/.well-known/agent-card.json` stays as it
is; the Marketplace copy is derived from it by
[`scripts/build-marketplace-agent-card.mjs`](../../scripts/build-marketplace-agent-card.mjs).

| | Public card | Marketplace card |
|---|---|---|
| File | `public/.well-known/agent-card.json` | `dist/marketplace/agent-card.json` (built, not committed) |
| Endpoint, protocol versions, interfaces, security, modes, version | same | same |
| Name and description | platform wording | enterprise wording about the 3D skills |
| Skills | every routed skill | `generate-3d-model`, `validate-model`, `search-avatars` (the registry entries marked `marketplace`) |
| Extensions | the a2a-x402 payment extension, optional | none for payment; one optional listing extension `https://three.ws/a2a/extensions/marketplace-listing/v1` |
| Models, competence, billing | not stated | in the listing extension's `params`: the default model is `IMAGE_MODEL_PRIMARY` from [`api/_lib/image-model.js`](../../api/_lib/image-model.js) (Gemini on Vertex AI); `billing.invoicedBy` is Google Cloud Marketplace |

`tests/a2a-agent-card.test.js` pins that the two cards differ only in those rows.

## 1. Check the one remaining blocker: Vertex billing

Google requires a Gemini or Model Garden model as the agent's default. The card
names Gemini, so Vertex must answer before the listing is submitted.

```bash
T=$(gcloud auth print-access-token)
curl -s -X POST -H "Authorization: Bearer $T" -H 'content-type: application/json' \
  "https://aiplatform.googleapis.com/v1/projects/aerial-vehicle-466722-p5/locations/global/publishers/google/models/gemini-2.5-flash:generateContent" \
  -d '{"contents":[{"role":"user","parts":[{"text":"Say ok"}]}]}' | head -c 300
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="three-ws-api" AND textPayload:"billing account"' \
  --project aerial-vehicle-466722-p5 --freshness 1d --limit 5 --format='value(timestamp)'
gcloud billing projects describe aerial-vehicle-466722-p5 --billing-project=aerial-vehicle-466722-p5
```

On 2026-11-04 the first call returned `403 There are issues with your billing
account, please resolve / pay your outstanding balance for project:
projects/93741856042`, and production logged the same error at 19:24Z. Pay the
outstanding balance in the console (Billing, then Payment overview); only the
owner can. Ready means the first call returns a candidate and the log query is
empty for a day. The production brain default (`VERTEX_CLAUDE_PRIMARY=0` on
`three-ws-api`) is a separate decision the
[Google packet](../../marketing/partner-packets/google-cloud-ai-agents.md) tracks.

## 2. Build and validate the card

```bash
npm run build:discovery          # refresh the public card from the live catalog
npm run build:marketplace-card   # writes dist/marketplace/agent-card.json
npm run validate:a2a-card        # both cards against the A2A rules; exit 1 on any failure
jq '{name, url, version, skills: [.skills[].id], ext: .capabilities.extensions[0].params.models[0]}' dist/marketplace/agent-card.json
```

Build from the commit that is deployed, so the card's `version` matches what
`https://three.ws/api/version` reports.

## 3. Create the bucket (once)

```bash
gcloud storage buckets create gs://three-ws-marketplace-agent-card \
  --project aerial-vehicle-466722-p5 --location us-central1 \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets update gs://three-ws-marketplace-agent-card --versioning
```

Versioning keeps every uploaded card, so a rejected revision can be compared
with the last accepted one. Public access stays off: Producer Portal reads the
object with the project's own access, it does not need a public URL.

## 4. Upload

```bash
gcloud storage cp dist/marketplace/agent-card.json \
  gs://three-ws-marketplace-agent-card/agent-card.json \
  --project aerial-vehicle-466722-p5 --content-type=application/json
gcloud storage objects describe gs://three-ws-marketplace-agent-card/agent-card.json \
  --format='value(generation,size,content_type)'
```

Record the `generation` in the listing notes; it names exactly which card was
attached.

## 5. Attach in Producer Portal

1. Producer Portal, the AI agent product, **Agent Card**.
2. Select `gs://three-ws-marketplace-agent-card/agent-card.json`.
3. **Save and validate**. A validation error names a field; fix it in
   `scripts/build-marketplace-agent-card.mjs` (never in the JSON), rebuild,
   re-run step 2 and upload again.
4. Run the **Agent ScoreCard** and keep the result with the listing notes.

If the validator rejects the unknown listing extension, drop it from
`buildMarketplaceCard()` (the models, competence and billing facts then go in
the listing form fields instead) and re-run steps 2 to 5. The A2A spec allows
agent-defined extensions, so this is not expected.

## 6. Production evidence for the listing forms

Refresh these on the day of submission; the packet's figures are dated.

```bash
curl -s https://three.ws/api/platform/stats | jq
curl -s https://three.ws/.well-known/agent-card.json | jq '{version, skills: (.skills | length)}'
curl -s https://three.ws/api/agents/a2a-paid -H 'content-type: application/json' -H 'A2A-Version: 1.0' \
  -d '{"jsonrpc":"2.0","id":1,"method":"SendMessage","params":{"message":{"messageId":"m1","role":"ROLE_USER","parts":[{"text":"Validate https://three.ws/avatars/default.glb"}]}}}' \
  | jq '.result.task.status.state'
```

Generation counts come from the production database (`forge_creations`):
started and completed since launch, and completed in the last 30 days.
