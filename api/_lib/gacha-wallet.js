// The cards a wallet holds from the /play gacha machine (GET /api/gacha/cards).
//
// Collector Crypt cards exist in two on-chain standards and a wallet can hold
// both:
//   - Metaplex Core assets in the CCryptUf... collection (every card minted
//     since the move to Core). Core assets are single accounts owned by the Core
//     program with the owner at byte 1 and the collection at byte 34, so one
//     filtered getProgramAccounts finds them all. It works on any RPC, the
//     public endpoint included, and costs no billed DAS credits.
//   - Token Metadata programmable NFTs in the CCryptWB... collection (older
//     cards still circulating in the machines). These are found through the
//     wallet's token accounts: every 1-of-1 balance is a candidate mint, and its
//     metadata PDA must name the card collection as VERIFIED, which only the
//     collection authority can set, so a look-alike NFT never shows up as a card.
//
// The display fields (front and back image, grade, set, insured value) live in
// the off-chain JSON each card points at. That JSON is fetched only from the
// hosts Collector Crypt publishes metadata on, so a card can never make the
// server fetch an arbitrary URL.

import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { PROGRAM, CC_CARD_COLLECTION, normalizeCard } from './collectorcrypt-gacha.js';

export const CC_LEGACY_CARD_COLLECTION = 'CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf';

// Hard caps so one huge wallet cannot turn a page view into thousands of calls.
export const MAX_WALLET_CARDS = 120;
const MAX_LEGACY_CANDIDATES = 600;
const METADATA_JSON_MAX_BYTES = 96 * 1024;

const METADATA_HOSTS = new Set([
	'arweave.net',
	'www.arweave.net',
	'gateway.irys.xyz',
	'nft.collectorcrypt.com',
	'd1xpxki1g4htqu.cloudfront.net',
]);

const CORE_ASSET_KEY = 1; // mpl-core Key::AssetV1
const CORE_UA_COLLECTION = 2; // UpdateAuthority::Collection

// ── account parsers (pure) ──────────────────────────────────────────────────

function readString(buf, o) {
	if (o + 4 > buf.length) return null;
	const n = buf.readUInt32LE(o);
	if (n > 1024 || o + 4 + n > buf.length) return null;
	return { value: buf.subarray(o + 4, o + 4 + n).toString('utf8').replace(/\0+$/, '').trim(), next: o + 4 + n };
}

/**
 * A Core AssetV1 account -> { owner, collection, name, uri }, or null when the
 * bytes are not a collection-governed asset.
 */
export function parseCoreAsset(data) {
	const buf = Buffer.from(data);
	if (buf.length < 66 || buf[0] !== CORE_ASSET_KEY || buf[33] !== CORE_UA_COLLECTION) return null;
	const owner = new PublicKey(buf.subarray(1, 33)).toBase58();
	const collection = new PublicKey(buf.subarray(34, 66)).toBase58();
	const name = readString(buf, 66);
	if (!name) return null;
	const uri = readString(buf, name.next);
	if (!uri) return null;
	return { owner, collection, name: name.value, uri: uri.value };
}

/**
 * A Token Metadata account -> { mint, name, uri, tokenStandard, collection:
 * {verified, key} | null }, or null when the bytes are not a metadata account.
 */
