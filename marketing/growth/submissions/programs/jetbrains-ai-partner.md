# JetBrains AI partner route

Program: JetBrains technology partnership and Marketplace, plus the JetBrains for Startups discount.
Page last read: 2026-10-23, **through search results only**. A direct fetch of `https://www.jetbrains.com/partners/` returned only a topic summary, and search found no JetBrains page for an "AI partner" application. **The existence of an AI-specific partner program: not verified on 2026-10-23.**
Prospect context: score 10 in `docs/partners/prospects.md` ("Marketplace plugin, 50% startup discount, manual upload and review, `marketplace@jetbrains.com`").
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## What the search did establish

- JetBrains lists "technology partners" it integrates, collaborates and co-markets with; the page names no application process.
- A 2020 JetBrains post describes a Technology Partnership for software vendors who publish apps and integrations to JetBrains Marketplace. It is old, so its application page may have changed.
- A newer design-partner program exists for JetBrains Central (agentic software development). It is for early customers shaping that product, not a listing route.
- JetBrains AI Assistant supports MCP servers (Settings, AI Assistant, Model Context Protocol); a third-party guide says 2025.2 or later, and Streamable HTTP works best. So users can already add the three.ws MCP server without any partnership.
- JetBrains for Startups at `https://jetbrains.com/startups` exists; the 50 percent discount for private companies under five years old comes from the 2026-10-09 prospects sweep and was not re-read today.

## Honest position

There is no application form to fill. Without a JetBrains plugin, a partnership has nothing to attach to. Judgment call: do not send a partnership pitch yet. Ship the Marketplace plugin first (a thin plugin that registers the three.ws MCP endpoint and opens the viewer in a tool window), because Marketplace review is the documented door. This file holds the paste-ready outreach text for the day the plugin exists.

## Drafted inquiry (to `marketplace@jetbrains.com`, owner sends)

Subject: three.ws 3D Studio plugin and MCP integration, partnership route

> Hello. We build three.ws, an open-source platform that turns text or a photo into rigged 3D models and avatars, with hosted MCP servers at `https://three.ws/api/mcp-studio` (Streamable HTTP, OAuth 2.1, free tools need no account). In September 2026 the servers handled 13,898 tool calls at 99.4% handler success from 13 OAuth client names, including Claude, Cursor and Codex. We are building a JetBrains Marketplace plugin that connects AI Assistant to these tools and previews generated models in a tool window. Is there a technology partner or AI integration route we should use alongside the Marketplace listing? We are a private company under five years old and would also like to use the startup discount. Contact: support@three.ws.

## Eligibility facts to supply

| Item | Answer |
|---|---|
| Company, website | three.ws, `https://three.ws` |
| Age and ownership | Owner input (private company under five years old, for the discount) |
| Product | Open-source MCP servers and web component; plugin does not exist yet |
| Support | `support@three.ws` |

## Owner steps

1. Build and submit the plugin to JetBrains Marketplace (separate build order; none exists for JetBrains).
2. Then send the inquiry above and apply for the startup discount at <https://jetbrains.com/startups>.
3. Add a tracker row on sending.
