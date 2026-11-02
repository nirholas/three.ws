// Collector Crypt gacha: the upstream client, input validators, response
// normalizers and the transaction guards behind /api/gacha/* (the in-world
// gacha machine on /play, src/game/gacha-station.js).
//
// Collector Crypt runs real gacha machines on Solana: a pull costs a fixed USDC
// price, a VRF roll picks a professionally graded card from an insured vault, and
// the card lands in the player's wallet as an NFT, with an instant buyback offer
// for 72 hours. Their API (docs.collectorcrypt.com/gacha/api) builds every
// transaction server-side; the player only signs. We sit in the middle for three
// reasons:
//   1. The play endpoints are POST-only with no CORS, so a browser cannot call
//      them directly.
//   2. A partner key (COLLECTORCRYPT_API_KEY), when configured, must stay on the
//      server. Without one the API still serves every play endpoint and tags the
//      pack memo with its default `cc-` prefix.
//   3. Before a player is asked to sign anything, we decode the transaction and
//      prove it does exactly what the confirm sheet says: one USDC payment of the
//      machine's price, from the player, to Collector Crypt's documented lane
//      treasury, with Collector Crypt's gacha wallet paying the network fee. A
//      buyback may move the card out and nothing else of the player's. Anything
//      else is refused here, so a compromised or buggy upstream can never turn the
//      machine into a wallet drain.
//
// Addresses below are Collector Crypt's published ones (gacha/vrf and
// gacha/cc-buyback docs) and were cross-checked against live generatePack
// transactions on both clusters.

import { PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

export const GACHA_NETWORKS = Object.freeze({
	mainnet: Object.freeze({
		base: 'https://gacha.collectorcrypt.com',
		gachaWallet: 'GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3',
		usdcMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
		laneTreasury: 'D9CEogjHA6CpS12F8St9zpSco7pQKJB5uR1RqDsuzQZk',
		rentDestination: 'GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3',
	}),
	devnet: Object.freeze({
		base: 'https://dev-gacha.collectorcrypt.com',
		gachaWallet: 'A4ahkivAG4NoZAE8Sy4qv8nn2DU9yoXRQcttuCeGtTJv',
		usdcMint: 'Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr',
		laneTreasury: '9ZSgA3PMjeAU8K6CWzgJ8oDnhZwwSgHZu6KP3X95t7Jq',
		rentDestination: 'A4ahkivAG4NoZAE8Sy4qv8nn2DU9yoXRQcttuCeGtTJv',
	}),
});

export const USDC_DECIMALS = 6;
export const BUYBACK_WINDOW_HOURS = 72;
export const PACK_OPEN_DEADLINE_HOURS = 2;

const PROGRAM = Object.freeze({
	system: '11111111111111111111111111111111',
	computeBudget: 'ComputeBudget111111111111111111111111111111',
	memo: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
	memoV1: 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo',
	token: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
	token2022: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
});

// Rent on a closed SPL token account is 2,039,280 lamports; the cc-buyback docs
// quote 1,488,440 for the card account. Nothing in a buyback may pull more SOL
// than one account's rent out of the player.
const MAX_RENT_LAMPORTS = 2_100_000n;

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const PACK_CODE_RE = /^[a-z0-9_]{1,48}$/;
const MEMO_RE = /^[a-z0-9_]{1,40}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIERS = ['epic', 'rare', 'uncommon', 'common'];
const TIER_BY_CODE = { 1: 'epic', 2: 'rare', 3: 'uncommon', 4: 'common' };

/** A guard refusal: the upstream handed us something we will not let a player sign. */
export class GachaTxRejected extends Error {
	constructor(reason) {
		super(reason);
		this.name = 'GachaTxRejected';
		this.reason = reason;
	}
}

// ── input validation ────────────────────────────────────────────────────────

export function normalizeNetwork(raw) {
	return raw === 'devnet' ? 'devnet' : 'mainnet';
}

export function isSolanaAddress(raw) {
	if (typeof raw !== 'string' || !BASE58_RE.test(raw)) return false;
	try {
		return new PublicKey(raw).toBase58() === raw;
	} catch {
		return false;
	}
}

export function isPackCode(raw) {
	return typeof raw === 'string' && PACK_CODE_RE.test(raw);
}

export function isMemo(raw) {
	return typeof raw === 'string' && MEMO_RE.test(raw);
}

export function isBase64Tx(raw) {
	return typeof raw === 'string' && raw.length >= 64 && raw.length <= 4096 && /^[A-Za-z0-9+/]+={0,2}$/.test(raw);
}

// ── formatting ──────────────────────────────────────────────────────────────

/** USDC base units (6 decimals) as a plain decimal string, e.g. 46750000 -> "46.75". */
export function formatUsdc(atomic) {
	let n;
	try {
		n = BigInt(atomic);
	} catch {
		return null;
	}
	if (n < 0n) return null;
	const whole = n / 1_000_000n;
	const frac = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
	const cents = frac.length < 2 ? frac.padEnd(2, '0') : frac;
	return `${whole}.${cents}`;
}

export function usdToAtomic(usd) {
	const n = Number(usd);
	if (!Number.isFinite(n) || n <= 0) return null;
	return BigInt(Math.round(n * 1_000_000));
}

// ── upstream client ─────────────────────────────────────────────────────────

/**
 * Call the Collector Crypt gacha API. Returns `{ status, body }` and never
 * throws on an HTTP error status: callers map upstream errors to player-facing
 * ones. Throws only on network failure or timeout (`err.code = 'upstream_unreachable'`).
 */
export async function gachaFetch(net, path, { method = 'GET', body, apiKey, timeoutMs = 15_000, fetchImpl = fetch } = {}) {
	const cfg = GACHA_NETWORKS[normalizeNetwork(net)];
	const url = new URL(path, cfg.base);
	const headers = { accept: 'application/json' };
	if (apiKey) headers['x-api-key'] = apiKey;
	if (body !== undefined) headers['content-type'] = 'application/json';
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	try {
		const res = await fetchImpl(url, {
			method,
			headers,
			body: body !== undefined ? JSON.stringify(body) : undefined,
			signal: ac.signal,
		});
		const text = await res.text();
		let parsed = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			parsed = { error: text.slice(0, 200) };
		}
		return { status: res.status, body: parsed };
	} catch (err) {
		const e = new Error(ac.signal.aborted ? 'Collector Crypt did not answer in time' : 'Collector Crypt is unreachable');
		e.code = 'upstream_unreachable';
		e.cause = err;
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Map an upstream generatePack failure to a stable code + a sentence a player
 * can act on. The upstream puts the machine state in `details`.
 */
export function describePackError(status, body) {
	const details = String(body?.details || body?.error || body?.message || '');
	if (status === 403) return { code: 'blocked', message: 'Collector Crypt is not accepting pulls from this wallet.' };
	if (status === 429) {
		return /open/i.test(details)
			? { code: 'too_many_open', message: 'You have unopened packs waiting. Open them before pulling again.' }
			: { code: 'too_many_pending', message: 'You have too many unpaid packs pending. Wait a minute and try again.' };
	}
	if (status === 503) return { code: 'busy', message: 'The machine is busy opening packs. Try again in a few seconds.' };
	if (/empty|low/i.test(details)) return { code: 'machine_empty', message: 'This machine is out of cards right now. Pick another machine.' };
	if (/off balance/i.test(details)) return { code: 'machine_rebalancing', message: 'This machine is being restocked. Try another machine or come back shortly.' };
	if (/off/i.test(details)) return { code: 'machine_off', message: 'This machine is switched off right now. Pick another machine.' };
	if (status === 400) return { code: 'bad_request', message: details || 'Collector Crypt rejected the request.' };
	return { code: 'upstream_error', message: 'Collector Crypt could not build a pack right now. Try again shortly.' };
}

// ── normalizers ─────────────────────────────────────────────────────────────

function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

function str(v, max = 200) {
	return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

// Absolute https URL, or null. Relative paths (the upstream serves machine
// thumbnails as `/pokemon_50.png`) resolve against `base` when one is given.
function httpsUrl(v, base) {
	if (typeof v !== 'string' || !v) return null;
	try {
		const u = base ? new URL(v, base) : new URL(v);
		return u.protocol === 'https:' ? u.toString() : null;
	} catch {
		return null;
	}
}

function tierCounts(raw) {
	const out = {};
	for (const t of TIERS) out[t] = Math.max(0, Math.floor(num(raw?.[t]) || 0));
	return out;
}

/**
 * Merge /api/machines (art, odds, stock, EV) with /api/status (open/closed) into
 * the list the machine UI renders: public, open machines only, cheapest first.
 */
export function normalizeMachines(machinesBody, statusBody, { base = GACHA_NETWORKS.mainnet.base } = {}) {
	const open = new Map();
	for (const g of Array.isArray(statusBody?.gachas) ? statusBody.gachas : []) {
		if (isPackCode(g?.code)) open.set(g.code, g.isOpen === true || g.status === 'open');
	}
	const running = statusBody?.machineStatus ? statusBody.machineStatus === 'running' : true;
	const list = [];
	for (const m of Array.isArray(machinesBody?.machines) ? machinesBody.machines : []) {
		if (!isPackCode(m?.code) || m.public !== true) continue;
		const price = num(m.price);
		if (!price || price <= 0) continue;
		const stock = tierCounts(m.stock);
		const totalStock = TIERS.reduce((s, t) => s + stock[t], 0);
		const isOpen = running && (open.has(m.code) ? open.get(m.code) : false);
		if (!isOpen) continue;
		const odds = {};
		for (const t of TIERS) odds[t] = Math.max(0, Math.min(1, num(m.odds?.[t]) || 0));
		const tierRanges = {};
		for (const t of TIERS) {
			const r = m.tierRanges?.[t];
			tierRanges[t] = r ? { start: num(r.start), end: num(r.end) } : null;
		}
		list.push({
			code: m.code,
			name: str(m.name, 80),
			shortName: str(m.shortName, 40),
			category: str(m.menuCategory, 40),
			price,
			// The transparent cut-out reads best on the machine's glass; the
			// framed thumbnail is the fallback.
			art: httpsUrl(m.imageNobg) || httpsUrl(m.image, base) || httpsUrl(m.thumbnailUrl, base),
			thumbnail: httpsUrl(m.thumbnailUrl, base) || httpsUrl(m.imageNobg),
			video: httpsUrl(m.videoSrc),
			instantBuyback: num(m.instantBuyback),
			turboMode: m.turboMode === true,
			odds,
			tierRanges,
			stock,
			totalStock,
			ev: num(m.ev),
			order: num(m.menuOrder) ?? 999,
			available: totalStock > 0,
		});
	}
	list.sort((a, b) => a.price - b.price || a.order - b.order);
	return list;
}

function attr(attrs, name) {
	const hit = (Array.isArray(attrs) ? attrs : []).find((a) => a?.trait_type === name);
	return hit ? str(String(hit.value ?? ''), 160) : '';
}

/** Pick the best image URL off a DAS-shaped asset, front of the slab first. */
export function cardImage(nft) {
	const files = Array.isArray(nft?.content?.files) ? nft.content.files : [];
	const front = files[0] || {};
	return httpsUrl(front.cc_cdn) || httpsUrl(nft?.content?.links?.image) || httpsUrl(front.cdn_uri) || httpsUrl(front.uri) || httpsUrl(nft?.image);
}

/**
 * Normalize any Collector Crypt card (a DAS asset from winners, the pool, or an
 * openPack award) to the shape every client surface renders.
 */
export function normalizeCard(nft, extra = {}) {
	if (!nft || typeof nft !== 'object') return null;
	const md = nft.content?.metadata || {};
	const attrs = md.attributes;
	const address = isSolanaAddress(nft.id) ? nft.id : isSolanaAddress(extra.address) ? extra.address : null;
	const tierRaw = extra.tier ?? null;
	const tier = typeof tierRaw === 'number' ? TIER_BY_CODE[tierRaw] || null : TIERS.includes(String(tierRaw).toLowerCase()) ? String(tierRaw).toLowerCase() : null;
	const insured = num(extra.insuredValue) ?? num(attr(attrs, 'Insured Value'));
	return {
		address,
		name: attr(attrs, 'Card Name') || str(md.json_name || md.name, 120),
		title: str(md.json_name || md.name, 140) || attr(attrs, 'Description'),
		set: attr(attrs, 'Set'),
		year: attr(attrs, 'Year'),
		grader: attr(attrs, 'Grading Company') || str(md.gradingCompany, 20),
		grade: attr(attrs, 'The Grade'),
		category: attr(attrs, 'Category'),
		image: cardImage(nft),
		insuredValue: insured,
		tier,
	};
}

export function normalizeWinner(row) {
	const card = normalizeCard(row?.nft, { tier: num(row?.prize_tier), insuredValue: row?.insuredValue, address: row?.nft_address });
	if (!card) return null;
	const winner = isSolanaAddress(row?.winner) ? row.winner : null;
	return { ...card, winner, at: str(row?.timestamp || row?.created_at, 40) || null };
}

/**
 * openPack result -> `{ state: 'waiting' }` or `{ state: 'won', card, ... }`.
 * Turbo-mode commons come back already sold for USDC.
 */
export function normalizeOpenResult(body) {
	if (!body || typeof body !== 'object') return { state: 'error' };
	if (body.code === 'WAITING_FOR_WEBHOOK') return { state: 'waiting' };
	const nftAddress = isSolanaAddress(body.nft_address) ? body.nft_address : null;
	if (!nftAddress && !body.nftWon) return { state: 'error' };
	const tier = String(body.rarity || '').toLowerCase();
	const card = normalizeCard(body.nftWon, { tier: TIERS.includes(tier) ? tier : null, address: nftAddress });
	const turbo = body.code === 'TURBO_MODE_BUYBACK';
	const buybackAtomic = body.buybackAmount != null ? String(body.buybackAmount).replace(/\D/g, '') : '';
	return {
		state: 'won',
		card,
		nftAddress,
		points: num(body.points),
		roll: num(body.roll),
		transactionSignature: str(body.transactionSignature, 100) || null,
		turboSold: turbo,
		turboPayout: turbo && buybackAtomic ? formatUsdc(buybackAtomic) : null,
	};
}

/** /api/pack/status -> the few facts the client polls on. */
export function normalizePackStatus(body) {
	const pack = body?.pack || null;
	const send = body?.send || null;
	const paid = !!(pack && (pack.status === 'confirmed' || pack.webhook_received === true));
	const delivered = !!(send && (send.status === 'confirmed' || send.webhook_sent === true || send.transaction_signature === 'turbomode'));
	return {
		found: !!pack,
		paid,
		delivered,
		refunded: pack?.refunded === true,
		turbo: pack?.turbo_mode === true,
		packType: isPackCode(pack?.pack_type) ? pack.pack_type : null,
		createdAt: str(pack?.created_at, 40) || null,
		paymentSignature: str(pack?.transaction_signature, 100) || null,
		nftAddress: isSolanaAddress(send?.nft_address) ? send.nft_address : null,
	};
}

// ── transaction decoding + guards ───────────────────────────────────────────

/**
 * Decode a base64 wire transaction (legacy or v0) into a flat, inspectable form.
 * Keys a v0 instruction pulls from an address lookup table cannot be resolved
 * without RPC and come back `null`; signers are always static keys, so every
 * guard below that asks "is the player authorizing this" stays exact.
 */
export function decodeTransaction(b64) {
	const bytes = Buffer.from(b64, 'base64');
	let vtx;
	try {
		vtx = VersionedTransaction.deserialize(bytes);
	} catch {
		vtx = null;
	}
	if (vtx && vtx.version === 0) {
		const msg = vtx.message;
		const keys = msg.staticAccountKeys.map((k) => k.toBase58());
		const nSigners = msg.header.numRequiredSignatures;
		const keyAt = (i) => (i < keys.length ? keys[i] : null);
		const instructions = msg.compiledInstructions.map((ix) => ({
			programId: keyAt(ix.programIdIndex),
			keys: ix.accountKeyIndexes.map((i) => ({ pubkey: keyAt(i), isSigner: i < nSigners })),
			data: Buffer.from(ix.data),
		}));
		return {
			version: 0,
			feePayer: keys[0],
			signers: keys.slice(0, nSigners),
			signatures: vtx.signatures.map((s, i) => ({ pubkey: keys[i], signed: s.some((b) => b !== 0) })),
			instructions,
			usesLookupTables: msg.addressTableLookups.length > 0,
		};
	}
	const tx = Transaction.from(bytes);
	const message = tx.compileMessage();
	const nSigners = message.header.numRequiredSignatures;
	return {
		version: 'legacy',
		feePayer: tx.feePayer?.toBase58() || message.accountKeys[0].toBase58(),
		signers: message.accountKeys.slice(0, nSigners).map((k) => k.toBase58()),
		signatures: tx.signatures.map((s) => ({ pubkey: s.publicKey.toBase58(), signed: !!s.signature })),
		instructions: tx.instructions.map((ix) => ({
			programId: ix.programId.toBase58(),
			keys: ix.keys.map((k) => ({ pubkey: k.pubkey.toBase58(), isSigner: k.isSigner })),
			data: Buffer.from(ix.data),
		})),
		usesLookupTables: false,
	};
}

function readU64(data, offset) {
	if (data.length < offset + 8) return null;
	return data.readBigUInt64LE(offset);
}

const isTokenProgram = (id) => id === PROGRAM.token || id === PROGRAM.token2022;

/**
 * Prove a generatePack transaction is the payment the confirm sheet describes.
 * @returns {{ amountAtomic: string, amountUsdc: string, mint: string, destination: string, feePayer: string }}
 */
export function inspectPackTransaction(decoded, { player, net, expectedAtomic }) {
	const cfg = GACHA_NETWORKS[normalizeNetwork(net)];
	if (decoded.feePayer !== cfg.gachaWallet) throw new GachaTxRejected('fee payer is not the Collector Crypt gacha wallet');
	if (!decoded.signers.includes(player)) throw new GachaTxRejected('transaction does not ask the player to sign');
	if (decoded.signers.length !== 2) throw new GachaTxRejected('unexpected signer set');
	const gachaSig = decoded.signatures.find((s) => s.pubkey === cfg.gachaWallet);
	if (!gachaSig?.signed) throw new GachaTxRejected('transaction is not pre-signed by the gacha wallet');

	let payment = null;
	for (const ix of decoded.instructions) {
		if (ix.programId === PROGRAM.computeBudget || ix.programId === PROGRAM.memo || ix.programId === PROGRAM.memoV1) continue;
		if (ix.programId !== PROGRAM.token) throw new GachaTxRejected(`unexpected program ${ix.programId}`);
		if (ix.data[0] !== 12) throw new GachaTxRejected('token instruction is not a checked transfer');
		if (payment) throw new GachaTxRejected('more than one payment in the pack transaction');
		const [source, mint, destination, authority] = ix.keys.map((k) => k.pubkey);
		if (authority !== player) throw new GachaTxRejected('payment is not authorized by the player');
		if (mint !== cfg.usdcMint) throw new GachaTxRejected('payment is not in USDC');
		if (destination !== cfg.laneTreasury) throw new GachaTxRejected('payment does not go to the Collector Crypt treasury');
		if (ix.data[9] !== USDC_DECIMALS) throw new GachaTxRejected('payment decimals do not match USDC');
		const amount = readU64(ix.data, 1);
		if (amount == null || amount <= 0n) throw new GachaTxRejected('payment amount is unreadable');
		if (expectedAtomic != null && amount !== BigInt(expectedAtomic)) throw new GachaTxRejected('payment amount does not match the machine price');
		payment = { amountAtomic: amount.toString(), amountUsdc: formatUsdc(amount), mint, destination, source };
	}
	if (!payment) throw new GachaTxRejected('pack transaction carries no payment');
	return { ...payment, feePayer: decoded.feePayer };
}

/**
 * Prove a buyback transaction only takes the card from the player. The player
 * may authorize: moving exactly one token (the card) out, closing the emptied
 * card account back to themselves or the documented rent destination, creating
 * accounts funded with at most one account's rent, and returning at most one
 * account's rent to the rent destination. Every other outflow the player could
 * sign for (a USDC or SOL transfer, a delegate approval, an authority change, a
 * burn) is refused. Program instructions from Metaplex and cc_buyback itself are
 * allowed through: they move the card and pay the player.
 */
export function inspectBuybackTransaction(decoded, { player, net, nftAddress }) {
	const cfg = GACHA_NETWORKS[normalizeNetwork(net)];
	if (!decoded.signers.includes(player)) throw new GachaTxRejected('buyback does not ask the player to sign');
	for (const ix of decoded.instructions) {
		const keyed = (i) => ix.keys[i]?.pubkey ?? null;
		const playerSigns = ix.keys.some((k) => k.pubkey === player && k.isSigner);
		if (ix.programId === PROGRAM.system) {
			const kind = ix.data.length >= 4 ? ix.data.readUInt32LE(0) : -1;
			if (kind === 2 && keyed(0) === player) {
				const lamports = readU64(ix.data, 4);
				if (keyed(1) !== cfg.rentDestination || lamports == null || lamports > MAX_RENT_LAMPORTS) {
					throw new GachaTxRejected('buyback moves SOL out of the player wallet');
				}
			} else if (kind === 0 && keyed(0) === player) {
				const lamports = readU64(ix.data, 4);
				if (lamports == null || lamports > MAX_RENT_LAMPORTS) throw new GachaTxRejected('buyback funds an account from the player beyond rent');
			} else if (playerSigns && kind !== 0 && kind !== 2) {
				throw new GachaTxRejected('buyback asks the player to sign a system change');
			}
			continue;
		}
		if (isTokenProgram(ix.programId)) {
			const op = ix.data[0];
			if (op === 3 && keyed(2) === player) {
				if (readU64(ix.data, 1) !== 1n) throw new GachaTxRejected('buyback moves more than the card');
			} else if (op === 12 && keyed(3) === player) {
				if (readU64(ix.data, 1) !== 1n) throw new GachaTxRejected('buyback moves more than the card');
				if (nftAddress && keyed(1) && keyed(1) !== nftAddress) throw new GachaTxRejected('buyback moves a token that is not the card');
			} else if (op === 9 && keyed(2) === player) {
				const dest = keyed(1);
				if (dest !== player && dest !== cfg.rentDestination) throw new GachaTxRejected('buyback sends closed-account rent elsewhere');
			} else if (playerSigns && op !== 1 && op !== 18) {
				// 1/18 = InitializeAccount variants (no authority moves). Approve,
				// SetAuthority, Burn and friends by the player are never part of a sale.
				throw new GachaTxRejected('buyback asks the player to sign a token change');
			}
		}
	}
	return { feePayer: decoded.feePayer, version: decoded.version };
}

/** The transaction id of a signed wire transaction (its first signature, base58). */
export function transactionId(b64) {
	const bytes = Buffer.from(b64, 'base64');
	// Signatures follow a compact-u16 count; for any realistic tx it is one byte.
	const count = bytes[0];
	if (!count || bytes.length < 1 + 64) return null;
	const sig = bytes.subarray(1, 65);
	if (sig.every((b) => b === 0)) return null;
	return bs58.encode(sig);
}

