# Custom Skill with Database and Auth

By the end of this tutorial you have a production-grade skill that reads from a real Postgres database, authenticates the caller, rate-limits both the agent and the end-user, and audits every lookup. The example we'll build is a CRM-enrichment skill: the agent gets handed a customer email by the visitor and returns the matching CRM record — but only if the agent's operator is allowed to access that record, the visitor isn't drilling through your customer list, and the lookup is logged for compliance.

This is the path from the "fetch a weather API" toy in [custom-skill](/tutorials/custom-skill) to something a real company can ship. The mechanics are mostly the same — the difference is everything around the call: auth, audit, rate limits, data shape, denial flows.

**What you'll build:**

- A Postgres-backed CRM lookup table with a real schema and indexes
- A skill manifest with a strict input schema and a clear behavioral contract
- A Vercel function that accepts a customer email, looks up the CRM row, and returns enriched data
- Per-skill HMAC signing so only the agent runtime can call your endpoint
- Rate-limiting keyed by agent ID and by end-user identifier
- An audit log row per lookup with the agent, the actor, the lookup target, and the result code
- Structured data the LLM can recite naturally
- Denial flows that don't leak data when the customer isn't found

**Prerequisites:**

- Worked through [custom-skill](/tutorials/custom-skill) and have a working four-file skill bundle deployed to a public HTTPS URL
- Node.js 24.x, `npm`, and a Vercel account (the function lives on Vercel; the skill bundle can live anywhere)
- A Postgres database. Neon (`https://neon.tech`), Vercel Postgres, or Supabase all work. ~$0/month for the free tiers and ~$20/month once you have real traffic
- Upstash Redis for rate-limiting (`https://upstash.com`). Free tier handles millions of requests/day
- One real customer email you control, to seed test data with
- An understanding that **you are now building a system that holds customer data**. Read your jurisdiction's data-protection rules. Many of the decisions in this tutorial are downstream of GDPR/CCPA-style obligations

---

## Step 1 — The data shape

We're building a CRM lookup. A CRM row in a typical SaaS company has the same broad shape regardless of vendor — name, email, company, plan, account manager, lifecycle stage, last activity. The agent's value is in **stitching that data into conversation**: when a visitor types "is John Smith from Acme on our enterprise plan yet?", the agent should be able to answer with specifics from your actual CRM.

Schema:

```sql
-- migrations/001_crm.sql
CREATE TABLE IF NOT EXISTS crm_customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           CITEXT NOT NULL,
  full_name       TEXT NOT NULL,
  company         TEXT,
  plan            TEXT CHECK (plan IN ('free', 'pro', 'team', 'enterprise')),
  account_manager TEXT,
  lifecycle_stage TEXT CHECK (lifecycle_stage IN ('lead', 'trial', 'customer', 'churned')),
  mrr_usd_cents   INTEGER DEFAULT 0,
  signed_up_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at  TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX crm_customers_email_idx ON crm_customers (email);
CREATE INDEX crm_customers_company_idx ON crm_customers (company);

-- Access policy table: which agent operators are allowed to query which records?
-- We default to "operator can access records they own" — the operator wallet
-- is the rowner.
CREATE TABLE IF NOT EXISTS crm_access (
  customer_id   UUID NOT NULL REFERENCES crm_customers(id) ON DELETE CASCADE,
  operator_id   TEXT NOT NULL,
  granted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (customer_id, operator_id)
);

-- Audit log — every lookup, success or denial.
CREATE TABLE IF NOT EXISTS crm_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  agent_id     TEXT NOT NULL,
  operator_id  TEXT,
  end_user_id  TEXT,           -- visitor identifier if available
  ip           INET,
  email_query  CITEXT NOT NULL,
  result       TEXT NOT NULL CHECK (result IN ('found', 'not_found', 'denied', 'rate_limited', 'invalid')),
  duration_ms  INTEGER
);

CREATE INDEX crm_audit_log_ts_idx ON crm_audit_log (ts DESC);
CREATE INDEX crm_audit_log_agent_idx ON crm_audit_log (agent_id, ts DESC);
```

Two things worth pointing out:

