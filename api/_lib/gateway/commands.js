// Commands shared by every chat gateway: /balance on Telegram, WhatsApp, Signal
// and SMS, /balance or /three balance on Discord, /three balance on Slack. Each
// reads the same data the web shows: the wallet card's balance, the Portfolio
// tab, the agent's runs and its launch history.

import { sql } from '../db.js';
import { readAgentSolBalance } from '../../agents/solana-wallet.js';
import { lamportsToUsd, listCustodyEvents } from '../agent-trade-guards.js';
import { getPortfolio } from '../portfolio.js';
import { queryAgentLaunches } from '../pump-agent-launches.js';
import { listAccountAgents, pickAgent, resolveChatAgent } from './agents.js';
import { revokeLink, resetLinkContext, setLinkDefaultAgent, setLinkVoiceReplies } from './store.js';
import { voiceRepliesAvailable } from './voice.js';
import { appOrigin, agentWalletUrl, explorerTx, fmtNum, fmtUsd, short } from './format.js';

export const COMMANDS = [
	{ name: 'balance', description: "Your agent wallet's SOL balance" },
	{ name: 'portfolio', description: 'Net worth and top holdings' },
	{ name: 'runs', description: 'Recent agent runs and trades' },
	{ name: 'launches', description: 'Coins your agent launched' },
	{ name: 'agents', description: 'List your agents' },
	{ name: 'use', description: 'Pick the agent this chat talks to', arg: 'agent' },
	{ name: 'new', description: 'Start a fresh conversation thread' },
	{ name: 'voice', description: 'Turn spoken replies on or off', arg: 'on|off' },
	{ name: 'unlink', description: 'Disconnect this chat from your account' },
	{ name: 'link', description: 'Pair this chat with your three.ws account', arg: 'code' },
	{ name: 'help', description: 'What this bot can do' },
];

/**
 * @param {{ buttons?:boolean, prefix?:string }} [opts]
 *   buttons  false on channels approved by reply code (SMS, Signal, email)
 *   prefix   how a command is typed there: '/' everywhere except Slack ('/three ')
 */
export function helpText({ buttons = true, prefix = '/' } = {}) {
	const approval = buttons
		? 'Trades never run from text alone. When your agent prepares one you get a preview with Approve and Cancel buttons; only Approve executes it, and a preview expires after ten minutes.'
		: 'Trades never run from text alone. When your agent prepares one you get a preview ending with a six-digit code; only a reply of APPROVE and that exact code executes it, from this chat, within ten minutes.';
	return [
		'Talk to your three.ws agent here. Just write, send a voice note, or send a photo.',
		'',
		...COMMANDS.filter((c) => c.name !== 'link').map((c) => `${prefix}${c.name}${c.arg ? ` <${c.arg}>` : ''}: ${c.description}`),
		'',
		approval,
		`Manage paired chats: ${appOrigin()}/settings/connections`,
	].join('\n');
}

async function needAgent(link, gw, chatId) {
	const agent = await resolveChatAgent(link);
	if (agent) return agent;
	const agents = await listAccountAgents(link.user_id);
	if (!agents.length) {
		await gw.sendText(chatId, `Your account has no agents yet. Create one at ${appOrigin()}/create, then come back and say hi.`);
	} else {
		await gw.sendText(chatId, `Pick which agent this chat talks to:\n${agentList(agents, null)}\n\nSend /use <number or name>.`);
	}
	return null;
}

function agentList(agents, currentId) {
	return agents.map((a, i) => `${i + 1}. ${a.name || 'Untitled agent'}${a.id === currentId ? ' (current)' : ''}`).join('\n');
}

export async function cmdAgents({ gw, event, link }) {
	const agents = await listAccountAgents(link.user_id);
	if (!agents.length) return gw.sendText(event.chatId, `Your account has no agents yet. Create one at ${appOrigin()}/create.`);
	const current = await resolveChatAgent(link);
	return gw.sendText(event.chatId, `Your agents:\n${agentList(agents, current?.id)}\n\nSend /use <number or name> to switch.`);
}

