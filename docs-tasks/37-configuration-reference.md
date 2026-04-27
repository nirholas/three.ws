# Agent Task: Write "Configuration Reference" Documentation

## Output file
`public/docs/configuration.md`

## Target audience
Developers setting up a self-hosted three.ws instance or configuring their development environment. This is a complete reference for all environment variables and configuration files.

## Word count
1500–2000 words

## What this document must cover

### 1. Overview
three.ws is configured via:
- **Environment variables** (`.env` / `.env.local`) — server secrets and API keys
- **`vercel.json`** — routing, headers, and edge config
- **`vite.config.js`** — build configuration
- **`cors.json`** — CORS policy
- **`/.mcp.json`** — MCP server configuration

### 2. Environment variables — complete reference

For each variable: name, required/optional, description, where to get it, example value.

**Core / Required:**

`DATABASE_URL`
Required. PostgreSQL connection string.
```
DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
```
Get from: Neon DB (neon.tech), Supabase, or any PostgreSQL host.

`JWT_SECRET`
Required. 256-bit secret for signing session JWTs.
```
JWT_SECRET=a1b2c3d4e5f6...  # 64 hex chars
```
Generate: `openssl rand -hex 32`

`NEXT_PUBLIC_BASE_URL`
Required. The canonical URL of your deployment.
```
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
```

**LLM (required for agent conversations):**

`ANTHROPIC_API_KEY`
Required for agent LLM conversations. Get from console.anthropic.com.
```
ANTHROPIC_API_KEY=sk-ant-api03-xxxxx
```

**Storage (required for GLB uploads):**

`AWS_ACCESS_KEY_ID`
`AWS_SECRET_ACCESS_KEY`
`AWS_REGION`
`AWS_S3_BUCKET`
Required for saving GLB files and thumbnails to object storage.
```
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
AWS_S3_BUCKET=my-3dagent-assets
```
Supports AWS S3, Cloudflare R2 (set `AWS_S3_ENDPOINT`), or MinIO.

`AWS_S3_ENDPOINT`
Optional. For S3-compatible services (R2, MinIO):
```
AWS_S3_ENDPOINT=https://abc123.r2.cloudflarestorage.com
```

**Cache / Rate limiting (recommended):**

`UPSTASH_REDIS_REST_URL`
`UPSTASH_REDIS_REST_TOKEN`
Recommended. Upstash Redis for rate limiting and caching. Get from upstash.com.
```
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxxxx
```
Without Redis: rate limiting is disabled (security risk in production).

**Authentication:**

