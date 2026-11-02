// /api/gacha/*: the server side of the /play gacha machine
// (src/game/gacha-station.js + src/game/gacha-ui.js), a same-origin bridge to
// Collector Crypt's real gacha API. Every card is a professionally graded,
// vaulted trading card minted as a Solana NFT; every pull is paid in USDC by the
// player's own wallet. The platform never holds or moves the player's funds: the
// upstream builds the transaction, we prove it is the payment the player was
// shown (api/_lib/collectorcrypt-gacha.js), the player signs, and we relay it.
//
// Routes (all accept ?net=devnet for Collector Crypt's test machines):
//   GET  /api/gacha/machines                 open machines: price, odds, stock, EV, art
//   GET  /api/gacha/winners?code=            the five most recent pulls on a machine
//   GET  /api/gacha/pool?code=&rarity=&cursor=  cards still inside a machine
//   POST /api/gacha/pull    {player, code, turbo}   build + verify a pack payment
//   POST /api/gacha/submit  {player, signedTransaction}  relay the signed payment
//   GET  /api/gacha/status?memo=             has the payment landed, was the card sent
//   POST /api/gacha/open    {memo}           reveal the card (poll while `waiting`)
//   GET  /api/gacha/buyback-quote?nft=       the instant-buyback offer, if still open
//   POST /api/gacha/buyback {player, nft}    build + verify the sell-back transaction
//   POST /api/gacha/buyback-submit {player, nft, signedTransaction}  relay it

import { cors, json, method, wrap, error, rateLimited, readJson, reportServerError } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import {
	GACHA_NETWORKS,
	GachaTxRejected,
	normalizeNetwork,
	isSolanaAddress,
	isPackCode,
	isMemo,
	isBase64Tx,
	formatUsdc,
	usdToAtomic,
	gachaFetch,
	describePackError,
	normalizeMachines,
	normalizeWinner,
	normalizeCard,
	normalizeOpenResult,
	normalizePackStatus,
	decodeTransaction,
	inspectPackTransaction,
	inspectBuybackTransaction,
	transactionId,
} from '../_lib/collectorcrypt-gacha.js';

export const maxDuration = 30;

const RARITIES = new Set(['common', 'uncommon', 'rare', 'epic']);

// Machines change slowly (stock counts are already up to 10 s stale upstream),
// and every pull re-reads the price from here, so a short per-instance memo keeps
// the upstream from seeing one request per player per second.
const MACHINE_TTL_MS = 15_000;
const machineCache = new Map(); // net -> { at, list }

async function loadMachines(net, { fresh = false } = {}) {
	const hit = machineCache.get(net);
	if (!fresh && hit && Date.now() - hit.at < MACHINE_TTL_MS) return hit.list;
	const [machines, status] = await Promise.all([
		gachaFetch(net, '/api/machines'),
		gachaFetch(net, '/api/status'),
	]);
	if (machines.status !== 200 || status.status !== 200) {
		if (hit) return hit.list;
		const e = new Error('Collector Crypt machine list is unavailable');
		e.code = 'upstream_unreachable';
		throw e;
	}
	const list = normalizeMachines(machines.body, status.body, { base: GACHA_NETWORKS[net].base });
	machineCache.set(net, { at: Date.now(), list });
	return list;
}

function rpcUrl(net) {
	return net === 'devnet' ? env.SOLANA_RPC_URL_DEVNET : env.SOLANA_RPC_URL;
}

// Broadcast a signed transaction through our own RPC with preflight on, so a
// payment that cannot land (no USDC, expired blockhash) fails fast with the
// real reason instead of an opaque upstream 500.
async function broadcast(net, signedB64) {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), 12_000);
	try {
		const res = await fetch(rpcUrl(net), {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'sendTransaction',
				params: [signedB64, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 5 }],
			}),
			signal: ac.signal,
		});
		const body = await res.json().catch(() => null);
		if (body?.result) return { ok: true, signature: body.result };
		return { ok: false, rpcError: body?.error || { message: `rpc http ${res.status}` } };
	} catch (err) {
		return { ok: false, unreachable: true, rpcError: { message: err?.message || 'rpc unreachable' } };
	} finally {
		clearTimeout(timer);
	}
}

