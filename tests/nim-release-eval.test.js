// Day-0 NIM release pipeline: lane classification from probes (never names),
// idempotent enqueue from the catalog watch over real SQL (PGlite with the
// real migration), the shape of a stored evaluation, and the guarantee that a
// run never switches production config by itself.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
delete process.env.KNOWLEDGE_RERANK_MODEL;
delete process.env.PUBLISH_SAFETY_MODEL;

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

const { nimClient, classifyNimModel } = await import('../api/_lib/nim-lanes.js');
const evalLib = await import('../api/_lib/nim-lane-eval.js');
const store = await import('../api/_lib/nim-release-store.js');
const { watchNvidiaReleases } = await import('../api/cron/free-model-audit.js');
const { runNextReleaseEval, buildEvalAlert } = await import('../api/cron/nim-release-eval.js');

const MIGRATION = readFileSync('api/_lib/migrations/20261116170833_nim_release_evals.sql', 'utf8');
const RERANK_SET = JSON.parse(readFileSync('data/evals/rerank/v1.json', 'utf8'));

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
const chatBody = (content) => ({ choices: [{ message: { content } }] });

/**
 * A fetch stand-in that answers per endpoint. `behaviour` maps endpoint kind
 * (embeddings | chat | vision | rerank) to a function (body) => [status, json].
 */
function fakeNim(behaviour) {
	const calls = [];
	const fetchImpl = vi.fn(async (url, init) => {
		const body = JSON.parse(init.body);
		const kind = url.endsWith('/embeddings') ? 'embeddings'
			: url.endsWith('/reranking') ? 'rerank'
				: Array.isArray(body.messages?.[0]?.content) ? 'vision' : 'chat';
		calls.push({ kind, model: body.model, url });
		const fn = behaviour[kind];
		const [status, json] = fn ? fn(body) : [404, { detail: '404 page not found' }];
		return reply(status, json);
	});
	return { client: nimClient({ key: 'test-key', fetchImpl, retries: 0 }), calls, fetchImpl };
}

describe('classifyNimModel: lane from probes, never from the name', () => {
	it('an id that says "embed" but answers chat and sees images is vision', async () => {
		const { client } = fakeNim({
			chat: () => [200, chatBody('ok')],
			vision: () => [200, chatBody('Red')],
		});
		const c = await classifyNimModel({ id: 'nvidia/fake-embed-1b', ownedBy: 'nvidia', client });
		expect(c).toMatchObject({ lane: 'vision', availability: 'live', ownedBy: 'nvidia' });
		expect(c.probes.embeddings.ok).toBe(false);
		expect(c.probes.vision.sample).toBe('Red');
	});

	it('an id that says "vl" but refuses image input is chat', async () => {
		const { client } = fakeNim({
			chat: () => [200, chatBody('ok')],
			vision: () => [400, { detail: 'multimodal processing is not enabled' }],
		});
		const c = await classifyNimModel({ id: 'nvidia/fake-vl-120b', client });
		expect(c.lane).toBe('chat');
		expect(c.reason).toMatch(/image input refused \(400\)/);
	});

	it('a chat reply the image probe could not see stays chat', async () => {
		const { client } = fakeNim({ chat: () => [200, chatBody('ok')], vision: () => [200, chatBody('Blue')] });
		expect((await classifyNimModel({ id: 'nvidia/x', client })).lane).toBe('chat');
	});

	it('a numeric vector from /embeddings is the embeddings lane, with its dimension', async () => {
		const { client, calls } = fakeNim({ embeddings: () => [200, { data: [{ embedding: [0.1, 0.2, 0.3, 0.4] }] }] });
		const c = await classifyNimModel({ id: 'nvidia/fake-chat-model', client });
		expect(c).toMatchObject({ lane: 'embeddings', dim: 4 });
		expect(calls.map((x) => x.kind)).toEqual(['embeddings']);
	});

	it('a chat reply that is a safety verdict is the safety lane', async () => {
		const { client } = fakeNim({ chat: () => [200, chatBody('{"User Safety": "safe"}')] });
		expect((await classifyNimModel({ id: 'nvidia/fake-instruct', client })).lane).toBe('safety');
	});

	it('a full ranking from the retrieval host is the rerank lane', async () => {
		const { client } = fakeNim({ rerank: () => [200, { rankings: [{ index: 1, logit: 3 }, { index: 0, logit: -2 }] }] });
		expect((await classifyNimModel({ id: 'nvidia/fake-guard', client })).lane).toBe('rerank');
	});

	it('reads availability from the failures: 410 retired, account 404 not entitled, 5xx unreachable, else unsupported', async () => {
		const gone = fakeNim({ embeddings: () => [410, { detail: 'end of life' }], chat: () => [410, { detail: 'end of life' }], rerank: () => [404, {}] });
		expect(await classifyNimModel({ id: 'a', client: gone.client })).toMatchObject({ lane: null, availability: 'retired' });

		const locked = fakeNim({ chat: () => [404, { detail: 'Function not found for account abc' }] });
		expect(await classifyNimModel({ id: 'b', client: locked.client })).toMatchObject({ lane: null, availability: 'not_entitled' });

		const down = fakeNim({ embeddings: () => [503, {}], chat: () => [503, {}], rerank: () => [503, {}] });
		expect(await classifyNimModel({ id: 'c', client: down.client })).toMatchObject({ lane: null, availability: 'unreachable' });

		const speech = fakeNim({ chat: () => [400, { detail: 'unsupported' }], embeddings: () => [400, {}], rerank: () => [400, {}] });
		const s = await classifyNimModel({ id: 'nvidia/riva-tts', client: speech.client });
		expect(s).toMatchObject({ lane: null, availability: 'unsupported' });
		expect(s.reason).toMatch(/gRPC/);
	});
});