`SIWE_DOMAIN`
Required for wallet auth. Set to your domain (no https://).
```
SIWE_DOMAIN=yourdomain.com
```

`PRIVY_APP_ID`
`PRIVY_APP_SECRET`
Optional. For social/email login via Privy. Get from console.privy.io.
```
PRIVY_APP_ID=clxxxxxxxx
PRIVY_APP_SECRET=xxxxx
```

**TTS (optional — enhanced voice quality):**

`ELEVENLABS_API_KEY`
Optional. For ElevenLabs high-quality TTS. Get from elevenlabs.io.
```
ELEVENLABS_API_KEY=xxxxx
```
Without this: falls back to browser Web Speech API.

**IPFS (optional — for decentralized memory/assets):**

`PINATA_JWT`
Optional. For IPFS pinning via Pinata. Get from app.pinata.cloud.
```
PINATA_JWT=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

`FILEBASE_KEY`
`FILEBASE_SECRET`
Optional. For IPFS pinning via Filebase.
```
FILEBASE_KEY=xxxxx
FILEBASE_SECRET=xxxxx
```

`WEB3_STORAGE_TOKEN`
Optional. For IPFS pinning via Web3.Storage.
```
WEB3_STORAGE_TOKEN=xxxxx
```

**Blockchain RPC (optional — for on-chain features):**

`ALCHEMY_API_KEY`
Optional. For reliable blockchain RPC access. Get from alchemy.com.
```
ALCHEMY_API_KEY=xxxxx
```

`INFURA_API_KEY`
Optional. Alternative to Alchemy.
```
INFURA_API_KEY=xxxxx
```
Without these: falls back to public RPC endpoints (less reliable for production).

**Feature flags:**

`ENABLE_ONCHAIN`
Optional. Set to `false` to disable all blockchain features.
```
ENABLE_ONCHAIN=true
```

`ENABLE_IPFS_MEMORY`
Optional. Set to `false` to disable IPFS memory mode.
```
ENABLE_IPFS_MEMORY=true
```

`ENABLE_AR`
Optional. Set to `false` to hide AR buttons.
```
ENABLE_AR=true
```

### 3. Local development env
Minimum `.env.local` to run the dev server with core features:
```env
DATABASE_URL=postgresql://...  # Neon free tier works
JWT_SECRET=your-random-secret
SIWE_DOMAIN=localhost
NEXT_PUBLIC_BASE_URL=http://localhost:5173
ANTHROPIC_API_KEY=sk-ant-...
```

Everything else is optional for development.

### 4. vercel.json configuration
Key sections of `vercel.json`:

**Rewrites** — map URL patterns to HTML entry points:
```json
{
  "rewrites": [
    { "source": "/a/:chainId/:agentId", "destination": "/a-embed.html" },
    { "source": "/agent/:id/edit", "destination": "/agent-edit.html" },
    { "source": "/embed", "destination": "/embed.html" },
    { "source": "/docs/:path*", "destination": "/index.html" }
  ]
}
```

**Headers** — security and CORS headers:
```json
{
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        { "key": "Access-Control-Allow-Origin", "value": "*" },
        { "key": "Access-Control-Allow-Methods", "value": "GET,POST,PUT,DELETE,OPTIONS" }
      ]
    }
  ]
}
```

**Functions** — API route configuration:
```json
{
  "functions": {
    "api/**/*.js": {
      "runtime": "nodejs20.x",
      "maxDuration": 30
    }
  }
}
```

### 5. vite.config.js configuration
Three build modes controlled by the `TARGET` env var:

```bash
npm run build          # TARGET=app (default) — full SPA
TARGET=lib npm run build   # library (web component)
npm run build:artifact     # Claude artifact bundle
```

Key Vite config options:
- `input` — multi-page HTML entry points
- `define` — replaces `__VERSION__` etc. at build time
- `plugins` — VitePWA for service worker

### 6. cors.json
Controls which origins can access the API:
```json
{
  "allowedOrigins": ["https://yourdomain.com", "https://app.yourdomain.com"],
  "allowedMethods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  "allowedHeaders": ["Content-Type", "Authorization"],
  "maxAge": 86400
}
```

For open embeds (public platform): set `allowedOrigins: ["*"]`.

### 7. .mcp.json (MCP server)
Configures the MCP server for Claude Code integration:
```json
{
  "mcpServers": {
    "3dagent": {
      "command": "node",
      "args": ["api/mcp.js"],
      "env": {
        "3DAGENT_URL": "http://localhost:5173"
      }
    }
  }
}
```

Claude Code auto-discovers this file in the project root.

### 8. Recommended production configuration checklist
- [ ] `JWT_SECRET` is 64 hex chars (256 bits), generated randomly
- [ ] `DATABASE_URL` uses SSL (`?sslmode=require`)
- [ ] Upstash Redis configured (rate limiting active)
- [ ] `SIWE_DOMAIN` matches your production domain exactly
- [ ] S3 bucket has CORS policy applied (`cors.json`)
- [ ] Vercel environment variables set for production (not just preview)
- [ ] `NEXT_PUBLIC_BASE_URL` set to production domain
- [ ] No development secrets committed to git

## Tone
Reference documentation. Every variable gets its own entry with all the information needed to set it up. The production checklist is a useful addition for self-hosters.

## Files to read for accuracy
- `/.env.example` — read fully, this is the primary source
- `/vercel.json` — routing and headers config
- `/vite.config.js` — build configuration
- `/cors.json` — CORS policy
- `/.mcp.json` — MCP config
- `/docs/SETUP.md`
- `/docs/DEPLOYMENT.md`
