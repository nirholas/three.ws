---
mode: agent
description: "Update all documentation to cover new modules and current architecture"
---

# Update Documentation

## Problem

`docs/DEVELOPMENT.md` project layout is outdated — missing `avatar-creator.js`, `avaturn-agent.js`, `ipfs.js`, `model-info.js`, `annotations.js`, and the entire `erc8004/` directory. Other docs reference a simpler architecture than what exists.

## Tasks

### 1. Update `docs/DEVELOPMENT.md`

Rewrite the project layout section to include all current files:

```
src/
├── app.js                # Main entry — routing, drag-and-drop, hash params
├── viewer.js             # Three.js Viewer class — rendering, GUI, controls
├── validator.js          # Khronos glTF-Validator integration
├── environments.js       # HDR environment map definitions
├── ipfs.js               # IPFS/Arweave URI resolution with gateway fallback
├── avatar-creator.js     # Avaturn SDK integration for avatar creation
├── avaturn-agent.js      # Chat agent with speech synthesis/recognition
├── model-info.js         # Model metadata overlay (vertices, triangles, etc.)
├── annotations.js        # Mesh label annotations with canvas rendering
├── material-editor.js    # (planned) PBR material parameter editing
├── scene-explorer.js     # (planned) Scene graph tree view
├── components/
│   ├── footer.jsx        # Footer component
│   ├── validator-report.jsx  # Validation report rendered as HTML
│   ├── validator-table.jsx   # Validation issues table
│   └── validator-toggle.jsx  # Validation panel toggle button
├── erc8004/
│   ├── index.js          # Re-exports for ERC-8004 module
│   ├── abi.js            # Identity Registry ABI and deployment addresses
│   ├── agent-registry.js # On-chain agent registration flow
│   └── register-ui.js    # Registration form UI
api/
├── mcp.js                # MCP server (Streamable HTTP, JSON-RPC)
├── avatars/              # Avatar CRUD REST API
├── auth/                 # User authentication (register, login, logout)
├── oauth/                # OAuth 2.1 (authorize, token, revoke, introspect)
├── keys/                 # API key management
├── usage/                # Usage tracking and summaries
├── _lib/                 # Shared utilities (db, auth, crypto, rate-limit, etc.)
└── .well-known/          # OAuth discovery endpoints
```

### 2. Update `docs/ARCHITECTURE.md`

Add sections for:
- **Avatar System**: Avaturn SDK → export GLB → save to R2 → view in 3D
- **ERC-8004 Integration**: Identity Registry → IPFS pin → on-chain registration
- **MCP Server**: JSON-RPC dispatch, tool catalog, OAuth auth flow
- **A2A Discovery**: agent-card.json, agent-registration.json
- **IPFS/Arweave**: URI resolution, multi-gateway fallback

### 3. Update `docs/API.md`

Add documentation for:
- `AvatarCreator` class (constructor, open, close)
- `NichAgent` class (chat agent)
- `IPFS` module (resolveIpfsUrl, resolveArweaveUrl)
- `ModelInfo` module (createModelInfo)
- `Annotations` module (buildAnnotations, renderAnnotationCanvas)
- `ERC8004` module (registerAgent, lookupAgent, agentRegistryId)
- All MCP tools
- All REST API endpoints

### 4. Update `docs/DEPLOYMENT.md`

Add:
- Environment variables needed for full deployment (R2, DB, OAuth secrets)
- MCP server deployment considerations
- Contract deployment references (link to `deploy-erc8004-contracts.md`)

### 5. Update `README.md` Roadmap

Move completed items from roadmap to a "Completed" section as features ship.

## Validation

- All files mentioned in docs actually exist
- All classes/functions documented in API.md exist in source
- No references to deleted or renamed files
- Project layout in DEVELOPMENT.md matches actual `ls -R` output
