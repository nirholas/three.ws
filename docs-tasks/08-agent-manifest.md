# Agent Task: Write "Agent Manifest" Documentation

## Output file
`public/docs/agent-manifest.md`

## Target audience
Developers creating or configuring agents programmatically. This is a complete reference for the agent manifest JSON format.

## Word count
2000–3000 words

## What this document must cover

### 1. What is an agent manifest?
The manifest is the configuration file that defines an agent — its identity, avatar, personality, skills, memory, and voice. It's a JSON file that can be:
- Hosted at any HTTPS URL
- Pinned to IPFS (accessed as `ipfs://<cid>`)
- Pinned to Arweave (accessed as `ar://<txid>`)
- Registered on-chain (ERC-8004) where the registry stores the IPFS CID

### 2. Loading a manifest
```html
<!-- By platform agent ID (resolves via /api/agents/:id) -->
<agent-three.ws-id="aria-guide"></agent-3d>

<!-- By HTTPS URL -->
<agent-three.ws-id="https://example.com/aria/manifest.json"></agent-3d>

<!-- By IPFS CID -->
<agent-three.ws-id="ipfs://QmXyz..."></agent-3d>

<!-- By Arweave ID -->
<agent-three.ws-id="ar://txid..."></agent-3d>

<!-- On-chain (ERC-8004): chainId:registryAddress:agentId -->
<agent-three.ws-id="8453:0x1234...:42"></agent-3d>
```

### 3. Full manifest schema

Show the complete JSON structure with annotations:

```json
{
  "$schema": "https://three.ws/schemas/agent-manifest-v1.json",
  "name": "Aria",
  "description": "A helpful product guide for Acme Corp",
  "creator": {
    "name": "Acme Corp",
    "url": "https://acme.com",
    "address": "0xCreatorWalletAddress"
  },
  "avatar": {
    "url": "https://cdn.acme.com/aria.glb",
    "thumbnail": "https://cdn.acme.com/aria-thumb.png",
    "preset": "venice"
  },
  "personality": {
    "prompt": "You are Aria, Acme Corp's 3D product guide. Be friendly, concise, and helpful. You know everything about Acme's product catalog.",
    "tone": "friendly",
    "domain": "product-support",
    "voice": "female",
    "language": "en-US"
  },
  "memory": {
    "mode": "ipfs",
    "provider": "pinata",
    "encryptionKey": "optional-encryption-key"
  },
  "identity": {
    "chainId": 8453,
    "registryAddress": "0xIdentityRegistryAddress",
    "agentId": 42
  },
  "skills": [
    {
      "url": "https://cdn.three.wsskills/wave.json"
    },
    {
      "url": "https://cdn.three.wsskills/validate-model.json"
    },
    {
      "name": "search-catalog",
      "description": "Search Acme product catalog",
      "tools": [
        {
          "name": "search_products",
          "description": "Search the Acme product database",
          "parameters": {
            "type": "object",
            "properties": {
              "query": { "type": "string" }
            },
            "required": ["query"]
          }
        }
      ],
      "handlers": "https://cdn.acme.com/skills/search-catalog.js"
    }
  ],
  "embed": {
    "allowedOrigins": ["https://acme.com", "https://app.acme.com"],
    "mode": "floating",
    "primaryColor": "#0066ff"
  }
}
```

### 4. Field-by-field reference

For each top-level field, document:
- Type
- Required/optional
- Description
- Valid values
- Default

**name** (string, required)
Display name of the agent. Shown in UI headers and identity cards.

**description** (string, optional)
Short description. Used in discovery/gallery listings and OG metadata.

**creator** (object, optional)
- `name` — display name of creator
- `url` — creator's website
- `address` — Ethereum address (used for ownership verification)

**avatar** (object, required)
- `url` — GLB/glTF URL (required)
- `thumbnail` — PNG/JPG for card previews (optional, auto-generated if omitted)
- `preset` — environment preset: `venice` | `footprint` | `neutral` (default: `venice`)
- `cameraPosition` — default camera position `[x, y, z]`

