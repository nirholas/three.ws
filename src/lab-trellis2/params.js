// TRELLIS.2 lab: the parameter schema, presets and request builder.
//
// Pure module (no DOM) so the request the lab sends is unit-tested. Every
// value and range here mirrors a real contract:
//   resolution, texture_size, target_polycount, seed   api/_lib/forge-options.js
//   sampler steps / guidance_strength and defaults     workers/model-trellis2/request_policy.py
//   resolution presets (texture px, face budget)       request_policy.py RESOLUTION_PRESETS
// A field left at its default is not sent, so the worker applies the upstream
// pipeline.json value and the request stays as small as the user's intent.

export const RESOLUTIONS = Object.freeze([512, 1024, 1536]);
export const TEXTURE_SIZES = Object.freeze([512, 1024, 2048, 4096]);
export const POLY_RANGE = Object.freeze([50_000, 500_000]);
export const STEPS_RANGE = Object.freeze([1, 50]);
export const GUIDANCE_RANGE = Object.freeze([0, 15]);
export const SEED_MAX = 4_294_967_295;
export const DEFAULT_SEED = 42;

// What the worker applies at each resolution when texture_size and the face
// budget are not sent (request_policy.py RESOLUTION_PRESETS).
export const RESOLUTION_DEFAULTS = Object.freeze({
	512: Object.freeze({ texture_size: 2048, faces: 300_000 }),
	1024: Object.freeze({ texture_size: 4096, faces: 1_000_000 }),
	1536: Object.freeze({ texture_size: 4096, faces: 1_500_000 }),
});

export const STAGES = Object.freeze([
	{
		id: 'sparse_structure',
		label: 'Sparse structure',
		help: 'Decides which voxels are occupied: the coarse silhouette and volume. More steps refine the outline; higher guidance follows the photo more literally.',
		defaults: { steps: 12, guidance_strength: 7.5 },
	},
	{
		id: 'shape_slat',
		label: 'Shape detail',
		help: 'Carves geometric detail inside the occupied voxels: edges, folds, small features. More steps add fine detail at the cost of GPU time.',
		defaults: { steps: 12, guidance_strength: 7.5 },
	},
	{
		id: 'tex_slat',
		label: 'Texture and material',
		help: 'Paints base color, roughness, metalness and opacity. Upstream keeps guidance at 1.0 here; raising it pushes colors toward the photo and can oversaturate.',
		defaults: { steps: 12, guidance_strength: 1.0 },
	},
]);

export const PARAM_HELP = Object.freeze({
	resolution: 'Voxel grid the model is generated on. 512 is the quick cascade, 1024 the balanced default, 1536 the finest detail and the longest GPU time.',
	seed: 'Starting noise. The same photo, seed and settings reproduce the same model; change it to get a different take.',
	texture_size: 'Size of the baked PBR texture in pixels. Larger keeps more surface detail and makes a bigger file.',
	faces: 'Triangle budget the mesh is simplified to after generation. Lower is lighter for the web and games; the default keeps the resolution preset.',
	steps: 'Sampler steps for this stage. Each step is another denoising pass on the GPU.',
	guidance: 'How strongly this stage follows the input photo (classifier-free guidance).',
});

export const PRESETS = Object.freeze([
	{
		id: 'fast_draft',
		label: 'Fast draft',
		summary: '512 cascade, 2048 px texture, 300k faces. For checking a photo works before a real run.',
		values: { resolution: 512 },
	},
	{
		id: 'balanced',
		label: 'Balanced',
		summary: '1024 cascade, 4096 px texture, 1M faces. The platform default.',
		values: { resolution: 1024 },
	},
	{
		id: 'maximum_detail',
		label: 'Maximum detail',
		summary: '1536 cascade, 4096 px texture, 1.5M faces, 16 shape steps. The most detail TRELLIS.2 produces.',
		values: { resolution: 1536, sampler: { shape_slat: { steps: 16 } } },
	},
]);

/** The editable state for a fresh lab session. */
export function defaultState() {
	return {
		resolution: 1024,
		seed: DEFAULT_SEED,
		textureSize: null,
		faces: null,
		sampler: Object.fromEntries(STAGES.map((s) => [s.id, { ...s.defaults }])),
	};
}

/** Apply a preset over a fresh state (presets are complete, not additive). */
export function applyPreset(presetId) {
	const preset = PRESETS.find((p) => p.id === presetId);
	if (!preset) throw new RangeError(`unknown preset ${presetId}`);
	const state = defaultState();
	state.resolution = preset.values.resolution;
	for (const [stage, block] of Object.entries(preset.values.sampler || {})) {
		Object.assign(state.sampler[stage], block);
	}
	return state;
}

