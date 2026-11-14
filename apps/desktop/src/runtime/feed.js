// Real pump.fun launch feed, fetched directly from this machine so a strategy
// keeps evaluating while three.ws is unreachable. Mainnet only: the venue has
// no public devnet feed, so devnet agents see no entries (open positions still
// exit). Mirrors api/_lib/pump-launch-feed.js normalizeLaunch.
//
// Two sources, in order:
//   1. The venue's public HTTP feed (frontend-api-v3.pump.fun). It sits behind
//      a Cloudflare challenge that answers 403 to datacenter and some
//      residential networks.
//   2. Solana itself. The pump program's mint authority signs every create, so
//      its signature list is the launch stream; each create instruction carries
//      the name, symbol, metadata uri and creator, and the bonding-curve
//      account gives reserves. Needs nothing but an RPC endpoint.

import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { PublicKey } from '@solana/web3.js';

const PUMP_PROGRAM_ID = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_PROGRAM = new PublicKey(PUMP_PROGRAM_ID);
export const PUMP_MINT_AUTHORITY = 'TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM';
const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';

// How many of the newest creates one on-chain sweep reads. The scheduler ticks
// every 30 s and the venue sees well under one create a second, so this keeps
// up while staying inside public RPC rate limits; transactions already parsed
// are cached, so a steady-state sweep only fetches the new ones.
const CHAIN_SWEEP_MAX = 25;
const RPC_CONCURRENCY = 4;
const CACHE_LIMIT = 2000;
// After the HTTP feed refuses, read from chain for this long before asking it again.
const FRONTEND_RETRY_MS = 5 * 60_000;
const METADATA_TIMEOUT_MS = 4000;
const METADATA_MAX_BYTES = 64 * 1024;

// The venue's per-coin HTTP route is not reliable, so live reserves are read
// from the coin's bonding-curve account on chain (the source of truth the
// frontend itself mirrors): discriminator, then u64 virtual token reserves,
// virtual SOL reserves, real token reserves, real SOL reserves, total supply,
// and a complete flag.
export function parseBondingCurve(data) {
	if (!data || data.length < 49) return null;
	const buf = Buffer.from(data);
	return {
		virtual_token_reserves: Number(buf.readBigUInt64LE(8)),
		virtual_sol_reserves: Number(buf.readBigUInt64LE(16)),
		real_token_reserves: Number(buf.readBigUInt64LE(24)),
		real_sol_reserves: Number(buf.readBigUInt64LE(32)),
		token_total_supply: Number(buf.readBigUInt64LE(40)),
		complete: buf[48] === 1,
	};
}

export const bondingCurveAddress = (mint) =>
	PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'), new PublicKey(mint).toBuffer()], PUMP_PROGRAM)[0].toBase58();

const BASE = process.env.PUMP_FRONTEND_BASE || 'https://frontend-api-v3.pump.fun';
const UA = 'three.ws-desktop-runtime/1';

async function getJson(fetchImpl, url, ms = 8000) {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), ms);
	try {
		const r = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json', 'user-agent': UA } });
		return r.ok ? await r.json() : null;
	} catch {
		return null;
	} finally {
		clearTimeout(t);
	}
}

/**
 * Token symbols and names are attacker-chosen on-chain text. Strip control and
 * bidi characters, collapse whitespace and cap the length so they cannot forge
 * extra lines or rows in the approval dialog.
 */
export function cleanTokenLabel(v, max = 16) {
	if (v == null) return null;
	const out = String(v)
		.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, max)
		.trim();
	return out || null;
}

export function normalizeLaunch(c, solUsd = 0) {
	if (!c?.mint) return null;
	const real = Number(c.real_sol_reserves);
	const virt = Number(c.virtual_sol_reserves);
	return {
		mint: c.mint, name: cleanTokenLabel(c.name), symbol: cleanTokenLabel(c.symbol),
		created_at: c.created_timestamp ? Number(c.created_timestamp) : null,
		market_cap_usd: typeof c.usd_market_cap === 'number' ? c.usd_market_cap : typeof c.market_cap === 'number' && solUsd > 0 ? c.market_cap * solUsd : null,
		liquidity_sol: real > 0 ? real / 1e9 : virt > 0 ? virt / 1e9 : null,
		creator: c.creator || null, creator_launches: null, creator_graduated: null,
		twitter: c.twitter || null, telegram: c.telegram || null, website: c.website || null,
		is_usdc_pair: false, graduated: c.complete === true || !!c.raydium_pool || !!c.pump_swap_pool,
	};
}

