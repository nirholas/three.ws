// Live NVIDIA lanes: the probe registry, the probe runner, and the stats
// aggregation behind /nvidia's "Live right now" section.
// ---------------------------------------------------------------------------
// Every lane here is one the product calls for real traffic:
//
//   hosted   NVIDIA-hosted endpoints on the one NVIDIA_API_KEY: NIM chat,
//            vision, embeddings and NemoGuard on integrate.api.nvidia.com,
//            Magpie TTS and Audio2Face-3D over NVCF gRPC, and Microsoft TRELLIS
//            on NVCF. Each probe sends the smallest valid request to the exact
//            model id the product pins (imported from the product module, so a
//            re-pin moves the probe with it).
//   gpu      self-hosted Cloud Run GPU workers. The probe is the same /health
//            check ?health=1 runs (api/_lib/forge-health.js); the worker reports
//            the GPU it runs on, so the GPU type is measured, never mapped by
//            hand.
//
// api/cron/nvidia-lane-probes.js runs the due probes and stores one row per
// probe in nvidia_lane_probes. buildNvidiaStats() reads those rows plus the
// real job rows in forge_creations; /api/nvidia/stats serves the result.
//
// What never leaves this module in a public payload: keys, prompts, user ids,
// and the workers' Cloud Run hostnames (worker_host is stored only to join job
// rows to the GPU that served them).

import { deflateSync, crc32 } from 'node:zlib';
import { sql as defaultSql } from './db.js';
import { env } from './env.js';
import { NVIDIA_PINNED_MODELS } from './llm.js';
import { NVIDIA_VISION_MODELS } from './vision.js';
import { NIM_EMBED_TAG } from './embeddings.js';
import { classifyPublishSafety, publishSafetyConfig } from './publish-safety.js';
import { synthesizeNvidiaTts, NVIDIA_TTS_MODEL } from './tts-nvidia.js';
import { animateNvidiaA2F } from './a2f-nvidia.js';
import { probeForgeLane } from './forge-health.js';
import { readSubmitOutcomes } from './forge-events.js';
import { BACKENDS } from './forge-tiers.js';
import { NIM_FLUX_MODEL, NIM_FLUX_URL, NIM_FLUX_TIMEOUT_MS, nimFluxBody } from './nim-flux.js';
import { backendWorkerHost, regionFromHost } from './gpu-worker-host.js';

const NIM_BASE = 'https://integrate.api.nvidia.com/v1';
const HOSTED_TIMEOUT_MS = 45_000;
const DETAIL_MAX = 200;

