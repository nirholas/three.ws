// Solana Blink: "Buy this agent's coin"
//
// GET  /api/actions/agent-buy-coin?agent=<uuid>
//   → ActionGetResponse: title, description, icon, preset SOL-amount + free-entry buttons
//
// POST /api/actions/agent-buy-coin?agent=<uuid>
//   Body: { "account": "<wallet pubkey>", "amount": <SOL amount> }
//   → ActionPostResponse: base64 VersionedTransaction (unsigned Jupiter swap, SOL -> mint)
//
// The mint is resolved at runtime from the agent's own most recent mainnet
// pump.fun launch (pump_agent_mints), never from a caller-supplied parameter:
// this is the platform's own launch directory, the CLAUDE.md commit-gate
// exception for "render coins users launched through three.ws from the
// platform's own launch records at runtime", not an endorsement of any coin.

import { cors, json, error, readJson, wrap } from '../_lib/http.js';
import { solanaConnection } from '../_lib/solana/connection.js';
import { env } from '../_lib/env.js';
import { sql } from '../_lib/db.js';
import { isUuid } from '../_lib/validate.js';
import { cdnUrlOrNull } from '../_lib/r2.js';
import { buildSwapTransaction, MAX_UI_AMOUNT } from '../_lib/custody/builders.js';

export const maxDuration = 10;

const SOLANA_MAINNET_GENESIS = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const ACTION_VERSION = '2.1.3';
const SOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_PRESETS = [0.1, 0.5, 1];

function setActionVersionHeaders(res) {
	res.setHeader('x-action-version', ACTION_VERSION);
	res.setHeader('x-blockchain-ids', SOLANA_MAINNET_GENESIS);
}

function exposeActionHeaders(res) {
	res.setHeader(
		'access-control-expose-headers',
		'x-action-version, x-blockchain-ids, x-payment-response, x-payment-network, x-payment-tx, link',
	);
}

// Blink clients render ActionError.message, not our standard error envelope, so
// action errors carry both shapes.
function actionError(res, status, code, message) {
	return error(res, status, code, message, { message });
}

async function findAgentAndCoin(agentId) {
	const [agent] = await sql`
		select i.id, i.name, a.thumbnail_key as avatar_thumbnail_key
		from agent_identities i
		left join avatars a on a.id = i.avatar_id and a.deleted_at is null
		where i.id = ${agentId} and i.deleted_at is null
		limit 1
	`;
	if (!agent) return { agent: null, coin: null };

	const [coin] = await sql`
		select mint, name, symbol
		from pump_agent_mints
		where agent_id = ${agentId} and network = 'mainnet'
		order by created_at desc
		limit 1
	`;
	return { agent, coin: coin || null };
}

export default wrap(async (req, res) => {
	setActionVersionHeaders(res);
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	exposeActionHeaders(res);

	if (req.method !== 'GET' && req.method !== 'POST') {
		return actionError(res, 405, 'method_not_allowed', 'GET or POST required');
	}

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agent') || '';
	if (!isUuid(agentId)) {
		return actionError(res, 400, 'bad_request', 'agent must be a valid agent id');
	}

	const { agent, coin } = await findAgentAndCoin(agentId).catch(() => ({ agent: null, coin: null }));
	if (!agent) return actionError(res, 404, 'not_found', 'That agent is not available.');
	if (!coin) return actionError(res, 404, 'not_found', 'This agent has not launched a coin.');

	if (req.method === 'GET') return handleGet(res, agent, coin);
	return handlePost(req, res, agent, coin);
});

function handleGet(res, agent, coin) {
	const agentName = typeof agent.name === 'string' ? agent.name.trim().slice(0, 60) : 'this agent';
	const symbol = typeof coin.symbol === 'string' && coin.symbol.trim() ? coin.symbol.trim().slice(0, 20) : 'its coin';
	const icon = cdnUrlOrNull(agent.avatar_thumbnail_key) || `${env.APP_ORIGIN}/logo.png`;
	const baseHref = `/api/actions/agent-buy-coin?agent=${encodeURIComponent(agent.id)}`;

	return json(res, 200, {
		type: 'action',
		icon,
		label: `Buy ${symbol}`,
		title: `Buy ${symbol}`,
		description: `Swap SOL for ${symbol}, ${agentName}'s coin on three.ws, via a Jupiter-routed trade.`,
		links: {
			actions: [
				...SOL_PRESETS.map((amount) => ({
					type: 'transaction',
					label: `Buy with ${amount} SOL`,
					href: `${baseHref}&amount=${amount}`,
				})),
				{
					type: 'transaction',
					label: 'Custom amount',
					href: `${baseHref}&amount={amount}`,
					parameters: [{ name: 'amount', label: 'Amount (SOL)', type: 'number' }],
				},
			],
		},
	}, { 'cache-control': 'public, max-age=60, s-maxage=300' });
}

async function handlePost(req, res, agent, coin) {
	let body;
	try {
		body = await readJson(req, 4_000);
	} catch (e) {
		return actionError(res, 400, 'bad_request', e.message);
	}

	const account = typeof body?.account === 'string' ? body.account.trim() : '';
	if (!account) return actionError(res, 400, 'bad_request', 'account is required');

	const url = new URL(req.url, 'http://x');
	const rawAmount = body?.amount ?? url.searchParams.get('amount');
	const amount = Number(rawAmount);
	if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_UI_AMOUNT) {
		return actionError(res, 400, 'bad_request', 'amount must be a positive number');
	}

	const { PublicKey } = await import('@solana/web3.js');
	let payer;
	try {
		payer = new PublicKey(account);
		// A curve-off point is a PDA: it has no private key, so a transaction
		// built for it can never be signed. Reject it here rather than handing
		// the wallet a transaction it will fail on.
		if (!PublicKey.isOnCurve(payer.toBytes())) throw new Error('off-curve');
	} catch {
		return actionError(res, 400, 'bad_request', 'invalid account pubkey');
	}

	const connection = solanaConnection({ network: 'mainnet', commitment: 'confirmed' });

	let built;
	try {
		built = await buildSwapTransaction({
			connection,
			sender: account,
			inputMint: SOL_MINT,
			outputMint: coin.mint,
			amount,
			slippageBps: 50,
		});
	} catch (err) {
		const status = err?.status || 500;
		if (status >= 500) return actionError(res, 503, 'rpc_unavailable', `could not build the swap transaction: ${err?.message || 'upstream error'}`);
		return actionError(res, status, err?.code || 'bad_request', err?.message || 'could not build the swap transaction');
	}

	const txBase64 = Buffer.from(built.transaction.serialize()).toString('base64');
	const symbol = typeof coin.symbol === 'string' && coin.symbol.trim() ? coin.symbol.trim() : 'the coin';

	return json(res, 200, {
		type: 'transaction',
		transaction: txBase64,
		message: `Swap built. Sign to buy ${symbol} on three.ws.`,
	}, { 'cache-control': 'no-store' });
}
