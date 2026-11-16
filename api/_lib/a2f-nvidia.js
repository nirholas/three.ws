// Free NVIDIA NIM facial-animation lane: Audio2Face-3D over NVCF gRPC.
//
// This is the face-MOTION sibling of api/_lib/tts-nvidia.js (voice-OUT) and
// api/_lib/asr-nvidia.js (voice-IN). It closes the "talking head" loop: Magpie
// TTS gives every avatar a voice; Audio2Face-3D turns that exact spoken audio
// into a per-frame ARKit blendshape track so the avatar's mouth and face move
// in sync with the words: two named NVIDIA models driving one face.
//
// Like Magpie and Riva, A2F-3D is hosted as an NVCF gRPC function on
// grpc.nvcf.nvidia.com:443, selected by a `function-id` metadata entry with the
// nvapi key as a bearer `authorization` entry. The wire contract is NVIDIA's
// ACE `nvidia_ace.services.a2f_controller.v1.A2FControllerService`: a
// BIDIRECTIONAL streaming `ProcessAudioStream`: the client streams an audio
// header + PCM chunks + an end-of-audio marker; the server streams back an
// animation header (the ordered blendshape names) followed by animation-data
// frames (per-frame blendshape weights with a time code), at 30 fps. The proto
// definitions are vendored under ./a2f-protos/ and loaded from a generated JSON
// descriptor (descriptor.js: kept separate from the Riva descriptors) so no
// .proto file needs to exist on the serverless filesystem (api/ routes are
// esbuild-bundled in place: scripts/bundle-api.mjs).
//
// ── Audio contract ───────────────────────────────────────────────────────────
// A2F-3D is trained on 16 kHz mono 16-bit PCM. Magpie emits 44.1 kHz, so this
// module decodes the WAV, downmixes to mono, and resamples to 16 kHz before
// streaming. The returned blendshape time codes are in SECONDS relative to the
// clip start, independent of the audio sample rate, so the browser plays the
// ORIGINAL Magpie audio and samples the track by the audio element's currentTime
//: lips track the real voice, not a resampled copy.
//
// ── Function id ──────────────────────────────────────────────────────────────
// Unlike Riva ASR (pure config), A2F-3D is reached through a published NVCF
// function id, so the lane works out of the box with only NVIDIA_API_KEY set.
// A2F_DEFAULT_FUNCTION_ID below carries the current one and the note on how it
// was verified. A deployment pins a different model via NVIDIA_A2F_FUNCTION_ID;
// discover the ids your key can see with
//   node scripts/verify-nvidia-a2f.mjs --list
//
// ── Self-healing ─────────────────────────────────────────────────────────────
// NVIDIA rotates the function behind `ai-a2x-service` (it has happened twice).
// A retired id answers gRPC 5 NOT_FOUND "Not found for account", which used to
// 502 every call until a human redeployed with a new id. Now the lane heals
// itself: on a rotation-shaped failure (isFunctionRotationError) it reads
// NVCF's own function list, picks the `ai-a2x-service` id that has an ACTIVE
// version (pickActiveA2fFunction), replays the clip on it and remembers it for
// every later call in this process (createFunctionHealer). The pinned id stays
// the source of truth: the healed id only applies while that pin is unchanged.
//
// Error codes match the established provider contract (tts-nvidia.js / asr-nvidia.js):
//   invalid_key / rate_limited / invalid_argument / timeout /
//   provider_unreachable / provider_error / not_configured.

import { env } from './env.js';
import { parseWav } from './asr-nvidia.js';
import a2fDescriptor from './a2f-protos/descriptor.js';

export const NVIDIA_A2F_HOST = 'grpc.nvcf.nvidia.com:443';

