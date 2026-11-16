// /api/nvidia/stats on the real schema (api/_lib/schema.sql plus every
// migration on PGlite). Probe rows are written by recordProbe, the function the
// /api/cron/nvidia-lane-probes cron uses, and job rows by createCreation,
// materializeCreation and markFailed, the forge's own completion writers. The
// aggregation, the handler's headers and a scan of every byte it serves are
// then checked against those rows.

import { beforeAll, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';
import { invoke, makeReq, makeRes } from './_helpers/monetization.js';

const holder = vi.hoisted(() => ({ db: null, stored: [] }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

// Object storage is the one external system materializeCreation touches; the
// bucket write is captured instead of sent.
vi.mock('../api/_lib/r2.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		objectStorageConfigured: () => true,
		putObject: async ({ key }) => {
			holder.stored.push(key);
			return { key };
		},
		cdnUrl: (key) => `https://three.ws/cdn/${key}`,
	};
});

// The worker's output URL is fetched once to copy the GLB into the bucket.
vi.mock('../api/_lib/upstream-fetch.js', async (importActual) => {
	const actual = await importActual();
	const glb = () => new Response(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]), { headers: { 'content-type': 'model/gltf-binary' } });
	return { ...actual, fetchUpstream: async () => glb(), fetchUpstreamPublic: async () => glb() };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
// The self-hosted TRELLIS worker as production configures it: a legacy
// regional Cloud Run host. It must be recorded on the row and never served.
const WORKER_URL = 'https://model-trellis-abc123xyz-uc.a.run.app';
process.env.MODEL_TRELLIS_URL = WORKER_URL;
process.env.GCP_RECONSTRUCTION_KEY = 'recon-secret-for-tests';

const { regionFromHost, backendWorkerHost, hostOf } = await import('../api/_lib/gpu-worker-host.js');
const { recordProbe, buildNvidiaStats, statsToCsv, sanitizeDetail, gpuFamily, dueLanes, NVIDIA_LANES } = await import('../api/_lib/nvidia-lanes.js');
const { createCreation, materializeCreation, markFailed } = await import('../api/_lib/forge-store.js');
const { default: statsHandler, STATS_CACHE } = await import('../api/nvidia/stats.js');

const WORKER_HOST = hostOf(WORKER_URL);
const PROMPT = 'a ceramic owl lamp with brass feet';
const CLIENT = 'client-key-nvidia-stats-0001';

describe('Cloud Run worker host and region', () => {
	it('reads the region from both Cloud Run hostname forms', () => {
		expect(regionFromHost('model-hunyuan3d-21-rtx-93741856042.us-central1.run.app')).toBe('us-central1');
		expect(regionFromHost('model-pixal3d-abc-ez.a.run.app')).toBe('europe-west4');
		expect(regionFromHost('model-x-abc-uk.a.run.app')).toBe('us-east4');
		expect(regionFromHost('model-x-abc-zz.a.run.app')).toBeNull();
		expect(regionFromHost('example.com')).toBeNull();
		expect(regionFromHost(null)).toBeNull();
	});

	it('resolves a self-hosted backend to its worker host, and hosted backends to none', () => {
		expect(backendWorkerHost('trellis_selfhost')).toBe(WORKER_HOST);
		expect(backendWorkerHost('nvidia')).toBeNull();
		expect(backendWorkerHost('trellis_selfhost', {})).toBeNull();
		expect(backendWorkerHost('no-such-backend')).toBeNull();
	});

	it('names GPU families from the device string the worker reports', () => {
		expect(gpuFamily('NVIDIA L4')).toBe('L4');
		expect(gpuFamily('NVIDIA RTX PRO 6000 Blackwell Server Edition')).toBe('RTX PRO 6000');
	});
});

describe('probe detail sanitizing', () => {
	it('masks keys, bearer tokens, URLs and internal hosts', () => {
		const raw = 'failed nvapi-AbCdEf0123456789xyz with Bearer abc.def.ghi at https://model-trellis-abc-uc.a.run.app/health via svc.internal';
		const out = sanitizeDetail(raw);
		expect(out).not.toMatch(/nvapi-|abc\.def\.ghi|run\.app|https?:|\.internal/);
		expect(sanitizeDetail('x'.repeat(500)).length).toBeLessThanOrEqual(200);
		expect(sanitizeDetail(null)).toBeNull();
	});
});

describe('aggregation on the real schema', () => {
	let sql;
	let stats;

	beforeAll(async () => {
		const { pg } = await createFullSchemaDb();
		holder.db = createPgliteSql({ pg });
		sql = holder.db.sql;

		// Ten chat probes in the last week: 100..1000 ms, one of them down.
		for (let i = 1; i <= 10; i++) {
			await recordProbe('nim_chat', i === 10
				? { status: 'down', http_status: 503, latency_ms: 40, model: 'nvidia/nemotron-3-ultra-550b-a55b', detail: 'HTTP 503 from https://integrate.api.nvidia.com/v1 nvapi-leakedkey000000' }
				: { status: 'ok', http_status: 200, latency_ms: i * 100, model: 'nvidia/nemotron-3-ultra-550b-a55b' }, { sql });
		}
		// Two older embeddings probes: inside 30 days, outside 7.
		for (const ms of [300, 500]) {
			await recordProbe('nim_embeddings', { status: 'ok', http_status: 200, latency_ms: ms, model: 'nvidia/nemotron-3-embed-1b' }, { sql });
		}
		await sql`update nvidia_lane_probes set probed_at = now() - interval '12 days' where lane = 'nim_embeddings'`;
		// An unconfigured lane never counts toward availability.
		await recordProbe('trellis2', { status: 'unconfigured', detail: 'The TRELLIS.2 (self-host) worker is not configured on this deployment.' }, { sql });
		// The self-hosted TRELLIS worker reports its GPU through the health probe.
		await recordProbe('trellis_selfhost', {
			status: 'ok', http_status: 200, latency_ms: 280, model: 'trellis-image-large',
			gpu_name: 'NVIDIA L4', worker_host: WORKER_HOST, region: regionFromHost(WORKER_HOST),
		}, { sql });

		// Real forge jobs on that lane: three completed, one failed.
		const [user] = await sql`insert into users (email, display_name) values ('nvidia.stats@contoso.example', 'Stats Tester') returning id`;
		for (let i = 0; i < 4; i++) {
			const jobId = `trellis-job-${i}`;
			await createCreation({ clientKey: CLIENT, prompt: PROMPT, replicateJobId: jobId, backend: 'trellis_selfhost', tier: 'standard', path: 'image', userId: user.id });
			if (i === 3) {
				await markFailed({ replicateJobId: jobId, clientKey: CLIENT, error: 'worker returned 500' });
				continue;
			}
			// Backdate the start so each job has a known wall-clock duration.
			await sql`update forge_creations set created_at = now() - make_interval(secs => ${(i + 1) * 20}) where replicate_job_id = ${jobId}`;
			await materializeCreation({ replicateJobId: jobId, clientKey: CLIENT, glbUrl: `${WORKER_URL}/out/${jobId}.glb`, cleanup: false, derivePbr: false, workerStats: { queue_ms: 900, gpu_ms: 15_000 + i * 1000 } });
		}
		stats = await buildNvidiaStats({ sql });
	}, 180_000);

	it('records the serving worker host on every completed self-hosted job', async () => {
		const rows = await sql`select status, worker_host from forge_creations where client_key = ${CLIENT} order by replicate_job_id`;
		expect(rows.filter((r) => r.status === 'done').every((r) => r.worker_host === WORKER_HOST)).toBe(true);
		expect(rows.find((r) => r.status === 'failed').worker_host).toBeNull();
		expect(holder.stored.length).toBeGreaterThanOrEqual(3);
	});

	it('serves every lane in the registry, in order', () => {
		expect(stats.lanes.map((l) => l.id)).toEqual(NVIDIA_LANES.map((l) => l.id));
		expect(stats.windows).toEqual(['7d', '30d']);
		expect(typeof stats.methodology.probes).toBe('string');
	});

	it('computes availability and nearest-rank percentiles over successful probes', () => {
		const chat = stats.lanes.find((l) => l.id === 'nim_chat');
		expect(chat.last_probe.status).toBe('down');
		expect(chat.probes['7d']).toEqual({ count: 10, ok: 9, availability_pct: 90, p50_ms: 500, p95_ms: 900 });
		expect(chat.probes['30d'].count).toBe(10);
		expect(chat.jobs).toBeNull();
	});

	it('separates the 7 day and 30 day windows', () => {
		const embed = stats.lanes.find((l) => l.id === 'nim_embeddings');
		expect(embed.probes['7d']).toEqual({ count: 0, note: 'no probes in the last 7 days' });
		expect(embed.probes['30d']).toEqual({ count: 2, ok: 2, availability_pct: 100, p50_ms: 300, p95_ms: 500 });
	});

	it('marks lanes with no data explicitly instead of estimating', () => {
		const vision = stats.lanes.find((l) => l.id === 'nim_vision');
		expect(vision.last_probe).toEqual({ status: 'none', note: 'not probed yet' });
		expect(vision.probes['30d']).toEqual({ count: 0, note: 'no probes in the last 30 days' });
		const t2 = stats.lanes.find((l) => l.id === 'trellis2');
		expect(t2.last_probe.status).toBe('unconfigured');
		expect(t2.probes['30d'].count).toBe(0);
		expect(t2.jobs['30d']).toEqual({ done: 0, failed: 0, note: 'no jobs in the last 30 days' });
	});

	it('aggregates real job wall-clock and worker GPU time per lane', () => {
		const lane = stats.lanes.find((l) => l.id === 'trellis_selfhost');
		const w = lane.jobs['30d'];
		expect(w.done).toBe(3);
		expect(w.failed).toBe(1);
		expect(w.success_pct).toBe(75);
		expect(w.p50_ms).toBeGreaterThanOrEqual(40_000);
		expect(w.p50_ms).toBeLessThan(45_000);
		expect(w.p95_ms).toBeGreaterThanOrEqual(60_000);
		expect(w.gpu_p50_ms).toBe(16_000);
		expect(w.gpu_p95_ms).toBe(17_000);
		expect(w.gpu_measured).toBe(3);
		expect(lane.model).toBe('trellis-image-large');
		expect(lane.gpu).toEqual({ name: 'NVIDIA L4', family: 'L4', region: 'us-central1' });
	});

	it('splits completed jobs by the GPU that served them', () => {
		expect(Array.isArray(stats.fleet)).toBe(true);
		const row = stats.fleet.find((r) => r.lane === 'trellis_selfhost');
		expect(row).toMatchObject({ gpu: 'NVIDIA L4', gpu_family: 'L4', region: 'us-central1', window: '30d', done: 3 });
		expect(row.p50_ms).toBeGreaterThanOrEqual(40_000);
	});

	it('probes a lane only once its cadence has elapsed', async () => {
		const due = (await dueLanes({ sql })).map((l) => l.id);
		expect(due).not.toContain('nim_chat');
		expect(due).toContain('nim_embeddings');
		expect(due).toContain('nim_vision');
		const hourLater = (await dueLanes({ sql, now: Date.now() + 56 * 60_000 })).map((l) => l.id);
		expect(hourLater).toContain('nim_chat');
		expect(hourLater).not.toContain('trellis_selfhost');
	});

	it('serves JSON with a five minute CDN cache', async () => {
		const { status, res, body } = await invoke(statsHandler, { url: '/api/nvidia/stats' });
		expect(status).toBe(200);
		expect(res.headers['cache-control']).toBe(STATS_CACHE);
		expect(STATS_CACHE).toMatch(/s-maxage=300/);
		expect(res.headers['access-control-allow-origin']).toBe('*');
		expect(body.lanes.length).toBe(NVIDIA_LANES.length);
	});

	it('serves the same numbers as a CSV download', async () => {
		const res = makeRes();
		await statsHandler(makeReq({ url: '/api/nvidia/stats?format=csv' }), res);
		expect(res.statusCode).toBe(200);
		expect(res.headers['content-type']).toMatch(/^text\/csv/);
		expect(res.headers['content-disposition']).toMatch(/^attachment; filename="three-ws-nvidia-lanes-\d{4}-\d{2}-\d{2}\.csv"$/);
		expect(res.headers['cache-control']).toBe(STATS_CACHE);
		const lines = res.body.trim().split('\n');
		expect(lines[0]).toMatch(/^lane,/);
		expect(res.body).toContain('nim_chat');
		expect(res.body).toContain('trellis_selfhost');
	});

	it('rejects writes', async () => {
		const { status } = await invoke(statsHandler, { method: 'POST', url: '/api/nvidia/stats', body: {} });
		expect(status).toBe(405);
	});

	it('never serves a key, internal host, user id, client key or prompt', async () => {
		const jsonRes = await invoke(statsHandler, { url: '/api/nvidia/stats' });
		const csvRes = makeRes();
		await statsHandler(makeReq({ url: '/api/nvidia/stats?format=csv' }), csvRes);
		const [user] = await sql`select id from users where email = 'nvidia.stats@contoso.example'`;
		for (const served of [JSON.stringify(jsonRes.body), csvRes.body, statsToCsv(stats)]) {
			expect(served).not.toMatch(/nvapi-/i);
			expect(served).not.toMatch(/bearer /i);
			expect(served).not.toMatch(/run\.app|\.internal\b|googleapis\.com|integrate\.api\.nvidia\.com/);
			expect(served).not.toMatch(/worker_host|user_id|client_key|replicate_job_id/);
			expect(served).not.toContain(WORKER_HOST);
			expect(served).not.toContain(String(user.id));
			expect(served).not.toContain(CLIENT);
			expect(served).not.toContain(PROMPT);
			expect(served).not.toContain('recon-secret-for-tests');
			expect(served).not.toContain('contoso.example');
		}
	});
});
