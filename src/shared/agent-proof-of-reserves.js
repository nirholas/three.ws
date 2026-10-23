// Proof-of-Reserves — the "open the books" transparency panel.
//
// Renders an agent's REAL, verifiable financial state: live reserves (with a
// one-tap "verify on-chain" that opens the wallet on Solscan), lifetime received
// vs out from the custody ledger, outstanding obligations, a solvency read, and a
// paginated feed of real flows each linking to its on-chain signature. Nothing is
// asserted — every figure traces to chain state or a signed ledger row. All data
// comes from GET /api/agents/:id/solana/reserves (api/_lib/trust/proof-of-reserves.js).
//
// States: insufficient (no wallet), loading (skeleton), populated, degraded
// (RPC throttled → last-verified timestamp, never a stale "verified now"), error
// (actionable retry). a11y + prefers-reduced-motion throughout.

import { apiFetch } from '../api.js';
import { fmtUsd } from './agent-financial-reputation.js';
import { shortAddress } from './address.js';

const isBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined';
const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const SOLSCAN = (addr, network) => `https://solscan.io/account/${addr}${network === 'devnet' ? '?cluster=devnet' : ''}`;
const SOLSCAN_TOKEN = (mint, network) => `https://solscan.io/token/${mint}${network === 'devnet' ? '?cluster=devnet' : ''}`;

const VERIFY_SVG =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="9"/></svg>';
const LINK_SVG =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg>';

const SOLVENCY_COPY = {
	solvent: { label: 'Fully reserved', accent: 'var(--success,#4ade80)' },
	no_obligations: { label: 'No obligations', accent: 'var(--wallet-accent,#c4b5fd)' },
	under_reserved: { label: 'Under-reserved', accent: 'var(--warn,#fbbf24)' },
	unknown: { label: 'Reserves unverified', accent: 'var(--ink-dim,#9ca3af)' },
};

const KIND_LABEL = {
	tip: 'Tip', stream: 'Stream', withdraw: 'Withdraw', trade: 'Trade',
	snipe: 'Snipe', x402: 'x402 pay', spend: 'Spend', payment: 'Payment',
};

function fmtSol(n) {
	n = Number(n) || 0;
	if (n === 0) return '0';
	if (n < 0.001) return n.toExponential(1);
	return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 4 : 3 });
}
function shortAddr(a) { return shortAddress(a, 4, 4, { empty: '\u2014' }); }
function timeAgo(iso) {
	if (!iso) return '';
	try {
		const diff = (Date.now() - new Date(iso).getTime()) / 1000;
		if (diff < 60) return 'just now';
		if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
		if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
		return `${Math.round(diff / 86400)}d ago`;
	} catch {
		return '';
	}
}

