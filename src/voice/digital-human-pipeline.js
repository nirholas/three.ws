// The conversational digital human's turn pipeline: speech -> text -> reply ->
// voice + face, with every stage overlapped and every stage able to fail over.
//
// Isomorphic on purpose (no DOM): the browser demo (public/demos/audio2face.html),
// the latency bench (scripts/digital-human-latency-bench.mjs) and the hourly
// production monitor (api/cron/digital-human-monitor.js) all run THIS code, so
// the numbers the monitor alerts on are the numbers a visitor experiences.
//
// Pipelined strategy (what the demo runs):
//   ASR text -> /api/chat streams tokens -> SentenceChunker cuts the first
//   speakable clause the moment it exists -> /api/a2f stream:true returns PCM
//   chunks and blendshape frames for that clause while the LLM keeps writing ->
//   next clause queued behind it.
// Serial strategy (the old shape, kept as the measured baseline):
//   ASR -> whole reply -> one blocking /api/a2f {text} -> play.
//
// Fallback lanes per spoken segment, in order, each with its own breaker:
//   'stream'  /api/a2f stream (Magpie + Audio2Face-3D; A2F may degrade in-band)
//   'clip'    /api/tts/speak (multi-lane TTS) played with amplitude lipsync
//   'browser' speechSynthesis in the visitor's browser with a viseme timeline
//   'text'    caption only (nothing left that can make a sound)

const SENTENCE_END = /[.!?…]["')\]]*\s/;
const SOFT_BREAK = /[,;:]\s/;
const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs|Mr|Mrs|Ms|Dr|Prof|St|No|approx|U\.S)\.$/i;

