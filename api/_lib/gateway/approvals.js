// Approve and Cancel for chat previews. The confirm flag behind a trade is set
// in exactly one place: a button press carrying the preview's id, from the
// platform user the chat is paired to, while the preview is still live. Text
// can never reach here, and an expired, cancelled or already-used preview can
// never execute.
//
// Execution runs through the same engine as the web wallet's Trade tab
// (executeAgentTrade: quote, kill switch, per-trade cap, daily budget, spend
// policy, firewall, custody ledger, idempotency) and the same limits writer.

import { sql } from '../db.js';
import { currentSignatureFor, agreementRequirement } from '../real-funds-agreement.js';
import { getTradeLimits, setTradeLimits } from '../agent-trade-guards.js';
import { executeAgentTrade, parseTradeInput } from '../../agents/agent-trade.js';
import { appendThreadMessage } from '../agent-thread.js';
import { limits } from '../rate-limit.js';
import { getPreview, claimPreview, cancelPreview, expirePreview, finishPreview } from './store.js';
import { previewText, APPROVE, CANCEL } from './conversation.js';
import { explorerTx, fmtNum } from './format.js';

/** Parse a button id into { verb, previewId }, or null. */
export function parseActionId(id) {
	const s = String(id || '');
	if (s.startsWith(APPROVE)) return { verb: 'approve', previewId: s.slice(APPROVE.length) };
	if (s.startsWith(CANCEL)) return { verb: 'cancel', previewId: s.slice(CANCEL.length) };
	return null;
}

const fail = (code, message, detail = null) => ({ ok: false, code, message, detail });

const LIMIT_KEYS = ['per_trade_sol', 'daily_budget_sol', 'max_price_impact_pct', 'kill_switch'];
function validLimitChanges(changes) {
	const out = {};
	for (const k of LIMIT_KEYS) {
		if (!(k in (changes || {}))) continue;
		const v = changes[k];
		if (k === 'kill_switch') {
			if (typeof v !== 'boolean') return null;
		} else if (!(typeof v === 'number' && Number.isFinite(v) && v >= 0 && (k !== 'max_price_impact_pct' || v <= 100))) {
			return null;
		}
		out[k] = v;
	}
	return Object.keys(out).length ? out : null;
}

/**
 * Execute a claimed preview. `confirm` must be the literal true the button path
 * passes; any other caller gets a refusal.
 * @returns {Promise<{ ok:true, data:object } | { ok:false, code:string, message:string, detail?:object }>}
 */
