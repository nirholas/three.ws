// Contract tests for src/modly-local.js against an in-process stub of Modly's
// HTTP API. Every route, status code, and body shape the stub serves is taken
// from Modly's FastAPI routers (api/routers/{model,workflow_runs,generation,
// export,optimize}.py, https://github.com/lightningpixel/modly, MIT).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	MODLY_ORIGINS,
	MODLY_DEFAULT_ORIGINS,
	ModlyError,
	detectModly,
	probeModly,
	listModlyModels,
	generateWithModly,
	modlyMeshOp,
	listModlyMeshOps,
	normalizeModlyModel,
	defaultModlyParams,
	validateModlyWorkspacePath,
	modlyRunWorkspacePath,
	summarizeModlyError,
	setModlyOriginOverride,
	getModlyOriginOverride,
	normalizeModlyOrigin,
	cancelModlyRun,
} from '../src/modly-local.js';

const ORIGIN = 'http://127.0.0.1:8765';

// A minimal valid GLB header: magic "glTF", version 2, total length 12.
function glbBytes() {
	const buf = new ArrayBuffer(12);
	const v = new DataView(buf);
	v.setUint32(0, 0x46546c67, true);
	v.setUint32(4, 2, true);
	v.setUint32(8, 12, true);
	return new Uint8Array(buf);
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function json(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

// In-memory Modly. `script` is the sequence of statuses a run walks through,
// one per status poll, mirroring JobStatus transitions in _run_generation.
function makeModly({
	models = [
		{ id: 'sf3d', name: 'Stable Fast 3D', description: 'fast', version: '1.0', vram_gb: 6, hf_repo: 'x/y', tags: ['fast'], downloaded: true, loaded: false, active: true },
		{ id: 'hunyuan3d', name: 'Hunyuan3D 2', downloaded: false, loaded: false, active: false },
	],
	params = {
		sf3d: [
			{ id: 'remesh', label: 'Remesh', type: 'select', default: 'quad', options: [{ value: 'quad', label: 'Quad' }, { value: 'triangle', label: 'Triangle' }] },
			{ id: 'texture_resolution', label: 'Texture size', type: 'int', default: 1024, min: 512, max: 2048, step: 512 },
		],
	},
	script = [
		{ status: 'pending', progress: 0, step: 'Waiting for the previous generation…' },
		{ status: 'running', progress: 40, step: 'Generating mesh' },
		{ status: 'done', progress: 100 },
	],
	outputPath = 'Default/sf3d_0001.glb',
	workflowRuns = true,
	exportBytes = glbBytes(),
} = {}) {
	const calls = [];
	const runs = new Map();
	let seq = 0;

	function statusFor(id) {
		const run = runs.get(id);
		if (!run) return null;
		if (run.cancelled) return { status: 'cancelled', progress: run.last?.progress ?? 0, step: null, output_url: null, error: null };
		const step = script[Math.min(run.polls, script.length - 1)];
		run.polls += 1;
		run.last = step;
		const done = step.status === 'done';
		return {
			status: step.status,
			progress: step.progress ?? 0,
			step: step.step ?? null,
			output_url: done ? `/workspace/${outputPath}` : null,
			error: step.error ?? null,
		};
	}

	async function handle(url, init = {}) {
		const u = new URL(url);
		const method = (init.method || 'GET').toUpperCase();
		calls.push({ method, path: u.pathname, search: u.search, init });
		const p = u.pathname;

		if (method === 'GET' && p === '/health') return json({ status: 'ok' });
		if (method === 'GET' && p === '/model/all') return json(models);
		if (method === 'GET' && p === '/model/params') {
			const id = u.searchParams.get('model_id');
			if (!models.some((m) => m.id === id)) return json({ detail: `Unknown model ID: ${id}` }, 404);
			return json(params[id] || []);
		}

		const isRunCreate = (workflowRuns && p === '/workflow-runs/from-image') || p === '/generate/from-image';
		if (method === 'POST' && isRunCreate) {
			const fd = init.body;
			const image = fd.get('image');
			if (!image || !String(image.type).startsWith('image/')) return json({ detail: 'File must be an image' }, 400);
			const modelId = fd.get('model_id') || 'sf3d';
			if (!models.some((m) => m.id === modelId)) return json({ detail: `Unknown model ID: ${modelId}` }, 400);
			const id = `run-${++seq}`;
			runs.set(id, { polls: 0, cancelled: false, modelId, params: JSON.parse(fd.get('params') || '{}'), image });
			return json(p.startsWith('/workflow-runs') ? { run_id: id, status: 'pending' } : { job_id: id });
		}

		let m = workflowRuns && /^\/workflow-runs\/([^/]+)$/.exec(p);
		if (method === 'GET' && m) {
			const s = statusFor(m[1]);
			if (!s) return json({ detail: `Run ${m[1]} not found` }, 404);
			const sc = s.status === 'done' && s.output_url ? { workspace_path: s.output_url.replace('/workspace/', '') } : null;
			return json({ run_id: m[1], ...s, scene_candidate: sc });
		}
		m = /^\/generate\/status\/([^/]+)$/.exec(p);
		if (method === 'GET' && m) {
			const s = statusFor(m[1]);
			if (!s) return json({ detail: `Job ${m[1]} not found` }, 404);
			return json({ job_id: m[1], ...s });
		}
		m = (workflowRuns && /^\/workflow-runs\/([^/]+)\/cancel$/.exec(p)) || /^\/generate\/cancel\/([^/]+)$/.exec(p);
		if (method === 'POST' && m) {
			const run = runs.get(m[1]);
			if (!run) return json({ detail: `Job ${m[1]} not found` }, 404);
			run.cancelled = true;
			return json({ cancelled: true });
		}

		if (method === 'GET' && p === '/export/glb') {
			const path = u.searchParams.get('path');
			if (!path) return json({ detail: [{ loc: ['query', 'path'], msg: 'Field required', type: 'missing' }] }, 422);
			return new Response(exportBytes, { status: 200, headers: { 'content-type': 'model/gltf-binary' } });
		}

		if (method === 'GET' && p === '/optimize/ops') {
			return json([
				{ id: 'decimate', label: 'Decimate', params_schema: [{ id: 'target_faces', label: 'Target faces', type: 'int', default: 10000, min: 100 }], destructive: true, undoable: true, category: 'topology' },
			]);
		}
		m = /^\/optimize\/op\/([^/]+)$/.exec(p);
		if (method === 'POST' && m) {
			const body = JSON.parse(init.body);
			if (m[1] !== 'decimate') return json({ detail: `Unknown mesh operation: ${m[1]}` }, 404);
			const out = body.path.replace(/\.glb$/, '_dec.glb');
			return json({ path: out, url: `/workspace/${out}`, face_count: body.params.target_faces ?? 10000 });
		}

		return json({ detail: 'Not Found' }, 404);
	}

	return { calls, runs, handle };
}

let modly;

function installFetch(stub, { refuse = [] } = {}) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url, init) => {
			if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
			if (refuse.some((o) => String(url).startsWith(o))) throw new TypeError('Failed to fetch');
			return stub.handle(String(url), init);
		}),
	);
}

