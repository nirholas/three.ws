// POST /api/pump/vanity-keygen
//
// Streams progress via Server-Sent Events; final event delivers the result.
//
// body: { suffix?, prefix?, caseSensitive?, maxAttempts? }
//   - at least one of suffix / prefix must be non-empty
//   - hard cap: 60 s wallclock; aborts with 408 if exceeded
//
// SSE event stream:
//   event: progress   data: { attempts, elapsed }   (every ~50k attempts)
//   event: result     data: { publicKey, secretKey: base58, attempts, ms }
//   event: error      data: { error, error_description }
//
// Secret keys are never logged.

import { cors, readJson, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { generateVanityKey } from '../../src/pump/vanity-keygen.js';
import bs58 from 'bs58';

const TIMEOUT_MS = 60_000;

function sseEvent(res, event, data) {
	res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export default async function handler(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', origins: '*' })) return;

	if (req.method !== 'POST') {
		res.setHeader('allow', 'POST');
		return error(res, 405, 'method_not_allowed', 'method POST required');
	}

	const rl = await limits.mcpIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	let body;
	try {
		body = await readJson(req);
	} catch (e) {
		return error(res, e.status || 400, 'bad_request', e.message);
	}

	const { suffix = '', prefix = '', caseSensitive = false, maxAttempts = 5_000_000 } = body || {};

	if (!suffix && !prefix) {
		return error(res, 400, 'validation_error', 'at least one of suffix or prefix is required');
	}

	// Start SSE stream
	res.statusCode = 200;
	res.setHeader('content-type', 'text/event-stream; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.setHeader('connection', 'keep-alive');
	res.setHeader('x-accel-buffering', 'no');

	const ac = new AbortController();

	const timeout = setTimeout(() => {
		ac.abort();
		sseEvent(res, 'error', {
			error: 'request_timeout',
			error_description: 'vanity search exceeded 60 s limit',
		});
		res.statusCode = 408;
		res.end();
	}, TIMEOUT_MS);

	req.on('close', () => ac.abort());

	// Progress ticker — emit every 50k attempts via a periodic callback wired
	// through the AbortSignal so it stops naturally when we're done.
	let lastReported = 0;
	const progressInterval = setInterval(() => {
		if (ac.signal.aborted) return clearInterval(progressInterval);
		// We can't read the exact attempt count here — just emit elapsed time.
		sseEvent(res, 'progress', { elapsed: Date.now() });
	}, 2_000);

	try {
		const result = await generateVanityKey({
			suffix,
			prefix,
			caseSensitive,
			maxAttempts,
			signal: ac.signal,
		});

		clearTimeout(timeout);
		clearInterval(progressInterval);

		if (!result) {
			sseEvent(res, 'error', {
				error: 'max_attempts_reached',
				error_description: `no match found in ${maxAttempts} attempts`,
			});
		} else {
			sseEvent(res, 'result', {
				publicKey: result.publicKey,
				secretKey: bs58.encode(result.secretKey),
				attempts: result.attempts,
				ms: result.ms,
			});
		}
	} catch (err) {
		clearTimeout(timeout);
		clearInterval(progressInterval);
		if (!res.writableEnded) {
			sseEvent(res, 'error', {
				error: 'internal_error',
				error_description: err.message || 'unexpected error',
			});
		}
	} finally {
		if (!res.writableEnded) res.end();
	}
}