// NVCF function id for the hosted Audio2Face NIM (`ai-a2x-service`), the
// published catalog function NVIDIA serves Audio2Face-3D from. It returns the
// full ARKit-52 set plus tongue blendshapes at 30 fps.
//
// History: the "James" sample-client id (9327c39f-a361-4e02-bd72-e11b4c9b7b5e)
// stopped resolving (NOT_FOUND for account) and the whole lipsync lane 502'd.
// Its replacement 462f7853-60e8-474a-9728-7b598e58472c was listed INACTIVE /
// DEGRADING on 2026-11-16 while 945ed566 had an ACTIVE version; 945ed566 passed
// `NVIDIA_A2F_FUNCTION_ID=945ed566-a023-4677-9a49-61ede107fd5a node
// scripts/verify-nvidia-a2f.mjs` that day (159 frames, JawOpen swing 0.496).
// The healer below finds the next one on its own; this constant is the start.
export const A2F_DEFAULT_FUNCTION_ID = '945ed566-a023-4677-9a49-61ede107fd5a';
export const NVCF_FUNCTIONS_URL = 'https://api.nvcf.nvidia.com/v2/nvcf/functions';
// The catalog name NVIDIA publishes Audio2Face-3D under. Matched exactly first;
// the looser hint only applies when no exact name exists in the listing.
const A2F_FUNCTION_NAME = 'ai-a2x-service';
const A2F_NAME_HINT = /(audio2face|a2x|a2f)/i;

// A2F-3D's native inference rate and the rate the audio is resampled to before
// streaming. The model runs 30 inferences per second of audio (→ 30 fps output).
export const A2F_SAMPLE_RATE_HZ = 16000;
const A2F_FPS = 30;
const DEFAULT_TIMEOUT_MS = 30_000;
// Bound the clip the lambda will buffer + stream. 60 s of 16 kHz mono s16 is
// ~1.9 MB of PCM and ~1800 frames: generous for avatar speech, small enough
// that one request can't pin a serverless instance.
const MAX_AUDIO_SECONDS = 60;
// How long one NVCF function listing is reused. Discovery runs only after a
// failure or on a warm/monitor probe, so this mostly bounds a burst of failing
// requests to one listing call.
const LISTING_TTL_MS = 60_000;

export function nvidiaA2fConfigured() {
	return Boolean(env.NVIDIA_API_KEY);
}

export function resolveA2fFunctionId(explicit) {
	return explicit || env.NVIDIA_A2F_FUNCTION_ID || A2F_DEFAULT_FUNCTION_ID;
}

// ── Function rotation: detection, discovery, memory ─────────────────────────

/**
 * Is this failure the pinned function going away (as opposed to throttling,
 * auth, bad input or a timeout, which a different id would not fix)?
 * gRPC 5 NOT_FOUND is the documented shape; NVCF also answers 14 UNAVAILABLE
 * and 9 FAILED_PRECONDITION while a function version is being torn down.
 */
export function isFunctionRotationError(err) {
	const code =
		typeof err?.grpcCode === 'number'
			? err.grpcCode
			: typeof err?.code === 'number'
				? err.code
				: null;
	const text = `${err?.message || ''} ${err?.details || ''}`;
	if (code === 5) return true;
	if (/not found for account/i.test(text)) return true;
	if (
		(code === 14 || code === 9) &&
		/(function|inactive|degrad|no instances|not ready)/i.test(text)
	)
		return true;
	return false;
}

/**
 * Choose the Audio2Face function to fail over to from an NVCF listing (one row
 * per function VERSION: { id, status, name }). A function qualifies when any
 * of its versions is ACTIVE. `exclude` is the id that just failed.
 * @returns {string|null}
 */
export function pickActiveA2fFunction(functions, { exclude } = {}) {
	const rows = Array.isArray(functions) ? functions : [];
	const exact = rows.filter((f) => f?.name === A2F_FUNCTION_NAME);
	const pool = exact.length
		? exact
		: rows.filter((f) => A2F_NAME_HINT.test(String(f?.name || '')));
	const active = new Set(
		pool.filter((f) => String(f?.status).toUpperCase() === 'ACTIVE').map((f) => f.id),
	);
	active.delete(exclude);
	return active.size ? [...active][0] : null;
}

/** Status of one function id across its versions: 'ACTIVE' if any is, else the first seen. */
export function functionStatus(functions, id) {
	const rows = (Array.isArray(functions) ? functions : []).filter((f) => f?.id === id);
	if (!rows.length) return 'MISSING';
	if (rows.some((f) => String(f.status).toUpperCase() === 'ACTIVE')) return 'ACTIVE';
	return String(rows[0].status || 'UNKNOWN').toUpperCase();
}

