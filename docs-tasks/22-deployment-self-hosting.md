# Agent Task: Write "Deployment & Self-Hosting" Documentation

## Output file
`public/docs/deployment.md`

## Target audience
Developers and organizations who want to self-host the three.ws platform — either for privacy, compliance, customization, or cost control. Assumes comfort with Vercel/cloud deployment and environment variables.

## Word count
2000–3000 words

## What this document must cover

### 1. Deployment overview
three.ws is designed to deploy on Vercel but will work on any Node.js host that supports serverless functions. The platform consists of:
- **Frontend** — Vite-built multi-page SPA (static files)
- **API routes** — Node.js serverless functions (in `/api/`)
- **Database** — PostgreSQL (Neon DB recommended)
- **Cache/rate-limit** — Redis (Upstash recommended)
- **Object storage** — S3-compatible (AWS S3, Cloudflare R2, MinIO)
- **IPFS** — Pinata, Filebase, or Web3.Storage (optional)

### 2. One-click Vercel deploy
The fastest path:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=...)

Click → connect GitHub → fill in env vars → deploy. Platform goes live in ~3 minutes.

After deploy: add your domain, configure DNS, set up database.

### 3. Required environment variables
Document every env var in `.env.example`:

**Core:**
```env
# Database (PostgreSQL)
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Redis
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=xxx

# Session
JWT_SECRET=your-256-bit-secret  # generate: openssl rand -hex 32

# Domain
NEXT_PUBLIC_BASE_URL=https://yourdomain.com
VERCEL_URL=yourdomain.com
```

**LLM (for agent conversations):**
```env
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

**Storage (for GLB/asset uploads):**
```env
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx
AWS_REGION=us-east-1
AWS_S3_BUCKET=your-bucket-name
```

**TTS (optional — higher quality voice):**
```env
ELEVENLABS_API_KEY=xxx
```

**Wallet auth:**
```env
SIWE_DOMAIN=yourdomain.com
```

**Privy (optional — social login):**
```env
PRIVY_APP_ID=xxx
PRIVY_APP_SECRET=xxx
```

**IPFS (optional — for decentralized memory/assets):**
```env
PINATA_JWT=xxx
# or
FILEBASE_KEY=xxx
FILEBASE_SECRET=xxx
# or
WEB3_STORAGE_TOKEN=xxx
```

**Blockchain (optional — for ERC-8004):**
```env
ALCHEMY_API_KEY=xxx  # for RPC access
INFURA_API_KEY=xxx   # alternative
```

### 4. Database setup

**Create a Neon DB database:**
1. Go to neon.tech → New Project
2. Copy the connection string
3. Set as `DATABASE_URL`

**Run migrations:**
```bash
# Apply schema
node scripts/apply-schema.mjs

# Apply indexer schema (for on-chain data)
node scripts/apply-indexer-schema.js

# Apply delegation schema (for ERC-7710)
node scripts/apply-delegations-schema.js
```

**Schema overview:**
- `agents` table — agent metadata, manifest CID, owner address
- `widgets` table — widget configs, visibility, embed URLs
- `users` table — user accounts, wallet addresses
- `api_keys` table — API key hashes and scopes
- `agent_actions` table — agent activity log
- `delegations` table — ERC-7710 permission grants

### 5. S3 storage setup
three.ws stores GLB files and generated thumbnails in S3:

```bash
# Create bucket
aws s3 mb s3://your-bucket-name

# Set CORS policy
aws s3api put-bucket-cors --bucket your-bucket-name --cors-configuration file://cors.json
```

The `/cors.json` file in the repo has the required CORS policy.

Alternatively, use Cloudflare R2 (S3-compatible, cheaper egress):
- Create an R2 bucket in the Cloudflare dashboard
- Use the R2 endpoint URL as `AWS_S3_ENDPOINT` (set in env)
- R2 is S3-compatible — same SDK, different endpoint

### 6. Redis setup
Upstash Redis is used for:
- Rate limiting (per-IP, per-user)
- Session caching
- IPFS pin status caching

```bash
# Create Upstash Redis database at upstash.com
# Copy REST URL and token to env vars
```

Local development: use a local Redis instance or skip (rate limiting degrades gracefully without Redis).

### 7. Local development
```bash
git clone https://github.com/3dagent/3dagent
cd 3dagent
npm install

