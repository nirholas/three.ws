// agent-screen-mirror.js — live copy-trade mirror cockpit for /agent-screen.
//
// Two columns: SOURCE (a target wallet's pump.fun trades, detected live) and
// MIRROR (the agent's guarded replica of each one). A source buy lands on the
// left; the agent re-quotes, sizes per the configured rule, and lands a matching
// trade on the right — stamped with the real latency (submitted − detected) and
// the actual fill it got. Every order passes the same server-side trade firewall
// (per-trade cap, daily budget, price-impact breaker, kill switch); a rejected
// order renders as a BLOCKED row with the reason, never a silent skip.
//
// Real wiring, no mocks:
//   • Source detection → GET /api/pump/trades-stream?mint=… (PumpPortal SSE),
//     filtered to the target wallet's trades.
//   • Re-quote        → GET/POST /api/agents/:id/trade/quote (expected out,
//     price impact, guard preview).
//   • Replicate       → POST /api/agents/:id/trade (server-signed from the
//     agent's own custodial wallet, firewall-enforced).
//   • Wall frame      → POST /api/agent-screen-push (type:"trade") so the
//     /agents-live card paints the dual-column view.
//
// The owner drives the loop (their session can quote, trade, and push). A
// non-owner viewer sees the panel in a read-only armed state and watches the
// action through the pushed wall frame + activity log, exactly like the rest of
// /agent-screen.

// ── $THREE is the only coin the platform promotes. The mirror itself is generic,
// coin-agnostic plumbing: it replicates whatever mint the SOURCE trade carries at
// runtime. $THREE is simply the default mint we watch out of the box. CA below.
import { shortAddress as truncateAddr } from './shared/address.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_ROWS = 60;          // bound each column's DOM
const MAX_WATCH_MINTS = 20;   // trades-stream caps at 20 mints
const PUSH_MIN_INTERVAL_MS = 1000; // throttle wall-frame pushes

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ── pure helpers (unit-tested in tests/agent-screen-mirror.test.js) ───────────

/** Is this a usable Solana wallet / mint address? */
export function isValidAddress(addr) {
	return typeof addr === 'string' && BASE58_RE.test(addr.trim());
}

/** Short, copy-friendly label for a base58 address. */
export { truncateAddr };

/**
 * Size a mirror BUY (in SOL) from the configured rule, then clamp to the
 * per-trade cap and the minimum order. Sells mirror an exit and aren't sized
 * here. Mirrors the server copy engine's rawOrderSol semantics exactly so the
 * preview and the eventual fill agree.
 *
 * @returns {{ ok:true, order:number, raw:number } | { ok:false, reason:string, raw?:number }}
 */
export function sizeMirrorOrder(rule, {
	leaderSol = 0, balanceSol = null,
	fixedSol = 0, multiplier = 0, pctBalance = 0,
	perTxCapSol = null, minOrderSol = 0,
} = {}) {
	let raw;
	switch (rule) {
		case 'multiplier': raw = num(leaderSol) * num(multiplier); break;
		case 'pct_balance': raw = balanceSol == null ? NaN : num(balanceSol) * (num(pctBalance) / 100); break;
		case 'fixed':
		default: raw = num(fixedSol); break;
	}
	if (!Number.isFinite(raw) || raw <= 0) {
		return { ok: false, reason: rule === 'pct_balance' && balanceSol == null ? 'sizing_unavailable' : 'zero_size' };
	}
	let order = raw;
	if (perTxCapSol != null && num(perTxCapSol) > 0) order = Math.min(order, num(perTxCapSol));
	const minOrder = num(minOrderSol);
	if (minOrder > 0 && order < minOrder) return { ok: false, reason: 'below_min_order', raw };
	return { ok: true, order, raw };
}

/** Latency of a mirrored order: submitted − detected, floored at 0 (ms). */
export function computeLatency(detectedAt, submittedAt) {
	const d = Number(detectedAt), s = Number(submittedAt);
	if (!Number.isFinite(d) || !Number.isFinite(s)) return null;
	return Math.max(0, Math.round(s - d));
}

// Human label for the guard/firewall codes the quote + trade endpoints return.
const BLOCK_LABELS = {
	kill_switch: 'Trading paused',
	per_trade_cap: 'Over per-trade cap',
	daily_budget: 'Daily budget reached',
	max_positions: 'Too many open trades',
	insufficient_sol: 'Wallet underfunded',
	price_impact: 'Price impact too high',
	insufficient_token_balance: 'Agent holds none',
	spend_limit_exceeded: 'Spend limit reached',
	spend_limit: 'Spend limit reached',
	firewall_block: 'Firewall blocked',
	graduated: 'Coin graduated',
	zero_out: 'Buys zero tokens',
	sizing_unavailable: 'Sizing unavailable',
	below_min_order: 'Below minimum order',
	zero_size: 'Sizes to zero',
};