beforeEach(() => {
	modly = makeModly();
	installFetch(modly);
});

afterEach(() => {
	vi.unstubAllGlobals();
	setModlyOriginOverride('');
});

describe('model normalization', () => {
	it('defaults input/output the way Modly\'s registry does and keeps ParamSchema field names', () => {
		const m = normalizeModlyModel(
			{ id: 'x', downloaded: 1, vram_gb: 8, tags: ['a'] },
			[{ id: 'steps', label: 'Steps', type: 'int', default: 30, min: 1, max: 100, show_if: { param: 'mode', equals: 'hq' } }, { label: 'no id' }],
		);
		expect(m).toMatchObject({ id: 'x', name: 'x', downloaded: true, input: 'image', output: 'mesh', vramGb: 8, tags: ['a'] });
		expect(m.paramsSchema).toEqual([{ id: 'steps', label: 'Steps', type: 'int', default: 30, min: 1, max: 100, show_if: { param: 'mode', equals: 'hq' } }]);
	});

	it('listModlyModels reads /model/all and attaches each model\'s /model/params', async () => {
		const models = await listModlyModels(ORIGIN);
		expect(models.map((m) => [m.id, m.downloaded])).toEqual([
			['sf3d', true],
			['hunyuan3d', false],
		]);
		expect(models[0].paramsSchema.map((p) => p.id)).toEqual(['remesh', 'texture_resolution']);
		expect(models[0].paramsSchema[0].options).toEqual([
			{ value: 'quad', label: 'Quad' },
			{ value: 'triangle', label: 'Triangle' },
		]);
		expect(models[1].paramsSchema).toEqual([]);
		expect(defaultModlyParams(models[0].paramsSchema)).toEqual({ remesh: 'quad', texture_resolution: 1024 });
	});

	it('treats an empty Modly (no extensions installed) as zero models, not an error', async () => {
		modly = makeModly({ models: [] });
		installFetch(modly);
		expect(await listModlyModels(ORIGIN)).toEqual([]);
	});
});