# Copy example env
cp .env.example .env.local
# Edit .env.local — minimum: DATABASE_URL, JWT_SECRET, ANTHROPIC_API_KEY

# Start dev server
npm run dev
# App: http://localhost:5173
# API: http://localhost:5173/api/*
```

For testing without a database, use the `null-dev` memory provider and skip `DATABASE_URL` — most features still work (no persistence).

### 8. Building for production
```bash
# Build the full app
npm run build
# Output: dist/

# Build the library (CDN-distributable web component)
TARGET=lib npm run build
# Output: dist-lib/

# Build the Claude artifact bundle
npm run build:artifact
# Output: dist-artifact/
```

The Vite config (`vite.config.js`) handles multi-page routing, PWA manifest, and asset hashing.

### 9. Vercel configuration
The `vercel.json` file configures:
- **Rewrites** — route `/a/*`, `/agent/*`, `/docs/*` to the right HTML entry points
- **Headers** — CORS, cache-control for static assets
- **Functions** — API routes as serverless functions (Node.js 20)
- **Regions** — edge regions for low latency

Key rewrites to understand:
```json
{ "source": "/a/:chainId/:agentId", "destination": "/a-embed.html" }
{ "source": "/agent/:id/edit", "destination": "/agent-edit.html" }
{ "source": "/docs/:path*", "destination": "/index.html" }
```

### 10. Custom domain + HTTPS
On Vercel: Settings → Domains → Add Domain. HTTPS is automatic (Let's Encrypt).

After adding domain:
- Update `NEXT_PUBLIC_BASE_URL` to your domain
- Update `SIWE_DOMAIN` to match
- Update CORS settings if using the CDN separately

### 11. Deploying the smart contracts
To run your own ERC-8004 registry:

```bash
cd contracts

# Install Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Deploy to Base Sepolia (testnet)
forge script script/Deploy.s.sol \
  --rpc-url https://sepolia.base.org \
  --private-key $PRIVATE_KEY \
  --broadcast

# Update REGISTRY_DEPLOYMENTS in src/erc8004/abi.js with new addresses
```

### 12. Monitoring and observability
- **Vercel Analytics** — built-in for Vercel deployments (enable in settings)
- **Error tracking** — add Sentry: `SENTRY_DSN` env var
- **Logs** — `vercel logs` CLI or dashboard
- **Database monitoring** — Neon has built-in query monitoring

### 13. PWA configuration
The app is a Progressive Web App. The service worker caches:
- Static assets (fonts, images)
- Model viewer JS
- GLB files visited recently

PWA manifest generated by `vite-plugin-pwa`. Icons generated by `scripts/generate-pwa-icons.mjs`.

### 14. Smoke tests
After deploying, run the smoke test checklist:
- Load the app and view a model
- Connect wallet
- Create an agent
- Publish a widget
- Test the embed code

Full smoke test script in `/docs/SMOKE_TEST.md`.

## Tone
Step-by-step guide. Every command should work copy-paste. Include the "why" for non-obvious steps (e.g., why Redis is optional). Link to relevant files in the repo.

## Files to read for accuracy
- `/docs/DEPLOYMENT.md`
- `/docs/SETUP.md`
- `/docs/DEVELOPMENT.md`
- `/.env.example`
- `/vercel.json`
- `/vite.config.js`
- `/cors.json`
- `/scripts/apply-schema.mjs`
- `/scripts/apply-indexer-schema.js`
- `/scripts/apply-delegations-schema.js`
- `/scripts/migrations/add-avatar-versions.sql`
- `/docs/SMOKE_TEST.md`
- `/contracts/` — Foundry project
