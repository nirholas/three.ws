// Forge judge shadow log and its admin board: the real migration and SQL on
// PGlite, the recorder the live gate and the eval share, and the
// /api/admin/forge-judge auth gate, filters and labelling.

import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const holder = vi.hoisted(() => ({ db: null, auth: { ok: true, actor: 'ops-test' }, puts: [] }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
vi.mock('../api/_lib/ops-auth.js', () => ({ authorizeOps: async () => holder.auth }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { authedReadIp: async () => ({ success: true }) },
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/r2.js', () => ({
	putObject: async ({ key }) => { holder.puts.push(key); },
	presignGet: async ({ key }) => `https://r2.example/${key}?sig=1`,
}));

const migration = readFileSync('api/_lib/migrations/20261116181500_forge_judge_shadow.sql', 'utf8');
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const VIEWS = ['front', 'right', 'back', 'left'].map((name) => ({ name, png: PNG }));

const currentPass = { pass: true, score: 74, completeness: 80, defects: [], qa_available: true, provider: 'cloudflare', model: '@cf/meta/llama-4-scout', subject: 'object' };
const currentDown = { pass: true, score: null, defects: [], qa_available: false, reason: 'qa_unavailable: scoring failed' };
const cosmosReject = { available: true, pass: false, plausible: false, issues: ['floating_parts'], prompt_match: 'yes', confidence: 0.9, model: 'nvidia/cosmos-reason2-8b', latency_ms: 2100, views: 4 };
const cosmosPass = { ...cosmosReject, pass: true, plausible: true, issues: [] };

let recordJudgeShadow;
let handler;
beforeAll(async () => {
	({ recordJudgeShadow } = await import('../api/_lib/forge-judge-shadow.js'));
	handler = (await import('../api/admin/forge-judge.js')).default;
});
beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(migration);
	holder.auth = { ok: true, actor: 'ops-test' };
	holder.puts = [];
});

function call({ method = 'GET', query = '', body } = {}) {
	const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []);
	Object.assign(req, { method, url: `/api/admin/forge-judge${query}`, headers: body ? { 'content-type': 'application/json' } : {} });
	const res = {
		statusCode: 200, headers: {}, body: '',
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		writeHead(code, h) { this.statusCode = code; Object.assign(this.headers, h || {}); return this; },
		end(b) { this.body = b ? String(b) : ''; this.writableEnded = true; },
	};
	return handler(req, res).then(() => ({ status: res.statusCode, json: res.body ? JSON.parse(res.body) : null }));
}

describe('recordJudgeShadow', () => {
	it('stores both verdicts, the views and the disagreement, without any reasoning field', async () => {
		const id = await recordJudgeShadow({ source: 'forge', creationId: 'c1', glbUrl: 'https://cdn.three.ws/a.glb', prompt: 'a lamp', current: currentPass, currentLatencyMs: 3200, cosmos: { ...cosmosReject, trace: 'should never be stored' }, views: VIEWS, mode: 'shadow' });
		expect(id).toBeTruthy();
		expect(holder.puts).toHaveLength(4);
		const [row] = await holder.db.sql`select * from forge_judge_shadow where id = ${id}`;
		expect(row.disagree).toBe(true);
		expect(row.current_pass).toBe(true);
		expect(row.cosmos_pass).toBe(false);
		expect(row.render_keys).toHaveLength(4);
		expect(row.current).toMatchObject({ available: true, score: 74, latency_ms: 3200 });
		expect(row.cosmos).toMatchObject({ issues: ['floating_parts'], confidence: 0.9 });
		expect(JSON.stringify(row.cosmos)).not.toContain('should never be stored');
	});

	it('does not count a disagreement when the current judge had no verdict', async () => {
		const id = await recordJudgeShadow({ glbUrl: 'https://cdn.three.ws/b.glb', current: currentDown, cosmos: cosmosReject, mode: 'shadow' });
		const [row] = await holder.db.sql`select disagree, current_pass from forge_judge_shadow where id = ${id}`;
		expect(row).toEqual({ disagree: false, current_pass: null });
	});

	it('keeps one eval row per creation so a resumed eval never double counts', async () => {
		const args = { source: 'eval', creationId: 'c9', glbUrl: 'https://cdn.three.ws/c.glb', current: currentPass, cosmos: cosmosPass, mode: 'shadow', humanLabel: 'accepted', labelledBy: 'forge-user' };
		expect(await recordJudgeShadow(args)).toBeTruthy();
		expect(await recordJudgeShadow(args)).toBeNull();
		const [{ n }] = await holder.db.sql`select count(*)::int as n from forge_judge_shadow`;
		expect(n).toBe(1);
	});
});

describe('/api/admin/forge-judge', () => {
	beforeEach(async () => {
		await recordJudgeShadow({ source: 'forge', creationId: 'd1', glbUrl: 'https://cdn.three.ws/d1.glb', current: currentPass, cosmos: cosmosReject, views: VIEWS, mode: 'shadow' });
		await recordJudgeShadow({ source: 'eval', creationId: 'a1', glbUrl: 'https://cdn.three.ws/a1.glb', current: currentPass, cosmos: cosmosPass, mode: 'shadow', humanLabel: 'accepted', labelledBy: 'forge-user' });
	});

	it('refuses without an admin session', async () => {
		holder.auth = { ok: false };
		expect((await call()).status).toBe(401);
	});

	it('lists disagreements first by default, with signed view links and totals', async () => {
		const { status, json } = await call();
		expect(status).toBe(200);
		expect(json.rows).toHaveLength(1);
		expect(json.rows[0].creation_id).toBe('d1');
		expect(json.rows[0].renders[0].url).toMatch(/^https:\/\/r2\.example\/forge\/judge-shadow\/forge\//);
		expect(json.totals).toMatchObject({ rows: 2, disagree: 1, both_answered: 2, labelled: 1, current_agrees: 1, cosmos_agrees: 1 });
		expect(json.issues).toContain('floating_parts');
	});

	it('filters by source and by Cosmos issue', async () => {
		expect((await call({ query: '?view=all&source=eval' })).json.rows.map((r) => r.creation_id)).toEqual(['a1']);
		expect((await call({ query: '?view=all&issue=floating_parts' })).json.rows.map((r) => r.creation_id)).toEqual(['d1']);
		expect((await call({ query: '?view=all&issue=bogus' })).status).toBe(400);
	});

	it('records, then clears, an operator label', async () => {
		const [{ id }] = await holder.db.sql`select id from forge_judge_shadow where creation_id = 'd1'`;
		const set = await call({ method: 'POST', body: { id, label: 'rejected' } });
		expect(set.status).toBe(200);
		expect(set.json.row).toMatchObject({ human_label: 'rejected', labelled_by: 'admin:ops-test' });
		expect((await call({ query: '?view=unlabelled' })).json.rows).toHaveLength(0);
		const cleared = await call({ method: 'POST', body: { id, label: null } });
		expect(cleared.json.row.human_label).toBeNull();
		expect((await call({ method: 'POST', body: { id, label: 'maybe' } })).status).toBe(400);
		expect((await call({ method: 'POST', body: { id: 999999, label: 'accepted' } })).status).toBe(404);
	});
});
