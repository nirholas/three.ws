# Fix: Missing / Unset Environment Variables in Vercel Dashboard

## Confirmed Issue

Vercel logs show 500 errors from `api/_lib/env.js`'s `req()` helper throwing `Missing required env var: JWT_SECRET`. This means `JWT_SECRET` is not set in Vercel's production environment variables.

`JWT_SECRET` is used in:
- `api/_lib/auth.js` — JWT signing and CSRF token HMAC
- `api/_lib/agent-wallet.js` — AES-256-GCM wallet encryption key derivation
- `api/agents/_id/persona.js` — HMAC signing
- `api/auth/github/[action].js` and `api/auth/x/[action].js` — HKDF/AES token encryption

Any endpoint that touches auth or agent wallets fails if this is missing.

## What to set

Go to **Vercel Dashboard → Project → Settings → Environment Variables** and verify/add each of the following. Cross-reference with `.env.example` for the full required list.

### Critical — `req()` in `api/_lib/env.js` (throws 500 on first access if unset):

| Variable | Description | Where used |
|---|---|---|
| `JWT_SECRET` | Long random secret (32+ bytes, base64 or hex) — `openssl rand -base64 64` | Auth, agent wallet encryption, HMAC |
| `DATABASE_URL` | Neon Postgres connection string (`postgres://...`) | All DB queries via `api/_lib/db.js` |
| `S3_ENDPOINT` | S3-compatible endpoint (e.g. Cloudflare R2: `https://<account>.r2.cloudflarestorage.com`) | Avatar/file storage |
| `S3_ACCESS_KEY_ID` | S3 access key ID | Avatar/file storage |
| `S3_SECRET_ACCESS_KEY` | S3 secret access key | Avatar/file storage |
| `S3_BUCKET` | Bucket name (e.g. `3d-agent-avatars`) | Avatar/file storage |
| `S3_PUBLIC_DOMAIN` | Public CDN URL for the bucket (no trailing slash) | Avatar URL construction |
| `ANTHROPIC_API_KEY` | Anthropic API key (`sk-ant-...`) | Chat/LLM proxy endpoints |
| `AGENT_RELAYER_KEY` | Hex private key of the relayer EOA (`0x...`) | ERC-7710 delegation redeem |
| `VOYAGE_API_KEY` | VoyageAI API key | Agent text embedding endpoints |

### High (features broken if missing, but no hard throws):

| Variable | Description |
|---|---|
| `JWT_KID` | Key ID string for JWT `kid` header — defaults to `"k1"` if unset |
| `CRON_SECRET` | Shared secret for Vercel Cron `Authorization: Bearer` header — crons run unauthenticated if unset |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | Rate limiting — all endpoints fail open (no rate limiting) if unset |
| `SOLANA_RPC_URL` | Solana RPC — defaults to public mainnet endpoint if unset |
| `RPC_URL_84532` | Base Sepolia RPC — falls back to public `sepolia.base.org` if unset |

## Variable name note

The codebase uses **S3-compatible naming** (`S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, etc.), not R2-specific names. If you're using Cloudflare R2, the bucket credentials go into the `S3_*` variables — R2 exposes an S3-compatible API. Do not set `R2_ACCOUNT_ID` or similar; those are not read by the code.

## How to verify

After setting, redeploy, then check Vercel Function logs. Confirm `Missing required env var` errors are gone.

Run locally to check all required vars before deploying:
```bash
node -e "
const required = [
  'JWT_SECRET','DATABASE_URL',
  'S3_ENDPOINT','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_BUCKET','S3_PUBLIC_DOMAIN',
  'ANTHROPIC_API_KEY','AGENT_RELAYER_KEY','VOYAGE_API_KEY',
];
let ok = true;
required.forEach(k => { if (!process.env[k]) { console.error('MISSING:', k); ok = false; } });
if (ok) console.log('All required env vars present.');
"
```
