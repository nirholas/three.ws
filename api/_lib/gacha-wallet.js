// The cards a wallet holds from the /play gacha machine (GET /api/gacha/cards).
//
// Collector Crypt cards exist in two on-chain standards and a wallet can hold
// both:
//   - Metaplex Core assets in the CCryptUf... collection (every card minted
//     since the move to Core). Core assets are single accounts owned by the Core
//     program with the owner at byte 1 and the collection at byte 34, so one
//     filtered getProgramAccounts finds them all, with no billed DAS credits.
//     The public cluster refuses that call under load, so the scan reads
//     through the platform's rotating provider chain (walletRpc).
//   - Token Metadata programmable NFTs in the CCryptWB... collection (older
//     cards still circulating in the machines). These are found through the
//     wallet's token accounts: every 1-of-1 balance is a candidate mint, and its
//     metadata PDA must name the card collection as VERIFIED, which only the
//     collection authority can set, so a look-alike NFT never shows up as a card.
//
// The display fields (front and back image, grade, set, insured value) live in
// the off-chain JSON each card points at. That JSON is fetched only from the
// hosts Collector Crypt publishes metadata on and the Arweave gateways that
// serve the same transaction, so a card can never make the server fetch an
// arbitrary URL.

import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { PROGRAM, CC_CARD_COLLECTION, normalizeCard } from './collectorcrypt-gacha.js';
import { solanaRpcEndpoints, makeRotatingFetch } from './solana/connection.js';
import { ARWEAVE_GATEWAYS } from './ipfs-gateways.js';

export const CC_LEGACY_CARD_COLLECTION = 'CCryptWBYktukHDQ2vHGtVcmtjXxYzvw8XNVY64YN2Yf';

// Hard caps so one huge wallet cannot turn a page view into thousands of calls.
// The chain scan lists every card (one filtered read); only a page of them gets
// its metadata and buyback offer fetched per request.
export const WALLET_PAGE_SIZE = 60;
const MAX_QUERY_CHARS = 80;
const MAX_LEGACY_CANDIDATES = 600;
const METADATA_JSON_MAX_BYTES = 96 * 1024;

const METADATA_HOSTS = new Set(['www.arweave.net', 'gateway.irys.xyz', 'nft.collectorcrypt.com', 'd1xpxki1g4htqu.cloudfront.net']);

// Arweave gateways (the platform list, arweave.net first). Each one answers a
// transaction read with a redirect to a per-transaction sandbox subdomain of
// itself, so the gateway and its subdomains are allowed together.
const ARWEAVE_HOSTS = ARWEAVE_GATEWAYS.map((g) => new URL(g).hostname);
const ARWEAVE_TX_ID = /^[A-Za-z0-9_-]{43}$/;

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
		const ok = METADATA_HOSTS.has(host) || ARWEAVE_HOSTS.some((g) => host === g || host.endsWith(`.${g}`));
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
 * JSON-RPC against the first endpoint that answers; a provider that is down or
 * rate limited falls through to the next. With a `fetchImpl` that picks its own
 * endpoint (the rotating chain in walletRpc), `urls` is a single label.
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

/**
 * The JSON-RPC client a wallet scan reads through: the platform's canonical
 * rotating chain (SOLANA_RPC_URL, QuickNode, Helius, Alchemy, operator and
 * keyless fallbacks), sharing its endpoint cooldowns and per-method demotions
 * with every other Solana caller. The public cluster alone refuses
 * getProgramAccounts with "Connection rate limits exceeded" under load.
 */
const walletRpcs = new Map();
export function walletRpc(net) {
	const network = net === 'devnet' ? 'devnet' : 'mainnet';
	if (!walletRpcs.has(network)) {
		const send = makeRotatingFetch(solanaRpcEndpoints(network));
		walletRpcs.set(network, makeRpc([`solana-${network}`], { fetchImpl: (_label, init) => send(null, init), timeoutMs: 18_000 }));
	}
	return walletRpcs.get(network);
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

// ── paging ──────────────────────────────────────────────────────────────────

const NAME_ORDER = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * The wallet's cards in one stable order (on-chain name, natural numbers, then
 * address), so paging never skips or repeats a card whatever order the RPC
 * node returned them in. Each entry carries a lowercase name for search.
 */