describe('enqueue idempotency (real SQL)', () => {
	beforeEach(async () => {
		holder.db = createPgliteSql();
		await holder.db.exec(MIGRATION);
	});

	it('queues a model once, however often or concurrently it is enqueued', async () => {
		const first = await store.enqueueReleaseEvals([{ id: 'nvidia/new-a', ownedBy: 'nvidia' }, { id: 'nvidia/new-a' }, { id: 'meta/new-b' }]);
		expect(first.map((r) => r.model_id).sort()).toEqual(['meta/new-b', 'nvidia/new-a']);
		const again = await Promise.all([
			store.enqueueReleaseEvals([{ id: 'nvidia/new-a' }]),
			store.enqueueReleaseEvals([{ id: 'nvidia/new-a' }, { id: 'meta/new-b' }]),
		]);
		expect(again.flat()).toEqual([]);
		const rows = await holder.db.sql`select model_id, status, owned_by from nim_release_evals order by model_id`;
		expect(rows).toEqual([
			{ model_id: 'meta/new-b', status: 'queued', owned_by: null },
			{ model_id: 'nvidia/new-a', status: 'queued', owned_by: 'nvidia' },
		]);
	});

	it('a done model is not re-queued when the catalog watch sees it again', async () => {
		await store.enqueueReleaseEvals([{ id: 'nvidia/new-a' }]);
		const row = await store.claimNextReleaseEval();
		await store.completeReleaseEval(row.id, { lane: 'chat', classification: {}, verdict: 'hold', report: {}, markdown: '#', configDiff: null, postDraft: null });
		expect(await store.enqueueReleaseEvals([{ id: 'nvidia/new-a' }])).toEqual([]);
		const [after] = await holder.db.sql`select status, verdict from nim_release_evals`;
		expect(after).toEqual({ status: 'done', verdict: 'hold' });
	});

	it('the audit enqueues new catalog ids once across repeated runs and never runs the eval inline', async () => {
		const snapshot = new Map([['seen', ['nvidia/a']]]);
		const deps = {
			base: 'https://nim.test/v1', key: 'k', cacheKey: 'seen',
			get: async (k) => snapshot.get(k) ?? null,
			set: async (k, v) => { snapshot.set(k, v); },
			alert: vi.fn(async () => {}),
			list: async () => [{ id: 'nvidia/a', ownedBy: 'nvidia' }, { id: 'nvidia/new-model', ownedBy: 'nvidia' }],
		};
		const first = await watchNvidiaReleases(deps);
		expect(first.evals).toEqual({ queued: ['nvidia/new-model'], error: null });
		expect(deps.alert).toHaveBeenCalledTimes(1);
		expect(deps.alert.mock.calls[0][1]).toMatch(/Queued 1 lane evaluation/);

		// A cold snapshot cache (expired) must not re-queue: the table is the second guard.
		snapshot.set('seen', ['nvidia/a']);
		const second = await watchNvidiaReleases(deps);
		expect(second.evals.queued).toEqual([]);
		const rows = await holder.db.sql`select model_id, status, owned_by, source from nim_release_evals`;
		expect(rows).toEqual([{ model_id: 'nvidia/new-model', status: 'queued', owned_by: 'nvidia', source: 'catalog-watch' }]);
	});

	it('a queue outage still pages ops about the release', async () => {
		const alert = vi.fn(async () => {});
		const out = await watchNvidiaReleases({
			base: 'b', key: 'k', cacheKey: 'seen', get: async () => ['x'], set: async () => {}, alert,
			list: async () => [{ id: 'x', ownedBy: null }, { id: 'nvidia/y', ownedBy: 'nvidia' }],
			enqueue: async () => { throw new Error('relation "nim_release_evals" does not exist'); },
		});
		expect(out.evals.error).toMatch(/does not exist/);
		expect(alert.mock.calls[0][1]).toMatch(/could not be queued/);
	});

	it('claims hand concurrent runs different rows, and a transient failure requeues until the attempt cap', async () => {
		await store.enqueueReleaseEvals([{ id: 'm/1' }, { id: 'm/2' }]);
		const [a, b, none] = [await store.claimNextReleaseEval(), await store.claimNextReleaseEval(), await store.claimNextReleaseEval()];
		expect(new Set([a.model_id, b.model_id]).size).toBe(2);
		expect(none).toBeNull();
		let row = await store.failReleaseEval(a.id, { error: 'timeout', transient: true });
		expect(row.status).toBe('queued');
		for (let i = 0; i < store.MAX_ATTEMPTS - 1; i++) {
			const claimed = await store.claimNextReleaseEval();
			row = await store.failReleaseEval(claimed.id, { error: 'timeout', transient: true });
		}
		expect(row).toMatchObject({ status: 'failed', attempts: store.MAX_ATTEMPTS });
	});
});