- **`CITEXT` for email.** Case-insensitive collation. Emails are case-insensitive by RFC; treating them as case-sensitive opens you up to duplicate rows and missed lookups.
- **`crm_access` is the authorization layer.** The operator who owns the row (or who's been granted access to it) can look it up. Anyone else can't. This separation lets you grant access to multiple operators per customer without duplicating the row.

Apply the schema:

```bash
psql "$DATABASE_URL" -f migrations/001_crm.sql
```

Seed a test row:

```sql
INSERT INTO crm_customers (email, full_name, company, plan, account_manager, lifecycle_stage, mrr_usd_cents, last_active_at, notes)
VALUES (
  'test@example.com',
  'Test Customer',
  'Acme Inc.',
  'team',
  'Jordan Reyes',
  'customer',
  79900,
  NOW() - INTERVAL '2 days',
  'Migrated from Free in March 2026. Renewal in October.'
);

INSERT INTO crm_access (customer_id, operator_id)
SELECT id, '0xYourWalletOperatorId' FROM crm_customers WHERE email = 'test@example.com';
```

Replace `0xYourWalletOperatorId` with the wallet address that owns your agent.

---

## Step 2 — The skill bundle

Same four-file shape as [custom-skill](/tutorials/custom-skill). The interesting bits are the input schema and the SKILL.md behavioral contract.

`manifest.json`:

```json
{
  "spec": "skill/0.1",
  "name": "crm-lookup",
  "version": "1.0.0",
  "description": "Look up a customer in our CRM by email. Operator-scoped, rate-limited, audited.",
  "author": "0xYourWalletOperatorId",
  "license": "Proprietary",
  "tags": ["crm", "sales", "internal"],
  "requires": { "rig": ["any"], "runtime": ">=0.1.0" },
  "provides": { "tools": ["lookup_customer"], "triggers": ["customer-lookup"] },
  "trust_policy": "owned-only"
}
```

The `trust_policy: "owned-only"` is important: this skill must only run inside an agent whose owner matches the `author` field. Otherwise a third party could load your skill bundle into their own agent and try to query your CRM. The skill runtime enforces this at load time (see `api/_lib/skill-access.js` in the platform for the enforcement code).

`SKILL.md`:

```markdown
---
name: crm-lookup
description: Look up a customer in our CRM by email.
triggers:
  - customer-lookup
  - account-info
cost: medium
private: true
---

# CRM Lookup Skill

You have access to the company CRM. Use `lookup_customer` when the visitor mentions a specific person or company and wants to know about their account, plan, or history.

When you call `lookup_customer`:

- Pass the customer's email if the visitor provided one.
- The tool returns either a structured record (when found and authorized) or a denial reason.
- If the record is found, speak naturally: name, company, plan, account manager. Do not recite the raw JSON.
- If the record is not found, say "I don't have a record for that email" — do not speculate, do not invent details.
- If the lookup is denied (operator-not-authorized, rate-limited, invalid query), say "I'm not able to look that up right now" without elaborating why. Don't leak the reason.
- Never volunteer CRM data the visitor didn't ask about. If they ask "what's John's plan?", answer that — don't also recite MRR, account manager, signup date.

Privacy rule: this is internal customer data. Anyone the visitor doesn't have a clear reason to know about, refuse to look up. If the visitor asks for "all customers on the enterprise plan" or "everyone Jordan manages," refuse with "I can only look up individual customers, one at a time."
```

The `private: true` frontmatter flag signals the runtime that this skill should not be advertised in the skill marketplace and should not show up in any public "what can this agent do" discovery surface.

The behavioral contract is doing a lot of work. The data privacy rules in plain language are stronger than any technical control — because the model is the surface where it gets recited, and the model will leak whatever you ask it to.

`tools.json`:

```json
{
  "tools": [
    {
      "name": "lookup_customer",
      "description": "Look up a single customer in the CRM by email address. Returns plan, company, account manager, and lifecycle stage if found and authorized. Use when the visitor asks about a specific customer's account.",
      "input_schema": {
        "type": "object",
        "properties": {
          "email": {
            "type": "string",
            "format": "email",
            "description": "Email address of the customer to look up. Must be a single email, exactly as the visitor provided it."
          }
        },
        "required": ["email"]
      }
    }
  ]
}
```

One required field, strict format. The LLM should not invent emails it wasn't given.

`handlers.js`:

```js
const ENDPOINT = 'https://crm-lookup.<your-domain>/api/lookup';

export async function lookup_customer({ email }, ctx) {
  const safe = String(email || '').trim();
  if (!safe || safe.length > 254) {
    return { ok: false, reason: 'invalid', message: 'email is required and must be valid' };
  }

  // ctx.signedRequest produces a Bearer-style HMAC header proving the runtime
  // (not arbitrary user code) is making the call. The agent's operator wallet
  // and skill identity are signed into the token. The endpoint verifies.
  const res = await ctx.fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: await ctx.signedRequest({
        skill: 'crm-lookup',
        action: 'lookup',
        target: safe,
      }),
    },
    body: JSON.stringify({ email: safe }),
  });

  if (res.status === 429) return { ok: false, reason: 'rate_limited' };
  if (res.status === 403) return { ok: false, reason: 'denied' };
  if (res.status === 404) return { ok: false, reason: 'not_found' };
  if (!res.ok) return { ok: false, reason: 'error', message: `service ${res.status}` };

  const data = await res.json();
  return { ok: true, customer: data };
}
```

`ctx.signedRequest` is the skill runtime's API for getting a server-verifiable bearer token tied to (agent ID, skill name, operator wallet, timestamp). It returns a string like `Bearer <base64payload>.<signature>`. The endpoint (next section) verifies the signature with an HMAC key that the skill bundle and the endpoint both share via env vars.

If your runtime version doesn't expose `ctx.signedRequest`, the alternative is to embed a per-skill API key in env via the agent operator's settings UI and pass it as the `Authorization` header. The HMAC route is safer because the secret never reaches the agent's manifest URL.

---

## Step 3 — The Vercel function

Create `api/lookup.js` in a new Vercel project. This is the endpoint the skill calls.

Install deps:

```bash
npm init -y
npm pkg set type="module"
npm install pg @upstash/redis @upstash/ratelimit
```

```js
// api/lookup.js
import { Pool } from 'pg';
import { Redis } from '@upstash/redis';
import { Ratelimit } from '@upstash/ratelimit';
import crypto from 'node:crypto';

const HMAC_SECRET = process.env.SKILL_HMAC_SECRET;
const SKILL_NAME = 'crm-lookup';
const DATABASE_URL = process.env.DATABASE_URL;

if (!HMAC_SECRET) throw new Error('SKILL_HMAC_SECRET required');
if (!DATABASE_URL) throw new Error('DATABASE_URL required');

const pool = new Pool({ connectionString: DATABASE_URL, max: 5 });
const redis = Redis.fromEnv();

// 60 lookups per minute per agent; 10 per minute per end-user.
const rlAgent = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '60 s'),
  prefix: 'rl:crm:agent',
});
const rlUser = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  prefix: 'rl:crm:user',
});

function unauthorized(res, msg) {
  res.status(401).json({ error: msg });
}

function denied(res) {
  // Generic 403 — don't leak which condition failed.
  res.status(403).json({ error: 'denied' });
}

function verifyToken(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  const [payloadB64, sig] = token.split('.');
  if (!payloadB64 || !sig) return null;
  const expected = crypto
    .createHmac('sha256', HMAC_SECRET)
    .update(payloadB64)
    .digest('base64url');
  // Timing-safe compare.
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  // Token must be fresh (5 minutes).
  if (Math.abs(Date.now() - payload.iat) > 5 * 60 * 1000) return null;
  if (payload.skill !== SKILL_NAME) return null;
  if (!payload.agent_id || !payload.operator_id) return null;
  return payload;
}

async function audit(row) {
  try {
    await pool.query(
      `INSERT INTO crm_audit_log (agent_id, operator_id, end_user_id, ip, email_query, result, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        row.agent_id,
        row.operator_id,
        row.end_user_id,
        row.ip,
        row.email_query,
        row.result,
        row.duration_ms,
      ],
    );
  } catch (err) {
    // Never let an audit failure break the user-facing request — but log it loudly.
    console.error('audit write failed', err);
  }
}

