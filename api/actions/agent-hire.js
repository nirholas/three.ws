// Solana Blink: "Hire this agent"
//
// GET  /api/actions/agent-hire?agent=<uuid>[&offer=<slug>]
//   → ActionGetResponse: one transaction action per Solana offer the agent sells,
//     with the offer's input fields as Action parameters (in_<property>).
// GET  /api/actions/agent-hire?agent=<uuid>&hire=<hireId>
//   → the hire's receipt as an Action (completed, failed, or still confirming).
//     A browser (Accept: text/html) gets the same receipt as a page.
//
// POST /api/actions/agent-hire?agent=<uuid>&offer=<slug>&in_<property>=...
//   Body: { "account": "<wallet pubkey>", "data"?: { in_<property>: ... } }
//   → ActionPostResponse: base64 unsigned transaction paying the offer price in
//     USDC to the agent's payout wallet, plus links.next pointing at the confirm
//     callback. A pending agent_hires row is written (or reused) first.
//
// POST /api/actions/agent-hire?agent=<uuid>&confirm=<hireId>
//   Body: { "account": "<wallet>", "signature": "<tx signature>" }
//   → NextAction (type "completed"): the payment is verified on chain, the offer
//     runs with the buyer's input, and its result comes back in the card. When
//     the payment is not visible yet, the card says so and the settlement sweep
//     (api/cron/hire-blink-sweep.js) finishes the hire.
//
// The buyer pays the network fee and is the only signer; nothing is signed here.
// The payout wallet and price always come from the offer row, never the caller.
// SOLANA_CLUSTER=devnet moves the whole flow to devnet USDC. The money and
// delivery path lives in api/_lib/hire-blink.js, shared with the sweep.

import { PublicKey } from '@solana/web3.js';
import { cors, json, error, readJson, wrap } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { sql } from '../_lib/db.js';
import { isUuid } from '../_lib/validate.js';
import { cdnUrlOrNull } from '../_lib/r2.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { solanaConnection } from '../_lib/solana/connection.js';
import { findReusableBlinkHire, getHireById, recordBlinkHire } from '../_lib/agent-economy.js';
import { listSolanaServicesForAgent } from '../_lib/agent-paid-services.js';
import {
	BLOCKCHAIN_IDS,
	buildHireTransaction,
	coerceOfferInput,
	formatUsdc,
	hireBlinkNetwork,
	hireNetworkOf,
	inputHash,
	locateHirePayment,
	newReference,
	offerParameters,
	readBuyerUsdc,
	settleBlinkHire,
} from '../_lib/hire-blink.js';

export const maxDuration = 60;

const ACTION_VERSION = '2.1.3';
const SIGNATURE_RE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;

function setActionHeaders(res, network) {
	res.setHeader('x-action-version', ACTION_VERSION);
	res.setHeader('x-blockchain-ids', BLOCKCHAIN_IDS[network]);
}

function exposeActionHeaders(res) {
	res.setHeader(
		'access-control-expose-headers',
		'x-action-version, x-blockchain-ids, x-payment-response, x-payment-network, x-payment-tx, link',
	);
}

