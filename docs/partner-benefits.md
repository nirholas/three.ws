# Partner benefits (public page)

`three.ws/partners/benefits` tells builders and the community what each partnership gives them. It complements the [partner map](./partners.md) (`/partners`), which says who the partners are; this page says what that means for a user.

Source: [pages/partner-benefits.html](../pages/partner-benefits.html), route `/partners/benefits` in `vercel.json`, Vite input `partner-benefits`, registry row in `data/pages.json`. It is static markup with no runtime data, so it renders with JavaScript off.

## What it covers

One card per programme, in the same order as `/partners`: OpenAI (Select Partner), NVIDIA (Inception), IBM (Business Partner), Google Cloud (Web3 Startups), AWS (Partner), Alibaba Cloud (Marketplace), Quicknode (Startup Program), HackerNoon (Media). Each card has a designation chip, one factual lead sentence, three "what it brings you" points, and links to the deeper docs.

## Editing rules

- Quote the designation exactly as in [partners.md](./partners.md#what-the-page-does-not-claim). Never upgrade a designation to an endorsement or a pending listing to a live one. AWS says the Marketplace listing is coming until [listings.md](./listings.md) says otherwise.
- Do not publish credit amounts, organization or workspace IDs, or contract terms. Internal records live in [partners/openai-partner-benefits-2026.md](./partners/openai-partner-benefits-2026.md), [partners/ibm-partner-plus.md](./partners/ibm-partner-plus.md), [nvidia-inception.md](./nvidia-inception.md) and [ops/gcp-credits-plan.md](./ops/gcp-credits-plan.md).
- Keep the framing positive and factual. Benefits are described by what a user gets, not by what we spend.
- A new partner needs a card here, a card on `/partners`, and a row in [partners.md](./partners.md).