/** Which preset (if any) the state currently equals. */
export function matchPreset(state) {
	for (const p of PRESETS) {
		const ref = applyPreset(p.id);
		if (JSON.stringify(ref) === JSON.stringify(state)) return p.id;
	}
	return null;
}

const clampInt = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(Number(v))));

/** Sampler overrides that differ from the upstream defaults, or null. */
export function samplerOverrides(sampler) {
	const out = {};
	for (const stage of STAGES) {
		const cur = sampler?.[stage.id] || {};
		const block = {};
		if (Number.isFinite(Number(cur.steps)) && clampInt(cur.steps, STEPS_RANGE) !== stage.defaults.steps) {
			block.steps = clampInt(cur.steps, STEPS_RANGE);
		}
		const g = Number(cur.guidance_strength);
		if (Number.isFinite(g)) {
			const clamped = Math.round(Math.min(GUIDANCE_RANGE[1], Math.max(GUIDANCE_RANGE[0], g)) * 10) / 10;
			if (clamped !== stage.defaults.guidance_strength) block.guidance_strength = clamped;
		}
		if (Object.keys(block).length) out[stage.id] = block;
	}
	return Object.keys(out).length ? out : null;
}

// The forge tier recorded with the run. 512 runs as draft; 1024 and 1536 run on
// the standard tier with an explicit resolution (the high tier is a $THREE
// holder perk and would only change the default resolution, which the lab
// always sends explicitly).
export function tierFor(resolution) {
	return resolution === 512 ? 'draft' : 'standard';
}

/** The POST /api/forge body for a TRELLIS.2 run of this state on one image. */
export function buildTrellis2Body(state, imageUrl) {
	if (!imageUrl) throw new TypeError('imageUrl is required');
	const resolution = RESOLUTIONS.includes(state.resolution) ? state.resolution : 1024;
	const body = {
		path: 'image',
		backend: 'trellis2',
		tier: tierFor(resolution),
		resolution,
		image_urls: [imageUrl],
		seed: clampInt(Number.isFinite(Number(state.seed)) ? state.seed : DEFAULT_SEED, [0, SEED_MAX]),
	};
	if (TEXTURE_SIZES.includes(state.textureSize)) body.texture_size = state.textureSize;
	if (Number.isFinite(Number(state.faces)) && state.faces !== null) body.target_polycount = clampInt(state.faces, POLY_RANGE);
	const sampler = samplerOverrides(state.sampler);
	if (sampler) body.sampler = sampler;
	return body;
}

/** The POST /api/forge body for the comparison lane (its own defaults). */
export function buildLaneBody(backend, imageUrl, tier = 'standard') {
	if (!imageUrl) throw new TypeError('imageUrl is required');
	return { path: 'image', backend, tier, image_urls: [imageUrl] };
}

// ── Shareable URL state ──────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ?a=<creation>&b=<creation> for a finished compare. */
export function compareQuery(aId, bId) {
	const q = new URLSearchParams();
	if (aId) q.set('a', aId);
	if (bId) q.set('b', bId);
	return q.toString();
}

/** Read the compare creation ids back from a query string; invalid ids drop. */
export function parseCompareQuery(search) {
	const q = new URLSearchParams(search);
	const pick = (k) => (UUID_RE.test(q.get(k) || '') ? q.get(k).toLowerCase() : null);
	return { a: pick('a'), b: pick('b') };
}

/** Speed label for a preset from data/trellis2-benchmark.json. */
export function presetSpeed(benchmark, presetId) {
	const p = benchmark?.presets?.[presetId];
	const e2e = p?.e2e_seconds;
	if (!p || typeof e2e !== 'object' || !e2e) return { measured: false, label: 'Not measured yet', detail: 'No production run at this resolution in the benchmark window.' };
	const gpu = typeof p.gpu_seconds === 'object' && p.gpu_seconds ? `, GPU p50 ${formatSeconds(p.gpu_seconds.p50)}` : '';
	return {
		measured: true,
		label: `p50 ${formatSeconds(e2e.p50)}`,
		detail: `End to end over ${e2e.n} production run${e2e.n === 1 ? '' : 's'} (p90 ${formatSeconds(e2e.p90)}${gpu}).`,
	};
}

export function formatSeconds(s) {
	if (!Number.isFinite(s)) return 'n/a';
	if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
	const m = Math.floor(s / 60);
	const r = Math.round(s - m * 60);
	return r ? `${m} min ${r} s` : `${m} min`;
}

export function formatBytes(n) {
	if (!Number.isFinite(n)) return 'n/a';
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatCount(n) {
	return Number.isFinite(n) ? n.toLocaleString('en-US') : 'n/a';
}
