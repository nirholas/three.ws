# three.ws with Google ADK

Connect a [Google Agent Development Kit](https://google.github.io/adk-docs/)
agent to the three.ws 3D studio over `MCPToolset`, ADK's built-in Model Context
Protocol client. The free studio server needs no three.ws account: no API
key, no payment, no wallet.

**Runnable sample:** [examples/google-adk](../examples/google-adk/README.md)

## Connect

| | |
|---|---|
| **URL** | `https://three.ws/api/mcp-studio` |
| **Transport** | Streamable HTTP (JSON-RPC over `POST`) |
| **Auth** | None for the studio tools |
| **Protocol** | MCP `2025-06-18` |
| **Tools** | The full free studio: the same fifteen tools as [`/api/mcp-studio`](./mcp-studio.md) |

## Use with an agent

```ts
import { LlmAgent, MCPToolset } from '@google/adk';

const toolset = new MCPToolset({
  type: 'StreamableHTTPConnectionParams',
  url: 'https://three.ws/api/mcp-studio',
});

const agent = new LlmAgent({
  model: 'gemini-flash-latest',
  name: 'three_ws_agent',
  instruction: 'You help the user generate and rig 3D models with the three.ws studio tools.',
  tools: [toolset],
});
```

`MCPToolset.getTools()` discovers the live tool catalog (`forge_free`,
`text_to_avatar`, `mesh_forge`, `rig_mesh`, `forge_avatar`, `refine_model`,
`look_at_model`, `search_catalog`, `get_catalog_item`, `get_item_source`,
`create_agent_persona`, `get_agent_persona`, `persona_say`, and the job tools
`check_job`/`get_job`) and wraps each as an ADK `BaseTool` the model can call
during a conversation; ADK manages the MCP session underneath.

A tool can also be invoked directly, without a model in the loop, by calling
`runAsync({ args, toolContext })` on the `BaseTool` the toolset returns. That
path needs no Gemini credential at all, which is how the sample proves the
wiring: discover the catalog, then run a real `rig_mesh` call and print the
viewer, GLB and embed links it returns.

## Beyond the free lane

The full MCP server (`/api/mcp`) also exposes paid, x402-gated tools
(`text_to_animation` and others). Point `MCPToolset`'s `url` at it and add an
x402 client to `transportOptions.requestInit` to pay for those calls; the
free studio server above never needs one. See [docs/mcp.md](./mcp.md) for the
full catalog, authentication and the x402 payment flow.

## See also

- [examples/google-adk](../examples/google-adk/README.md): the runnable sample, verified against production.
- [docs/mcp.md](./mcp.md): the full MCP server reference.
- [docs/mcp-studio.md](./mcp-studio.md): the free studio server this sample connects to.
