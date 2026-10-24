// Hyperliquid L1 action signing for an API (agent) wallet.
//
// An API wallet is a throwaway key the account owner approves on Hyperliquid for
// trading only: it can place and cancel orders but can never withdraw. The
// platform stores one per agent, encrypted, and signs with it here. The owner's
// main key never reaches this code.
//
// Scheme (Hyperliquid exchange docs, "Signing"): msgpack-encode the action,
// append the nonce (8 bytes, big endian) and a vault flag byte, keccak256 the
// bytes into `connectionId`, then sign the EIP-712 typed data
// Agent{source, connectionId} on the fixed "Exchange" domain (chain id 1337).
// `source` is "a" on mainnet and "b" on testnet.

import { Wallet, keccak256, getBytes } from 'ethers';

const MAINNET_EXCHANGE = 'https://api.hyperliquid.xyz/exchange';
const TESTNET_EXCHANGE = 'https://api.hyperliquid-testnet.xyz/exchange';

const textEncoder = new TextEncoder();

/**
 * Minimal MessagePack encoder for the value shapes an exchange action holds:
 * maps with string keys, arrays, strings, non-negative integers, booleans and
 * null. Key order is preserved, which Hyperliquid's hash depends on.
 * @returns {Uint8Array}
 */
export function msgpackEncode(value) {
	const out = [];
	const push = (...bytes) => out.push(...bytes);
	const be = (n, width) => {
		let big = BigInt(n);
		const bytes = [];
		for (let i = 0; i < width; i++) {
			bytes.unshift(Number(big & 0xffn));
			big >>= 8n;
		}
		return bytes;
	};
	const encode = (v) => {
		if (v === null || v === undefined) return push(0xc0);
		if (v === true) return push(0xc3);
		if (v === false) return push(0xc2);
		if (typeof v === 'number' || typeof v === 'bigint') {
			if (typeof v === 'number' && (!Number.isInteger(v) || v < 0))
				throw new TypeError(
					`msgpackEncode: only non-negative integers are supported, got ${v}`,
				);
			const n = BigInt(v);
			if (n < 0n) throw new TypeError('msgpackEncode: negative integers are not supported');
			if (n <= 0x7fn) return push(Number(n));
			if (n <= 0xffn) return push(0xcc, ...be(n, 1));
			if (n <= 0xffffn) return push(0xcd, ...be(n, 2));
			if (n <= 0xffffffffn) return push(0xce, ...be(n, 4));
			return push(0xcf, ...be(n, 8));
		}
		if (typeof v === 'string') {
			const bytes = textEncoder.encode(v);
			const len = bytes.length;
			if (len <= 31) push(0xa0 | len);
			else if (len <= 0xff) push(0xd9, ...be(len, 1));
			else if (len <= 0xffff) push(0xda, ...be(len, 2));
			else push(0xdb, ...be(len, 4));
			for (const b of bytes) out.push(b);
			return;
		}
		if (Array.isArray(v)) {
			if (v.length <= 15) push(0x90 | v.length);
			else if (v.length <= 0xffff) push(0xdc, ...be(v.length, 2));
			else push(0xdd, ...be(v.length, 4));
			for (const item of v) encode(item);
			return;
		}
		if (typeof v === 'object') {
			const keys = Object.keys(v).filter((k) => v[k] !== undefined);
			if (keys.length <= 15) push(0x80 | keys.length);
			else if (keys.length <= 0xffff) push(0xde, ...be(keys.length, 2));
			else push(0xdf, ...be(keys.length, 4));
			for (const k of keys) {
				encode(k);
				encode(v[k]);
			}
			return;
		}
		throw new TypeError(`msgpackEncode: unsupported value of type ${typeof v}`);
	};
	encode(value);
	return Uint8Array.from(out);
}

/** keccak256 of msgpack(action) || nonce(8, BE) || vault flag, as a 0x-prefixed hex string. */
export function actionHash(action, nonce, vaultAddress = null) {
	const packed = msgpackEncode(action);
	const nonceBytes = new Uint8Array(8);
	new DataView(nonceBytes.buffer).setBigUint64(0, BigInt(nonce));
	const vault = vaultAddress
		? new Uint8Array([1, ...getBytes(vaultAddress)])
		: new Uint8Array([0]);
	const all = new Uint8Array(packed.length + nonceBytes.length + vault.length);
	all.set(packed, 0);
	all.set(nonceBytes, packed.length);
	all.set(vault, packed.length + nonceBytes.length);
	return keccak256(all);
}

const DOMAIN = {
	name: 'Exchange',
	version: '1',
	chainId: 1337,
	verifyingContract: '0x0000000000000000000000000000000000000000',
};
const AGENT_TYPES = {
	Agent: [
		{ name: 'source', type: 'string' },
		{ name: 'connectionId', type: 'bytes32' },
	],
};

/**
 * Sign an exchange action with an API wallet private key.
 * @returns {Promise<{ r: string, s: string, v: number }>}
 */
export async function signL1Action({
	privateKey,
	action,
	nonce,
	isMainnet = true,
	vaultAddress = null,
}) {
	const wallet = new Wallet(privateKey);
	const sig = await wallet.signTypedData(DOMAIN, AGENT_TYPES, {
		source: isMainnet ? 'a' : 'b',
		connectionId: actionHash(action, nonce, vaultAddress),
	});
	return {
		r: sig.slice(0, 66),
		s: `0x${sig.slice(66, 130)}`,
		v: parseInt(sig.slice(130, 132), 16),
	};
}

/** Sign an action and POST it to the exchange endpoint. Returns Hyperliquid's JSON answer. */
export async function postExchange({
	privateKey,
	action,
	isMainnet = true,
	nonce = Date.now(),
	fetchImpl = fetch,
	timeoutMs = 10_000,
}) {
	const signature = await signL1Action({ privateKey, action, nonce, isMainnet });
	const res = await fetchImpl(isMainnet ? MAINNET_EXCHANGE : TESTNET_EXCHANGE, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ action, nonce, signature }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = { status: 'err', response: text.slice(0, 300) };
	}
	return { httpStatus: res.status, ...json };
}

/** Format a price for an order: at most 5 significant figures and 6 - szDecimals decimals, no trailing zeros. */
export function formatPrice(price, szDecimals) {
	const p = Number(price);
	if (!(p > 0)) throw new RangeError('price must be positive');
	if (Number.isInteger(p)) return String(p);
	const maxDecimals = Math.max(0, 6 - szDecimals);
	const sig = Number(p.toPrecision(5));
	return stripZeros(sig.toFixed(maxDecimals));
}

/** Format a size to the market's size decimals, rounding down, no trailing zeros. */
export function formatSize(size, szDecimals) {
	const factor = 10 ** szDecimals;
	return stripZeros((Math.floor(Number(size) * factor + 1e-9) / factor).toFixed(szDecimals));
}

function stripZeros(s) {
	return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

export const exchangeUrl = (isMainnet) => (isMainnet ? MAINNET_EXCHANGE : TESTNET_EXCHANGE);
