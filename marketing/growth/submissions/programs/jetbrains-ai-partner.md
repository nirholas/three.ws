# JetBrains AI partner route

Program: JetBrains technology partnership and Marketplace, plus the JetBrains for Startups discount.
Page last read: 2026-11-14 (<https://www.jetbrains.com/startups/> read in full). `https://www.jetbrains.com/partners/` again returned only its title to a fetch. The startups page describes no AI partner program, and none was found on 2026-10-23 either: **an AI-specific partner program does not appear to exist; its existence is not verified on 2026-11-14.**
Prospect context: score 10 in `docs/partners/prospects.md` ("Marketplace plugin, 50% startup discount, manual upload and review, `marketplace@jetbrains.com`").
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## What the search did establish

- JetBrains lists "technology partners" it integrates, collaborates and co-markets with; the page names no application process.
- A 2020 JetBrains post describes a Technology Partnership for software vendors who publish apps and integrations to JetBrains Marketplace. It is old, so its application page may have changed.
- A newer design-partner program exists for JetBrains Central (agentic software development). It is for early customers shaping that product, not a listing route.
- JetBrains AI Assistant supports MCP servers (Settings, AI Assistant, Model Context Protocol); a third-party guide says 2025.2 or later, and Streamable HTTP works best. So users can already add the three.ws MCP server without any partnership.
- JetBrains for Startups (read 2026-11-14): for privately owned companies established within the last five years, with evidence, and a website. 50% off up to 10 IDE subscriptions, 10 team or learning tool subscriptions and 10 JetBrains AI subscriptions (AI Pro and AI Ultimate only, including Junie) for five years, once per organization, commercial licenses only. Startups also get 50% off participating Marketplace plugins (list at `jb.gg/startups-plugins`). Applications are reviewed within 48 hours. The form fields are behind the "Apply Now" button: **not verified on 2026-11-14**.
- The JetBrains Partner Program on that page is for incubators, accelerators, VCs and startup communities with at least 10 startups; a startup cannot apply to both. It is not our route.

## Honest position

There is no application form to fill. Without a JetBrains plugin, a partnership has nothing to attach to. Judgment call: do not send a partnership pitch yet. Ship the Marketplace plugin first (a thin plugin that registers the three.ws MCP endpoint and opens the viewer in a tool window), because Marketplace review is the documented door. This file holds the paste-ready outreach text for the day the plugin exists.

## Drafted inquiry (to `marketplace@jetbrains.com`, owner sends)

Subject: three.ws 3D Studio plugin and MCP integration, partnership route

> Hello. We build three.ws, an open-source platform that turns text or a photo into rigged 3D models and avatars, with hosted MCP servers at `https://three.ws/api/mcp-studio` (Streamable HTTP, OAuth 2.1, free tools need no account). In September 2026 the servers handled 13,898 tool calls at 99.4% handler success from 13 OAuth client names, including Claude, Cursor and Codex. We are building a JetBrains Marketplace plugin that connects AI Assistant to these tools and previews generated models in a tool window. Is there a technology partner or AI integration route we should use alongside the Marketplace listing? We are a private company under five years old and would also like to use the startup discount. Contact: support@three.ws.

## Eligibility facts to supply

| Item | Answer |
|---|---|
| Company, website | three.ws, `https://three.ws` |
| Age and ownership | Owner input (privately owned, established within five years, with evidence such as the incorporation document) |
| Product | Open-source MCP servers and web component; plugin does not exist yet |
| Support | `support@three.ws` |

## Owner steps

1. Build and submit the plugin to JetBrains Marketplace (separate build order; none exists for JetBrains).
2. Then send the inquiry above and apply for the startup discount at <https://jetbrains.com/startups>.
3. Add a tracker row on sending.
