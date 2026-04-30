// Helius webhook helpers for pump.fun wallet monitoring.
//
// Replaces 5s polling (pumpfun-copy-trade) and reduces RPC pressure on the
// browser-side WalletMonitor. Helius pushes enhanced txns to our endpoint
// within ~1-2s of confirmation. Free tier: 100k webhook events/mo.
//
// Docs: https://docs.helius.dev/webhooks-and-websockets/webhooks
//
// Env:
//   HELIUS_API_KEY            — required to register webhooks
//   HELIUS_WEBHOOK_AUTH       — shared secret echoed in 'authorization' header
//                               on every push; required to authenticate inbound

const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
const PUMP_AMM_PROGRAM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';

const HELIUS_API = 'https://api.helius.xyz/v0/webhooks';

function apiKey() {
	const k = process.env.HELIUS_API_KEY;
	if (!k) throw new Error('HELIUS_API_KEY not set');
	return k;
}

export function heliusEnabled() {
	return Boolean(process.env.HELIUS_API_KEY && process.env.HELIUS_WEBHOOK_AUTH);
}

/**
 * Create a webhook that pushes pump.fun txns for `wallets` to `webhookURL`.
 * Idempotent at the caller level — Helius will create a new one each call.
 * @param {{ wallets: string[], webhookURL: string, network?: 'mainnet'|'devnet' }} opts
 */
export async function createWebhook({ wallets, webhookURL, network = 'mainnet' }) {
	const r = await fetch(`${HELIUS_API}?api-key=${apiKey()}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			webhookURL,
			transactionTypes: ['Any'],
			accountAddresses: wallets,
			webhookType: network === 'devnet' ? 'enhancedDevnet' : 'enhanced',
			authHeader: process.env.HELIUS_WEBHOOK_AUTH,
		}),
	});
	if (!r.ok) throw new Error(`helius create webhook failed: ${r.status} ${await r.text()}`);
	return r.json();
}

/** Replace `accountAddresses` on an existing webhook (use to add/remove wallets in batch). */
export async function updateWebhookWallets(webhookID, wallets) {
	const r = await fetch(`${HELIUS_API}/${webhookID}?api-key=${apiKey()}`, {
		method: 'PUT',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ accountAddresses: wallets }),
	});
	if (!r.ok) throw new Error(`helius update failed: ${r.status} ${await r.text()}`);
	return r.json();
}

export async function listWebhooks() {
	const r = await fetch(`${HELIUS_API}?api-key=${apiKey()}`);
	if (!r.ok) throw new Error(`helius list failed: ${r.status}`);
	return r.json();
}

export async function deleteWebhook(webhookID) {
	const r = await fetch(`${HELIUS_API}/${webhookID}?api-key=${apiKey()}`, { method: 'DELETE' });
	if (!r.ok && r.status !== 404) throw new Error(`helius delete failed: ${r.status}`);
}

/**
 * Parse pump.fun trades from a Helius enhanced txn payload. Returns one entry
 * per qualifying instruction, [] if the txn doesn't touch pump.fun.
 *
 * @param {object} tx — single Helius enhanced txn object (one element of the
 *   POST body array)
 * @returns {Array<{ side:'buy'|'sell', mint:string, sol:number, wallet:string, signature:string, slot:number, ts:number }>}
 */
export function parsePumpTrades(tx) {
	if (!tx || !Array.isArray(tx.instructions)) return [];
	const signature = tx.signature;
	const slot = tx.slot ?? 0;
	const ts = tx.timestamp ?? Math.floor(Date.now() / 1000);
	const fee = tx.feePayer;

	const out = [];
	for (const ix of tx.instructions) {
		if (ix.programId !== PUMP_PROGRAM && ix.programId !== PUMP_AMM_PROGRAM) continue;
		const side = matchSide(ix);
		if (!side) continue;

		const transfers = tx.tokenTransfers || [];
		const native = tx.nativeTransfers || [];
		const mint = transfers.find((t) => t.fromUserAccount === fee || t.toUserAccount === fee)?.mint;
		const lamports = native
			.filter((n) => n.fromUserAccount === fee || n.toUserAccount === fee)
			.reduce((acc, n) => acc + (n.amount || 0), 0);

		if (!mint) continue;
		out.push({
			side,
			mint,
			sol: Math.abs(lamports) / 1e9,
			wallet: fee,
			signature,
			slot,
			ts,
		});
	}
	return out;
}

function matchSide(ix) {
	// Helius decodes pump.fun ixs by name when it can.
	const name = (ix.parsed?.type || ix.innerInstructions?.[0]?.parsed?.type || '').toLowerCase();
	if (name.includes('buy')) return 'buy';
	if (name.includes('sell')) return 'sell';
	// Fallback: discriminator-free heuristic via inner logs would go here.
	return null;
}
