# Task 05 — Storage flags: track where an avatar's bytes actually live

## Why this exists

Today, [api/\_lib/schema.sql](../../api/_lib/schema.sql) `avatars.storage_key` tells us the file is in R2. That's it. Nothing tracks:

- Whether the same bytes are also pinned to IPFS (for permanence / portability).
- Whether the byte hash has been recorded on-chain (for attestation / tamper-evidence).
- Whether the owner _wants_ the avatar replicated outside our custody.

That means an agent described as "owned by 0xABCD on Base" is in reality a Postgres row with a link to R2 — if we vanish, the avatar vanishes. Fine for MVP, not fine for the on-chain / portable-embed stories.

This prompt adds the schema + UI + minimal plumbing to flip an avatar from R2-only to R2-plus-IPFS, and to record its content hash. Actual on-chain transactions are out of scope — this prompt just records the hash and surfaces the attestation state in the UI.

See [00-README.md](00-README.md) for the band-level design.

## What you're building

1. **Schema:** add a `storage_mode` JSONB column to the `avatars` table (idempotent ALTER, appended to the existing migration block).
2. **Helper:** `api/_lib/storage-mode.js` — `defaultStorageMode()`, `readStorageMode(avatarId)`, `validateStorageMode(input)`.
3. **Content hash capture:** extend the avatar-registration flow (the endpoint that runs after R2 upload) so `checksum_sha256` is always populated from the R2 object (`headObject` returns it today if the upload included it — see [api/\_lib/r2.js](../../api/_lib/r2.js)). If it isn't captured today, fetch the first N bytes and hash, or run a HEAD with `ChecksumMode: ENABLED` — **do not** re-download the whole GLB.
4. **API:** `GET/PUT /api/avatars/:id/storage-mode` — owner-only; mirrors the shape of the embed-policy endpoint.
5. **UI:** `public/dashboard/storage.html` — per-avatar storage settings, shows R2 state, lets the owner click "Pin to IPFS" (which calls a stubbed endpoint — see below), shows the on-chain attestation state read-only.
6. **Pin endpoint (stub):** `POST /api/avatars/:id/pin-ipfs` — owner-only. For this prompt, **stub** it: compute the hash, record a `storage_mode.ipfs_cid` placeholder (use a deterministic pseudo-CID like `stub:<sha256>` for now) and flip `pinned_ipfs: true`. Real Pinata / Web3.Storage wiring is a follow-up; call it out in the reporting block.

## The shape

```jsonc
// avatars.storage_mode JSONB
{
	"version": 1,
	"primary": "r2", // always "r2" for now; "ipfs" means "IPFS is authoritative"
	"r2": {
		"present": true,
		"key": "u/<userId>/<slug>/<ts>.glb", // echoes avatars.storage_key
	},
	"ipfs": {
		"pinned": false,
		"cid": null, // string once pinned
		"pinned_at": null, // ISO timestamp
	},
	"attestation": {
		"hash": null, // sha256 of the GLB bytes — always filled on avatar create going forward
		"chain_id": null,
		"tx_hash": null, // filled by a future on-chain attestation flow
		"attested_at": null,
	},
}
```

### Defaults (`defaultStorageMode(avatarRow)`)

```js
{
  version: 1,
  primary: 'r2',
  r2:          { present: true, key: avatarRow.storage_key ?? null },
  ipfs:        { pinned: false, cid: null, pinned_at: null },
  attestation: { hash: avatarRow.checksum_sha256 ?? null, chain_id: null, tx_hash: null, attested_at: null },
}
```

## Read first (in this order)

1. [00-README.md](00-README.md).
2. [api/\_lib/schema.sql](../../api/_lib/schema.sql) — find the `avatars` table block and its additive-migrations section. (If none exists below the CREATE TABLE, add one — match the pattern used for `agent_identities` at lines 260+.)
3. [api/avatars/index.js](../../api/avatars/index.js) — the avatar-registration endpoint (runs after R2 upload).
4. [api/\_lib/r2.js](../../api/_lib/r2.js) — focus on `headObject`; figure out how to read the object's MD5/sha256.
5. [api/\_lib/avatars.js](../../api/_lib/avatars.js) — helpers for avatar row reads.
6. [api/\_lib/http.js](../../api/_lib/http.js), [api/\_lib/db.js](../../api/_lib/db.js), [api/\_lib/auth.js](../../api/_lib/auth.js).
7. [api/CLAUDE.md](../../api/CLAUDE.md) — endpoint template.
8. [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html) — copy its structure for your new page (same sign-in flow, same fetch pattern, same styling).
9. [vercel.json](../../vercel.json) — for route wiring.