export async function cmdUse({ gw, event, link }) {
	const agents = await listAccountAgents(link.user_id);
	if (!agents.length) return gw.sendText(event.chatId, `Your account has no agents yet. Create one at ${appOrigin()}/create.`);
	const pick = pickAgent(agents, event.args);
	if (!pick) return gw.sendText(event.chatId, `No agent matches "${String(event.args || '').slice(0, 60)}". Your agents:\n${agentList(agents, link.default_agent_id)}`);
	await setLinkDefaultAgent(link.id, pick.id);
	return gw.sendText(event.chatId, `This chat now talks to ${pick.name || 'your agent'}.`);
}

export async function cmdUnlink({ gw, event, link }) {
	await revokeLink(link.id, link.user_id);
	return gw.sendText(event.chatId, 'Unlinked. This chat no longer talks to your three.ws account, and any open trade previews were cancelled. Send /start to pair again.');
}

export async function cmdNew({ gw, event, link }) {
	await resetLinkContext(link.id);
	return gw.sendText(event.chatId, 'Started a fresh thread. Your agent will not see earlier messages here; the full history stays on the web.');
}

export async function cmdVoice({ gw, event, link }) {
	const arg = String(event.args || '').trim().toLowerCase();
	if (typeof gw.sendVoice !== 'function') return gw.sendText(event.chatId, 'This channel cannot play voice notes, so spoken replies are not available here.');
	if (!['on', 'off'].includes(arg)) {
		return gw.sendText(event.chatId, `Spoken replies are ${link.voice_replies ? 'on' : 'off'} for this chat. Send /voice on or /voice off to change it.`);
	}
	if (arg === 'on' && !voiceRepliesAvailable()) return gw.sendText(event.chatId, 'Speech synthesis is not available right now, so spoken replies cannot be turned on. Try again later.');
	await setLinkVoiceReplies(link.id, link.user_id, arg === 'on');
	return gw.sendText(event.chatId, arg === 'on'
		? 'Spoken replies are on. Every answer arrives as text, then as a voice note.'
		: 'Spoken replies are off. Answers arrive as text only.');
}

export async function cmdBalance({ gw, event, link }) {
	const agent = await needAgent(link, gw, event.chatId);
	if (!agent) return;
	const address = agent.meta?.solana_address;
	if (!address) return gw.sendText(event.chatId, `${agent.name} has no wallet yet. Open ${agentWalletUrl(agent.id)} to create it.`);
	const { lamports, error } = await readAgentSolBalance(address, 'mainnet');
	if (lamports == null) {
		const why = error === 'rpc_rate_limited' ? 'the Solana RPC is rate limiting right now' : 'the Solana RPC did not answer';
		return gw.sendText(event.chatId, `Balance unavailable: ${why}. Try again in a minute.`);
	}
	const usd = await lamportsToUsd(lamports).catch(() => null);
	return gw.sendText(event.chatId, [
		`${agent.name} wallet (Solana mainnet)`,
		`${fmtNum(lamports / 1e9, 6)} SOL${usd != null ? ` (about ${fmtUsd(usd)})` : ''}`,
		`Address: ${address}`,
		agentWalletUrl(agent.id),
	].join('\n'));
}