// Turn a preflight failure into a sentence a player can act on.
function describeBroadcastError(rpcError) {
	const text = JSON.stringify(rpcError || {});
	if (/insufficient (funds|lamports)|0x1\b|custom program error: 0x1"/i.test(text)) {
		return { code: 'insufficient_usdc', message: 'Your wallet does not have enough USDC for this pull.' };
	}
	if (/blockhash not found|block height exceeded|expired/i.test(text)) {
		return { code: 'expired', message: 'The pack expired before it was signed. Pull again for a fresh one.' };
	}
	if (/already been processed/i.test(text)) return null;
	if (/AccountNotFound|could not find account|invalid account data/i.test(text)) {
		return { code: 'no_usdc_account', message: 'This wallet has no USDC account on Solana yet. Add USDC to it first.' };
	}
	return { code: 'broadcast_failed', message: 'The network rejected the transaction. Nothing was charged; try again.' };
}

function rejectedTx(res, err, context) {
	reportServerError(err, { code: 'gacha_unverifiable_tx', status: 502, context });
	return error(res, 502, 'unverifiable_transaction', 'Collector Crypt returned a transaction we could not verify, so we did not ask you to sign it. Nothing was charged.');
}

function decodeOrNull(b64) {
	try {
		return decodeTransaction(b64);
	} catch {
		return null;
	}
}

// ── GET handlers ────────────────────────────────────────────────────────────

async function machines(req, res, net) {
	const list = await loadMachines(net);
	res.setHeader('cache-control', 'public, max-age=10, s-maxage=15, stale-while-revalidate=60');
	return json(res, 200, { ok: true, network: net, usdcMint: GACHA_NETWORKS[net].usdcMint, machines: list, fetchedAt: new Date().toISOString() });
}

async function winners(req, res, net) {
	const code = String(req.query.code || '');
	if (!isPackCode(code)) return error(res, 400, 'bad_code', 'code must be a machine code such as pokemon_50');
	const up = await gachaFetch(net, `/api/getRecentWinners?packType=${encodeURIComponent(code)}`);
	if (up.status !== 200) return error(res, 502, 'upstream_error', 'Recent pulls are unavailable right now.');
	const rows = (Array.isArray(up.body?.data) ? up.body.data : []).map(normalizeWinner).filter(Boolean);
	res.setHeader('cache-control', 'public, max-age=5, s-maxage=5');
	return json(res, 200, { ok: true, code, winners: rows });
}

async function pool(req, res, net) {
	const code = String(req.query.code || '');
	const rarity = String(req.query.rarity || 'epic').toLowerCase();
	const cursor = String(req.query.cursor || '');
	if (!isPackCode(code)) return error(res, 400, 'bad_code', 'code must be a machine code such as pokemon_50');
	if (!RARITIES.has(rarity)) return error(res, 400, 'bad_rarity', 'rarity must be common, uncommon, rare or epic');
	if (cursor && !/^[A-Za-z0-9_.:-]{1,120}$/.test(cursor)) return error(res, 400, 'bad_cursor', 'invalid cursor');
	const qs = new URLSearchParams({ code, rarity, limit: '12' });
	if (cursor) qs.set('cursor', cursor);
	const up = await gachaFetch(net, `/api/getNfts?${qs}`);
	if (up.status !== 200) return error(res, 502, 'upstream_error', 'The card list for this machine is unavailable right now.');
	const cards = (Array.isArray(up.body?.nfts) ? up.body.nfts : []).map((n) => normalizeCard(n, { tier: rarity })).filter(Boolean);
	res.setHeader('cache-control', 'public, max-age=30, s-maxage=60');
	return json(res, 200, {
		ok: true,
		code,
		rarity,
		cards,
		hasMore: up.body?.hasMore === true,
		nextCursor: typeof up.body?.nextCursor === 'string' ? up.body.nextCursor.slice(0, 120) : null,
	});
}

async function status(req, res, net) {
	const memo = String(req.query.memo || '');
	if (!isMemo(memo)) return error(res, 400, 'bad_memo', 'memo is not a pack memo');
	const up = await gachaFetch(net, `/api/pack/status?memo=${encodeURIComponent(memo)}`);
	if (up.status === 404 || (up.status === 200 && !up.body?.pack)) return json(res, 200, { ok: true, memo, found: false });
	if (up.status !== 200) return error(res, 502, 'upstream_error', 'Pack status is unavailable right now.');
	res.setHeader('cache-control', 'no-store');
	return json(res, 200, { ok: true, memo, ...normalizePackStatus(up.body) });
}

