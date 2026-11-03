// Runnable demo: a free crypto-price API paywalled with x402 on Solana, served
// to the @three-ws/x402-payment-modal you ship on npm.
//
// What it proves end-to-end:
//   1. The published modal (loaded from unpkg in public/index.html) drives the
//      whole 402 → Phantom connect → sign → settle flow with zero wallet code.
//   2. A real free API (CoinGecko, no key) is gated behind the payment and only
//      returned once the USDC payment verifies + settles on Solana mainnet.
//   3. The payout wallet is set AT RUNTIME from the page — never from a .env or
//      a source constant. Start the server, paste your address, then pay.
//
// The only "config" that isn't runtime is the facilitator's fee-payer sponsor
// (a PUBLIC Solana account, not a secret) and the CoinGecko/PayAI URLs.
//
// Run (from inside the three.ws repo — uses the repo's express + @solana deps):
//   node x402-payment-modal/examples/solana-crypto-paywall/server.mjs
//   open http://localhost:4021
//
// As a standalone project (outside this repo): `npm install`, then change the
// two relative imports below to '@three-ws/x402-payment-modal/server/express'
// and '@three-ws/x402-payment-modal/server'.

import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PublicKey } from '@solana/web3.js';

// In-repo: import the package's checkout helpers from source. Standalone: swap
// these for the published package subpaths (see header).
import { x402CheckoutRouter } from '../../server/express.js';
import { solanaAccept, NETWORK_SOLANA_MAINNET } from '../../server/checkout.js';

import {
	decodePaymentHeader,
	verifyPayment,
	settlePayment,
	encodePaymentResponse,
} from './facilitator.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 4021;

// PayAI's facilitator co-signs Solana settlements as the fee payer. This is the
// three.ws default sponsor — a PUBLIC pubkey (it pays the SOL network fee so the
// buyer needs only USDC), NOT a secret and NOT the payout wallet. Override only
// if you point X402_FACILITATOR_URL at a facilitator with a different sponsor.
const FEE_PAYER = process.env.X402_FEE_PAYER_SOLANA || 'PayeRNCipcerPHCsYMTrX9pAYDm1LnPGzgb66NUDG5a';

// A public Solana RPC works for a quick try (rate-limited). Pass a dedicated RPC
// for anything real. Not a payout/secret — purely network plumbing.
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

// Price per call. USDC has 6 decimals, so $0.01 = 10000 atomic units.
const PRICE_USD = '0.01';
const PRICE_ATOMIC = '10000';

// ── Runtime merchant config (the whole point of this demo) ───────────────────
// The payout wallet lives in memory and is set from the page after boot. There
// is deliberately no env var and no default — until you POST one, the paid
// endpoint refuses to issue a challenge.
const merchant = { payTo: null, updatedAt: null };

function isValidSolanaAddress(addr) {
	if (typeof addr !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)) return false;
	try {
		new PublicKey(addr);
		return true;
	} catch {
		return false;
	}
}

// CoinGecko ids the picker offers, plus a few ticker aliases so callers can pass
// "btc" instead of "bitcoin". Display metadata keeps the UI honest without a
// second API round-trip.
const COIN_META = {
	bitcoin: { symbol: 'BTC', name: 'Bitcoin' },
	ethereum: { symbol: 'ETH', name: 'Ethereum' },
	solana: { symbol: 'SOL', name: 'Solana' },
	dogecoin: { symbol: 'DOGE', name: 'Dogecoin' },
	ripple: { symbol: 'XRP', name: 'XRP' },
	cardano: { symbol: 'ADA', name: 'Cardano' },
	'usd-coin': { symbol: 'USDC', name: 'USD Coin' },
	'avalanche-2': { symbol: 'AVAX', name: 'Avalanche' },
};
const TICKER_ALIASES = {
	btc: 'bitcoin', eth: 'ethereum', sol: 'solana', doge: 'dogecoin',
	xrp: 'ripple', ada: 'cardano', usdc: 'usd-coin', avax: 'avalanche-2',
};

function normalizeIds(raw) {
	const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
	const seen = new Set();
	const out = [];
	for (const item of list) {
		const id = String(item || '').toLowerCase().trim();
		const resolved = TICKER_ALIASES[id] || id;
		if (!/^[a-z0-9-]{1,40}$/.test(resolved) || seen.has(resolved)) continue;
		seen.add(resolved);
		out.push(resolved);
		if (out.length >= 12) break;
	}
	return out;
}

async function fetchCoinGeckoPrices(ids) {
	const url =
		'https://api.coingecko.com/api/v3/simple/price' +
		`?ids=${encodeURIComponent(ids.join(','))}` +
		'&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_last_updated_at=true';
	const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
	if (!r.ok) {
		const err = new Error(`CoinGecko responded ${r.status}`);
		err.status = 503;
		err.code = 'data_unavailable';
		throw err;
	}
	const data = await r.json();
	const coins = ids
		.filter((id) => data[id])
		.map((id) => {
			const meta = COIN_META[id] || { symbol: id.toUpperCase().slice(0, 6), name: id };
			const d = data[id];
			return {
				id,
				symbol: meta.symbol,
				name: meta.name,
				price_usd: d.usd ?? null,
				change_24h: d.usd_24h_change ?? null,
				market_cap: d.usd_market_cap ?? null,
				updated_at: d.last_updated_at ? new Date(d.last_updated_at * 1000).toISOString() : null,
			};
		});
	if (!coins.length) {
		const err = new Error('no live prices returned for the requested coins');
		err.status = 503;
		err.code = 'data_unavailable';
		throw err;
	}
	return coins;
}