export default async function handler(req, res) {
  const started = Date.now();
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'authorization,content-type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    return res.status(405).json({ error: 'method not allowed' });
  }

  const token = verifyToken(req.headers.authorization);
  if (!token) return unauthorized(res, 'invalid token');

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || null;
  const endUserId = req.headers['x-end-user-id'] || null;
  const agentId = token.agent_id;
  const operatorId = token.operator_id;

  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();

  if (!email || email.length > 254 || !email.includes('@')) {
    await audit({
      agent_id: agentId, operator_id: operatorId, end_user_id: endUserId,
      ip, email_query: email, result: 'invalid', duration_ms: Date.now() - started,
    });
    return res.status(400).json({ error: 'invalid email' });
  }

  // Rate-limit per agent first (cheap, most-likely-to-trigger).
  const agentRl = await rlAgent.limit(agentId);
  if (!agentRl.success) {
    await audit({
      agent_id: agentId, operator_id: operatorId, end_user_id: endUserId,
      ip, email_query: email, result: 'rate_limited', duration_ms: Date.now() - started,
    });
    res.setHeader('retry-after', Math.ceil((agentRl.reset - Date.now()) / 1000));
    return res.status(429).json({ error: 'rate limited' });
  }
  if (endUserId) {
    const userRl = await rlUser.limit(endUserId);
    if (!userRl.success) {
      await audit({
        agent_id: agentId, operator_id: operatorId, end_user_id: endUserId,
        ip, email_query: email, result: 'rate_limited', duration_ms: Date.now() - started,
      });
      res.setHeader('retry-after', Math.ceil((userRl.reset - Date.now()) / 1000));
      return res.status(429).json({ error: 'rate limited' });
    }
  }

  // The actual query. Operator scoping happens via a JOIN against crm_access —
  // we only return the row if (a) it exists, and (b) the caller's operator is
  // authorized for it. Both "not found" and "not authorized" produce 404 on the
  // wire so unauthorized callers can't probe to see which emails exist.
  const sql = `
    SELECT c.id, c.email, c.full_name, c.company, c.plan, c.account_manager,
           c.lifecycle_stage, c.mrr_usd_cents, c.signed_up_at, c.last_active_at, c.notes
    FROM crm_customers c
    JOIN crm_access a ON a.customer_id = c.id
    WHERE c.email = $1 AND a.operator_id = $2
    LIMIT 1;
  `;
  const r = await pool.query(sql, [email, operatorId]);
  if (r.rows.length === 0) {
    await audit({
      agent_id: agentId, operator_id: operatorId, end_user_id: endUserId,
      ip, email_query: email, result: 'not_found', duration_ms: Date.now() - started,
    });
    return res.status(404).json({ error: 'not_found' });
  }

  const row = r.rows[0];
  await audit({
    agent_id: agentId, operator_id: operatorId, end_user_id: endUserId,
    ip, email_query: email, result: 'found', duration_ms: Date.now() - started,
  });

  // Project to a clean, LLM-friendly shape. Note we round MRR to dollars and
  // drop the internal `id` — the LLM doesn't need primary keys.
  return res.status(200).json({
    email: row.email,
    name: row.full_name,
    company: row.company,
    plan: row.plan,
    account_manager: row.account_manager,
    lifecycle_stage: row.lifecycle_stage,
    mrr_usd: Math.round(row.mrr_usd_cents / 100),
    signed_up: row.signed_up_at?.toISOString().slice(0, 10),
    last_active: row.last_active_at?.toISOString().slice(0, 10),
    notes: row.notes,
  });
}
```

Deploy:

```bash
vercel link
vercel env add DATABASE_URL production
vercel env add SKILL_HMAC_SECRET production       # generate: openssl rand -hex 32
vercel env add UPSTASH_REDIS_REST_URL production
vercel env add UPSTASH_REDIS_REST_TOKEN production
vercel --prod
```

Note `vercel.json` in this project should set `functions.api/**/*.js.maxDuration` to at least 10 — the audit insert plus the SELECT plus the rate-limit round trip together can take a second or two on cold start.

---

## Step 4 — The HMAC dance, in detail

Step 3's `verifyToken` is the security boundary. Three things it enforces:

**Signature integrity.** The token is `<base64url(JSON payload)>.<HMAC-SHA256 of that base64>`. The HMAC key is shared between the agent runtime and the endpoint. Anyone without the key can't forge tokens. `crypto.timingSafeEqual` defends against timing-side-channel attacks on the comparison.

**Freshness.** `Math.abs(Date.now() - payload.iat) > 5 * 60 * 1000` enforces a 5-minute freshness window. An attacker who steals one token can only replay it for 5 minutes. The window is short enough to limit replay damage, long enough to tolerate clock skew on either side.

**Identity binding.** `payload.skill === SKILL_NAME` rejects tokens minted for a different skill. `payload.agent_id` and `payload.operator_id` are present and used downstream for scoping. The agent's runtime fills these from the runtime context — the skill code itself can't lie about which agent it's running inside.

The shared HMAC secret has to live in three places: the skill runtime (where `ctx.signedRequest` mints tokens), the agent's operator settings (where the operator pastes the secret so their runtime can sign for their skill), and your endpoint env vars. Rotate it on a schedule. Document the rotation procedure now, before you forget.

---

## Step 5 — Test the happy path

In a terminal, mint a token manually and call the endpoint:

```bash
SECRET='<your-hmac-secret>'
PAYLOAD=$(printf '%s' '{"skill":"crm-lookup","agent_id":"agent-test","operator_id":"0xYourWalletOperatorId","iat":'"$(date +%s)000"'}' | base64 -w0 | tr '+/' '-_' | tr -d '=')
SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$SECRET" -binary | base64 -w0 | tr '+/' '-_' | tr -d '=')
curl -X POST https://crm-lookup.<your-domain>/api/lookup \
  -H "authorization: Bearer $PAYLOAD.$SIG" \
  -H 'content-type: application/json' \
  -d '{"email":"test@example.com"}'