describe('detection', () => {
	it('resolves { origin, models } from the first origin that answers /health', async () => {
		installFetch(modly, { refuse: ['http://127.0.0.1'] });
		const found = await detectModly({ timeoutMs: 500 });
		expect(found.origin).toBe('http://localhost:8765');
		expect(found.models).toHaveLength(2);
	});

	it('resolves null, never throws, when nothing is listening', async () => {
		installFetch(modly, { refuse: ['http://'] });
		await expect(detectModly({ timeoutMs: 200 })).resolves.toBeNull();
	});

	it('rejects a server that answers /health but is not Modly', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => json({ ok: true })));
		await expect(detectModly({ timeoutMs: 200 })).resolves.toBeNull();
	});

	it('reports blocked when Chrome\'s Local Network Access permission is denied', async () => {
		installFetch(modly, { refuse: ['http://'] });
		vi.stubGlobal('navigator', {
			userAgent: 'Mozilla/5.0 Chrome/142.0',
			permissions: {
				query: vi.fn(async ({ name }) => {
					if (name !== 'local-network-access') throw new TypeError('bad permission');
					return { state: 'denied' };
				}),
			},
		});
		const probe = await probeModly({ timeoutMs: 200 });
		expect(probe).toMatchObject({ status: 'blocked', reason: 'lna-denied', origin: null });
	});

	it('reports blocked mixed content for Safari on an https page', async () => {
		installFetch(modly, { refuse: ['http://'] });
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (Macintosh) Version/18.0 Safari/605.1.15' });
		vi.stubGlobal('location', { protocol: 'https:' });
		const probe = await probeModly({ timeoutMs: 200 });
		expect(probe).toMatchObject({ status: 'blocked', reason: 'mixed-content' });
	});

	it('reports not-running when nothing blocks and nothing answers', async () => {
		installFetch(modly, { refuse: ['http://'] });
		vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Firefox/140.0' });
		vi.stubGlobal('location', { protocol: 'https:' });
		const probe = await probeModly({ timeoutMs: 200 });
		expect(probe.status).toBe('not-running');
	});
});

describe('origin override', () => {
	it('normalizes typed addresses and puts the override first in MODLY_ORIGINS', () => {
		const store = new Map();
		vi.stubGlobal('localStorage', {
			getItem: (k) => store.get(k) ?? null,
			setItem: (k, v) => store.set(k, String(v)),
			removeItem: (k) => store.delete(k),
		});
		expect(normalizeModlyOrigin('localhost:9000/')).toBe('http://localhost:9000');
		expect(() => normalizeModlyOrigin('ftp://x')).toThrow(ModlyError);
		const ref = MODLY_ORIGINS;
		setModlyOriginOverride('192.168.1.20:8765');
		expect(ref).toEqual(['http://192.168.1.20:8765', ...MODLY_DEFAULT_ORIGINS]);
		expect(getModlyOriginOverride()).toBe('http://192.168.1.20:8765');
		setModlyOriginOverride('');
		expect(ref).toEqual([...MODLY_DEFAULT_ORIGINS]);
	});
});

