# Microsoft Marketplace: professional service offers

Program: Microsoft Marketplace, Consulting services (Partner Center, Marketplace offers, New offer, Consulting service).
Plan item: `docs/microsoft-marketplace-offer-plan.md` section 3 (priority #3).
Publisher profile: <https://marketplace.microsoft.com/en-us/partners/d11c4453-6e12-499d-8dfe-48fcbaa22e2f/overview> (live).
Drafted: 2026-11-04. Nothing here has been submitted. The Partner Center form is behind sign-in, so the limits below are the ones Microsoft has published for this offer type and were **not re-verified in the form**: if a field rejects the length, trim the description first.

## Rules applied to all three offers

- **Pricing statement:** "Contact for pricing". No professional-service prices are recorded anywhere in the repo (the only price fields are creator subscription plans in `api/subscriptions/plans.js`, which are unrelated to services), so none are invented. Owner: replace with a fixed fee per offer if you want to publish one.
- **Contact:** name, email and phone are owner input. Email: `support@three.ws` (the support address used across the repo). Phone: owner input.
- **Wording:** no Microsoft partner tier, co-sell status or Azure-hosting claim (see `docs/microsoft.md`, "Saying it correctly"). Delivery is on three.ws, which runs on Google Cloud.
- **Scope of copy:** enterprise and developer outcomes only. The $THREE token and the Solana agent economy are deliberately left out of Microsoft listing copy until Microsoft's commercial marketplace policy on cryptocurrency content has been reviewed.
- **Capability claims** each cite the repo doc that backs them in the "Grounding" line under the offer.
- **Offer type** in the form (Briefing, Assessment, Workshop, Proof of concept, Implementation): Implementation for all three. Alternative if you want a lighter entry offer: list a 1-day Workshop version of offer 1 as well.

---

## Offer 1: Embed a 3D agent on your site or intranet

| Field | Value |
| --- | --- |
| Title | `Embed a 3D AI Agent on Your Site` |
| Offer type | Implementation |
| Summary | `Add a talking 3D AI agent to your website or intranet with one <agent-3d> tag, themed to your brand.` |
| Duration | 2 weeks (tell the buyer: typical fixed-scope delivery, confirmed in the scoping call) |
| Pricing | Contact for pricing |
| Search keywords | `3D AI agent`, `web component`, `avatar embed` |
| Contact | `support@three.ws` (owner: add name and phone) |

**Description (paste):**

```
We add a live 3D AI agent to your public site, customer portal or intranet using the open-source <agent-3d> web component from three.ws.

What we deliver
- Integration of the <agent-3d> element into your pages, in plain HTML or your framework (React, Vue, Svelte, Next.js or similar).
- Theming with CSS custom properties so the agent matches your brand, plus layout choices (inline, floating, full panel).
- The agent's persona, greeting and skills configured for your use case, with voice and chat.
- Embed policy: an allowlist of the hosts permitted to show the agent, and a Content Security Policy that works with the component.
- A pinned, integrity-checked script release (Subresource Integrity) so a page can never load code that changed after you tested it.
- Event wiring so your page can react to what the agent says and does.
- Handover: documented source, a short runbook, and a walkthrough with your team.

Alternatives we can use when you cannot load scripts: an iframe embed, or paste-a-link oEmbed for Notion, Ghost, Substack and WordPress.

What we need from you: the pages to embed on, brand colors and fonts, the agent's purpose, and a test environment.

Sign-in or single sign-on for your own users is scoped in the kickoff call and quoted separately where it applies.

Pricing: contact us for a fixed-fee quote after a 30-minute scoping call.
```

Grounding: `docs/embedding.md` (web component, theming, iframe, oEmbed, events), `docs/security.md` (embed policy, CSP compatibility, SRI), `docs/wordpress-embed.md`, `docs/agent-skills.md`.

---

## Offer 2: Custom avatar and agent build

| Field | Value |
| --- | --- |
| Title | `Custom 3D Avatar and AI Agent Build` |
| Offer type | Implementation |
| Summary | `A branded, rigged 3D character with a persona, skills and voice, delivered as a ready-to-embed AI agent.` |
| Duration | 4 weeks |
| Pricing | Contact for pricing |
| Search keywords | `3D avatar`, `AI agent`, `brand character` |
| Contact | `support@three.ws` (owner: add name and phone) |

**Description (paste):**

```
We design and build a branded 3D character and turn it into a working AI agent on the three.ws platform.

What we deliver
- A rigged, animation-ready 3D avatar (GLB) created from your brief, reference images or a photo, using the three.ws generation pipeline, with manual review and refinement.
- Wardrobe and appearance variants where your brand needs them.
- The agent: persona and tone, knowledge and memory settings, and custom skills so it can do real work for your users.
- Voice and expression: speech with lip-sync, emotion and gestures.
- A public agent page, plus the <agent-3d> embed code for your own sites.
- Source files and documentation, so the character and agent remain yours to operate. The platform is open source.

How it runs
1. Brief and references (week 1).
2. Character and rig, with two review rounds (weeks 1 to 2).
3. Persona, skills and voice (weeks 2 to 3).
4. Embed, test and handover (week 4).

What we need from you: brand guidelines, reference imagery, the agent's purpose, any content or policies the agent must follow, and a named reviewer.

Pricing: contact us for a fixed-fee quote after a 30-minute scoping call.
```

Grounding: `docs/avatar-creation.md`, `docs/avatar-pipeline.md`, `docs/avatar-wardrobe.md`, `docs/how-forge-works.md`, `docs/agent-skills.md`, `docs/agent-memory.md`, `docs/embedding.md`. Owner check: "manual review and refinement" and "two review rounds" are service-delivery commitments, not product facts. Confirm you will staff them.

---

## Offer 3: Agent MCP integration

| Field | Value |
| --- | --- |
| Title | `Connect Your Systems to AI Agents via MCP` |
| Offer type | Implementation |
| Summary | `Expose an internal system to AI assistants and 3D agents through Model Context Protocol tools.` |
| Duration | 3 weeks |
| Pricing | Contact for pricing |
| Search keywords | `MCP integration`, `AI agent tools`, `Model Context Protocol` |
| Contact | `support@three.ws` (owner: add name and phone) |

**Description (paste):**

```
We connect one of your internal systems to AI assistants and 3D agents through the Model Context Protocol (MCP), an open standard for tool access.

What we deliver
- Design of a focused tool set for your system: the read and write actions an assistant may take, with names and schemas a model uses correctly.
- A remote MCP server implementation with OAuth sign-in, scoped access and rate limits, following the patterns of the three.ws MCP servers.
- Connection to the clients your teams use (for example Claude, ChatGPT, Cursor, VS Code or your own agent), and to a three.ws 3D agent if you want one in front of the tools.
- Safety review of the tool set: which actions need user confirmation, what is read-only, and what is logged.
- Tests, documentation and a handover session.

What we need from you: the system and its API documentation, a sandbox with test data, a security contact, and your authentication requirements.

Pricing: contact us for a fixed-fee quote after a 30-minute scoping call.
```

Grounding: `docs/mcp.md` (server, OAuth, client setup), `docs/mcp-tools.md` (tool catalog), `docs/mcp-safety.md`, `docs/security.md` (OAuth tokens, API key scopes). Owner check: confirm which client names you are willing to support in a paid engagement.

---

## Owner steps

1. Partner Center, Marketplace offers, New offer, Consulting service. Create the three offers from the tables above. Add the contact name and phone.
2. Upload the logo [`marketing/microsoft/media/marketplace/logo-300x300.png`](../../../../marketing/microsoft/media/marketplace/logo-300x300.png) (the screenshots and video are in the generated media block at the end of this file) and the legal links: privacy `https://three.ws/legal/privacy`, terms `https://three.ws/legal/tos`.
3. Submit each for publish. After going live, add the URLs to `data/listings.json`.

<!-- media:microsoft:start (generated by npm run media:microsoft; edits inside are overwritten) -->

### Listing media (captured 2026-11-11 from https://three.ws)

Regenerate with `npm run media:microsoft`. How it works and when to refresh: [marketing/microsoft/media/README.md](../../../../marketing/microsoft/media/README.md). Exact sizes and checksums: [manifest.json](../../../../marketing/microsoft/media/manifest.json).

**Microsoft Marketplace SaaS offer** (requirements read 2026-11-11: <https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-new-saas-offer-listing>)

- [`screenshot-1-forge-result-1280x720.png`](../../../../marketing/microsoft/media/marketplace/screenshot-1-forge-result-1280x720.png): 1280 x 720, 165 KB. Caption: "The finished model from that one prompt, ready to orbit, download as GLB or place in a scene."
- [`screenshot-2-agent-1280x720.png`](../../../../marketing/microsoft/media/marketplace/screenshot-2-agent-1280x720.png): 1280 x 720, 152 KB. Caption: "Every agent has a public page with its 3D body, its skills and a chat anyone can open."
- [`screenshot-3-teams-tab-1280x720.png`](../../../../marketing/microsoft/media/marketplace/screenshot-3-teams-tab-1280x720.png): 1280 x 720, 72 KB. Caption: "The three.ws tab for Microsoft Teams: browse agents and see what each one did today."
- [`screenshot-4-adaptive-card-1280x720.png`](../../../../marketing/microsoft/media/marketplace/screenshot-4-adaptive-card-1280x720.png): 1280 x 720, 100 KB. Caption: "The agent card as an Adaptive Card, rendered by the Adaptive Cards SDK with the Microsoft Teams host config."
- [`screenshot-5-viewer-1280x720.png`](../../../../marketing/microsoft/media/marketplace/screenshot-5-viewer-1280x720.png): 1280 x 720, 137 KB. Caption: "The three.ws viewer: inspect any GLB or glTF in the browser, with lighting, animation and AR."
- [`logo-300x300.png`](../../../../marketing/microsoft/media/marketplace/logo-300x300.png): 300 x 300, 30 KB
- [`video-thumbnail-1280x720.png`](../../../../marketing/microsoft/media/marketplace/video-thumbnail-1280x720.png): 1280 x 720, 114 KB
- Video: the listing takes a YouTube or Vimeo link, not a file. Upload <https://storage.googleapis.com/three-ws-desktop-releases/marketing/microsoft/2026-11-11/three-ws-demo-65b81bfb24c1.mp4> with the captions in [`three-ws-demo.en.srt`](../../../../marketing/microsoft/media/video/three-ws-demo.en.srt), then paste that link.

<!-- media:microsoft:end -->
