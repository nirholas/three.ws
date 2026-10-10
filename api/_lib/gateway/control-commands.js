// Two-way control from a paired chat: /approvals, /positions, /pause and /kill.
//
// These are the commands an owner reaches for away from a desk. They only ever
// run for the person a chat is paired to (the core refuses everyone else before
// a command handler is called), and they only move in the safe direction: a
// chat can stop an agent, deny a request or read its positions, but lifting a
// wallet freeze is done on the web, under Limits & Safety, so a lost or
// hijacked chat account can halt the agents and never unfreeze them.
//
//   /approvals          every pending request, each with the signed Approve and
//                       Deny buttons that approval-buttons.js draws
//   /positions [agent]  open sniper and strategy positions with live value
//   /pause [agent]      freezes one agent: outbound spend frozen, discretionary
//                       trading and its sniper switched off
//   /kill               the same for every agent on the account, plus the
//                       account-wide strategy kill switch, and every pending
//                       approval denied

import { sql } from '../db.js';
import { logAudit } from '../audit.js';
import { setSpendLimits, setTradeLimits } from '../agent-trade-guards.js';
import { fetchTraderPositions } from '../trader-stats.js';
import { bulkDeny, expireStale } from '../approvals.js';
import { listAccountAgents, pickAgent, resolveChatAgent } from './agents.js';
import { sendApprovalToChat } from './approval-buttons.js';
import { appOrigin, agentWalletUrl, fmtNum, short } from './format.js';

const OPEN_STATUSES = new Set(['open', 'opening', 'closing']);
const MAX_APPROVALS_SHOWN = 5;
const MAX_POSITIONS_SHOWN = 10;

export const CONTROL_COMMANDS = [
	{ name: 'approvals', description: 'Requests waiting for your yes, with Approve and Deny' },
	{ name: 'positions', description: 'Open positions and their live value', arg: 'agent' },
	{ name: 'pause', description: 'Stop one agent from trading or spending', arg: 'agent' },
	{ name: 'kill', description: 'Stop every agent and deny every pending request' },
];

/** The agent a command is about: the named one, else the chat's own. */
async function targetAgent({ gw, event, link }) {
	const arg = String(event.args || '').trim();
	const agents = await listAccountAgents(link.user_id);
	if (!agents.length) {
		await gw.sendText(event.chatId, `Your account has no agents yet. Create one at ${appOrigin()}/create.`);
		return null;
	}
	if (arg) {
		const pick = pickAgent(agents, arg);
		if (pick) return pick;
		await gw.sendText(event.chatId, `No agent matches "${arg.slice(0, 60)}". Your agents:\n${agents.map((a, i) => `${i + 1}. ${a.name || 'Untitled agent'}`).join('\n')}`);
		return null;
	}
	const agent = await resolveChatAgent(link);
	if (agent) return agent;
	await gw.sendText(event.chatId, `Which agent? Send /${event.command} <number or name>:\n${agents.map((a, i) => `${i + 1}. ${a.name || 'Untitled agent'}`).join('\n')}`);
	return null;
}

async function pendingRequests(userId) {
	await expireStale(userId);
	return sql`
		SELECT id FROM approval_requests
		WHERE user_id = ${userId} AND status = 'pending' AND expires_at > now()
		ORDER BY expires_at ASC, id ASC
		LIMIT ${MAX_APPROVALS_SHOWN + 1}`;
}

export async function cmdApprovals({ gw, event, link }) {
	const rows = await pendingRequests(link.user_id);
	if (!rows.length) {
		return gw.sendText(event.chatId, `Nothing is waiting for your approval. New requests arrive here as they happen.\nHistory and auto-approve rules: ${appOrigin()}/approvals`);
	}
	const shown = rows.slice(0, MAX_APPROVALS_SHOWN);
	const more = rows.length > MAX_APPROVALS_SHOWN;
	await gw.sendText(event.chatId, `${shown.length}${more ? '+' : ''} pending request${shown.length === 1 ? '' : 's'}, soonest deadline first.${more ? `\nThe rest are at ${appOrigin()}/approvals` : ''}`);
	for (const row of shown) await sendApprovalToChat({ gw, link, approvalId: row.id, chatId: event.chatId });
}

function positionLine(p) {
	const entry = Number(p.entry_quote_lamports) / 1e9;
	const value = p.last_value_lamports != null ? Number(p.last_value_lamports) / 1e9 : null;
	const pnl = value != null && entry > 0 ? ((value - entry) / entry) * 100 : null;
	const label = p.symbol || p.name || short(p.mint);
	const state = p.status === 'open' ? '' : ` (${p.status})`;
	const worth = value != null ? `, now ${fmtNum(value, 4)} SOL${pnl != null ? ` (${pnl >= 0 ? '+' : ''}${fmtNum(pnl, 1)}%)` : ''}` : '';
	return `- ${label}${state}: in ${fmtNum(entry, 4)} SOL${worth}`;
}