const B58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const B58_INDEX = new Map([...B58_ALPHABET].map((c, i) => [c, i]));

/** Base58 to bytes (instruction data in `json` encoded transactions). Null on a bad character. */
export function decodeBase58(s) {
	if (typeof s !== 'string') return null;
	const bytes = [];
	for (const ch of s) {
		let carry = B58_INDEX.get(ch);
		if (carry === undefined) return null;
		for (let i = 0; i < bytes.length; i++) {
			carry += bytes[i] * 58;
			bytes[i] = carry & 0xff;
			carry >>= 8;
		}
		while (carry > 0) {
			bytes.push(carry & 0xff);
			carry >>= 8;
		}
	}
	for (const ch of s) {
		if (ch !== '1') break;
		bytes.push(0);
	}
	return Uint8Array.from(bytes.reverse());
}

const CREATE_DISCRIMINATORS = ['create', 'create_v2'].map((n) => createHash('sha256').update(`global:${n}`).digest().subarray(0, 8));

/**
 * Decode a pump `create` / `create_v2` instruction: 8-byte Anchor
 * discriminator, then Borsh strings name, symbol, uri and the creator pubkey
 * (create_v2 appends flags this reader does not need). Null for any other
 * instruction or a truncated one. The strings are attacker-chosen.
 */
export function parseCreateInstruction(data) {
	if (!data || data.length < 8 + 12 + 32) return null;
	const buf = Buffer.from(data);
	const disc = buf.subarray(0, 8);
	if (!CREATE_DISCRIMINATORS.some((d) => disc.equals(d))) return null;
	let o = 8;
	const strings = [];
	for (let i = 0; i < 3; i++) {
		if (o + 4 > buf.length) return null;
		const len = buf.readUInt32LE(o);
		o += 4;
		if (len > 1024 || o + len > buf.length) return null;
		strings.push(buf.toString('utf8', o, o + len));
		o += len;
	}
	if (o + 32 > buf.length) return null;
	return { name: strings[0], symbol: strings[1], uri: strings[2], creator: new PublicKey(buf.subarray(o, o + 32)).toBase58() };
}

/**
 * Find the pump create in a `getTransaction` (json encoding) result, top-level
 * or made through another program as an inner instruction. The mint is the
 * instruction's first account; the timestamp is the block time.
 */
export function extractCreate(tx) {
	const msg = tx?.transaction?.message;
	if (!msg) return null;
	const loaded = tx.meta?.loadedAddresses || {};
	const keys = [...(msg.accountKeys || []), ...(loaded.writable || []), ...(loaded.readonly || [])].map((k) => (typeof k === 'string' ? k : k?.pubkey));
	const instructions = [...(msg.instructions || []), ...(tx.meta?.innerInstructions || []).flatMap((g) => g.instructions || [])];
	for (const ix of instructions) {
		if (keys[ix.programIdIndex] !== PUMP_PROGRAM_ID) continue;
		const mint = keys[ix.accounts?.[0]];
		const parsed = mint ? parseCreateInstruction(decodeBase58(ix.data)) : null;
		if (parsed) return { mint, ...parsed, created_at: tx.blockTime ? tx.blockTime * 1000 : null };
	}
	return null;
}

function ipv4Private(addr) {
	const p = addr.split('.').map(Number);
	if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
	const [a, b] = p;
	return a === 0 || a === 10 || a === 127 || a >= 224 ||
		(a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) || (a === 192 && b === 0 && p[2] === 0) || (a === 198 && (b === 18 || b === 19));
}

