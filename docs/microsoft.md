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
| **TRELLIS.2** (Microsoft Research, MIT) | The default image-to-3D lane `trellis2` on the self-hosted GPU fleet: [`workers/model-trellis2/`](../workers/model-trellis2). The original TRELLIS also backs the free text-to-3D lane on NVIDIA NIM. |
| **ONNX Runtime Web** | On-device speech-to-text ([`src/runtime/whisper-stt.js`](../src/runtime/whisper-stt.js)) and wake-word detection ([`src/voice/wake-word.js`](../src/voice/wake-word.js)) in the visitor's browser, so audio never leaves the machine. |
| **Adaptive Cards** | The [Glance](./glance.md) agent cards for home screens and chat ([`api/_lib/glance-adaptive.js`](../api/_lib/glance-adaptive.js)). |
| **TypeScript** | Types for every published SDK (`sdk/`, `solana-agent-sdk/`, `agent-payments-sdk/`). |
| **Playwright** | Browser tests and page audits. |

## In flight

- **Microsoft MCP server certification** (Copilot Studio, Microsoft 365 Copilot, Foundry). The submission package, eligibility table, and the one open gap (Microsoft does not support Dynamic Client Registration, so a pre-registered OAuth client is needed) are drafted in [`marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md`](../marketing/growth/submissions/programs/microsoft-copilot-mcp-certification.md). Submission runs through Partner Center and is an owner step.
- **VS Code extensions.** [`packages/vscode-3d/`](../packages/vscode-3d) and [`packages/vscode-x402/`](../packages/vscode-x402) are built in-repo and not yet published to the Visual Studio Marketplace. See [VS Code extension](./vscode.md).

## Where it shows up on three.ws

| Surface | What it says |
|---|---|
| [`/partners`](https://three.ws/partners) | Microsoft card, chip "Marketplace", linking the announcement |
| [`/partners/benefits`](https://three.ws/partners/benefits) | What the partnership brings builders |
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

- [Partner ecosystem](./partners.md)
- [Partner benefits](./partner-benefits.md)
- [Listings and distribution](./listings.md)
- [Press kit](./press-kit.md)
