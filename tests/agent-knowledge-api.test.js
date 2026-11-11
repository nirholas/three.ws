// Agent knowledge routes (api/agents/[id]/knowledge.js over api/_lib/agent-knowledge.js):
// auth, scope and ownership gates, the size and type checks that run before a
// byte is read or sent to the converter, the ingest wiring (converter, chunker,
// embedder, store), retrieval and delete.
//
// The converter worker and the embedding provider are external services, so
// fetch and the embeddings module are stubbed at that boundary. The database is
// an in-memory store that understands exactly the statements the module issues.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';
const AGENT = '33333333-3333-4333-8333-333333333333';
const OTHER_AGENT = '44444444-4444-4444-8444-444444444444';
const TAG = 'test/embed@3';

const db = { docs: [], chunks: [], seq: 0 };

function query(q, values) {
	if (q.startsWith('SELECT id, user_id, name FROM agent_identities')) {
		const owners = { [AGENT]: OWNER, [OTHER_AGENT]: STRANGER };
		return owners[values[0]] ? [{ id: values[0], user_id: owners[values[0]], name: 'Scout' }] : [];
	}
	if (q.startsWith('SELECT count(*)::int AS n FROM agent_knowledge_docs')) {
		return [{ n: db.docs.filter((d) => d.agent_id === values[0]).length }];
	}
	if (q.startsWith('SELECT ? FROM agent_knowledge_docs WHERE agent_id = ? AND sha256 = ?')) {
		return db.docs.filter((d) => d.agent_id === values[1] && d.sha256 === values[2]).map((d) => ({ ...d }));
	}
	if (q.startsWith('SELECT ? FROM agent_knowledge_docs WHERE agent_id = ? ORDER BY')) {
		return db.docs.filter((d) => d.agent_id === values[1]).map((d) => ({ ...d }));
	}
	if (q.startsWith('INSERT INTO agent_knowledge_docs')) {
		const [id, agent_id, uploaded_by, name, kind, mime, byte_size, sha256, title, meta, chunk_count, token_count, embedder] = values;
		const row = { id, agent_id, uploaded_by, name, kind, mime, byte_size, sha256, title, meta: JSON.parse(meta), chunk_count, token_count, embedder, created_at: '2026-11-11T00:00:00Z' };
		db.docs.push(row);
		return [{ ...row }];
	}
	if (q.startsWith('INSERT INTO agent_knowledge_chunks')) {
		const [docId, agentId, embedder, payload] = values;
		for (const r of JSON.parse(payload)) db.chunks.push({ id: ++db.seq, doc_id: docId, agent_id: agentId, embedder, ...r });
		return [];
	}
	if (q.startsWith('DELETE FROM agent_knowledge_docs WHERE id = ? AND agent_id = ?')) {
		const hit = db.docs.find((d) => d.id === values[0] && d.agent_id === values[1]);
		db.docs = db.docs.filter((d) => d !== hit);
		if (hit) db.chunks = db.chunks.filter((c) => c.doc_id !== hit.id);
		return hit ? [{ id: hit.id }] : [];
	}
	if (q.startsWith('SELECT embedder, count(*)::int AS n FROM agent_knowledge_chunks')) {
		const counts = {};
		for (const c of db.chunks.filter((c) => c.agent_id === values[0])) counts[c.embedder] = (counts[c.embedder] || 0) + 1;
		return Object.entries(counts).map(([embedder, n]) => ({ embedder, n }));
	}
	if (q.startsWith('SELECT c.id, c.doc_id, c.chunk_index')) {
		const [vec, agentId, embedder] = values;
		const qv = JSON.parse(vec);
		const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
		const norm = (a) => Math.sqrt(dot(a, a));
		return db.chunks
			.filter((c) => c.agent_id === agentId && c.embedder === embedder)
			.map((c) => {
				const e = JSON.parse(c.embedding);
				const d = db.docs.find((x) => x.id === c.doc_id);
				return { ...c, name: d.name, title: d.title, kind: d.kind, score: dot(qv, e) / (norm(qv) * norm(e)) };
			})
			.sort((a, b) => b.score - a.score);
	}
	throw new Error(`unexpected query in test: ${q.slice(0, 120)}`);
}

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn((strings, ...values) => {
		const q = strings.join('?').replace(/\s+/g, ' ').trim();
		if (q.startsWith('id, agent_id, uploaded_by')) return { __fragment: 'doc-columns' };
		return Promise.resolve().then(() => query(q, values));
	}),
}));