// Blink clients render ActionError.message, not our standard error envelope, so
// action errors carry both shapes.
function actionError(res, status, code, message, headers) {
	return error(res, status, code, message, { message }, headers);
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

function agentName(agent) {
	const name = typeof agent?.name === 'string' ? agent.name.trim().slice(0, 60) : '';
	return name || 'this agent';
}

function agentIcon(agent) {
	return cdnUrlOrNull(agent.avatar_thumbnail_key) || `${env.APP_ORIGIN}/logo.png`;
}

function priceLabel(atomics) {
	return `${formatUsdc(atomics)} USDC`;
}

function receiptUrl(agentId, hireId) {
	return `${env.APP_ORIGIN}/api/actions/agent-hire?agent=${encodeURIComponent(agentId)}&hire=${encodeURIComponent(hireId)}`;
}

export default wrap(async (req, res) => {
	const network = hireBlinkNetwork();
	setActionHeaders(res, network);
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

	if (req.method === 'POST') {
		const rl = await limits.hireBlinkIp(clientIp(req));
		if (!rl.success) {
			const retryAfter = Math.max(1, Math.ceil(((rl.reset || Date.now() + 60_000) - Date.now()) / 1000));
			return actionError(res, 429, 'rate_limited', 'Too many hire requests from this network. Wait a minute and try again.', {
				'retry-after': String(retryAfter),
			});
		}
	}

	const agent = await findAgent(agentId);
	if (!agent) return actionError(res, 404, 'not_found', 'That agent is not available.');

	const hireParam = url.searchParams.get('hire');
	const confirmParam = url.searchParams.get('confirm');

	if (req.method === 'GET' && hireParam) return handleReceipt(req, res, agent, hireParam);
	if (req.method === 'GET') return handleCard(res, agent, url.searchParams.get('offer'));
	if (confirmParam) return handleConfirm(req, res, agent, confirmParam);
	return handleHire(req, res, agent, url, network);
});

// ── GET: the card ────────────────────────────────────────────────────────────

async function hireableOffers(agentId) {
	const rows = await listSolanaServicesForAgent(agentId, { limit: 6 });
	const offers = [];
	for (const row of rows) {
		const parameters = offerParameters(row.input_schema);
		if (parameters) offers.push({ row, parameters });
	}
	return offers;
}

async function handleCard(res, agent, offerSlug) {
	const name = agentName(agent);
	let offers = await hireableOffers(agent.id);
	if (offerSlug) offers = offers.filter((o) => o.row.slug === offerSlug);
	if (!offers.length) {
		return actionError(
			res,
			404,
			'not_found',
			offerSlug
				? `${name} does not sell that offer on Solana.`
				: `${name} has no Solana offers to hire yet. Check back once its owner lists one.`,
		);
	}

	const actions = offers.map(({ row, parameters }) => {
		const qs = new URLSearchParams({ agent: agent.id, offer: row.slug });
		let href = `/api/actions/agent-hire?${qs.toString()}`;
		for (const p of parameters) href += `&${p.name}={${p.name}}`;
		const action = {
			type: 'transaction',
			label: `Hire: ${String(row.name).slice(0, 48)} (${priceLabel(row.price_atomics)})`,
			href,
		};
		if (parameters.length) action.parameters = parameters;
		return action;
	});

	const listed = offers.map(({ row }) => `${row.name} (${priceLabel(row.price_atomics)})`).join(', ');
	const single = offers.length === 1 ? offers[0].row : null;
	const description = single
		? `${single.description ? `${String(single.description).trim().slice(0, 300)} ` : ''}Pay ${priceLabel(single.price_atomics)} from your Solana wallet to hire ${name} for "${single.name}". The result comes back right here.`
		: `${name} sells ${listed} on three.ws. Pay in USDC from your Solana wallet and the result comes back right here.`;

	return json(
		res,
		200,
		{
			type: 'action',
			icon: agentIcon(agent),
			label: 'Hire',
			title: `Hire ${name}`,
			description,
			links: { actions },
		},
		{ 'cache-control': 'public, max-age=60, s-maxage=120' },
	);
}

// ── POST: build the hire payment ─────────────────────────────────────────────

function parseAccount(raw) {
	const account = typeof raw === 'string' ? raw.trim() : '';
	if (!account) return null;
	try {
		const key = new PublicKey(account);
		// A curve-off point is a PDA: it has no private key, so a transaction
		// built for it can never be signed.
		if (!PublicKey.isOnCurve(key.toBytes())) return null;
		return key.toBase58();
	} catch {
		return null;
	}
}

function collectInput(url, body) {
	const raw = {};
	for (const [k, v] of url.searchParams) {
		// An unfilled template placeholder ("{in_x}") is an empty field, not a value.
		if (k.startsWith('in_') && !/^\{in_[A-Za-z0-9_]+\}$/.test(v)) raw[k] = v;
	}
	const data = body?.data && typeof body.data === 'object' && !Array.isArray(body.data) ? body.data : {};
	for (const [k, v] of Object.entries(data)) {
		if (k.startsWith('in_') && raw[k] == null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
			raw[k] = String(v);
		}
	}
	return raw;
}

function isMissingWalletHireSchema(err) {
	// 23502 not_null_violation on hirer_agent_id: the wallet-hirer migration
	// (20261105010000_agent_hires_wallet_hirers.sql) has not been applied yet.
	return err?.code === '23502' || /hirer_agent_id.*null|null value in column "hirer_/i.test(err?.message || '');
}

async function handleHire(req, res, agent, url, network) {
	let body;
	try {
		body = await readJson(req, 8_000);
	} catch (e) {
		return actionError(res, 400, 'bad_request', e.message);
	}

	const account = parseAccount(body?.account);
	if (!account) return actionError(res, 400, 'bad_request', 'account must be a wallet public key that can sign');

	const offerSlug = url.searchParams.get('offer') || '';
	const offers = await hireableOffers(agent.id);
	const offer = offers.find((o) => o.row.slug === offerSlug)?.row;
	if (!offer) return actionError(res, 404, 'not_found', `${agentName(agent)} does not sell that offer on Solana.`);

	const coerced = coerceOfferInput(offer.input_schema, collectInput(url, body));
	if (!coerced.ok) return actionError(res, 400, 'bad_request', coerced.message);

	const price = BigInt(offer.price_atomics);
	const connection = solanaConnection({ network, commitment: 'confirmed' });

	const balance = await readBuyerUsdc(connection, network, account);
	if (balance !== null && balance < price) {
		return actionError(
			res,
			409,
			'insufficient_funds',
			`This wallet is ${priceLabel(price - balance)} short of the ${priceLabel(price)} price. Add USDC on Solana${network === 'devnet' ? ' devnet' : ''} and try again.`,
		);
	}

	const hash = inputHash(coerced.input);
	let hire;
	try {
		hire = await findReusableBlinkHire({ payerAddress: account, serviceId: offer.id, inputHash: hash, cluster: network });
		if (!hire) {
			hire = await recordBlinkHire({
				providerAgentId: agent.id,
				providerUserId: offer.owner_user_id,
				serviceId: offer.id,
				serviceSlug: offer.slug,
				skillName: offer.name,
				amountAtomics: String(price),
				usd: Number(price) / 1e6,
				payerAddress: account,
				payoutAddress: offer.payout_address,
				meta: {
					source: 'blink',
					cluster: network,
					reference: newReference(),
					input: coerced.input,
					input_hash: hash,
				},
			});
		}
	} catch (err) {
		if (isMissingWalletHireSchema(err)) {
			return actionError(res, 503, 'not_ready', 'Hiring from a wallet is not switched on for this server yet. Hire this agent on three.ws instead.');
		}
		throw err;
	}

	let transaction;
	try {
		transaction = await buildHireTransaction({
			connection,
			network,
			buyer: account,
			payout: offer.payout_address,
			atomics: price,
			reference: hire.meta.reference,
			hireId: hire.id,
		});
	} catch (err) {
		return actionError(res, 503, 'rpc_unavailable', `The Solana network did not answer while preparing this hire. Try again in a moment. (${err?.message || 'upstream error'})`);
	}

	const confirmQs = new URLSearchParams({ agent: agent.id, confirm: hire.id });
	return json(
		res,
		200,
		{
			type: 'transaction',
			transaction,
			message: `Hiring ${agentName(agent)} for "${offer.name}" at ${priceLabel(price)}. Approve in your wallet; the result appears here once the payment confirms.`,
			links: { next: { type: 'post', href: `/api/actions/agent-hire?${confirmQs.toString()}` } },
		},
		{ 'cache-control': 'no-store' },
	);
}

// ── Confirm callback and receipt ─────────────────────────────────────────────

function completedCard(agent, hire, state) {
	const name = agentName(agent);
	const receipt = receiptUrl(agent.id, hire.id);
	if (state === 'completed') {
		return {
			type: 'completed',
			icon: agentIcon(agent),
			label: 'Hired',
			title: `${name} finished "${hire.skill_name}"`,
			description: hire.result_summary
				? `${hire.result_summary}\n\nFull result: ${receipt}`
				: `Done. Full result: ${receipt}`,
		};
	}
	if (state === 'failed') {
		const paid = Boolean(hire.payment_signature);
		return {
			type: 'completed',
			icon: agentIcon(agent),
			label: 'Hire failed',
			title: `${name} could not finish "${hire.skill_name}"`,
			description: paid
				? `Your payment is recorded on this hire (transaction ${hire.payment_signature}), but ${String(hire.error || 'the offer failed').replace(/^paid, but /, '')}. Keep this receipt to ask the agent's owner for a refund: ${receipt}`
				: `This hire was closed: ${hire.error || 'no payment arrived'}. No money moved. Open the Blink again to hire.`,
		};
	}
	if (state === 'expired') {
		return {
			type: 'completed',
			icon: agentIcon(agent),
			label: 'Hire expired',
			title: `This hire of ${name} expired`,
			description: 'No payment arrived for it, so nothing was charged. Open the Blink again to hire.',
		};
	}
	return {
		type: 'completed',
		icon: agentIcon(agent),
		label: 'Confirming',
		title: `Payment to ${name} is confirming`,
		description: `Your payment is still confirming on Solana. ${name} starts "${hire.skill_name}" as soon as it lands, usually within a minute. Your result will be here: ${receipt}`,
	};
}

async function loadHireFor(agent, hireId) {
	if (!isUuid(hireId)) return null;
	const hire = await getHireById(hireId);
	if (!hire || hire.provider_agent_id !== agent.id || hire.meta?.source !== 'blink') return null;
	return hire;
}

async function handleConfirm(req, res, agent, hireId) {
	let body;
	try {
		body = await readJson(req, 4_000);
	} catch (e) {
		return actionError(res, 400, 'bad_request', e.message);
	}

	const hire = await loadHireFor(agent, hireId);
	if (!hire) return actionError(res, 404, 'not_found', 'That hire does not exist for this agent.');

	if (hire.status !== 'pending') {
		return json(res, 200, completedCard(agent, hire, hire.status), { 'cache-control': 'no-store' });
	}

	let signature = typeof body?.signature === 'string' ? body.signature.trim() : '';
	if (signature && !SIGNATURE_RE.test(signature)) {
		return actionError(res, 400, 'bad_request', 'signature must be a Solana transaction signature');
	}
	if (!signature) {
		try {
			signature = (await locateHirePayment(hire)) || '';
		} catch {
			signature = '';
		}
		if (!signature) return json(res, 200, completedCard(agent, hire, 'confirming'), { 'cache-control': 'no-store' });
	}

	const outcome = await settleBlinkHire(hire, { signature, wait: true });
	if (outcome.state === 'mismatch') {
		return actionError(
			res,
			400,
			'payment_mismatch',
			`That transaction does not match this hire (${outcome.reason}). Nothing was run. Open the Blink again to hire.`,
		);
	}
	const state = outcome.state === 'busy' ? 'confirming' : outcome.state;
	return json(res, 200, completedCard(agent, outcome.hire, state), { 'cache-control': 'no-store' });
}

function escapeHtml(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function explorerUrl(signature, network) {
	return `https://solscan.io/tx/${encodeURIComponent(signature)}${network === 'devnet' ? '?cluster=devnet' : ''}`;
}

function receiptHtml(agent, hire, card) {
	const result = hire.status === 'completed' ? hire.meta?.result ?? null : null;
	const network = hireNetworkOf(hire);
	const statusText = { completed: 'Completed', failed: 'Failed', expired: 'Expired', pending: 'Confirming' }[hire.status] || hire.status;
	const sig = hire.payment_signature
		? `<p class="row"><span>Payment</span><a href="${escapeHtml(explorerUrl(hire.payment_signature, network))}" rel="noopener" target="_blank">${escapeHtml(hire.payment_signature.slice(0, 12))}...</a></p>`
		: '';
	const body = result != null
		? `<h2>Result</h2><pre>${escapeHtml(typeof result === 'string' ? result : JSON.stringify(result, null, 2))}</pre>`
		: `<p class="note">${escapeHtml(card.description)}</p>`;
	return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(card.title)} | three.ws</title>
<meta name="robots" content="noindex">
${hire.status === 'pending' ? '<meta http-equiv="refresh" content="15">' : ''}
<style>
:root{color-scheme:light dark;--bg:#0b0d12;--fg:#e8eaf0;--muted:#9aa3b2;--card:#151923;--line:#252b38;--accent:#7c9cff}
@media (prefers-color-scheme:light){:root{--bg:#f6f7fb;--fg:#141821;--muted:#5b6474;--card:#fff;--line:#e3e6ee;--accent:#3557e6}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:32px 16px}
main{max-width:640px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
header{display:flex;gap:14px;align-items:center;margin-bottom:16px}
header img{width:56px;height:56px;border-radius:12px;object-fit:cover;background:var(--line)}
h1{font-size:19px;margin:0}h2{font-size:15px;margin:20px 0 8px}
.status{display:inline-block;font-size:12px;padding:2px 10px;border-radius:999px;border:1px solid var(--line);color:var(--muted)}
.row{display:flex;justify-content:space-between;gap:12px;margin:6px 0;color:var(--muted)}
.row a{color:var(--accent)}
.note{color:var(--muted);white-space:pre-wrap}
pre{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;max-height:60vh}
a:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}
</style></head>
<body><main>
<header><img src="${escapeHtml(card.icon)}" alt=""><div><h1>${escapeHtml(card.title)}</h1><span class="status">${escapeHtml(statusText)}</span></div></header>
<p class="row"><span>Offer</span><span>${escapeHtml(hire.skill_name)}</span></p>
<p class="row"><span>Price</span><span>${escapeHtml(priceLabel(hire.amount_atomics))}${network === 'devnet' ? ' (devnet)' : ''}</span></p>
${sig}
${body}
<p class="row"><span>Agent</span><a href="${escapeHtml(`${env.APP_ORIGIN}/agents/${agent.id}`)}">${escapeHtml(agentName(agent))} on three.ws</a></p>
</main></body></html>`;
}

async function handleReceipt(req, res, agent, hireId) {
	const hire = await loadHireFor(agent, hireId);
	if (!hire) return actionError(res, 404, 'not_found', 'That hire does not exist for this agent.');
	const state = hire.status === 'pending' ? 'confirming' : hire.status;
	const card = completedCard(agent, hire, state);

	const accept = String(req.headers?.accept || '');
	if (accept.includes('text/html')) {
		res.statusCode = 200;
		res.setHeader('content-type', 'text/html; charset=utf-8');
		res.setHeader('cache-control', 'no-store');
		res.end(receiptHtml(agent, hire, card));
		return;
	}
	return json(
		res,
		200,
		{
			...card,
			hire: {
				id: hire.id,
				status: hire.status,
				offer: hire.skill_name,
				price_usdc: formatUsdc(hire.amount_atomics),
				network: hireNetworkOf(hire),
				payment_signature: hire.payment_signature || null,
				result: hire.status === 'completed' ? hire.meta?.result ?? null : null,
			},
		},
		{ 'cache-control': 'no-store' },
	);
}