/** Strip markdown and links so the voice says words, not syntax. */
export function speakable(text) {
	return String(text || '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/https?:\/\/\S+/g, 'the link')
		.replace(/^[ \t]*[#>*\-+]+[ \t]+/gm, '')
		.replace(/[*_~#]+/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Cuts a token stream into speakable segments. The first segment is released as
 * early as is natural (a sentence end, or a clause break once it is long enough)
 * because it sets the time to first sound; later segments group sentences so a
 * reply costs a few requests, not one per sentence.
 */
export class SentenceChunker {
	constructor({ firstSoftMin = 48, groupMin = 90, maxChars = 280 } = {}) {
		this.firstSoftMin = firstSoftMin;
		this.groupMin = groupMin;
		this.maxChars = maxChars;
		this.buf = '';
		this.emitted = 0;
	}

	/** @returns {string[]} segments completed by this text */
	push(text) {
		this.buf += text;
		const out = [];
		for (;;) {
			const seg = this._take();
			if (!seg) break;
			out.push(seg);
		}
		return out;
	}

	/** @returns {string|null} whatever is left at the end of the reply */
	flush() {
		const seg = speakable(this.buf);
		this.buf = '';
		if (!seg) return null;
		this.emitted++;
		return seg;
	}

	_take() {
		const min = this.emitted === 0 ? 1 : this.groupMin;
		let cut = -1;
		let from = 0;
		for (;;) {
			const m = SENTENCE_END.exec(this.buf.slice(from));
			if (!m) break;
			const end = from + m.index + m[0].length;
			const sentence = this.buf.slice(0, end).trimEnd();
			if (ABBREVIATIONS.test(sentence)) {
				from = end;
				continue;
			}
			cut = end;
			if (speakable(this.buf.slice(0, cut)).length >= min) break;
			from = end;
		}
		if (cut < 0 || speakable(this.buf.slice(0, cut)).length < min) {
			cut = -1;
			if (this.emitted === 0) {
				const soft = SOFT_BREAK.exec(this.buf.slice(this.firstSoftMin));
				if (soft) cut = this.firstSoftMin + soft.index + soft[0].length;
			}
			if (cut < 0 && this.buf.length > this.maxChars) {
				const space = this.buf.lastIndexOf(' ', this.maxChars);
				cut = space > 0 ? space + 1 : this.maxChars;
			}
		}
		if (cut < 0) return null;
		const seg = speakable(this.buf.slice(0, cut));
		this.buf = this.buf.slice(cut);
		if (!seg) return null;
		this.emitted++;
		return seg;
	}
}

// ── Latency ─────────────────────────────────────────────────────────────────

/** Linear-interpolated percentile (p in 0..100) of finite numbers; null if none. */
export function percentile(values, p) {
	const xs = values
		.filter((v) => typeof v === 'number' && Number.isFinite(v))
		.sort((a, b) => a - b);
	if (!xs.length) return null;
	const rank = (p / 100) * (xs.length - 1);
	const lo = Math.floor(rank);
	const hi = Math.ceil(rank);
	return Math.round(xs[lo] + (xs[hi] - xs[lo]) * (rank - lo));
}

// The per-turn marks, all in ms from the end of the visitor's speech.
export const STAGES = [
	'asrText',
	'llmFirstToken',
	'ttsFirstAudio',
	'a2fFirstFrame',
	'a2fTotal',
	'total',
];

export const STAGE_LABELS = {
	asrText: 'ASR text',
	llmFirstToken: 'LLM first token',
	ttsFirstAudio: 'TTS first audio',
	a2fFirstFrame: 'A2F first frame',
	a2fTotal: 'A2F total',
	total: 'Turn total',
};

/** p50 / p95 per stage over a list of turn timing objects. */
export function summarizeTimings(runs, stages = STAGES) {
	const out = {};
	for (const s of stages) {
		const vals = runs.map((r) => r?.[s]);
		out[s] = {
			p50: percentile(vals, 50),
			p95: percentile(vals, 95),
			n: vals.filter(Number.isFinite).length,
		};
	}
	return out;
}

// ── Lane health (circuit breakers) ──────────────────────────────────────────

/**
 * Remembers which lanes failed so the next segment does not pay the timeout
 * again. A failed lane is skipped for a cooldown that doubles per consecutive
 * failure (15 s up to 5 min), then probed again by real traffic.
 */
export class LaneHealth {
	constructor({ now = () => Date.now(), baseMs = 15_000, maxMs = 300_000 } = {}) {
		this.now = now;
		this.baseMs = baseMs;
		this.maxMs = maxMs;
		this.lanes = new Map();
	}

	allow(lane) {
		const s = this.lanes.get(lane);
		return !s || this.now() >= s.until;
	}

	fail(lane, reason) {
		const s = this.lanes.get(lane) || { failures: 0 };
		s.failures++;
		s.reason = reason || 'error';
		s.until = this.now() + Math.min(this.maxMs, this.baseMs * 2 ** (s.failures - 1));
		this.lanes.set(lane, s);
	}

	ok(lane) {
		this.lanes.delete(lane);
	}

	/** { lane: { failures, reason, retryInMs } } for the on-screen state. */
	snapshot() {
		const out = {};
		for (const [lane, s] of this.lanes) {
			out[lane] = {
				failures: s.failures,
				reason: s.reason,
				retryInMs: Math.max(0, s.until - this.now()),
			};
		}
		return out;
	}
}

// ── Transport ───────────────────────────────────────────────────────────────

/**
 * Parse a server-sent event stream. Handles both shapes this platform emits:
 * `data:`-only frames (/api/chat) and named `event:` frames (/api/a2f stream).
 */
export async function readSSE(body, onEvent, { signal } = {}) {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	const dispatch = (block) => {
		let event = 'message';
		const data = [];
		for (const line of block.split('\n')) {
			if (line.startsWith('event:')) event = line.slice(6).trim();
			else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
		}
		if (!data.length) return;
		let parsed;
		try {
			parsed = JSON.parse(data.join('\n'));
		} catch {
			return;
		}
		onEvent(event, parsed);
	};
	try {
		for (;;) {
			if (signal?.aborted) throw abortError();
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
			let idx;
			while ((idx = buf.indexOf('\n\n')) >= 0) {
				dispatch(buf.slice(0, idx));
				buf = buf.slice(idx + 2);
			}
		}
		if (buf.trim()) dispatch(buf);
	} finally {
		try {
			reader.releaseLock();
		} catch {}
	}
}

function abortError() {
	return Object.assign(new Error('aborted'), { name: 'AbortError', code: 'aborted' });
}

export function stageError(stage, code, message, extra = {}) {
	return Object.assign(new Error(message || `${stage} failed`), {
		stage,
		code: code || 'error',
		...extra,
	});
}

async function errorFrom(res, stage) {
	let body = {};
	try {
		body = await res.json();
	} catch {}
	return stageError(
		stage,
		body.error || `http_${res.status}`,
		body.error_description || `HTTP ${res.status}`,
		{
			status: res.status,
			retryAfter: Number(res.headers.get('retry-after')) || null,
		},
	);
}

export function base64ToBytes(b64) {
	if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

export function bytesToBase64(bytes) {
	if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
	let s = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(s);
}

export function newTurnId() {
	const c = globalThis.crypto;
	if (c?.randomUUID) return c.randomUUID().replace(/-/g, '');
	return Array.from({ length: 24 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}

/**
 * HTTP client for the four endpoints a turn touches. `origin` is '' in the
 * browser (same-origin) and the deployment URL in the bench and the monitor.
 * `emotion` is an optional getter returning the facial-emotion fields for
 * /api/a2f ({ emotion, emotionStrength }); it is read per spoken line, so a
 * change lands on the next sentence. Without it the server reads each line's
 * intent from its words.
 */
export function createDigitalHumanClient({
	origin = '',
	fetch: f = globalThis.fetch.bind(globalThis),
	headers = {},
	emotion = null,
} = {}) {
	const url = (p) => `${origin}${p}`;
	const h = (extra = {}) => ({ ...headers, ...extra });
	const emo = () => (typeof emotion === 'function' ? emotion() || {} : {});

	return {
		/** WAV bytes (16 kHz mono) -> transcript. */
		async transcribe(wavBytes, { language = 'en-US', signal } = {}) {
			const res = await f(url(`/api/asr?language=${encodeURIComponent(language)}`), {
				method: 'POST',
				headers: h({ 'content-type': 'audio/wav' }),
				body: wavBytes,
				signal,
			});
			if (!res.ok) throw await errorFrom(res, 'asr');
			const data = await res.json();
			return { text: String(data.text || '').trim(), confidence: data.confidence ?? null };
		},

		/** Stream a reply. onToken(text) per chunk; onGuard(text) when a guard replaces it. */
		async chat({ message, history = [], systemPrompt, signal, onToken, onGuard }) {
			const res = await f(url('/api/chat'), {
				method: 'POST',
				headers: h({ 'content-type': 'application/json', accept: 'text/event-stream' }),
				body: JSON.stringify({
					message,
					history: history.slice(-20),
					...(systemPrompt ? { system_prompt: systemPrompt.slice(0, 2000) } : {}),
				}),
				signal,
			});
			if (!res.ok) throw await errorFrom(res, 'llm');
			let reply = '';
			let failure = null;
			let doneReply = null;
			await readSSE(
				res.body,
				(_event, data) => {
					if (data.type === 'chunk' && data.text) {
						reply += data.text;
						onToken?.(data.text);
					} else if (data.type === 'guard' && data.text) {
						onGuard?.(data.text);
					} else if (data.type === 'error') {
						failure = stageError(
							'llm',
							data.code || 'stream_error',
							data.message || 'reply interrupted',
						);
					} else if (data.type === 'done') {
						doneReply = typeof data.reply === 'string' ? data.reply : null;
					}
				},
				{ signal },
			);
			if (failure && !reply) throw failure;
			return { reply: doneReply ?? reply, provider: null };
		},

		/** One streamed spoken line (Magpie + Audio2Face-3D). onEvent(type, data). */
		async speakLine({ text, voice, turn, animate = true, signal, onEvent }) {
			const res = await f(url('/api/a2f'), {
				method: 'POST',
				headers: h({ 'content-type': 'application/json', accept: 'text/event-stream' }),
				body: JSON.stringify({ text, voice, stream: true, turn, animate, ...emo() }),
				signal,
			});
			if (!res.ok) throw await errorFrom(res, 'tts');
			let summary = null;
			let failure = null;
			let audioSeen = false;
			await readSSE(
				res.body,
				(event, data) => {
					if (event === 'error')
						failure = stageError(data.stage || 'tts', data.code, data.message, data);
					else if (event === 'done') summary = data;
					else {
						if (event === 'audio') audioSeen = true;
						onEvent?.(event, data);
					}
				},
				{ signal },
			);
			if (failure) {
				failure.partial = failure.partial || audioSeen;
				throw failure;
			}
			if (!summary)
				throw stageError('tts', 'stream_cut', 'the voice stream ended early', {
					partial: audioSeen,
				});
			return summary;
		},

		/** Fallback voice: the multi-lane TTS endpoint, as WAV bytes. */
		async speakClip({ text, voice, signal }) {
			const res = await f(url('/api/tts/speak'), {
				method: 'POST',
				headers: h({ 'content-type': 'application/json' }),
				body: JSON.stringify({ text, voice, format: 'wav' }),
				signal,
			});
			if (!res.ok) throw await errorFrom(res, 'tts');
			return new Uint8Array(await res.arrayBuffer());
		},

		/** The old blocking path: text -> { audio, animation } in one response. */
		async speakBlocking({ text, voice, signal }) {
			const res = await f(url('/api/a2f'), {
				method: 'POST',
				headers: h({ 'content-type': 'application/json' }),
				body: JSON.stringify({ text, voice, ...emo() }),
				signal,
			});
			if (!res.ok) throw await errorFrom(res, 'a2f');
			return res.json();
		},

		/** Open and authenticate both NVIDIA channels server-side. */
		async warm({ signal } = {}) {
			const res = await f(url('/api/a2f?warm=1'), { headers: h(), signal });
			if (!res.ok) throw await errorFrom(res, 'warm');
			return res.json();
		},

		async capabilities({ signal } = {}) {
			const res = await f(url('/api/a2f'), { headers: h(), signal });
			if (!res.ok) throw await errorFrom(res, 'a2f');
			return res.json();
		},
	};
}

// ── The turn ────────────────────────────────────────────────────────────────

/**
 * The output side a turn speaks into. The browser page implements it with Web
 * Audio + the avatar; the bench and monitor use a recording sink. Every method
 * is optional except where noted.
 *
 *   transcript(text)                       ASR result shown to the visitor
 *   token(text)                            LLM text as it streams (captions)
 *   segment(index, text)                   a segment is about to be voiced
 *   line(index, type, data)                stream events: meta/audio/header/frames/degraded
 *   playClip(index, wavBytes, text)        -> Promise, resolves when queued (lane 'clip')
 *   speakBrowser(index, text)              -> Promise, resolves when queued (lane 'browser')
 *   caption(index, text)                   lane 'text'
 *   lane(index, lane, reason)              which lane voiced the segment
 *   replace(text)                          a guard replaced the reply
 */

const LANES = ['stream', 'clip', 'browser', 'text'];
const TRANSIENT = new Set(['aborted', 'cancelled']);

/**
 * Run one conversational turn.
 * @returns {Promise<{ transcript, reply, timings, lanes, degraded, errors }>}
 */
export async function runTurn({
	client,
	audio = null,
	text = null,
	say = null,
	history = [],
	systemPrompt,
	voice = 'nova',
	language = 'en-US',
	sink = {},
	health = new LaneHealth(),
	strategy = 'pipelined',
	browserVoice = false,
	animate = true,
	signal,
	now = () => (globalThis.performance?.now ? performance.now() : Date.now()),
	t0 = now(),
}) {
	const mark = {};
	const at = (k) => {
		if (mark[k] === undefined) mark[k] = Math.round(now() - t0);
	};
	const errors = [];
	const lanesUsed = [];
	let degraded = null;

	// 1. Speech -> text.
	let transcript = text ?? say;
	if (audio) {
		try {
			transcript = (await client.transcribe(audio, { language, signal })).text;
		} catch (e) {
			if (signal?.aborted) throw e;
			errors.push({ stage: 'asr', code: e.code, message: e.message });
			return {
				transcript: null,
				reply: null,
				timings: mark,
				lanes: lanesUsed,
				degraded,
				errors,
				failedStage: 'asr',
			};
		}
		at('asrText');
	}
	if (!transcript) {
		return {
			transcript: '',
			reply: null,
			timings: mark,
			lanes: lanesUsed,
			degraded,
			errors,
			failedStage: 'asr_empty',
		};
	}
	sink.transcript?.(transcript);

	const turn = newTurnId();
	const queue = [];
	let wake = null;
	let llmDone = false;
	const enqueue = (seg) => {
		if (!seg) return;
		queue.push(seg);
		wake?.();
	};

	// 2. Reply, cut into segments as it streams.
	const chunker = new SentenceChunker();
	let reply = '';
	let replaced = null;
	const llm = (async () => {
		try {
			// "Say this line": the reply is given, so it is voiced through the
			// same chunking and lanes with no LLM in the way.
			const res = say
				? { reply: String(say) }
				: await client.chat({
						message: transcript,
						history,
						systemPrompt,
						signal,
						onToken: (tok) => {
							at('llmFirstToken');
							sink.token?.(tok);
							if (strategy === 'pipelined' && !replaced)
								for (const seg of chunker.push(tok)) enqueue(seg);
						},
						onGuard: (t) => {
							replaced = t;
						},
					});
			if (say && strategy === 'pipelined') for (const seg of chunker.push(say)) enqueue(seg);
			reply = res.reply;
		} catch (e) {
			if (signal?.aborted) throw e;
			errors.push({ stage: 'llm', code: e.code, message: e.message });
			replaced =
				"Sorry, my language model isn't answering right now. Please ask me again in a moment.";
			degraded = degraded || 'llm';
		}
		at('llmDone');
		if (replaced) {
			queue.length = 0;
			sink.replace?.(replaced);
			reply = replaced;
			enqueue(speakable(replaced));
		} else if (strategy === 'pipelined') {
			enqueue(chunker.flush());
		} else {
			enqueue(speakable(reply));
		}
		llmDone = true;
		wake?.();
	})();

	// 3. Voice + face, one segment at a time, in order, behind the LLM.
	let index = 0;
	const speak = async (seg) => {
		const i = index++;
		sink.segment?.(i, seg);
		if (strategy === 'serial') return speakSerial(i, seg);
		const order = browserVoice ? ['browser', 'text'] : LANES;
		for (const lane of order) {
			if (lane !== 'text' && !health.allow(lane)) continue;
			try {
				if (lane === 'stream') {
					const summary = await client.speakLine({
						text: seg,
						voice,
						turn,
						animate,
						signal,
						onEvent: (type, data) => {
							if (type === 'audio') at('ttsFirstAudio');
							if (type === 'frames') at('a2fFirstFrame');
							if (type === 'degraded') degraded = degraded || `a2f:${data.code}`;
							sink.line?.(i, type, data);
						},
					});
					if (summary?.degraded && summary.degraded !== 'skipped')
						health.fail('a2f', summary.degraded);
					else if (summary?.frameCount) health.ok('a2f');
				} else if (lane === 'clip') {
					const wav = await client.speakClip({ text: seg, voice, signal });
					at('ttsFirstAudio');
					await sink.playClip?.(i, wav, seg);
					degraded = degraded || 'tts:clip';
				} else if (lane === 'browser') {
					if (!sink.speakBrowser) continue;
					await sink.speakBrowser(i, seg);
					at('ttsFirstAudio');
					degraded = degraded || 'tts:browser';
				} else {
					sink.caption?.(i, seg);
					degraded = degraded || 'tts:text';
				}
				health.ok(lane);
				lanesUsed.push(lane);
				sink.lane?.(i, lane);
				return;
			} catch (e) {
				if (signal?.aborted || TRANSIENT.has(e.code)) throw e;
				errors.push({ stage: e.stage || 'tts', lane, code: e.code, message: e.message });
				health.fail(lane, e.code);
				sink.lane?.(i, `${lane}:failed`, e.code);
				// Part of this segment already played: do not say it twice.
				if (e.partial) return;
			}
		}
	};

	const speakSerial = async (i, seg) => {
		try {
			const data = await client.speakBlocking({ text: seg, voice, signal });
			at('ttsFirstAudio');
			if (data?.animation?.frames?.length) at('a2fFirstFrame');
			sink.line?.(i, 'blocking', data);
			lanesUsed.push('blocking');
		} catch (e) {
			if (signal?.aborted) throw e;
			errors.push({ stage: e.stage || 'a2f', code: e.code, message: e.message });
		}
	};

	for (;;) {
		if (queue.length) {
			await speak(queue.shift());
			continue;
		}
		if (llmDone) break;
		await new Promise((r) => {
			wake = r;
		});
		wake = null;
	}
	await llm;
	at('a2fTotal');
	at('total');
	return { transcript, reply, timings: mark, lanes: lanesUsed, degraded, errors, turn };
}