**personality** (object, optional)
- `prompt` — system prompt for the LLM. Defines behavior, knowledge, constraints.
- `tone` — `friendly` | `professional` | `playful` | `formal`
- `domain` — hint for the LLM about the agent's area of expertise
- `voice` — `male` | `female` | `neutral` (for TTS voice selection)
- `language` — BCP 47 language tag (default: `en-US`)

**memory** (object, optional)
- `mode` — `local` | `ipfs` | `encrypted-ipfs` | `none` (default: `local`)
- `provider` — `pinata` | `filebase` | `web3-storage` (required if mode is ipfs)
- `encryptionKey` — encryption key (required if mode is encrypted-ipfs)

**identity** (object, optional)
Links agent to on-chain registration:
- `chainId` — EVM chain ID (1=Ethereum, 8453=Base, 11155111=Sepolia)
- `registryAddress` — address of deployed IdentityRegistry contract
- `agentId` — numeric ID returned by registry on registration

**skills** (array, optional)
Each item is either:
- A URL reference: `{ "url": "https://..." }`
- An inline skill spec: `{ "name": "...", "tools": [...], "handlers": "..." }`
See Skills documentation for full skill spec.

**embed** (object, optional)
Controls embed behavior:
- `allowedOrigins` — array of URLs allowed to embed this agent
- `mode` — default display mode for embedded widgets
- `primaryColor` — CSS hex color for UI accents

### 5. Base URI resolution
When a GLB URL is relative, it's resolved against the manifest's own URL:
```json
{
  "avatar": { "url": "./aria.glb" }
}
```
If manifest is at `https://cdn.acme.com/aria/manifest.json`, the GLB resolves to `https://cdn.acme.com/aria/aria.glb`.

Works the same for IPFS: `ipfs://<manifest-cid>` → relative URLs resolved against the IPFS gateway.

### 6. Hosting your manifest
Options:
- **HTTPS** — host on any CDN (GitHub Pages, S3, Vercel)
- **IPFS** — pin with Pinata, Filebase, or Web3.Storage
- **three.ws Platform** — upload via the editor; platform hosts it for you
- **Arweave** — permanent storage

Minimum CORS requirements: manifest file must be accessible cross-origin (CORS header: `Access-Control-Allow-Origin: *`).

### 7. Validating a manifest
The platform validates manifests against the JSON schema on load. Common errors:
- Missing required `avatar.url`
- Invalid URI scheme for `memory.provider`
- `identity.chainId` not a supported chain

Use the validator at https://three.ws/validation to check before publishing.

### 8. Versioning
The `$schema` field identifies the manifest version. Current: v1. Future versions will be backwards-compatible (new fields only, no removals without major version bump).

### 9. Manifest for different use cases

**Minimal (no AI, just viewer):**
```json
{ "name": "Product", "avatar": { "url": "./product.glb" } }
```

**Talking agent with memory:**
```json
{
  "name": "Leo", "avatar": { "url": "./leo.glb" },
  "personality": { "prompt": "You are Leo, a fitness coach." },
  "memory": { "mode": "ipfs", "provider": "pinata" },
  "skills": [{ "url": "https://cdn.three.wsskills/wave.json" }]
}
```

**Full on-chain identity:**
```json
{
  "name": "Sage", "avatar": { "url": "ipfs://QmXyz.../sage.glb" },
  "personality": { "prompt": "You are Sage, a blockchain-native AI agent." },
  "identity": { "chainId": 8453, "registryAddress": "0x...", "agentId": 7 },
  "memory": { "mode": "encrypted-ipfs", "provider": "filebase" }
}
```

## Tone
Precise reference documentation. JSON examples for everything. Every field described clearly. Developers will copy-paste from this page.

## Files to read for accuracy
- `/specs/AGENT_MANIFEST.md`
- `/src/manifest.js` — manifest loader and normalizer
- `/src/manifest-normalize.js` (if exists)
- `/src/ipfs.js` — URI resolution
- `/src/agent-identity.js`
- `/src/agent-skills.js`
- `/src/memory/index.js`
- `/tests/src/manifest.test.js`
- `/tests/src/manifest-normalize.test.js`
