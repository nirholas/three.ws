# 3d-ar-studio-mcp

The MCP server for [3D AR Studio](https://github.com/nirholas/3D-AR-Studio). It lets an agent
generate 3D models, search a free public-domain library, arrange several into one scene, and
hand a person a single link that opens the whole arrangement in augmented reality on their
phone.

```json
{
  "mcpServers": {
    "3d-ar-studio": {
      "command": "npx",
      "args": ["-y", "3d-ar-studio-mcp"]
    }
  }
}
```

No API key. Every tool is free and keyless.

| Tool | What it does |
| --- | --- |
| `generate_3d_model` | Turn a text prompt into a textured GLB, with links that open it in AR. |
| `check_generation` | Collect a generation that was still rendering. |
| `search_models` | Search the CC0 library, or any catalogue you configure. |
| `compose_ar_scene` | Arrange several models and return one link that reopens the arrangement. |
| `export_ar` | Turn any GLB URL into a device-aware "View in your space" link. |
| `create_ar_page` | Emit a complete, deployable HTML page embedding the studio. |

Configuration, tool schemas and the studio itself are documented in the
[main README](https://github.com/nirholas/3D-AR-Studio#mcp-server).

This package is a thin wrapper: it exists so `npx 3d-ar-studio-mcp` resolves, and delegates
everything to [`3d-ar-studio`](https://www.npmjs.com/package/3d-ar-studio).