export async function cmdPositions({ gw, event, link }) {
	const agent = await targetAgent({ gw, event, link });
	if (!agent) return;
	const all = await fetchTraderPositions({ agentId: agent.id, network: 'mainnet', window: '24h' });
	const open = all.filter((p) => OPEN_STATUSES.has(p.status));
	if (!open.length) {
		return gw.sendText(event.chatId, `${agent.name || 'Your agent'} has no open positions on Solana mainnet.\n${agentWalletUrl(agent.id, 'portfolio')}`);
	}
	const entry = open.reduce((s, p) => s + Number(p.entry_quote_lamports || 0), 0) / 1e9;
	const valued = open.filter((p) => p.last_value_lamports != null);
	const value = valued.reduce((s, p) => s + Number(p.last_value_lamports), 0) / 1e9;
	const lines = [
		`${agent.name || 'Your agent'}: ${open.length} open position${open.length === 1 ? '' : 's'} (Solana mainnet)`,
		...open.slice(0, MAX_POSITIONS_SHOWN).map(positionLine),
	];
	if (open.length > MAX_POSITIONS_SHOWN) lines.push(`and ${open.length - MAX_POSITIONS_SHOWN} more`);
	lines.push('', `Total in: ${fmtNum(entry, 4)} SOL${valued.length ? `, marked at ${fmtNum(value, 4)} SOL${valued.length < open.length ? ` (${valued.length} of ${open.length} priced)` : ''}` : ''}`);
	lines.push(agentWalletUrl(agent.id, 'portfolio'));
	return gw.sendText(event.chatId, lines.join('\n'));
}

/** Freeze one agent. Every writer is the one the web's Limits & Safety tab uses. */
async function freezeAgent(agent, userId) {
	await setSpendLimits(agent.id, userId, { frozen: true });
	await setTradeLimits(agent.id, userId, { kill_switch: true });
	// The sniper reads its own per-strategy switch; agents without one have no row.
	const snipers = await sql`
		UPDATE agent_sniper_strategies SET kill_switch = true, updated_at = now()
		WHERE agent_id = ${agent.id} AND kill_switch = false
		RETURNING network`.catch(() => []);
	return { snipers: snipers.length };
}

function resumeHint(agentId) {
	return `To resume, open ${agentWalletUrl(agentId, 'withdraw')} and lift the freeze under Limits & Safety. The freeze can only be lifted on the web, so this chat can stop your agents but never unfreeze them.`;
}

export async function cmdPause({ gw, event, link }) {
	const agent = await targetAgent({ gw, event, link });
	if (!agent) return;
	const { snipers } = await freezeAgent(agent, link.user_id);
	logAudit({ userId: link.user_id, action: 'gateway.pause_agent', resourceId: agent.id, meta: { platform: event.platform, link_id: link.id, snipers } });
	return gw.sendText(event.chatId, [
		`Paused ${agent.name || 'your agent'}.`,
		'- Outbound spending is frozen (you can still withdraw).',
		'- Discretionary trading is off.',
		snipers ? '- Its sniper is switched off.' : null,
		'Requests already waiting for approval stay in /approvals; deny them there or let them expire.',
		'',
		resumeHint(agent.id),
	].filter(Boolean).join('\n'));
}

export async function cmdKill({ gw, event, link }) {
	const agents = await listAccountAgents(link.user_id);
	let snipers = 0;
	const failed = [];
	for (const agent of agents) {
		try {
			snipers += (await freezeAgent(agent, link.user_id)).snipers;
		} catch (e) {
			failed.push(agent.name || agent.id);
			console.error('[gateway] kill could not freeze an agent', { agentId: agent.id, error: e?.message });
		}
	}
	await sql`
		INSERT INTO strategy_kill_switch (owner_id, engaged, engaged_at, updated_at)
		VALUES (${link.user_id}, true, now(), now())
		ON CONFLICT (owner_id) DO UPDATE SET engaged = true, engaged_at = now(), updated_at = now()`;
	const pending = await sql`SELECT id FROM approval_requests WHERE user_id = ${link.user_id} AND status = 'pending'`;
	const via = ['telegram', 'discord'].includes(event.platform) ? event.platform : 'web';
	const { denied } = pending.length ? await bulkDeny(link.user_id, pending.map((r) => r.id), { via }) : { denied: [] };
	logAudit({
		userId: link.user_id,
		action: 'gateway.kill_all',
		meta: { platform: event.platform, link_id: link.id, agents: agents.length, failed: failed.length, snipers, denied: denied.length },
	});
	const lines = [
		`Kill switch engaged on ${agents.length} agent${agents.length === 1 ? '' : 's'}.`,
		'- Outbound spending frozen on every agent (you can still withdraw).',
		'- Discretionary trading off, account-wide strategy kill switch on.',
		snipers ? `- ${snipers} sniper${snipers === 1 ? '' : 's'} switched off.` : null,
		`- ${denied.length} pending approval${denied.length === 1 ? '' : 's'} denied.`,
		failed.length ? `Could not freeze: ${failed.join(', ')}. Try /kill again, or freeze them on the web.` : null,
		'',
		`To resume, open each agent's wallet (Withdraw, then Limits & Safety) and lift the freeze, and switch strategies back on from the Strategies card on the agent's page. Your agents: ${appOrigin()}/dashboard. The freeze can only be lifted on the web, so this chat can stop your agents but never unfreeze them.`,
	];
	return gw.sendText(event.chatId, lines.filter((l) => l !== null).join('\n'));
}

export const CONTROL_COMMAND_HANDLERS = {
	approvals: cmdApprovals,
	positions: cmdPositions,
	pause: cmdPause,
	kill: cmdKill,
};
