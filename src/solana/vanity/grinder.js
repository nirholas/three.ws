/**
 * Solana vanity address grinder — main-thread API.
 *
 * Spawns a pool of Web Workers (one per logical core, capped) that race
 * to find a Keypair whose Base58 public key matches the requested prefix
 * and/or suffix. First match wins; the rest are terminated.
 *
 * Usage:
 *   const { publicKey, secretKey, attempts, durationMs } = await grindVanity({
 *     prefix: 'AGNT',
 *     onProgress: ({ attempts, rate, eta }) => updateUI(...),
 *     signal,
 *   });
 *
 * The returned `secretKey` is a Uint8Array(64) — Solana's standard
 * Ed25519 keypair format, compatible with `Keypair.fromSecretKey()`.
 *
 * Algorithm parity with nirholas/solana-wallet-toolkit. WASM backend
 * (~10× faster) is a future optimization — see TODO at bottom.
 */

import { validatePattern, estimateAttempts, formatTimeEstimate } from './validation.js';

const DEFAULT_MAX_WORKERS = 8;

/**
 * @typedef {object} GrindOptions
 * @property {string} [prefix]                   - Base58 prefix to match.
 * @property {string} [suffix]                   - Base58 suffix to match.
 * @property {boolean} [ignoreCase=false]        - Case-insensitive match.
 * @property {number} [maxWorkers]               - Cap on workers (defaults to hardwareConcurrency).
 * @property {AbortSignal} [signal]              - Cancel the grind.
 * @property {(p: { attempts: number, rate: number, eta: string }) => void} [onProgress]
 */

/**
 * @typedef {object} GrindResult
 * @property {string} publicKey         - Base58 address.
 * @property {Uint8Array} secretKey     - 64-byte Ed25519 secret key.
 * @property {number} attempts          - Total attempts across all workers.
 * @property {number} durationMs        - Wall-clock duration.
 * @property {number} workers           - Number of workers used.
 */

/**
 * Grind for a vanity Solana address.
 * @param {GrindOptions} opts
 * @returns {Promise<GrindResult>}
 */
export function grindVanity(opts = {}) {
	const { prefix = '', suffix = '', ignoreCase = false, signal, onProgress } = opts;

	if (!prefix && !suffix) {
		return Promise.reject(new Error('prefix or suffix is required'));
	}
	if (prefix) {
		const v = validatePattern(prefix);
		if (!v.valid) return Promise.reject(new Error(`invalid prefix: ${v.errors.join('; ')}`));
	}
	if (suffix) {
		const v = validatePattern(suffix);
		if (!v.valid) return Promise.reject(new Error(`invalid suffix: ${v.errors.join('; ')}`));
	}

	const cores = Math.max(1, Math.min(
		opts.maxWorkers || (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4,
		DEFAULT_MAX_WORKERS,
	));
	const expected = estimateAttempts((prefix?.length || 0) + (suffix?.length || 0));
	const startedAt = performance.now();

	/** @type {Worker[]} */
	const workers = [];
	const ratesByWorker = new Array(cores).fill(0);
	const attemptsByWorker = new Array(cores).fill(0);

	const stopAll = () => {
		for (const w of workers) {
			try { w.postMessage({ type: 'stop' }); } catch {}
			try { w.terminate(); } catch {}
		}
		workers.length = 0;
	};

	return new Promise((resolve, reject) => {
		const onAbort = () => {
			stopAll();
			reject(new DOMException('vanity grind aborted', 'AbortError'));
		};
		if (signal) {
			if (signal.aborted) return onAbort();
			signal.addEventListener('abort', onAbort, { once: true });
		}

		for (let i = 0; i < cores; i++) {
			const w = new Worker(new URL('./grinder-worker.js', import.meta.url), { type: 'module' });
			workers.push(w);

			w.onmessage = (e) => {
				const msg = e.data;
				if (msg.type === 'match') {
					stopAll();
					if (signal) signal.removeEventListener('abort', onAbort);
					const totalAttempts = attemptsByWorker.reduce((a, b) => a + b, 0) + msg.attempts;
					resolve({
						publicKey:  msg.publicKey,
						secretKey:  new Uint8Array(msg.secretKey),
						attempts:   totalAttempts,
						durationMs: performance.now() - startedAt,
						workers:    cores,
					});
				} else if (msg.type === 'progress') {
					attemptsByWorker[i] = msg.attempts;
					ratesByWorker[i] = msg.rate;
					if (onProgress) {
						const totalRate = ratesByWorker.reduce((a, b) => a + b, 0);
						const totalAttempts = attemptsByWorker.reduce((a, b) => a + b, 0);
						onProgress({
							attempts: totalAttempts,
							rate: totalRate,
							eta: formatTimeEstimate(Math.max(0, expected - totalAttempts), totalRate),
						});
					}
				}
			};

			w.onerror = (err) => {
				stopAll();
				if (signal) signal.removeEventListener('abort', onAbort);
				reject(err.error || new Error(err.message || 'vanity worker crashed'));
			};

			w.postMessage({ type: 'start', prefix, suffix, ignoreCase });
		}
	});
}

// TODO(perf): drop in a WASM grinder backed by the toolkit's Rust crate
// (nirholas/solana-wallet-toolkit/rust). Expected ~10× over JS Keypair.generate().
// Public API of grindVanity() is intentionally backend-agnostic so the swap is
// transparent to callers.
