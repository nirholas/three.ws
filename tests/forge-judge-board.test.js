// Forge judge shadow log and its operator board: the real migration and SQL on
// PGlite, the recorder the live gate and the eval share, and the board library
// the forge:judge CLI reads and labels through. There is no admin page or admin
// HTTP endpoint for the board; the last block pins that.

import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const holder = vi.hoisted(() => ({ db: null, puts: [], objects: new Map() }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
// Storage as it behaves during an R2 outage: putObject lands the bytes in the
// GCS fallback bucket, getObjectBuffer reads them back through its fallback
// retry, and a presigned R2 link points at an object R2 does not have.
vi.mock('../api/_lib/r2.js', () => ({
	putObject: async ({ key, body }) => { holder.puts.push(key); holder.objects.set(key, Buffer.from(body)); },
	getObjectBuffer: async (key) => {
		if (!holder.objects.has(key)) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
		return holder.objects.get(key);
	},
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
let board;
beforeAll(async () => {
	({ recordJudgeShadow } = await import('../api/_lib/forge-judge-shadow.js'));
	board = await import('../api/_lib/forge-judge-board.js');
});
beforeEach(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(migration);
	holder.puts = [];
	holder.objects = new Map();
});

describe('recordJudgeShadow', () => {
	it('stores both verdicts, the views and the disagreement, without any reasoning field', async () => {
		const id = await recordJudgeShadow({ source: 'forge', creationId: 'c1', glbUrl: 'https://three.ws/cdn/a.glb', prompt: 'a lamp', current: currentPass, currentLatencyMs: 3200, cosmos: { ...cosmosReject, trace: 'should never be stored' }, views: VIEWS, mode: 'shadow' });
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
		const id = await recordJudgeShadow({ glbUrl: 'https://three.ws/cdn/b.glb', current: currentDown, cosmos: cosmosReject, mode: 'shadow' });
		const [row] = await holder.db.sql`select disagree, current_pass from forge_judge_shadow where id = ${id}`;
		expect(row).toEqual({ disagree: false, current_pass: null });
	});

	it('keeps one eval row per creation so a resumed eval never double counts', async () => {
		const args = { source: 'eval', creationId: 'c9', glbUrl: 'https://three.ws/cdn/c.glb', current: currentPass, cosmos: cosmosPass, mode: 'shadow', humanLabel: 'accepted', labelledBy: 'forge-user' };
		expect(await recordJudgeShadow(args)).toBeTruthy();
		expect(await recordJudgeShadow(args)).toBeNull();
		const [{ n }] = await holder.db.sql`select count(*)::int as n from forge_judge_shadow`;
		expect(n).toBe(1);
	});
});

describe('forge judge board', () => {
	beforeEach(async () => {
		await recordJudgeShadow({ source: 'forge', creationId: 'd1', glbUrl: 'https://three.ws/cdn/d1.glb', current: currentPass, cosmos: cosmosReject, views: VIEWS, mode: 'shadow' });
		await recordJudgeShadow({ source: 'eval', creationId: 'a1', glbUrl: 'https://three.ws/cdn/a1.glb', current: currentPass, cosmos: cosmosPass, mode: 'shadow', humanLabel: 'accepted', labelledBy: 'forge-user' });
	});

	it('lists disagreements by default, with totals', async () => {
		const page = await board.listJudgeRows();
		expect(page.rows.map((r) => r.creation_id)).toEqual(['d1']);
		expect(page.rows[0].render_keys).toHaveLength(4);
		expect(page.nextBefore).toBeNull();
		expect(await board.judgeTotals()).toMatchObject({ rows: 2, disagree: 1, both_answered: 2, labelled: 1, current_agrees: 1, cosmos_agrees: 1 });
		expect(await board.judgeTotals('eval')).toMatchObject({ rows: 1, disagree: 0 });
	});

	it('pages newest first by row id', async () => {
		const first = await board.listJudgeRows({ view: 'all', limit: 1 });
		expect(first.rows.map((r) => r.creation_id)).toEqual(['a1']);
		expect(first.nextBefore).toBe(String(first.rows[0].id));
		const second = await board.listJudgeRows({ view: 'all', limit: 1, before: first.nextBefore });
		expect(second.rows.map((r) => r.creation_id)).toEqual(['d1']);
		expect(second.nextBefore).toBeNull();
	});

	it('reads every view a row stores, even when the view only reached the fallback bucket', async () => {
		const [row] = (await board.listJudgeRows()).rows;
		for (const key of row.render_keys) {
			expect(board.isJudgeRenderKey(key), key).toBe(true);
			expect((await board.readJudgeView(key)).equals(PNG)).toBe(true);
		}
	});

	it('reads only judge views', async () => {
		holder.objects.set('avatars/private/secret.png', PNG);
		await expect(board.readJudgeView('avatars/private/secret.png')).rejects.toThrow(TypeError);
		await expect(board.readJudgeView('forge/judge-shadow/../../avatars/private/secret.png')).rejects.toThrow(TypeError);
		await expect(board.readJudgeView('forge/judge-shadow/eval/x/./front.png')).rejects.toThrow(TypeError);
		await expect(board.readJudgeView('forge/judge-shadow/eval/missing/front.png')).rejects.toThrow('NoSuchKey');
	});

	it('filters by view, source and Cosmos issue', async () => {
		const ids = async (o) => (await board.listJudgeRows(o)).rows.map((r) => r.creation_id);
		expect(await ids({ view: 'all', source: 'eval' })).toEqual(['a1']);
		expect(await ids({ view: 'all', issue: 'floating_parts' })).toEqual(['d1']);
		expect(await ids({ view: 'cosmos_reject' })).toEqual(['d1']);
		expect(await ids({ view: 'unlabelled' })).toEqual(['d1']);
	});

	it('records, then clears, an operator label', async () => {
		const [{ id }] = await holder.db.sql`select id from forge_judge_shadow where creation_id = 'd1'`;
		const set = await board.labelJudgeRow({ id, label: 'rejected', actor: 'cli:ops' });
		expect(set).toMatchObject({ human_label: 'rejected', labelled_by: 'admin:cli:ops' });
		expect(set.labelled_at).toBeTruthy();
		expect((await board.listJudgeRows({ view: 'unlabelled' })).rows).toHaveLength(0);
		const cleared = await board.labelJudgeRow({ id, label: null, actor: 'cli:ops' });
		expect(cleared).toMatchObject({ human_label: null, labelled_by: null, labelled_at: null });
		await expect(board.labelJudgeRow({ id, label: 'maybe', actor: 'cli:ops' })).rejects.toThrow(TypeError);
		await expect(board.labelJudgeRow({ id: 'x; drop table', label: 'accepted' })).rejects.toThrow(TypeError);
		expect(await board.labelJudgeRow({ id: 999999, label: 'accepted', actor: 'cli:ops' })).toBeNull();
	});
});

describe('no admin surface for operator review', () => {
	const routes = JSON.parse(readFileSync('vercel.json', 'utf8')).routes.map((r) => `${r.src || ''} ${r.dest || ''}`).join('\n');
	const vite = readFileSync('vite.config.js', 'utf8');

	it('serves no forge judge board page or endpoint', () => {
		for (const f of ['api/admin/forge-judge.js', 'pages/forge-judge-admin.html', 'src/forge-judge-admin.js']) expect(existsSync(f), f).toBe(false);
		expect(routes).not.toMatch(/forge-judge/);
		expect(vite).not.toMatch(/forge-judge/);
	});

	it('serves no content-safety review endpoint', () => {
		expect(existsSync('api/admin/content-safety.js')).toBe(false);
		expect(routes).not.toMatch(/content-safety/);
	});

	it('keeps both reviews reachable from the CLIs', () => {
		const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
		expect(scripts['forge:judge']).toBe('node scripts/forge-judge.mjs');
		expect(scripts['forge:safety']).toBe('node scripts/forge-safety.mjs');
	});
});