export async function cmdPortfolio({ gw, event, link }) {
	const agent = await needAgent(link, gw, event.chatId);
	if (!agent) return;
	if (!agent.meta?.solana_address) return gw.sendText(event.chatId, `${agent.name} has no wallet yet. Open ${agentWalletUrl(agent.id)} to create it.`);
	const p = await getPortfolio({ agentId: agent.id, network: 'mainnet' });
	if (!p) return gw.sendText(event.chatId, 'Portfolio unavailable right now. Try again in a minute.');
	const top = (p.holdings || []).slice(0, 6).map((h) => {
		const label = h.isNative ? 'SOL' : (h.symbol || short(h.mint));
		const value = h.usd_value != null ? ` (${fmtUsd(h.usd_value)})` : '';
		const pnl = h.unrealized_pct != null ? `, ${h.unrealized_pct >= 0 ? '+' : ''}${fmtNum(h.unrealized_pct, 1)}%` : '';
		return `- ${label}: ${fmtNum(h.amount, 4)}${value}${pnl}`;
	});
	return gw.sendText(event.chatId, [
		`${agent.name} portfolio`,
		`Net worth: ${fmtNum(p.net_worth?.sol, 4)} SOL${p.net_worth?.usd != null ? ` (${fmtUsd(p.net_worth.usd)})` : ''}`,
		top.length ? top.join('\n') : 'No holdings yet.',
		(p.risk_flags || []).length ? `Flags: ${p.risk_flags.map((f) => f.label || f.code || f).join(', ')}` : null,
		agentWalletUrl(agent.id, 'portfolio'),
	].filter(Boolean).join('\n'));
}

async function recentRuns(agentId) {
	// agent_runs arrives with the v1 Agents API; until that migration is applied
	// the section is simply absent rather than an error.
	const [t] = await sql`SELECT to_regclass('public.agent_runs') AS t`;
	if (!t?.t) return [];
	return sql`
		SELECT id, goal, status, step_count, created_at FROM agent_runs
		WHERE agent_id = ${agentId} ORDER BY created_at DESC LIMIT 5`;
}

export async function cmdRuns({ gw, event, link }) {
	const agent = await needAgent(link, gw, event.chatId);
	if (!agent) return;
	const [runs, trades] = await Promise.all([
		recentRuns(agent.id),
		listCustodyEvents(agent.id, { limit: 5, category: 'trade', network: 'mainnet' }).catch(() => []),
	]);
	const lines = [`${agent.name}: recent activity`];
	if (runs.length) {
		lines.push('', 'Runs:');
		for (const r of runs) lines.push(`- ${r.status}: ${String(r.goal).slice(0, 80)} (${r.step_count} steps)`);
	}
	const tradeRows = trades;
	if (tradeRows.length) {
		lines.push('', 'Trades:');
		for (const e of tradeRows) {
			const side = e.meta?.side || e.reason || 'trade';
			const sig = e.signature ? ` ${explorerTx(e.signature, e.network)}` : '';
			lines.push(`- ${side} ${e.meta?.mint ? short(e.meta.mint) : e.asset}: ${e.status}${sig}`);
		}
	}
	if (!runs.length && !tradeRows.length) lines.push('No runs or trades yet. Ask your agent to do something, or start a run from the web.');
	lines.push('', agentWalletUrl(agent.id, 'trade'));
	return gw.sendText(event.chatId, lines.join('\n'));
}

export async function cmdLaunches({ gw, event, link }) {
	const agent = await needAgent(link, gw, event.chatId);
	if (!agent) return;
	const { launches } = await queryAgentLaunches({ agentId: agent.id, limit: 5 });
	if (!launches?.length) return gw.sendText(event.chatId, `${agent.name} has not launched a coin yet.`);
	const lines = [`${agent.name}: launches`];
	for (const l of launches) lines.push(`- ${l.name || 'Untitled'}${l.symbol ? ` (${l.symbol})` : ''}: ${appOrigin()}/launches/${l.mint}`);
	return gw.sendText(event.chatId, lines.join('\n'));
}

export const COMMAND_HANDLERS = {
	agents: cmdAgents,
	use: cmdUse,
	unlink: cmdUnlink,
	new: cmdNew,
	voice: cmdVoice,
	balance: cmdBalance,
	portfolio: cmdPortfolio,
	runs: cmdRuns,
	launches: cmdLaunches,
};
