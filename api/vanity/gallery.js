// /api/vanity/gallery — the proof-of-grind gallery + leaderboard API.
//
//   GET  /api/vanity/gallery                      → paginated public gallery
//        ?sort=score|recency&tier=<id>&minLength=N&contains=str&limit=N&offset=N
//   GET  /api/vanity/gallery?view=leaderboard&limit=N   → top-N by rarity
//   GET  /api/vanity/gallery?view=stats                 → totals + per-tier histogram
//   GET  /api/vanity/gallery?view=appraise&address=<b58>&prefixLen=&suffixLen=
//        → rarity appraisal of any address (no persistence; pure math)
//   POST /api/vanity/gallery                       → publish a grind (opt-in)
//        body: { receipt, label?, share? } — the signed receipt from
//        /api/x402/vanity-verifiable. Verified server-side against the pinned
//        service key before anything is stored. NEVER send a secret/seed.
//   DELETE /api/vanity/gallery?address=<b58>       → un-publish (must prove the key)
//        body: { signature } — Ed25519 signature by the address over a challenge.
//
// Privacy: only opt-in, secret-free public metadata is ever persisted (the store
// allowlists fields; secrets are structurally un-serializable). A published entry
// is provably tied to a verifiable grind — we recompute every protocol check from
// the receipt with verifyVanityReceipt() and refuse to publish anything that
// doesn't fully verify against the live three.ws service key.

import { wrap, cors, error, json, readJson, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getServiceIdentity } from '../_lib/vanity-service-key.js';
import { verifyVanityReceipt, PROTOCOL_VERSION } from '../../src/solana/vanity/verifiable-grind.js';
import { computeRarity, appraiseAddress } from '../../src/solana/vanity/rarity.js';
import {
	putEntry,
	queryEntries,
	topByScore,
	galleryStats,
	getEntry,
	removeEntry,
} from '../_lib/vanity-gallery-store.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import bs58 from 'bs58';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const enc = new TextEncoder();

// A short fingerprint of a receipt — SHA-256 over (address‖signature) — so the
// gallery entry is bound to the exact signed receipt without storing the receipt's
// secret-adjacent fields (serverSeed, sealed envelope, …). Lets a viewer confirm
// "this entry came from that receipt" while keeping the store secret-free.
function receiptFingerprint(receipt) {
	const msg = enc.encode(`${receipt.address || ''}::${receipt.signature || ''}`);
	return bytesToHex(sha256(msg)).slice(0, 32);
}

function parseGetQuery(url) {
	const p = url.searchParams;
	return {
		view: (p.get('view') || 'gallery').toLowerCase(),
		sort: (p.get('sort') || 'recency').toLowerCase(),
		tier: p.get('tier') || null,
		minLength: p.get('minLength') ? Number(p.get('minLength')) : 0,
		contains: p.get('contains') || '',
		limit: p.get('limit') ? Number(p.get('limit')) : 24,
		offset: p.get('offset') ? Number(p.get('offset')) : 0,
		address: (p.get('address') || '').trim(),
		prefixLen: p.get('prefixLen') != null ? Number(p.get('prefixLen')) : undefined,
		suffixLen: p.get('suffixLen') != null ? Number(p.get('suffixLen')) : undefined,
	};
}

const READ_CACHE = 'public, max-age=30, s-maxage=120, stale-while-revalidate=600';

async function handleGet(req, res, url) {
	const rl = await limits.vanityGalleryReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const q = parseGetQuery(url);

	if (q.view === 'appraise') {
		if (!BASE58_RE.test(q.address)) {
			return error(res, 400, 'validation_error', 'address must be a Base58 Solana public key (32–44 chars)');
		}
		const result = appraiseAddress(q.address, { prefixLen: q.prefixLen, suffixLen: q.suffixLen });
		const published = await getEntry(q.address);
		return json(res, 200, { appraisal: result, published: published ? publicView(published) : null }, { 'cache-control': READ_CACHE });
	}

	if (q.view === 'leaderboard') {
		const entries = (await topByScore(q.limit)).map(publicView);
		return json(res, 200, { leaderboard: entries, count: entries.length }, { 'cache-control': READ_CACHE });
	}

	if (q.view === 'stats') {
		const stats = await galleryStats();
		return json(res, 200, { ...stats, rarest: stats.rarest ? publicView(stats.rarest) : null }, { 'cache-control': READ_CACHE });
	}

	// Default: paginated gallery.
	const { entries, total, hasMore } = await queryEntries(q);
	return json(
		res,
		200,
		{ entries: entries.map(publicView), total, hasMore, offset: q.offset, limit: q.limit },
		{ 'cache-control': READ_CACHE },
	);
}

// Final read-side projection — the store already allowlists, this just trims to
// what the client renders and never adds anything secret.
function publicView(e) {
	if (!e) return null;
	return {
		address: e.address,
		pattern: e.pattern,
		rarityScore: e.rarityScore,
		rarityBits: e.rarityBits,
		tier: e.tier,
		tierLabel: e.tierLabel,
		expectedAttempts: e.expectedAttempts,
		attempts: e.attempts ?? null,
		bonuses: e.bonuses || [],
		label: e.label || null,
		receiptFingerprint: e.receiptFingerprint,
		verified: e.verified !== false,
		network: e.network || 'solana',
		ts: e.ts,
		explorerUrl: `https://solscan.io/account/${e.address}`,
		shareUrl: `/api/vanity/og?address=${encodeURIComponent(e.address)}`,
	};
}

