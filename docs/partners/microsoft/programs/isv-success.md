# ISV Success (Build and Publish): pre-filled enrollment answers

**Status:** answers prepared, not submitted. Enrolling is an owner step in Partner Center. Program facts were read on 2026-11-12 from [Microsoft Learn: Build and Publish with ISV Success](https://learn.microsoft.com/en-us/partner-center/membership/isv-success) (page dated 2026-10-05); three.ws numbers are rows in [sources.md](../sources.md#headline-counts-one-pager-deck-articles-programs).

## Current name and where to enroll

ISV Success still exists by that name inside the Microsoft AI Cloud Partner Program, but the enrollment button on Microsoft's page now reads **Join Frontier Accelerate for Marketplace**, and the Partner Center link it opens is `partner.microsoft.com/dashboard/v2/membership/isvsuccess/buildandpublish/eligibility`. Frontier Accelerate for Marketplace is the umbrella journey (Build and Publish, Grow, Differentiate) that also absorbed Marketplace Rewards; see [marketplace-rewards.md](./marketplace-rewards.md).

Two ways in, both from the same journey ([Microsoft Learn: Frontier Accelerate for Marketplace overview](https://learn.microsoft.com/en-us/partner-center/frontier-accelerate-marketplace/overview), dated 2026-09-16):

- **No cost.** Milestone-based benefits.
- **Premium**, "$1,549.80 USD/year plus applicable taxes". Adds technical consultations, a named engagement manager, development sandboxes and "$30,000 (new Premium partners)" in build-and-publish dev/test Azure sponsorship ([benefits comparison](https://learn.microsoft.com/en-us/partner-center/frontier-accelerate-marketplace/benefits)).

Recommendation: enroll at no cost first. Upgrading to Premium is allowed "at any time", so it can wait until the SaaS offer is live and the extra consultation hours have a concrete use.

## Eligibility, criterion by criterion

| Microsoft's criterion (quoted) | three.ws answer | Source |
|---|---|---|
| "headquartered in a country or region that isn't included on Microsoft's embargo list" | Owner confirms the registered country. | Owner |
| "Project is B2B focused" | Yes. Businesses embed agents on their own sites with the `<agent-3d>` tag (655 live embeds on other sites), and teams use the Teams app, Power Platform connector and PowerPoint add-in. | `/api/home-stats` field `widgets`; [docs/microsoft.md](../../../microsoft.md#built-for-microsoft-surfaces) |
| "Project is built on or integrated with Microsoft Cloud" | Integrated with: an app for Teams and Microsoft 365 Copilot (bot, tab, message extension, meeting stage), a Power Platform connector usable from Copilot Studio, a PowerPoint add-in, a Power BI custom visual, and an MCP server Copilot Studio connects to with no key. Hosting is on another cloud; do not describe the product as hosted on Microsoft infrastructure. | [docs/microsoft.md](../../../microsoft.md#built-for-microsoft-surfaces) |
| "Project is externally available and intended for repeat sales" | Yes. Live at three.ws with paid plans; the Microsoft Marketplace SaaS offer (with hourly metered billing) is built and waits on the owner's Partner Center step. | [docs/microsoft-marketplace-saas.md](../../../microsoft-marketplace-saas.md) |
| "Project has at least one developer assigned to it for app development" | Yes. The repository is under active daily development: 114 packages and 53 workers. | `ls -d packages/*/ \| wc -l`, `ls -d workers/*/ \| wc -l` |
| "Commitment to initiating app development within three months and completing app development within 12 months" | Development is already under way; the SaaS offer is built. | Repository |
| "Commitment to publish app to Microsoft Marketplace" | Yes. three.ws is live on Microsoft Marketplace (publisher ID `d11c4453-6e12-499d-8dfe-48fcbaa22e2f`), and the SaaS offer is the next listing. | [docs/microsoft.md](../../../microsoft.md#microsoft-marketplace) |
| "agrees to the terms and conditions in the Microsoft ISV Success Benefits Guide" | Owner reads and accepts. | Owner |

## Application answers

Microsoft says the form asks for "company size, app features, and your cloud integration" and then collects verification details. Answers to paste:

**App name:** three.ws

**Website:** https://three.ws

**One-line description:** Open-source platform that turns a sentence, photo or sketch into a rigged, animated 3D model and gives it a voice, memory and skills as an AI agent you can embed anywhere with one HTML tag.

**App features (short):**

- Text, image and sketch to textured 3D models, and text or selfie to rigged avatars, on self-hosted GPUs. 54,356 models generated to date.
- Agent runtime with voice, emotion, memory and skills; 4,936 agents created.
- One web component, `<agent-3d>`, to embed an agent on any page; 655 live embeds on other sites.
- A free MCP server with 16 tools for any MCP client, including Copilot Studio.
- Open source under Apache-2.0; 276 GitHub stars and 78 forks.

**Microsoft Cloud integration:**

- App for Microsoft Teams and Microsoft 365 Copilot: a declarative agent on the three.ws MCP server, a bot for chats and channels, a "Create a 3D model" message extension on Adaptive Cards, a tab, and a meeting stage on Live Share.
- Power Platform connector with five actions for Power Automate, Power Apps, Logic Apps and Copilot Studio.
- PowerPoint export and add-in that inserts a model as an interactive 3D object.
- Power BI custom visual that renders models bound to report data.
- Microsoft open source in the product: TRELLIS for image-to-3D, ONNX Runtime Web for on-device speech, Adaptive Cards, TypeScript and Playwright.

**Company size, legal name, registered address, primary contact, tax details:** owner supplies. The legal name and address must match the documents used in verification, which "usually takes 3-5 business days".

**Contact for the program:** partnerships@three.ws

## Benefits to activate on approval

From the Core Package list on the ISV Success page, in the order that helps three.ws most:

1. **Application publishing consultation** and **Marketplace listing optimization**: take the built SaaS offer through Partner Center review.
2. **AI technical consultation**: review the Copilot Studio MCP path and the declarative agent.
3. **Microsoft 365 E5 developer subscription**: a tenant to test the Teams app package, the connector and the add-in end to end.
4. **Visual Studio Enterprise subscription** and **GitHub Enterprise Cloud subscription** (new enterprise only, 20 licenses for 12 months; add-ons are billed).
5. **Microsoft Azure sponsorship ($5k USD usage)** and the Azure standard support plan.

Benefits can be used "up to 12 months (one year) from the date of enrollment or renewal". Renewal needs a new offer published, or an existing one upgraded to transact through Marketplace, during the year, plus "the $1,550 USD renewal fee".

## What not to claim after enrolling

Enrollment is a program membership, not a designation. Keep public wording to the two approved claims in [docs/microsoft.md](../../../microsoft.md#saying-it-correctly) unless the owner approves new wording.