// A rerank NIM stand-in: the candidate ranks every item right; the model the
// lane runs today gets every other item wrong.
function rerankWorld(candidate) {
	return fakeNim({
		rerank: (body) => {
			const item = RERANK_SET.items.find((i) => i.query === body.query.text);
			const n = body.passages.length;
			if (!item) return [200, { rankings: [{ index: 1, logit: 2 }, { index: 0, logit: 1 }] }];
			const idx = RERANK_SET.items.indexOf(item);
			const top = body.model === candidate || idx % 2 === 0 ? item.relevant : (item.relevant + 1) % n;
			const order = [top, ...Array.from({ length: n }, (_, i) => i).filter((i) => i !== top)];
			return [200, { rankings: order.map((index, r) => ({ index, logit: n - r })) }];
		},
	});
}

const LANE_FILES = Object.values(evalLib.LANES).map((l) => l.file);
const hashFiles = () => Object.fromEntries(LANE_FILES.map((f) => [f, createHash('sha256').update(readFileSync(f)).digest('hex')]));

describe('evaluation report shape', () => {
	it('carries classification, both runs, verdict, an exact diff and a post draft', async () => {
		const model = 'nvidia/fake-rerank-next';
		const { client } = rerankWorld(model);
		const r = await evalLib.evaluateRelease({ modelId: model, ownedBy: 'nvidia', client });
		expect(r.lane).toBe('rerank');
		expect(r.verdict).toBe('adopt');
		for (const run of [r.candidate, r.incumbent]) {
			expect(run).toMatchObject({ items: RERANK_SET.items.length, errors: 0, errorRate: 0 });
			expect(run).toHaveProperty('latencyMs.p50');
			expect(run).toHaveProperty('latencyMs.p95');
			expect(run.results).toHaveLength(RERANK_SET.items.length);
		}
		expect(r.candidate).toMatchObject({ quality: 1, formatAdherence: 1 });
		expect(r.incumbent.quality).toBe(0.5);
		expect(r.incumbent.model).toBe(evalLib.LANES.rerank.incumbent());
		expect(r.set).toMatchObject({ path: 'data/evals/rerank/v1.json', version: 1, licence: 'CC0-1.0' });
		expect(r.diff.file).toBe('api/_lib/rerank.js');
		expect(r.diff.patch).toContain(`+export const DEFAULT_RERANK_MODEL = '${model}';`);
		expect(r.diff.patch).toMatch(/^-export const DEFAULT_RERANK_MODEL = /m);
		expect(r.postDraft).toMatch(/100% top-1 accuracy on our 12-task rerank eval vs 50%/);
		expect(r.postDraft).toMatch(/@NVIDIAAI @NVIDIAAIDev #NVIDIAInception/);
		expect(r.markdown).toMatch(/^# NIM release eval: `nvidia\/fake-rerank-next`/);
		for (const h of ['## Classification', '## Results', '### Per item', '## Config diff to apply', '## Post draft']) expect(r.markdown).toContain(h);
	});

	it('a reject carries no diff and no post draft', async () => {
		const model = 'nvidia/fake-rerank-worse';
		const { client } = fakeNim({ rerank: (body) => [200, { rankings: body.passages.map((_, index) => ({ index })) }] });
		const r = await evalLib.evaluateRelease({ modelId: model, client });
		expect(r.lane).toBe('rerank');
		expect(r.verdict).toBe('reject');
		expect(r.diff).toBeNull();
		expect(r.postDraft).toBeNull();
	});

	it('decideVerdict: unreliable or off-contract candidates are rejected; a down incumbent only needs the floor', () => {
		const run = (q, extra = {}) => ({ quality: q, formatAdherence: 1, errorRate: 0, latencyMs: { p50: 100, p95: 200 }, ...extra });
		expect(evalLib.decideVerdict({ lane: 'chat', candidate: run(1, { errorRate: 0.3 }), incumbent: run(0.5) }).verdict).toBe('reject');
		expect(evalLib.decideVerdict({ lane: 'chat', candidate: run(1, { formatAdherence: 0.7 }), incumbent: run(0.5) }).verdict).toBe('reject');
		expect(evalLib.decideVerdict({ lane: 'chat', candidate: run(0.75), incumbent: run(0.9, { errorRate: 1 }) }).verdict).toBe('adopt');
		expect(evalLib.decideVerdict({ lane: 'chat', candidate: run(0.9), incumbent: run(0.92, { latencyMs: { p50: 50 } }) }).verdict).toBe('hold');
		expect(evalLib.decideVerdict({ lane: 'chat', candidate: run(0.8), incumbent: run(0.95) }).verdict).toBe('reject');
	});

	it('the ops alert carries verdict, report link, the diff and the post draft', async () => {
		const model = 'nvidia/fake-rerank-next';
		const r = await evalLib.evaluateRelease({ modelId: model, client: rerankWorld(model).client });
		const { title, detail } = buildEvalAlert(r, 'https://three.ws/admin/nim-releases?model=x');
		expect(title).toBe(`NIM release eval: ${model} ADOPT (rerank lane)`);
		expect(detail).toContain('Report: https://three.ws/admin/nim-releases?model=x');
		expect(detail).toContain(`+export const DEFAULT_RERANK_MODEL = '${model}';`);
		expect(detail).toContain('Post draft (post only after the diff is deployed and verified)');
	});
});

describe('no automatic switch', () => {
	beforeEach(async () => {
		holder.db = createPgliteSql();
		await holder.db.exec(MIGRATION);
	});

	it('an adopt verdict stores the proposal and leaves every lane file and pin untouched', async () => {
		const model = 'nvidia/fake-rerank-next';
		const before = hashFiles();
		const pinsBefore = Object.fromEntries(Object.entries(evalLib.LANES).map(([k, l]) => [k, l.incumbent()]));
		await store.enqueueReleaseEvals([{ id: model, ownedBy: 'nvidia' }]);
		const alert = vi.fn(async () => {});
		const out = await runNextReleaseEval({ client: rerankWorld(model).client, alert, origin: 'https://three.ws' });
		expect(out).toMatchObject({ status: 'done', lane: 'rerank', verdict: 'adopt' });

		expect(hashFiles()).toEqual(before);
		expect(Object.fromEntries(Object.entries(evalLib.LANES).map(([k, l]) => [k, l.incumbent()]))).toEqual(pinsBefore);
		expect(evalLib.LANES.rerank.incumbent()).not.toBe(model);

		const [row] = await holder.db.sql`select status, verdict, lane, config_diff, post_draft, report_md, report from nim_release_evals`;
		expect(row).toMatchObject({ status: 'done', verdict: 'adopt', lane: 'rerank' });
		expect(row.config_diff).toContain(`+export const DEFAULT_RERANK_MODEL = '${model}';`);
		expect(row.post_draft).toMatch(/@NVIDIAAIDev/);
		expect(row.report_md).toContain('Production config was not changed');
		expect(row.report.verdict).toBe('adopt');
		expect(alert).toHaveBeenCalledWith(expect.stringContaining('ADOPT'), expect.stringContaining('https://three.ws/admin/nim-releases?model=nvidia%2Ffake-rerank-next'), expect.objectContaining({ severity: 'info' }));
	});

	it('no pipeline module can write files, run processes, or touch the env', () => {
		for (const f of ['api/_lib/nim-lanes.js', 'api/_lib/nim-lane-eval.js', 'api/_lib/nim-release-store.js', 'api/cron/nim-release-eval.js', 'api/admin/nim-releases.js']) {
			const src = readFileSync(f, 'utf8');
			expect(src, f).not.toMatch(/\b(writeFile|appendFile|createWriteStream|rename|unlink|rm)(Sync)?\s*\(/);
			expect(src, f).not.toMatch(/child_process|execSync|spawn\(/);
			expect(src, f).not.toMatch(/process\.env\.[A-Z_]+\s*=(?!=)/);
			expect(src, f).not.toMatch(/run services update|gcloud/);
		}
	});

	it('an unreachable model is requeued, not stored as having no lane', async () => {
		await store.enqueueReleaseEvals([{ id: 'nvidia/flaky' }]);
		const { client } = fakeNim({ embeddings: () => [503, {}], chat: () => [503, {}], rerank: () => [503, {}] });
		const out = await runNextReleaseEval({ client, alert: vi.fn() });
		expect(out.status).toBe('requeued');
		const [row] = await holder.db.sql`select status, attempts, verdict from nim_release_evals`;
		expect(row).toEqual({ status: 'queued', attempts: 1, verdict: null });
	});
});
