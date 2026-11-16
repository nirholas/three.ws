# microsoft campaign: owner actions

Every step below needs the owner (push, deploy, Partner Center, Entra, store submissions, PRs to Microsoft repositories, secrets only the owner holds). The agent-side work for each order is built and verified, and its work order has moved to [../../archive/](../../archive/). Evidence and commit SHAs are in [microsoft-PROGRESS.md](microsoft-PROGRESS.md) and [microsoft-PROGRESS-archive-1.md](microsoft-PROGRESS-archive-1.md). Strike a row when it is done. Recorded 2026-11-16.

## Do these first: they unblock most rows

1. **Push and deploy.** `git push threews main`, then `npm run deploy:gcp:full` (see the deploy-runbook skill). This ships the r2.dev to /cdn/ fix (97669b7df) that 824, 831 and 804 need, plus the code for 828 to 831, 838, 842 and 845 to 847.
2. **Apply the pending migrations** after `npm run db:status`: `20261116120000_teams_identities.sql` (846), `20261116144659_teams_conversation_refs.sql` (847), `20261116150000_usage_feed_keys.sql` (845), plus any other queued ones.
3. **Entra and Azure provisioning (827).** `az login`, `npm run microsoft:provision -- --apply --subscription <id>`, run the printed `gcloud run services update three-ws-api --update-env-vars ...` line, then `npm run microsoft:provision -- --verify`. This produces MS_ENTRA_SSO_CLIENT_ID/SECRET (816, 844), MS_MARKETPLACE_TENANT_ID/CLIENT_ID/CLIENT_SECRET (801, 821) and the bot app (804, 846).

## Per order

| Order | Owner steps left |
|---|---|
| 801 partner hub | Free or raise us-central1 L4 quota for model-trellis2, route traffic to model-trellis2-00016-dab, set MODEL_TRELLIS2_URL with `--update-env-vars`; set the five MS_* Marketplace variables (step 3). |
| 802 Forge to PowerPoint | Open an exported deck in PowerPoint and rotate the model; sideload the add-in manifest; submit to AppSource. |
| 803 Teams Live Share review | Sideload and run a real two-person Teams meeting; upload the app package to the Teams Store. |
| 804 Teams Adaptive Cards | Register the Azure Bot client credentials and set the bot env vars (step 3); deploy (step 1). |
| 805 Windows and Edge app | Bump MS_STORE_VERSION, `npm run package:microsoft-store`, resubmit the Store listing in Partner Center; check the file handler on a real Windows machine. |
| 816 M365 Copilot connector | Step 3; connect a developer tenant and run a sync. |
| 817 Power Platform | Deploy; register the public PKCE client and rebuild with PP_OAUTH_CLIENT_ID; `paconn validate`; import templates in a dev environment and run each action 10 times; Solution Checker and ConnectorPackageValidator.ps1; PR to microsoft/PowerPlatformConnectors `dev`; Partner Center submission. |
| 818 Phi brain lane | Deploy model-phi with `workers/model-phi/cloudbuild.yaml` and set PHI_WORKER_URL (no task type is routed to it: it lost the evaluation). |
| 819 Florence-2 captions | `gcloud builds submit --config workers/model-florence2/cloudbuild.yaml`; set MODEL_FLORENCE2_URL; deploy; cron sync. |
| 820 TRELLIS.2 lab | Promote image server:fix11111641 on model-trellis2 (needs an L4); set MODEL_TRELLIS2_URL; decide whether to keep model-trellis2-lab. |
| 821 partnership ops board | Set TELEGRAM_ALERTS_CHAT_ID and/or OPS_ALERT_EMAILS with `--update-env-vars`; step 3; add the Entra app in Partner Center with the Manager role. |
| 822 Marketplace leads | In Partner Center, each offer's Customer leads: HTTPS endpoint `https://three.ws/api/microsoft-marketplace/leads/<MS_MARKETPLACE_LEADS_TOKEN from Cloud Run>`, then Validate. |
| 823 Bing and Copilot search | Verify three.ws in Bing Webmaster Tools and submit `https://three.ws/sitemap.xml`; approve the FAQ markup alignment on /features/deploy, /features/agent-exchange, /features/play. |
| 824 listing media kit | After step 1, run `npm run media:microsoft` and confirm the full run passes (the committed kit is valid; the rerun fails only on pre-deploy r2.dev GLB links). |
| 826 SaaS emulator e2e | None. |
| 827 Azure provisioning | Step 3. |
| 828 billing self-service | Deploy; per-seat Team plan in Partner Center. |
| 829 SaaS free trial | Deploy; turn on the free trial for the Pro plan in Partner Center. |
| 830 /enterprise | Deploy; fill the offer URL in data/enterprise.json once the Marketplace offer is live. |
| 831 Copilot declarative agent | Deploy; rerun `scripts/microsoft-copilot-agent-proof.mjs` for the forge starters; sideload in a Copilot-licensed tenant; upload to the Partner Center offer. |
| 832 Outlook and M365 hosts | Enable the Azure Bot Outlook (m365extensions) channel; sideload-test the app in Outlook on the web. |
| 833 Teams Store validation | Deploy (so copilot.frame-ancestors passes on production); create the reviewer demo account; complete Publisher Verification and set MS_PARTNER_CENTER_PUBLISHER_NAME; submit in Partner Center (reviewer pack: marketing/growth/submissions/programs/microsoft-teams-store-review.md). |
| 834 Teams Responsible AI | Deploy. |
| 835 SharePoint web part | Deploy (ships the CORS fix on GET /api/agents/:id); upload the .sppkg to the App Catalog; add `https://three.ws/agent-3d/1.5.2/` to Trusted script sources; take real-tenant screenshots; submit to AppSource. |
| 836 OneDrive picker | Add Entra redirect URI `https://three.ws/auth/microsoft/redirect` with Files.ReadWrite; set MS_ENTRA_SSO_CLIENT_ID (step 3); run one real pick-and-save with a Microsoft account (`node scripts/verify-forge-onedrive.mjs --expect enabled` reaches the sign-in boundary today). |
| 838 Share to Teams and LinkedIn | Deploy; run `npm run audit:share-previews` against production; check one URL in LinkedIn Post Inspector. |
| 839 M365 Certification | The 7-item owner pack in docs/compliance/m365-certification/controls.md (pen test, branch protection and 2FA, console MFA, dev DB split and SA key retirement, training and tabletop, sign policies and name a deputy, Partner Center submission). |
| 840 Defender for Cloud Apps | The owner pack in docs/compliance/defender-cloud-apps.md. |
| 841 Entra app gallery | Deploy (`/sso/microsoft` and `/docs/entra-gallery-tutorial` 404 until then); get a Partner One ID; create the test tenant and team; submit the gallery request. |
| 842 A2A | Deploy; Copilot Studio and Foundry click-through; rerun the Agent Framework client against https://three.ws. |
| 843 PnP samples | Fork the three galleries and open the three PRs (steps in `integrations/microsoft/pnp-samples/README.md`); run `THREEWS_API_KEY=<key> node integrations/microsoft/pnp-samples/scripts/verify-live.mjs` with a real key (22 of 23 checks pass without one). |
| 844 IT admin kit | Step 3 (the consent page shows "not configured" until MS_ENTRA_SSO_* is set). PSScriptAnalyzer 1.25.0 already passed with 0 findings. |
| 845 OData usage feed | Deploy and apply the migration (steps 1, 2). |
| 846 Teams activity feed | Set MS_APP_ID; grant TeamsActivity.Send consent; upload the Partner Center package; steps 1, 2. |
| 847 Teams approvals | Steps 1, 2. |
