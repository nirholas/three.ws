# GitHub Technology Partner Program

Program: GitHub Technology Partner Program.
Page last read: 2026-10-23 (<https://github.com/partners/technology-partners> and the form at <https://github.com/partners/technology-partners/apply>).
Prospect context: score 13 in `docs/partners/prospects.md`. Related tracker rows: "GitHub Open Source Friday" and the MCP registry work.
Nothing has been submitted. Shared facts and owner-only inputs: [README.md](./README.md).

## What it grants

Five complimentary GitHub Enterprise Server licenses for integration development and testing; approved partner branding under GitHub's co-branding guidelines; early access to beta programs; partner events and recognition (webinars, Partner Kickoff, GitHub Universe, Partner of the Year). No fees or review timeline are stated.

## Eligibility (quoted)

- An established technology company with a commercially available product.
- Provides, or plans to provide, a GitHub integration with clear value to shared customers.
- Technical resources to build, secure, support and maintain it.
- Integration path: GitHub Apps and Marketplace, Actions, **MCP (listed in the GitHub MCP Registry)**, Advanced Security, or secret scanning.

Fit: three.ws ships MCP servers (73 in the official MCP registry) and a VS Code extension. The prospects sweep found GitHub's curated MCP registry lists 394 servers and none of ours (searched 2026-10-09; re-check). The honest path is MCP. Do not choose Marketplace or Actions; CLAUDE.md forbids GitHub Actions.

## Deadline

None stated.

## Form fields and drafted answers

| # | Field | Required | Draft answer |
|---|---|---|---|
| 1 | First name | yes | Owner input |
| 2 | Last name | yes | Owner input |
| 3 | Company | yes | Owner input (legal entity) |
| 4 | Work email | yes | Owner input |
| 5 | Technology Partner Terms and Privacy Statement acknowledgment | yes | Owner reads and ticks. This is an agreement in the company's name |
| 6 | Job title | yes | Owner input |
| 7 | Business website | yes | `https://three.ws` |
| 8 | Business headquarters location | yes | Owner input (dropdown) |
| 9 | Phone | no | Optional |
| 10 | State, province or country of incorporation | yes | Owner input |
| 11 | GitHub organization | yes | Owner input. The repo is `github.com/nirholas/three.ws` under the user account `nirholas`; if no organization exists, state that and use the user |
| 12 | GitHub username | yes | `nirholas` |
| 13 | Category | yes | AI (alternates in the dropdown: IDEs, Utilities, Publishing) |
| 14 | Marketplace integration (building or soon launching a technical integration) | yes | Yes: an MCP server listing in the GitHub MCP Registry (`mcp-server/server.json`, name `io.github.nirholas/3d-agent-mcp`, already in the official MCP registry) |
| 15 | Country | yes | Owner input |
| 16 | Marketing consent | no | Owner's choice |

Supporting text if the follow-up asks what the integration is: hosted Streamable HTTP MCP servers with OAuth 2.1; Sep 2026 proof: 13,898 tool calls at 99.4% handler success, 13 OAuth client names including Claude, ChatGPT, Cursor, Codex and Claude Code; 7,111 finished 3D models.

## Owner steps

1. Re-check the registry for our servers, and prepare the registry submission (the pull request is a separate owner step under the agent-registries kit in `../agent-registries/`).
2. Read the Technology Partner Terms before ticking; submit the form.
3. Log the outcome in `opportunities.csv` and, if licenses arrive, note them in `docs/partners/outreach-plan.md`.
