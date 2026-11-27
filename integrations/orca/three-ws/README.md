# three.ws plugin for Orca

A declarative [Orca](https://github.com/stablyai/orca) plugin that gives the agents Orca launches the three.ws 3D studio over MCP. An agent can search a catalog of ready-made 3D assets, read the docs and check a render with no account, and make, refine or rig a model once it is signed in to a free three.ws account.

The plugin has one file, [`orca-plugin.json`](orca-plugin.json). Its only contribution is one MCP server:

```
https://three.ws/api/mcp-studio
```

No tool on that server moves money.

## Requirements

Orca 1.4.276 or newer. The manifest declares `engines.orca >= 1.4.276`, the minimum Orca's validator asks for when a plugin contributes MCP servers.

## Install

In Orca: Settings, MCP servers. Plugin servers are listed under "From plugins". Install this folder as a plugin, then choose which agents and workspaces get the server.

To use the server without the plugin, paste this in the same settings page:

```
claude mcp add --transport http three-ws https://three.ws/api/mcp-studio
```

## Making and rigging models

The manifest carries the plain URL because Orca refuses `headers` in a plugin manifest and a public manifest must not hold a key. To make or rig a model, add the server through the paste route with a key from [three.ws/dashboard/api-keys](https://three.ws/dashboard/api-keys) sent as `Authorization: Bearer <key>`, or use `https://three.ws/api/mcp-studio?auth=oauth` in a client that supports MCP sign-in.

## Check it

```bash
orca plugin validate integrations/orca/three-ws
```

On 2026-11-27 the manifest passed Orca's own validator (`config/scripts/plugin-authoring/content-validation/validate-plugin-files.mjs`, the checks behind `orca plugin validate`), and a copy with `headers` added was refused with `unknown key "headers"`. Orca itself, a desktop app, was not run for that check.

The setup for Orca and four other agent-fleet tools is in [docs/grok-fleet-tools.md](../../../docs/grok-fleet-tools.md).