// ── App ──────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.disable('x-powered-by');

// The page is same-origin, but keep CORS permissive so the modal works if the
// demo is embedded from another origin during testing.
function cors(res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'content-type, x-payment, idempotency-key, x-idempotency-key');
	res.setHeader('Access-Control-Expose-Headers', 'x-payment-response');
}
function jsonError(res, status, code, description) {
	cors(res);
	return res.status(status).json({ error: code, error_description: description });
}

// Solana checkout endpoints the modal POSTs to (prepare + encode). Phantom only
// signs serialized transactions, so the package builds the SPL transfer here.
app.options('/api/x402-checkout', (_req, res) => { cors(res); res.status(204).end(); });
app.all('/api/x402-checkout', x402CheckoutRouter({ rpcUrl: SOLANA_RPC_URL }));

// ── Runtime payout config ─────────────────────────────────────────────────────
app.options('/api/config', (_req, res) => { cors(res); res.status(204).end(); });

app.get('/api/config', (_req, res) => {
	cors(res);
	res.json({
		configured: Boolean(merchant.payTo),
		payTo: merchant.payTo,
		updatedAt: merchant.updatedAt,
		feePayer: FEE_PAYER,
		network: 'solana',
		asset: 'USDC',
		priceUsd: PRICE_USD,
		coins: Object.entries(COIN_META).map(([id, m]) => ({ id, ...m })),
	});
});

app.post('/api/config', (req, res) => {
	const payTo = (req.body?.payTo || '').trim();
	if (!isValidSolanaAddress(payTo)) {
		return jsonError(res, 400, 'invalid_address', 'payTo must be a valid base58 Solana address');
	}
	merchant.payTo = payTo;
	merchant.updatedAt = new Date().toISOString();
	cors(res);
	res.json({ configured: true, payTo: merchant.payTo, updatedAt: merchant.updatedAt });
});

// ── The paid endpoint ─────────────────────────────────────────────────────────
// GET-less, POST-only so the resource URL (used for facilitator matching) stays
// query-free. Body: { ids: ["bitcoin", "ethereum", ...] }.
app.options('/api/paid/crypto', (_req, res) => { cors(res); res.status(204).end(); });

app.post('/api/paid/crypto', async (req, res) => {
	if (!merchant.payTo) {
		return jsonError(res, 503, 'payout_not_configured', 'Set a payout address first (POST /api/config { payTo }).');
	}

	const resourceUrl = `${req.protocol}://${req.get('host')}${req.path}`;
	const accept = solanaAccept({
		token: 'usdc',
		uiAmount: Number(PRICE_USD),
		payTo: merchant.payTo,
		feePayer: FEE_PAYER,
		maxTimeoutSeconds: 60,
		network: NETWORK_SOLANA_MAINNET,
	});
	// solanaAccept omits `resource`; the facilitator matches the signed payload
	// against it, so advertise the same absolute URL the modal will sign over.
	accept.resource = resourceUrl;

	const paymentHeader = req.headers['x-payment'];

	// No payment yet → answer with the x402 v2 challenge so the modal opens.
	if (!paymentHeader) {
		cors(res);
		return res.status(402).json({
			x402Version: 2,
			error: 'Payment required',
			resource: {
				url: resourceUrl,
				description: 'Live crypto prices (CoinGecko) — pay $0.01 USDC on Solana.',
				mimeType: 'application/json',
			},
			accepts: [accept],
		});
	}

	try {
		// 1. Verify the signed payment matches what we offered (facilitator-checked).
		const paymentPayload = decodePaymentHeader(paymentHeader);
		await verifyPayment({ paymentPayload, requirement: accept });

		// 2. Do the paid work BEFORE settling. If the live feed is down we throw a
		//    503 here and never settle — the buyer keeps their funds and can retry.
		const ids = normalizeIds(req.body?.ids);
		if (!ids.length) {
			return jsonError(res, 400, 'invalid_request', 'provide a non-empty `ids` array of CoinGecko ids');
		}
		const coins = await fetchCoinGeckoPrices(ids);

		// 3. Settle on-chain. Only now does USDC actually move.
		const settled = await settlePayment({ paymentPayload, requirement: accept });

		cors(res);
		res.setHeader('x-payment-response', encodePaymentResponse(settled));
		res.setHeader('cache-control', 'no-store');
		res.json({
			asof: new Date().toISOString(),
			base: 'usd',
			source: 'coingecko',
			coins,
			paidWith: { network: 'solana', asset: 'USDC', amount: PRICE_USD, payTo: merchant.payTo },
		});
	} catch (err) {
		return jsonError(res, err.status || 502, err.code || 'payment_failed', err.message || 'payment failed');
	}
});

// Static demo page.
app.use(express.static(join(__dirname, 'public')));

app.listen(PORT, () => {
	console.log('');
	console.log('  x402 Solana crypto paywall — demo');
	console.log(`  ▸ open            http://localhost:${PORT}`);
	console.log(`  ▸ paid endpoint   POST /api/paid/crypto`);
	console.log(`  ▸ checkout router /api/x402-checkout (prepare + encode)`);
	console.log(`  ▸ payout wallet   set it at runtime in the page (POST /api/config)`);
	console.log(`  ▸ fee payer       ${FEE_PAYER} (public PayAI sponsor)`);
	console.log(`  ▸ Solana RPC      ${SOLANA_RPC_URL}`);
	console.log('');
});
