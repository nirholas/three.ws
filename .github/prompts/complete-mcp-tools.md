---
mode: agent
description: "Complete MCP server with validate-model tool and full tool documentation"
---

# Complete MCP Integration

## Problem

The MCP server (`api/mcp.js`) has avatar CRUD tools but is missing key capabilities that the agent should expose. The OpenAPI spec only documents `GET /`. The tool catalog needs expansion.

## New MCP Tools to Add

### 1. `validate_model` — glTF Validation via MCP

Allow MCP clients to submit a model URL for server-side validation:

```js
{
    name: 'validate_model',
    description: 'Run Khronos glTF-Validator against a model URL and return the validation report',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL of the glTF/GLB model to validate' },
            maxIssues: { type: 'number', description: 'Maximum issues to report (default: 100)' }
        },
        required: ['url']
    }
}
```

Implementation:
- Fetch the model from the URL (with size limit, e.g., 50MB)
- Run `validateBytes()` from `gltf-validator`
- Return structured report with errors, warnings, info, hints
- Include model stats (vertex count, material count, etc.)

### 2. `inspect_model` — Model Metadata

```js
{
    name: 'inspect_model',
    description: 'Get metadata and statistics about a 3D model without full validation',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL of the glTF/GLB model' }
        },
        required: ['url']
    }
}
```

Returns: generator, version, extensions used, mesh count, material count, animation count, total vertices, total triangles, file size.

### 3. `optimize_model` — Model Optimization Suggestions

```js
{
    name: 'optimize_model',
    description: 'Analyze a model and suggest optimizations',
    inputSchema: {
        type: 'object',
        properties: {
            url: { type: 'string', description: 'URL of the glTF/GLB model' }
        },
        required: ['url']
    }
}
```

Returns suggestions like: "Use Draco compression to reduce geometry size by ~60%", "Resize 4096x4096 textures to 2048x2048", "Remove unused materials", etc.

### 4. `create_avatar` — Upload and Create Avatar via MCP

Allow MCP clients to create avatars programmatically:
- Accept GLB upload (base64 or URL)
- Create avatar record
- Return avatar ID and viewer URL

## Server-Side Dependencies

For `validate_model` and `inspect_model`, install `gltf-validator` in the API:
- Already in `dependencies` — just import in the API handler
- Add URL fetching with proper timeout and size limits
- Sanitize URLs to prevent SSRF (allowlist of protocols: `https://`)

## Rate Limiting

Add per-tool rate limits:
- `validate_model`: 10/min (compute-heavy)
- `inspect_model`: 30/min
- `optimize_model`: 10/min
- Avatar tools: existing limits

## Validation

- MCP client sends `tools/list` → all new tools appear in catalog
- `tools/call` with `validate_model` and a Khronos sample model URL → returns valid report
- Rate limiting works — exceeding limit returns proper JSON-RPC error
- SSRF protection — private IPs and non-HTTPS URLs are rejected