```

Expected output:

```json
{"email":"test@example.com","name":"Test Customer","company":"Acme Inc.","plan":"team","account_manager":"Jordan Reyes","lifecycle_stage":"customer","mrr_usd":799,"signed_up":"2026-05-12","last_active":"2026-05-12","notes":"Migrated from Free in March 2026. Renewal in October."}
```

Now load the skill into your agent (the skill bundle from Step 2, hosted at any HTTPS URL — see [custom-skill](/tutorials/custom-skill) for hosting options). Ask: "what plan is test@example.com on?" The agent should call the tool and respond with something like:

> "test@example.com — Test Customer at Acme — is on the team plan, managed by Jordan Reyes."

Confirm the audit log was written:

```sql
SELECT ts, agent_id, email_query, result, duration_ms
FROM crm_audit_log
ORDER BY ts DESC LIMIT 5;
```

You should see a `found` row for the lookup you just did.

---

## Step 6 — Test the denial paths

A skill that handles real customer data lives or dies by its denial paths. Walk through each:

**Not found.** Ask the agent about an email that doesn't exist. Expected: the agent says "I don't have a record for that email" without speculating. The audit log shows a `not_found` row.

**Not authorized.** Insert a row but don't grant `crm_access` to your operator. Ask the agent to look it up. The endpoint returns 404 (intentionally indistinguishable from "not found" on the wire — see Step 3's comment on probing). The audit log shows a `not_found` row, because from the operator's perspective the row may as well not exist.

**Invalid input.** Ask the agent "look up `xxx`" — no `@` in the input. The skill's handler short-circuits with `reason: 'invalid'`. The audit log shows an `invalid` row.

**Rate limited.** Trigger the limit. The easiest way is to script 80 lookups in 10 seconds against a single agent. The 61st onwards return 429. The audit log fills with `rate_limited` rows. The skill's handler returns `reason: 'rate_limited'` to the LLM, and the SKILL.md instructions kick in: the agent says "I'm not able to look that up right now."

**Tampered token.** Manually flip one bit in the signature, replay. The endpoint returns 401. The audit log does **not** write a row (the request was rejected before reaching the audit insert). This is intentional — the audit log is for authorized usage, not for failed auth attempts. Failed auth belongs in a separate WAF/logging layer.

Walk these four paths every time you change anything in the auth or rate-limit code. It's the only way to catch regressions before they ship.

---

## Step 7 — Build admin tooling

You now have audit logs. Build the admin surface that lets you read them:

```sql
-- Lookups per agent per day, last 7 days
SELECT date_trunc('day', ts)::date AS day,
       agent_id,
       count(*) FILTER (WHERE result = 'found') AS found,
       count(*) FILTER (WHERE result = 'not_found') AS not_found,
       count(*) FILTER (WHERE result = 'denied') AS denied,
       count(*) FILTER (WHERE result = 'rate_limited') AS rate_limited