async function buybackQuote(req, res, net) {
	const nft = String(req.query.nft || '');
	if (!isSolanaAddress(nft)) return error(res, 400, 'bad_nft', 'nft must be a Solana address');
	const up = await gachaFetch(net, `/api/buyback/available?nft=${encodeURIComponent(nft)}`);
	if (up.status !== 200) return error(res, 502, 'upstream_error', 'The buyback offer is unavailable right now.');
	res.setHeader('cache-control', 'no-store');
	if (up.body?.available !== true) return json(res, 200, { ok: true, nft, available: false });
	const atomic = String(up.body.amount ?? '').replace(/\D/g, '');
	return json(res, 200, {
		ok: true,
		nft,
		available: true,
		amountAtomic: atomic,
		amountUsdc: formatUsdc(atomic),
		expiresAt: typeof up.body.buybackExpiresAt === 'string' ? up.body.buybackExpiresAt : null,
	});
}

// ── POST handlers ───────────────────────────────────────────────────────────

async function pull(req, res, net, body) {
	const player = String(body.player || '');
	const code = String(body.code || '');
	const turbo = body.turbo === true;
	if (!isSolanaAddress(player)) return error(res, 400, 'bad_player', 'player must be a Solana wallet address');
	if (!isPackCode(code)) return error(res, 400, 'bad_code', 'code must be a machine code such as pokemon_50');

	const list = await loadMachines(net);
	const machine = list.find((m) => m.code === code);
	if (!machine) return error(res, 409, 'machine_closed', 'That machine is closed right now. Pick another machine.');
	if (!machine.available) return error(res, 409, 'machine_empty', 'This machine is out of cards right now. Pick another machine.');
	if (turbo && !machine.turboMode) return error(res, 400, 'turbo_unavailable', 'Turbo mode is not offered on this machine.');

	const up = await gachaFetch(net, '/api/generatePack', {
		method: 'POST',
		body: { playerAddress: player, packType: code, turbo },
		apiKey: env.COLLECTORCRYPT_API_KEY,
	});
	if (up.status !== 200 || !isMemo(up.body?.memo) || !isBase64Tx(up.body?.transaction)) {
		const d = describePackError(up.status, up.body);
		return error(res, up.status === 429 ? 429 : up.status === 403 ? 403 : 409, d.code, d.message);
	}

	const decoded = decodeOrNull(up.body.transaction);
	if (!decoded) return rejectedTx(res, new GachaTxRejected('undecodable pack transaction'), { net, code });
	let payment;
	try {
		payment = inspectPackTransaction(decoded, { player, net, expectedAtomic: usdToAtomic(machine.price) });
	} catch (err) {
		if (err instanceof GachaTxRejected) return rejectedTx(res, err, { net, code, memo: up.body.memo });
		throw err;
	}

	res.setHeader('cache-control', 'no-store');
	return json(res, 200, {
		ok: true,
		network: net,
		memo: up.body.memo,
		transaction: up.body.transaction,
		machine: { code: machine.code, name: machine.name, price: machine.price, instantBuyback: machine.instantBuyback },
		turbo,
		payment: {
			amountUsdc: payment.amountUsdc,
			amountAtomic: payment.amountAtomic,
			mint: payment.mint,
			destination: payment.destination,
			feePayer: payment.feePayer,
			networkFeePaidBy: 'collector_crypt',
		},
		expiresInHours: 2,
	});
}