export function parseTokenMetadata(data) {
	const buf = Buffer.from(data);
	if (buf.length < 70 || buf[0] !== 4) return null; // Key::MetadataV1
	const mint = new PublicKey(buf.subarray(33, 65)).toBase58();
	let o = 65;
	const name = readString(buf, o);
	if (!name) return null;
	const symbol = readString(buf, name.next);
	if (!symbol) return null;
	const uri = readString(buf, symbol.next);
	if (!uri) return null;
	o = uri.next + 2; // seller_fee_basis_points
	if (o >= buf.length) return null;
	if (buf[o++] === 1) {
		if (o + 4 > buf.length) return null;
		o += 4 + buf.readUInt32LE(o) * 34; // creators: Vec<{address, verified, share}>
	}
	o += 2; // primary_sale_happened, is_mutable
	if (o >= buf.length) return { mint, name: name.value, uri: uri.value, tokenStandard: null, collection: null };
	if (buf[o++] === 1) o += 1; // edition_nonce
	let tokenStandard = null;
	if (o < buf.length && buf[o++] === 1) tokenStandard = buf[o++];
	let collection = null;
	if (o < buf.length && buf[o++] === 1 && o + 33 <= buf.length) {
		collection = { verified: buf[o] === 1, key: new PublicKey(buf.subarray(o + 1, o + 33)).toBase58() };
	}
	return { mint, name: name.value, uri: uri.value, tokenStandard, collection };
}

export function metadataPda(mint) {
	const tm = new PublicKey(PROGRAM.tokenMetadata);
	return PublicKey.findProgramAddressSync([Buffer.from('metadata'), tm.toBuffer(), new PublicKey(mint).toBuffer()], tm)[0].toBase58();
}

/**
 * Only Collector Crypt's published metadata hosts, over https. arweave.net
 * answers with a redirect to a per-transaction `<id>.arweave.net` subdomain, so
 * those are allowed too.
 */
export function allowedMetadataUri(raw) {
	try {
		const u = new URL(raw);
		const host = u.hostname.toLowerCase();
		const ok = METADATA_HOSTS.has(host) || host.endsWith('.arweave.net');
		return u.protocol === 'https:' && ok ? u.toString() : null;
	} catch {
		return null;
	}
}

/**
 * Off-chain card JSON (or null) + on-chain facts -> the DAS-shaped asset that
 * normalizeCard already understands, so wallet cards render exactly like
 * winners and pool cards.
 */
export function walletCardFromJson({ address, name, standard }, json) {
	const files = Array.isArray(json?.properties?.files) ? json.properties.files : [];
	const asset = {
		id: address,
		content: {
			metadata: {
				name,
				json_name: typeof json?.name === 'string' ? json.name : name,
				attributes: Array.isArray(json?.attributes) ? json.attributes : [],
			},
			files: files.slice(0, 4).map((f) => ({ uri: f?.uri, mime: f?.type || f?.mime })),
			links: { image: typeof json?.image === 'string' ? json.image : undefined },
		},
	};
	const card = normalizeCard(asset);
	if (!card) return null;
	return { ...card, standard };
}

// ── RPC ─────────────────────────────────────────────────────────────────────

/**
 * JSON-RPC against the first endpoint that answers. A configured provider that
 * is down or rate limited falls through to the next one (the public cluster).
 */
export function makeRpc(urls, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
	const list = [...new Set(urls.filter(Boolean))];
	return async function rpc(method, params) {
		let lastErr = null;
		for (const url of list) {
			try {
				const res = await fetchImpl(url, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
					signal: AbortSignal.timeout(timeoutMs),
				});
				const body = await res.json().catch(() => null);
				if (res.ok && body && !body.error && 'result' in body) return body.result;
				lastErr = new Error(`${method}: ${body?.error?.message || `http ${res.status}`}`);
			} catch (err) {
				lastErr = err;
			}
		}
		throw lastErr || new Error(`${method}: no rpc endpoint`);
	};
}

async function findCoreCards(rpc, owner) {
	const rows = await rpc('getProgramAccounts', [
		PROGRAM.mplCore,
		{
			encoding: 'base64',
			filters: [
				{ memcmp: { offset: 0, bytes: bs58.encode([CORE_ASSET_KEY]) } },
				{ memcmp: { offset: 1, bytes: owner } },
				{ memcmp: { offset: 33, bytes: bs58.encode([CORE_UA_COLLECTION]) } },
				{ memcmp: { offset: 34, bytes: CC_CARD_COLLECTION } },
			],
		},
	]);
	const out = [];
	for (const row of Array.isArray(rows) ? rows : []) {
		const parsed = parseCoreAsset(Buffer.from(row?.account?.data?.[0] || '', 'base64'));
		if (parsed && parsed.owner === owner && parsed.collection === CC_CARD_COLLECTION) {
			out.push({ address: row.pubkey, name: parsed.name, uri: parsed.uri, standard: 'core' });
		}
	}
	return out;
}

