/**
 * Ethereum CREATE2 vanity grinder — main-thread API.
 *
 * Spawns one Web Worker per logical core (capped at 8) to race for a salt
 * whose CREATE2-derived address matches the requested hex prefix/suffix.
 * First match wins; the rest are terminated.
 *
 * Usage:
 *   const { address, salt, attempts, durationMs } = await grindCreate2Vanity({
 *     deployer:     '0x4e59b44847b379578588920cA78FbF26c0B4956C', // CreateX/Arachnid factory
 *     initCodeHash: '0x...32 bytes...',
 *     prefix:       'beef',
 *     onProgress:   ({ attempts, rate, eta }) => updateUI(...),
 *     signal,
 *   });
 *
 * Returns the salt to feed into your factory's deploy call. The deployer
 * must call `CREATE2(value, initCode, salt)` with the *same* initCode whose
 * hash you passed here, otherwise the predicted address won't match.
 */

import {
	validatePattern,
	validateAddress,
	validateInitCodeHash,
	estimateAttempts,
	formatTimeEstimate,
	letterCount,
	eip55Checksum,
} from './validation.js';

const DEFAULT_MAX_WORKERS = 8;

/**
 * @typedef {object} GrindOptions
 * @property {string} deployer           - 20-byte EVM address of the CREATE2 deployer/factory.
 * @property {string} initCodeHash       - 32-byte keccak256 hash of the init code.
 * @property {string} [prefix]           - Hex prefix (without 0x), case-insensitive.
 * @property {string} [suffix]           - Hex suffix (without 0x), case-insensitive.
 * @property {number} [maxWorkers]
 * @property {AbortSignal} [signal]
 * @property {(p: { attempts: number, rate: number, eta: string, sample?: string }) => void} [onProgress]
 */

/**
 * @typedef {object} GrindResult
 * @property {string} address         - Predicted 0x… contract address (lowercase).
 * @property {string} salt            - 0x-prefixed 32-byte salt.
 * @property {string} deployer        - Echoed (normalized).
 * @property {string} initCodeHash    - Echoed (normalized).
 * @property {number} attempts
 * @property {number} durationMs
 * @property {number} workers
 */

/**
 * @param {GrindOptions} opts
 * @returns {Promise<GrindResult>}
 */
export function grindCreate2Vanity(opts = {}) {
	const { prefix = '', suffix = '', signal, onProgress } = opts;

	const dep = validateAddress(opts.deployer || '');
	if (!dep.valid) return Promise.reject(new Error(`invalid deployer: ${dep.error}`));
	const ich = validateInitCodeHash(opts.initCodeHash || '');
	if (!ich.valid) return Promise.reject(new Error(`invalid initCodeHash: ${ich.error}`));

	if (!prefix && !suffix) {
		return Promise.reject(new Error('prefix or suffix is required'));
	}
	let normPrefix = '', normSuffix = '';
	let caseSensitive = false;
	if (prefix) {
		const v = validatePattern(prefix);
		if (!v.valid) return Promise.reject(new Error(`invalid prefix: ${v.errors.join('; ')}`));
		normPrefix = v.normalized;
		if (v.caseSensitive) caseSensitive = true;
	}
	if (suffix) {
		const v = validatePattern(suffix);
		if (!v.valid) return Promise.reject(new Error(`invalid suffix: ${v.errors.join('; ')}`));
		normSuffix = v.normalized;
		if (v.caseSensitive) caseSensitive = true;
	}

	const cores = Math.max(1, Math.min(
		opts.maxWorkers || (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4,
		DEFAULT_MAX_WORKERS,
	));
	const totalLetters = letterCount(normPrefix) + letterCount(normSuffix);
	const expected = estimateAttempts(normPrefix.length + normSuffix.length, totalLetters, caseSensitive);
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
						address:         msg.address,
						addressChecksum: msg.addressChecksum || ('0x' + eip55Checksum(msg.address.slice(2))),
						salt:            msg.salt,
						deployer:        dep.normalized,
						initCodeHash:    ich.normalized,
						caseSensitive,
						attempts:        totalAttempts,
						durationMs:      performance.now() - startedAt,
						workers:         cores,
					});
				} else if (msg.type === 'progress') {
					attemptsByWorker[i] = msg.attempts;
					ratesByWorker[i] = msg.rate;
					if (onProgress) {
						const totalRate = ratesByWorker.reduce((a, b) => a + b, 0);
						const totalAttempts = attemptsByWorker.reduce((a, b) => a + b, 0);
						onProgress({
							attempts: totalAttempts,
							rate:     totalRate,
							eta:      formatTimeEstimate(Math.max(0, expected - totalAttempts), totalRate),
							sample:   msg.sample,
						});
					}
				} else if (msg.type === 'error') {
					stopAll();
					if (signal) signal.removeEventListener('abort', onAbort);
					reject(new Error(msg.message || 'vanity worker reported error'));
				}
			};

			w.onerror = (err) => {
				stopAll();
				if (signal) signal.removeEventListener('abort', onAbort);
				reject(err.error || new Error(err.message || 'vanity worker crashed'));
			};

			w.postMessage({
				type:          'start',
				deployer:      dep.normalized,
				initCodeHash:  ich.normalized,
				prefix:        normPrefix,
				suffix:        normSuffix,
				caseSensitive,
			});
		}
	});
}

export { validatePattern, validateAddress, validateInitCodeHash, estimateAttempts, formatTimeEstimate, letterCount, eip55Checksum };