function addressPrivate(address) {
	const a = String(address).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
	const v = isIP(a);
	if (v === 4) return ipv4Private(a);
	if (v !== 6) return true;
	const mapped = a.match(/^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/);
	if (mapped) {
		if (mapped[1]) return ipv4Private(mapped[1]);
		const hi = parseInt(mapped[2], 16);
		const lo = parseInt(mapped[3], 16);
		return ipv4Private(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
	}
	return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a);
}

const defaultLookup = (host) => dnsLookup(host, { all: true, verbatim: true });

/**
 * A token's metadata uri is attacker-chosen, and this runs on the user's own
 * machine, so only https on a public address is fetched: never loopback, the
 * LAN, link-local or cloud metadata ranges, whether named directly or reached
 * through DNS.
 */
export async function isPublicMetadataUrl(uri, lookup = defaultLookup) {
	let url;
	try {
		url = new URL(uri);
	} catch {
		return false;
	}
	if (url.protocol !== 'https:' || url.username || url.password) return false;
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (!host || host === 'localhost' || /\.(localhost|local|internal|lan|home|arpa)$/.test(host)) return false;
	if (isIP(host)) return !addressPrivate(host);
	try {
		const addrs = await lookup(host);
		const list = Array.isArray(addrs) ? addrs : [addrs];
		return list.length > 0 && list.every((r) => r?.address && !addressPrivate(r.address));
	} catch {
		return false;
	}
}

async function readCapped(body, max) {
	const reader = body.getReader();
	const chunks = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > max) {
			await reader.cancel();
			return null;
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

async function mapLimit(items, limit, fn) {
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		while (next < items.length) {
			const item = items[next++];
			try {
				await fn(item);
			} catch {
				// One failed lookup leaves that item uncached; the next sweep retries it.
			}
		}
	});
	await Promise.all(workers);
}

function remember(map, key, value) {
	map.set(key, value);
	if (map.size > CACHE_LIMIT) map.delete(map.keys().next().value);
}