## What to change

### 1. Schema migration (idempotent, append)

Append to the additive-migrations block for `avatars` in [api/\_lib/schema.sql](../../api/_lib/schema.sql) (or create one immediately after the `create index` lines for `avatars`, matching the `agent_identities` pattern at lines 260–266):

```sql
-- Additive migrations for avatars columns added after initial deployment.
alter table avatars add column if not exists storage_mode jsonb;
```

If a block already exists, just append the one line. Do **not** reorder.

### 2. Create `api/_lib/storage-mode.js`

```js
// Per-avatar storage mode: one JSONB column on avatars tracking R2 / IPFS /
// on-chain attestation state. See prompts/embed-hardening/05-storage-flags.md.

import { z } from 'zod';
import { sql } from './db.js';

export const STORAGE_MODE_VERSION = 1;

export const storageModeSchema = z.object({
	version: z.literal(1).optional(),
	primary: z.enum(['r2', 'ipfs']),
	r2: z.object({
		present: z.boolean(),
		key: z.string().nullable(),
	}),
	ipfs: z.object({
		pinned: z.boolean(),
		cid: z.string().nullable(),
		pinned_at: z.string().datetime().nullable(),
	}),
	attestation: z.object({
		hash: z
			.string()
			.regex(/^[a-f0-9]{64}$/i)
			.nullable(),
		chain_id: z.number().int().nullable(),
		tx_hash: z
			.string()
			.regex(/^0x[a-fA-F0-9]{64}$/)
			.nullable(),
		attested_at: z.string().datetime().nullable(),
	}),
});

export function defaultStorageMode(avatarRow = {}) {
	return {
		version: STORAGE_MODE_VERSION,
		primary: 'r2',
		r2: { present: true, key: avatarRow.storage_key ?? null },
		ipfs: { pinned: false, cid: null, pinned_at: null },
		attestation: {
			hash: avatarRow.checksum_sha256 ?? null,
			chain_id: null,
			tx_hash: null,
			attested_at: null,
		},
	};
}

export async function readStorageMode(avatarId) {
	try {
		const [row] = await sql`
			SELECT id, owner_id, storage_key, checksum_sha256, storage_mode
			FROM avatars
			WHERE id = ${avatarId} AND deleted_at IS NULL
		`;
		if (!row) return null;
		const base = defaultStorageMode(row);
		if (!row.storage_mode) return base;
		return {
			...base,
			...row.storage_mode,
			r2: { ...base.r2, ...(row.storage_mode.r2 || {}) },
			ipfs: { ...base.ipfs, ...(row.storage_mode.ipfs || {}) },
			attestation: { ...base.attestation, ...(row.storage_mode.attestation || {}) },
		};
	} catch (err) {
		if (/column .* does not exist/i.test(String(err?.message))) return null;
		throw err;
	}
}

export function validateStorageMode(input) {
	return storageModeSchema.parse(input);
}
```

### 3. Capture content hash on avatar create

In [api/avatars/index.js](../../api/avatars/index.js) (or wherever the post-upload registration handler lives), after the existing `headObject` check that verifies the file exists:

