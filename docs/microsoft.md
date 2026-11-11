# three.ws and Microsoft

three.ws and **Microsoft** announced a partnership in October 2026, and three.ws is live on **[Microsoft Marketplace](https://marketplace.microsoft.com/en-us/partners/d11c4453-6e12-499d-8dfe-48fcbaa22e2f/overview)**.

This page is the developer-facing record: what the listing is, what Microsoft technology already runs in the product, where the partnership shows up on three.ws, and how to describe it correctly.

---

## Microsoft Marketplace

Microsoft Marketplace is the single storefront where Azure Marketplace and Microsoft AppSource now live together. Enterprise teams use it to find, try, and buy cloud software, AI apps, and agents through the Microsoft relationship they already have.

| | |
|---|---|
| Publisher profile | [marketplace.microsoft.com/en-us/partners/d11c4453-6e12-499d-8dfe-48fcbaa22e2f/overview](https://marketplace.microsoft.com/en-us/partners/d11c4453-6e12-499d-8dfe-48fcbaa22e2f/overview) |
| Partner ID | `d11c4453-6e12-499d-8dfe-48fcbaa22e2f` |
| Live since | October 2026 |
| What a buyer gets | The same platform that runs at [three.ws](https://three.ws). Nothing forks for this channel. |

What a Microsoft customer reaches through the listing:

- **3D creation.** Text, photo, or sketch to a rigged, animated 3D model, and an avatar from a prompt or a selfie, on the self-hosted GPU fleet. See [how the Forge works](./how-forge-works.md).
- **An agent runtime with a body.** Voice, emotion, memory, and skills, with a talk mode that lip-syncs the avatar.
- **One tag to ship it.** The `<agent-3d>` web component drops a finished agent into any page, intranet, or app. See [embedding](./embedding.md).
- **Tools for every assistant.** MCP servers, SDKs, and plugins expose generation, rigging, and animation to any AI client. See [MCP tools](./mcp-tools.md).
- **An agent economy on Solana.** [x402](./x402.md) pay-per-call, on-chain identity, and reputation, with Solana as the home chain.

The marketplace serves its pages to browsers only (automated fetches get HTTP 403), so `npm run listings:verify` cannot re-check this entry. It is marked `manual` in [`data/listings.json`](../data/listings.json); re-check it by hand in a browser.

## Already built on Microsoft technology

Microsoft open source was in the three.ws stack before the partnership. These are dependencies used under their own licenses, not partnership deliverables:

| Project | Where it runs in three.ws |
|---|---|
| **TRELLIS.2** (Microsoft Research, MIT) | The default image-to-3D lane `trellis2` on the self-hosted GPU fleet: [`workers/model-trellis2/`](../workers/model-trellis2). Every parameter is exposed, benchmarked and credited in the [TRELLIS.2 Lab](./trellis2-lab.md) at [three.ws/lab/trellis2](https://three.ws/lab/trellis2). The original TRELLIS also backs the free text-to-3D lane on NVIDIA NIM. |
| **ONNX Runtime Web** | On-device speech-to-text ([`src/runtime/whisper-stt.js`](../src/runtime/whisper-stt.js)) and wake-word detection ([`src/voice/wake-word.js`](../src/voice/wake-word.js)) in the visitor's browser, so audio never leaves the machine. |
| **Adaptive Cards** | The [Glance](./glance.md) agent cards for home screens and chat ([`api/_lib/glance-adaptive.js`](../api/_lib/glance-adaptive.js)). |
| **TypeScript** | Types for every published SDK (`sdk/`, `solana-agent-sdk/`, `agent-payments-sdk/`). |
| **Playwright** | Browser tests and page audits. |

## Built for Microsoft surfaces

These are in the repo and validated. Each one goes live when the owner completes its Partner Center or store step, in the order the [plan's owner checklist](./microsoft-marketplace-offer-plan.md#owner-checklist-in-order) gives.

| Surface | What is built | Check it |
|---|---|---|
| Microsoft Marketplace SaaS offer | Purchase landing page `/microsoft/activate`, Entra sign-in, the fulfilment webhook, and hourly metered billing. A Microsoft subscription grants the same plan as a card purchase. See [Microsoft Marketplace SaaS offer](./microsoft-marketplace-saas.md) | `npx vitest run tests/microsoft-marketplace.test.js` |
| Microsoft Marketplace leads | Partner Center posts every listing lead to an HTTPS endpoint; each is stored once, the admins are notified, and a reply is drafted for a person to send from `/admin/microsoft/leads`. See [Microsoft Marketplace leads](./ops/microsoft-marketplace-leads.md) | `npx vitest run tests/microsoft-marketplace-leads.test.js tests/microsoft-leads-draft.test.js` |
| Microsoft 365 Copilot and Teams app | A declarative agent wired to the three.ws MCP server, a Teams bot that answers in chats and channels, a "Create a 3D model" action and `forge` bot command that generate a model on a live-updating card ([how it works](./microsoft-teams-forge.md)), and a Teams tab (`/microsoft/teams-tab`). Package builder: [`scripts/build-microsoft-app-package.mjs`](../scripts/build-microsoft-app-package.mjs) | `npm run package:microsoft-app -- --check` |
| Power Platform connector | Five actions for Power Automate, Power Apps, Logic Apps and Copilot Studio, with OAuth and PKCE: [`integrations/microsoft/power-platform-connector/`](../integrations/microsoft/power-platform-connector). The build writes the `certified-connectors/three.ws 3D Studio/` folder for the PowerPlatformConnectors pull request and checks it against the certification rules and the repository's schemas. Four flow templates and a Copilot Studio agent sample live in [`templates/`](../integrations/microsoft/power-platform-connector/templates), imported with [`scripts/import-power-platform-templates.mjs`](../scripts/import-power-platform-templates.mjs). Submission steps: [certification submission](../marketing/growth/submissions/programs/microsoft-power-platform-certification.md) (pending the owner's Partner Center step) | `npm run package:power-platform-connector -- --check`, `npx vitest run tests/microsoft-power-platform-connector.test.js` |
| Microsoft 365 Copilot connector | A Graph connector that indexes a three.ws account's agents, Forge models and avatars into the customer's tenant for Microsoft Search and Copilot, with admin consent, per-audience ACLs and a 15-minute incremental sync. Settings page `/settings/microsoft-365`. See [Microsoft 365 Copilot connector](./microsoft-365-copilot-connector.md) | `node --test tests/m365-connector.test.js`, `node scripts/m365-connector-probe.mjs` |
| Microsoft Store (Windows app) | The installable web app packaged as MSIX through PWABuilder: [`scripts/package-microsoft-store-pwa.mjs`](../scripts/package-microsoft-store-pwa.mjs). Listing copy in [`microsoft-edge-and-store.md`](../marketing/growth/submissions/programs/microsoft-edge-and-store.md) | `npm run package:microsoft-store -- --check` |
| Edge Add-ons | The browser extension package | `npm run package:edge` |
| .NET SDK on NuGet | `ThreeWs.Sdk` for C#, ASP.NET Core and Unity (net8.0 and netstandard2.1): Forge on every lane, catalog, rigging, streaming agent chat and MCP tools. Source in [`sdk-dotnet/`](../sdk-dotnet), guide in [.NET SDK](./dotnet-sdk.md). Goes live when the owner pushes the package to nuget.org | `cd sdk-dotnet && dotnet test tests/ThreeWs.Sdk.Tests -c Release` |

## In flight

- **Microsoft MCP server certification** (Copilot Studio, Microsoft 365 Copilot, Foundry). The submission package, eligibility table, and the one open gap (Microsoft does not support Dynamic Client Registration, so a pre-registered OAuth client is needed) are drafted in [`marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md`](../marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md). Submission runs through Partner Center and is an owner step.
- **VS Code extensions.** [`packages/vscode-x402/`](../packages/vscode-x402) is live on the Visual Studio Marketplace as [`threews.vscode-x402`](https://marketplace.visualstudio.com/items?itemName=threews.vscode-x402) (v0.2.1, 22 installs on 2026-11-11). [`packages/vscode-3d/`](../packages/vscode-3d) is built, passes its 78 tests and packages cleanly, but is not published yet; the owner runs `npm run release` in that directory with `VSCE_PAT` set, as described in its [PUBLISHING.md](../packages/vscode-3d/PUBLISHING.md). See [VS Code extension](./vscode.md).
- **Co-marketing.** What three.ws offers each Microsoft audience, the verified proof points, and the outreach and post drafts for Microsoft-owned channels: [Microsoft co-marketing kit](./microsoft-co-marketing.md).

## Where it shows up on three.ws

| Surface | What it says |
|---|---|
| [`/microsoft`](https://three.ws/microsoft) | The partner hub: both approved claims, live demos (TRELLIS strip from the community feed, on-device speech to text through ONNX Runtime Web, a real agent's Glance card drawn by the Adaptive Cards renderer), the status of every Microsoft surface from [`data/microsoft-surfaces.json`](../data/microsoft-surfaces.json), and the built-on credits |
| [`/partners`](https://three.ws/partners) | Microsoft card, chip "Marketplace", linking the `/microsoft` hub |
| [`/partners/benefits`](https://three.ws/partners/benefits) | What the partnership brings builders, linking the `/microsoft` hub |
| [`/blog/three-ws-microsoft-partnership`](https://three.ws/blog/three-ws-microsoft-partnership) | The announcement |
| [`/news/microsoft-partnership-marketplace`](https://three.ws/news/microsoft-partnership-marketplace) | News permalink and RSS item (syndicates to HackerNoon) |
| Home page press strip | Microsoft logo linking the news item |
| [`/press`](https://three.ws/press) and [press kit](./press-kit.md) | Programmes row and coverage |
| [`/timeline`](https://three.ws/timeline) | Partnership and Marketplace events |
| [Listings](./listings.md) and the [listings registry](./listings-registry.md) | Microsoft Marketplace: Live |

## Coverage

- CoinMarketCap: [three.ws and Microsoft Announce Partnership](https://coinmarketcap.com/community/articles/6ae3dfb3543b1b2fccd5fcf1/)
- CoinMarketCap: [three.ws Live on Microsoft Marketplace, Bringing Open-Source 3D AI Agents to Enterprise](https://coinmarketcap.com/community/articles/6ae275a5e7c4846f5d1cca15/)

## Saying it correctly

- Write it as "three.ws and Microsoft have announced a partnership" and "three.ws is live on Microsoft Marketplace". Both are true and sourced above.
- Do not attach a named Microsoft partner tier or programme (for example a Solutions Partner designation or a co-sell status) unless the owner confirms it. The `/partners` chip reads "Marketplace" because that is the verifiable part.
- Do not imply Microsoft endorses a specific feature, coin, or trading surface. Microsoft is a distribution and technology partner; [$THREE](https://three.ws/three) and the Solana agent economy are three.ws's own.
- Microsoft, Azure, Microsoft Marketplace, TRELLIS, ONNX Runtime, Adaptive Cards, TypeScript, and Playwright are trademarks of the Microsoft group of companies.

## Related

- [.NET SDK (NuGet, Unity)](./dotnet-sdk.md)
- [Partner ecosystem](./partners.md)
- [Partner benefits](./partner-benefits.md)
- [Microsoft distribution and offer plan](./microsoft-marketplace-offer-plan.md)
- [Microsoft Marketplace SaaS offer](./microsoft-marketplace-saas.md)
- [Enterprise sign-in and SCIM](./enterprise-sso.md): Sign in with Microsoft for everyone, tenant-based team join, and SCIM provisioning from Microsoft Entra ID
- [Listings and distribution](./listings.md)
- [Press kit](./press-kit.md)
- [Trust center](./trust.md): security, privacy and subprocessor answers for IT review, linked from `/microsoft/activate` and the Teams tab