FROM crm_audit_log
WHERE ts >= NOW() - INTERVAL '7 days'
GROUP BY day, agent_id
ORDER BY day DESC, agent_id;
```

```sql
-- Most-queried customers (potential phishing reconnaissance)
SELECT email_query, count(*) AS hits
FROM crm_audit_log
WHERE ts >= NOW() - INTERVAL '24 hours'
GROUP BY email_query
ORDER BY hits DESC
LIMIT 20;
```

```sql
-- Slowest lookups (find your bad indexes)
SELECT email_query, duration_ms
FROM crm_audit_log
WHERE result = 'found'
ORDER BY duration_ms DESC
LIMIT 20;
```

Run these as scheduled queries. The first one is your usage dashboard. The second is a security alert candidate — if one email shows up 200 times in a day across multiple visitors, you might be the entry point for a recon attack. The third is your performance dashboard.

For a richer admin UI, point Metabase or Grafana at the Postgres instance with a read-only role:

```sql
CREATE ROLE crm_admin_readonly LOGIN PASSWORD '<strong>';
GRANT SELECT ON crm_audit_log TO crm_admin_readonly;
GRANT SELECT ON crm_customers TO crm_admin_readonly;
```

---

## Step 8 — Schema migrations

Production CRM schemas change. The migration runner the platform uses is straightforward: a `migrations/` directory of timestamped SQL files, plus a tiny script that tracks which have been applied. Set this up now, before you have data you'd hate to lose.

```sql
-- migrations/000_meta.sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