export function createPumpFeed({ fetchImpl = fetch, base = BASE, rpcUrl = DEFAULT_RPC, now = Date.now, lookup = defaultLookup } = {}) {
	let sol = { at: 0, usd: 0 };
	let lastSource = null;
	let frontendRetryAt = 0;
	const creates = new Map(); // signature -> parsed create
	const socials = new Map(); // mint -> { twitter, telegram, website } | null

	// SOL/USD from Coinbase's public spot endpoint, cached a minute, so the
	// launch market cap (reported in SOL) can be gated in dollars.
	async function solUsd() {
		if (now() - sol.at < 60_000 && sol.usd > 0) return sol.usd;
		const d = await getJson(fetchImpl, 'https://api.coinbase.com/v2/prices/SOL-USD/spot');
		const usd = Number(d?.data?.amount);
		if (usd > 0) sol = { at: now(), usd };
		return sol.usd;
	}

	async function rpc(method, params) {
		const r = await fetchImpl(rpcUrl, {
			method: 'POST', headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
			signal: AbortSignal.timeout(8000),
		});
		if (!r.ok) throw new Error(`rpc ${method} http ${r.status}`);
		const body = await r.json();
		if (body?.error) throw new Error(`rpc ${method}: ${body.error.message || body.error.code}`);
		return body?.result;
	}

	async function fetchSocials(uri) {
		if (!(await isPublicMetadataUrl(uri, lookup))) return null;
		try {
			const r = await fetchImpl(uri, { redirect: 'error', signal: AbortSignal.timeout(METADATA_TIMEOUT_MS), headers: { accept: 'application/json', 'user-agent': UA } });
			if (!r.ok || !r.body) return null;
			const text = await readCapped(r.body, METADATA_MAX_BYTES);
			const meta = text ? JSON.parse(text) : null;
			const pick = (k) => {
				const v = meta?.[k] ?? meta?.extensions?.[k];
				return typeof v === 'string' ? cleanTokenLabel(v, 200) : null;
			};
			return { twitter: pick('twitter'), telegram: pick('telegram'), website: pick('website') };
		} catch {
			return null;
		}
	}

	async function chainLaunches(limit, usd) {
		const n = Math.min(CHAIN_SWEEP_MAX, Math.max(1, Number(limit) || CHAIN_SWEEP_MAX));
		const sigs = await rpc('getSignaturesForAddress', [PUMP_MINT_AUTHORITY, { limit: n, commitment: 'confirmed' }]);
		const ok = (Array.isArray(sigs) ? sigs : []).filter((s) => s && s.err == null && typeof s.signature === 'string');
		await mapLimit(ok.filter((s) => !creates.has(s.signature)), RPC_CONCURRENCY, async (s) => {
			const tx = await rpc('getTransaction', [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
			// A transaction the node has not indexed yet is retried next sweep.
			if (tx) remember(creates, s.signature, extractCreate(tx));
		});
		const seen = new Set();
		const found = [];
		for (const s of ok) {
			const c = creates.get(s.signature);
			if (c && !seen.has(c.mint)) {
				seen.add(c.mint);
				found.push(c);
			}
		}
		if (!found.length) return [];

		let curves = [];
		try {
			const res = await rpc('getMultipleAccounts', [found.map((c) => bondingCurveAddress(c.mint)), { encoding: 'base64', commitment: 'confirmed' }]);
			curves = (res?.value || []).map((v) => (v?.data?.[0] ? parseBondingCurve(Buffer.from(v.data[0], 'base64')) : null));
		} catch {
			// Reserves unknown this sweep: market cap and liquidity stay null and
			// the strategy's own gates decide what that means.
		}

		await mapLimit(found.filter((c) => !socials.has(c.mint)), RPC_CONCURRENCY, async (c) => {
			remember(socials, c.mint, await fetchSocials(c.uri));
		});

		return found.map((c, i) => {
			const curve = curves[i] || null;
			const s = socials.get(c.mint) || null;
			const real = curve ? curve.real_sol_reserves : 0;
			const virt = curve ? curve.virtual_sol_reserves : 0;
			const capSol = curve && curve.virtual_token_reserves > 0 && curve.token_total_supply > 0
				? (curve.virtual_sol_reserves / 1e9) * (curve.token_total_supply / curve.virtual_token_reserves)
				: null;
			return {
				mint: c.mint, name: cleanTokenLabel(c.name), symbol: cleanTokenLabel(c.symbol),
				created_at: c.created_at,
				market_cap_usd: capSol != null && usd > 0 ? capSol * usd : null,
				liquidity_sol: real > 0 ? real / 1e9 : virt > 0 ? virt / 1e9 : null,
				creator: c.creator, creator_launches: null, creator_graduated: null,
				twitter: s?.twitter || null, telegram: s?.telegram || null, website: s?.website || null,
				is_usdc_pair: false, graduated: curve?.complete === true,
			};
		}).filter((l) => !l.graduated);
	}

	return {
		/** Which source served the last `launches()` call: 'frontend', 'chain' or 'unavailable'. */
		get lastSource() {
			return lastSource;
		},
		async launches({ network = 'mainnet', limit = 50 } = {}) {
			if (network !== 'mainnet') return [];
			const usd = await solUsd();
			if (now() >= frontendRetryAt) {
				const data = await getJson(fetchImpl, `${base}/coins?offset=0&limit=${limit}&sort=created_timestamp&order=DESC&includeNsfw=false`);
				if (data != null) {
					lastSource = 'frontend';
					const list = Array.isArray(data) ? data : Array.isArray(data?.coins) ? data.coins : [];
					return list.map((c) => normalizeLaunch(c, usd)).filter((l) => l && !l.graduated);
				}
				frontendRetryAt = now() + FRONTEND_RETRY_MS;
			}
			try {
				const out = await chainLaunches(limit, usd);
				lastSource = 'chain';
				return out;
			} catch {
				lastSource = 'unavailable';
				return [];
			}
		},
		async coin(mint, { symbol = null } = {}) {
			let address;
			try {
				address = bondingCurveAddress(mint);
			} catch {
				return null;
			}
			try {
				const value = (await rpc('getAccountInfo', [address, { encoding: 'base64', commitment: 'confirmed' }]))?.value;
				const curve = value?.data?.[0] ? parseBondingCurve(Buffer.from(value.data[0], 'base64')) : null;
				return curve ? { mint, symbol, ...curve } : null;
			} catch {
				return null;
			}
		},
	};
}
