# Agent Task: Write "MCP (Model Context Protocol) Integration" Documentation

## Output file
`public/docs/mcp.md`

## Target audience
Developers who want to use three.ws as a tool server for Claude and other MCP-compatible AI systems. Assumes familiarity with MCP concepts and Claude's tool-use API.

## Word count
1500–2000 words

## What this document must cover

### 1. What is MCP?
Model Context Protocol (MCP) is an open standard for connecting AI assistants to external tool servers. When three.ws exposes an MCP server, Claude (and other MCP-compatible LLMs) can:
- Load 3D models into the viewer
- Play animations
- Run glTF validation
- Read agent memory
- Register agents on-chain
- Control the 3D scene via natural language

Think of it as making your three.ws a tool that Claude can use.

### 2. Starting the MCP server
The MCP server is exposed at:
```
POST https://three.ws/api/mcp
```

For local development:
```bash
npm run dev
# MCP endpoint: http://localhost:5173/api/mcp
```

The MCP server configuration is at `/.mcp.json`.

### 3. Connecting Claude Code to three.ws
Add to your Claude Code configuration (`~/.claude/settings.json`):
```json
{
  "mcpServers": {
    "3dagent": {
      "url": "https://three.ws/api/mcp",
      "headers": {
        "Authorization": "Bearer your-api-key"
      }
    }
  }
}
```

Or for local development using the `.mcp.json` file at the project root — Claude Code auto-discovers this file.

### 4. Available MCP tools

**load_model** — Load a GLB/glTF file into the viewer by URL or agent ID.

**validate_model** — Run glTF validation on the currently loaded model. Returns error/warning/hint counts and detailed messages.

**play_animation** — Play an animation clip by name, with optional loop flag.

**get_model_info** — Get metadata: animation list, mesh count, material count, texture count, file size, generator.

**speak** — Make the agent say something via TTS (text string parameter).

**set_expression** — Set emotional state: emotion name (celebration/concern/curiosity/empathy/patience/neutral) + intensity 0-1.

**remember** — Store a key-value pair to agent memory (short-term or long-term).

**get_agents** — List platform agents with optional search query and limit.

**create_widget** — Create an embeddable widget for an agent (returns embed URL and iframe snippet).

**get_widget** — Fetch widget config and embed code by widget ID.

**register_agent** — Register an agent on-chain via ERC-8004 (requires wallet connection).

For each tool, document: description, full input JSON schema with all properties, required fields, and example usage.

### 5. Example Claude workflow
Show a complete example where a user asks Claude to:
1. Load a model by URL
2. Validate it
3. Play an animation
4. Create an embeddable widget
5. Return the embed code

Walk through each tool call and response as it would appear in a Claude conversation.

### 6. MCP resources
The MCP server also exposes resources (read-only data):
- `agent://{id}` — agent manifest JSON
- `widget://{id}` — widget config JSON
- `memory://{agentId}/{type}` — agent memory contents

Show how to use MCP resources in a Claude workflow.

### 7. Authentication for MCP
The MCP endpoint requires authentication:
- API key in Authorization header (`Bearer 3da_live_xxxxx`)
- Session cookie (for browser-based use)

Generate an API key at https://three.ws/dashboard → API Keys.

### 8. Using with other MCP clients
Any MCP-compatible client works:
- **Claude Code** — direct `.mcp.json` support
- **Claude Desktop** — add to `claude_desktop_config.json`
- **Custom clients** — HTTP POST to `/api/mcp` with MCP protocol messages

Show the Claude Desktop config:
```json
{
  "mcpServers": {
    "3dagent": {
      "command": "npx",
      "args": ["-y", "@3dagent/mcp-server", "--url", "https://three.ws/"]
    }
  }
}
```

### 9. Local MCP development
For developing and testing MCP integrations locally:
```bash
git clone https://github.com/3dagent/3dagent
npm install && npm run dev
# MCP: http://localhost:5173/api/mcp (no auth in dev mode)
```

Test with `mcp-inspector`:
```bash
npx @modelcontextprotocol/inspector http://localhost:5173/api/mcp
```

### 10. Error handling
MCP error responses follow the protocol standard:
```json
{ "error": { "code": -32602, "message": "Invalid params: model URL required" } }
```

Common error codes and what they mean. How to handle auth errors, rate limits, and model loading failures.

## Tone
Developer-focused, assumes MCP familiarity. JSON schemas for all tools. Complete Claude conversation example is the most valuable part — make it realistic.

## Files to read for accuracy
- `/api/mcp.js` — MCP server implementation
- `/.mcp.json` — server configuration
- `/docs/MCP.md` — existing MCP documentation
- `/src/runtime/tools.js` — tool definitions (reference for MCP tools)
- `/api/agents.js` — agents endpoint
- `/api/widgets/index.js` — widgets endpoint