async function findLegacyCards(rpc, owner) {
	const res = await rpc('getTokenAccountsByOwner', [owner, { programId: PROGRAM.token }, { encoding: 'jsonParsed' }]);
	const mints = [];
	for (const row of res?.value || []) {
		const info = row?.account?.data?.parsed?.info;
		const amt = info?.tokenAmount;
		if (amt?.amount === '1' && amt?.decimals === 0 && typeof info.mint === 'string') mints.push(info.mint);
		if (mints.length >= MAX_LEGACY_CANDIDATES) break;
	}
	if (!mints.length) return [];
	const pdas = mints.map(metadataPda);
	const out = [];
	for (let i = 0; i < pdas.length; i += 100) {
		const chunk = pdas.slice(i, i + 100);
		const accounts = await rpc('getMultipleAccounts', [chunk, { encoding: 'base64' }]);
		(accounts?.value || []).forEach((acc, j) => {
			if (!acc || acc.owner !== PROGRAM.tokenMetadata) return;
			const md = parseTokenMetadata(Buffer.from(acc.data?.[0] || '', 'base64'));
			if (!md || md.mint !== mints[i + j]) return;
			if (!md.collection?.verified || md.collection.key !== CC_LEGACY_CARD_COLLECTION) return;
			out.push({ address: md.mint, name: md.name, uri: md.uri, standard: 'pnft' });
		});
	}
	return out;
}

/** Every Collector Crypt card the wallet holds, on-chain facts only. */
export async function findWalletCards(rpc, owner) {
	const [core, legacy] = await Promise.allSettled([findCoreCards(rpc, owner), findLegacyCards(rpc, owner)]);
	if (core.status === 'rejected' && legacy.status === 'rejected') throw core.reason;
	const seen = new Set();
	const all = [];
	for (const c of [...(core.value || []), ...(legacy.value || [])]) {
		if (seen.has(c.address)) continue;
		seen.add(c.address);
		all.push(c);
	}
	return { cards: all, partial: core.status === 'rejected' || legacy.status === 'rejected' };
}

// ── off-chain JSON ──────────────────────────────────────────────────────────

/**
 * A card's off-chain JSON, or null. One retry: arweave gateways occasionally
 * answer a cold read with an empty redirect, and a blank card in someone's
 * collection is worse than a second request.
 */
export async function fetchCardJson(uri, opts = {}) {
	return (await fetchCardJsonOnce(uri, opts)) || (await fetchCardJsonOnce(uri, opts));
}

async function fetchCardJsonOnce(uri, { fetchImpl = fetch, timeoutMs = 6_000 } = {}) {
	let url = allowedMetadataUri(uri);
	if (!url) return null;
	try {
		const signal = AbortSignal.timeout(timeoutMs);
		let res = null;
		// Redirects are followed by hand so every hop is held to the host
		// allowlist before anything is requested from it.
		for (let hop = 0; hop < 3; hop++) {
			res = await fetchImpl(url, { headers: { accept: 'application/json' }, redirect: 'manual', signal });
			if (res.status < 300 || res.status >= 400) break;
			const location = res.headers?.get?.('location');
			url = location ? allowedMetadataUri(new URL(location, url).toString()) : null;
			if (!url) return null;
			res = null;
		}
		if (!res?.ok) return null;
		const text = await res.text();
		if (text.length > METADATA_JSON_MAX_BYTES) return null;
		const body = JSON.parse(text);
		return body && typeof body === 'object' ? body : null;
	} catch {
		return null;
	}
}

/** Run `fn` over `items` with at most `n` in flight, preserving order. */
export async function mapPool(items, n, fn) {
	const out = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i], i);
		}
	};
	await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
	return out;
}
