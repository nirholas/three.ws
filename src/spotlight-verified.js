/**
 * "Verified results" for Agent Spotlight entries, shared by /spotlight/:id and
 * /stories.
 *
 * Everything drawn here comes from `entry.verified`, which the server computes
 * from tables the builder cannot type into (api/_lib/spotlight-metrics.js):
 * coins from pump.fun launch records, service income from settled payments and
 * completed hires, creator fees from the agent earnings read model. Each figure
 * carries the link a reader can check it against. A metric that is not measured
 * on this deployment says so; it never renders as a zero.
 */

import { el } from './spotlight-shared.js';

const fmtUsd = (n) =>
	Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const fmtSol = (n) => `${Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 })} SOL`;

const shortMint = (m) => (m && m.length > 10 ? `${m.slice(0, 4)}…${m.slice(-4)}` : m || '');

function plural(n, one, many) {
	return `${Number(n).toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

function metric(label, value, detail, { muted = false } = {}) {
	return el('div', { class: `sp-vr-metric${muted ? ' is-muted' : ''}` }, [
		el('dt', { class: 'sp-vr-label', text: label }),
		el('dd', { class: 'sp-vr-value', text: value }),
		detail ? el('dd', { class: 'sp-vr-detail' }, detail) : null,
	]);
}

function sourceLink(href, text) {
	return el('a', { class: 'sp-vr-src', href, target: href.startsWith('http') ? '_blank' : null, rel: href.startsWith('http') ? 'noopener' : null, text });
}

function coinsMetric(v) {
	const n = v.coins.count;
	return metric(
		'Coins launched',
		n.toLocaleString('en-US'),
		n ? [document.createTextNode('pump.fun launch records')] : [document.createTextNode('None launched yet')],
	);
}

function creatorFeesMetric(v) {
	const f = v.creator_fees;
	if (!f.available) {
		return metric('Creator fees', 'Not measured yet', [document.createTextNode('Earnings tracking is not live here yet')], {
			muted: true,
		});
	}
	const detail = [
		f.usd != null ? document.createTextNode(`${fmtUsd(f.usd)} · `) : null,
		sourceLink(f.source_url, 'Earnings record'),
	];
	return metric('Creator fees', fmtSol(f.sol), detail);
}

function serviceIncomeMetric(v, { earningsLive }) {
	const s = v.service_income;
	const parts = [];
	if (s.skill_sales_count) parts.push(plural(s.skill_sales_count, 'skill sale', 'skill sales'));
	if (s.hires_count) parts.push(plural(s.hires_count, 'hire', 'hires'));
	const detail = [document.createTextNode(parts.length ? parts.join(' · ') : 'x402 sales and hires')];
	if (earningsLive) detail.push(document.createTextNode(' · '), sourceLink(s.source_url, 'Earnings record'));
	return metric('Service income', fmtUsd(s.usd), detail);
}

function coinList(v, { limit }) {
	const items = v.coins.items.slice(0, limit);
	if (!items.length) return null;
	const more = v.coins.count - items.length;
	return el('ul', { class: 'sp-vr-coins', 'aria-label': 'Coins this agent launched' }, [
		...items.map((c) =>
			el('li', { class: 'sp-vr-coin' }, [
				el('span', { class: 'sp-vr-coin-name' }, [
					el('strong', { text: c.symbol ? `$${c.symbol}` : c.name || 'Unnamed coin' }),
					c.symbol && c.name ? el('span', { text: c.name }) : null,
				]),
				el('code', { class: 'sp-vr-mint', title: c.mint, text: shortMint(c.mint) }),
				el('span', { class: 'sp-vr-coin-links' }, [
					el('a', { href: c.launch_url, text: 'Launch page', 'aria-label': `Launch page for ${c.symbol || c.name || c.mint}` }),
					el('a', {
						href: c.solscan_url,
						target: '_blank',
						rel: 'noopener',
						text: 'Solscan ↗',
						'aria-label': `${c.symbol || c.name || c.mint} on Solscan (opens in a new tab)`,
					}),
				]),
			]),
		),
		more > 0 ? el('li', { class: 'sp-vr-more', text: `and ${plural(more, 'more coin', 'more coins')}` }) : null,
	]);
}

/**
 * The full block for an entry page. `entry.verified` null means the metrics
 * read failed server-side: say so instead of hiding the section.
 */
export function verifiedBlock(entry, { coinLimit = 6 } = {}) {
	const v = entry.verified;
	const head = el('div', { class: 'sp-vr-head' }, [
		el('h2', { class: 'sp-vr-title', id: 'sp-vr-title', text: 'Verified results' }),
		el('p', {
			class: 'sp-vr-note',
			text: 'Computed by three.ws from launch records, settled payments and on-chain fees. The builder cannot edit these.',
		}),
	]);
	if (!v) {
		return el('section', { class: 'sp-vr', 'aria-labelledby': 'sp-vr-title' }, [
			head,
			el('p', { class: 'sp-vr-unavailable', role: 'status', text: 'Verified results could not be read right now. Reload in a moment.' }),
		]);
	}
	const earningsLive = v.live.includes('creator_fees');
	const activity = [];
	if (entry.agent.chat_count > 0) activity.push(plural(entry.agent.chat_count, 'conversation', 'conversations'));
	if (entry.agent.action_count > 0) activity.push(plural(entry.agent.action_count, 'logged action', 'logged actions'));
	return el('section', { class: 'sp-vr', 'aria-labelledby': 'sp-vr-title' }, [
		head,
		el('dl', { class: 'sp-vr-grid' }, [coinsMetric(v), creatorFeesMetric(v), serviceIncomeMetric(v, { earningsLive })]),
		coinList(v, { limit: coinLimit }),
		activity.length ? el('p', { class: 'sp-vr-activity', text: `Activity: ${activity.join(' · ')}.` }) : null,
	]);
}

/** Compact figures for a /stories card: only the metrics that have a result. */
export function verifiedSummary(entry) {
	const v = entry.verified;
	const chips = [];
	if (v.coins.count) chips.push(['Coins launched', v.coins.count.toLocaleString('en-US')]);
	if (v.creator_fees.available && Number(v.creator_fees.sol) > 0) chips.push(['Creator fees', fmtSol(v.creator_fees.sol)]);
	if (v.service_income.usd > 0) chips.push(['Service income', fmtUsd(v.service_income.usd)]);
	return el('dl', { class: 'sp-vr-grid sp-vr-grid-compact' }, [
		...chips.map(([k, val]) => metric(k, val, null)),
	]);
}

export { coinList as verifiedCoinList };
