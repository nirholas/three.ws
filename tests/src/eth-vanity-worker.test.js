/**
 * Drives the CREATE2 vanity grind Web Worker (src/eth/vanity/grinder-worker.js)
 * directly by mocking `self`, exercising the parts that have no other coverage:
 *
 *   1. correctness — a reported match actually re-derives to the claimed
 *      CREATE2 address and honours the requested prefix;
 *   2. input validation — a malformed deployer is rejected, not ground on;
 *   3. the pause/resume state machine — pause genuinely halts the hot loop
 *      (no further progress) and resume continues the SAME search with a
 *      monotonic attempt count (it is not silently restarted from zero).
 *
 * The worker assigns `self.onmessage` at module-eval time and reports via
 * `self.postMessage`, so we install a fresh `self` mock before each import
 * (vi.resetModules gives each test its own module state) and pump messages
 * through onmessage just like a real Worker host would.
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { webcrypto } from 'node:crypto';
import { keccak_256 } from '@noble/hashes/sha3.js';

beforeAll(() => {
	globalThis.crypto ??= webcrypto;
});

const WORKER = '../../src/eth/vanity/grinder-worker.js';

/** Reset module state, install a capturing `self`, import the worker fresh. */
async function loadWorker() {
	vi.resetModules();
	const messages = [];
	const selfMock = { postMessage: (m) => messages.push(m), onmessage: null };
	globalThis.self = selfMock;
	await import(WORKER);
	return {
		messages,
		send: (msg) => selfMock.onmessage({ data: msg }),
		of: (type) => messages.filter((m) => m.type === type),
	};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll `predicate` until true or `timeout` ms elapse. */
async function waitFor(predicate, { timeout = 5000, interval = 5 } = {}) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (predicate()) return true;
		await sleep(interval);
	}
	return false;
}

function hexToBytes(hex) {
	const h = hex.startsWith('0x') ? hex.slice(2) : hex;
	const out = new Uint8Array(h.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substring(i * 2, i * 2 + 2), 16);
	return out;
}
function bytesToHex(bytes) {
	let s = '';
	for (const b of bytes) s += b.toString(16).padStart(2, '0');
	return s;
}

/** Independent CREATE2: keccak256(0xff ‖ deployer ‖ salt ‖ initCodeHash)[12:]. */
function create2Address(deployer, salt, initCodeHash) {
	const pre = new Uint8Array(1 + 20 + 32 + 32);
	pre[0] = 0xff;
	pre.set(hexToBytes(deployer), 1);
	pre.set(hexToBytes(salt), 21);
	pre.set(hexToBytes(initCodeHash), 53);
	return '0x' + bytesToHex(keccak_256(pre).subarray(12));
}

const DEPLOYER = '0x' + '11'.repeat(20);
const INIT_CODE_HASH = '0x' + '22'.repeat(32);

describe('eth CREATE2 vanity worker', () => {
	it('reports a match whose salt re-derives to the claimed address and honours the prefix', async () => {
		const { send, of } = await loadWorker();
		// '0' is 1 of 16 hex nibbles → a match lands within a handful of attempts.
		send({ type: 'start', deployer: DEPLOYER, initCodeHash: INIT_CODE_HASH, prefix: '0', suffix: '', caseSensitive: false });

		expect(await waitFor(() => of('match').length > 0)).toBe(true);
		const match = of('match')[0];

		expect(match.address.slice(2).startsWith('0')).toBe(true);
		// The worker's salt must independently reproduce the address it claimed.
		expect(create2Address(DEPLOYER, match.salt, INIT_CODE_HASH)).toBe(match.address);
		expect(match.attempts).toBeGreaterThan(0);

		send({ type: 'stop' });
	});

	it('honours a hex suffix as well as a prefix', async () => {
		const { send, of } = await loadWorker();
		send({ type: 'start', deployer: DEPLOYER, initCodeHash: INIT_CODE_HASH, prefix: '', suffix: 'a', caseSensitive: false });

		expect(await waitFor(() => of('match').length > 0)).toBe(true);
		const match = of('match')[0];
		expect(match.address.endsWith('a')).toBe(true);
		expect(create2Address(DEPLOYER, match.salt, INIT_CODE_HASH)).toBe(match.address);

		send({ type: 'stop' });
	});

	it('rejects a malformed deployer with an error and never grinds', async () => {
		const { send, of, messages } = await loadWorker();
		send({ type: 'start', deployer: '0x1234', initCodeHash: INIT_CODE_HASH, prefix: 'a', suffix: '', caseSensitive: false });

		// initState posts the error synchronously, before any async work.
		expect(of('error').some((m) => /deployer must be 20 bytes/.test(m.message))).toBe(true);
		await sleep(40);
		expect(messages.some((m) => m.type === 'match' || m.type === 'progress')).toBe(false);
	});

	it('rejects a malformed initCodeHash with an error', async () => {
		const { send, of } = await loadWorker();
		send({ type: 'start', deployer: DEPLOYER, initCodeHash: '0xdead', prefix: 'a', suffix: '', caseSensitive: false });
		expect(of('error').some((m) => /initCodeHash must be 32 bytes/.test(m.message))).toBe(true);
	});

	it('pause halts the hot loop and resume continues the same search with a monotonic count', async () => {
		const { send, of } = await loadWorker();
		// 6 hex chars (~1 in 16.7M) will not match within the test window, so we
		// deterministically exercise progress → pause → resume rather than an
		// accidental early hit.
		send({ type: 'start', deployer: DEPLOYER, initCodeHash: INIT_CODE_HASH, prefix: 'ffffff', suffix: '', caseSensitive: false });

		expect(await waitFor(() => of('progress').length >= 1)).toBe(true);

		send({ type: 'pause' });
		await sleep(40); // let the in-flight batch unwind past its yield
		const countAtPause = of('progress').length;
		const attemptsAtPause = of('progress')[countAtPause - 1].attempts;

		// While paused the loop is gone — no new progress is emitted.
		await sleep(80);
		expect(of('progress').length).toBe(countAtPause);

		send({ type: 'resume' });
		expect(await waitFor(() => of('progress').length > countAtPause)).toBe(true);
		const resumed = of('progress')[of('progress').length - 1];
		// Monotonic: the attempt counter continued, it was not reset to zero.
		expect(resumed.attempts).toBeGreaterThan(attemptsAtPause);

		send({ type: 'stop' });
		await sleep(40);
		const afterStop = of('progress').length;
		await sleep(60);
		expect(of('progress').length).toBe(afterStop);
	});

	it('resume is a no-op when no grind was ever started', async () => {
		const { send, messages } = await loadWorker();
		send({ type: 'resume' });
		await sleep(40);
		expect(messages.length).toBe(0);
	});
});