describe('generateWithModly', () => {
	it('posts the multipart contract, polls with progress, and returns a GLB blob', async () => {
		const progress = [];
		const res = await generateWithModly(ORIGIN, {
			image: new File([PNG], 'chair.png', { type: 'image/png' }),
			modelId: 'sf3d',
			params: { remesh: 'triangle' },
			onProgress: (pct, step) => progress.push([pct, step]),
			pollIntervalMs: 1,
		});
		expect(res.blob.type).toBe('model/gltf-binary');
		expect(res.blob.size).toBe(12);
		expect(res).toMatchObject({ filename: 'sf3d_0001.glb', jobId: 'run-1', modelId: 'sf3d', workspacePath: 'Default/sf3d_0001.glb', api: 'workflow-runs' });
		expect(modly.runs.get('run-1').params).toEqual({ remesh: 'triangle' });
		expect(modly.runs.get('run-1').image.type).toBe('image/png');
		expect(progress).toEqual([
			[0, 'Sending image to Modly'],
			[0, 'Waiting for the previous generation…'],
			[40, 'Generating mesh'],
			[100, 'Fetching the mesh from Modly'],
		]);
		const exportCall = modly.calls.find((c) => c.path === '/export/glb');
		expect(new URLSearchParams(exportCall.search).get('path')).toBe('Default/sf3d_0001.glb');
	});

	it('sniffs an untyped image blob so Modly does not reject it as a non-image', async () => {
		const res = await generateWithModly(ORIGIN, { image: new Blob([PNG]), modelId: 'sf3d', pollIntervalMs: 1 });
		expect(res.jobId).toBe('run-1');
		expect(modly.runs.get('run-1').image.type).toBe('image/png');
	});

	it('refuses an input that is not an image before calling Modly', async () => {
		await expect(generateWithModly(ORIGIN, { image: new Blob(['hello']), modelId: 'sf3d' })).rejects.toMatchObject({ code: 'BAD_INPUT' });
		expect(modly.calls).toHaveLength(0);
	});

	it('falls back to the legacy /generate routes on a Modly without /workflow-runs', async () => {
		modly = makeModly({ workflowRuns: false });
		installFetch(modly);
		const res = await generateWithModly(ORIGIN, { image: new File([PNG], 'a.png', { type: 'image/png' }), modelId: 'sf3d', pollIntervalMs: 1 });
		expect(res.api).toBe('legacy');
		expect(modly.calls.some((c) => c.path === '/generate/status/run-1')).toBe(true);
	});

	it('maps a 400 Unknown model to UNKNOWN_MODEL with Modly\'s text', async () => {
		const err = await generateWithModly(ORIGIN, { image: new File([PNG], 'a.png', { type: 'image/png' }), modelId: 'nope' }).catch((e) => e);
		expect(err).toBeInstanceOf(ModlyError);
		expect(err).toMatchObject({ code: 'UNKNOWN_MODEL', status: 400, message: 'Unknown model ID: nope' });
	});

	it('maps a failed run to GENERATION_FAILED with the exception line and keeps the traceback', async () => {
		const tb = 'Traceback (most recent call last):\n  File "gen.py", line 9, in generate\n    run()\ntorch.OutOfMemoryError: CUDA out of memory. Tried to allocate 2.00 GiB';
		modly = makeModly({ script: [{ status: 'running', progress: 10, step: 'Loading model' }, { status: 'error', progress: 10, error: tb }] });
		installFetch(modly);
		const err = await generateWithModly(ORIGIN, { image: new File([PNG], 'a.png', { type: 'image/png' }), modelId: 'sf3d', pollIntervalMs: 1 }).catch((e) => e);
		expect(err).toMatchObject({ code: 'GENERATION_FAILED', message: 'CUDA out of memory. Tried to allocate 2.00 GiB', detail: tb });
	});

	it('maps a run cancelled inside Modly to CANCELLED', async () => {
		modly = makeModly({ script: [{ status: 'cancelled', progress: 5 }] });
		installFetch(modly);
		await expect(
			generateWithModly(ORIGIN, { image: new File([PNG], 'a.png', { type: 'image/png' }), modelId: 'sf3d', pollIntervalMs: 1 }),
		).rejects.toMatchObject({ code: 'CANCELLED' });
	});

	it('maps a run Modly forgot (404 mid-poll) to RUN_LOST', async () => {
		installFetch(modly);
		const real = globalThis.fetch;
		vi.stubGlobal(
			'fetch',
			vi.fn(async (url, init) => (/\/workflow-runs\/run-1$/.test(String(url)) ? json({ detail: 'Run run-1 not found' }, 404) : real(url, init))),
		);
		await expect(
			generateWithModly(ORIGIN, { image: new File([PNG], 'a.png', { type: 'image/png' }), modelId: 'sf3d', pollIntervalMs: 1 }),
		).rejects.toMatchObject({ code: 'RUN_LOST' });
	});

	it('aborting the signal mid-run calls Modly\'s cancel endpoint and rejects CANCELLED', async () => {
		modly = makeModly({ script: [{ status: 'running', progress: 20, step: 'Generating mesh' }] });
		installFetch(modly);
		const ctrl = new AbortController();
		const promise = generateWithModly(ORIGIN, {
			image: new File([PNG], 'a.png', { type: 'image/png' }),
			modelId: 'sf3d',
			signal: ctrl.signal,
			pollIntervalMs: 50,
			onProgress: (pct) => {
				if (pct === 20) ctrl.abort();
			},
		});
		await expect(promise).rejects.toMatchObject({ code: 'CANCELLED' });
		await vi.waitFor(() => expect(modly.calls.some((c) => c.method === 'POST' && c.path === '/workflow-runs/run-1/cancel')).toBe(true));
		expect(modly.runs.get('run-1').cancelled).toBe(true);
	});

	it('rejects an output that is not a binary glTF with NOT_GLB', async () => {
		modly = makeModly({ exportBytes: new TextEncoder().encode('{"scene":"json, not a glb"}') });
		installFetch(modly);
		await expect(
			generateWithModly(ORIGIN, { image: new File([PNG], 'a.png', { type: 'image/png' }), modelId: 'sf3d', pollIntervalMs: 1 }),
		).rejects.toMatchObject({ code: 'NOT_GLB' });
	});

	it('refuses a reported output path that escapes the workspace', async () => {
		modly = makeModly({ outputPath: '../../etc/passwd' });
		installFetch(modly);
		await expect(
			generateWithModly(ORIGIN, { image: new File([PNG], 'a.png', { type: 'image/png' }), modelId: 'sf3d', pollIntervalMs: 1 }),
		).rejects.toMatchObject({ code: 'BAD_PATH' });
		expect(modly.calls.some((c) => c.path === '/export/glb')).toBe(false);
	});

	it('cancelModlyRun resolves false instead of throwing when Modly is gone', async () => {
		installFetch(modly, { refuse: ['http://'] });
		await expect(cancelModlyRun(ORIGIN, 'run-9')).resolves.toBe(false);
	});
});