// ── data ──────────────────────────────────────────────────────────────────────
async function fetchReserves(agentId, { network = 'mainnet', limit = 25, before = null } = {}) {
	const q = new URLSearchParams({ network, limit: String(limit) });
	if (before) q.set('before', before);
	const res = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}/solana/reserves?${q}`, { allowAnonymous: true });
	if (!res.ok) throw new Error(`reserves ${res.status}`);
	return res.json();
}

// ── render ──────────────────────────────────────────────────────────────────────
function reservesHeader(d) {
	const r = d.reserves;
	if (!r) {
		return (
			`<div class="por-head por-head--empty">` +
			`<div class="por-total">—</div>` +
			`<div class="por-head-meta"><div class="por-status">No wallet yet</div>` +
			`<div class="por-sub">This agent has not been provisioned a Solana wallet, so there are no reserves to prove.</div></div></div>`
		);
	}
	if (r.error) {
		return (
			`<div class="por-head por-head--degraded">` +
			`<div class="por-total">⚠</div>` +
			`<div class="por-head-meta"><div class="por-status">Reserves temporarily unverifiable</div>` +
			`<div class="por-sub">The network is throttled right now. You can still check the wallet directly.</div>` +
			`<a class="por-verify" href="${esc(r.verify_url)}" target="_blank" rel="noopener noreferrer">${VERIFY_SVG} Verify on-chain</a></div></div>`
		);
	}
	const sv = SOLVENCY_COPY[d.solvency?.status] || SOLVENCY_COPY.unknown;
	const verified = r.degraded
		? `<span class="por-stamp por-stamp--stale" title="The live read is throttled — this is the last verified snapshot">last verified ${esc(timeAgo(r.last_verified_at || r.verified_at))}</span>`
		: `<span class="por-stamp" title="${esc(r.verified_at)}">verified ${esc(timeAgo(r.verified_at))}</span>`;
	return (
		`<div class="por-head" style="--por-accent:${esc(sv.accent)}">` +
		`<div class="por-total-wrap"><div class="por-total">$${esc(fmtUsd(r.total_usd))}</div>` +
		`<div class="por-total-label">total reserves</div></div>` +
		`<div class="por-head-meta">` +
		`<div class="por-status">${esc(sv.label)}</div>` +
		`<div class="por-stamps">${verified}` +
		`<a class="por-verify" href="${esc(r.verify_url)}" target="_blank" rel="noopener noreferrer">${VERIFY_SVG} Verify on-chain</a></div>` +
		`</div></div>`
	);
}

function reservesAssets(d) {
	const r = d.reserves;
	if (!r || r.error) return '';
	const rows = [];
	rows.push(assetRow('SOL', `◎ ${fmtSol(r.sol)}`, r.sol_usd, SOLSCAN(d.address, d.network)));
	for (const t of r.tokens || []) {
		const sym = t.is_usdc ? 'USDC' : t.is_three ? '$THREE' : shortAddr(t.mint);
		const amt = `${t.ui_amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${t.is_usdc ? '' : ''}`.trim();
		rows.push(assetRow(sym, amt, t.usd, SOLSCAN_TOKEN(t.mint, d.network), t.is_three));
	}
	return (
		`<div class="por-section"><div class="por-section-label">Live holdings</div>` +
		`<ul class="por-assets">${rows.join('')}</ul></div>`
	);
}
function assetRow(symbol, amount, usd, href, highlight = false) {
	return (
		`<li class="por-asset${highlight ? ' por-asset--three' : ''}">` +
		`<a class="por-asset-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="Verify ${esc(symbol)} on Solscan">` +
		`<span class="por-asset-sym">${esc(symbol)}</span>` +
		`<span class="por-asset-amt">${esc(amount)}</span>` +
		`<span class="por-asset-usd">${usd != null ? '$' + esc(fmtUsd(usd)) : '—'}</span>` +
		`<span class="por-asset-ic">${LINK_SVG}</span></a></li>`
	);
}

function lifetimeSection(d) {
	const lt = d.lifetime;
	if (!lt) return '';
	const recv = lt.received || { usd: 0, count: 0, by_kind: {} };
	const out = lt.out || { usd: 0, count: 0, by_kind: {} };
	const chip = (label, val) => (Number(val) > 0 ? `<span class="por-flowchip">${esc(label)} $${esc(fmtUsd(val))}</span>` : '');
	return (
		`<div class="por-section"><div class="por-section-label">Lifetime flows</div>` +
		`<div class="por-lt">` +
		`<div class="por-lt-card por-lt-in"><div class="por-lt-amt">+$${esc(fmtUsd(recv.usd))}</div>` +
		`<div class="por-lt-cap">received · ${recv.count} event${recv.count === 1 ? '' : 's'}</div>` +
		`<div class="por-lt-kinds">${chip('tips', recv.by_kind?.tip)}${chip('streams', recv.by_kind?.stream)}</div></div>` +
		`<div class="por-lt-card por-lt-out"><div class="por-lt-amt">−$${esc(fmtUsd(out.usd))}</div>` +
		`<div class="por-lt-cap">out · ${out.count} event${out.count === 1 ? '' : 's'}</div>` +
		`<div class="por-lt-kinds">${chip('withdraw', out.by_kind?.withdraw)}${chip('trade', out.by_kind?.trade)}${chip('snipe', out.by_kind?.snipe)}${chip('x402', out.by_kind?.x402)}</div></div>` +
		`</div></div>`
	);
}

