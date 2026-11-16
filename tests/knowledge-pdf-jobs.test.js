// PDF knowledge jobs end to end on the real schema (api/_lib/schema.sql plus
// every migration, on PGlite): upload through the route, step the job through
// layout extraction, chunk, embed and store, then read the extracted tables
// back. Real PDFs (tests/_helpers/tiny-pdf.js) are parsed and rendered by
// pdf.js; only the network boundary is stubbed: the NVIDIA CV endpoints answer
// with boxes placed over the text the PDF really draws, and the embedding
// provider with a small deterministic vector space.

import { beforeAll, beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { Readable } from 'node:stream';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import sharp from 'sharp';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';
import { addVectorSupport } from './_helpers/pglite-vector.js';
import { buildPdf } from './_helpers/tiny-pdf.js';

const holder = vi.hoisted(() => ({ db: null, user: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/auth.js', () => ({
	getRequestUser: vi.fn(async () => holder.user),
	hasScope: (granted, required) => String(granted || '').split(/\s+/).includes(required),
}));
vi.mock('../api/_lib/csrf.js', () => ({ requireCsrf: vi.fn(async () => true) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authIp: vi.fn(async () => ({ success: true })), authedReadIp: vi.fn(async () => ({ success: true })) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/ops-alert.js', () => ({ sendOpsAlert: vi.fn(async () => ({ sent: false })) }));
const TAG = 'test/embed@3';
const embedText = (t) => {
	const s = t.toLowerCase();
	return [(s.match(/price/g) || []).length + 0.01, (s.match(/seat/g) || []).length + 0.01, (s.match(/plan/g) || []).length + 0.01];
};
vi.mock('../api/_lib/embeddings.js', () => ({
	embeddingsConfigured: () => true,
	embedderConfigured: (tag) => tag === TAG,
	defaultIngestEmbedderTag: () => TAG,
	embedPassagesAny: vi.fn(async (_tag, texts) => ({ tag: TAG, vectors: texts.map(embedText) })),
	embedPassagesEach: vi.fn(async (_tag, texts) => texts.map((t) => ({ tag: TAG, vector: embedText(t) }))),
	embedQuery: vi.fn(async (_tag, text) => embedText(text)),
}));
vi.mock('../api/_lib/rerank.js', () => ({ rerankConfigured: () => false, rerankPassages: vi.fn() }));

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.NVIDIA_API_KEY = 'nvapi-test-key';
delete process.env.GCP_MARKITDOWN_URL;
delete process.env.KNOWLEDGE_PDF_EXTRACTOR;

const { padBox, toCrop } = await import('../api/_lib/pdf-layout.js');
const embeddings = await import('../api/_lib/embeddings.js');
let jobs;
let handler;

// ── The document: a title, a paragraph, a 3x3 table and its caption ─────────
// PDF points (612 x 792, origin bottom-left) and the same places normalised
// top-left, which is the frame the detectors answer in.
const PT = { w: 612, h: 792 };
const ROWS = [
	{ y: 600, cells: ['Plan', 'Seats', 'Price'] },
	{ y: 580, cells: ['Starter', '3', '$12'] },
	{ y: 560, cells: ['Team', '25', '$90'] },
];
const COLS_X = [72, 250, 400];
function pricingPage() {
	return {
		texts: [
			{ x: 72, y: 720, text: 'Quarterly Pricing Report', size: 18 },
			{ x: 72, y: 680, text: 'Plans are billed monthly and every plan includes support.' },
			{ x: 72, y: 666, text: 'The table below lists the seats and price of each plan.' },
			...ROWS.flatMap((r) => r.cells.map((text, i) => ({ x: COLS_X[i], y: r.y, text }))),
			{ x: 72, y: 540, text: 'Table 1: Monthly price per plan.' },
		],
		lines: [{ x0: 70, y0: 595, x1: 470, y1: 595 }],
	};
}
const ny = (yPt) => 1 - yPt / PT.h;
const nx = (xPt) => xPt / PT.w;
const box = (x0, y0, x1, y1, confidence = 0.9) => ({ x_min: x0, y_min: y0, x_max: x1, y_max: y1, confidence });
const TABLE = { x0: nx(66), y0: ny(615), x1: nx(470), y1: ny(552) };
const CAPTION = { x0: nx(70), y0: ny(551), x1: nx(260), y1: ny(536) };
const TITLE = { x0: nx(70), y0: ny(742), x1: nx(330), y1: ny(716) };
const PARA = { x0: nx(70), y0: ny(692), x1: nx(400), y1: ny(662) };

// Rows and columns of TABLE, expressed in the crop the pipeline sends.
function structureForCrop() {
	const area = padBox(TABLE, 0.01);
	const rows = ROWS.map((r) => ({ x0: TABLE.x0, x1: TABLE.x1, y0: ny(r.y + 12), y1: ny(r.y - 4) }));
	const cols = [
		{ x0: nx(66), x1: nx(200) },
		{ x0: nx(240), x1: nx(330) },
		{ x0: nx(390), x1: nx(470) },
	].map((c) => ({ ...c, y0: TABLE.y0, y1: TABLE.y1 }));
	const toApi = (list) => toCrop(list, area).map((b) => box(b.x0, b.y0, b.x1, b.y1));
	return { row: toApi(rows), column: toApi(cols), cell: [] };
}

async function pageImage(init) {
	const url = JSON.parse(init.body).input[0].url;
	return sharp(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
}
async function hasInk(image, b) {
	const { width, height } = await image.metadata();
	const left = Math.floor(b.x0 * width);
	const top = Math.floor(b.y0 * height);
	const region = image.clone().extract({ left, top, width: Math.ceil((b.x1 - b.x0) * width), height: Math.ceil((b.y1 - b.y0) * height) });
	// stats() would describe the whole image; read the region's own pixels.
	const pixels = await region.greyscale().raw().toBuffer();
	return pixels.some((v) => v < 128);
}
const cv = (bounding_boxes) => ({ data: [{ index: 0, bounding_boxes }] });
let nvidia;
function stubNvidia({ pageElements = 'ok', phantomTable = false } = {}) {
	nvidia = { calls: [] };
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url, init) => {
			const u = String(url);
			nvidia.calls.push(u);
			const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
			if (u.endsWith('/nemotron-page-elements-v3')) {
				if (pageElements === 'retired') return reply(410, { detail: 'Gone' });
				// Detect like the model does: report a region only when the rendered
				// page really has ink there, so a page without the table gets none.
				const image = await pageImage(init);
				const found = async (b, conf) => ((await hasInk(image, b)) ? [box(b.x0, b.y0, b.x1, b.y1, conf)] : []);
				return reply(200, cv({
					title: [...(await found(TITLE, 0.9)), ...(await found(CAPTION, 0.6))],
					paragraph: await found(PARA, 0.9),
					// A false positive over blank space, as real detectors sometimes give.
					table: [...(await found(TABLE, 0.9)), ...(phantomTable ? [box(nx(72), ny(300), nx(500), ny(200), 0.5)] : [])],
				}));
			}
			if (u.endsWith('/nemotron-table-structure-v1')) return reply(200, cv(structureForCrop()));
			throw new Error(`unexpected fetch in test: ${u}`);
		}),
	);
}

// PGlite ships no pgvector, so the full-schema build skips the knowledge
// chunk table. Give it the two pieces of pgvector this code path uses: a
// `vector` type that accepts pgvector's text form ('[0.1,0.2]', which is also
// JSON) and the cosine distance operator <=>, computed exactly. Then apply
// the knowledge migrations again so the chunk table lands as written.
let OWNER;
let AGENT;
beforeAll(async () => {
	const { pg } = await createFullSchemaDb();
	await addVectorSupport(pg);
	holder.db = createPgliteSql({ pg });
	jobs = await import('../api/_lib/knowledge-pdf-jobs.js');
	({ default: handler } = await import('../api/agents/[id]/knowledge.js'));
	const [u] = await holder.db.sql`INSERT INTO users (email, display_name) VALUES ('pdf-jobs@example.invalid', 'PDF jobs') RETURNING id`;
	OWNER = u.id;
	const [a] = await holder.db.sql`INSERT INTO agent_identities (user_id, name) VALUES (${OWNER}, 'Pricing agent') RETURNING id`;
	AGENT = a.id;
}, 120_000);

beforeEach(async () => {
	holder.user = { id: OWNER, source: 'session' };
	await holder.db.sql`DELETE FROM agent_knowledge_jobs`;
	await holder.db.sql`DELETE FROM agent_knowledge_docs`;
	await holder.db.sql`UPDATE users SET plan = 'free' WHERE id = ${OWNER}`;
	stubNvidia();
});
afterEach(() => vi.unstubAllGlobals());

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
async function call(method, { query = {}, body, headers = {} } = {}) {
	const req = Readable.from(body == null ? [] : [Buffer.from(body)]);
	req.method = method;
	req.url = `/api/agents/[id]/knowledge?${new URLSearchParams({ id: AGENT, ...query })}`;
	req.headers = { origin: 'http://localhost:3000', ...headers };
	const res = mockRes();
	await handler(req, res);
	return { status: res.statusCode, body: res.json };
}
const uploadPdf = (bytes, name = 'pricing.pdf') =>
	call('POST', { body: bytes, headers: { 'content-type': 'application/pdf', 'x-file-name': encodeURIComponent(name) } });

async function runToEnd(jobId) {
	let job;
	for (let i = 0; i < 10; i++) {
		const r = await call('POST', { query: { job_id: jobId, action: 'step' } });
		expect(r.status).toBe(200);
		job = r.body.data.job;
		if (job.status === 'done' || job.status === 'failed') return job;
	}
	throw new Error(`job ${jobId} did not settle: ${JSON.stringify(job)}`);
}

describe('PDF upload as a layout job', () => {
	it('reads the table with page and element, previews it, and drops the file bytes', async () => {
		const pdf = buildPdf([pricingPage(), { texts: [{ x: 72, y: 700, text: 'Appendix: every price excludes local sales tax where it applies.' }, { x: 72, y: 686, text: 'Annual billing is available on request from the account team.' }] }]);
		const up = await uploadPdf(pdf);
		expect(up.status).toBe(202);
		expect(up.body.data.job).toMatchObject({ status: 'queued', page_count: 2, pages_done: 0, extractor: 'nemotron' });

		const job = await runToEnd(up.body.data.job.id);
		expect(job.status).toBe('done');
		expect(job.pages_done).toBe(2);
		expect(job.stats).toMatchObject({ tables: 1, charts: 0, scanned_pages: 0 });
		expect(job.tables).toHaveLength(1);
		expect(job.tables[0]).toMatchObject({ page: 1, caption: 'Table 1: Monthly price per plan.', rows: 3, columns: 3 });
		expect(job.tables[0].markdown).toBe('| Plan | Seats | Price |\n| --- | --- | --- |\n| Starter | 3 | $12 |\n| Team | 25 | $90 |');
		expect(job.doc).toMatchObject({ name: 'pricing.pdf', kind: 'pdf' });
		expect(job.doc.meta).toMatchObject({ extractor: 'nemotron', pages: 2, tables: 1 });

		const [row] = await holder.db.sql`SELECT file, blocks FROM agent_knowledge_jobs WHERE id = ${job.id}`;
		expect(row.file).toBeNull();
		expect(row.blocks).toEqual([]);

		const chunks = await holder.db.sql`SELECT heading, content, source FROM agent_knowledge_chunks WHERE doc_id = ${job.doc.id} ORDER BY chunk_index`;
		const table = chunks.find((c) => c.source?.element === 'table');
		expect(table.heading).toBe('Page 1 · Table 1: Monthly price per plan.');
		expect(table.source).toMatchObject({ page: 1, element: 'table' });
		expect(chunks.some((c) => c.source?.page === 2 && /sales tax/.test(c.content))).toBe(true);
		// The caption is attached to the table, never repeated as prose, and
		// table cells never leak into the paragraph chunk.
		const prose = chunks.filter((c) => c.source?.element === 'text').map((c) => c.content).join('\n');
		expect(prose).toContain('billed monthly');
		expect(prose).not.toContain('Table 1:');
		expect(prose).not.toContain('$90');

		const tables = await call('GET', { query: { doc_id: job.doc.id, action: 'tables' } });
		expect(tables.status).toBe(200);
		expect(tables.body.data.tables).toEqual([
			expect.objectContaining({ page: 1, heading: 'Page 1 · Table 1: Monthly price per plan.', content: expect.stringContaining('| Team | 25 | $90 |') }),
		]);

		const search = await call('POST', { query: { action: 'search' }, body: JSON.stringify({ query: 'price of the team plan' }), headers: { 'content-type': 'application/json' } });
		expect(search.status).toBe(200);
		expect(search.body.data.results[0].source).toMatchObject({ element: 'table', page: 1 });

		const again = await uploadPdf(pdf);
		expect(again.status).toBe(200);
		expect(again.body.data).toMatchObject({ duplicate: true, doc: { id: job.doc.id } });
	});

	it('falls back to the text layer when the NVIDIA models are unavailable, and says so', async () => {
		stubNvidia({ pageElements: 'retired' });
		const up = await uploadPdf(buildPdf([pricingPage()]), 'fallback.pdf');
		expect(up.status).toBe(202);
		const job = await runToEnd(up.body.data.job.id);
		expect(job.status).toBe('done');
		expect(job.extractor).toBe('text');
		expect(job.fallback_reason).toMatch(/410|retired|Gone/i);
		expect(job.doc.meta).toMatchObject({ extractor: 'text-layer', fallback_reason: expect.any(String) });
		expect(job.tables).toEqual([]);
		const [row] = await holder.db.sql`SELECT extractor, file, tables FROM agent_knowledge_jobs WHERE id = ${job.id}`;
		expect(row).toMatchObject({ extractor: 'text', file: null, tables: [] });
		const chunks = await holder.db.sql`SELECT content, source FROM agent_knowledge_chunks WHERE doc_id = ${job.doc.id}`;
		expect(chunks.map((c) => c.content).join('\n')).toContain('Starter');
		expect(chunks.every((c) => c.source === null)).toBe(true);
	});

	it('drops a detected table that holds no text instead of indexing a blank one', async () => {
		stubNvidia({ phantomTable: true });
		const up = await uploadPdf(buildPdf([pricingPage()]), 'phantom.pdf');
		const job = await runToEnd(up.body.data.job.id);
		expect(job.status).toBe('done');
		expect(job.stats.tables).toBe(1);
		expect(job.tables.map((t) => t.caption)).toEqual(['Table 1: Monthly price per plan.']);
		const chunks = await holder.db.sql`SELECT content, source FROM agent_knowledge_chunks WHERE doc_id = ${job.doc.id}`;
		expect(chunks.filter((c) => c.source?.element === 'table')).toHaveLength(1);
		expect(chunks.every((c) => c.content.trim())).toBe(true);
	});

	it('records the embedding space the chunks actually landed in on the doc', async () => {
		// The default lane is down, so every chunk is embedded by the next lane.
		embeddings.embedPassagesEach.mockImplementationOnce(async (_tag, texts) => texts.map((t) => ({ tag: 'test/fallback@3', vector: embedText(t) })));
		const up = await uploadPdf(buildPdf([pricingPage()]), 'fallback-space.pdf');
		const job = await runToEnd(up.body.data.job.id);
		expect(job.status).toBe('done');
		const [doc] = await holder.db.sql`SELECT embedder FROM agent_knowledge_docs WHERE id = ${job.doc.id}`;
		expect(doc.embedder).toBe('test/fallback@3');
	});

	it('uses the text path from the start when the setting turns layout extraction off', async () => {
		process.env.KNOWLEDGE_PDF_EXTRACTOR = 'text';
		try {
			const up = await uploadPdf(buildPdf([pricingPage()]), 'text-mode.pdf');
			expect(up.body.data.job.extractor).toBe('text');
			const job = await runToEnd(up.body.data.job.id);
			expect(job.status).toBe('done');
			expect(job.doc.meta.extractor).toBe('text-layer');
			expect(nvidia.calls).toHaveLength(0);
		} finally {
			delete process.env.KNOWLEDGE_PDF_EXTRACTOR;
		}
	});

	it('refuses a PDF over the plan page cap with the numbers, and accepts it on a paid plan', async () => {
		const big = buildPdf(Array.from({ length: 61 }, (_, i) => ({ texts: [{ x: 72, y: 700, text: `Page ${i + 1}` }] })));
		const r = await uploadPdf(big, 'big.pdf');
		expect(r.status).toBe(413);
		expect(r.body.error).toBe('too_many_pages');
		expect(r.body.page_count).toBe(61);
		expect(r.body.page_limit).toBe(60);
		expect(r.body.error_description).toMatch(/61 pages/);
		await holder.db.sql`UPDATE users SET plan = 'pro' WHERE id = ${OWNER}`;
		expect((await uploadPdf(big, 'big.pdf')).status).toBe(202);
	});

	it('rejects password-protected and broken files before holding any bytes', async () => {
		const locked = await uploadPdf(buildPdf([pricingPage()], { encrypt: true }), 'locked.pdf');
		expect(locked.status).toBe(422);
		expect(locked.body.error).toBe('encrypted_pdf');
		const broken = await uploadPdf(Buffer.from('%PDF-1.4\nthis is not a pdf'), 'broken.pdf');
		expect(broken.status).toBe(422);
		expect(broken.body.error).toBe('unreadable_pdf');
		const [{ n }] = await holder.db.sql`SELECT count(*)::int AS n FROM agent_knowledge_jobs`;
		expect(n).toBe(0);
	});

	it('answers a second upload of a file in flight with the running job', async () => {
		const pdf = buildPdf([pricingPage()]);
		const first = await uploadPdf(pdf);
		const second = await uploadPdf(pdf);
		expect(second.status).toBe(200);
		expect(second.body.data).toMatchObject({ duplicate: true, job: { id: first.body.data.job.id } });
	});

	it('leaves a leased job to its holder and lets the cron resume an abandoned one', async () => {
		const up = await uploadPdf(buildPdf([pricingPage()]));
		const id = up.body.data.job.id;
		await holder.db.sql`UPDATE agent_knowledge_jobs SET lease_until = now() + interval '1 minute' WHERE id = ${id}`;
		const blocked = await call('POST', { query: { job_id: id, action: 'step' } });
		expect(blocked.body.data.job).toMatchObject({ status: 'queued', pages_done: 0 });
		expect(nvidia.calls).toHaveLength(0);
		expect(await jobs.resumeStalled({ idleS: 0 })).toEqual([]);

		await holder.db.sql`UPDATE agent_knowledge_jobs SET lease_until = NULL, updated_at = now() - interval '5 minutes' WHERE id = ${id}`;
		const resumed = await jobs.resumeStalled({ idleS: 45 });
		expect(resumed).toEqual([{ id, status: 'done', pages_done: 1 }]);

		const listing = await call('GET');
		expect(listing.body.data.jobs).toEqual([]);
		expect(listing.body.data.docs).toHaveLength(1);
	});

	it('keeps other owners out of a job', async () => {
		const up = await uploadPdf(buildPdf([pricingPage()]));
		const [stranger] = await holder.db.sql`INSERT INTO users (email, display_name) VALUES ('stranger-pdf@example.invalid', 'Stranger') RETURNING id`;
		holder.user = { id: stranger.id, source: 'session' };
		const r = await call('POST', { query: { job_id: up.body.data.job.id, action: 'step' } });
		expect([403, 404]).toContain(r.status);
		expect(nvidia.calls).toHaveLength(0);
	});
});

describe('plan page limits', () => {
	it('maps plans to page caps', () => {
		expect(jobs.pageLimitForPlan('free')).toBe(60);
		expect(jobs.pageLimitForPlan(null)).toBe(60);
		expect(jobs.pageLimitForPlan('pro')).toBe(300);
		expect(jobs.pageLimitForPlan('team')).toBe(300);
		expect(jobs.pageLimitForPlan('enterprise')).toBe(1000);
	});
});
