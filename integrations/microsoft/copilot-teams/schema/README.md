# Vendored Microsoft schemas

`npm run package:microsoft-app -- --check` validates the app package against these files offline. Each one is an unmodified copy of the file Microsoft publishes at the source URL. To move to a newer version, download the new file next to the old one, point `scripts/build-microsoft-app-package.mjs` at it, bump the matching `$schema`/`version` fields in the package sources, and rerun `--check`.

| File | Validates | Source |
|---|---|---|
| `MicrosoftTeams.schema.v1.30.json` | `manifest.template.json` (unified Microsoft 365 app manifest) | https://developer.microsoft.com/json-schemas/teams/v1.30/MicrosoftTeams.schema.json |
| `declarative-agent.schema.v1.9.json` | `declarativeAgent.json` (Microsoft 365 Copilot declarative agent) | https://developer.microsoft.com/json-schemas/copilot/declarative-agent/v1.9/schema.json |
| `api-plugin.schema.v2.4.json` | `ai-plugin.json` (Copilot plugin manifest, `RemoteMCPServer` runtime) | https://developer.microsoft.com/json-schemas/copilot/plugin/v2.4/schema.json |

Reference docs: [declarative agent schema 1.9](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/declarative-agent-manifest-1.9), [plugin manifest schema 2.4](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/plugin-manifest-2.4), [MCP plugins for declarative agents](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/build-mcp-plugins), [pinned tools versus dynamic discovery](https://learn.microsoft.com/en-us/microsoft-365-copilot/extensibility/plugin-dynamic-tool-discovery).

Vendored 2026-11-16. As of that date v1.9 and v2.4 are the newest versions Microsoft publishes (v1.10 and v2.5 return 404).