// Cadence per lane, in minutes. The NVIDIA free developer tier allows about 40
// requests per minute per key (docs/free-llm-providers.md); the whole hourly
// tick sends at most ten hosted requests, so probes never meaningfully compete
// with user traffic. The slow reasoning VLM and the two-call Audio2Face probe
// run every three hours, the GPU workers every six (they already answer the
// forge's own lane-health checks many times an hour).
export const NVIDIA_LANES = Object.freeze([
	{
		id: 'nim_chat',
		label: 'Chat, default NIM rung',
		technology: 'NVIDIA NIM',
		kind: 'hosted',
		everyMinutes: 60,
		model: () => NVIDIA_PINNED_MODELS[0],
		probe: probeNimChat,
	},
	{
		id: 'nim_vision',
		label: 'Vision',
		technology: 'NVIDIA NIM',
		kind: 'hosted',
		everyMinutes: 180,
		model: () => NVIDIA_VISION_MODELS[0]?.model || null,
		probe: probeNimVision,
	},
	{
		id: 'nim_embeddings',
		label: 'Embeddings',
		technology: 'NVIDIA NIM',
		kind: 'hosted',
		everyMinutes: 60,
		model: () => NIM_EMBED_TAG.split('@')[0],
		probe: probeNimEmbeddings,
	},
	{
		id: 'nemoguard',
		label: 'Content safety',
		technology: 'NVIDIA NemoGuard',
		kind: 'hosted',
		everyMinutes: 60,
		model: () => publishSafetyConfig().model,
		probe: probeNemoGuard,
	},
	{
		id: 'magpie_tts',
		label: 'Text to speech',
		technology: 'NVIDIA Riva (Magpie TTS)',
		kind: 'hosted',
		everyMinutes: 60,
		model: () => NVIDIA_TTS_MODEL,
		probe: probeMagpieTts,
	},
	{
		id: 'audio2face',
		label: 'Speech to facial animation',
		technology: 'NVIDIA Audio2Face-3D',
		kind: 'hosted',
		everyMinutes: 180,
		model: () => 'audio2face-3d',
		probe: probeAudio2Face,
	},
	{
		// The Forge reference-image rung (api/_mcp3d/text-to-image.js). It timed
		// out on every request for weeks in 2026-11 with nothing measuring it, so
		// it gets the rung's exact request against the pinned model, hourly.
		id: 'nim_flux',
		label: 'Text to image, Forge reference rung',
		technology: 'NVIDIA NIM (FLUX.2 klein)',
		kind: 'hosted',
		everyMinutes: 60,
		model: () => NIM_FLUX_MODEL,
		probe: probeNimFlux,
	},
	{
		id: 'trellis_nvcf',
		label: 'Text to 3D, hosted TRELLIS',
		technology: 'NVIDIA NVCF',
		kind: 'hosted',
		everyMinutes: 60,
		model: () => 'microsoft/trellis',
		jobBackend: 'nvidia',
		probe: () => probeForgeWorkerLane('nvidia'),
	},
	...['trellis2', 'trellis_selfhost', 'hunyuan3d', 'triposg', 'pixal3d'].map((backend) => ({
		id: backend,
		label: `${BACKENDS[backend]?.label || backend} GPU worker`,
		technology: 'NVIDIA GPU on Cloud Run',
		kind: 'gpu',
		everyMinutes: 360,
		// Until a probe reads the checkpoint the worker reports, the lane shows the
		// backend's product label.
		model: () => BACKENDS[backend]?.label || backend,
		jobBackend: backend,
		probe: () => probeForgeWorkerLane(backend),
	})),
]);

