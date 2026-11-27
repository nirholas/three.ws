/**
 * Forge ownership and token security (forge-hardening order 168).
 *
 * Defensive audit of who may read, change, delete, keep, vote on or comment on
 * a Forge creation. Two fabricated accounts, A and B. A owns a private model
 * and a public one; B holds only B's own credentials plus A's identifier. Only
 * the database boundary is faked (a small interpreter for the ownership and
 * visibility predicates the real queries bind), so the real forge-store
 * credential resolution and the real handlers run.
 *
 * Inventory (endpoint, identifier, check that ties it to the caller):
 *   GET    /api/forge?job=              signed job handle + poll scoped to the poller's client key (forge-poll-privacy.test.js)
 *   GET    /api/forge-creation?id=      public read; private rows only after isCreationOwner
 *   PATCH  /api/forge-creation?id=      visibility / tags: isCreationOwner or setCreationVisibility credentials
 *   DELETE /api/forge-creation?id=      deleteCreation credentials
 *   GET    /api/forge/mine              signed-in account only, rows filtered by user id
 *   GET|POST /api/forge-keep            private rows need an owner
 *   POST   /api/forge-vote              private rows are not votable
 *   GET|POST|DELETE /api/forge-comments private rows are invisible, DELETE is own comments, CSRF token on writes
 *   GET    /api/forge-og?id=            private rows answer like a missing id
 *   GET    /api/forge-share?id=         private rows redirect like a missing id
 *   POST   /api/forge-categorize|feedback|poster  client key through the store's anon-bucket guard (forge-creation-ownership.test.js)
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';

const SECRET = 'test-jwt-secret-for-ownership-security-0123456789';

beforeAll(() => {
	Object.assign(process.env, {
		DATABASE_URL: 'postgres://test:test@localhost:5432/test',
		S3_ENDPOINT: 'https://s3.example.com',
		S3_BUCKET: 'test-bucket',
		S3_PUBLIC_DOMAIN: 'https://cdn.example.com',
		S3_ACCESS_KEY_ID: 'test-key',
		S3_SECRET_ACCESS_KEY: 'test-secret',
		JWT_SECRET: SECRET,
		APP_ORIGIN: 'https://three.ws',
		CRON_SECRET: 'cron-secret-for-ownership-tests',
	});
});

// ---------------------------------------------------------------- the fake database

const A = { user: 'a1111111-1111-4111-8111-111111111111', client: 'client-of-account-a' };
const B = { user: 'b2222222-2222-4222-8222-222222222222', client: 'client-of-account-b' };
const PRIVATE_ID = 'aaaaaaaa-0000-4000-8000-000000000001'; // A's private model
const PUBLIC_ID = 'aaaaaaaa-0000-4000-8000-000000000002'; // A's public model
const B_OWN_ID = 'bbbbbbbb-0000-4000-8000-000000000001'; // B's model
const MISSING_ID = 'cccccccc-0000-4000-8000-000000000009';

let rows = new Map();
let statements = [];
let csrfTokens = new Set();
let comments = [];

function resetRows(hash) {
	const base = (id, who, visibility, prompt) => ({
		id,
		client_key: hash(who.client),
		user_id: who.user,
		visibility,
		status: 'done',
		prompt,
		glb_url: `https://cdn.example.com/forge/${id}.glb`,
		preview_image_url: `https://cdn.example.com/forge/${id}.png`,
		tier: 'standard',
		outcome: 'generated',
		safety_status: null,
	});
	rows = new Map([
		[PRIVATE_ID, base(PRIVATE_ID, A, 'private', 'a private prototype nobody may see')],
		[PUBLIC_ID, base(PUBLIC_ID, A, 'public', 'a public dragon')],
		[B_OWN_ID, base(B_OWN_ID, B, 'public', 'bee')],
	]);
}

// The ownership predicate every management query binds, in the order the
// queries bind it: (grant, ck, ck, uid, uid) are the last five values.
function ownerMatch(values) {
	const [id, grant, ck, , uid] = [values[values.length - 6], ...values.slice(-5)];
	const row = rows.get(id);
	if (!row) return null;
	return grant === true || (ck && row.client_key === ck) || (uid && row.user_id === uid) ? row : null;
}

const sqlMock = vi.fn(async (strings, ...values) => {
	const text = (Array.isArray(strings) ? strings.join('?') : String(strings)).replace(/\s+/g, ' ').trim();
	statements.push({ text, values });
	const t = text.toLowerCase();

	if (t.startsWith('delete from csrf_tokens')) {
		const [token, userId] = values;
		return token === `csrf-${userId}` && csrfTokens.has(token) ? [{ user_id: userId }] : [];
	}
	if (t.startsWith('select 1 from forge_creations') && t.includes('status = \'done\'')) {
		return ownerMatch(values) ? [{ '?column?': 1 }] : [];
	}
	if (t.startsWith('select id, client_key, glb_key')) {
		// deleteCreation's row lookup
		const row = ownerMatch(values);
		return row ? [{ ...row, glb_key: null, preview_key: null, web_glb_key: null, lod_glb_key: null, source_image_keys: null }] : [];
	}
	if (t.startsWith('update forge_creations set visibility')) {
		const row = ownerMatch(values);
		if (!row) return [];
		row.visibility = values[0];
		return [{ id: row.id, visibility: row.visibility, status: 'done', glb_url: row.glb_url, outcome: row.outcome }];
	}
	if (t.includes('from forge_creations fc') && t.includes('left join users u') && t.includes('fc.glb_url, fc.web_glb_url')) {
		// getPublicCreation
		const id = values.find((v) => typeof v === 'string' && rows.has(v));
		const includePrivate = values.find((v) => typeof v === 'boolean') === true;
		const row = rows.get(id);
		if (!row || (row.visibility === 'private' && !includePrivate)) return [];
		return [{ ...row, created_at: new Date('2026-01-01T00:00:00Z'), view_count: 0, remix_count: 0, voted: false }];
	}
	if (t.startsWith('select id, tier, glb_url, status, visibility from forge_creations') || t.startsWith('select id, tier, glb_url, status from forge_creations')) {
		const row = rows.get(values[0]);
		return row ? [{ id: row.id, tier: row.tier, glb_url: row.glb_url, status: row.status, visibility: row.visibility }] : [];
	}
	if (t.startsWith('select id, prompt, preview_image_url')) {
		const row = rows.get(values[0]);
		// The real query carries its own visibility filter; honor it so the test
		// fails if that clause is ever dropped.
		if (row && row.visibility === 'private' && t.includes("visibility in ('public', 'unlisted')")) return [];
		return row ? [{ id: row.id, prompt: row.prompt, preview_image_url: row.preview_image_url, visibility: row.visibility }] : [];
	}
	if (t.startsWith('select fc.id, fc.prompt, fc.preview_image_url, fc.status')) {
		// forge-share: its WHERE clause carries the visibility filter itself
		const row = rows.get(values[0]);
		if (!row || row.visibility === 'private') return [];
		return [{ ...row, created_at: new Date('2026-01-01T00:00:00Z') }];
	}
	if (t.startsWith('select id, visibility from forge_creations') || t.startsWith('select id, status, visibility')) {
		const row = rows.get(values[0]);
		return row ? [{ id: row.id, status: row.status, visibility: row.visibility }] : [];
	}
	if (t.startsWith('select id, user_id, prompt, visibility from forge_creations')) {
		const row = rows.get(values[0]);
		return row ? [{ id: row.id, user_id: row.user_id, prompt: row.prompt, visibility: row.visibility }] : [];
	}
	if (t.startsWith('select username, display_name, avatar_url from users')) {
		return [{ username: 'tester', display_name: 'Tester', avatar_url: null }];
	}
	if (t.startsWith('insert into forge_comments')) {
		const row = { id: values[0], body: values[3], created_at: new Date() };
		comments.push({ ...row, creation_id: values[1], user_id: values[2] });
		return [row];
	}
	if (t.startsWith('select user_id, visibility from forge_creations')) {
		const row = rows.get(values[0]);
		return row ? [{ user_id: row.user_id, visibility: row.visibility }] : [];
	}
	if (t.includes('from forge_comments')) {
		if (t.includes('count(')) return [{ total: comments.filter((c) => c.creation_id === values[0]).length }];
		return comments
			.filter((c) => c.creation_id === values[0])
			.map((c) => ({ ...c, username: 'tester', display_name: 'Tester', avatar_url: null }));
	}
	if (t.startsWith('delete from forge_comments')) {
		const [commentId, userId] = values;
		const hit = comments.find((c) => c.id === commentId && c.user_id === userId);
		if (!hit) return [];
		comments = comments.filter((c) => c !== hit);
		return [{ id: commentId }];
	}
	if (t.startsWith('select id from forge_creations') && t.includes("status = 'done'")) {
		// castVote eligibility
		const row = rows.get(values[0]);
		if (row && row.visibility === 'private' && t.includes("visibility <> 'private'")) return [];
		return row ? [{ id: row.id, visibility: row.visibility }] : [];
	}
	if (t.startsWith('update forge_creations set vote_count')) {
		const row = rows.get(values[values.length - 1]);
		if (!row || (row.visibility === 'private' && t.includes("visibility <> 'private'"))) return [];
		return [{ vote_count: 7 }];
	}
	return [];
});

vi.mock('../../api/_lib/db.js', () => ({
	sql: (...args) => sqlMock(...args),
	isDbUnavailableError: () => false,
}));

vi.mock('../../api/_lib/r2.js', () => ({
	putObject: vi.fn(async () => {}),
	objectStorageConfigured: () => true,
	publicUrl: (key) => `https://cdn.example.com/${key}`,
	cdnUrl: (key) => `https://cdn.example.com/${key}`,
	deleteObject: vi.fn(async () => {}),
	listObjectsPage: vi.fn(async () => ({ objects: [], nextToken: null })),
	normalizeStoredUrl: (u) => u,
	isStorageInfrastructureError: () => false,
	keyFromPublicUrl: () => null,
}));
vi.mock('../../api/_lib/forge-events.js', () => ({ recordGenerationEvent: vi.fn(async () => {}) }));
vi.mock('../../api/_lib/indexnow-queue.js', () => ({ announceIndexNow: vi.fn() }));
vi.mock('../../api/_lib/content-safety-store.js', () => ({
	gatePublish: vi.fn(async () => ({ allow: true })),
}));
vi.mock('../../api/_lib/feed.js', () => ({ publishUserEvent: vi.fn() }));
vi.mock('../../api/_lib/creation-descriptions.js', async (importOriginal) => ({
	...(await importOriginal()),
	setOwnerTags: vi.fn(async ({ tags }) => ({ tags, generatedTags: [] })),
}));

// Provider keys: record every outbound call and every idempotency write.
const upstreamCalls = [];
vi.mock('../../api/_lib/upstream-fetch.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		fetchUpstream: vi.fn(async (url, init = {}) => {
			upstreamCalls.push({ url: String(url), init });
			return new Response(JSON.stringify({ code: 0, data: { task_id: 'task-1', file_token: 'ft' } }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			});
		}),
	};
});

const idempotencyWrites = [];
vi.mock('../../api/_lib/idempotency.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		readIdempotent: vi.fn(async () => null),
		claimIdempotent: vi.fn(async (key, record) => {
			idempotencyWrites.push({ key, record });
			return true;
		}),
		writeIdempotent: vi.fn(async (key, record) => {
			idempotencyWrites.push({ key, record });
		}),
		releaseIdempotent: vi.fn(async () => {}),
	};
});

const limiterKeys = [];
vi.mock('../../api/_lib/rate-limit.js', async (importOriginal) => {
	const actual = await importOriginal();
	const ok = (name) => async (key) => {
		limiterKeys.push({ name, key });
		return { success: true, remaining: 10, reset: Date.now() + 1000 };
	};
	return {
		...actual,
		limits: new Proxy({}, { get: (_t, name) => ok(String(name)) }),
	};
});

// A session is "x-test-user: <id>". Everything else in auth stays real.
vi.mock('../../api/_lib/auth.js', async (importOriginal) => {
	const actual = await importOriginal();
	const who = (req) => {
		const id = req?.headers?.['x-test-user'];
		return id ? { id: String(id) } : null;
	};
	return {
		...actual,
		getSessionUser: vi.fn(async (req) => who(req)),
		getRequestUser: vi.fn(async (req) => who(req)),
		authenticateBearer: vi.fn(async () => null),
	};
});

const store = await import('../../api/_lib/forge-store.js');
const { hashClient, ANON_CLIENT_KEY } = store;
const { encodeJobToken, decodeJobToken } = await import('../../api/_lib/forge-job-token.js');
const { mintManageToken, verifyManageToken } = await import('../../api/_lib/forge-manage-token.js');

beforeEach(() => {
	resetRows(hashClient);
	statements = [];
	csrfTokens = new Set([`csrf-${A.user}`, `csrf-${B.user}`]);
	comments = [];
	limiterKeys.length = 0;
	sqlMock.mockClear();
});

// ---------------------------------------------------------------- helpers

function mockRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) {
			this.headers[String(k).toLowerCase()] = v;
		},
		getHeader(k) {
			return this.headers[String(k).toLowerCase()];
		},
		end(b) {
			this.body = b ? String(b) : '';
			this.writableEnded = true;
		},
		get json() {
			try {
				return JSON.parse(this.body);
			} catch {
				return null;
			}
		},
	};
}

async function call(handler, { method = 'GET', url, headers = {}, body = undefined } = {}) {
	const payload = body === undefined ? '' : JSON.stringify(body);
	const req = Readable.from(payload ? [Buffer.from(payload)] : []);
	req.method = method;
	req.url = url;
	req.headers = {
		host: 'three.ws',
		'content-type': 'application/json',
		'x-forwarded-for': '203.0.113.5, 35.191.0.1',
		...headers,
	};
	if (payload) req.headers['content-length'] = String(Buffer.byteLength(payload));
	const res = mockRes();
	await handler(req, res);
	return res;
}

const asA = { 'x-forge-client': A.client, 'x-test-user': A.user };
const asB = { 'x-forge-client': B.client, 'x-test-user': B.user };

// ================================================================ tokens

describe('job handle tokens (f1.)', () => {
	const input = { provider: 'gcp', kind: 'reconstruct', taskId: 'task-123' };

	it('round-trips the provider, kind and task it was signed for', () => {
		expect(decodeJobToken(encodeJobToken(input))).toMatchObject(input);
	});

	it('refuses a payload edited to point at another task', () => {
		const [prefix, , sig] = encodeJobToken(input).split('.');
		const forgedPayload = Buffer.from(JSON.stringify({ p: 'gcp', k: 'reconstruct', t: 'someone-elses-task' })).toString('base64url');
		expect(decodeJobToken(`${prefix}.${forgedPayload}.${sig}`)).toBeNull();
	});

	it('refuses a payload edited to another provider (platform-key lane)', () => {
		const [prefix, , sig] = encodeJobToken(input).split('.');
		const forgedPayload = Buffer.from(JSON.stringify({ p: 'meshy', k: 'reconstruct', t: 'task-123' })).toString('base64url');
		expect(decodeJobToken(`${prefix}.${forgedPayload}.${sig}`)).toBeNull();
	});

	it('refuses a missing, empty, truncated or none-style signature', () => {
		const [prefix, payload, sig] = encodeJobToken(input).split('.');
		expect(decodeJobToken(`${prefix}.${payload}`)).toBeNull();
		expect(decodeJobToken(`${prefix}.${payload}.`)).toBeNull();
		expect(decodeJobToken(`${prefix}.${payload}.${sig.slice(0, -2)}`)).toBeNull();
		expect(decodeJobToken(`${prefix}.${payload}.none`)).toBeNull();
		expect(decodeJobToken(`${prefix}.${payload}.${'A'.repeat(sig.length)}`)).toBeNull();
		// An unsigned JWT with alg none is not a job handle either.
		const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${payload}.`;
		expect(decodeJobToken(none)).toBeNull();
		expect(decodeJobToken(`f1.${payload}.${payload}`)).toBeNull();
	});

	it('refuses a token signed with another secret', () => {
		const payload = Buffer.from(JSON.stringify({ p: 'gcp', k: 'x', t: 'task-123' })).toString('base64url');
		const other = createHmac('sha256', 'a-different-server-secret-0123456789abcdef').update(payload).digest('base64url');
		expect(decodeJobToken(`f1.${payload}.${other}`)).toBeNull();
	});

	it('refuses non-strings and oversize junk without throwing', () => {
		for (const v of [undefined, null, 42, {}, [], '', 'f1.', 'f1..', 'f1.a.b.c', `f1.${'x'.repeat(5000)}.y`]) {
			expect(decodeJobToken(v)).toBeNull();
		}
	});

	it('expires: a handle past its lifetime stops polling anything', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
			const token = encodeJobToken(input);
			expect(decodeJobToken(token)).toMatchObject(input);
			vi.setSystemTime(new Date('2026-06-01T00:00:00Z').getTime() + 6 * 24 * 3600 * 1000);
			expect(decodeJobToken(token)).toMatchObject(input);
			vi.setSystemTime(new Date('2026-06-01T00:00:00Z').getTime() + 8 * 24 * 3600 * 1000);
			expect(decodeJobToken(token)).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('cannot be given a longer life by editing its expiry', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
			const [prefix, payload, sig] = encodeJobToken(input).split('.');
			const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
			obj.x = (obj.x ?? 0) + 10 * 365 * 24 * 3600;
			const edited = Buffer.from(JSON.stringify(obj)).toString('base64url');
			expect(decodeJobToken(`${prefix}.${edited}.${sig}`)).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('still accepts a handle minted before expiry existed, so in-flight jobs survive a deploy', () => {
		const payload = Buffer.from(JSON.stringify({ p: 'gcp', k: 'reconstruct', t: 'task-123' })).toString('base64url');
		const sig = createHmac('sha256', SECRET).update(payload).digest('base64url');
		expect(decodeJobToken(`f1.${payload}.${sig}`)).toMatchObject(input);
	});

	it('is not interchangeable with a manage token in either direction', () => {
		const manage = mintManageToken(PUBLIC_ID);
		expect(decodeJobToken(manage)).toBeNull();
		expect(verifyManageToken(encodeJobToken(input))).toBeNull();
		// Same payload, job-handle signature, manage prefix: still refused.
		const payload = Buffer.from(PUBLIC_ID).toString('base64url');
		const jobStyleSig = createHmac('sha256', SECRET).update(payload).digest('base64url');
		expect(verifyManageToken(`fm1.${payload}.${jobStyleSig}`)).toBeNull();
	});
});

describe('manage tokens (fm1.)', () => {
	it('grants exactly the creation it was minted for', () => {
		expect(verifyManageToken(mintManageToken(PUBLIC_ID))).toBe(PUBLIC_ID);
		expect(verifyManageToken(mintManageToken(PUBLIC_ID))).not.toBe(PRIVATE_ID);
	});

	it('refuses a payload swapped to another creation, a missing signature and junk', () => {
		const [prefix, , sig] = mintManageToken(PUBLIC_ID).split('.');
		const swapped = Buffer.from(PRIVATE_ID).toString('base64url');
		expect(verifyManageToken(`${prefix}.${swapped}.${sig}`)).toBeNull();
		expect(verifyManageToken(`${prefix}.${swapped}`)).toBeNull();
		expect(verifyManageToken(`${prefix}.${swapped}.`)).toBeNull();
		expect(verifyManageToken(`${prefix}.${swapped}.none`)).toBeNull();
		expect(verifyManageToken('x'.repeat(400))).toBeNull();
		expect(verifyManageToken(undefined)).toBeNull();
		expect(mintManageToken('not-a-uuid')).toBeNull();
	});

	it('refuses a token signed with another secret', () => {
		const payload = Buffer.from(PUBLIC_ID).toString('base64url');
		const other = createHmac('sha256', 'a-different-server-secret-0123456789abcdef').update(`forge-manage:v1:${payload}`).digest('base64url');
		expect(verifyManageToken(`fm1.${payload}.${other}`)).toBeNull();
	});
});

// ================================================================ the store, two accounts

describe('account B against account A, at the store', () => {
	const ids = [PRIVATE_ID, PUBLIC_ID];

	it('cannot be an owner through any credential B holds', async () => {
		for (const id of ids) {
			expect(await store.isCreationOwner({ id, clientKey: hashClient(B.client), userId: B.user })).toBe(false);
			expect(await store.isCreationOwner({ id, manageToken: mintManageToken(B_OWN_ID) })).toBe(false);
			expect(await store.isCreationOwner({ id, clientKey: ANON_CLIENT_KEY })).toBe(false);
			expect(await store.isCreationOwner({ id })).toBe(false);
		}
	});

	it('is an owner of its own model, so the checks above are not vacuous', async () => {
		expect(await store.isCreationOwner({ id: B_OWN_ID, clientKey: hashClient(B.client) })).toBe(true);
		expect(await store.isCreationOwner({ id: B_OWN_ID, userId: B.user })).toBe(true);
		expect(await store.isCreationOwner({ id: B_OWN_ID, manageToken: mintManageToken(B_OWN_ID) })).toBe(true);
		expect(await store.isCreationOwner({ id: PRIVATE_ID, userId: A.user })).toBe(true);
	});

	it('cannot delete A\'s model, and the answer is the same as for an id that does not exist', async () => {
		const attempts = [
			{ clientKey: hashClient(B.client), userId: B.user },
			{ manageToken: mintManageToken(B_OWN_ID) },
			{ clientKey: ANON_CLIENT_KEY },
		];
		for (const creds of attempts) {
			const stranger = await store.deleteCreation({ id: PRIVATE_ID, ...creds });
			const missing = await store.deleteCreation({ id: MISSING_ID, ...creds });
			expect(stranger).toBe('not_found');
			expect(stranger).toBe(missing);
		}
		expect(statements.some((s) => s.text.toLowerCase().startsWith('delete from forge_creations'))).toBe(false);
		expect(rows.has(PRIVATE_ID)).toBe(true);
	});

	it('cannot change A\'s visibility, and the answer is the same as for an id that does not exist', async () => {
		for (const visibility of ['public', 'unlisted', 'private']) {
			const creds = { clientKey: hashClient(B.client), userId: B.user, manageToken: mintManageToken(B_OWN_ID) };
			const stranger = await store.setCreationVisibility({ id: PRIVATE_ID, ...creds, visibility });
			const missing = await store.setCreationVisibility({ id: MISSING_ID, ...creds, visibility });
			expect(stranger).toEqual({ outcome: 'not_found' });
			expect(stranger).toEqual(missing);
		}
		expect(rows.get(PRIVATE_ID).visibility).toBe('private');
	});

	it('lets the real owner through each credential, proving the refusals are about identity', async () => {
		expect((await store.setCreationVisibility({ id: PRIVATE_ID, userId: A.user, visibility: 'unlisted' })).outcome).toBe('updated');
		expect((await store.setCreationVisibility({ id: PRIVATE_ID, clientKey: hashClient(A.client), visibility: 'private' })).outcome).toBe('updated');
		expect((await store.setCreationVisibility({ id: PRIVATE_ID, manageToken: mintManageToken(PRIVATE_ID), visibility: 'unlisted' })).outcome).toBe('updated');
	});
});

// ================================================================ /api/forge-creation

describe('/api/forge-creation, two accounts', () => {
	let handler;
	beforeAll(async () => {
		handler = (await import('../../api/forge-creation.js')).default;
	});

	it('hides A\'s private model from B and from anonymous callers exactly like a missing id', async () => {
		const anon = await call(handler, { url: `/api/forge-creation?id=${PRIVATE_ID}` });
		const stranger = await call(handler, { url: `/api/forge-creation?id=${PRIVATE_ID}`, headers: asB });
		const missing = await call(handler, { url: `/api/forge-creation?id=${MISSING_ID}`, headers: asB });
		for (const res of [anon, stranger]) {
			expect(res.statusCode).toBe(404);
			expect(res.json).toEqual(missing.json);
			expect(res.body).not.toContain('private prototype');
		}
	});

	it('serves A\'s private model to A, uncached', async () => {
		const res = await call(handler, { url: `/api/forge-creation?id=${PRIVATE_ID}`, headers: asA });
		expect(res.statusCode).toBe(200);
		expect(res.json.creation.is_owner).toBe(true);
		expect(res.headers['cache-control']).toMatch(/no-store/);
	});

	it('does not mark B an owner of A\'s public model', async () => {
		const res = await call(handler, { url: `/api/forge-creation?id=${PUBLIC_ID}`, headers: asB });
		expect(res.statusCode).toBe(200);
		expect(res.json.creation.is_owner).toBe(false);
		expect(res.json.creation.can_edit_tags).toBe(false);
	});

	it('refuses B\'s DELETE with the same answer as a missing id', async () => {
		const stranger = await call(handler, { method: 'DELETE', url: `/api/forge-creation?id=${PUBLIC_ID}`, headers: asB });
		const missing = await call(handler, { method: 'DELETE', url: `/api/forge-creation?id=${MISSING_ID}`, headers: asB });
		expect(stranger.statusCode).toBe(404);
		expect(stranger.json).toEqual(missing.json);
		expect(rows.has(PUBLIC_ID)).toBe(true);
	});

	it('refuses B\'s PATCH of visibility and tags with the same answer as a missing id', async () => {
		const patch = (id, body, headers = asB) => call(handler, { method: 'PATCH', url: `/api/forge-creation?id=${id}`, headers, body });
		for (const body of [{ visibility: 'public' }, { visibility: 'unlisted' }, { tags: ['stolen'] }]) {
			const stranger = await patch(PRIVATE_ID, body);
			const missing = await patch(MISSING_ID, body);
			expect(stranger.statusCode).toBe(404);
			expect(stranger.json).toEqual(missing.json);
		}
		expect(rows.get(PRIVATE_ID).visibility).toBe('private');
	});

	it('refuses B using the manage token of B\'s own model against A\'s model', async () => {
		const headers = { 'x-forge-manage-token': mintManageToken(B_OWN_ID) };
		const del = await call(handler, { method: 'DELETE', url: `/api/forge-creation?id=${PUBLIC_ID}`, headers });
		const patch = await call(handler, { method: 'PATCH', url: `/api/forge-creation?id=${PUBLIC_ID}`, headers, body: { visibility: 'unlisted' } });
		expect(del.statusCode).toBe(404);
		expect(patch.statusCode).toBe(404);
		expect(rows.get(PUBLIC_ID).visibility).toBe('public');
	});

	it('refuses an anonymous DELETE before touching the database', async () => {
		const res = await call(handler, { method: 'DELETE', url: `/api/forge-creation?id=${PUBLIC_ID}` });
		expect(res.statusCode).toBe(401);
		expect(statements.some((s) => s.text.toLowerCase().includes('delete from'))).toBe(false);
	});

	it('refuses the shared anon bucket as a credential: a client id of "anon" owns nothing', async () => {
		const res = await call(handler, { method: 'DELETE', url: `/api/forge-creation?id=${PUBLIC_ID}`, headers: { 'x-forge-client': 'anon' } });
		expect(res.statusCode).toBe(404);
		expect(rows.has(PUBLIC_ID)).toBe(true);
	});
});

// ================================================================ /api/forge/mine

describe('/api/forge/mine, two accounts', () => {
	it('lists only the caller\'s own models and refuses an anonymous caller', async () => {
		const { createForgeMineHandler } = await import('../../api/forge/mine.js');
		const listOwn = vi.fn(async ({ userId }) =>
			[...rows.values()].filter((r) => r.user_id === userId).map((r) => ({ ...r, created_at: new Date('2026-01-01T00:00:00Z') })),
		);
		const authenticate = async (req) => (req.headers['x-test-user'] ? { id: req.headers['x-test-user'], scope: 'avatars:read' } : null);
		const handler = createForgeMineHandler({ authenticate, listOwn });

		const anon = await call(handler, { url: '/api/forge/mine' });
		expect(anon.statusCode).toBe(401);
		expect(listOwn).not.toHaveBeenCalled();

		const b = await call(handler, { url: '/api/forge/mine', headers: asB });
		expect(b.statusCode).toBe(200);
		expect(b.json.models.map((m) => m.id)).toEqual([B_OWN_ID]);
		expect(b.body).not.toContain(PRIVATE_ID);
		expect(b.headers['cache-control']).toMatch(/no-store/);
	});
});

// ================================================================ private models are not an open door

describe('a private model answers like a missing one on every other surface', () => {
	it('/api/forge-vote refuses a vote on it, and removing a vote reveals nothing', async () => {
		const handler = (await import('../../api/forge-vote.js')).default;
		const vote = (id, body = {}) => call(handler, { method: 'POST', url: '/api/forge-vote', headers: { 'x-forge-client': B.client }, body: { creation_id: id, ...body } });

		const castPrivate = await vote(PRIVATE_ID);
		const castMissing = await vote(MISSING_ID);
		expect(castPrivate.statusCode).toBe(404);
		expect(castPrivate.json).toEqual(castMissing.json);

		const removePrivate = await vote(PRIVATE_ID, { vote: false });
		const removeMissing = await vote(MISSING_ID, { vote: false });
		const { creation_id: _a, ...privateBody } = removePrivate.json;
		const { creation_id: _b, ...missingBody } = removeMissing.json;
		expect(privateBody).toEqual(missingBody);
		expect(removePrivate.body).not.toContain('"vote_count":7');

		const castPublic = await vote(PUBLIC_ID);
		expect(castPublic.statusCode).toBe(200);
		expect(castPublic.json.voted).toBe(true);
	});

	it('/api/forge-comments lists nothing for it, and refuses a comment on it', async () => {
		const handler = (await import('../../api/forge-comments.js')).default;
		comments.push({ id: 'c0000000-0000-4000-8000-000000000001', creation_id: PRIVATE_ID, user_id: A.user, body: 'secret note', created_at: new Date() });

		const list = await call(handler, { url: `/api/forge-comments?creation_id=${PRIVATE_ID}`, headers: asB });
		const missing = await call(handler, { url: `/api/forge-comments?creation_id=${MISSING_ID}`, headers: asB });
		expect(list.body).not.toContain('secret note');
		expect(list.json).toEqual(missing.json);

		const post = await call(handler, {
			method: 'POST',
			url: '/api/forge-comments',
			headers: { ...asB, 'x-csrf-token': `csrf-${B.user}` },
			body: { creation_id: PRIVATE_ID, body: 'hello' },
		});
		expect(post.statusCode).toBe(404);
		expect(comments.some((c) => c.user_id === B.user)).toBe(false);
	});

	it('/api/forge-og does not paint its prompt or preview', async () => {
		const handler = (await import('../../api/forge-og.js')).default;
		const res = await call(handler, { url: `/api/forge-og?id=${PRIVATE_ID}` });
		const missing = await call(handler, { url: `/api/forge-og?id=${MISSING_ID}` });
		expect(res.statusCode).toBe(404);
		expect(res.statusCode).toBe(missing.statusCode);
		expect(res.body).not.toContain('private prototype');
		expect(res.headers.location).toBeUndefined();

		const pub = await call(handler, { url: `/api/forge-og?id=${PUBLIC_ID}` });
		expect(pub.statusCode).toBe(302);
	});

	it('/api/forge-share redirects away from it like a missing id', async () => {
		const handler = (await import('../../api/forge-share.js')).default;
		const res = await call(handler, { url: `/api/forge-share?id=${PRIVATE_ID}` });
		const missing = await call(handler, { url: `/api/forge-share?id=${MISSING_ID}` });
		expect(res.statusCode).toBe(302);
		expect(res.headers.location).toBe(missing.headers.location);
		expect(res.body).not.toContain('private prototype');
	});

	it('/api/forge-keep never hands its file to a stranger, but does to its owner', async () => {
		const handler = (await import('../../api/forge-keep.js')).default;
		const keep = (id, headers = {}, method = 'GET') =>
			call(handler, {
				method,
				url: method === 'GET' ? `/api/forge-keep?creation_id=${id}` : '/api/forge-keep',
				headers,
				...(method === 'POST' ? { body: { creation_id: id } } : {}),
			});

		for (const method of ['GET', 'POST']) {
			const anon = await keep(PRIVATE_ID, {}, method);
			const stranger = await keep(PRIVATE_ID, asB, method);
			const missing = await keep(MISSING_ID, asB, method);
			for (const res of [anon, stranger]) {
				expect(res.statusCode).toBe(404);
				expect(res.json).toEqual(missing.json);
				expect(res.body).not.toContain('.glb');
			}
		}
		const owner = await keep(PRIVATE_ID, asA);
		expect(owner.statusCode).toBe(200);
		expect(owner.json.download_url).toContain(PRIVATE_ID);

		const pub = await keep(PUBLIC_ID, asB);
		expect(pub.statusCode).toBe(200);
	});
});

describe('/api/forge-comments writes', () => {
	let handler;
	beforeAll(async () => {
		handler = (await import('../../api/forge-comments.js')).default;
	});

	it('refuses a cookie-authenticated comment with no CSRF token, so another site cannot post as the user', async () => {
		const res = await call(handler, { method: 'POST', url: '/api/forge-comments', headers: asB, body: { creation_id: PUBLIC_ID, body: 'hi' } });
		expect(res.statusCode).toBe(403);
		expect(comments).toHaveLength(0);
	});

	it('refuses a CSRF token that belongs to another account', async () => {
		const res = await call(handler, {
			method: 'POST',
			url: '/api/forge-comments',
			headers: { ...asB, 'x-csrf-token': `csrf-${A.user}` },
			body: { creation_id: PUBLIC_ID, body: 'hi' },
		});
		expect(res.statusCode).toBe(403);
	});

	it('refuses a cross-site DELETE with no CSRF token, and only ever deletes the caller\'s own comment', async () => {
		comments.push({ id: 'c0000000-0000-4000-8000-0000000000aa', creation_id: PUBLIC_ID, user_id: A.user, body: 'mine', created_at: new Date() });
		const noToken = await call(handler, { method: 'DELETE', url: '/api/forge-comments', headers: asA, body: { comment_id: 'c0000000-0000-4000-8000-0000000000aa' } });
		expect(noToken.statusCode).toBe(403);

		const other = await call(handler, {
			method: 'DELETE',
			url: '/api/forge-comments',
			headers: { ...asB, 'x-csrf-token': `csrf-${B.user}` },
			body: { comment_id: 'c0000000-0000-4000-8000-0000000000aa' },
		});
		expect(other.statusCode).toBe(404);
		expect(comments).toHaveLength(1);
	});
});

// ================================================================ forged headers

describe('headers the caller controls', () => {
	it('a rotating x-forge-client id and a spoofed X-Forwarded-For do not mint a fresh rate-limit bucket', async () => {
		const handler = (await import('../../api/forge-vote.js')).default;
		for (const [i, client] of ['c-one', 'c-two', 'c-three'].entries()) {
			await call(handler, {
				method: 'POST',
				url: '/api/forge-vote',
				headers: { 'x-forge-client': client, 'x-forwarded-for': `198.51.100.${i + 1}, 203.0.113.5, 35.191.0.1` },
				body: { creation_id: PUBLIC_ID },
			});
		}
		const keys = limiterKeys.filter((k) => k.name === 'forgeVote').map((k) => k.key);
		expect(keys).toHaveLength(3);
		expect(new Set(keys)).toEqual(new Set(['203.0.113.5']));
	});

	it('a spoofed x-real-ip, x-vercel-forwarded-for or forwarded header is not the caller\'s address', async () => {
		const { clientIp } = await import('../../api/_lib/rate-limit.js');
		const ip = clientIp({
			headers: {
				'x-forwarded-for': '203.0.113.5, 35.191.0.1',
				'x-real-ip': '198.51.100.9',
				'x-vercel-forwarded-for': '198.51.100.10',
				forwarded: 'for=198.51.100.11',
				'cf-connecting-ip': '198.51.100.12',
			},
			socket: { remoteAddress: '10.0.0.1' },
		});
		expect(ip).toBe('203.0.113.5');
	});

	it('x-forge-seed that is not the platform secret grants no platform standing, and on-behalf-user is ignored without it', async () => {
		const { isPlatformCall, resolveCreator } = await import('../../api/_lib/creator-account.js');
		const forged = { headers: { 'x-forge-seed': 'guess', 'x-forge-on-behalf-user': A.user } };
		expect(isPlatformCall(forged)).toBe(false);
		expect(isPlatformCall({ headers: { 'x-forge-seed': '' } })).toBe(false);
		expect(isPlatformCall({ headers: {} })).toBe(false);
		const who = await resolveCreator({ ...forged }, mockRes());
		expect(who).toEqual({ user: null, platform: false });

		const real = { headers: { 'x-forge-seed': process.env.CRON_SECRET, 'x-forge-on-behalf-user': 'buyer-1' } };
		expect(isPlatformCall(real)).toBe(true);
	});

	it('x-forge-client alone never makes a stranger the owner of a signed-in account\'s model', async () => {
		// B sends A's *account* nothing, only a made-up client id. Owner only by hash match.
		for (const client of ['', 'anon', 'null', A.client.toUpperCase(), ` ${A.client}x`]) {
			expect(await store.isCreationOwner({ id: PUBLIC_ID, clientKey: store.ownerClientKey(hashClient(client)) })).toBe(false);
		}
	});
});

// ================================================================ hostile text on the share card

describe('hostile prompt text on /api/forge-share', () => {
	it('is escaped in the visible markup, the meta tags and the structured data', async () => {
		const handler = (await import('../../api/forge-share.js')).default;
		const hostile = `"><script>alert(1)</script><img src=x onerror=alert(2)> </script><script>alert(3)</script>`;
		rows.get(PUBLIC_ID).prompt = hostile;
		const res = await call(handler, { url: `/api/forge-share?id=${PUBLIC_ID}` });
		expect(res.statusCode).toBe(200);
		expect(res.body).not.toMatch(/<script>alert/);
		expect(res.body).not.toContain('<img src=x');
		const scriptOpeners = res.body.match(/<script\b/g) || [];
		const scriptClosers = res.body.match(/<\/script>/g) || [];
		expect(scriptClosers.length).toBe(scriptOpeners.length);
		expect(res.body).toContain('&lt;script&gt;');
	});
});

// ================================================================ user-supplied provider keys

describe('a provider key the caller supplies', () => {
	const KEY = 'tsk_USER_SUPPLIED_SECRET_KEY_0123456789';

	it('is sent only to the provider\'s own API host, only as a bearer header, never in a URL or body', async () => {
		upstreamCalls.length = 0;
		const { createTripoProvider } = await import('../../api/_providers/tripo.js');
		const gp = createTripoProvider(KEY);
		await gp.textToGeometry?.({ prompt: 'a chair', tier: 'standard' }).catch(() => {});
		await gp.imageTo3d?.({ imageUrl: 'https://cdn.example.com/a.png', tier: 'standard' }).catch(() => {});
		expect(upstreamCalls.length).toBeGreaterThan(0);
		for (const { url, init } of upstreamCalls) {
			expect(new URL(url).host).toBe('openapi.tripo3d.com');
			expect(url).not.toContain(KEY);
			expect(String(init.body ?? '')).not.toContain(KEY);
			expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
		}
	});

	it('does not appear in the error a rejected key produces', async () => {
		const { fetchUpstream } = await import('../../api/_lib/upstream-fetch.js');
		fetchUpstream.mockResolvedValueOnce(
			new Response(JSON.stringify({ code: 2002, message: 'invalid key' }), { status: 403, headers: { 'content-type': 'application/json' } }),
		);
		const { createTripoProvider } = await import('../../api/_providers/tripo.js');
		const err = await createTripoProvider(KEY).textToGeometry({ prompt: 'a chair', tier: 'standard' }).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(JSON.stringify({ message: err.message, code: err.code, stack: String(err.stack).split('\n')[0] })).not.toContain(KEY);
	});

	it('is never written to the idempotency store: only a body hash and the response are kept', async () => {
		idempotencyWrites.length = 0;
		const { withForgeIdempotency } = await import('../../api/_lib/forge-idempotency.js');
		const body = { prompt: 'a chair', provider_key: KEY };
		const payload = JSON.stringify(body);
		const req = Readable.from([Buffer.from(payload)]);
		req.method = 'POST';
		req.url = '/api/forge';
		req.headers = { host: 'three.ws', 'content-type': 'application/json', 'idempotency-key': 'idem-key-0001', 'x-forge-provider-key': KEY, 'content-length': String(payload.length) };
		const res = mockRes();
		await withForgeIdempotency(req, res, {
			scope: 'forge.generate',
			caller: 'client:abc',
			run: async () => {
				res.statusCode = 200;
				res.end(JSON.stringify({ ok: true, job_id: 'job-1' }));
			},
		});
		expect(idempotencyWrites.length).toBeGreaterThan(0);
		expect(JSON.stringify(idempotencyWrites)).not.toContain(KEY);
		expect(JSON.stringify(idempotencyWrites)).not.toContain('provider_key');
	});

	it('is resolved from the header ahead of any stored key, and the stored key is not consulted for another account', async () => {
		const { resolveProviderKeyWithSource } = await import('../../api/_lib/forge-provider-key.js');
		const found = await resolveProviderKeyWithSource({ headers: { 'x-forge-provider-key': KEY } }, {}, 'tripo');
		expect(found).toEqual({ key: KEY, source: 'inline' });
		// B has no stored key and sends none: B must not receive A's key or the house key for a keyless lane.
		const none = await resolveProviderKeyWithSource({ headers: { 'x-test-user': B.user } }, {}, 'meshy');
		expect(none).toEqual({ key: null, source: null });
	});
});
