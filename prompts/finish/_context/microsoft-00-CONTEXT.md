# microsoft campaign: shared context

Every `prompts/finish/8NN-microsoft-*.md` work order (801 to 825) names this file in its first lines. Read it before step 0. CLAUDE.md overrides everything here.

The campaign builds on the three.ws and Microsoft partnership (announced October 2026, publisher profile live on Microsoft Marketplace). Its 25 orders span internal tooling, user-facing product, developer ecosystem and partnership growth. **They are independent by design: all 25 can run at the same time in separate chats.** No order waits on another, and no order may assume another has landed. If you notice work from a sibling order on disk, reuse it when it fits, but never require it.

## Facts every order needs

| Fact | Value / where |
|---|---|
| Partnership record and approved wording | [docs/microsoft.md](../../../docs/microsoft.md) |
| Distribution plan (15 surfaces, ranked) | [docs/microsoft-marketplace-offer-plan.md](../../../docs/microsoft-marketplace-offer-plan.md) |
| Marketplace SaaS offer (built, waits on owner Partner Center steps) | [docs/microsoft-marketplace-saas.md](../../../docs/microsoft-marketplace-saas.md), [api/_lib/microsoft-marketplace.js](../../../api/_lib/microsoft-marketplace.js), [api/microsoft-marketplace/[action].js](../../../api/microsoft-marketplace/[action].js), [data/microsoft-marketplace.json](../../../data/microsoft-marketplace.json) |
| Marketplace readiness probe | `curl -s https://three.ws/api/microsoft-marketplace/status` returns `{ ready, sso, missing }` |
| Publisher profile | `https://marketplace.microsoft.com/en-us/partners/d11c4453-6e12-499d-8dfe-48fcbaa22e2f/overview` (returns 403 to scripts; check in a browser) |
| Teams and Copilot app | [integrations/microsoft/copilot-teams/](../../../integrations/microsoft/copilot-teams), bot in [api/_lib/teams-bot.js](../../../api/_lib/teams-bot.js) and [api/microsoft-teams/messages.js](../../../api/microsoft-teams/messages.js), tab at `/microsoft/teams-tab` ([pages/microsoft-teams-tab.html](../../../pages/microsoft-teams-tab.html)), package builder `npm run package:microsoft-app -- --check` |
| Adaptive Cards (Glance) | [api/_lib/glance-adaptive.js](../../../api/_lib/glance-adaptive.js), [docs/glance.md](../../../docs/glance.md) |
| Power Platform connector | [integrations/microsoft/power-platform-connector/](../../../integrations/microsoft/power-platform-connector), `npm run package:power-platform-connector -- --check` |
| Microsoft Store and Edge packaging | `npm run package:microsoft-store -- --check`, `npm run package:edge`, listing copy in [marketing/growth/submissions/programs/microsoft-edge-and-store.md](../../../marketing/growth/submissions/programs/microsoft-edge-and-store.md) |
| MCP certification package (drafted) | [marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md](../../../marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md) |
| Other drafted Microsoft submissions | `marketing/growth/submissions/programs/` : `bing-webmaster-tools.md`, `microsoft-365-publisher-attestation.md`, `microsoft-marketplace-professional-services.md`, `github-technology-partner.md` |
| Microsoft open source already in the stack | TRELLIS.2 ([workers/model-trellis2/](../../../workers/model-trellis2)), ONNX Runtime Web ([src/runtime/whisper-stt.js](../../../src/runtime/whisper-stt.js), [src/voice/wake-word.js](../../../src/voice/wake-word.js)), Adaptive Cards, TypeScript, Playwright |
| Production host | Google Cloud Run (`three-ws-api`, `us-central1`, project `aerial-vehicle-466722-p5`). It stays there. Nothing in this campaign moves infrastructure to Azure. |
| Partner value | Partnerships pay off through social amplification and enterprise trust. Anything Microsoft-facing should be screenshot-worthy and true. |

## Saying it correctly (binding on every UI string, doc, listing and post)

- "three.ws and Microsoft have announced a partnership" and "three.ws is live on Microsoft Marketplace" are the two approved claims.
- Never attach a Microsoft partner tier, programme status, co-sell, certification or endorsement unless the owner confirms it in writing. A submission is "pending review" until Microsoft says otherwise.
- Never imply Microsoft endorses a feature, a coin or a trading surface. $THREE and the Solana agent economy are three.ws's own. Keep Microsoft-facing listing copy enterprise-focused.
- Use Microsoft product names only nominatively and add the trademark line from docs/microsoft.md where a page names several Microsoft products. Follow each product's brand rules (for example, never use "Minecraft", "Teams" or "Copilot" as part of a three.ws product name).

## Rules for running 25 orders at once in one worktree

1. **Dev server port.** Never take port 3000. Run `npm run dev -- --port <3100 + NN> --strictPort` where `NN` is your order's last two digits (order 807 uses 3107).
2. **Shared hot files** (`data/changelog.json`, `data/pages.json`, `STRUCTURE.md`, `vercel.json`, `vite.config.js`, `docs/microsoft.md`, `integrations/microsoft/copilot-teams/manifest.template.json`, `package.json`): edit them LAST, re-read the file immediately before each edit, make small anchored `Edit` calls (never rewrite the whole file), and commit right after. If an edit fails because the file moved, re-read and redo it.
3. **Stage explicit paths only.** Never `git add -A` or `git add .`. Run `git diff --staged` before every commit; if a sibling's hunk is in your staged file, unstage it with `git restore --staged -p`.
4. **Migrations.** Name each new migration with a fresh UTC timestamp. Run `npm run db:status` before `npm run db:migrate` (it applies immediately, no dry run). Read the `self-unblock-playbook` skill's database row first.
5. **Tests.** Run your own suite (`npx vitest run tests/<yours>.test.js`) on every change and `npm test` once before close-out. A failure you did not cause gets one line in the report, not a detour.
6. **Generated files.** After appending to `data/changelog.json`, run `npm run build:pages` and stage what it regenerates. The output is deterministic from the source files, so a sibling's entry appearing in it is expected.
7. **package.json scripts.** Add a script only if you need one, with a `microsoft:` or feature-specific prefix, via a small anchored edit.

## Owner gates (batch into ONE message at the end of your session)

Partner Center actions, Entra app registrations, store submissions (Visual Studio Marketplace, AppSource, Edge Add-ons, Microsoft Store, Power BI visuals), pull requests to Microsoft repositories, posts on Microsoft Tech Community or X, `git push`, and production deploys are owner steps. Build and verify everything up to the step, write the exact click path or command into the repo, and list it in your final owner message. Never contact Microsoft or any third party yourself.

## Paid services

GCP is pre-approved (Cloud Run, GPU workers, Vertex AI, Cloud Build). Do not onboard a paid Microsoft or third-party API (Azure OpenAI, Azure Speech, Azure AI Search, and so on) without owner approval: prefer open-weight Microsoft models self-hosted on GCP, or wire the paid path behind an env var, prove it against the vendor's live endpoint (a documented auth error counts), and list the missing variable in the owner message.

## Progress log

Append a dated entry to [microsoft-PROGRESS.md](microsoft-PROGRESS.md) when you finish: order number, commit SHAs, what is live, what waits on the owner. Re-read the log right before appending (siblings write to it too) and append with a small anchored edit at the end.
