// Plain-text rendering for chat replies. Every platform gets the same text:
// Telegram is sent without a parse mode (nothing to escape, links auto-link),
// Discord, Slack, WhatsApp and Signal render it as-is, and SMS and email carry
// it verbatim, so one formatter serves them all.

import { env } from '../env.js';

export const PLATFORM_LABEL = {
	telegram: 'Telegram', discord: 'Discord', slack: 'Slack', whatsapp: 'WhatsApp', signal: 'Signal',
	sms: 'SMS', email: 'email', web: 'the web', api: 'the API',
};
// Per-message ceilings. SMS is split by the carrier past 160 characters, so a
// reply is kept to a few segments; email has no practical ceiling.
export const MAX_TEXT = { telegram: 4000, discord: 1900, slack: 3500, whatsapp: 4000, signal: 4000, sms: 600, email: 20000 };

export function appOrigin() {
	return env.APP_ORIGIN || 'https://three.ws';
}

export function short(s, head = 4, tail = 4) {
	const v = String(s || '');
	return v.length <= head + tail + 1 ? v : `${v.slice(0, head)}...${v.slice(-tail)}`;
}

export function fmtNum(n, max = 4) {
	if (n == null || !Number.isFinite(Number(n))) return 'n/a';
	return Number(n).toLocaleString('en-US', { maximumFractionDigits: max });
}

export function fmtUsd(n) {
	if (n == null || !Number.isFinite(Number(n))) return null;
	return `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function explorerTx(signature, network = 'mainnet') {
	return network === 'devnet'
		? `https://explorer.solana.com/tx/${signature}?cluster=devnet`
		: `https://solscan.io/tx/${signature}`;
}

export function agentWalletUrl(agentId, tab = '') {
	return `${appOrigin()}/agents/${agentId}/wallet${tab ? `#${tab}` : ''}`;
}

/**
 * Split text into platform-sized chunks on paragraph, then line, then word
 * boundaries, so a long reply arrives as several readable messages.
 */
export function chunkText(text, limit) {
	const out = [];
	let rest = String(text || '').trim();
	while (rest.length > limit) {
		let cut = rest.lastIndexOf('\n\n', limit);
		if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit);
		if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
		if (cut < limit * 0.5) cut = limit;
		out.push(rest.slice(0, cut).trim());
		rest = rest.slice(cut).trim();
	}
	if (rest) out.push(rest);
	return out;
}

/** The agent's markdown, flattened for a chat that renders plain text. */
export function plainText(md) {
	return String(md || '')
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/__(.+?)__/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1: $2');
}

/** A proposal card as chat text. */
export function describeProposal(p) {
	const coin = p.coin?.symbol ? `${p.coin.symbol} (${short(p.mint)})` : short(p.mint, 6, 6);
	const lines = [];
	if (p.kind === 'buy') {
		lines.push(`Buy preview on ${p.network}`);
		lines.push(`Spend: ${fmtNum(p.sol_amount)} SOL`);
		lines.push(`Token: ${coin}`);
		if (p.quote && !p.quote.error) {
			lines.push(`Expected: ${fmtNum(p.quote.expected_out, 2)} tokens (at least ${fmtNum(p.quote.min_received, 2)})`);
			lines.push(`Price impact: ${p.quote.price_impact_pct != null ? `${fmtNum(p.quote.price_impact_pct, 2)}%` : 'n/a'}`);
		} else {
			lines.push(`Quote: unavailable (${p.quote?.error || 'no market'})`);
		}
		if (p.safety) lines.push(`Firewall: ${String(p.safety.verdict).toUpperCase()} ${p.safety.score}/100${p.safety.reasons?.[0] ? `, ${p.safety.reasons[0]}` : ''}`);
		lines.push(`Slippage: ${fmtNum(p.slippage_bps / 100, 2)}%`);
	} else if (p.kind === 'sell') {
		lines.push(`Sell preview on ${p.network}`);
		lines.push(`Sell: ${fmtNum(p.token_amount, 4)} tokens${p.token_pct ? ` (${fmtNum(p.token_pct, 2)}% of holding)` : ''}`);
		lines.push(`Token: ${coin}`);
		if (p.quote && !p.quote.error) {
			lines.push(`Expected: ${fmtNum(p.quote.expected_out)} SOL (at least ${fmtNum(p.quote.min_received)})`);
			lines.push(`Price impact: ${p.quote.price_impact_pct != null ? `${fmtNum(p.quote.price_impact_pct, 2)}%` : 'n/a'}`);
		} else {
			lines.push(`Quote: unavailable (${p.quote?.error || 'no market'})`);
		}
		lines.push(`Slippage: ${fmtNum(p.slippage_bps / 100, 2)}%`);
	} else if (p.kind === 'limits') {
		lines.push('Risk limit change');
		for (const [k, v] of Object.entries(p.changes || {})) {
			const label = { per_trade_sol: 'Per-trade cap', daily_budget_sol: 'Daily budget', max_price_impact_pct: 'Max price impact', kill_switch: 'Kill switch' }[k] || k;
			const unit = k.endsWith('_sol') ? ' SOL' : k.endsWith('_pct') ? '%' : '';
			const shown = typeof v === 'boolean' ? (v ? 'ON (trading paused)' : 'off') : `${fmtNum(v)}${unit}`;
			lines.push(`${label}: ${shown}`);
		}
	}
	if (p.rationale) lines.push(`Why: ${p.rationale}`);
	return lines.join('\n');
}