/** GET NVCF's function list with the lane's own key. Throws on a non-2xx. */
export async function listNvcfFunctions({ apiKey, timeoutMs = 8000 } = {}) {
	const key = apiKey || env.NVIDIA_API_KEY;
	if (!key) throw Object.assign(new Error('NVIDIA_API_KEY not set'), { code: 'not_configured' });
	const res = await fetch(NVCF_FUNCTIONS_URL, {
		headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!res.ok)
		throw Object.assign(new Error(`NVCF function list returned ${res.status}`), {
			code: 'provider_error',
		});
	const data = await res.json();
	return Array.isArray(data?.functions) ? data.functions : [];
}

/**
 * Remembers which function id actually works for a pinned id.
 *   resolve(base)          → the id to call (healed id while `base` is unchanged)
 *   discover(failedId)     → an ACTIVE replacement, or null
 *   markHealed(base, id)   → remember a replacement that just served
 *   refresh(base)          → proactive check (warm probe, monitor): switch
 *                            early when the pinned id has no ACTIVE version
 *   state()                → for the capability probe and the monitor
 */
export function createFunctionHealer({
	listFunctions = () => listNvcfFunctions(),
	now = Date.now,
} = {}) {
	let healed = null; // { id, from, at, reason }
	let listing = null; // { at, rows }

	async function rows() {
		if (listing && now() - listing.at < LISTING_TTL_MS) return listing.rows;
		const fresh = await listFunctions();
		listing = { at: now(), rows: fresh };
		return fresh;
	}

	return {
		resolve(base) {
			return healed && healed.from === base ? healed.id : base;
		},
		async discover(failedId) {
			try {
				return pickActiveA2fFunction(await rows(), { exclude: failedId });
			} catch {
				return null;
			}
		},
		markHealed(base, id, reason = 'rotation') {
			if (id === base) {
				healed = null;
				return;
			}
			healed = { id, from: base, at: new Date(now()).toISOString(), reason };
		},
		async refresh(base) {
			const listed = await rows();
			const current = this.resolve(base);
			const status = functionStatus(listed, current);
			const active = pickActiveA2fFunction(listed);
			if (status !== 'ACTIVE' && active && active !== current)
				this.markHealed(base, active, `pinned ${status}`);
			return {
				pinned: base,
				pinnedStatus: functionStatus(listed, base),
				using: this.resolve(base),
				activeId: active,
			};
		},
		state() {
			return healed
				? { healedId: healed.id, from: healed.from, at: healed.at, reason: healed.reason }
				: null;
		},
	};
}

// One healer per warm process: every request in the instance benefits from the
// first one that healed.
export const a2fHealer = createFunctionHealer();

// ── Audio math ──────────────────────────────────────────────────────────────

// Downmix interleaved s16 PCM to mono. Returns the input untouched when already
// mono. Averaging avoids the +6 dB clipping a naive sum would cause.
function toMonoInt16(pcm, channels) {
	if (channels <= 1)
		return new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
	const view = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
	const frames = Math.floor(view.length / channels);
	const out = new Int16Array(frames);
	for (let i = 0; i < frames; i++) {
		let sum = 0;
		for (let c = 0; c < channels; c++) sum += view[i * channels + c];
		out[i] = Math.round(sum / channels);
	}
	return out;
}

// Linear-interpolation resampler for mono s16. Speech feature extraction does
// not need a windowed-sinc kernel; linear keeps formant cues intact at a
// fraction of the cost and introduces no audible artifacts the model cares about.
function resampleInt16(mono, fromRate, toRate) {
	if (fromRate === toRate) return mono;
	const ratio = toRate / fromRate;
	const outLen = Math.max(1, Math.floor(mono.length * ratio));
	const out = new Int16Array(outLen);
	for (let i = 0; i < outLen; i++) {
		const srcPos = i / ratio;
		const i0 = Math.floor(srcPos);
		const i1 = Math.min(i0 + 1, mono.length - 1);
		const frac = srcPos - i0;
		out[i] = Math.round(mono[i0] * (1 - frac) + mono[i1] * frac);
	}
	return out;
}

/**
 * The streaming counterpart of resampleInt16, for TTS audio that arrives in
 * chunks. It carries the fractional read position and the previous chunk's
 * last sample, so a chunked stream resamples to the same signal as one pass
 * with no seam at the boundaries.
 */
export class StreamingResampler {
	constructor(fromRate, toRate) {
		this.step = fromRate / toRate; // source samples per output sample
		this.pos = 0; // read position relative to the next chunk's first sample
		this.prev = 0;
		this.passthrough = fromRate === toRate;
	}

	/** @param {Int16Array} chunk @returns {Int16Array} */
	push(chunk) {
		if (this.passthrough || !chunk.length) return chunk;
		const out = new Int16Array(Math.ceil((chunk.length + 1) / this.step) + 1);
		let n = 0;
		while (this.pos < chunk.length - 1) {
			const i0 = Math.floor(this.pos);
			const frac = this.pos - i0;
			const s0 = i0 < 0 ? this.prev : chunk[i0];
			const s1 = chunk[i0 + 1];
			out[n++] = Math.round(s0 * (1 - frac) + s1 * frac);
			this.pos += this.step;
		}
		this.pos -= chunk.length;
		this.prev = chunk[chunk.length - 1];
		return out.subarray(0, n);
	}
}

// gRPC status code → platform error code (numeric codes so the mapping does not
// depend on the grpc-js import being resolved). Mirrors tts-nvidia.js / asr-nvidia.js.
function normalizeGrpcError(err) {
	const code = typeof err?.code === 'number' ? err.code : null;
	const map = {
		3: 'invalid_argument', // bad audio header / encoding
		4: 'timeout', // DEADLINE_EXCEEDED
		5: 'function_not_found', // NOT_FOUND: the pinned NVCF function was retired
		7: 'invalid_key', // PERMISSION_DENIED
		8: 'rate_limited', // RESOURCE_EXHAUSTED (credit-metered free tier)
		14: 'provider_unreachable', // UNAVAILABLE
		16: 'invalid_key', // UNAUTHENTICATED
	};
	const normalized = new Error(
		`NVIDIA Audio2Face-3D failed${code !== null ? ` (gRPC ${code})` : ''}: ${err?.details || err?.message || 'unknown error'}`,
	);
	normalized.code = (code !== null && map[code]) || 'provider_error';
	normalized.grpcCode = code;
	return normalized;
}

// One cached client per warm lambda (the TLS channel is keyless: auth rides in
// per-call metadata). @grpc/grpc-js is imported lazily so non-A2F importers do
// not pay for the dependency at cold start. See tts-nvidia.js for the NVCF
// warm-channel auth caveat the verify script works around.
let clientPromise = null;
async function getClient() {
	if (!clientPromise) {
		clientPromise = (async () => {
			const [{ default: grpc }, { default: protoLoader }] = await Promise.all([
				import('@grpc/grpc-js'),
				import('@grpc/proto-loader'),
			]);
			const definition = protoLoader.fromJSON(a2fDescriptor, {
				keepCase: true,
				longs: Number,
				enums: String,
				defaults: true,
				oneofs: true,
			});
			const pkg = grpc.loadPackageDefinition(definition);
			const Service = pkg.nvidia_ace.services.a2f_controller.v1.A2FControllerService;
			return {
				grpc,
				client: new Service(NVIDIA_A2F_HOST, grpc.credentials.createSsl(), {
					// Animation streams come back as many small frames, but the echoed
					// audio + headers can be sizeable on long clips: lift both caps.
					'grpc.max_receive_message_length': 64 * 1024 * 1024,
					'grpc.max_send_message_length': 64 * 1024 * 1024,
					// Keep the HTTP/2 connection to NVCF alive between requests so the
					// next call skips the TLS + auth handshake (~1 s measured cold).
					'grpc.keepalive_time_ms': 30_000,
					'grpc.keepalive_permit_without_calls': 1,
				}),
			};
		})().catch((e) => {
			clientPromise = null; // a failed init must not poison the warm lambda
			throw e;
		});
	}
	return clientPromise;
}

/**
 * Open and authenticate the A2F stream path ahead of the first request, so a
 * talking avatar's first line does not pay TLS + per-stream NVCF auth. Streams
 * a third of a second of silence through a real session, which also runs the
 * rotation healer if the pinned function is gone. Never throws.
 */
export async function warmA2fChannel({ timeoutMs = 8000, functionId, apiKey } = {}, deps = {}) {
	const t0 = Date.now();
	try {
		const session = await openA2fSession({ functionId, apiKey, timeoutMs }, deps);
		session.write(new Int16Array(Math.round(A2F_SAMPLE_RATE_HZ / 3)));
		session.end();
		const result = await session.done;
		return { ok: true, ms: Date.now() - t0, functionId: result.functionId, healedFrom: result.healedFrom };
	} catch (e) {
		return { ok: false, ms: Date.now() - t0, error: e?.code || e?.message || String(e) };
	}
}

function buildHeader({ blendshapeMultipliers, faceParams }) {
	return {
		audio_stream_header: {
			audio_header: {
				audio_format: 'AUDIO_FORMAT_PCM',
				channel_count: 1,
				samples_per_second: A2F_SAMPLE_RATE_HZ,
				bits_per_sample: 16,
			},
			// Clamp output weights to [0,1] so they map straight onto morph target
			// influences without the frontend having to renormalize. Optional
			// per-shape multipliers let a caller dial specific shapes up/down.
			blendshape_params: {
				enable_clamping_bs_weight: true,
				...(blendshapeMultipliers ? { bs_weight_multipliers: blendshapeMultipliers } : {}),
			},
			...(faceParams ? { face_params: { float_params: faceParams } } : {}),
		},
	};
}

function int16ToBuffer(arr) {
	return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

/**
 * A live Audio2Face-3D session: push 16 kHz mono s16 audio as it is produced
 * (for example straight out of Magpie's streaming synthesis) and receive
 * blendshape frames as A2F emits them, instead of waiting for the whole clip.
 *
 *   const s = await openA2fSession({ onHeader, onFrames });
 *   s.write(int16Chunk) ... s.end();
 *   const { functionId, healedFrom, blendShapeNames, frameCount } = await s.done;
 *
 * Every chunk written is kept until the first frame arrives, so if the pinned
 * function turns out to be retired the session discovers the ACTIVE one and
 * replays the audio on it transparently. After frames have been emitted a
 * failure rejects `done` (the caller already showed part of the animation).
 *
 * `deps` exists so the healing loop can be exercised without a network:
 * { getClient, healer }.
 */
export async function openA2fSession(
	{
		functionId,
		apiKey,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		blendshapeMultipliers,
		faceParams,
		onHeader,
		onFrames,
	} = {},
	deps = {},
) {
	const key = apiKey || env.NVIDIA_API_KEY;
	if (!key) {
		const err = new Error('NVIDIA_API_KEY not set');
		err.code = 'not_configured';
		throw err;
	}
	const healer = deps.healer || a2fHealer;
	const { grpc, client } = await (deps.getClient || getClient)();
	const base = resolveA2fFunctionId(functionId);
	const header = buildHeader({ blendshapeMultipliers, faceParams });
	const deadline = Date.now() + timeoutMs;

	const buffered = [];
	let ended = false;
	let call = null;
	let currentId = null;
	let framesSeen = 0;
	let names = [];
	let settled = false;
	let resolveDone;
	let rejectDone;
	const done = new Promise((res, rej) => {
		resolveDone = res;
		rejectDone = rej;
	});
	// A failure before anyone awaits `done` must not surface as an unhandled
	// rejection; the caller still observes it through `done`.
	done.catch(() => {});

	const finish = (fn, value) => {
		if (settled) return;
		settled = true;
		fn(value);
	};

	function start(id) {
		currentId = id;
		const metadata = new grpc.Metadata();
		metadata.set('function-id', id);
		metadata.set('authorization', `Bearer ${key}`);
		let thisCall;
		try {
			thisCall = client.processAudioStream(metadata, { deadline: new Date(deadline) });
		} catch (e) {
			onFailure(normalizeGrpcError(e), null);
			return;
		}
		call = thisCall;
		thisCall.on('data', (msg) => {
			if (thisCall !== call) return;
			if (msg.animation_data_stream_header) {
				const n = msg.animation_data_stream_header.skel_animation_header?.blend_shapes;
				if (Array.isArray(n) && n.length) {
					names = n;
					onHeader?.(n);
				}
			} else if (msg.animation_data) {
				const weights = msg.animation_data.skel_animation?.blend_shape_weights;
				if (Array.isArray(weights) && weights.length) {
					const frames = weights.map((frame) => ({
						t: Number(frame.time_code) || 0,
						w: Array.isArray(frame.values) ? frame.values.map((v) => clamp01(v)) : [],
					}));
					framesSeen += frames.length;
					if (framesSeen === frames.length) buffered.length = 0; // replay no longer possible or needed
					onFrames?.(frames);
				}
			} else if (msg.status && msg.status.code === 'ERROR') {
				// A2F can answer ERROR in-band (e.g. audio-limit) before closing OK.
				onFailure(
					Object.assign(
						new Error(`A2F status ERROR: ${msg.status.message || 'unknown'}`),
						{ code: 'provider_error' },
					),
					thisCall,
				);
				try {
					thisCall.cancel();
				} catch {}
			}
		});
		thisCall.on('error', (e) =>
			onFailure(
				e instanceof Error && e.code && typeof e.code === 'string'
					? e
					: normalizeGrpcError(e),
				thisCall,
			),
		);
		thisCall.on('end', () => {
			if (thisCall !== call || settled) return;
			if (!framesSeen) {
				finish(
					rejectDone,
					Object.assign(new Error('Audio2Face-3D returned no animation frames'), {
						code: 'provider_error',
					}),
				);
				return;
			}
			const healedFrom = currentId !== base ? base : null;
			finish(resolveDone, {
				functionId: currentId,
				healedFrom,
				blendShapeNames: names,
				frameCount: framesSeen,
			});
		});
		try {
			thisCall.write(header);
			for (const chunk of buffered)
				thisCall.write({ audio_with_emotion: { audio_buffer: int16ToBuffer(chunk) } });
			if (ended) {
				thisCall.write({ end_of_audio: {} });
				thisCall.end();
			}
		} catch (e) {
			onFailure(normalizeGrpcError(e), thisCall);
		}
	}

	async function onFailure(err, fromCall) {
		if (settled || (fromCall && fromCall !== call)) return;
		call = null; // ignore anything else the failed call emits
		if (!framesSeen && isFunctionRotationError(err)) {
			const next = await healer.discover(currentId);
			if (next && next !== currentId && Date.now() < deadline) {
				healer.markHealed(base, next);
				start(next);
				return;
			}
		}
		finish(rejectDone, err);
	}

	start(healer.resolve(base));

	return {
		write(int16) {
			if (ended || settled || !int16?.length) return;
			// Copy: the caller may reuse its buffer, and the copy is what a replay sends.
			const owned = Int16Array.from(int16);
			if (!framesSeen) buffered.push(owned);
			if (call) {
				try {
					call.write({ audio_with_emotion: { audio_buffer: int16ToBuffer(owned) } });
				} catch (e) {
					onFailure(normalizeGrpcError(e), call);
				}
			}
		},
		end() {
			if (ended) return;
			ended = true;
			if (call) {
				try {
					call.write({ end_of_audio: {} });
					call.end();
				} catch (e) {
					onFailure(normalizeGrpcError(e), call);
				}
			}
		},
		cancel() {
			const c = call;
			call = null;
			finish(rejectDone, Object.assign(new Error('cancelled'), { code: 'cancelled' }));
			try {
				c?.cancel();
			} catch {}
		},
		done,
	};
}

// Generate a facial-animation track from spoken audio on the free NIM lane.
//
//   { wav?: Buffer, pcm?: Buffer, sampleRateHz?, channels?, functionId?,
//     faceParams?, blendshapeMultipliers?, timeoutMs?, apiKey? }
//     → { fps, blendShapeNames, frames: [{ t, w }], frameCount, durationSec,
//         sampleRateHz, model, functionId, healedFrom }
//
// Provide EITHER `wav` (a RIFF/WAVE buffer: the Magpie output is passed straight
// through; its header is parsed for rate + channels) OR raw `pcm` (header-less
// little-endian s16) with `sampleRateHz`. `frames[i].t` is the time code in
// seconds relative to the clip start; `frames[i].w` is the blendshape weights in
// the order of `blendShapeNames` (the names come from the model, ARKit naming).
// `healedFrom` is the pinned id when the call had to fail over to a rotated one.
//
// Throws Error with .code ∈ not_configured | invalid_key | rate_limited |
// invalid_argument | timeout | function_not_found | provider_unreachable |
// provider_error.
export async function animateNvidiaA2F(
	{
		wav,
		pcm,
		sampleRateHz,
		channels = 1,
		functionId,
		faceParams,
		blendshapeMultipliers,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		apiKey,
	} = {},
	deps = {},
) {
	// ── Normalize the audio to 16 kHz mono s16 ────────────────────────────────
	let monoSrc;
	let srcRate;
	if (Buffer.isBuffer(wav) && wav.length) {
		const parsed = parseWav(wav);
		if (!parsed) {
			const err = new Error('audio is not a valid WAV (no RIFF/WAVE header)');
			err.code = 'invalid_argument';
			throw err;
		}
		monoSrc = toMonoInt16(parsed.pcm, parsed.channels);
		srcRate = parsed.sampleRateHz;
	} else if (Buffer.isBuffer(pcm) && pcm.length) {
		if (!sampleRateHz) {
			const err = new Error('sampleRateHz is required when passing raw pcm');
			err.code = 'invalid_argument';
			throw err;
		}
		monoSrc = toMonoInt16(pcm, channels);
		srcRate = sampleRateHz;
	} else {
		const err = new Error('no audio provided (expected wav or pcm)');
		err.code = 'invalid_argument';
		throw err;
	}

	if (monoSrc.length / srcRate > MAX_AUDIO_SECONDS) {
		const err = new Error(`audio exceeds ${MAX_AUDIO_SECONDS}s limit`);
		err.code = 'invalid_argument';
		throw err;
	}

	const mono16k = resampleInt16(monoSrc, srcRate, A2F_SAMPLE_RATE_HZ);
	let blendShapeNames = [];
	const frames = [];
	const session = await openA2fSession(
		{
			functionId,
			apiKey,
			timeoutMs,
			faceParams,
			blendshapeMultipliers,
			onHeader: (names) => {
				blendShapeNames = names;
			},
			onFrames: (f) => frames.push(...f),
		},
		deps,
	);
	// 1 s chunks, matching NVIDIA's sample cadence. Chunking keeps any single
	// gRPC message small; the size is not semantically meaningful to the model.
	for (let i = 0; i < mono16k.length; i += A2F_SAMPLE_RATE_HZ) {
		session.write(mono16k.subarray(i, Math.min(i + A2F_SAMPLE_RATE_HZ, mono16k.length)));
	}
	session.end();
	const result = await session.done;

	// Time codes are strictly increasing; keep them sorted defensively in case
	// the server interleaves frames across animation-data messages.
	frames.sort((a, b) => a.t - b.t);
	return {
		...summarizeTrack(frames, mono16k.length / A2F_SAMPLE_RATE_HZ),
		blendShapeNames: result.blendShapeNames.length ? result.blendShapeNames : blendShapeNames,
		frames,
		sampleRateHz: A2F_SAMPLE_RATE_HZ,
		model: 'audio2face-3d',
		functionId: result.functionId,
		healedFrom: result.healedFrom,
	};
}

/** fps (derived from the real frame cadence), frameCount and durationSec for a track. */
export function summarizeTrack(frames, durationSec) {
	let fps = A2F_FPS;
	if (frames.length > 1) {
		const span = frames[frames.length - 1].t - frames[0].t;
		if (span > 0) fps = Math.round((frames.length - 1) / span);
	}
	return { fps, frameCount: frames.length, durationSec };
}

function clamp01(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	if (v < 0) return 0;
	if (v > 1) return 1;
	return v;
}

// Mirror just enough audio math for the verify script + tests to exercise the
// resampler/downmixer without a live gRPC call.
export const _internals = { toMonoInt16, resampleInt16 };