function obligationsSection(d) {
	const o = d.obligations;
	if (!o) return '';
	const s = d.solvency || {};
	const ratioTxt =
		s.ratio != null ? `${Math.round(Math.min(s.ratio, 9.99) * 100)}% coverage` : o.total_usd > 0 ? '' : 'nothing owed';
	return (
		`<div class="por-section"><div class="por-section-label">Outstanding obligations</div>` +
		`<div class="por-oblig">` +
		`<div class="por-oblig-row"><span>Pending spends</span><b>$${esc(fmtUsd(o.pending_spends_usd))}</b></div>` +
		`<div class="por-oblig-row"><span>Live money-streams</span><b>${o.active_streams}</b></div>` +
		`<div class="por-oblig-row por-oblig-total"><span>${esc(ratioTxt)}</span>` +
		`<b>$${esc(fmtUsd(o.total_usd))} owed</b></div>` +
		`</div></div>`
	);
}

function flowsSection(d) {
	const flows = d.flows || [];
	if (!flows.length) {
		return (
			`<div class="por-section"><div class="por-section-label">Verifiable flows</div>` +
			`<div class="por-empty">No settled flows yet. Tips, streams, trades and withdraws will appear here — each one independently verifiable on-chain.</div></div>`
		);
	}
	const rows = flows.map(flowRow).join('');
	const more = d.next_cursor
		? `<button type="button" class="por-more" data-por-more="${esc(d.next_cursor)}">Load more flows</button>`
		: '';
	return (
		`<div class="por-section"><div class="por-section-label">Verifiable flows</div>` +
		`<ul class="por-flows">${rows}</ul>${more}</div>`
	);
}
function flowRow(f) {
	const inb = f.direction === 'in';
	const label = KIND_LABEL[f.kind] || f.kind || 'Flow';
	const amt = f.usd != null ? `$${fmtUsd(f.usd)}` : f.amount_lamports ? `◎ ${fmtSol(Number(f.amount_lamports) / 1e9)}` : '';
	const cp = f.counterparty ? `<span class="por-flow-cp">${inb ? 'from' : 'to'} ${esc(shortAddr(f.counterparty))}</span>` : '';
	const link = f.explorer
		? `<a class="por-flow-sig" href="${esc(f.explorer)}" target="_blank" rel="noopener noreferrer" title="View signature on Solscan">${LINK_SVG}</a>`
		: '';
	return (
		`<li class="por-flow">` +
		`<span class="por-flow-dir por-flow-dir--${inb ? 'in' : 'out'}" aria-hidden="true">${inb ? '↓' : '↑'}</span>` +
		`<span class="por-flow-main"><span class="por-flow-kind">${esc(label)}</span>${cp}</span>` +
		`<span class="por-flow-amt por-flow-amt--${inb ? 'in' : 'out'}">${inb ? '+' : '−'}${esc(amt)}</span>` +
		`<span class="por-flow-time">${esc(timeAgo(f.at))}</span>${link}</li>`
	);
}

function panelInner(d) {
	return (
		reservesHeader(d) +
		reservesAssets(d) +
		lifetimeSection(d) +
		obligationsSection(d) +
		flowsSection(d) +
		`<div class="por-foot">Reserves are a live read of Solana chain state. Every flow links to its on-chain signature. Trustless, not trust-us.</div>`
	);
}

function skeleton() {
	return (
		`<div class="por-head"><div class="por-sk por-sk-total"></div>` +
		`<div class="por-head-meta"><div class="por-sk por-sk-line" style="width:140px"></div>` +
		`<div class="por-sk por-sk-line" style="width:200px;margin-top:8px"></div></div></div>` +
		`<ul class="por-assets">${Array.from({ length: 3 })
			.map(() => `<li class="por-asset"><div class="por-sk por-sk-line" style="width:100%;height:34px"></div></li>`)
			.join('')}</ul>`
	);
}

