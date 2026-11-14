# GitHub MCP Registry (github.com/mcp) nomination

**Status: not sent.** Owner order 938, item 1. Re-verified 2026-11-14.

## What is already done

The official MCP registry carries every three.ws server, so there is nothing left to publish:

| Check (2026-11-14) | Command | Result |
| --- | --- | --- |
| Official registry entry for the no-auth server | `curl -s "https://registry.modelcontextprotocol.io/v0/servers?search=threews-3d-studio-free"` | `io.github.nirholas/threews-3d-studio-free` 1.0.1, status `active`, remote `https://three.ws/api/mcp-studio`, published 2026-07-20 |
| Other three.ws entries | same endpoint, `search=threews` | `threews-3d-studio`, `threews-agent`, `threews-avatar` and five more under `io.github.nirholas/*` |
| Live endpoint answers | `tools/list` POST to `https://three.ws/api/mcp-studio` | 16 tools: `forge_free`, `text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`, `refine_model`, `check_job`, `look_at_model`, `get_job`, `search_catalog`, `get_catalog_item`, `get_item_source`, `search_docs`, `create_agent_persona`, `get_agent_persona`, `persona_say` |

## What is missing

GitHub's own registry is curated, not mirrored. Paging the whole of
`https://api.mcp.github.com/2025-09-15/v0/servers` on 2026-11-14 returned 790 servers and none
under `nirholas` or `three`. The `github.com/mcp` page has no submit link or form. The intake
recorded in the 2026-09-18 sweep (`marketing/growth/sweep-2026-09-18.md`, row M4) is a
nomination email to `partnerships@github.com`, and nothing on the page today replaces it.

## Owner steps

1. Re-run the two checks above on the day you send (a 790 count that has changed is fine; a
   three.ws entry appearing means this is already done).
2. Send the email below from the owner's address to `partnerships@github.com`.
3. Log the sent date in the `GitHub MCP Registry nomination` row of
   `marketing/growth/opportunities.csv`.

## Email

**Subject:** MCP Registry nomination: three.ws 3D Studio (free, no-auth remote server)

> Hi GitHub partnerships team,
>
> I would like to nominate the three.ws 3D Studio MCP server for the GitHub MCP Registry.
>
> It is a remote, no-auth server that turns text or an image into a textured, rigged 3D model
> (GLB) from inside Copilot, VS Code or any MCP client. There is no key, no account and no
> payment: add `https://three.ws/api/mcp-studio` as a streamable HTTP server and call
> `forge_free` or `text_to_avatar`. It exposes 16 tools covering generation, rigging, model
> refinement, a CC0 asset catalog search and a docs search.
>
> - Official MCP registry: `io.github.nirholas/threews-3d-studio-free` (active since July 2026)
> - Source: https://github.com/nirholas/three.ws
> - Docs: https://three.ws
>
> Across the three.ws MCP servers we served 13,898 tool calls from 2026-08-31 to 2026-09-30 at
> 99.4% handler success, with 13 MCP clients registering over OAuth in that window.
>
> Happy to provide anything else the review needs.
>
> Thanks,
> The three.ws team