async function submit(req, res, net, body) {
	const player = String(body.player || '');
	const signed = String(body.signedTransaction || '');
	if (!isSolanaAddress(player)) return error(res, 400, 'bad_player', 'player must be a Solana wallet address');
	if (!isBase64Tx(signed)) return error(res, 400, 'bad_transaction', 'signedTransaction must be a base64 transaction');

	const decoded = decodeOrNull(signed);
	if (!decoded) return error(res, 400, 'bad_transaction', 'signedTransaction could not be decoded');
	try {
		inspectPackTransaction(decoded, { player, net, expectedAtomic: null });
	} catch (err) {
		if (err instanceof GachaTxRejected) return error(res, 400, 'not_a_pack_payment', 'That transaction is not a gacha pack payment from this wallet.');
		throw err;
	}
	if (!decoded.signatures.find((s) => s.pubkey === player)?.signed) {
		return error(res, 400, 'unsigned', 'The wallet did not sign the payment.');
	}

	// Relay through Collector Crypt (the documented path, so their pack record
	// sees the signature immediately) and broadcast through our own RPC at the
	// same time. The same signed bytes land once however many times they are
	// sent; the second path is the failsafe if either one is down.
	const [cc, rpc] = await Promise.all([
		gachaFetch(net, '/api/submitTransaction', {
			method: 'POST',
			body: { signedTransaction: signed },
			apiKey: env.COLLECTORCRYPT_API_KEY,
		}).catch((err) => ({ status: 0, body: { error: err.message } })),
		broadcast(net, signed),
	]);
	const signature = transactionId(signed);
	const ccOk = cc.status === 200 && cc.body?.success !== false;
	if (!rpc.ok && !rpc.unreachable) {
		const d = describeBroadcastError(rpc.rpcError);
		if (d && !ccOk) return error(res, 400, d.code, d.message);
	}
	if (!ccOk && !rpc.ok) {
		reportServerError(new Error('gacha submit failed on both paths'), {
			code: 'gacha_submit_failed',
			status: 502,
			context: { net, ccStatus: cc.status, rpcError: rpc.rpcError?.message },
		});
		return error(res, 502, 'submit_failed', 'The payment could not be sent. Nothing was charged; try again.');
	}
	res.setHeader('cache-control', 'no-store');
	return json(res, 200, {
		ok: true,
		signature: signature || cc.body?.signature || rpc.signature,
		confirmationStatus: typeof cc.body?.confirmationStatus === 'string' ? cc.body.confirmationStatus : 'submitted',
	});
}

async function open(req, res, net, body) {
	const memo = String(body.memo || '');
	if (!isMemo(memo)) return error(res, 400, 'bad_memo', 'memo is not a pack memo');
	const up = await gachaFetch(net, '/api/openPack', {
		method: 'POST',
		body: { memo },
		apiKey: env.COLLECTORCRYPT_API_KEY,
		timeoutMs: 25_000,
	});
	res.setHeader('cache-control', 'no-store');
	if (up.status === 404) return json(res, 200, { ok: true, memo, state: 'unpaid' });
	if (up.status === 400 && /expire/i.test(String(up.body?.error || up.body?.details || ''))) {
		return json(res, 200, { ok: true, memo, state: 'expired' });
	}
	if (up.status !== 200) {
		return error(res, 502, 'open_failed', 'The pack could not be opened yet. Your payment is safe; try opening again.');
	}
	const result = normalizeOpenResult(up.body);
	if (result.state === 'error') return error(res, 502, 'open_failed', 'The pack could not be opened yet. Your payment is safe; try opening again.');
	return json(res, 200, { ok: true, memo, ...result, verifyUrl: `${GACHA_NETWORKS[net].base}/verify-selection/${encodeURIComponent(memo)}` });
}

async function buyback(req, res, net, body) {
	const player = String(body.player || '');
	const nft = String(body.nft || '');
	if (!isSolanaAddress(player)) return error(res, 400, 'bad_player', 'player must be a Solana wallet address');
	if (!isSolanaAddress(nft)) return error(res, 400, 'bad_nft', 'nft must be a Solana address');
	const up = await gachaFetch(net, '/api/buyback', {
		method: 'POST',
		body: { playerAddress: player, nftAddress: nft },
		apiKey: env.COLLECTORCRYPT_API_KEY,
	});
	if (up.status !== 200 || !isBase64Tx(up.body?.serializedTransaction)) {
		const reason = String(up.body?.error || up.body?.details || '');
		if (up.status === 400 && /72|window|expire/i.test(reason)) return error(res, 409, 'buyback_expired', 'The 72-hour buyback window for this card has closed.');
		if (up.status === 400) return error(res, 409, 'buyback_unavailable', 'This card is not eligible for an instant buyback.');
		return error(res, 502, 'upstream_error', 'The buyback could not be prepared right now. Try again shortly.');
	}
	const decoded = decodeOrNull(up.body.serializedTransaction);
	if (!decoded) return rejectedTx(res, new GachaTxRejected('undecodable buyback transaction'), { net, nft });
	try {
		inspectBuybackTransaction(decoded, { player, net, nftAddress: nft });
	} catch (err) {
		if (err instanceof GachaTxRejected) return rejectedTx(res, err, { net, nft });
		throw err;
	}
	const atomic = String(up.body.refundAmount ?? '').replace(/\D/g, '');
	res.setHeader('cache-control', 'no-store');
	return json(res, 200, {
		ok: true,
		network: net,
		transaction: up.body.serializedTransaction,
		refundAtomic: atomic,
		refundUsdc: formatUsdc(atomic),
		memo: typeof up.body.memo === 'string' ? up.body.memo.slice(0, 80) : null,
	});
}

