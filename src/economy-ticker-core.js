// Pure, DOM-free helpers for the home-page Live Economy ticker — the compact,
// embeddable sibling of the Galaxy Money-Cam. Both read the same real feed
// (GET /api/galaxy/flows): every row is one on-chain, explorer-verifiable money
// movement that touches a public three.ws agent. There are NO synthetic flows —
// a quiet market shows an honest empty state, never invented activity.
//
// Kept side-effect-free (no fetch, no document, no Buffer) so the formatting and
// "hottest earner" derivation are unit-testable without a browser or a database.

// Per-kind accent colors — identical palette to the Money-Cam (src/galaxy.js)
// so the home ticker and the 3D map read as one feature. Payments use the
// wallet-violet family accent.
import { shortAddress as shortAddr } from './shared/address.js';

export const KIND_COLORS = {
	tip: '#4ade80',
	trade: '#4589ff',
	snipe: '#fbbf24',
	payment: '#c4b5fd',
	launch: '#ffd27a',
};

export const KIND_LABEL = {
	tip: 'Tip',
	trade: 'Trade',
	snipe: 'Snipe',
	payment: 'Pay',
	launch: 'Launch',
};

export function formatUsd(v) {
	const n = Number(v) || 0;
	if (n <= 0) return '';
	if (n < 1000) return `$${n.toFixed(n < 1 ? 2 : 0)}`;
	if (n < 1_000_000) return `$${Math.round(n).toLocaleString()}`;
	return `$${(n / 1_000_000).toFixed(2)}M`;
}

export { shortAddr };

// Compact relative age. `now` is injectable so tests are deterministic.
export function relTime(iso, now = Date.now()) {
	const ms = now - new Date(iso).getTime();
	if (!Number.isFinite(ms)) return '';
	const s = Math.max(0, Math.round(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h}h`;
	return `${Math.round(h / 24)}d`;
}

// A short, human, screen-reader-friendly sentence for one flow. Never invents a
// counterparty — a one-sided flow reads against the market / a bare wallet.
export function flowHeadline(f) {
	const actor = f.actor?.name || 'An agent';
	if (f.kind === 'launch') return `${actor} launched $${f.symbol || f.coin_name || 'a coin'}`;
	if (f.kind === 'tip') {
		const from = f.from?.name || shortAddr(f.from?.wallet) || 'someone';
		return `${from} tipped ${actor}`;
	}
	const to = f.to?.name || shortAddr(f.to?.wallet) || 'the market';
	if (f.kind === 'payment') return `${actor} paid ${to}`;
	if (f.kind === 'snipe') return `${actor} sniped ${to}`;
	return `${actor} traded with ${to}`;
}

// The best click-through for a row: the agent's own profile (discovery) when we
// have one, else the real explorer link for the transaction, else the galaxy.
// Every destination is real — we never point a row at a dead end.
export function rowHref(f) {
	if (f.actor?.id) return `/agents/${f.actor.id}`;
	if (f.kind === 'launch' && f.mint_explorer) return f.mint_explorer;
	if (f.explorer) return f.explorer;
	return '/galaxy';
}

// The real explorer link for a flow's underlying transaction (or mint), or null.
export function flowExplorer(f) {
	if (f.kind === 'launch') return f.mint_explorer || null;
	return f.explorer || null;
}

// Honest window summary over exactly the flows we were handed.
export function summarizeFlows(flows) {
	const out = { count: 0, usd: 0, edges: 0, byKind: { tip: 0, trade: 0, snipe: 0, payment: 0, launch: 0 } };
	if (!Array.isArray(flows)) return out;
	for (const f of flows) {
		if (!f) continue;
		out.count++;
		if (f.usd) out.usd += Number(f.usd) || 0;
		if (f.counterparty?.id && f.actor?.id && f.counterparty.id !== f.actor.id) out.edges++;
		if (out.byKind[f.kind] != null) out.byKind[f.kind]++;
	}
	return out;
}

// The hottest EARNING agent in the window: the public agent that RECEIVED the
// most real USD (inbound tips + payments). Earnings credit the receiver (flow.to
// for inbound value), never the actor of an outbound spend — so this is honest
// "who is the crowd paying right now," a discovery hook for the home page.
// Returns the top earner { id, name, wallet, usd, count } or null when the window
// has no priced inbound value.
export function hottestEarner(flows) {
	if (!Array.isArray(flows)) return null;
	const byAgent = new Map();
	for (const f of flows) {
		if (!f) continue;
		// Inbound value lands on the receiver. Tips are direction 'in' (to = actor);
		// agent→agent payments are 'out' (to = counterparty agent). Either way the
		// USD credits whoever `to` resolves to — but only when `to` is a real agent.
		const recv = f.to;
		const usd = Number(f.usd) || 0;
		if (!recv?.id || usd <= 0) continue;
		if (f.kind !== 'tip' && f.kind !== 'payment') continue;
		const prev = byAgent.get(recv.id) || { id: recv.id, name: recv.name || 'Agent', wallet: recv.wallet || null, usd: 0, count: 0 };
		prev.usd += usd;
		prev.count++;
		byAgent.set(recv.id, prev);
	}
	let top = null;
	for (const a of byAgent.values()) {
		if (!top || a.usd > top.usd) top = a;
	}
	return top;
}