describe('workspace paths and error text', () => {
	it('validates paths with the same rules as Modly\'s CLI', () => {
		expect(validateModlyWorkspacePath('Default/a.glb')).toBe('Default/a.glb');
		for (const bad of ['', '/etc/x.glb', '\\x.glb', 'a/../b.glb', 'C:/x.glb', 'Default/D:x.glb', 'http://evil/x.glb', 'file:x']) {
			expect(() => validateModlyWorkspacePath(bad)).toThrow(ModlyError);
		}
	});

	it('reads scene_candidate first, then strips /workspace/ from output_url', () => {
		expect(modlyRunWorkspacePath({ scene_candidate: { workspace_path: 'A/b.glb' }, output_url: '/workspace/X/y.glb' })).toBe('A/b.glb');
		expect(modlyRunWorkspacePath({ output_url: '/workspace/My%20Set/y.glb' })).toBe('My Set/y.glb');
		expect(() => modlyRunWorkspacePath({})).toThrow(ModlyError);
	});

	it('summarizes a traceback to its final exception message', () => {
		expect(summarizeModlyError('Traceback...\nValueError: bad image')).toBe('bad image');
		expect(summarizeModlyError('')).toMatch(/without details/);
	});
});

describe('modlyMeshOp', () => {
	it('refuses a Blob: Modly has no mesh upload endpoint', async () => {
		await expect(modlyMeshOp(ORIGIN, { glb: new Blob([glbBytes()]), op: 'decimate' })).rejects.toMatchObject({ code: 'UPLOAD_UNSUPPORTED' });
		expect(modly.calls).toHaveLength(0);
	});

	it('runs an op on a workspace path and downloads the result', async () => {
		const res = await modlyMeshOp(ORIGIN, { glb: { workspacePath: 'Default/sf3d_0001.glb' }, op: 'decimate', params: { target_faces: 5000 } });
		expect(res).toMatchObject({ workspacePath: 'Default/sf3d_0001_dec.glb', filename: 'sf3d_0001_dec.glb', details: { face_count: 5000 } });
		expect(res.blob.type).toBe('model/gltf-binary');
		const post = modly.calls.find((c) => c.path === '/optimize/op/decimate');
		expect(JSON.parse(post.init.body)).toEqual({ path: 'Default/sf3d_0001.glb', params: { target_faces: 5000 } });
	});

	it('maps an unknown op to NOT_FOUND with Modly\'s text', async () => {
		await expect(modlyMeshOp(ORIGIN, { glb: 'Default/a.glb', op: 'explode' })).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'Unknown mesh operation: explode' });
	});

	it('lists ops with normalized param schemas', async () => {
		const ops = await listModlyMeshOps(ORIGIN);
		expect(ops[0]).toMatchObject({ id: 'decimate', destructive: true, category: 'topology' });
		expect(ops[0].paramsSchema[0]).toMatchObject({ id: 'target_faces', default: 10000 });
	});
});
