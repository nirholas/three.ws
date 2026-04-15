# Backend Setup

This project ships a full self-hostable backend on Vercel:
Neon (Postgres) · Cloudflare R2 (storage) · Upstash Redis (rate limits).

## 1. Prerequisites

- A Vercel project linked to this repo.
- A Neon project (free tier works for early traffic).
- A Cloudflare R2 bucket (`3d-agent-avatars` or your own) with a public custom
  domain (e.g. `cdn.3d.irish`) for zero-egress public delivery.
- (Optional but recommended) An Upstash Redis database for distributed rate
  limiting. Without it, rate limits fall back to in-memory per-instance.

## 2. Environment variables

Copy [.env.example](../.env.example) and fill in:

```bash
cp .env.example .env.local
```

Then add the same variables to your Vercel project (both Preview and
Production). `JWT_SECRET` must be a long random string — generate with:

```bash
openssl rand -base64 64
```

## 3. Database schema

Apply the migration:

```bash
psql "$DATABASE_URL" -f api/_lib/schema.sql
```

The file is idempotent; re-running it is safe.

## 4. R2 CORS

Apply the project's `cors.json` to your R2 bucket (replace the bucket name):

```bash
aws s3api put-bucket-cors \
  --bucket 3d-agent-avatars \
  --cors-configuration file://cors.json \
  --endpoint-url https://<account-id>.r2.cloudflarestorage.com
```

At minimum, `claude.ai` and `https://3dagent.vercel.app` must be allowed origins for GET
so the MCP `render_avatar` artifact can fetch the GLBs.

## 5. Deploy

```bash
npm run deploy
```

## 6. Verify

- Authorization server metadata: `https://3dagent.vercel.app/.well-known/oauth-authorization-server`
- MCP endpoint: `POST https://3dagent.vercel.app/api/mcp` with
  `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` and a bearer API key.

## Scaling notes

- **Storage:** R2 charges no egress. Even with a viral spike, your only cost is
  storage + requests, both cheap.
- **Database:** Neon autoscales; for very high traffic, switch `sql` to the
  pooled connection string or consider branching for heavy tenants.
- **Rate limits:** Defaults in [api/_lib/rate-limit.js](../api/_lib/rate-limit.js) —
  tune once real traffic patterns emerge. Per-plan daily caps are enforced from
  the `plan_quotas` table.
- **Observability:** Every tool call writes to `usage_events`. Build dashboards
  directly in SQL or stream to your analytics tool.
- **Keys & secrets:** `JWT_SECRET` should be rotated via a key set — add a new
  kid, wait for old tokens to expire, then remove the old one. Refresh tokens
  and API keys are stored hashed (SHA-256).
