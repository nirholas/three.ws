// A Connection that fails over across several RPC endpoints. Reads and sends try
// each endpoint in order, starting from the last one that answered, and only throw
// when every endpoint failed. A transaction send is idempotent (Solana dedupes by
// signature), so retrying it on the next endpoint cannot double-settle.

import { Connection } from '@solana/web3.js';

const METHODS = [
	'getBalance',
	'getAccountInfo',
	'getTokenAccountBalance',
	'getSignatureStatuses',
	'getParsedTransaction',
	'simulateTransaction',
	'sendRawTransaction',
	'isBlockhashValid',
	'getLatestBlockhash',
];

export function createFailoverConnection(rpcUrls, { commitment = 'confirmed', make = (url) => new Connection(url, commitment) } = {}) {
	const urls = Array.isArray(rpcUrls) ? rpcUrls.filter(Boolean) : [];
	if (urls.length === 0) throw new Error('createFailoverConnection: at least one RPC url is required');
	const conns = urls.map((u) => make(u));
	let start = 0;
	const target = { endpoints: urls };
	for (const name of METHODS) {
		target[name] = async (...args) => {
			let lastErr;
			for (let i = 0; i < conns.length; i += 1) {
				const idx = (start + i) % conns.length;
				try {
					const out = await conns[idx][name](...args);
					start = idx;
					return out;
				} catch (err) {
					lastErr = err;
					if (isDeterministicRejection(err)) throw err;
				}
			}
			throw lastErr;
		};
	}
	return target;
}

// A node that answers "this transaction is invalid" is not unhealthy: asking the
// next node the same question wastes time. Transport and rate-limit faults fail over.
function isDeterministicRejection(err) {
	const m = String(err?.message || err);
	return /already been processed|AlreadyProcessed|insufficient funds/i.test(m);
}
