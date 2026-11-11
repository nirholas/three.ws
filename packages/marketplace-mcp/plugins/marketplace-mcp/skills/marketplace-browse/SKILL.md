---
name: marketplace-browse
description: Search and page the public three.ws agent marketplace and skills catalog through the marketplace-mcp server: find agents and installable skills by query or category and read one agent's details. Read-only, no key or payment.
---

# Browse the three.ws marketplace with marketplace-mcp

The plugin starts `@three-ws/marketplace-mcp` over stdio (`npx -y @three-ws/marketplace-mcp`). Tools appear as `mcp__marketplace-mcp__<tool>`. Everything is a read-only call to the public three.ws API, with no key, signer or payment.

## Environment

- `THREE_WS_BASE`: API host, default `https://three.ws`.
- `THREE_WS_TIMEOUT_MS`: request timeout, default `20000`.

## Tools

- `browse_agents` (`q`, `category`, `sort` recommended|recent|popular|top_rated, `limit` 1-48 default 24, `cursor`): agent cards from `GET /api/marketplace/agents`.
- `agent_detail` (`id`): one agent by the UUID on a `browse_agents` card, from `GET /api/marketplace/agents/<id>`.
- `agent_categories`: category slugs for agents, from `GET /api/marketplace/categories`.
- `browse_skills` (`q`, `category`, `sort` popular|new|az, `limit` 1-50 default 20, `cursor`): installable skills from `GET /api/skills`.
- `skill_categories`: category slugs for skills, from `GET /api/skills/categories`.

Paginate by passing the previous response's `next_cursor` as `cursor`.

## Workflow

1. Call `agent_categories` or `skill_categories` to learn valid category slugs.
2. Call `browse_agents` or `browse_skills` with a query and category.
3. Call `agent_detail` on the best card for the full listing.

## Example

User: "Find a popular agent for programming help."

Call `agent_categories`, then `browse_agents` with `category: "programming"`, `sort: "popular"`, `limit: 10`, then `agent_detail` with the chosen card's `id`, and summarize name, description and rating.