const authState = { user: null };
vi.mock('../api/_lib/auth.js', () => ({
	getRequestUser: vi.fn(async () => authState.user),
	hasScope: (granted, required) => String(granted || '').split(/\s+/).includes(required),
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));

// Three-dimensional toy vector space: a text's vector counts the words
// "return", "price" and "holiday" so similarity is predictable.
const embedText = (t) => {
	const s = t.toLowerCase();
	return [(s.match(/return/g) || []).length + 0.01, (s.match(/price/g) || []).length + 0.01, (s.match(/holiday/g) || []).length + 0.01];
};
vi.mock('../api/_lib/embeddings.js', () => ({
	embeddingsConfigured: () => true,
	embedderConfigured: (tag) => tag === TAG,
	defaultIngestEmbedderTag: () => TAG,
	embedPassagesAny: vi.fn(async (_tag, texts) => ({ tag: TAG, vectors: texts.map(embedText) })),
	embedQuery: vi.fn(async (_tag, text) => embedText(text)),
}));
vi.mock('../api/_lib/rerank.js', () => ({ rerankConfigured: () => false, rerankPassages: vi.fn() }));

const lib = await import('../api/_lib/agent-knowledge.js');
const { default: handler } = await import('../api/agents/[id]/knowledge.js');

function mockRes() {
	return {
		statusCode: 200,
		_headers: {},
		_body: '',
		setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
		getHeader(k) { return this._headers[k.toLowerCase()]; },
		end(b) { this._body = b || ''; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
		get json() { try { return JSON.parse(this._body); } catch { return null; } },
	};
}

async function call(method, { agent = AGENT, docId, action, body, headers = {} } = {}) {
	const chunks = body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
	const req = Readable.from(chunks);
	const qs = new URLSearchParams({ id: agent, ...(docId ? { doc_id: docId } : {}), ...(action ? { action } : {}) });
	req.method = method;
	req.url = `/api/agents/[id]/knowledge?${qs}`;
	req.headers = { origin: 'http://localhost:3000', ...headers };
	const res = mockRes();
	await handler(req, res);
	return { status: res.statusCode, body: res.json };
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const upload = (name, bytes, extra = {}) =>
	call('POST', { body: bytes, headers: { 'x-file-name': encodeURIComponent(name), 'content-type': DOCX_MIME, ...extra } });

const HANDBOOK_MD = [
	'# Field Handbook',
	'',
	'This handbook is for new technicians and covers what to do on day one at the depot: where to park, who signs you in, and which bay you start in. Read it before your first shift.',
	'',
	'## Returns',
	'',
	'A customer may return a repaired unit within 45 days for a free second inspection. Every return needs the blue job card, and the return is logged on the depot board by the shift lead.',
	'',
	'## Price list',
	'',
	'The price of a battery check is 19 EUR. The price of a screen is 189 EUR. Every price includes labour, parts and the written report the customer takes home. Quotes are valid for 30 days.',
].join('\n');

let fetchMock;
beforeEach(() => {
	db.docs = [];
	db.chunks = [];
	db.seq = 0;
	authState.user = { id: OWNER, source: 'session' };
	process.env.GCP_MARKITDOWN_URL = 'https://markitdown.test';
	process.env.GCP_RECONSTRUCTION_KEY = 'k'.repeat(64);
	fetchMock = vi.fn(async () =>
		new Response(
			JSON.stringify({
				markdown: HANDBOOK_MD,
				metadata: { kind: 'docx', title: 'Field Handbook', words: 60, chars: HANDBOOK_MD.length, truncated: false },
				file: { name: 'handbook.docx', kind: 'docx', bytes: 2048, sha256: 'a'.repeat(64) },
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		),
	);
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('auth and ownership', () => {
	it('401s without a session or token', async () => {
		authState.user = null;
		const r = await upload('handbook.docx', Buffer.from('PK'));
		expect(r.status).toBe(401);
		expect((await call('GET')).status).toBe(401);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('403s a bearer token without agents:write on upload, and without agents:read on list', async () => {
		authState.user = { id: OWNER, source: 'bearer', scope: 'agents:read' };
		const r = await upload('handbook.docx', Buffer.from('PK'));
		expect(r.status).toBe(403);
		expect(r.body.error).toBe('insufficient_scope');
		authState.user = { id: OWNER, source: 'bearer', scope: 'profile' };
		expect((await call('GET')).status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("403s an upload to someone else's agent and 404s an unknown agent", async () => {
		const r = await call('POST', { agent: OTHER_AGENT, body: 'PK', headers: { 'x-file-name': 'a.docx', 'content-type': DOCX_MIME } });
		expect(r.status).toBe(403);
		expect(fetchMock).not.toHaveBeenCalled();
		expect((await call('GET', { agent: '55555555-5555-4555-8555-555555555555' })).status).toBe(404);
	});

	it('400s an agent id that is not a uuid', async () => {
		expect((await call('GET', { agent: 'not-a-uuid' })).status).toBe(400);
	});
});

describe('size and type checks run before the converter is called', () => {
	it('413s a declared Content-Length over the cap without reading the body', async () => {
		const r = await upload('big.docx', Buffer.from('PK'), { 'content-length': String(lib.MAX_UPLOAD_BYTES + 1) });
		expect(r.status).toBe(413);
		expect(r.body.error).toBe('file_too_large');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('413s a body over the cap even when no length was declared', async () => {
		const r = await upload('big.docx', Buffer.alloc(lib.MAX_UPLOAD_BYTES + 10, 1));
		expect(r.status).toBe(413);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('415s a file type MarkItDown is not allowed to read here', async () => {
		for (const name of ['notes.txt', 'page.html', 'legacy.doc', 'archive.zip', 'noextension']) {
			const r = await upload(name, Buffer.from('hello'));
			expect(r.status, name).toBe(415);
			expect(r.body.error).toBe('unsupported_type');
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('400s a missing file name and an empty body', async () => {
		expect((await call('POST', { body: 'x', headers: {} })).body.error).toBe('missing_file_name');
		expect((await upload('empty.docx', Buffer.alloc(0))).body.error).toBe('empty_file');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('503s with a clear message when the converter is not configured', async () => {
		delete process.env.GCP_MARKITDOWN_URL;
		const r = await upload('handbook.docx', Buffer.from('PK'));
		expect(r.status).toBe(503);
		expect(r.body.error).toBe('converter_unavailable');
	});

	it("passes the converter's own rejection (a renamed file, a zip bomb) through to the caller", async () => {
		fetchMock.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: 'zip_bomb', message: 'A part of this package compresses 1028x.' }), { status: 400 }),
		);
		const r = await upload('bomb.docx', Buffer.from('PK'));
		expect(r.status).toBe(400);
		expect(r.body).toMatchObject({ error: 'zip_bomb', error_description: 'A part of this package compresses 1028x.' });
		expect(db.docs).toHaveLength(0);
	});
});

describe('ingest, list, retrieve, delete', () => {
	it('sends the raw file to the converter with the bearer key and the real file name', async () => {
		await upload('Field Handbook.docx', Buffer.from('PK-real-bytes'));
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('https://markitdown.test/convert');
		expect(init.method).toBe('POST');
		expect(init.headers.Authorization).toBe(`Bearer ${'k'.repeat(64)}`);
		expect(init.headers['X-File-Name']).toBe(encodeURIComponent('Field Handbook.docx'));
		expect(init.headers['Content-Type']).toBe(DOCX_MIME);
		expect(Buffer.from(init.body).toString()).toBe('PK-real-bytes');
	});

	it('stores the doc record and one embedded chunk per section', async () => {
		const r = await upload('handbook.docx', Buffer.from('PK-real-bytes'));
		expect(r.status).toBe(201);
		const doc = r.body.data.doc;
		expect(doc).toMatchObject({ name: 'handbook.docx', kind: 'docx', title: 'Field Handbook', byte_size: 13, uploaded_by: OWNER });
		expect(doc.chunk_count).toBe(db.chunks.length);
		expect(db.chunks.map((c) => c.heading)).toEqual(['Field Handbook', 'Field Handbook > Returns', 'Field Handbook > Price list']);
		expect(db.chunks.every((c) => c.embedder === TAG && JSON.parse(c.embedding).length === 3)).toBe(true);
	});

	it('answers a re-upload of the same file with the existing doc instead of a copy', async () => {
		await upload('handbook.docx', Buffer.from('same'));
		const again = await upload('handbook-copy.docx', Buffer.from('same'));
		expect(again.status).toBe(200);
		expect(again.body.data.duplicate).toBe(true);
		expect(db.docs).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('lists docs with chunk counts', async () => {
		await upload('handbook.docx', Buffer.from('PK'));
		const r = await call('GET');
		expect(r.status).toBe(200);
		expect(r.body.data.docs).toHaveLength(1);
		expect(r.body.data.docs[0]).toMatchObject({ name: 'handbook.docx', chunk_count: 3 });
		expect(r.body.data.limits).toMatchObject({ max_docs: lib.MAX_DOCS_PER_AGENT, max_bytes: lib.MAX_UPLOAD_BYTES });
		expect(r.body.data.formats.map((f) => f.extension)).toEqual(['.docx', '.pptx', '.xlsx', '.pdf', '.msg']);
	});

	it('retrieves the matching section for a question, labelled with the doc name', async () => {
		await upload('handbook.docx', Buffer.from('PK'));
		const r = await call('POST', { action: 'search', body: { query: 'what does a screen price come to?' }, headers: { 'content-type': 'application/json' } });
		expect(r.status).toBe(200);
		expect(r.body.data.results[0]).toMatchObject({ name: 'handbook.docx', heading: 'Field Handbook > Price list' });
		expect(r.body.data.results[0].excerpt).toContain('189 EUR');
	});

	it('deletes a doc and every one of its chunks', async () => {
		const up = await upload('handbook.docx', Buffer.from('PK'));
		const id = up.body.data.doc.id;
		const r = await call('DELETE', { docId: id });
		expect(r.status).toBe(200);
		expect(db.docs).toHaveLength(0);
		expect(db.chunks).toHaveLength(0);
		expect((await call('DELETE', { docId: id })).status).toBe(404);
	});
});

describe('chat grounding', () => {
	it('returns nothing (and embeds nothing) for an agent without documents', async () => {
		const { embedQuery } = await import('../api/_lib/embeddings.js');
		embedQuery.mockClear();
		expect(await lib.retrieveForChat(AGENT, 'any return policy?')).toEqual([]);
		expect(embedQuery).not.toHaveBeenCalled();
	});

	it('builds a prompt block that names each source and asks for citations', async () => {
		await upload('handbook.docx', Buffer.from('PK'));
		const hits = await lib.retrieveForChat(AGENT, 'how long do customers have to return a unit?');
		expect(hits[0]).toMatchObject({ name: 'handbook.docx', heading: 'Field Handbook > Returns' });
		const block = lib.knowledgePromptBlock(hits);
		expect(block).toContain('[Source: handbook.docx | Field Handbook > Returns]');
		expect(block).toContain('within 45 days');
		expect(block).toMatch(/cite the source document by name/i);
		expect(block).toMatch(/not instructions/i);
		expect(lib.knowledgePromptBlock([])).toBe('');
	});
});