/**
 * The Proof-of-Reserves transparency panel as a self-loading DOM node.
 * @param {string} agentId
 * @param {object} [opts] { network }
 * @returns {HTMLElement}
 */
export function proofOfReservesPanelEl(agentId, opts = {}) {
	ensureStyles();
	const network = opts.network === 'devnet' ? 'devnet' : 'mainnet';
	const root = document.createElement('div');
	root.className = 'por-panel';
	root.innerHTML = skeleton();

	let current = null;

	const wireMore = () => {
		const btn = root.querySelector('[data-por-more]');
		if (!btn) return;
		btn.addEventListener('click', async () => {
			const before = btn.getAttribute('data-por-more');
			btn.disabled = true;
			btn.textContent = 'Loading…';
			try {
				const next = await fetchReserves(agentId, { network, before });
				current.flows = [...(current.flows || []), ...(next.flows || [])];
				current.next_cursor = next.next_cursor;
				// Re-render only the flows section to preserve scroll.
				const sec = btn.closest('.por-section');
				if (sec) {
					const tpl = document.createElement('template');
					tpl.innerHTML = flowsSection(current).trim();
					sec.replaceWith(tpl.content.firstElementChild);
					wireMore();
				}
			} catch {
				btn.disabled = false;
				btn.textContent = 'Retry loading flows';
			}
		});
	};

	const load = async () => {
		root.innerHTML = skeleton();
		try {
			current = await fetchReserves(agentId, { network });
			root.innerHTML = panelInner(current);
			wireMore();
		} catch {
			root.innerHTML =
				`<div class="por-error" role="alert"><div class="por-error-title">Couldn't load proof-of-reserves</div>` +
				`<p>The wallet's real on-chain history is unchanged — this is a temporary read error.</p>` +
				`<button type="button" class="por-retry">Try again</button></div>`;
			root.querySelector('.por-retry')?.addEventListener('click', load);
		}
	};
	load();
	return root;
}