async function buybackSubmit(req, res, net, body) {
	const player = String(body.player || '');
	const nft = String(body.nft || '');
	const signed = String(body.signedTransaction || '');
	if (!isSolanaAddress(player)) return error(res, 400, 'bad_player', 'player must be a Solana wallet address');
	if (!isSolanaAddress(nft)) return error(res, 400, 'bad_nft', 'nft must be a Solana address');
	if (!isBase64Tx(signed)) return error(res, 400, 'bad_transaction', 'signedTransaction must be a base64 transaction');
	const decoded = decodeOrNull(signed);
	if (!decoded) return error(res, 400, 'bad_transaction', 'signedTransaction could not be decoded');
	try {
		inspectBuybackTransaction(decoded, { player, net, nftAddress: nft });
	} catch (err) {
		if (err instanceof GachaTxRejected) return error(res, 400, 'not_a_buyback', 'That transaction is not a buyback of this card.');
		throw err;
	}
	if (!decoded.signatures.find((s) => s.pubkey === player)?.signed) {
		return error(res, 400, 'unsigned', 'The wallet did not sign the buyback.');
	}
	const rpc = await broadcast(net, signed);
	// Self-report to Collector Crypt (accepted for v0 transactions). Settlement
	// is automatic either way: their cron watches for the on-chain quote marker.
	if (decoded.version === 0) {
		gachaFetch(net, '/api/submitTransaction', { method: 'POST', body: { signedTransaction: signed }, apiKey: env.COLLECTORCRYPT_API_KEY }).catch(() => {});
	}
	if (!rpc.ok) {
		const d = describeBroadcastError(rpc.rpcError);
		if (d) return error(res, rpc.unreachable ? 502 : 400, d.code === 'insufficient_usdc' ? 'broadcast_failed' : d.code, d.code === 'insufficient_usdc' ? 'The network rejected the sale. Your card is still yours; try again.' : d.message);
	}
	res.setHeader('cache-control', 'no-store');
	return json(res, 200, { ok: true, signature: transactionId(signed) || rpc.signature });
}

// ── dispatch ────────────────────────────────────────────────────────────────

const GET_ROUTES = { machines, winners, pool, status, 'buyback-quote': buybackQuote };
const POST_ROUTES = { pull, submit, open, buyback, 'buyback-submit': buybackSubmit };
const READ_POSTS = new Set(['open']);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	const action = String(req.query?.action || '').toLowerCase();
	const isGet = Object.hasOwn(GET_ROUTES, action);
	const isPost = Object.hasOwn(POST_ROUTES, action);
	if (!isGet && !isPost) return error(res, 404, 'not_found', `unknown gacha action "${action}"`);
	if (!method(req, res, [isGet ? 'GET' : 'POST'])) return;

	const ip = clientIp(req);
	const rl = isGet || READ_POSTS.has(action) ? await limits.gachaReadIp(ip) : await limits.gachaPlayIp(ip);
	if (!rl.success) return rateLimited(res, rl);

	const net = normalizeNetwork(String(req.query?.net || ''));
	try {
		if (isGet) return await GET_ROUTES[action](req, res, net);
		const body = await readJson(req, 16_384);
		if (!body || typeof body !== 'object') return error(res, 400, 'bad_body', 'expected a JSON object');
		return await POST_ROUTES[action](req, res, net, body);
	} catch (err) {
		if (err?.code === 'upstream_unreachable') {
			return error(res, 503, 'upstream_unreachable', 'Collector Crypt is not responding right now. Try again in a moment.');
		}
		throw err;
	}
});
