---
mode: agent
description: "Create the missing A2A agent-card.json for agent discovery"
---

# Create A2A Agent Card

## Problem

Both `features.html` (line 90) and `public/.well-known/agent-registration.json` reference `https://3d.irish/.well-known/agent-card.json` as the A2A discovery endpoint, but **no such file exists**. This is a dead link and breaks the A2A (Agent-to-Agent) protocol integration.

## What is agent-card.json?

The A2A protocol (Google's Agent-to-Agent spec) uses `/.well-known/agent-card.json` as the discovery document. It describes the agent's capabilities, supported protocols, authentication requirements, and available skills/tools.

Reference: https://google.github.io/A2A/specification/

## Implementation

Create `public/.well-known/agent-card.json` with the full A2A agent card spec:

```json
{
  "name": "3D Agent",
  "description": "AI-powered 3D model viewer and validation agent. Load glTF/GLB models, run validation, inspect materials, and manage avatar assets.",
  "url": "https://3d.irish",
  "provider": {
    "organization": "3D Agent",
    "url": "https://3d.irish"
  },
  "version": "1.5.1",
  "capabilities": {
    "streaming": false,
    "pushNotifications": false,
    "stateTransitionHistory": false
  },
  "authentication": {
    "schemes": ["bearer"],
    "credentials": null
  },
  "defaultInputModes": ["text/plain", "application/json"],
  "defaultOutputModes": ["text/plain", "application/json"],
  "skills": [
    {
      "id": "list-avatars",
      "name": "List Avatars",
      "description": "List all avatars owned by the authenticated user",
      "tags": ["avatar", "list"],
      "examples": ["Show me my avatars", "List all my 3D models"]
    },
    {
      "id": "get-avatar",
      "name": "Get Avatar",
      "description": "Retrieve details of a specific avatar by ID or slug",
      "tags": ["avatar", "inspect"],
      "examples": ["Get avatar details for cz", "Show avatar info"]
    },
    {
      "id": "search-avatars",
      "name": "Search Public Avatars",
      "description": "Search public avatar gallery by query",
      "tags": ["avatar", "search"],
      "examples": ["Find avatars matching 'robot'", "Search public models"]
    },
    {
      "id": "render-avatar",
      "name": "Render Avatar",
      "description": "Get a render/preview URL for an avatar in the 3D viewer",
      "tags": ["avatar", "render", "preview"],
      "examples": ["Render my avatar in the viewer", "Preview this model"]
    },
    {
      "id": "validate-model",
      "name": "Validate glTF Model",
      "description": "Run Khronos glTF-validator against a model URL and return the validation report",
      "tags": ["validation", "gltf", "quality"],
      "examples": ["Validate this GLB file", "Check model for errors"]
    },
    {
      "id": "delete-avatar",
      "name": "Delete Avatar",
      "description": "Delete an avatar owned by the authenticated user",
      "tags": ["avatar", "delete"],
      "examples": ["Delete my old avatar", "Remove avatar abc123"]
    }
  ]
}
```

## Also Update

1. **Ensure `vercel.json`** routes `/.well-known/agent-card.json` correctly — the existing catch-all for `public/` should handle it, but verify
2. **Cross-reference** with the MCP tool catalog in `api/mcp.js` — each skill should map to an actual MCP tool
3. **Keep version in sync** with `package.json` version

## Validation

- `curl https://3d.irish/.well-known/agent-card.json` returns valid JSON
- Skills listed match the tools defined in `api/mcp.js`
- The `agent-registration.json` A2A service endpoint resolves