// ── styles (injected once, token-driven) ─────────────────────────────────────
let _injected = false;
export function ensureProofOfReservesStyles() {
	ensureStyles();
}
function ensureStyles() {
	if (_injected || !isBrowser()) return;
	_injected = true;
	const css = `
.por-panel{font-family:var(--font-body,Inter,system-ui,sans-serif);color:var(--ink,#e5e7eb);display:flex;flex-direction:column;gap:var(--space-md,16px)}
.por-head{display:flex;gap:var(--space-md,16px);align-items:center;padding:14px 16px;border-radius:var(--radius-lg,14px);
 background:linear-gradient(135deg,color-mix(in srgb,var(--por-accent,var(--wallet-accent,#c4b5fd)) 12%,transparent),var(--surface-1,rgba(255,255,255,.03)));
 border:1px solid color-mix(in srgb,var(--por-accent,var(--wallet-accent,#c4b5fd)) 30%,transparent)}
.por-head--empty,.por-head--degraded{--por-accent:var(--ink-dim,#9ca3af)}
.por-total-wrap{display:flex;flex-direction:column;gap:2px;flex:0 0 auto}
.por-total{font-family:var(--font-display,Space Grotesk,sans-serif);font-size:var(--text-2xl,28px);font-weight:700;line-height:1;color:var(--ink-bright,#fff)}
.por-total-label{font-size:var(--text-2xs,11px);color:var(--ink-dim,#9ca3af);text-transform:uppercase;letter-spacing:.05em}
.por-head-meta{min-width:0;flex:1;display:flex;flex-direction:column;gap:6px}
.por-status{font-family:var(--font-display,sans-serif);font-weight:700;font-size:var(--text-md,15px);color:var(--por-accent,var(--wallet-accent,#c4b5fd))}
.por-sub{font-size:var(--text-sm,13px);color:var(--ink-dim,#9ca3af);line-height:1.4}
.por-stamps{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.por-stamp{font-size:var(--text-2xs,11px);color:var(--ink-faint,#6b7280);font-family:var(--font-mono,monospace)}
.por-stamp--stale{color:var(--warn,#fbbf24)}
.por-verify{display:inline-flex;align-items:center;gap:5px;font-size:var(--text-xs,12px);font-weight:600;text-decoration:none;
 color:var(--ink-bright,#fff);background:var(--wallet-accent-fill,rgba(139,92,246,.15));border:1px solid var(--wallet-stroke-strong,rgba(139,92,246,.5));
 border-radius:var(--radius-pill,999px);padding:4px 11px;transition:background var(--duration-fast,120ms) ease,transform var(--duration-fast,120ms) ease}
.por-verify svg{width:13px;height:13px}
.por-verify:hover{background:var(--wallet-accent-soft,rgba(139,92,246,.25));transform:translateY(-1px)}
.por-verify:focus-visible{outline:none;box-shadow:0 0 0 2px var(--wallet-focus,rgba(139,92,246,.7))}
.por-section{display:flex;flex-direction:column;gap:8px}
.por-section-label{font-size:var(--text-2xs,11px);text-transform:uppercase;letter-spacing:.06em;color:var(--ink-faint,#6b7280);font-weight:600}
.por-assets{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px}
.por-asset-link{display:grid;grid-template-columns:auto 1fr auto auto;align-items:center;gap:10px;text-decoration:none;
 padding:9px 12px;border-radius:var(--radius-md,10px);background:var(--surface-1,rgba(255,255,255,.03));border:1px solid var(--stroke,rgba(255,255,255,.08));
 transition:background var(--duration-fast,120ms) ease,border-color var(--duration-fast,120ms) ease}
.por-asset-link:hover{background:var(--surface-2,rgba(255,255,255,.06));border-color:var(--wallet-stroke,rgba(139,92,246,.3))}
.por-asset-link:focus-visible{outline:none;box-shadow:0 0 0 2px var(--wallet-focus,rgba(139,92,246,.7))}
.por-asset--three .por-asset-sym{color:var(--wallet-accent,#c4b5fd)}
.por-asset-sym{font-family:var(--font-mono,monospace);font-weight:700;font-size:var(--text-sm,13px);color:var(--ink-bright,#fff)}
.por-asset-amt{font-family:var(--font-mono,monospace);font-size:var(--text-xs,12px);color:var(--ink-dim,#9ca3af);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.por-asset-usd{font-family:var(--font-mono,monospace);font-size:var(--text-sm,13px);font-weight:700;color:var(--ink,#e5e7eb)}
.por-asset-ic{color:var(--ink-faint,#6b7280);display:inline-flex}.por-asset-ic svg{width:12px;height:12px}
.por-lt{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.por-lt-card{padding:11px 13px;border-radius:var(--radius-md,10px);background:var(--surface-1,rgba(255,255,255,.03));border:1px solid var(--stroke,rgba(255,255,255,.08))}
.por-lt-amt{font-family:var(--font-mono,monospace);font-size:var(--text-lg,18px);font-weight:700}
.por-lt-in .por-lt-amt{color:var(--success,#4ade80)}.por-lt-out .por-lt-amt{color:var(--danger,#f87171)}
.por-lt-cap{font-size:var(--text-2xs,11px);color:var(--ink-dim,#9ca3af);margin:2px 0 6px}
.por-lt-kinds{display:flex;flex-wrap:wrap;gap:4px}
.por-flowchip{font-size:10px;font-family:var(--font-mono,monospace);color:var(--ink-dim,#9ca3af);background:var(--surface-2,rgba(255,255,255,.06));border-radius:var(--radius-sm,6px);padding:2px 6px}
.por-oblig{display:flex;flex-direction:column;gap:6px;padding:11px 13px;border-radius:var(--radius-md,10px);background:var(--surface-1,rgba(255,255,255,.03));border:1px solid var(--stroke,rgba(255,255,255,.08))}
.por-oblig-row{display:flex;justify-content:space-between;align-items:baseline;font-size:var(--text-sm,13px);color:var(--ink-dim,#9ca3af)}
.por-oblig-row b{font-family:var(--font-mono,monospace);color:var(--ink-bright,#fff)}
.por-oblig-total{border-top:1px solid var(--stroke,rgba(255,255,255,.08));padding-top:6px;margin-top:2px}
.por-flows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:2px}
.por-flow{display:grid;grid-template-columns:auto 1fr auto auto auto;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--radius-sm,8px);font-size:var(--text-xs,12px)}
.por-flow:hover{background:var(--surface-1,rgba(255,255,255,.03))}
.por-flow-dir{font-weight:700;font-size:13px}.por-flow-dir--in{color:var(--success,#4ade80)}.por-flow-dir--out{color:var(--danger,#f87171)}
.por-flow-main{min-width:0;display:flex;flex-direction:column}
.por-flow-kind{color:var(--ink-bright,#fff);font-weight:600}
.por-flow-cp{font-family:var(--font-mono,monospace);color:var(--ink-faint,#6b7280);font-size:10px}
.por-flow-amt{font-family:var(--font-mono,monospace);font-weight:700}
.por-flow-amt--in{color:var(--success,#4ade80)}.por-flow-amt--out{color:var(--ink,#e5e7eb)}
.por-flow-time{color:var(--ink-faint,#6b7280);white-space:nowrap}
.por-flow-sig{color:var(--ink-faint,#6b7280);display:inline-flex}.por-flow-sig:hover{color:var(--wallet-accent,#c4b5fd)}.por-flow-sig svg{width:12px;height:12px}
.por-more{font:inherit;font-size:var(--text-xs,12px);font-weight:600;color:var(--ink,#e5e7eb);background:var(--surface-1,rgba(255,255,255,.03));
 border:1px solid var(--stroke,rgba(255,255,255,.1));border-radius:var(--radius-md,10px);padding:8px;margin-top:6px;cursor:pointer;width:100%;transition:background var(--duration-fast,120ms) ease}
.por-more:hover{background:var(--surface-2,rgba(255,255,255,.06))}.por-more:disabled{opacity:.6;cursor:default}
.por-empty{font-size:var(--text-sm,13px);color:var(--ink-dim,#9ca3af);line-height:1.5;padding:12px;background:var(--surface-1,rgba(255,255,255,.03));border:1px dashed var(--stroke,rgba(255,255,255,.1));border-radius:var(--radius-md,10px)}
.por-foot{font-size:var(--text-2xs,11px);color:var(--ink-faint,#6b7280);line-height:1.4}
.por-error{text-align:center;padding:var(--space-lg,24px) var(--space-md,16px)}
.por-error-title{font-weight:700;color:var(--ink-bright,#fff);margin-bottom:6px}
.por-error p{font-size:var(--text-sm,13px);color:var(--ink-dim,#9ca3af);margin:0 0 14px}
.por-retry{font:inherit;font-size:var(--text-sm,13px);font-weight:600;color:var(--ink-bright,#fff);background:var(--wallet-accent-fill,rgba(139,92,246,.15));border:1px solid var(--wallet-stroke-strong,rgba(139,92,246,.5));border-radius:var(--radius-md,10px);padding:8px 18px;cursor:pointer}
.por-retry:hover{background:var(--wallet-accent-soft,rgba(139,92,246,.25))}
.por-sk{background:linear-gradient(90deg,var(--surface-1,rgba(255,255,255,.03)) 25%,var(--surface-2,rgba(255,255,255,.06)) 37%,var(--surface-1,rgba(255,255,255,.03)) 63%);background-size:400% 100%;animation:por-shimmer 1.4s ease infinite;border-radius:var(--radius-sm,6px)}
.por-sk-total{width:90px;height:34px}.por-sk-line{height:12px}
@keyframes por-shimmer{0%{background-position:100% 50%}100%{background-position:0 50%}}
@media (max-width:520px){.por-lt{grid-template-columns:1fr}.por-head{flex-direction:column;align-items:flex-start}.por-flow{grid-template-columns:auto 1fr auto auto}}
@media (prefers-reduced-motion:reduce){.por-sk{animation:none}.por-verify:hover{transform:none}}
`;
	const style = document.createElement('style');
	style.id = 'por-styles';
	style.textContent = css;
	document.head.appendChild(style);
}