export function laneById(id) {
	return NVIDIA_LANES.find((l) => l.id === id) || null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Strip anything that could identify infrastructure or carry a credential out
// of a free-text detail before it is stored or served.
export function sanitizeDetail(text) {
	if (text == null) return null;
	const clean = String(text)
		.replace(/nvapi-[A-Za-z0-9_-]+/g, '[key]')
		.replace(/Bearer\s+\S+/gi, 'Bearer [key]')
		.replace(/https?:\/\/\S+/gi, '[url]')
		.replace(/\b[\w.-]+\.(?:run\.app|internal|nvidia\.com|googleapis\.com)\b/gi, '[host]')
		.replace(/\s+/g, ' ')
		.trim();
	return clean ? clean.slice(0, DETAIL_MAX) : null;
}

// Group the device string torch reports ("NVIDIA L4", "NVIDIA RTX PRO 6000
// Blackwell Server Edition") into the GPU family /nvidia charts by.
export function gpuFamily(name) {
	if (!name) return null;
	if (/\bL4\b/i.test(name)) return 'L4';
	if (/RTX\s*PRO\s*6000/i.test(name)) return 'RTX PRO 6000';
	return String(name).replace(/^NVIDIA\s+/i, '').trim() || null;
}

function verdictForHttp(status) {
	if (status >= 200 && status < 300) return { status: 'ok', detail: null };
	if (status === 429) return { status: 'degraded', detail: 'Rate limited by the free tier.' };
	if (status === 401 || status === 403) return { status: 'down', detail: 'The API key was rejected.' };
	if (status === 404 || status === 410) return { status: 'down', detail: `The pinned model is no longer served (HTTP ${status}).` };
	return { status: 'down', detail: `HTTP ${status} from the endpoint.` };
}

function noKey() {
	return { status: 'unconfigured', detail: 'NVIDIA_API_KEY is not set on this deployment.' };
}

async function nimPost(path, body, timeoutMs = HOSTED_TIMEOUT_MS) {
	const started = Date.now();
	try {
		const res = await fetch(`${NIM_BASE}${path}`, {
			method: 'POST',
			headers: { authorization: `Bearer ${env.NVIDIA_API_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs),
		});
		const data = res.ok ? await res.json().catch(() => null) : null;
		return { res, data, latency: Date.now() - started };
	} catch (err) {
		return { res: null, data: null, latency: Date.now() - started, err };
	}
}

function fromNim({ res, data, latency, err }, model, readOk) {
	if (!res) {
		const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
		return { status: 'down', latency_ms: latency, model, detail: timedOut ? 'No answer inside the probe timeout.' : 'The endpoint is unreachable.' };
	}
	const v = verdictForHttp(res.status);
	if (v.status === 'ok' && !readOk(data)) {
		return { status: 'degraded', http_status: res.status, latency_ms: latency, model, detail: 'Answered 200 with an empty result.' };
	}
	return { status: v.status, http_status: res.status, latency_ms: latency, model, detail: v.detail };
}

// A 32x32 solid NVIDIA-green PNG, built once: big enough that every VLM accepts
// it, small enough to cost nothing.
let probePng = null;
function solidPng(size = 32, rgb = [118, 185, 0]) {
	if (probePng) return probePng;
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const crc = Buffer.alloc(4);
		crc.writeUInt32BE(crc32(td) >>> 0);
		return Buffer.concat([len, td, crc]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // truecolor RGB
	const row = Buffer.alloc(1 + size * 3);
	for (let x = 0; x < size; x++) row.set(rgb, 1 + x * 3);
	const raw = Buffer.concat(Array.from({ length: size }, () => row));
	probePng = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]).toString('base64');
	return probePng;
}

const hasChoice = (d) => typeof d?.choices?.[0]?.message?.content === 'string';

// ── Probes ─────────────────────────────────────────────────────────────────

async function probeNimChat() {
	if (!env.NVIDIA_API_KEY) return noKey();
	const model = NVIDIA_PINNED_MODELS[0];
	const out = await nimPost('/chat/completions', {
		model,
		messages: [{ role: 'user', content: 'Reply with the word ok.' }],
		max_tokens: 4,
		temperature: 0,
		chat_template_kwargs: { enable_thinking: false },
	});
	return fromNim(out, model, hasChoice);
}

async function probeNimVision() {
	if (!env.NVIDIA_API_KEY) return noKey();
	const spec = NVIDIA_VISION_MODELS[0];
	if (!spec) return { status: 'unconfigured', detail: 'No NIM vision model is pinned.' };
	const out = await nimPost('/chat/completions', {
		model: spec.model,
		messages: [{
			role: 'user',
			content: [
				{ type: 'text', text: 'Name the color of this square in one word.' },
				{ type: 'image_url', image_url: { url: `data:image/png;base64,${solidPng()}` } },
			],
		}],
		max_tokens: 8,
		temperature: 0,
		...(spec.extraBody || {}),
	});
	return fromNim(out, spec.model, (d) => hasChoice(d) && d.choices[0].message.content.trim().length > 0);
}

async function probeNimEmbeddings() {
	if (!env.NVIDIA_API_KEY) return noKey();
	const model = NIM_EMBED_TAG.split('@')[0];
	const out = await nimPost('/embeddings', { model, input: ['ok'], input_type: 'query', encoding_format: 'float' });
	return fromNim(out, model, (d) => Array.isArray(d?.data?.[0]?.embedding) && d.data[0].embedding.length > 0);
}

async function probeNemoGuard() {
	if (!env.NVIDIA_API_KEY) return noKey();
	const cfg = { ...publishSafetyConfig(), enabled: true, key: env.NVIDIA_API_KEY };
	const out = await classifyPublishSafety('Hello, how are you today?', { config: cfg });
	if (out.checked) return { status: 'ok', http_status: 200, latency_ms: out.latencyMs, model: cfg.model };
	const m = /publish-safety (\d{3})/.exec(out.error || '');
	if (m) return { ...verdictForHttp(Number(m[1])), http_status: Number(m[1]), latency_ms: out.latencyMs, model: cfg.model };
	if (out.error === 'timeout') return { status: 'down', latency_ms: out.latencyMs, model: cfg.model, detail: 'No answer inside the probe timeout.' };
	if (out.error) return { status: 'down', latency_ms: out.latencyMs, model: cfg.model, detail: sanitizeDetail(out.error) };
	return { status: 'degraded', http_status: 200, latency_ms: out.latencyMs, model: cfg.model, detail: 'Answered without a readable verdict.' };
}

// One 512x512 generation with the rung's own body, URL and 30s cap (the
// genai route is sync; no NVCF poll header, which turns a slow answer into a
// 504). Only an image NVIDIA reports as finished counts as ok.
async function probeNimFlux() {
	if (!env.NVIDIA_API_KEY) return noKey();
	const started = Date.now();
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), NIM_FLUX_TIMEOUT_MS);
	let res;
	let data = null;
	try {
		res = await fetch(NIM_FLUX_URL, {
			method: 'POST',
			headers: { authorization: `Bearer ${env.NVIDIA_API_KEY}`, 'content-type': 'application/json', accept: 'application/json' },
			body: JSON.stringify(nimFluxBody('a small red ceramic teapot on a white background', 512, 512)),
			signal: controller.signal,
		});
		if (res.ok) data = await res.json().catch(() => null);
	} catch (err) {
		return fromNim({ res: null, data: null, latency: Date.now() - started, err }, NIM_FLUX_MODEL, () => false);
	} finally {
		clearTimeout(timer);
	}
	const latency = Date.now() - started;
	const artifact = data?.artifacts?.[0];
	const finish = artifact?.finishReason ?? artifact?.finish_reason;
	if (res.ok && artifact?.base64 && finish && finish !== 'SUCCESS') {
		return { status: 'degraded', http_status: res.status, latency_ms: latency, model: NIM_FLUX_MODEL, detail: `Answered 200 but withheld the image (${finish}).` };
	}
	return fromNim({ res, data, latency }, NIM_FLUX_MODEL, (d) => typeof d?.artifacts?.[0]?.base64 === 'string' && d.artifacts[0].base64.length > 0);
}

const GRPC_CODE_STATUS = Object.freeze({
	invalid_key: { status: 'down', detail: 'The API key was rejected.' },
	rate_limited: { status: 'degraded', detail: 'Rate limited by the free tier.' },
	timeout: { status: 'down', detail: 'No answer inside the probe timeout.' },
	provider_unreachable: { status: 'down', detail: 'The endpoint is unreachable.' },
	not_configured: { status: 'unconfigured', detail: 'NVIDIA_API_KEY is not set on this deployment.' },
});

function fromGrpcError(err, model, latency) {
	const known = GRPC_CODE_STATUS[err?.code];
	return { ...(known || { status: 'down', detail: sanitizeDetail(err?.message) || 'The call failed.' }), latency_ms: latency, model };
}

async function probeMagpieTts() {
	if (!env.NVIDIA_API_KEY) return noKey();
	const started = Date.now();
	try {
		const out = await synthesizeNvidiaTts({ text: 'Hi.', format: 'wav', timeoutMs: HOSTED_TIMEOUT_MS });
		const latency = Date.now() - started;
		if (!out?.audio?.length) return { status: 'degraded', latency_ms: latency, model: NVIDIA_TTS_MODEL, detail: 'Returned no audio.' };
		return { status: 'ok', latency_ms: latency, model: out.model || NVIDIA_TTS_MODEL };
	} catch (err) {
		return fromGrpcError(err, NVIDIA_TTS_MODEL, Date.now() - started);
	}
}

// Audio2Face needs real speech to animate. The probe synthesizes one short
// word on Magpie first (not timed), then times only the Audio2Face call.
async function probeAudio2Face() {
	if (!env.NVIDIA_API_KEY) return noKey();
	let wav;
	try {
		wav = (await synthesizeNvidiaTts({ text: 'Hello there.', format: 'wav', timeoutMs: HOSTED_TIMEOUT_MS }))?.audio;
	} catch (err) {
		return { status: 'degraded', model: 'audio2face-3d', detail: `Skipped: the speech input could not be synthesized (${GRPC_CODE_STATUS[err?.code]?.detail || 'TTS failed'}).` };
	}
	const started = Date.now();
	try {
		const out = await animateNvidiaA2F({ wav, timeoutMs: HOSTED_TIMEOUT_MS });
		const latency = Date.now() - started;
		if (!out?.frameCount) return { status: 'degraded', latency_ms: latency, model: 'audio2face-3d', detail: 'Returned no animation frames.' };
		return { status: 'ok', latency_ms: latency, model: out.model || 'audio2face-3d' };
	} catch (err) {
		return fromGrpcError(err, 'audio2face-3d', Date.now() - started);
	}
}

async function probeForgeWorkerLane(backend) {
	const out = await probeForgeLane(backend);
	if (!out) return { status: 'unconfigured', detail: 'No probe exists for this lane.' };
	const host = backend === 'nvidia' ? null : backendWorkerHost(backend);
	return {
		status: ['ok', 'degraded', 'down', 'unconfigured'].includes(out.status) ? out.status : 'down',
		http_status: out.http_status ?? null,
		latency_ms: out.latency_ms ?? null,
		model: out.worker_model || laneById(backend === 'nvidia' ? 'trellis_nvcf' : backend)?.model() || null,
		detail: out.status === 'ok' ? null : sanitizeDetail(out.message),
		gpu_name: out.gpu_name || null,
		worker_host: host,
		region: regionFromHost(host),
	};
}

// ── Probe runner ───────────────────────────────────────────────────────────

export async function recordProbe(lane, r, { sql = defaultSql } = {}) {
	const intOrNull = (v) => (Number.isFinite(v) ? Math.round(v) : null);
	await sql`
		insert into nvidia_lane_probes (lane, status, http_status, latency_ms, model, detail, gpu_name, worker_host, region)
		values (${lane}, ${r.status}, ${intOrNull(r.http_status)}, ${intOrNull(r.latency_ms)}, ${r.model ?? null},
			${sanitizeDetail(r.detail)}, ${r.gpu_name ?? null}, ${r.worker_host ?? null}, ${r.region ?? null})
	`;
}

// Lanes whose last probe is older than their cadence (minus five minutes of
// slack so an hourly tick that fires a little early still runs an hourly lane).
export async function dueLanes({ sql = defaultSql, now = Date.now(), lanes = NVIDIA_LANES } = {}) {
	const rows = await sql`select lane, max(probed_at) as last from nvidia_lane_probes group by lane`;
	const last = new Map(rows.map((r) => [r.lane, new Date(r.last).getTime()]));
	return lanes.filter((l) => {
		const t = last.get(l.id);
		return !Number.isFinite(t) || now - t >= (l.everyMinutes - 5) * 60_000;
	});
}

export async function runLaneProbes({ sql = defaultSql, force = false, only = null, now = Date.now(), budgetMs = 230_000 } = {}) {
	let lanes = only ? NVIDIA_LANES.filter((l) => only.includes(l.id)) : NVIDIA_LANES;
	if (!force) lanes = await dueLanes({ sql, now, lanes });
	// Sequential on purpose: ten requests an hour need no parallelism, and one
	// at a time keeps each latency number free of our own contention. A lane not
	// reached inside the budget stays due and runs on the next tick.
	const startedAt = Date.now();
	const results = [];
	for (const lane of lanes) {
		if (Date.now() - startedAt > budgetMs) {
			results.push({ lane: lane.id, status: 'deferred', latency_ms: null, model: null, detail: 'Run budget spent; probes next tick.' });
			continue;
		}
		let r;
		try {
			r = await lane.probe();
		} catch (err) {
			r = { status: 'down', detail: sanitizeDetail(err?.message) || 'The probe threw.' };
		}
		if (!r.model) r.model = lane.model();
		await recordProbe(lane.id, r, { sql });
		results.push({ lane: lane.id, status: r.status, latency_ms: r.latency_ms ?? null, model: r.model ?? null, detail: sanitizeDetail(r.detail) });
	}
	return results;
}

// ── Stats ──────────────────────────────────────────────────────────────────

export const STATS_WINDOWS = Object.freeze({ '7d': 7, '30d': 30 });
const noProbes = (days) => `no probes in the last ${days} days`;
const noJobs = (days) => `no jobs in the last ${days} days`;

const num = (v) => (v == null ? null : Number(v));

async function probeAggregates(sql, days) {
	return sql`
		select lane,
			count(*)::int as count,
			count(*) filter (where status = 'ok')::int as ok,
			percentile_disc(0.5) within group (order by latency_ms) filter (where status = 'ok' and latency_ms is not null) as p50,
			percentile_disc(0.95) within group (order by latency_ms) filter (where status = 'ok' and latency_ms is not null) as p95
		from nvidia_lane_probes
		where probed_at > now() - make_interval(days => ${days}) and status <> 'unconfigured'
		group by lane
	`;
}

async function jobAggregates(sql, days, backends) {
	return sql`
		select backend,
			count(*) filter (where status = 'done')::int as done,
			count(*) filter (where status = 'failed')::int as failed,
			percentile_disc(0.5) within group (order by extract(epoch from (completed_at - created_at)) * 1000)
				filter (where status = 'done' and completed_at is not null and completed_at >= created_at) as p50,
			percentile_disc(0.95) within group (order by extract(epoch from (completed_at - created_at)) * 1000)
				filter (where status = 'done' and completed_at is not null and completed_at >= created_at) as p95,
			percentile_disc(0.5) within group (order by gpu_ms) filter (where status = 'done' and gpu_ms is not null) as gpu_p50,
			percentile_disc(0.95) within group (order by gpu_ms) filter (where status = 'done' and gpu_ms is not null) as gpu_p95,
			count(gpu_ms) filter (where status = 'done')::int as gpu_measured
		from forge_creations
		where created_at > now() - make_interval(days => ${days}) and backend = any(${backends})
		group by backend
	`;
}

// Completed jobs split by the GPU that served them: the job's recorded worker
// host joined to the GPU that host last reported on /health.
async function fleetAggregates(sql, days, backends) {
	return sql`
		with host_gpu as (
			select distinct on (worker_host) worker_host, gpu_name, region
			from nvidia_lane_probes
			where worker_host is not null and gpu_name is not null
			order by worker_host, probed_at desc
		)
		select f.backend, h.gpu_name, h.region,
			count(*)::int as done,
			percentile_disc(0.5) within group (order by extract(epoch from (f.completed_at - f.created_at)) * 1000) as p50,
			percentile_disc(0.95) within group (order by extract(epoch from (f.completed_at - f.created_at)) * 1000) as p95
		from forge_creations f
		join host_gpu h on h.worker_host = f.worker_host
		where f.created_at > now() - make_interval(days => ${days})
			and f.backend = any(${backends}) and f.status = 'done'
			and f.completed_at is not null and f.completed_at >= f.created_at
		group by f.backend, h.gpu_name, h.region
	`;
}

async function latestProbes(sql) {
	return sql`
		select distinct on (lane) lane, status, http_status, latency_ms, model, detail, gpu_name, region, probed_at
		from nvidia_lane_probes
		order by lane, probed_at desc
	`;
}

function probeWindow(row, days) {
	if (!row || !row.count) return { count: 0, note: noProbes(days) };
	return {
		count: row.count,
		ok: row.ok,
		availability_pct: Math.round((row.ok / row.count) * 1000) / 10,
		p50_ms: num(row.p50) == null ? null : Math.round(num(row.p50)),
		p95_ms: num(row.p95) == null ? null : Math.round(num(row.p95)),
	};
}

function jobWindow(row, days) {
	if (!row || (!row.done && !row.failed)) return { done: 0, failed: 0, note: noJobs(days) };
	const ms = (v) => (num(v) == null ? null : Math.round(num(v)));
	return {
		done: row.done,
		failed: row.failed,
		success_pct: row.done + row.failed ? Math.round((row.done / (row.done + row.failed)) * 1000) / 10 : null,
		p50_ms: ms(row.p50),
		p95_ms: ms(row.p95),
		gpu_p50_ms: ms(row.gpu_p50),
		gpu_p95_ms: ms(row.gpu_p95),
		gpu_measured: row.gpu_measured,
	};
}

export const METHODOLOGY = Object.freeze({
	probes: 'An hourly cron sends the smallest valid real request to each hosted lane, using the exact model id the product pins: a four-token chat completion, a one-word description of a 32x32 image, a one-word embedding, a one-sentence safety classification, one 512x512 FLUX.2 klein image with the exact request the Forge reference-image rung sends, the word "Hi." synthesized to speech, and one spoken phrase animated by Audio2Face-3D (only the Audio2Face call is timed). Hosted TRELLIS is checked with an authenticated NVCF status lookup so the probe never consumes a generation. GPU workers are checked on their /health route, which reports the GPU they run on.',
	cadence: 'Chat, embeddings, content safety, text to image, speech and hosted TRELLIS every hour; vision and Audio2Face every three hours; GPU workers every six hours. At most ten hosted requests an hour, against a free tier of about 40 requests per minute.',
	latency: 'Probe latency is wall-clock time from our server in us-central1 to the full response, including network. Percentiles are nearest-rank over successful probes in the window.',
	jobs: 'Job latency is end-to-end wall-clock time of real generations (created to completed), nearest-rank p50 and p95 over completed jobs. GPU time is the worker-measured gpu_ms, shown only where the worker reported it.',
	gpu_split: 'A completed job is attributed to a GPU only when its serving worker host was recorded and that host reported its GPU on /health. Jobs from before attribution started are counted in the lane totals but never assigned a GPU.',
	empty: 'A lane with no data in a window says so. Nothing is estimated or backfilled.',
	end_to_end: 'Job success counts only generations that became a job on a lane. The end-to-end rate beside it covers every Forge generation request accepted past sign-in over the last 24 hours, on every lane, including requests that ended before a job existed (a limiter, the reference image, a lane refusing the submit): jobs are credited at the window\'s job success rate and every pre-job ending counts as a failure.',
});

// The platform-wide end-to-end Forge rate, shown beside the per-lane job rates
// so a reader never takes a lane's success for the user's. Counts only, no
// prompts or identifiers.
export function endToEndBlock(preJob) {
	const day = preJob?.last_24h;
	if (!day) return { window: '24h', note: 'end-to-end counters are not available on this deployment' };
	const pct = (x) => (x == null ? null : Math.round(x * 1000) / 10);
	return {
		window: '24h',
		scope: 'every Forge generation request accepted past sign-in, all lanes',
		accepted: day.accepted,
		jobs_created: day.jobs_created,
		failed_before_job: day.failed_before_job,
		end_to_end_success_pct: pct(day.end_to_end_success_rate),
		job_success_pct: pct(day.lane_success_rate),
	};
}

export async function buildNvidiaStats({ sql = defaultSql, readSubmits = readSubmitOutcomes } = {}) {
	const backends = NVIDIA_LANES.map((l) => l.jobBackend).filter(Boolean);
	const [latest, p7, p30, j7, j30, fleet, preJob] = await Promise.all([
		latestProbes(sql),
		probeAggregates(sql, 7),
		probeAggregates(sql, 30),
		jobAggregates(sql, 7, backends),
		jobAggregates(sql, 30, backends),
		fleetAggregates(sql, 30, backends),
		Promise.resolve()
			.then(() => readSubmits())
			.catch(() => null),
	]);
	const by = (rows, key) => new Map(rows.map((r) => [r[key], r]));
	const [latestBy, p7By, p30By, j7By, j30By] = [by(latest, 'lane'), by(p7, 'lane'), by(p30, 'lane'), by(j7, 'backend'), by(j30, 'backend')];

	const lanes = NVIDIA_LANES.map((l) => {
		const last = latestBy.get(l.id);
		return {
			id: l.id,
			label: l.label,
			technology: l.technology,
			kind: l.kind,
			model: last?.model || l.model() || null,
			cadence_minutes: l.everyMinutes,
			last_probe: last
				? {
					status: last.status,
					http_status: last.http_status,
					latency_ms: last.latency_ms,
					detail: last.detail,
					probed_at: new Date(last.probed_at).toISOString(),
				}
				: { status: 'none', note: 'not probed yet' },
			gpu: l.kind === 'gpu' && last?.gpu_name ? { name: last.gpu_name, family: gpuFamily(last.gpu_name), region: last.region || null } : null,
			probes: { '7d': probeWindow(p7By.get(l.id), 7), '30d': probeWindow(p30By.get(l.id), 30) },
			jobs: l.jobBackend ? { '7d': jobWindow(j7By.get(l.jobBackend), 7), '30d': jobWindow(j30By.get(l.jobBackend), 30) } : null,
		};
	});

	const laneForBackend = new Map(NVIDIA_LANES.filter((l) => l.jobBackend).map((l) => [l.jobBackend, l]));
	const fleetRows = fleet
		.map((r) => ({
			lane: laneForBackend.get(r.backend)?.id || r.backend,
			label: laneForBackend.get(r.backend)?.label || r.backend,
			gpu: r.gpu_name,
			gpu_family: gpuFamily(r.gpu_name),
			region: r.region || null,
			window: '30d',
			done: r.done,
			p50_ms: Math.round(num(r.p50)),
			p95_ms: Math.round(num(r.p95)),
		}))
		.sort((a, b) => a.lane.localeCompare(b.lane) || String(a.gpu_family).localeCompare(String(b.gpu_family)));

	return {
		generated_at: new Date().toISOString(),
		windows: Object.keys(STATS_WINDOWS),
		lanes,
		fleet: fleetRows.length ? fleetRows : { empty: true, note: 'no completed jobs attributed to a GPU in the last 30 days' },
		end_to_end: endToEndBlock(preJob),
		methodology: METHODOLOGY,
	};
}

// ── CSV ────────────────────────────────────────────────────────────────────

const csvCell = (v) => {
	if (v == null) return '';
	const s = String(v);
	return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function statsToCsv(stats) {
	const header = [
		'lane', 'label', 'technology', 'kind', 'model', 'window',
		'probe_count', 'availability_pct', 'probe_p50_ms', 'probe_p95_ms',
		'jobs_done', 'jobs_failed', 'job_success_pct', 'job_p50_ms', 'job_p95_ms', 'gpu_p50_ms', 'gpu_p95_ms',
		'gpu', 'region', 'last_status', 'last_probed_at', 'note',
	];
	const lines = [header.join(',')];
	for (const l of stats.lanes) {
		for (const w of stats.windows) {
			const p = l.probes[w];
			const j = l.jobs?.[w] || null;
			const note = [p.note, j?.note].filter(Boolean).join('; ');
			lines.push([
				l.id, l.label, l.technology, l.kind, l.model, w,
				p.count, p.availability_pct, p.p50_ms, p.p95_ms,
				j?.done, j?.failed, j?.success_pct, j?.p50_ms, j?.p95_ms, j?.gpu_p50_ms, j?.gpu_p95_ms,
				l.gpu?.name, l.gpu?.region, l.last_probe.status, l.last_probe.probed_at, note,
			].map(csvCell).join(','));
		}
	}
	if (Array.isArray(stats.fleet)) {
		lines.push('');
		lines.push(['fleet_lane', 'label', 'gpu', 'gpu_family', 'region', 'window', 'jobs_done', 'job_p50_ms', 'job_p95_ms'].join(','));
		for (const f of stats.fleet) {
			lines.push([f.lane, f.label, f.gpu, f.gpu_family, f.region, f.window, f.done, f.p50_ms, f.p95_ms].map(csvCell).join(','));
		}
	}
	return `${lines.join('\n')}\n`;
}