- If `headObject` response includes an `ETag` that's a single MD5 (no hyphens → single-part upload), that's **not** sha256 — don't use it as a substitute. Instead, call `headObject` with `ChecksumMode: 'ENABLED'` to get the sha256 if the client sent one. If the response includes `ChecksumSHA256`, record it (decoded from base64 to hex).
- If no sha256 is available from R2 (common — the browser upload doesn't send it by default), **skip hash capture for this avatar** — leave `checksum_sha256` null. Do **not** download and re-hash the GLB in this request; that's a job for a background worker.
- Populate `storage_mode` on insert using `defaultStorageMode({ storage_key, checksum_sha256 })` so every new avatar row has a canonical storage_mode from the start.

Small PR — don't refactor the rest of the endpoint.

### 4. Create `api/avatars/[id]/storage-mode.js`

Mirrors the embed-policy endpoint shape. GET is public-read-of-public-avatars (or owner-only if visibility === 'private'); PUT is owner-only:

```js
import { z } from 'zod';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error, readJson } from '../../_lib/http.js';
import { parse } from '../../_lib/validate.js';
import { readStorageMode, storageModeSchema, defaultStorageMode } from '../../_lib/storage-mode.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PUT,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2];
	if (!id) return error(res, 400, 'validation_error', 'avatar id required');

	const [row] =
		await sql`SELECT id, owner_id, visibility FROM avatars WHERE id = ${id} AND deleted_at IS NULL`;
	if (!row) return error(res, 404, 'not_found', 'avatar not found');

	if (req.method === 'GET') {
		if (row.visibility === 'private') {
			const session = await getSessionUser(req);
			if (!session || session.id !== row.owner_id)
				return error(res, 403, 'forbidden', 'private avatar');
		}
		const mode = await readStorageMode(id);
		return json(res, 200, { storage_mode: mode });
	}

	// PUT — owner only
	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');
	if (session.id !== row.owner_id) return error(res, 403, 'forbidden', 'not your avatar');

	const body = parse(storageModeSchema, await readJson(req));
	await sql`UPDATE avatars SET storage_mode = ${JSON.stringify(body)}::jsonb WHERE id = ${id}`;
	return json(res, 200, { storage_mode: body });
});
```

Gotcha: allow the owner to edit only **safe** fields (they shouldn't be able to forge `attestation.tx_hash` from the UI). Add server-side gatekeeping: overlay the user-submitted object on top of the current stored mode, but drop any keys under `attestation.*` — always re-read those from the DB unchanged. Document this in a short comment.

### 5. Create the stub pin endpoint

`api/avatars/[id]/pin-ipfs.js`:

```js
// STUB — real pinning (Pinata / Web3.Storage) is a follow-up. For now this
// computes a placeholder CID from the stored sha256 and flips pinned_ipfs.

import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { readStorageMode } from '../../_lib/storage-mode.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2];
	if (!id) return error(res, 400, 'validation_error', 'avatar id required');

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const [row] =
		await sql`SELECT id, owner_id, checksum_sha256 FROM avatars WHERE id = ${id} AND deleted_at IS NULL`;
	if (!row) return error(res, 404, 'not_found', 'avatar not found');
	if (row.owner_id !== session.id) return error(res, 403, 'forbidden', 'not your avatar');

	const mode = await readStorageMode(id);
	if (!mode) return error(res, 500, 'internal', 'storage_mode unavailable');

	const stubCid = row.checksum_sha256
		? `stub:sha256-${row.checksum_sha256}`
		: `stub:no-hash-${id}`;

	const next = {
		...mode,
		ipfs: { pinned: true, cid: stubCid, pinned_at: new Date().toISOString() },
	};

	await sql`UPDATE avatars SET storage_mode = ${JSON.stringify(next)}::jsonb WHERE id = ${id}`;
	return json(res, 200, { storage_mode: next, stub: true });
});
```

### 6. Create the owner UI

`public/dashboard/storage.html` — structure after [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html). Sections:

- **R2** — show `r2.key` (the storage path) read-only; show "present" badge.
- **IPFS** — show `ipfs.pinned` + `ipfs.cid`. If not pinned, a button "Pin to IPFS (stub)" that `POST`s to `/api/avatars/:id/pin-ipfs`.
- **Attestation** — show hash + tx_hash + chain_id read-only. If hash is null, show "Not yet computed" with a note that hashing runs server-side post-upload.

### 7. Vercel routes

Edit [vercel.json](../../vercel.json). Inside routes, before the generic `/api/(.*) → /api/$1`:

```json
{ "src": "/api/avatars/([^/]+)/storage-mode", "dest": "/api/avatars/[id]/storage-mode?id=$1" },
{ "src": "/api/avatars/([^/]+)/pin-ipfs",     "dest": "/api/avatars/[id]/pin-ipfs?id=$1" },
{ "src": "/dashboard/storage",                "dest": "/public/dashboard/storage.html" },
```

## Files you own (create / edit)

- Create: `api/_lib/storage-mode.js`
- Create: `api/avatars/[id]/storage-mode.js`
- Create: `api/avatars/[id]/pin-ipfs.js`
- Create: `public/dashboard/storage.html`
- Edit: [api/\_lib/schema.sql](../../api/_lib/schema.sql) — append one ALTER under `avatars`
- Edit: [api/avatars/index.js](../../api/avatars/index.js) — capture `checksum_sha256` when R2 provides it; populate `storage_mode` on insert
- Edit: [vercel.json](../../vercel.json) — three route adds

## Files off-limits (other prompts edit these)

- [api/\_lib/embed-policy.js](../../api/_lib/embed-policy.js) — prompt 02
- [api/agents/[id]/embed-policy.js](../../api/agents/[id]/embed-policy.js) — prompt 02
- [public/dashboard/embed-policy.html](../../public/dashboard/embed-policy.html) — prompt 02
- [src/element.js](../../src/element.js) — prompt 03 (for policy), prompt 04 (for provider threading)
- [agent-embed.html](../../agent-embed.html) — prompt 03
- [api/widgets/page.js](../../api/widgets/page.js) — prompt 03
- [api/mcp.js](../../api/mcp.js) — prompt 03
- [src/runtime/providers.js](../../src/runtime/providers.js) — prompt 04
- Anything under `api/llm/` — prompt 04
- `public/dashboard/usage.html`, `api/agents/[id]/usage.js` — prompt 04

## Idempotency / parallel-safety notes

- The `ALTER TABLE avatars ADD COLUMN IF NOT EXISTS storage_mode jsonb` is safe to run multiple times.
- `readStorageMode` catches "column does not exist" so your endpoints stay useful during partial deploys.
- If another prompt adds columns to `avatars` later, this one does not conflict — each lands its own ALTER.
- The pin endpoint is deliberately a stub. Do **not** add Pinata / Web3.Storage credentials in this prompt; that's a follow-up with real cost considerations.

## Acceptance test

1. `node --check api/_lib/storage-mode.js api/avatars/[id]/storage-mode.js api/avatars/[id]/pin-ipfs.js api/avatars/index.js` passes.
2. `npx prettier --write` over everything; commit clean.
3. `npx vite build` passes.
4. `node scripts/apply-schema.mjs` runs, then re-runs cleanly (idempotent).
5. Manual — signed in as an avatar owner:
    - `GET /api/avatars/<your-avatar-id>/storage-mode` → 200 with `{ storage_mode: { primary: 'r2', r2: { present: true, key: '...' }, ipfs: { pinned: false, ... }, attestation: { hash: null-or-hex, ... } } }`.
    - `POST /api/avatars/<your-avatar-id>/pin-ipfs` → 200, `storage_mode.ipfs.pinned === true`, `cid` starts with `stub:`.
    - `PUT /api/avatars/<your-avatar-id>/storage-mode` with a body that tries to set `attestation.tx_hash: "0x..."` → the response's `attestation.tx_hash` is unchanged (still null), i.e. the write silently dropped the attestation edit.
    - `GET /api/avatars/<someone-else's-private-avatar>/storage-mode` → 403.
6. Upload a new avatar via the existing flow. Confirm the new row has a populated `storage_mode` (defaults), and if the browser sent an `x-amz-checksum-sha256` header, the hash is captured (else null is fine).
7. Visit `/dashboard/storage?id=<your-avatar>` in the browser. Confirm the three sections render and the Pin button round-trips.

## Reporting

- Files created / edited with line counts.
- Which fields in `storage_mode` are populated end-to-end (R2 key: yes; hash: yes or no; IPFS: stubbed; attestation: empty).
- `node --check`, prettier, vite build, schema-apply outputs (both runs).
- Each manual case with pass / fail / not-run.
- Explicit call-out: **Pin endpoint is a stub; real Pinata integration is a follow-up.**
- Off-limits files confirmation.
- Unrelated bugs noticed.
