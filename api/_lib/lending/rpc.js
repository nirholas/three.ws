// A @solana/kit RPC client that rides the platform's failover RPC lanes.
//
// Lending SDKs built on @solana/kit talk to an `Rpc` object, not a web3.js
// Connection. Building that client with `createSolanaRpc(url)` would pin every
// read to one endpoint and lose the rotation, cooldown and method-demotion
// logic in api/_lib/solana/connection.js. This transport sends each JSON-RPC
// payload through that same rotating fetch, so a lending read survives a
// provider outage exactly like every other Solana read on the platform.
//
// Kit requests carry bigint parameters (slots, lamports), which JSON.stringify
// refuses, so they are serialized as bare integer literals, the wire format the
// RPC expects. Responses are parsed with integers above 2^53 kept as bigint so
// a u64 field never loses precision on its way into the SDK.

import { createSolanaRpcFromTransport } from '@solana/kit';
import { solanaRpcEndpoints, makeRotatingFetch } from '../solana/connection.js';

const BIGINT_TAG = '__bigint__';
const TAGGED_BIGINT_RE = new RegExp(`"${BIGINT_TAG}(-?\\d+)"`, 'g');
// An unquoted JSON integer too long to be exact as a double. Matched only in
// value position (after `:`, `[` or `,`), so digits inside strings are untouched.
const WIDE_INT_RE = /([:[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g;

/** JSON.stringify that writes bigint values as integer literals. */
export function stringifyWithBigInts(value) {
	return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${BIGINT_TAG}${v}` : v)).replace(
		TAGGED_BIGINT_RE,
		'$1',
	);
}

/** JSON.parse that keeps integers beyond Number.MAX_SAFE_INTEGER as bigint. */
export function parseWithBigInts(text) {
	const tagged = text.replace(WIDE_INT_RE, (m, lead, digits) => {
		const n = BigInt(digits);
		const safe = n <= BigInt(Number.MAX_SAFE_INTEGER) && n >= BigInt(Number.MIN_SAFE_INTEGER);
		return safe ? m : `${lead}"${BIGINT_TAG}${digits}"`;
	});
	return JSON.parse(tagged, (_k, v) =>
		typeof v === 'string' && v.startsWith(BIGINT_TAG) ? BigInt(v.slice(BIGINT_TAG.length)) : v,
	);
}

const clients = new Map();

/**
 * A kit Rpc for `network` whose every call fails over across the platform's
 * Solana endpoints. Cached per network for the life of the process.
 * @param {'mainnet'|'devnet'} [network]
 */
export function lendingRpc(network = 'mainnet') {
	const net = network === 'devnet' ? 'devnet' : 'mainnet';
	let rpc = clients.get(net);
	if (rpc) return rpc;
	const endpoints = solanaRpcEndpoints(net);
	const rotatingFetch = makeRotatingFetch(endpoints);
	const transport = async ({ payload, signal }) => {
		const res = await rotatingFetch(endpoints[0], {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: stringifyWithBigInts(payload),
			signal,
		});
		if (!res.ok) {
			const err = new Error(`Solana RPC answered HTTP ${res.status}`);
			err.status = res.status;
			throw err;
		}
		return parseWithBigInts(await res.text());
	};
	rpc = createSolanaRpcFromTransport(transport);
	clients.set(net, rpc);
	return rpc;
}