async function handlePost(req, res) {
	const rl = await limits.vanityGalleryPublishIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	let body;
	try {
		body = await readJson(req);
	} catch (err) {
		return error(res, err.status || 400, 'validation_error', err.message || 'invalid JSON body');
	}
	const receipt = body?.receipt;
	if (!receipt || typeof receipt !== 'object') {
		return error(res, 400, 'validation_error', 'body.receipt (the signed verifiable-grind receipt) is required');
	}
	if (receipt.protocol !== PROTOCOL_VERSION) {
		return error(res, 400, 'unsupported_protocol', `receipt protocol must be ${PROTOCOL_VERSION}`);
	}
	if (!BASE58_RE.test(String(receipt.address || ''))) {
		return error(res, 400, 'validation_error', 'receipt.address is not a valid Base58 Solana address');
	}

	// SECURITY: refuse to ingest any receipt that smuggles secret material. The
	// store can't serialize it, but rejecting up front means we never even hold it.
	for (const k of ['secretKey', 'secretKeyBase58', 'seed', 'sealedSecret']) {
		if (receipt[k] !== undefined) {
			return error(res, 400, 'secret_in_payload', `strip ${k} before publishing — never send a secret to the gallery`);
		}
	}

	// Re-verify the receipt from first principles against the LIVE pinned service
	// key. Only a receipt that fully verifies (commitment opens, address derives,
	// pattern matches, honest difficulty, valid signature by three.ws) is publishable.
	let identity;
	try {
		identity = await getServiceIdentity();
	} catch {
		return error(res, 503, 'service_unavailable', 'vanity service key unavailable — cannot verify receipt');
	}
	const verification = verifyVanityReceipt(receipt, { servicePublicKey: identity.publicKeyBase58 });
	if (!verification.valid) {
		const failed = verification.checks.filter((c) => !c.pass).map((c) => c.id);
		return error(res, 422, 'receipt_unverified', `receipt failed verification (${failed.join(', ')}) — only provably-fair grinds can be published`, {
			checks: verification.checks,
		});
	}

	// Compute the honest rarity from the receipt's own pattern (the verifier already
	// confirmed the pattern + difficulty are honest, so this is trustworthy).
	const rarity = computeRarity(receipt.pattern || {});

	const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '';
	const entry = {
		address: receipt.address,
		pattern: rarity.prefix || rarity.suffix ? { prefix: rarity.prefix, suffix: rarity.suffix, ignoreCase: rarity.ignoreCase } : receipt.pattern,
		rarityScore: rarity.rarityScore,
		rarityBits: rarity.rarityBits,
		baseBits: rarity.baseBits,
		bonusBits: rarity.bonusBits,
		tier: rarity.tier,
		tierLabel: rarity.tierLabel,
		expectedAttempts: rarity.expectedAttempts,
		attempts: Number.isFinite(receipt.attempts) ? receipt.attempts : null,
		durationMs: Number.isFinite(receipt.durationMs) ? receipt.durationMs : null,
		bonuses: rarity.bonuses,
		label: label || null,
		commitment: typeof receipt.commitment === 'string' ? receipt.commitment : null,
		receiptFingerprint: receiptFingerprint(receipt),
		servicePublicKey: receipt.servicePublicKey,
		verified: true,
		network: receipt.network || 'solana',
		ts: Date.now(),
	};

	let stored;
	try {
		stored = await putEntry(entry);
	} catch (err) {
		return error(res, err.status || 500, 'store_failed', err.message || 'could not store entry');
	}

	return json(res, 201, {
		published: true,
		entry: publicView(stored),
		galleryUrl: `/vanity/gallery#${encodeURIComponent(stored.address)}`,
		shareUrl: `/api/vanity/og?address=${encodeURIComponent(stored.address)}`,
	});
}

// Un-publish proves control of the key: the caller signs a fixed challenge with
// the address's Ed25519 private key. No session needed — possession of the key IS
// the authorization, which is exactly the right model for a self-custodied wallet.
async function handleDelete(req, res, url) {
	const rl = await limits.vanityGalleryPublishIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const address = (url.searchParams.get('address') || '').trim();
	if (!BASE58_RE.test(address)) {
		return error(res, 400, 'validation_error', 'address query param must be a Base58 Solana address');
	}
	let body;
	try {
		body = await readJson(req);
	} catch (err) {
		return error(res, err.status || 400, 'validation_error', err.message || 'invalid JSON body');
	}
	const sigHex = String(body?.signature || '').trim();
	if (!/^[0-9a-fA-F]{128}$/.test(sigHex)) {
		return error(res, 400, 'validation_error', 'body.signature must be a 64-byte hex Ed25519 signature over the challenge');
	}
	const existing = await getEntry(address);
	if (!existing) return error(res, 404, 'not_found', 'no published entry for that address');

	const challenge = enc.encode(`three.ws/vanity-gallery/unpublish/v1:${address}`);
	let ok = false;
	try {
		ok = ed25519.verify(hexToBytes(sigHex), challenge, bs58.decode(address));
	} catch {
		ok = false;
	}
	if (!ok) {
		return error(res, 403, 'invalid_signature', 'signature does not prove control of this address — sign the exact challenge with the wallet key');
	}
	await removeEntry(address);
	return json(res, 200, { unpublished: true, address });
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', origins: '*' })) return;
	const url = new URL(req.url, `http://${req.headers.host || 'three.ws'}`);

	if (req.method === 'GET') return handleGet(req, res, url);
	if (req.method === 'POST') return handlePost(req, res);
	if (req.method === 'DELETE') return handleDelete(req, res, url);

	res.setHeader('allow', 'GET, POST, DELETE, OPTIONS');
	return error(res, 405, 'method_not_allowed', 'use GET, POST, or DELETE');
});