export async function executePreview(preview, { confirm } = {}) {
	if (confirm !== true) return fail('confirm_required', 'This action needs the Approve button on its preview.');
	const p = preview.proposal || {};
	const [agent] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${preview.agent_id} AND deleted_at IS NULL`;
	if (!agent) return fail('not_found', 'That agent no longer exists.');
	if (agent.user_id !== preview.user_id) return fail('forbidden', 'That agent is no longer owned by this account.');

	if (preview.kind === 'limits') {
		const changes = validLimitChanges(p.changes);
		if (!changes) return fail('validation_error', 'That limit change is not valid. Ask again with the exact numbers.');
		const next = await setTradeLimits(agent.id, agent.user_id, changes);
		return { ok: true, data: { limits: next } };
	}

	const network = p.network === 'devnet' ? 'devnet' : 'mainnet';
	if (network !== 'devnet') {
		let signed;
		try {
			signed = await currentSignatureFor(agent.user_id);
		} catch {
			return fail('agreement_check_unavailable', 'Could not verify your signed real-funds agreements, so nothing was sent. Try again in a moment.');
		}
		if (!signed) {
			const req = agreementRequirement();
			return fail('risk_ack_required', `Sign the real-funds agreements before trading real funds. Nothing was sent. Sign here: ${req.sign_url}`);
		}
	}

	const sell = preview.kind === 'sell';
	const amount = sell ? (Number(p.token_pct) >= 100 ? 'max' : p.token_amount) : p.sol_amount;
	let input;
	try {
		input = parseTradeInput({
			side: sell ? 'sell' : 'buy',
			mint: p.mint,
			amount,
			slippageBps: p.slippage_bps,
			network,
			idempotency_key: `gateway:${preview.id}`,
		}, getTradeLimits(agent.meta));
	} catch (e) {
		return fail(e?.code || 'validation_error', e?.message || 'That trade is not valid.');
	}
	const r = await executeAgentTrade({ id: agent.id, userId: agent.user_id, meta: agent.meta || {}, input, source: 'discretionary' });
	if (!r.ok) return fail(r.code, r.message, r.detail);
	return { ok: true, data: r.data };
}

function outcomeText(preview, result) {
	if (!result.ok) {
		const sig = result.detail?.signature;
		return `Not executed: ${result.message}${sig ? `\nSignature: ${explorerTx(sig, preview.proposal?.network)}` : ''}`;
	}
	if (preview.kind === 'limits') return 'Done. Your risk limits are updated.';
	const d = result.data;
	const what = preview.kind === 'buy'
		? `Bought with ${fmtNum(d.sol_spent)} SOL`
		: `Sold for about ${fmtNum(d.sol_received)} SOL`;
	return `${what}.\nSignature: ${explorerTx(d.signature, d.network)}${d.new_balance_sol != null ? `\nWallet now holds ${fmtNum(d.new_balance_sol)} SOL.` : ''}`;
}

/**
 * Handle one Approve or Cancel press.
 * @param {{ gw:object, event:object, link:object|null }} ctx
 */
export async function handleAction({ gw, event, link }) {
	const { verb, previewId } = event.action;
	const preview = await getPreview(previewId);
	if (!preview || !link || preview.link_id !== link.id) {
		return gw.ackAction(event, 'This preview is no longer valid.');
	}
	if (String(event.userId) !== String(link.platform_user_id)) {
		return gw.ackAction(event, 'Only the account owner paired to this chat can use these buttons.');
	}
	const ref = preview.message_ref || event.messageRef || null;
	const base = previewText(preview.proposal);
	// A channel that can edit rewrites the preview in place and drops its
	// buttons. One that cannot (SMS, Signal, email: approved by reply code)
	// gets the outcome as a new message, and skips the transient acks that
	// would otherwise arrive as a second, redundant text.
	const editable = gw.canEdit !== false;
	const settle = async (line) => {
		if (!editable) return gw.sendText(event.chatId, line).catch(() => {});
		if (ref) await gw.editMessage(ref, `${base}\n\n${line}`, { choices: [] }).catch(() => {});
	};
	const ackThenSettle = (text) => (editable ? gw.ackAction(event, text) : null);

	if (verb === 'cancel') {
		const done = await cancelPreview(preview.id);
		if (done) await ackThenSettle('Cancelled');
		else await gw.ackAction(event, `Already ${preview.status}`);
		if (done) {
			await settle('Cancelled. Nothing was sent.');
			await appendThreadMessage({ agentId: preview.agent_id, userId: preview.user_id, role: 'assistant', content: `Cancelled the ${preview.kind} preview. Nothing was sent.`, channel: event.platform }).catch(() => {});
		}
		return;
	}

	if (preview.status !== 'pending') return gw.ackAction(event, `Already ${preview.status}.`);
	if (new Date(preview.expires_at) <= new Date()) {
		await expirePreview(preview.id);
		await ackThenSettle('This preview expired.');
		return settle('Expired. Ask your agent again for a fresh quote.');
	}
	const rl = await limits.gatewayMessage(link.id);
	if (!rl.success) return gw.ackAction(event, 'Too many actions. Wait a minute and press again.');

	const claimed = await claimPreview(preview.id);
	if (!claimed) return gw.ackAction(event, 'This preview was already handled.');
	await ackThenSettle('Approved. Executing...');
	await settle('Approved. Executing...');

	let result;
	try {
		result = await executePreview(claimed, { confirm: true });
	} catch (e) {
		console.error('[gateway] preview execution crashed', e?.message);
		result = fail('internal_error', 'Something went wrong before anything was sent. Try again.');
	}
	await finishPreview(preview.id, result.ok ? 'executed' : 'failed', result.ok ? result.data : { code: result.code, message: result.message, detail: result.detail });
	const text = outcomeText(claimed, result);
	await settle(text);
	const signature = result.ok ? result.data?.signature : result.detail?.signature;
	await appendThreadMessage({
		agentId: preview.agent_id, userId: preview.user_id, role: 'assistant', content: text, channel: event.platform,
		signatures: signature ? [signature] : [],
	}).catch(() => {});
	return result;
}
