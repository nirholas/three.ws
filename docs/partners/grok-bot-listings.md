# Grok Bot connector listings

Researched 2026-10-23. Nothing here has been submitted. Every submission publishes
to an external site, so each one waits for the owner's yes (CLAUDE.md gate 2).

xAI itself has no connector directory with a submission process: a user adds a custom
connector by URL under Connectors in Grok ([xAI connectors docs](https://docs.x.ai/grok/connectors)).
The listings below are third-party MCP directories that Grok Bot users browse.

## The text we submit

| Field | Value |
|---|---|
| Name | three.ws |
| One line | Free 3D studio for AI agents: search a catalog of ready-made 3D assets, generate models from text, rig avatars, and get viewer links back. |
| Connector URL (Grok) | `https://three.ws/api/mcp-grok` |
| Connector URL (any MCP client, no auth) | `https://three.ws/api/mcp-studio` |
| Transport | Streamable HTTP |
| Auth | None for the studio server; OAuth 2.1 at `?auth=oauth`; API key (connector preset) |
| Docs | https://three.ws/docs/grok-bot |
| Website | https://three.ws/grok |
| Logo | `public/logo.png` (https://three.ws/logo.png) |
| Maintainer | three.ws, https://three.ws |

Verified live: `npm run probe:mcp-clients` passes 8 of 8 hosted servers against production
(`prompts/x-grok/_generated/connector-probe.json`).

## Directories

| Directory | Method | Requirements | Cost | Listed already |
|---|---|---|---|---|
| [mcpservers.org](https://mcpservers.org/submit) | Web form | Name, category (Design), short description, repository/website/docs link, optional official MCP Registry name, remote-connection checkbox (tick it), contact email | Free (review up to 2 weeks) or $39 premium (about 24 hours, badge). Paid is an external spend: owner decides. | Not found |
| [awesome-remote-mcp-servers](https://github.com/jaw9c/awesome-remote-mcp-servers) | Pull request | One table row: Name, Category, URL in backticks, Authentication, Maintainer link. Needs OAuth 2.0 or API key support (we have both) | Free | Not found |
| [awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | Pull request | Requires a public GitHub repository users can install and run. A hosted URL with no installable package belongs in the remote list above instead. Our installable packages (`@three-ws/*-mcp`) qualify; pick one repo | Free | Not checked per entry |

## Prepared diffs (not opened)

### awesome-remote-mcp-servers, README table row

Category column uses the existing value `Design`.

```
| three.ws | Design | `https://three.ws/api/mcp-grok` | OAuth2.1 / API Key / Open | [three.ws](https://three.ws) |
```

Example usage to put in the PR body: "Ask Grok Bot: find a ready-made chair in the three.ws
catalog and give me its viewer link. The free studio server needs no account."

### mcpservers.org form values

| Form field | Value |
|---|---|
| Server Name | three.ws |
| Category | Design |
| Short Description | the one line above |
| Website/Docs | https://three.ws/docs/grok-bot |
| Remote connections | checked |
| Submission plan | Free |

### awesome-mcp-servers

Held. The entry needs the repository link of an installable server and the maintainers' category
for it; the owner picks which package repository to point at. Entry shape: a single line linking
the server name to its repository with a short description, alphabetical within the category.

## Owner approval needed

Approve per row: (1) mcpservers.org free form, (2) awesome-remote-mcp-servers PR, (3) awesome-mcp-servers PR
and which repo. After approval, run each submission, record its URL here, then retire order 929.