export function walletCardIndex(cards) {
	return cards
		.map((c) => ({ ...c, key: String(c.name || '').toLowerCase() }))
		.sort((a, b) => NAME_ORDER.compare(a.name || '', b.name || '') || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
}

/** Search words: trimmed, lowercased, capped, empty for no search. */
export function walletQueryWords(q) {
	return String(q || '')
		.slice(0, MAX_QUERY_CHARS)
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
}

const REGEX_SPECIAL = /[.*+?^${}()|[\]\\]/g;

// Text matches anywhere in a name ("zard" finds Charizard). A word holding a
// digit is a grade, a year or a set number, so it must not run into the digits
// around it: "10" finds "PSA 10" but not "#107" or "2010", and "9" not "9.5".
function wordMatcher(word) {
	if (!/[0-9]/.test(word)) return (key) => key.includes(word);
	const re = new RegExp(`(?<![0-9.])${word.replace(REGEX_SPECIAL, '\\$&')}(?![0-9]|\\.[0-9])`);
	return (key) => re.test(key);
}

/**
 * One page of the index, optionally filtered to cards whose name holds every
 * search word. `nextOffset` is null on the last page.
 */
export function walletCardPage(index, { offset = 0, q = '', size = WALLET_PAGE_SIZE } = {}) {
	const tests = walletQueryWords(q).map(wordMatcher);
	const matches = tests.length ? index.filter((c) => tests.every((t) => t(c.key))) : index;
	const start = Math.max(0, Math.min(Number.isFinite(Number(offset)) ? Math.floor(Number(offset)) : 0, matches.length));
	const cards = matches.slice(start, start + size).map((c) => {
		const card = { ...c };
		delete card.key;
		return card;
	});
	const end = start + cards.length;
	return { cards, offset: start, total: matches.length, nextOffset: end < matches.length ? end : null };
}

/**
 * Recent wallet scans, per instance, so "Load more" and search read the list
 * already scanned instead of re-reading Solana for every page. A partial scan
 * (one of the two reads failed) is kept briefly so a retry soon reads again.
 */
export class WalletIndexCache {
	constructor({ ttlMs = 60_000, partialTtlMs = 10_000, max = 64 } = {}) {
		this.ttlMs = ttlMs;
		this.partialTtlMs = partialTtlMs;
		this.max = max;
		this.map = new Map();
	}

	get(key, now = Date.now()) {
		const hit = this.map.get(key);
		if (!hit) return null;
		if (now - hit.at > (hit.value.partial ? this.partialTtlMs : this.ttlMs)) {
			this.map.delete(key);
			return null;
		}
		return hit.value;
	}

	set(key, value, now = Date.now()) {
		this.map.delete(key);
		this.map.set(key, { at: now, value });
		while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
	}
}

// ── off-chain JSON ──────────────────────────────────────────────────────────

// A gateway that throttled or failed is tried last for this long. arweave.net
// answers Google Cloud egress with 429 on its sandbox subdomain, so without this
// every card would pay that round trip before reaching a gateway that serves it.
const GATEWAY_BACKOFF_MS = 5 * 60_000;
const gatewayBackoff = new Map();

export function _resetArweaveGatewayHealth() {
	gatewayBackoff.clear();
}

/** The gateways to read one URI from, in order, or just the URI itself. */
function cardJsonCandidates(uri) {
	const url = allowedMetadataUri(uri);
	if (!url) return [];
	const u = new URL(url);
	const id = u.pathname.slice(1);
	if (!ARWEAVE_HOSTS.includes(u.hostname) || !ARWEAVE_TX_ID.test(id) || u.search) return [url];
	const now = Date.now();
	const healthy = [];
	const cooling = [];
	for (const host of [u.hostname, ...ARWEAVE_HOSTS.filter((h) => h !== u.hostname)]) {
		((gatewayBackoff.get(host) || 0) > now ? cooling : healthy).push(host);
	}
	return [...healthy, ...cooling].map((host) => `https://${host}/${id}`);
}

/**
 * A card's off-chain JSON, or null. An Arweave transaction is content
 * addressed, so it is read from the first gateway that serves it.
 */
export async function fetchCardJson(uri, opts = {}) {
	for (const url of cardJsonCandidates(uri)) {
		const gateway = new URL(url).hostname;
		const body = await fetchCardJsonOnce(url, opts);
		if (body) return body;
		gatewayBackoff.set(gateway, Date.now() + GATEWAY_BACKOFF_MS);
	}
	return null;
}

async function fetchCardJsonOnce(start, { fetchImpl = fetch, timeoutMs = 6_000 } = {}) {
	let url = start;
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
