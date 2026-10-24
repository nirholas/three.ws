// Solana Blink: "Tip this agent"
//
// GET  /api/actions/agent-tip?agent=<uuid>&token=SOL|THREE
//   → ActionGetResponse: title, description, icon, preset-amount + free-entry buttons
//
// POST /api/actions/agent-tip?agent=<uuid>&token=SOL|THREE
//   Body: { "account": "<wallet pubkey>", "amount": <number> }
//   → ActionPostResponse: base64 VersionedTransaction (unsigned SOL/$THREE transfer)
//
// Shares its unsigned-transaction builder (buildTransferTransaction) and its
// envelope/header pattern with api/actions/avatar.js. The recipient is always
// the agent's own Solana address: the caller never supplies a destination.

import { cors, json, error, readJson, wrap } from '../_lib/http.js';
import { solanaConnection } from '../_lib/solana/connection.js';
import { env } from '../_lib/env.js';
import { sql } from '../_lib/db.js';
import { isUuid } from '../_lib/validate.js';
import { cdnUrlOrNull } from '../_lib/r2.js';
import { getOrCreateAgentSolanaWallet } from '../_lib/agent-wallet.js';
import { buildTransferTransaction, MAX_UI_AMOUNT } from '../_lib/custody/builders.js';

export const maxDuration = 10;

const SOLANA_MAINNET_GENESIS = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
const ACTION_VERSION = '2.1.3';
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SOL_PRESETS = [0.01, 0.1, 1];
const THREE_PRESETS = [1000, 5000, 10000];

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

async function findAgent(agentId) {
	const [row] = await sql`
		select i.id, i.name, a.thumbnail_key as avatar_thumbnail_key
		from agent_identities i
		left join avatars a on a.id = i.avatar_id and a.deleted_at is null
		where i.id = ${agentId} and i.deleted_at is null
		limit 1
	`;
	return row || null;
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

	const tokenParam = (url.searchParams.get('token') || 'SOL').toUpperCase();
	if (tokenParam !== 'SOL' && tokenParam !== 'THREE') {
		return actionError(res, 400, 'bad_request', 'token must be "SOL" or "THREE"');
	}

	const agent = await findAgent(agentId).catch(() => null);
	if (!agent) return actionError(res, 404, 'not_found', 'That agent is not available.');

	if (req.method === 'GET') return handleGet(res, agent, tokenParam);
	return handlePost(req, res, agent, tokenParam);
});

function handleGet(res, agent, token) {
	const name = typeof agent.name === 'string' ? agent.name.trim().slice(0, 60) : 'this agent';
	const icon = cdnUrlOrNull(agent.avatar_thumbnail_key) || `${env.APP_ORIGIN}/logo.png`;
	const unit = token === 'THREE' ? '$THREE' : 'SOL';
	const presets = token === 'THREE' ? THREE_PRESETS : SOL_PRESETS;
	const baseHref = `/api/actions/agent-tip?agent=${encodeURIComponent(agent.id)}&token=${token}`;

	return json(res, 200, {
		type: 'action',
		icon,
		label: `Tip ${unit}`,
		title: `Tip ${name}`,
		description: `Send ${unit} straight to ${name}'s own Solana wallet on three.ws.`,
		links: {
			actions: [
				...presets.map((amount) => ({
					type: 'transaction',
					label: `Tip ${amount} ${unit}`,
					href: `${baseHref}&amount=${amount}`,
				})),
				{
					type: 'transaction',
					label: 'Custom amount',
					href: `${baseHref}&amount={amount}`,
					parameters: [{ name: 'amount', label: `Amount (${unit})`, type: 'number' }],
				},
			],
		},
	}, { 'cache-control': 'public, max-age=60, s-maxage=300' });
}

async function handlePost(req, res, agent, token) {
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

	let recipient;
	try {
		({ address: recipient } = await getOrCreateAgentSolanaWallet(agent.id));
	} catch (err) {
		return actionError(res, 404, 'not_found', `could not resolve this agent's wallet: ${err?.message || 'unknown error'}`);
	}

	const connection = solanaConnection({ network: 'mainnet', commitment: 'confirmed' });

	let built;
	try {
		built = await buildTransferTransaction({
			connection,
			sender: account,
			recipient,
			amount,
			token: token === 'THREE' ? THREE_MINT : 'SOL',
			memo: `tip:${agent.id}`,
			network: 'mainnet',
		});
	} catch (err) {
		const status = err?.status || 500;
		if (status >= 500) return actionError(res, 503, 'rpc_unavailable', `could not build the tip transaction: ${err?.message || 'upstream error'}`);
		return actionError(res, status, err?.code || 'bad_request', err?.message || 'could not build the tip transaction');
	}

	const txBase64 = Buffer.from(built.transaction.serialize()).toString('base64');

	return json(res, 200, {
		type: 'transaction',
		transaction: txBase64,
		message: `Tip sent to ${agent.name || 'this agent'}. Thank you for supporting them on three.ws.`,
	}, { 'cache-control': 'no-store' });
}