```js
// scripts/migrate.js
import { Pool } from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const dir = path.resolve('./migrations');
const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)`);

const applied = new Set(
  (await pool.query('SELECT filename FROM schema_migrations')).rows.map((r) => r.filename),
);

for (const f of files) {
  if (applied.has(f)) continue;
  console.log(`applying ${f}`);
  const sql = await fs.readFile(path.join(dir, f), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [f]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`failed on ${f}:`, err.message);
    process.exit(1);
  } finally {
    client.release();
  }
}

console.log('migrations up to date');
await pool.end();
```

Run with `DATABASE_URL=... node scripts/migrate.js`. Add it to your deploy hook:

```json
{
  "scripts": {
    "build": "node scripts/migrate.js"
  }
}
```

Forward-only migrations are simpler than rollbacks and the right default. If you need to rollback, write a forward migration that reverses the prior one.

---

## Step 9 — Data retention and the audit log

Audit logs grow without bound. A skill at 1000 lookups/day produces 365k audit rows a year. The table stays small enough for SELECT performance, but compliance frameworks (GDPR, SOC2) often require explicit retention policies.

A reasonable default: 13 months. Drop anything older nightly:

```sql
DELETE FROM crm_audit_log WHERE ts < NOW() - INTERVAL '13 months';
```

Run via a cron job (Vercel cron, GitHub Actions on a schedule, Postgres pg_cron — pick one). Document the policy in your privacy notice.

For the `crm_customers` table itself, the rules are stricter. Customer-data retention is jurisdictional. The minimum control: implement a deletion endpoint that, given a customer email and operator authorization, cascades the row out of all tables. The `ON DELETE CASCADE` on `crm_access` already handles its half. Add an explicit purge for the audit log too if your privacy commitment requires it:

```sql
DELETE FROM crm_audit_log WHERE email_query = $1 AND ts >= NOW() - INTERVAL '13 months';
```

Don't delete audit rows just because the row they refer to was deleted — the audit log is the historical record. But honor "right to be forgotten" requests by hashing the email in old audit rows rather than dropping them entirely, so aggregate stats still work but the PII is gone.

---

## Step 10 — Performance

The query in Step 3 is one SELECT with one JOIN and two indexed lookups. On a small CRM (<100k customers), it returns in single-digit milliseconds. On a larger one, watch the EXPLAIN plan as access patterns evolve:

```sql
EXPLAIN ANALYZE
SELECT c.id FROM crm_customers c
JOIN crm_access a ON a.customer_id = c.id
WHERE c.email = 'test@example.com' AND a.operator_id = '0xYourWalletOperatorId';
```

The plan should show two index scans and a nested loop. If you see a sequential scan, an index is missing (likely on `crm_access(operator_id)`):

```sql
CREATE INDEX IF NOT EXISTS crm_access_operator_idx ON crm_access (operator_id);
```

The audit log insert is the second-most-frequent operation. It's not indexed for fast inserts (the BIGSERIAL primary key is enough), but the `ts DESC` and `(agent_id, ts DESC)` indexes from Step 1 are required for reads. Without them, dashboard queries get slow fast.

Connection pooling: `new Pool({ max: 5 })` is right for serverless. Going higher exhausts connection slots on shared Postgres tiers (Neon free tier is 100 connections total). Use a pgBouncer-style external pooler (Neon and Supabase both provide one out of the box at a separate hostname) for hot endpoints.

---

## Step 11 — Operating in the wild

Once this is in production, the operational reality:

**Customer signs up at 2am.** The CRM row is created in your main backend. You need a `crm_access` insert to grant the operator (whoever owns the account) access to that customer. If you forget to insert the access row, the lookup fails silently for the operator. Build the access grant into the same transaction as the customer creation.

**Agent operator leaves.** Revoke their access by deleting their `crm_access` rows. Their agent will continue to run, but lookups will return 404. Their audit log entries are preserved — you can prove what they did and when they stopped having access.

**LLM tries to recite the entire CRM.** The behavioral contract in SKILL.md says "look up one at a time, refuse bulk requests." The runtime can't enforce this — the LLM might still try. Add a defense in depth: at the endpoint, reject any payload other than a single `email` string. If the model tries to send `{"emails": [...]}`, you 400. Belt and suspenders.

**Visitor asks "do you have a Sarah?".** The LLM has no email — what does it do? Without an email it can't call the tool (the input schema requires `email`). It should say "I need an email to look up an account." That's the right answer. Don't add a "search by name" tool unless you accept the privacy implications of letting visitors brute-force your customer list.

**Endpoint goes down.** The skill returns `reason: 'error'`. The agent says "I can't reach the CRM right now." This is the correct degradation — better than fabricating an answer. Make sure your monitoring covers the endpoint with health checks; the agent's failure to look up customers should page someone.

---

## Step 12 — Pre-production checklist

Before this skill faces a real visitor:

- All migrations applied. `SELECT * FROM schema_migrations` matches the `migrations/` directory.
- Rate limits dialed in to numbers you can defend. Default 60/min per agent and 10/min per end-user is sensible; adjust by use case.
- HMAC secret is high-entropy (`openssl rand -hex 32`), set in Vercel, set in the agent's operator settings, never committed.
- Audit table indexes verified (`\d+ crm_audit_log`).
- Audit log retention job scheduled.
- Right-to-be-forgotten flow tested end-to-end.
- The SKILL.md behavioral contract has been read by someone who isn't you, and they agree it's clear about what to do in denial cases.
- A test agent has been put through all five denial paths in Step 6 and behaved correctly.
- A monitoring alert fires on a 5xx rate above 1% over 10 minutes from `/api/lookup`.
- A second alert fires on `count(*) FILTER (WHERE result = 'denied')` going non-zero — this is a sign of either misconfigured access grants or someone probing.
- The `private: true` flag on the skill is respected by your runtime — the skill should not appear in any public listing.
- The fact that this skill exists is documented in your privacy notice, including the data it sees and the retention period.

---

## What you learned

- A Postgres schema for a real CRM with operator-scoped access and a separate audit log
- The skill bundle shape for production: strict input schema, behavioral privacy contract in SKILL.md, signed-request handler
- An HMAC-signed bearer-token pattern that authenticates the agent runtime (not arbitrary skill code)
- Rate-limiting at two levels (per agent, per end-user) with Upstash Redis
- Denial flows that don't leak information about whether a record exists
- Operational concerns: schema migrations, audit retention, performance, right-to-be-forgotten

## Next steps

- Combine this skill with a paid x402 endpoint so external agents can pay to query (a portion of) your CRM — [paid-x402-endpoint](/tutorials/paid-x402-endpoint)
- Expose the agent that owns this skill as an MCP server so internal tools can use it — [mcp-server-for-your-agent](/tutorials/mcp-server-for-your-agent)
- Self-host the whole stack so the data residency story is fully your own — [self-host-agent-backend](/tutorials/self-host-agent-backend)
- Warm up with the simpler version if you skipped ahead — [custom-skill](/tutorials/custom-skill)
