# Composio Toolkit Partnership

Program: Composio Toolkit Partnership (Composio builds and lists a toolkit for our API or MCP server).
Page last read: 2026-10-23 (<https://composio.dev/partnerships/toolkit>).
Tracker row: "Composio toolkit partnership" in `marketing/growth/opportunities.csv` (target date 2026-10-30).
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## Deadline and eligibility

- No deadline stated. The tracker target is 2026-10-30.
- No eligibility criteria stated. A partial application is accepted; Composio asks for the rest as work proceeds. Composio asks to disclose any paid plan, allowlist or approval requirement, and wants company-owned test accounts.
- Never type credentials into the form. Share them through a private, expiring link to our own secret store.

## Form fields and drafted answers

| Field | Required | Draft answer |
|---|---|---|
| Full name | yes | Owner input |
| Work email | yes | Owner input (a three.ws address) |
| Company name | yes | Owner input (legal entity; trade name three.ws) |
| Your role | no | Owner input |
| Website | no | `https://three.ws` |
| Partnership type (dropdown) | no | Composio Toolkit Partnership |
| Company description | no | three.ws is an open-source platform for embodied 3D AI agents. It turns a text prompt or photo into a textured, rigged 3D model or avatar, and embeds it on any page with one web component. Its hosted MCP servers (73 listed in the official MCP registry) let any agent generate, rig, find and view 3D content. |
| Developer documentation | no | `https://three.ws/docs/mcp-studio` (source `docs/mcp-studio.md`) and `https://three.ws/docs/mcp` |
| Product logo URL | no | `https://three.ws/logo.png` |
| Technical contact | no | Owner input |
| Interest in Composio Instant | no | Yes for the free tools (no account, no key); not applicable to paid tools, which settle over x402 |
| Integration surfaces available today | yes | Remote MCP server (HTTPS) and REST API. Webhooks: no. GraphQL: no |
| Authentication methods | yes | OAuth 2.0/2.1 (dynamic client registration supported), API key or token, and No authentication for the free tools |
| Test account with integration features enabled | no | Yes, with the relevant features enabled: free tools need no account; paid features use a prepaid-credit test account the owner creates |
| Access requires paid plan, allowlist or approval | no | No for the free tools. Yes in the sense that paid generation lanes consume prepaid credits |
| Account, app and billing company-owned | no | Yes, company owned (owner confirms) |
| Workflows to make sure work | no | 1) Text to 3D: call `forge_free`, poll `check_job`, return the viewer URL `https://three.ws/m/<id>`. 2) Photo to avatar: `forge_avatar`. 3) Asset lookup: search the CC0 catalog and return a GLB URL. 4) Inspect a model with `look_at_model`. |
| Anything else | no | Production traffic, Sep 2026 (proof brief): 13,898 MCP tool calls at 99.4% handler success, handler p50 143 ms; 7,111 finished 3D models; 13 OAuth client names including Claude, ChatGPT, Cursor and Codex. Endpoint: `https://three.ws/api/mcp-studio` (Streamable HTTP, MCP 2025-06-18). |
| LinkedIn URL, company LinkedIn, socials | no | Owner input; X handle `@trythreews`, Telegram `t.me/three_ws` (from `docs/i18n.md`) |

Honesty notes: the tool list in the description comes from `docs/mcp-studio.md` (fifteen tools). Re-pull `tools/list` on the submission day so the names above are exact.

## Owner steps

1. Open <https://composio.dev/partnerships/toolkit>, fill the fields above, leave the hidden "Leave this field blank" field empty, press Apply Now.
2. When Composio replies, share test credentials by expiring link only.
3. Log submission in `opportunities.csv`; when the toolkit is live, add the Composio listing URL to `docs/listings-registry.md` and the tracker's evidence column.
