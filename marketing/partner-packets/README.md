# Partner packets

Forwardable request packets for partner and program opportunities that had no packet. Each one follows
the rule in the [marketing operating plan](../OPERATING-PLAN.md): one-sentence pitch, 100-word abstract,
working link, screenshot, bio where relevant, two proposed dates where relevant, the exact requested
action, and approved relationship wording. Every packet also names the verified intake URL, the single
step the owner takes, and each metric with its source and capture date.

Researched, verified, and captured on **2026-09-16**. Sending, submitting, and posting remain owner
actions; nothing here has been sent.

## Index

| Packet | Target | Deadline | The owner's one step | Status |
|---|---|---|---|---|
| [IBM Champions nomination](ibm-champions-nomination.md) | IBM Champions class of 2027 (individual) | Not published; 2027 applications are open now. Last cycle closed Nov 21, so treat **2026-11-20** as the latest safe date | The nominee submits the candidate form at `ibm.biz/beanIBMChampion` with the drafted answers | Ready after the nominee confirms name, title, country, and authorship of the npm connectors |
| [IBM G2 review](ibm-g2-review.md) | G2, IBM watsonx.ai | None published | The real watsonx.ai user writes and submits the review in their own words with their own console screenshot | **Needs reviewer confirmation.** Hosted Granite is not configured today; past tense only |
| [OpenAI share-your-story](openai-share-your-story.md) | OpenAI Stories form | None on form; pipeline target 2026-10-09 | After the App Directory review returns, fill name, email, city, state and submit the four answers | Drafted; hold for the review outcome |
| [Google Cloud AI Agents](google-cloud-ai-agents.md) | Partner Network, AI Agents program, agent finder, Marketplace | None published; pipeline target 2026-09-25 | Enroll the company at `partners.cloud.google.com/enrollment` | Enrollment ready; the A2A listing is blocked by the Vertex billing denial and Agent Card gaps |
| [ElevenLabs Startup Grants](elevenlabs-startup-grants.md) | ElevenLabs Startup Grants | Rolling; closing date not computable; pipeline target 2026-09-24 | Confirm headcount under 25, then submit the application | Ready if under 25 employees; Demo Day 2026-10-21 is already cast |
| [Quicknode field note](quicknode-rpc-failover-field-note.md) | Quicknode Startup Program | Attach to the ask below | Re-check `/api/healthz` and `/api/version`, then attach | Ready |
| [Quicknode spotlight ask](quicknode-spotlight-ask.md) | Quicknode Feature Friday or founder spotlight | None published; pipeline target 2026-10-09 | Reply in the existing program thread with the email and the field note | Ready; program contact name is not in the repo |
| [Anthropic](anthropic.md) | MCP Registry, Claude plugin marketplace, Connectors Directory, Claude for Startups | None | Run the staged MCP Registry publish of three servers | Registry ready; plugin ready after re-validation; Connectors needs two owner decisions; no partnership exists |

## Findings that change what we can claim

These came out of verification and contradict current pipeline rows. They are repeated in the packet each
one affects.

- **Granite is not running in production.** `/api/ibm/galaxy` returns `watsonx_not_configured`; there are no
  `WATSONX_*` variables on Cloud Run (absent since at least 2026-07-29, commit `2effca36a`). "Run Granite in
  production" in [docs/partners/opportunities.md](../../docs/partners/opportunities.md) is stale.
- **Vertex AI is billing-denied on the production project.** Logs on 2026-09-16 read "Lightning dunning
  decision is deny for project: projects/93741856042". This blocks Google's Model Garden default
  requirement for A2A agent listings and any Vertex Claude lane.
- **Claude is the configured default brain, not the served one.** No Anthropic key, Vertex Claude flags off.
- **ElevenLabs runs only with a user's own key.** No platform key; the Voice Lab copy implies platform
  metering that cannot currently run.
- **The Claude connector submission sheet is stale.** `/api/mcp` now has 61 tools, including a copy-trading
  setup tool and an NFT mint, both review risks under the directory's financial-asset rule.
- **`/ibm/hello` imitates ibm.com page chrome** (IBM wordmark and navigation). Its screenshot was
  deliberately left out of the IBM packets; sending IBM a three.ws page styled as ibm.com invites a
  brand-use objection.

## Images

All captured with Playwright from live pages on 2026-09-16 at 1600 by 900 and viewed to confirm they
render real content.

| File | Page | Used in |
|---|---|---|
| [ibm-community-group.png](images/ibm-community-group.png) | IBM Community, Three.ws User Group home (cropped to 720 px tall to remove the cookie banner) | IBM Champions |
| [openai-page.png](images/openai-page.png) | `https://three.ws/openai` | OpenAI share-your-story |
| [forge.png](images/forge.png) | `https://three.ws/forge` | Google Cloud |
| [voice-lab-elevenlabs.png](images/voice-lab-elevenlabs.png) | `https://three.ws/voice`, "Use Your Own ElevenLabs Key" section | ElevenLabs |
| [docs-solana-failover.png](images/docs-solana-failover.png) | `https://three.ws/docs/solana`, failover section | Quicknode |
| [docs-mcp.png](images/docs-mcp.png) | `https://three.ws/docs/mcp` | Anthropic |

The G2 packet has no image by design: G2 wants the reviewer's own screenshot of watsonx.ai.

## Keeping these current

Figures go stale fast. Re-run these on the day a packet is sent and update the numbers in place:

```bash
curl -s https://three.ws/api/platform/stats
curl -s https://three.ws/api/version
curl -s https://three.ws/api/healthz
curl -s https://three.ws/api/tts/catalog
curl -s https://three.ws/api/ibm/galaxy
```

Generation counts come from the production `forge_creations` table and are not public. When a packet is
sent, record the date and any receipt in the packet's header and move the matching row in
[opportunities.csv](../growth/opportunities.csv).
