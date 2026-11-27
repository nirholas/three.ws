/**
 * api/cron/forge-web-variants.js: the backfill of the phone-sized delivery
 * variant must drain, not wedge.
 *
 * Production on 2026-11-27 had 19,729 finished models waiting for a variant and
 * the head of the queue unchanged since 2026-11-15. Three faults held it:
 *
 *   1. The cron read originals with the signed read plus the GCS fallback only.
 *      From 2026-11-15 R2 refused the production credential, so every original
 *      written before the outage (it lives only in R2) failed to read, while
 *      /cdn/ served the very same bytes from the public bucket domain.
 *   2. A failed row was left exactly as it was, still newest, so the same rows
 *      were claimed and failed on every tick and nothing behind them ran. Two of
 *      them have an absolute URL in glb_key (reconstruction rows), which can
 *      never be read as a bucket key at all.
 *   3. buildWebVariant swallows every error and answers null, which the cron
 *      read as "no gain" and retired the row to its original for good, so a
 *      write refused by a storage outage cost the model its variant forever.
 *
 * The properties pinned here:
 *   - an original readable only from the public bucket domain still gets its variant
 *   - a glb_key that is not a bucket key serves its original instead of failing forever
 *   - a model-attributable failure is retried a bounded number of times, then the
 *     row serves its original and leaves the queue
 *   - a storage outage charges nothing and rotates the row out, so the rest drains
 *   - a write refused by a storage outage stops the batch and retires nothing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

Object.assign(process.env, {
	S3_ENDPOINT: 'https://s3.example.com',
	S3_BUCKET: 'test-bucket',
	S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
	S3_ACCESS_KEY_ID: 'test-key',
	S3_SECRET_ACCESS_KEY: 'test-secret',
	DATABASE_URL: 'postgres://test:test@localhost/test',
	FORGE_WEB_VARIANT_BATCH: '3',
});

const MAX_ATTEMPTS = 3;

// Fake forge_creations rows and the attempt ledger, driven by the SQL text the
// cron sends. Rows are kept newest first, which is the queue's order.
let rows = [];
let ledger = new Map();

function pending() {
	return rows.filter((r) => r.web_glb_key == null);
}
function rowIdIn(values) {
	return values.find((v) => rows.some((r) => r.id === v));
}

vi.mock('../api/_lib/db.js', () => ({
	sql: async (strings, ...values) => {
		const text = strings.join('?').replace(/\s+/g, ' ').trim();
		const lower = text.toLowerCase();
		if (lower.startsWith('create ')) return [];
		if (lower.startsWith('select count(*)')) return [{ n: pending().length }];
		if (lower.includes('web_glb_key is null') && lower.includes('select') && !lower.startsWith('update')) {
			const limit = [...values].reverse().find((v) => typeof v === 'number');
			const usesLedger = lower.includes('forge_web_variant_backfill');
			const now = Date.now();
			const picked = pending()
				.filter((r) => {
					if (!usesLedger) return true;
					const b = ledger.get(r.id);
					if (!b) return true;
					return b.attempts < MAX_ATTEMPTS && (b.claimed_at == null || b.claimed_at < now - 60 * 60_000);
				})
				.slice(0, limit);
			if (usesLedger) {
				for (const r of picked) {
					const b = ledger.get(r.id) || { attempts: 0, claimed_at: null, last_error: null };
					b.attempts += 1;
					b.claimed_at = now;
					ledger.set(r.id, b);
				}
			}
			return picked.map((r) => ({ id: r.id, glb_key: r.glb_key, size_bytes: r.size_bytes }));
		}
		if (lower.startsWith('update forge_creations set web_glb_key')) {
			const id = rowIdIn(values);
			const row = rows.find((r) => r.id === id);
			if (row && row.web_glb_key == null) row.web_glb_key = values[0];
			return [];
		}
		if (lower.startsWith('delete from forge_web_variant_backfill')) {
			ledger.delete(rowIdIn(values));
			return [];
		}
		if (lower.startsWith('update forge_web_variant_backfill')) {
			const id = rowIdIn(values);
			const b = ledger.get(id);
			if (!b) return [];
			if (lower.includes('greatest(attempts - 1')) {
				b.attempts = Math.max(b.attempts - 1, 0);
				if (values.includes(false)) b.claimed_at = null;
			} else {
				b.claimed_at = null;
			}
			b.last_error = values.find((v) => typeof v === 'string' && v !== id) ?? b.last_error;
			return [{ attempts: b.attempts }];
		}
		return [];
	},
	isDbUnavailableError: () => false,
}));

const reads = [];
let objects = new Map();
let readFault = new Map();
let signedReadWorks = false;
const unauthorized = () => Object.assign(new Error('Unauthorized'), { name: 'Unauthorized', $metadata: { httpStatusCode: 401 } });
const noSuchKey = () => Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey', $metadata: { httpStatusCode: 404 } });
const putObject = vi.fn(async () => {});

vi.mock('../api/_lib/r2.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		objectStorageConfigured: () => true,
		// The signed read is refused, as production's has been since 2026-11-15,
		// unless a test says otherwise.
		getObjectBuffer: async (key) => {
			reads.push(key);
			if (signedReadWorks && objects.has(key) && !readFault.has(key)) return objects.get(key);
			throw readFault.get(key)?.() ?? unauthorized();
		},
		// The public rungs (GCS fallback, then the public bucket domain) answer.
		getPublicObjectBuffer: async (key) => {
			reads.push(key);
			if (readFault.has(key)) throw readFault.get(key)();
			if (!objects.has(key)) throw noSuchKey();
			return objects.get(key);
		},
		putObject: (...a) => putObject(...a),
	};
});

const compressGlb = vi.fn(async (buffer) => ({ buffer: Buffer.alloc(100_000), outputBytes: 100_000, grew: false, inputBytes: buffer.length }));
vi.mock('../api/_lib/glb-compress.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, compressGlb: (...a) => compressGlb(...a) };
});
vi.mock('../api/_lib/cron-auth.js', () => ({ requireCron: () => true }));

const handler = (await import('../api/cron/forge-web-variants.js')).default;

function makeRes() {
	return {
		statusCode: 0,
		body: null,
		headersSent: false,
		writableEnded: false,
		setHeader() {},
		getHeader() {},
		status(code) { this.statusCode = code; return this; },
		end(payload) {
			this.writableEnded = true;
			if (payload && this.body === null) {
				try { this.body = JSON.parse(payload); } catch { this.body = payload; }
			}
			return this;
		},
		json(payload) { this.body = payload; return this; },
	};
}

async function tick() {
	reads.length = 0;
	const res = makeRes();
	await handler({ method: 'GET', url: '/api/cron/forge-web-variants', headers: {} }, res);
	return res.body;
}

const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BIG = Buffer.alloc(1_000_000, 7);

function addRow(n, glbKey = `forge/abcdef123456/${ID(n)}.glb`) {
	rows.push({ id: ID(n), glb_key: glbKey, size_bytes: BIG.length, web_glb_key: null });
	objects.set(glbKey, BIG);
	return rows[rows.length - 1];
}
function expireLeases() {
	for (const b of ledger.values()) if (b.claimed_at != null) b.claimed_at -= 2 * 60 * 60_000;
}

beforeEach(() => {
	rows = [];
	ledger = new Map();
	objects = new Map();
	readFault = new Map();
	signedReadWorks = false;
	putObject.mockReset();
	putObject.mockImplementation(async () => {});
	compressGlb.mockClear();
});

describe('forge-web-variants cron', () => {
	it('builds the variant from the public bucket domain when the signed read is refused', async () => {
		const row = addRow(1);
		const out = await tick();
		expect(out.built).toBe(1);
		expect(putObject).toHaveBeenCalledTimes(1);
		expect(putObject.mock.calls[0][0].key).toBe(`forge/abcdef123456/${ID(1)}.web.glb`);
		expect(row.web_glb_key).toBe(`forge/abcdef123456/${ID(1)}.web.glb`);
	});

	it('serves the original for a glb_key that is not a bucket key, without reading storage', async () => {
		const foreign = addRow(1, `https://storage.googleapis.com/three-ws-avatar-reconstructions/avatars/${ID(1)}.glb`);
		const out = await tick();
		expect(reads).not.toContain(foreign.glb_key);
		expect(foreign.web_glb_key).toBe(foreign.glb_key);
		expect(putObject).not.toHaveBeenCalled();
		expect(out.remaining).toBe(0);
	});

	it('reads an own-bucket URL stored in glb_key through its key', async () => {
		const row = addRow(1, `https://cdn.example.com/forge/abcdef123456/${ID(1)}.glb`);
		objects.set(`forge/abcdef123456/${ID(1)}.glb`, BIG);
		const out = await tick();
		expect(out.built).toBe(1);
		expect(putObject.mock.calls[0][0].key).toBe(`forge/abcdef123456/${ID(1)}.web.glb`);
		expect(row.web_glb_key).toBe(`forge/abcdef123456/${ID(1)}.web.glb`);
	});

	it('retries a missing original a bounded number of times, then serves it as is and lets the queue move', async () => {
		const gone = addRow(1);
		objects.delete(gone.glb_key);
		readFault.set(gone.glb_key, noSuchKey);
		for (let n = 2; n <= 9; n++) addRow(n);
		for (let t = 1; t <= MAX_ATTEMPTS; t++) {
			await tick();
			expect(reads[0]).toBe(gone.glb_key);
		}
		expect(gone.web_glb_key).toBe(gone.glb_key);
		await tick();
		expect(reads).not.toContain(gone.glb_key);
		expect(pending().length).toBe(0);
	});

	it('charges no attempt for a storage outage on read and rotates the row out so the rest drains', async () => {
		const stuck = addRow(1);
		readFault.set(stuck.glb_key, unauthorized);
		for (let n = 2; n <= 5; n++) addRow(n);
		await tick();
		expect(ledger.get(stuck.id)?.attempts ?? 0).toBe(0);
		await tick();
		expect(reads).not.toContain(stuck.glb_key);
		expect(pending().map((r) => r.id)).toEqual([stuck.id]);
		expireLeases();
		await tick();
		expect(reads).toContain(stuck.glb_key);
		expect(stuck.web_glb_key).toBeNull();
	});

	it('stops the batch and retires nothing when storage refuses the variant write', async () => {
		signedReadWorks = true;
		addRow(1);
		addRow(2);
		addRow(3);
		putObject.mockImplementation(async () => { throw unauthorized(); });
		const out = await tick();
		expect(putObject).toHaveBeenCalledTimes(1);
		expect(rows.every((r) => r.web_glb_key == null)).toBe(true);
		expect([...ledger.values()].every((b) => b.attempts === 0)).toBe(true);
		expect(out.aborted).toBeTruthy();
	});
});