/**
 * Map a blocked quote/trade result to a { label, message } the UI renders on a
 * blocked row. Prefers the server's actionable message when present.
 */
export function mapBlockedReason(blocked) {
	const code = blocked?.code || blocked?.reason || 'blocked';
	const label = BLOCK_LABELS[code] || 'Blocked';
	const message = blocked?.message
		|| (code === 'sizing_unavailable' ? 'Set a balance source for % sizing, or switch sizing rule.'
			: code === 'below_min_order' ? 'The sized order is below your minimum — raise the multiplier or lower the minimum.'
				: code === 'zero_size' ? 'This rule sizes the order to zero — check the sizing values.'
					: `Order rejected (${code}).`);
	return { code, label, message };
}

/** Format a SOL amount compactly (trim trailing zeros). */
export function fmtSol(v, dp = 4) {
	const n = num(v);
	if (n === 0) return '0';
	const s = n.toFixed(dp).replace(/\.?0+$/, '');
	return s || '0';
}

function fmtUsd(v) {
	const n = Number(v);
	if (!Number.isFinite(n)) return null;
	if (n >= 1000) return `$${Math.round(n).toLocaleString()}`;
	return `$${n.toFixed(2)}`;
}

function explorerTx(sig) {
	return sig ? `https://solscan.io/tx/${sig}` : null;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── the panel ─────────────────────────────────────────────────────────────────

export class MirrorPanel {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.body   the panel body element to render into.
	 * @param {string} opts.agentId
	 * @param {string} [opts.agentName]
	 * @param {(msg:string)=>void} [opts.onToast]
	 */
	constructor({ body, agentId, agentName = 'Agent', onToast = () => {} }) {
		this.body = body;
		this.agentId = agentId;
		this.agentName = agentName;
		this.toast = onToast;

		this.isOwner = false;
		this.csrfToken = '';
		this.limits = null;          // server trade limits (per_trade_sol, daily_budget_sol, …)
		this.walletBalanceSol = null;
		this.network = 'mainnet';

		this.config = this.loadConfig();
		this.es = null;              // source EventSource
		this.streamState = 'idle';   // idle | connecting | live | error
		this.inFlight = new Set();   // signatures being mirrored (dedupe)
		this.seenSigs = new Set();
		this.rows = { source: [], mirror: [] };
		this.lastRelay = null;       // { latency, fill, blocked }
		this.destroyed = false;

		// offscreen canvas for the wall frame
		this.frameCanvas = document.createElement('canvas');
		this.frameCanvas.width = 640;
		this.frameCanvas.height = 360;
		this.lastPushAt = 0;
		this.pushTimer = null;

		this.renderShell();
		this.init();
	}

	// ── persistence ──────────────────────────────────────────────────────────
	get lsKey() { return `twx_mirror_cfg_${this.agentId}`; }

	loadConfig() {
		const base = {
			targetWallet: '',
			sizingRule: 'fixed',
			fixedSol: 0.05,
			multiplier: 0.25,
			pctBalance: 5,
			minOrderSol: 0.01,
			watchMints: [THREE_MINT],
			copySells: true,
		};
		try {
			const saved = JSON.parse(localStorage.getItem(this.lsKey) || '{}');
			if (saved && typeof saved === 'object') {
				for (const k of Object.keys(base)) if (k in saved) base[k] = saved[k];
			}
		} catch { /* defaults */ }
		if (!Array.isArray(base.watchMints) || !base.watchMints.length) base.watchMints = [THREE_MINT];
		base.watchMints = base.watchMints.filter(isValidAddress).slice(0, MAX_WATCH_MINTS);
		if (!['fixed', 'multiplier', 'pct_balance'].includes(base.sizingRule)) base.sizingRule = 'fixed';
		return base;
	}

	saveConfig() {
		try { localStorage.setItem(this.lsKey, JSON.stringify(this.config)); } catch { /* quota */ }
	}

	// ── boot ──────────────────────────────────────────────────────────────────
	async init() {
		// Owner probe: the trade-limits read is owner-gated, so a 200 means we can
		// drive the loop; anything else means a read-only viewer.
		try {
			const r = await fetch(`/api/agents/${encodeURIComponent(this.agentId)}/trade/limits`, { credentials: 'include' });
			if (r.ok) {
				const j = await r.json().catch(() => ({}));
				this.limits = j?.data?.limits || null;
				this.isOwner = true;
			} else {
				this.isOwner = false;
			}
		} catch { this.isOwner = false; }

		if (this.isOwner) {
			this.csrfToken = await fetch('/api/csrf-token', { credentials: 'include' })
				.then((r) => r.json()).then((j) => j.data?.token || j.token || '').catch(() => '');
		}

		if (this.destroyed) return;
		this.render();
		if (this.isOwner && isValidAddress(this.config.targetWallet)) this.arm();
	}

	// ── source stream ───────────────────────────────────────────────────────
	arm() {
		this.disarmStream();
		const mints = (this.config.watchMints || []).filter(isValidAddress).slice(0, MAX_WATCH_MINTS);
		if (!mints.length || !isValidAddress(this.config.targetWallet)) { this.render(); return; }

		this.streamState = 'connecting';
		this.render();

		const url = `/api/pump/trades-stream?mint=${encodeURIComponent(mints.join(','))}`;
		const es = new EventSource(url);
		this.es = es;

		es.addEventListener('open', () => { if (this.es === es) { this.streamState = 'live'; this.renderStatus(); } });
		es.addEventListener('trade', (e) => {
			let data; try { data = JSON.parse(e.data); } catch { return; }
			this.onSourceTrade(data);
		});
		es.addEventListener('close', () => { /* server duration limit — onerror reconnects */ });
		es.onerror = () => {
			if (this.es !== es) return;
			this.streamState = 'error';
			this.renderStatus();
			es.close();
			this.es = null;
			// trades-stream caps at 90s; reconnect transparently to keep watching.
			if (!this.destroyed && isValidAddress(this.config.targetWallet)) {
				clearTimeout(this._reconnect);
				this._reconnect = setTimeout(() => { if (!this.destroyed) this.arm(); }, 1500);
			}
		};
	}

	disarmStream() {
		clearTimeout(this._reconnect);
		if (this.es) { try { this.es.close(); } catch { /* ok */ } this.es = null; }
		this.streamState = 'idle';
	}

	onSourceTrade(data) {
		if (this.destroyed) return;
		const trader = data?.trader || null;
		if (!trader || trader !== this.config.targetWallet) return; // not our target
		const sig = data?.signature || data?.tx_signature || '';
		if (sig && this.seenSigs.has(sig)) return;
		if (sig) { this.seenSigs.add(sig); if (this.seenSigs.size > 4000) this.seenSigs.clear(); }

		const side = data?.is_buy ? 'buy' : 'sell';
		const detectedAt = Date.now();
		const source = {
			id: sig || `${detectedAt}-${Math.round(num(data?.sol_amount) * 1e6)}`,
			side, mint: data?.mint || '',
			solAmount: num(data?.sol_amount),
			tokenAmount: num(data?.token_amount),
			usd: data?.sol_value_usd ?? null,
			signature: sig, detectedAt,
		};
		this.addRow('source', source);
		this.replicate(source);
	}

	// ── re-quote + replicate ─────────────────────────────────────────────────
	async replicate(source) {
		const { mint, side, detectedAt } = source;
		if (!isValidAddress(mint)) return;
		if (source.signature) {
			if (this.inFlight.has(source.signature)) return;
			this.inFlight.add(source.signature);
		}

		try {
			if (this.config.copySells === false && side === 'sell') {
				this.addRow('mirror', { kind: 'blocked', source, ...mapBlockedReason({ code: 'sells_disabled', message: 'Sell mirroring is off for this agent.' }), latency: computeLatency(detectedAt, Date.now()) });
				return;
			}

			// Size the order. Sells mirror an exit (sell the agent's whole holding).
			let amount;
			if (side === 'buy') {
				if (this.config.sizingRule === 'pct_balance' && this.walletBalanceSol == null) {
					await this.primeBalance(mint); // learn the wallet balance once
				}
				const sized = sizeMirrorOrder(this.config.sizingRule, {
					leaderSol: source.solAmount,
					balanceSol: this.walletBalanceSol,
					fixedSol: this.config.fixedSol,
					multiplier: this.config.multiplier,
					pctBalance: this.config.pctBalance,
					perTxCapSol: this.limits?.per_trade_sol ?? null,
					minOrderSol: this.config.minOrderSol,
				});
				if (!sized.ok) {
					this.addRow('mirror', { kind: 'blocked', source, ...mapBlockedReason({ code: sized.reason }), latency: computeLatency(detectedAt, Date.now()) });
					this.narrate(`Mirror skipped ${truncateAddr(mint)} — ${mapBlockedReason({ code: sized.reason }).label.toLowerCase()}`);
					return;
				}
				amount = sized.order;
			} else {
				amount = 'max';
			}

			// Re-quote (expected out + price impact + guard preview).
			const quote = await this.quote({ side, mint, amount });
			if (quote && quote.wallet_balance_sol != null) this.walletBalanceSol = num(quote.wallet_balance_sol);
			if (quote && quote.allowed === false && quote.blocked_reason) {
				this.addRow('mirror', { kind: 'blocked', source, ...mapBlockedReason(quote.blocked_reason), latency: computeLatency(detectedAt, Date.now()) });
				this.narrate(`Mirror blocked ${truncateAddr(mint)} — ${mapBlockedReason(quote.blocked_reason).label.toLowerCase()}`);
				return;
			}

			// Execute the guarded, server-signed replica.
			const res = await this.trade({ side, mint, amount });
			const submittedAt = Date.now();
			const latency = computeLatency(detectedAt, submittedAt);

			if (res.ok) {
				const d = res.data || {};
				const fillSol = side === 'buy' ? null : num(d.sol_received);
				const fillTokens = side === 'buy' ? d.tokens_received : d.tokens_sold;
				const row = {
					kind: 'fill', source, side, mint,
					solSpent: side === 'buy' ? num(d.sol_spent) : null,
					solReceived: fillSol,
					tokens: fillTokens,
					priceImpact: d.price_impact_pct ?? quote?.price_impact_pct ?? null,
					signature: d.signature, explorer: d.explorer || explorerTx(d.signature),
					latency,
				};
				if (d.new_balance_sol != null) this.walletBalanceSol = num(d.new_balance_sol);
				this.addRow('mirror', row);
				this.lastRelay = { latency, fill: side === 'buy' ? `${fmtSol(row.solSpent)} SOL` : `${fmtSol(fillSol)} SOL`, blocked: false };
				this.renderRelay();
				this.toast(`Mirrored ${side} · ${latency}ms`);
				this.narrate(`Mirror ${side} ${truncateAddr(mint)} filled — ${latency}ms latency`);
			} else {
				const blocked = mapBlockedReason(res);
				this.addRow('mirror', { kind: 'blocked', source, ...blocked, latency });
				this.lastRelay = { latency, fill: null, blocked: true };
				this.renderRelay();
				this.narrate(`Mirror blocked ${truncateAddr(mint)} — ${blocked.label.toLowerCase()}`);
			}
		} catch (err) {
			console.warn('[mirror] replicate failed', err);
			this.addRow('mirror', { kind: 'blocked', source, ...mapBlockedReason({ code: 'network', message: 'Network error reaching the trade engine — will retry on the next signal.' }), latency: computeLatency(detectedAt, Date.now()) });
		} finally {
			if (source.signature) this.inFlight.delete(source.signature);
		}
	}

	async primeBalance(mint) {
		// A throwaway minimal buy quote just reads back wallet_balance_sol so
		// pct_balance sizing has a real number. Never executes.
		try {
			const q = await this.quote({ side: 'buy', mint, amount: 0.001 });
			if (q && q.wallet_balance_sol != null) this.walletBalanceSol = num(q.wallet_balance_sol);
		} catch { /* leave null → sizing will surface 'sizing_unavailable' */ }
	}

	async quote({ side, mint, amount }) {
		const r = await fetch(`/api/agents/${encodeURIComponent(this.agentId)}/trade/quote`, {
			method: 'POST', credentials: 'include',
			headers: { 'content-type': 'application/json', ...(this.csrfToken ? { 'x-csrf-token': this.csrfToken } : {}) },
			body: JSON.stringify({ side, mint, amount, network: this.network }),
		});
		const j = await r.json().catch(() => ({}));
		if (!r.ok) return { allowed: false, blocked_reason: { code: j.error || 'quote_failed', message: j.message || j.error_description || 'Could not price the trade.' } };
		return j.data || {};
	}

	async trade({ side, mint, amount }) {
		const idem = (crypto?.randomUUID?.() || `${Date.now()}-${Math.round(Math.random() * 1e9)}`);
		const r = await fetch(`/api/agents/${encodeURIComponent(this.agentId)}/trade`, {
			method: 'POST', credentials: 'include',
			headers: { 'content-type': 'application/json', ...(this.csrfToken ? { 'x-csrf-token': this.csrfToken } : {}) },
			body: JSON.stringify({ side, mint, amount, network: this.network, idempotency_key: idem }),
		});
		const j = await r.json().catch(() => ({}));
		if (r.ok) return { ok: true, data: j.data || {} };
		return { ok: false, code: j.error || 'trade_failed', message: j.message || j.error_description || 'Trade rejected.', detail: j.detail || null };
	}

	// ── rows + render ──────────────────────────────────────────────────────────
	addRow(col, row) {
		this.rows[col].unshift(row);
		while (this.rows[col].length > MAX_ROWS) this.rows[col].pop();
		this.renderColumns();
		this.schedulePush();
	}

	renderShell() {
		this.body.innerHTML = `
			<div class="asc-mir" id="asc-mir">
				<div class="asc-mir-head" id="asc-mir-head"></div>
				<div class="asc-mir-cols">
					<div class="asc-mir-col">
						<div class="asc-mir-col-head"><span class="asc-mir-dot src"></span>Source</div>
						<div class="asc-mir-list" id="asc-mir-source"></div>
					</div>
					<div class="asc-mir-col">
						<div class="asc-mir-col-head"><span class="asc-mir-dot mir"></span>Mirror</div>
						<div class="asc-mir-list" id="asc-mir-mirror"></div>
					</div>
				</div>
				<div class="asc-mir-relay" id="asc-mir-relay"></div>
				<div class="asc-mir-controls" id="asc-mir-controls"></div>
			</div>`;
		this.el = {
			head: this.body.querySelector('#asc-mir-head'),
			source: this.body.querySelector('#asc-mir-source'),
			mirror: this.body.querySelector('#asc-mir-mirror'),
			relay: this.body.querySelector('#asc-mir-relay'),
			controls: this.body.querySelector('#asc-mir-controls'),
		};
	}

	render() {
		this.renderHead();
		this.renderColumns();
		this.renderRelay();
		this.renderControls();
	}

	renderHead() {
		const tw = this.config.targetWallet;
		const rule = this.config.sizingRule;
		const ruleLabel = rule === 'fixed' ? `Fixed ${fmtSol(this.config.fixedSol)} SOL`
			: rule === 'multiplier' ? `${fmtSol(this.config.multiplier)}× source`
				: `${fmtSol(this.config.pctBalance)}% balance`;
		this.el.head.innerHTML = `
			<div class="asc-mir-target">
				${isValidAddress(tw)
					? `<button class="asc-mir-wallet" id="asc-mir-copy" title="Copy target wallet">
							<span class="asc-mir-wallet-label">Target</span>
							<code>${esc(truncateAddr(tw, 5, 5))}</code>
							<span class="asc-mir-copy-ic">⧉</span>
						</button>`
					: `<span class="asc-mir-wallet asc-mir-wallet--unset">No target wallet</span>`}
			</div>
			<span class="asc-mir-rule" title="Active sizing rule">${esc(ruleLabel)}</span>
			${this.renderStatusBadge()}`;
		this.el.head.querySelector('#asc-mir-copy')?.addEventListener('click', () => {
			navigator.clipboard?.writeText(tw).then(() => this.toast('Target wallet copied')).catch(() => {});
		});
	}

	renderStatusBadge() {
		if (!this.isOwner) return `<span class="asc-mir-status armed">read-only</span>`;
		if (!isValidAddress(this.config.targetWallet)) return `<span class="asc-mir-status off">not armed</span>`;
		const map = {
			connecting: ['armed', 'connecting…'],
			live: ['live', 'armed'],
			error: ['err', 'reconnecting…'],
			idle: ['off', 'idle'],
		};
		const [cls, label] = map[this.streamState] || map.idle;
		return `<span class="asc-mir-status ${cls}">${label}</span>`;
	}

	renderStatus() {
		const badge = this.el.head?.querySelector('.asc-mir-status');
		if (badge) badge.outerHTML = this.renderStatusBadge();
		this.renderColumns();
	}

	renderColumns() {
		this.renderColumn('source');
		this.renderColumn('mirror');
	}

	renderColumn(col) {
		const host = this.el[col];
		if (!host) return;
		const rows = this.rows[col];
		if (!rows.length) {
			host.innerHTML = `<div class="asc-mir-empty">${esc(this.emptyText(col))}</div>`;
			return;
		}
		host.innerHTML = rows.map((r) => col === 'source' ? this.sourceRowHTML(r) : this.mirrorRowHTML(r)).join('');
	}

	emptyText(col) {
		if (!this.isOwner) return col === 'source' ? 'The owner controls this mirror.' : 'Replicas appear here when the owner is armed.';
		if (!isValidAddress(this.config.targetWallet)) return 'Set a target wallet below to arm the mirror.';
		if (this.streamState === 'connecting') return col === 'source' ? 'Watching the target wallet…' : 'Armed and waiting.';
		if (this.streamState === 'error') return 'Reconnecting to the trade stream…';
		return col === 'source'
			? 'No trades from the target yet — the mirror is armed and waiting.'
			: 'No replicas yet.';
	}

	sourceRowHTML(r) {
		const verb = r.side === 'buy' ? 'bought' : 'sold';
		const amt = r.side === 'buy' ? `${fmtSol(r.solAmount)} SOL` : `${fmtSol(r.solAmount)} SOL`;
		const usd = fmtUsd(r.usd);
		const ex = explorerTx(r.signature);
		return `<div class="asc-mir-row ${r.side}">
			<span class="asc-mir-side ${r.side}">${r.side}</span>
			<div class="asc-mir-row-main">
				<div class="asc-mir-row-top">Target ${verb} <strong>${esc(amt)}</strong>${usd ? ` <span class="asc-mir-usd">${esc(usd)}</span>` : ''}</div>
				<div class="asc-mir-row-sub"><code>${esc(truncateAddr(r.mint, 4, 4))}</code>${ex ? ` · <a href="${esc(ex)}" target="_blank" rel="noopener">tx ↗</a>` : ''}</div>
			</div>
		</div>`;
	}

	mirrorRowHTML(r) {
		if (r.kind === 'blocked') {
			return `<div class="asc-mir-row blocked">
				<span class="asc-mir-side blocked">blocked</span>
				<div class="asc-mir-row-main">
					<div class="asc-mir-row-top"><strong>${esc(r.label)}</strong>${r.latency != null ? ` <span class="asc-mir-lat">${r.latency}ms</span>` : ''}</div>
					<div class="asc-mir-row-sub">${esc(r.message)}</div>
				</div>
			</div>`;
		}
		const verb = r.side === 'buy' ? 'bought' : 'sold';
		const fill = r.side === 'buy' ? `${fmtSol(r.solSpent)} SOL` : `${fmtSol(r.solReceived)} SOL`;
		const impact = r.priceImpact != null ? ` · ${Number(r.priceImpact).toFixed(2)}% impact` : '';
		const ex = r.explorer || explorerTx(r.signature);
		return `<div class="asc-mir-row ${r.side} fill">
			<span class="asc-mir-side ${r.side}">${r.side}</span>
			<div class="asc-mir-row-main">
				<div class="asc-mir-row-top">Mirror ${verb} <strong>${esc(fill)}</strong> <span class="asc-mir-lat ok" title="latency = submitted − detected">${r.latency}ms</span></div>
				<div class="asc-mir-row-sub"><code>${esc(truncateAddr(r.mint, 4, 4))}</code>${esc(impact)}${ex ? ` · <a href="${esc(ex)}" target="_blank" rel="noopener">tx ↗</a>` : ''}</div>
			</div>
		</div>`;
	}

	renderRelay() {
		if (!this.el.relay) return;
		if (!this.lastRelay) {
			this.el.relay.innerHTML = `<span class="asc-mir-relay-idle">Latency &amp; fill appear here on the first mirrored order.</span>`;
			return;
		}
		const { latency, fill, blocked } = this.lastRelay;
		this.el.relay.innerHTML = `
			<div class="asc-mir-relay-stat"><span class="k">Latency</span><span class="v">${latency != null ? `${latency}ms` : '—'}</span></div>
			<div class="asc-mir-relay-stat"><span class="k">Last fill</span><span class="v ${blocked ? 'blocked' : ''}">${blocked ? 'blocked' : esc(fill || '—')}</span></div>`;
	}

	renderControls() {
		const c = this.el.controls;
		if (!c) return;
		if (!this.isOwner) {
			c.innerHTML = `<div class="asc-mir-readonly">You're watching this agent. Its owner sets the target wallet, sizing rule, and spend caps.</div>`;
			return;
		}
		const cfg = this.config;
		const lim = this.limits || {};
		const sizingFields = cfg.sizingRule === 'fixed'
			? `<label class="asc-mir-field"><span>Fixed SOL</span><input type="number" step="0.001" min="0" id="mir-fixed" value="${esc(cfg.fixedSol)}"></label>`
			: cfg.sizingRule === 'multiplier'
				? `<label class="asc-mir-field"><span>Multiplier</span><input type="number" step="0.05" min="0" id="mir-mult" value="${esc(cfg.multiplier)}"></label>`
				: `<label class="asc-mir-field"><span>% of balance</span><input type="number" step="0.5" min="0" max="100" id="mir-pct" value="${esc(cfg.pctBalance)}"></label>`;
		c.innerHTML = `
			<details class="asc-mir-cfg" ${isValidAddress(cfg.targetWallet) ? '' : 'open'}>
				<summary>Mirror settings</summary>
				<div class="asc-mir-cfg-body">
					<label class="asc-mir-field asc-mir-field--wide">
						<span>Target wallet</span>
						<input type="text" id="mir-target" spellcheck="false" placeholder="Solana wallet address" value="${esc(cfg.targetWallet)}">
					</label>
					<div class="asc-mir-row2">
						<label class="asc-mir-field">
							<span>Sizing rule</span>
							<select id="mir-rule">
								<option value="fixed" ${cfg.sizingRule === 'fixed' ? 'selected' : ''}>Fixed</option>
								<option value="multiplier" ${cfg.sizingRule === 'multiplier' ? 'selected' : ''}>Multiplier</option>
								<option value="pct_balance" ${cfg.sizingRule === 'pct_balance' ? 'selected' : ''}>% of balance</option>
							</select>
						</label>
						${sizingFields}
					</div>
					<label class="asc-mir-field asc-mir-field--wide">
						<span>Watched mints (comma-separated)</span>
						<input type="text" id="mir-mints" spellcheck="false" value="${esc((cfg.watchMints || []).join(', '))}">
					</label>
					<div class="asc-mir-row2">
						<label class="asc-mir-field">
							<span>Min order SOL</span>
							<input type="number" step="0.001" min="0" id="mir-min" value="${esc(cfg.minOrderSol)}">
						</label>
						<label class="asc-mir-field asc-mir-check">
							<input type="checkbox" id="mir-sells" ${cfg.copySells ? 'checked' : ''}>
							<span>Mirror sells</span>
						</label>
					</div>
					<div class="asc-mir-caps">
						<span class="asc-mir-caps-title">Spend caps (firewall)</span>
						<div class="asc-mir-caps-grid">
							<label class="asc-mir-field"><span>Per-trade SOL</span><input type="number" step="0.01" min="0" id="mir-cap" value="${lim.per_trade_sol ?? ''}" placeholder="none"></label>
							<label class="asc-mir-field"><span>Daily budget SOL</span><input type="number" step="0.01" min="0" id="mir-daily" value="${lim.daily_budget_sol ?? ''}" placeholder="none"></label>
							<label class="asc-mir-field"><span>Max impact %</span><input type="number" step="0.5" min="0" max="100" id="mir-impact" value="${lim.max_price_impact_pct ?? ''}" placeholder="15"></label>
						</div>
					</div>
					<div class="asc-mir-actions">
						<button class="asc-mir-btn primary" id="mir-arm">${isValidAddress(cfg.targetWallet) ? 'Update &amp; arm' : 'Arm mirror'}</button>
						${isValidAddress(cfg.targetWallet) ? `<button class="asc-mir-btn" id="mir-disarm">Disarm</button>` : ''}
					</div>
					<div class="asc-mir-cfg-msg" id="mir-msg"></div>
				</div>
			</details>`;
		this.wireControls();
	}

	wireControls() {
		const c = this.el.controls;
		const ruleSel = c.querySelector('#mir-rule');
		ruleSel?.addEventListener('change', () => {
			this.config.sizingRule = ruleSel.value;
			this.saveConfig();
			this.renderControls(); // swap the sizing field
		});
		c.querySelector('#mir-arm')?.addEventListener('click', () => this.applyControls());
		c.querySelector('#mir-disarm')?.addEventListener('click', () => {
			this.disarmStream();
			this.toast('Mirror disarmed');
			this.render();
		});
	}

	async applyControls() {
		const c = this.el.controls;
		const msg = c.querySelector('#mir-msg');
		const val = (id) => c.querySelector(`#${id}`)?.value?.trim() ?? '';
		const target = val('mir-target');
		if (!isValidAddress(target)) { if (msg) { msg.className = 'asc-mir-cfg-msg err'; msg.textContent = 'Enter a valid Solana wallet address.'; } return; }

		const mints = val('mir-mints').split(',').map((m) => m.trim()).filter(Boolean);
		const validMints = mints.filter(isValidAddress).slice(0, MAX_WATCH_MINTS);
		if (!validMints.length) { if (msg) { msg.className = 'asc-mir-cfg-msg err'; msg.textContent = 'Add at least one valid mint to watch.'; } return; }

		this.config.targetWallet = target;
		this.config.watchMints = validMints;
		this.config.sizingRule = val('mir-rule') || this.config.sizingRule;
		if (c.querySelector('#mir-fixed')) this.config.fixedSol = num(val('mir-fixed'));
		if (c.querySelector('#mir-mult')) this.config.multiplier = num(val('mir-mult'));
		if (c.querySelector('#mir-pct')) this.config.pctBalance = num(val('mir-pct'));
		this.config.minOrderSol = num(val('mir-min'));
		this.config.copySells = !!c.querySelector('#mir-sells')?.checked;
		this.saveConfig();

		// Persist spend caps through the real owner endpoint (the firewall the
		// replica is held to). Only send fields the owner actually set.
		const capPatch = {};
		const cap = val('mir-cap'), daily = val('mir-daily'), impact = val('mir-impact');
		if (cap !== '') capPatch.per_trade_sol = num(cap);
		if (daily !== '') capPatch.daily_budget_sol = num(daily);
		if (impact !== '') capPatch.max_price_impact_pct = num(impact);
		if (Object.keys(capPatch).length) {
			try {
				const r = await fetch(`/api/agents/${encodeURIComponent(this.agentId)}/trade/limits`, {
					method: 'PUT', credentials: 'include',
					headers: { 'content-type': 'application/json', ...(this.csrfToken ? { 'x-csrf-token': this.csrfToken } : {}) },
					body: JSON.stringify(capPatch),
				});
				const j = await r.json().catch(() => ({}));
				if (r.ok) this.limits = j?.data?.limits || this.limits;
				else if (msg) { msg.className = 'asc-mir-cfg-msg err'; msg.textContent = j.message || 'Could not save spend caps.'; }
			} catch { if (msg) { msg.className = 'asc-mir-cfg-msg err'; msg.textContent = 'Network error saving spend caps.'; } }
		}

		if (msg) { msg.className = 'asc-mir-cfg-msg ok'; msg.textContent = 'Armed — watching the target wallet.'; }
		this.toast('Mirror armed');
		this.render();
		this.arm();
	}

	// ── wall frame + narration ─────────────────────────────────────────────────
	narrate(text) {
		if (!this.isOwner || !text) return;
		// Fire-and-forget activity line so the relay reads on the wall + log.
		fetch('/api/agent-screen-push', {
			method: 'POST', credentials: 'include',
			headers: { 'content-type': 'application/json', ...(this.csrfToken ? { 'x-csrf-token': this.csrfToken } : {}) },
			body: JSON.stringify({ agentId: this.agentId, frame: { activity: text.slice(0, 300), type: 'trade' } }),
		}).catch(() => {});
	}

	schedulePush() {
		if (!this.isOwner) return;
		const now = Date.now();
		const since = now - this.lastPushAt;
		if (since >= PUSH_MIN_INTERVAL_MS) { this.pushFrame(); return; }
		clearTimeout(this.pushTimer);
		this.pushTimer = setTimeout(() => this.pushFrame(), PUSH_MIN_INTERVAL_MS - since);
	}

	pushFrame() {
		if (this.destroyed || !this.isOwner) return;
		this.lastPushAt = Date.now();
		const dataUrl = this.drawFrame();
		if (!dataUrl) return;
		fetch('/api/agent-screen-push', {
			method: 'POST', credentials: 'include',
			headers: { 'content-type': 'application/json', ...(this.csrfToken ? { 'x-csrf-token': this.csrfToken } : {}) },
			body: JSON.stringify({ agentId: this.agentId, frame: { data: dataUrl, activity: this.lastRelay ? `Mirror · ${this.lastRelay.latency}ms` : 'Copy-trade mirror', type: 'trade' } }),
		}).catch(() => {});
	}

	// Paint the dual-column view to the offscreen canvas → the /agents-live card
	// renders this verbatim. Real data only (the rows we actually mirrored).
	drawFrame() {
		const cv = this.frameCanvas;
		const ctx = cv.getContext('2d');
		if (!ctx) return null;
		const W = cv.width, H = cv.height;
		ctx.fillStyle = '#070708'; ctx.fillRect(0, 0, W, H);

		ctx.fillStyle = '#f4f4f5';
		ctx.font = '700 20px system-ui, sans-serif';
		ctx.fillText('Copy-Trade Mirror', 20, 34);
		ctx.fillStyle = 'rgba(255,255,255,0.5)';
		ctx.font = '500 13px system-ui, sans-serif';
		ctx.fillText(`Target ${truncateAddr(this.config.targetWallet, 5, 5)}`, 20, 54);
		if (this.lastRelay) {
			ctx.textAlign = 'right';
			ctx.fillStyle = this.lastRelay.blocked ? '#fda4af' : '#86efac';
			ctx.font = '700 14px system-ui, sans-serif';
			ctx.fillText(this.lastRelay.blocked ? 'BLOCKED' : `${this.lastRelay.latency}ms · ${this.lastRelay.fill || ''}`, W - 20, 50);
			ctx.textAlign = 'left';
		}

		const colY = 78, colH = H - colY - 18, colW = (W - 60) / 2;
		this.drawColumn(ctx, 20, colY, colW, colH, 'SOURCE', this.rows.source, 'rgba(255,255,255,0.85)');
		this.drawColumn(ctx, 40 + colW, colY, colW, colH, 'MIRROR', this.rows.mirror, '#cbd5e1');
		try { return cv.toDataURL('image/jpeg', 0.72); } catch { return null; }
	}

	drawColumn(ctx, x, y, w, h, title, rows, color) {
		ctx.fillStyle = 'rgba(255,255,255,0.06)';
		ctx.fillRect(x, y, w, h);
		ctx.fillStyle = 'rgba(255,255,255,0.45)';
		ctx.font = '700 12px system-ui, sans-serif';
		ctx.fillText(title, x + 12, y + 22);

		ctx.font = '500 13px system-ui, sans-serif';
		let ry = y + 46;
		const lineH = 38;
		for (const r of rows.slice(0, Math.floor((h - 40) / lineH))) {
			const blocked = r.kind === 'blocked';
			ctx.fillStyle = blocked ? '#fda4af' : (r.side === 'buy' ? '#86efac' : '#fca5a5');
			ctx.font = '700 11px system-ui, sans-serif';
			ctx.fillText(blocked ? 'BLOCKED' : String(r.side || '').toUpperCase(), x + 12, ry);
			ctx.fillStyle = color;
			ctx.font = '500 13px system-ui, sans-serif';
			let label;
			if (title === 'SOURCE') label = `${fmtSol(r.solAmount)} SOL`;
			else if (blocked) label = r.label;
			else label = r.side === 'buy' ? `${fmtSol(r.solSpent)} SOL · ${r.latency}ms` : `${fmtSol(r.solReceived)} SOL · ${r.latency}ms`;
			ctx.fillText(String(label).slice(0, 28), x + 64, ry);
			ry += lineH;
			if (ry > y + h - 12) break;
		}
		if (!rows.length) {
			ctx.fillStyle = 'rgba(255,255,255,0.25)';
			ctx.font = '400 12px system-ui, sans-serif';
			ctx.fillText(title === 'SOURCE' ? 'Waiting for target…' : 'Armed', x + 12, y + 46);
		}
	}

	destroy() {
		this.destroyed = true;
		this.disarmStream();
		clearTimeout(this.pushTimer);
	}
}
