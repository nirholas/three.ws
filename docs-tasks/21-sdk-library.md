# Agent Task: Write "SDK & Library" Documentation

## Output file
`public/docs/sdk.md`

## Target audience
Developers who want to use three.ws as a library in their own JavaScript/TypeScript projects — not just embedding a web component but importing functions and classes for more advanced integration.

## Word count
1500–2500 words

## What this document must cover

### 1. SDK overview
The three.ws SDK (`@3dagent/sdk`) provides:
- The `<agent-3d>` web component (same as the CDN version)
- Programmatic APIs for agents, widgets, and ERC-8004
- Utility functions for IPFS, manifest loading, glTF validation
- TypeScript types for all APIs

The SDK is separate from the full platform — you can use the SDK to build entirely custom interfaces while leveraging the three.ws infrastructure.

### 2. Installation

**npm:**
```bash
npm install @3dagent/sdk
```

**CDN (ESM):**
```html
<script type="module">
  import { AgentAPI } from 'https://cdn.three.wssdk.esm.js';
</script>
```

**CDN (web component only):**
```html
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>
```

### 3. The web component (lib.js)
The CDN-distributable single-file build includes:
- `<agent-3d>` custom element definition
- All dependencies bundled (three.js, GLTFLoader, etc.)
- ~600-900KB gzipped
- Self-contained — no other imports needed

```html
<script type="module" src="https://cdn.three.wsagent-3d.js"></script>
<agent-3d model="./avatar.glb"></agent-3d>
```

This is the `TARGET=lib` build. Full attribute/event API documented in the Web Component reference.

### 4. AgentAPI class
For server-side or headless use — fetching and managing agents via REST:

```js
import { AgentAPI } from '@3dagent/sdk';

const api = new AgentAPI({
  apiKey: '3da_live_xxxxx',        // or use sessionToken
  baseUrl: 'https://three.ws/api'  // default
});

// List agents
const { agents, total } = await api.agents.list({ limit: 10, sort: 'created_at' });

// Get one agent
const agent = await api.agents.get('agent-id');

// Create agent
const newAgent = await api.agents.create({
  name: 'Aria',
  description: 'Product guide',
  manifest: { avatar: { url: 'https://...' } }
});

// Update
await api.agents.update('agent-id', { name: 'Aria v2' });

// Delete
await api.agents.delete('agent-id');
```

### 5. WidgetAPI class
```js
import { WidgetAPI } from '@3dagent/sdk';
const widgets = new WidgetAPI({ apiKey: '3da_live_xxxxx' });

// Create a turntable widget
const { id, embedUrl } = await widgets.create({
  agentId: 'agent-id',
  type: 'turntable',
  config: { autoRotateSpeed: 0.5, preset: 'venice' },
  visibility: 'public'
});

// Get embed code
const { iframeHtml, webComponentHtml } = await widgets.getEmbedCode(id);
```

### 6. Manifest utilities
```js
import { loadManifest, normalizeManifest } from '@3dagent/sdk/manifest';

// Load from any URI (https, ipfs, ar, agent://)
const manifest = await loadManifest('ipfs://QmXyz...');

// Normalize (resolve relative URLs, fill defaults)
const normalized = normalizeManifest(manifest, { baseUrl: 'https://...' });
```

### 7. IPFS utilities
```js
import { resolveIPFS, pinToIPFS } from '@3dagent/sdk/ipfs';

// Resolve an ipfs:// URI to an HTTPS gateway URL
const url = resolveIPFS('ipfs://QmXyz...');
// Returns: "https://ipfs.io/ipfs/QmXyz..."

// Pin a file
const { cid } = await pinToIPFS(fileBuffer, {
  provider: 'pinata',
  token: process.env.PINATA_JWT
});
```

### 8. glTF validation
```js
import { validateGLB, validateGLBFile } from '@3dagent/sdk/validator';

// Browser (ArrayBuffer)
const buffer = await file.arrayBuffer();
const report = await validateGLB(buffer);

// Node.js (file path)
const report = await validateGLBFile('./output/avatar.glb');

console.log(report.issues.numErrors);   // 0 = clean
console.log(report.issues.numWarnings);
console.log(report.issues.messages);   // array of { severity, message, pointer }
```

### 9. ERC-8004 utilities
```js
import { AgentRegistry, getReputation } from '@3dagent/sdk/erc8004';

// Initialize registry for a chain
const registry = new AgentRegistry({ chainId: 8453 });

// Read an agent
const agent = await registry.getAgent(42);
// { id: 42, creator: '0x...', cid: 'Qm...', name: 'Aria', ... }

// Get all agents by address
const agents = await registry.getAgentsByAddress('0xYourWallet');

// Get reputation
const { averageRating, totalReviews } = await getReputation(8453, 42);

// Register (requires wallet signer)
const { agentId, txHash } = await registry.registerAgent({
  manifestCid: 'QmXyz...',
  name: 'Aria',
  wallet: signerFromEthers
});
```

### 10. TypeScript support
The SDK ships full TypeScript declarations:
```ts
import type { AgentManifest, WidgetType, ERC8004Agent } from '@3dagent/sdk/types';

const manifest: AgentManifest = {
  name: 'Aria',
  avatar: { url: 'https://example.com/aria.glb' }
};

const widgetType: WidgetType = 'turntable';
```

### 11. Building from source
```bash
git clone https://github.com/3dagent/3dagent
npm install

# Build the library (agent-3d.js)
TARGET=lib npm run build

# Output: dist-lib/agent-3d.js + dist-lib/agent-3d.umd.js

# Build the full app
npm run build

# Build the artifact bundle
npm run build:artifact
```

### 12. The LobeHub plugin
A pre-built integration with the LobeHub AI chat platform:
- Located in `/lobehub-plugin/`
- Exposes three.ws capabilities as LobeHub tools
- Install from the LobeHub plugin marketplace
- Full docs in `/lobehub-plugin/README.md`

### 13. Publishing your own library build
```bash
# scripts/publish-lib.mjs
node scripts/publish-lib.mjs --version 1.5.1 --registry npm
```

Publishes to npm as `@3dagent/sdk` and uploads to the CDN.

### 14. Versioning and changelog
- Semantic versioning (semver)
- SDK changelog at `/sdk/CHANGELOG.md`
- Web component is versioned with the platform (`agent-3d@1.5.1`)
- Breaking changes only in major versions

## Tone
Developer reference. Code-first. Show the most common use cases with complete examples. Mention TypeScript support prominently.

## Files to read for accuracy
- `/src/lib.js` — CDN export surface
- `/sdk/README.md`
- `/sdk/CHANGELOG.md`
- `/src/manifest.js`
- `/src/ipfs.js`
- `/src/validator.js`
- `/src/erc8004/agent-registry.js`
- `/src/erc8004/queries.js`
- `/scripts/publish-lib.mjs`
- `/vite.config.js` — lib build config
- `/lobehub-plugin/README.md`
- `/package.json` — package name and version
