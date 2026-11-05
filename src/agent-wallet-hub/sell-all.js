/**
 * Agent Wallet hub: "Sell all" panel.
 *
 * One action that gets the owner out of every coin the agent holds. Lives inside
 * the Trade tab's Holdings card (the Portfolio tab deep-links into it). Phases:
 *
 *   loading  : reads the wallet's real token balances, the agent's live sniper
 *              positions, display metadata, and whether the sniper is armed.
 *   review   : one row per coin with a checkbox, max slippage, an optional
 *              "pause the sniper first" switch, and an explicit confirm.
 *   running  : sells one coin at a time; each row shows queued / selling /
 *              waiting (rate limit) / sold / failed live. Stop finishes the
 *              current sell and skips the rest.
 *   done     : totals, Retry for failed rows, and a fresh balance sweep that
 *              offers to sell anything still left (a buy that landed mid-run).
 *
 * Routing and ordering live in src/shared/liquidate.js. Open sniper positions
 * close through POST /api/sniper/close (claims the row so the worker cannot sell
 * the same bag, books realized PnL); everything else sells through
 * POST /api/agents/:id/solana/trade with a stable idempotency key per coin.
 * Coin-agnostic: it sells whatever the wallet actually holds.
 */

import { planLiquidation, runLiquidation, summarizeLiquidation } from '../shared/liquidate.js';
import { executeAgentTrade, fetchAgentHoldings, TradeError } from '../agent-solana-wallet.js';
import { consumeCsrfToken } from '../api.js';
import { ensureRiskAck } from '../shared/risk-ack.js';
import { formatSol, formatUsd, escapeHtml as esc } from './util.js';
import { shortAddress as short } from '../shared/address.js';

const SLIPPAGE_CHOICES = [300, 500, 1000]; // 3% / 5% / 10%
const DEFAULT_SLIPPAGE_BPS = 500;

const STYLE_ID = 'awh-sellall-style';
const STYLE = `
.awh-sa { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; padding: 14px; border-radius: var(--radius-md,10px); border: 1px solid color-mix(in srgb, var(--danger,#f87171) 35%, var(--stroke, rgba(255,255,255,.08))); background: color-mix(in srgb, var(--danger,#f87171) 5%, var(--surface-1, rgba(255,255,255,.03))); animation: awh-fade var(--duration-base,220ms) var(--ease-out,ease); }
.awh-sa-h { margin: 0; font-size: var(--text-md,.8125rem); font-weight: 700; color: var(--ink-bright,#fff); }
.awh-sa-sub { margin: 0; font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); line-height: 1.5; }
.awh-sa-bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); }
.awh-sa-check { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; color: var(--ink,#e8e8e8); font-size: var(--text-sm,.764rem); }
.awh-sa-check input { width: 16px; height: 16px; accent-color: var(--danger,#f87171); cursor: pointer; flex: none; }
.awh-sa-check input:focus-visible { outline: var(--focus-ring-width,2px) solid var(--focus-ring-color,#fff); outline-offset: 2px; }
.awh-sa-check input:disabled { cursor: not-allowed; }
.awh-sa-list { list-style: none; margin: 0; padding: 0; max-height: 360px; overflow-y: auto; border-top: 1px solid var(--stroke, rgba(255,255,255,.06)); }
.awh-sa-row { display: flex; align-items: center; gap: 10px; padding: 9px 2px; border-bottom: 1px solid var(--stroke, rgba(255,255,255,.06)); font-size: var(--text-sm,.764rem); min-height: 44px; }
.awh-sa-row:last-child { border-bottom: none; }
.awh-sa-row.is-busy { opacity: .6; }
.awh-sa-img, .awh-sa-ph { width: 26px; height: 26px; border-radius: 50%; flex: none; object-fit: cover; background: var(--surface-3, rgba(255,255,255,.08)); display: inline-flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; color: var(--ink-dim,#888); }
.awh-sa-main { flex: 1 1 auto; min-width: 0; }
.awh-sa-sym { font-weight: 600; color: var(--ink-bright,#fff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.awh-sa-meta { color: var(--ink-dim,#888); font-size: var(--text-2xs,.6875rem); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.awh-sa-tag { display: inline-block; margin-left: 6px; padding: 1px 6px; border-radius: var(--radius-pill,999px); font-size: var(--text-2xs,.6875rem); font-weight: 600; color: var(--accent,#9b8cff); background: color-mix(in srgb, var(--accent,#9b8cff) 14%, transparent); vertical-align: 1px; }
.awh-sa-amt { flex: none; text-align: right; font-variant-numeric: tabular-nums; color: var(--ink,#e8e8e8); }
.awh-sa-amt small { display: block; color: var(--ink-dim,#888); font-size: var(--text-2xs,.6875rem); }
.awh-sa-st { flex: none; min-width: 92px; text-align: right; font-size: var(--text-2xs,.6875rem); font-weight: 600; font-variant-numeric: tabular-nums; }
.awh-sa-st a { color: inherit; }
.awh-sa-st.is-queued, .awh-sa-st.is-skipped, .awh-sa-st.is-busy { color: var(--ink-dim,#888); }
.awh-sa-st.is-selling, .awh-sa-st.is-waiting { color: var(--warn,#fbbf24); }
.awh-sa-st.is-sold { color: var(--success,#4ade80); }
.awh-sa-st.is-failed { color: var(--danger,#f87171); }
.awh-sa-err { color: var(--danger,#f87171); font-size: var(--text-2xs,.6875rem); white-space: normal; }
.awh-sa-spin { display: inline-block; width: 10px; height: 10px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; vertical-align: -1px; margin-right: 5px; animation: awh-sa-spin .8s linear infinite; }
@keyframes awh-sa-spin { to { transform: rotate(360deg); } }
.awh-sa-opts { display: flex; flex-direction: column; gap: 10px; }
.awh-sa-slip { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: var(--text-sm,.764rem); color: var(--ink-dim,#888); }
.awh-sa-chip { appearance: none; font: inherit; font-size: var(--text-sm,.764rem); color: var(--ink,#e8e8e8); background: var(--surface-2, rgba(255,255,255,.05)); border: 1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-pill,999px); padding: 4px 12px; cursor: pointer; transition: background var(--duration-fast,140ms), border-color var(--duration-fast,140ms); }
.awh-sa-chip:hover:not([aria-pressed="true"]) { background: var(--surface-3, rgba(255,255,255,.08)); border-color: var(--stroke-strong, rgba(255,255,255,.14)); }
.awh-sa-chip[aria-pressed="true"] { background: var(--accent,#fff); color: #0a0a0a; border-color: var(--accent,#fff); }
.awh-sa-chip:focus-visible { outline: var(--focus-ring-width,2px) solid var(--focus-ring-color,#fff); outline-offset: 2px; }
.awh-sa-note { font-size: var(--text-2xs,.6875rem); color: var(--ink-dim,#888); line-height: 1.5; margin: 0; }
.awh-sa-alert { padding: 9px 11px; border-radius: var(--radius-sm,6px); font-size: var(--text-sm,.764rem); line-height: 1.45; }
.awh-sa-alert--err { color: var(--danger,#f87171); background: color-mix(in srgb, var(--danger,#f87171) 10%, transparent); border: 1px solid color-mix(in srgb, var(--danger,#f87171) 30%, transparent); }
.awh-sa-alert--ok { color: var(--success,#4ade80); background: color-mix(in srgb, var(--success,#4ade80) 10%, transparent); border: 1px solid color-mix(in srgb, var(--success,#4ade80) 30%, transparent); }
.awh-sa-alert--info { color: var(--ink,#e8e8e8); background: var(--surface-2, rgba(255,255,255,.05)); border: 1px solid var(--stroke, rgba(255,255,255,.08)); }
.awh-sa-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.awh-sa-actions .awh-btn { flex: 1 1 140px; justify-content: center; }
.awh-sa-go:not(:disabled) { background: var(--danger,#f87171); color: #0a0a0a; border-color: var(--danger,#f87171); font-weight: 600; }
.awh-sa-go:hover:not(:disabled) { background: color-mix(in srgb, var(--danger,#f87171) 88%, #000); }
.awh-sa-go:active:not(:disabled) { transform: translateY(1px); }
.awh-sa-skel { height: 34px; border-radius: 6px; background: var(--surface-2, rgba(255,255,255,.05)); animation: awh-skel 1.4s ease-in-out infinite; }
.awh-sa-skel + .awh-sa-skel { margin-top: 6px; }
@media (prefers-reduced-motion: reduce) { .awh-sa, .awh-sa-skel, .awh-sa-spin { animation: none; } }
@media (max-width: 520px) { .awh-sa-st { min-width: 74px; } .awh-sa-amt small { display: none; } }
`;

function injectStyle() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const tag = document.createElement('style');
	tag.id = STYLE_ID;
	tag.textContent = STYLE;
	document.head.appendChild(tag);
}

function fmtTokens(n) {
	if (n == null || !Number.isFinite(n)) return '';
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
	if (n >= 1) return n.toLocaleString('en-US', { maximumFractionDigits: 4 });
	return n.toPrecision(4).replace(/\.?0+$/, '');
}

let _uid = 0;
function newKey() {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	_uid += 1;
	return `sellall-${Date.now()}-${_uid}-${Math.floor(Math.random() * 1e9)}`;
}

/** Same error envelope the trade client parses: { error, error_description, ...detail }. */
async function sendJson(method, url, body) {
	const headers = { accept: 'application/json' };
	if (method !== 'GET') {
		headers['content-type'] = 'application/json';
		const token = await consumeCsrfToken();
		if (token) headers['x-csrf-token'] = token;
	}
	let resp;
	try {
		resp = await fetch(url, { method, credentials: 'include', headers, body: body ? JSON.stringify(body) : undefined });
	} catch {
		throw new TradeError('Network unreachable. Check your connection and try again.', { code: 'network_error' });
	}
	const j = await resp.json().catch(() => ({}));
	if (!resp.ok || (j && j.error != null && j.data == null && method !== 'GET')) {
		const code = typeof j.error === 'string' ? j.error : j?.error?.code || `http_${resp.status}`;
		const message = j?.error_description || j?.error?.message || `Request failed (${resp.status})`;
		const detail = { ...j };
		delete detail.error;
		delete detail.error_description;
		throw new TradeError(message, { code, status: resp.status, detail });
	}
	return j.data ?? j;
}

/** Plain-language reason for a failed row; the server message is the fallback. */
function friendlyError(item) {
	switch (item.errorCode) {
		case 'trading_paused':
			return 'Trading is paused on this wallet (kill switch on). Turn it off in the agent’s trade limits, then retry.';
		case 'insufficient_sol_for_fees':
			return 'Not enough SOL left to pay the network fee. Add a little SOL, then retry.';
		case 'no_market':
			return 'No market for this coin right now (no curve or pool). It cannot be sold until one exists.';
		case 'price_impact_too_high':
			return `${item.error} Raise max slippage or sell it by hand in smaller pieces.`;
		case 'position_busy':
			return 'The agent is selling this coin itself right now. Check again in a moment.';
		case 'sell_retry':
			return 'The sell did not land; nothing moved. Retry.';
		case 'network_error':
			return 'Network unreachable. Retry when you are back online.';
		default:
			return item.error || 'The sell did not complete.';
	}
}

/**
 * @param {object} p
 * @param {object} p.ctx                   wallet hub tab context
 * @param {() => void} [p.onSettled]       fired after a run finishes, so the host can refresh balances
 * @param {() => void} [p.onClose]         fired when the owner dismisses the panel
 */
export function createSellAll({ ctx, onSettled, onClose }) {
	injectStyle();
	const el = document.createElement('div');
	el.className = 'awh-sa-host';

	const s = {
		phase: 'closed', // closed | loading | error | empty | review | running | done
		network: 'mainnet',
		items: [],
		slippageBps: DEFAULT_SLIPPAGE_BPS,
		strategyArmed: false,
		pauseSniper: true,
		sniperPaused: false,
		loadError: null,
		startError: null,
		leftovers: null, // fresh plan after a run, minus coins already shown as failed
		sweeping: false,
	};
	let controller = null;
	let destroyed = false;
	let loadSeq = 0;

	const agentName = () => ctx.agent?.name || 'this agent';
	const selectable = () => s.items.filter((i) => !i.busy && i.state !== 'sold');
	const selected = () => s.items.filter((i) => i.selected && !i.busy && i.state !== 'sold');

	// ── data ──────────────────────────────────────────────────────────────
	async function fetchPositions(net) {
		const d = await sendJson('GET', `/api/sniper/close?agent_id=${encodeURIComponent(ctx.agentId)}&network=${encodeURIComponent(net)}`);
		return d?.positions || [];
	}

	async function fetchMeta(net) {
		try {
			const r = await fetch(`/api/agents/${encodeURIComponent(ctx.agentId)}/portfolio?network=${encodeURIComponent(net)}`, { credentials: 'include' });
			if (!r.ok) return {};
			const j = await r.json();
			const meta = {};
			for (const h of j?.data?.holdings || []) {
				if (!h?.mint || h.isNative) continue;
				meta[h.mint] = { symbol: h.symbol || null, name: h.name || null, usd_value: h.usd_value ?? null, image: h.logo || null };
			}
			return meta;
		} catch {
			return {}; // display enrichment only: rows fall back to the short mint
		}
	}

	async function fetchArmed(net) {
		try {
			const d = await sendJson('GET', '/api/sniper/strategy');
			const st = (d?.strategies || []).find((x) => x.agent_id === ctx.agentId && x.network === net);
			return !!(st && st.enabled && !st.kill_switch);
		} catch {
			return false; // no strategy readable means nothing to pause
		}
	}

	async function plan(net) {
		const [holdings, positions, meta] = await Promise.all([
			fetchAgentHoldings(ctx.agentId, net),
			fetchPositions(net),
			fetchMeta(net),
		]);
		return planLiquidation({ holdings: holdings?.tokens || [], sniperPositions: positions, meta })
			.map((it) => ({ ...it, key: newKey(), note: null }));
	}

	async function open() {
		if (s.phase === 'running') { el.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); return; }
		const seq = ++loadSeq;
		s.network = ctx.getNetwork();
		s.phase = 'loading';
		s.loadError = null;
		s.startError = null;
		s.leftovers = null;
		s.sniperPaused = false;
		render();
		el.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
		try {
			const [items, armed] = await Promise.all([plan(s.network), fetchArmed(s.network)]);
			if (destroyed || seq !== loadSeq) return;
			s.items = items;
			s.strategyArmed = armed;
			s.pauseSniper = armed;
			s.phase = items.length ? 'review' : 'empty';
		} catch (e) {
			if (destroyed || seq !== loadSeq) return;
			s.loadError = e?.message || 'Could not read the wallet.';
			s.phase = 'error';
		}
		render();
		el.querySelector('[data-sa="go"], [data-sa="close"], [data-sa="retry-load"]')?.focus?.({ preventScroll: true });
	}

	function close() {
		if (s.phase === 'running') return;
		loadSeq += 1;
		s.phase = 'closed';
		s.items = [];
		render();
		onClose?.();
	}

	// ── selling ──────────────────────────────────────────────────────────
	async function liveBalances(net) {
		const h = await fetchAgentHoldings(ctx.agentId, net);
		const map = new Map();
		for (const t of h?.tokens || []) {
			try { map.set(t.mint, BigInt(t.amount_raw || '0')); } catch { /* skip malformed */ }
		}
		return map;
	}

	async function walletSell(item, net) {
		const d = await executeAgentTrade({
			agentId: ctx.agentId,
			side: 'sell',
			mint: item.mint,
			tokenAmountRaw: item.amountRaw,
			slippageBps: s.slippageBps,
			network: net,
			idempotencyKey: item.key,
		});
		const out = Number(d?.out?.amount);
		return { solOut: Number.isFinite(out) ? out : null, explorer: d?.explorer || null, simulated: false };
	}

	async function sellOne(item, net) {
		if (item.route !== 'sniper') return walletSell(item, net);
		try {
			const d = await sendJson('POST', '/api/sniper/close', { agent_id: ctx.agentId, network: net, position_id: item.positionId });
			const out = Number(d?.sol_out);
			return { solOut: Number.isFinite(out) ? out : null, explorer: d?.explorer || null, simulated: !!d?.simulated };
		} catch (e) {
			if (e?.code !== 'already_closed' && e?.code !== 'not_found') throw e;
			// The agent closed the position between review and now. Sell whatever
			// of the coin is still in the wallet (a kept moon bag, a partial fill).
			const live = (await liveBalances(net)).get(item.mint) || 0n;
			if (live <= 0n) {
				item.note = 'The agent already sold it.';
				return { solOut: null };
			}
			item.route = 'wallet';
			item.amountRaw = live.toString();
			return walletSell(item, net);
		}
	}

	async function pauseSniper(net) {
		await sendJson('POST', '/api/sniper/strategy', { agent_id: ctx.agentId, network: net, enabled: false });
		s.sniperPaused = true;
		s.strategyArmed = false;
	}

	// A coin that failed, or that Stop skipped, can be sold again. One skipped
	// because it already left the wallet carries a note and cannot.
	const isUnsold = (it) => it.state === 'failed' || (it.state === 'skipped' && !it.note);

	async function start(onlyUnsold = false) {
		if (s.phase === 'running') return;
		const net = s.network;
		if (onlyUnsold) {
			for (const it of s.items) {
				if (isUnsold(it)) { it.selected = true; it.state = 'queued'; it.key = newKey(); it.error = null; it.errorCode = null; }
				else if (it.state !== 'sold') it.selected = false;
			}
		}
		if (!selected().length) return;
		if (net !== 'devnet' && !(await ensureRiskAck({ context: 'trade' }))) return;
		s.startError = null;

		if (!onlyUnsold && s.pauseSniper && s.strategyArmed) {
			try {
				await pauseSniper(net);
				ctx.toast?.(`Paused ${agentName()}’s sniper`);
			} catch (e) {
				s.startError = `Couldn’t pause the sniper: ${e?.message || 'unknown error'}. Untick “Pause the sniper first” to sell without pausing, or try again.`;
				render();
				return;
			}
		}

		// Size wallet sells to what is in the wallet right now: the review screen may
		// have sat open while the agent traded.
		try {
			const live = await liveBalances(net);
			for (const it of selected()) {
				if (it.route !== 'wallet') continue;
				const bal = live.get(it.mint) || 0n;
				if (bal <= 0n) { it.selected = false; it.state = 'skipped'; it.note = 'No longer in the wallet.'; }
				else it.amountRaw = bal.toString();
			}
		} catch {
			// Balance re-read is a refinement; the planned amounts were read moments ago.
		}

		controller = new AbortController();
		s.phase = 'running';
		render();
		el.querySelector('[data-sa="stop"]')?.focus?.({ preventScroll: true });
		try {
			await runLiquidation({
				items: s.items,
				sellOne: (it) => sellOne(it, net),
				onUpdate: (it) => { if (!destroyed) { renderRow(it); renderProgress(); } },
				signal: controller.signal,
			});
		} finally {
			controller = null;
		}
		if (destroyed) return;
		s.phase = 'done';
		render();
		el.querySelector('[data-sa="done"]')?.focus?.({ preventScroll: true });
		onSettled?.();
		sweep(net);
	}

	// After a run, read the wallet again. A buy that landed mid-run (the sniper's
	// strategy cache can let one more through) or dust the plan missed shows up
	// here with a one-tap path back into review.
	async function sweep(net) {
		s.sweeping = true;
		renderSweep();
		try {
			const fresh = await plan(net);
			if (destroyed || s.phase !== 'done') return;
			const unsold = new Set(s.items.filter(isUnsold).map((i) => i.mint));
			s.leftovers = fresh.filter((i) => !unsold.has(i.mint));
		} catch {
			s.leftovers = null;
		} finally {
			s.sweeping = false;
			if (!destroyed && s.phase === 'done') renderSweep();
		}
	}

	function reviewLeftovers() {
		if (!s.leftovers?.length) return;
		const unsold = s.items.filter(isUnsold);
		s.items = [...unsold.map((i) => ({ ...i, state: 'queued', selected: true, key: newKey(), error: null, errorCode: null })), ...s.leftovers];
		s.leftovers = null;
		s.phase = 'review';
		render();
	}

	// ── rendering ─────────────────────────────────────────────────────────
	function rowStatusHtml(it) {
		switch (it.state) {
			case 'busy': return `<span class="awh-sa-st is-busy">Agent busy</span>`;
			case 'queued': return s.phase === 'review' ? '' : `<span class="awh-sa-st is-queued">${it.selected ? 'Queued' : 'Not selected'}</span>`;
			case 'selling': return `<span class="awh-sa-st is-selling"><span class="awh-sa-spin" aria-hidden="true"></span>Selling</span>`;
			case 'waiting': return `<span class="awh-sa-st is-waiting">Waiting ${it.waitSeconds}s</span>`;
			case 'skipped': return `<span class="awh-sa-st is-skipped">Skipped</span>`;
			case 'failed': return `<span class="awh-sa-st is-failed">Failed</span>`;
			case 'sold': {
				const amt = it.solOut != null ? `+◎${formatSol(it.solOut)}` : 'Sold';
				const label = `${amt}${it.simulated ? ' (sim)' : ''}`;
				return `<span class="awh-sa-st is-sold">${it.explorer ? `<a href="${esc(it.explorer)}" target="_blank" rel="noopener" aria-label="${esc(label)}, view transaction">${esc(label)} ↗</a>` : esc(label)}</span>`;
			}
			default: return '';
		}
	}

	function rowHtml(it, idx) {
		const sym = it.symbol || short(it.mint, 4, 4);
		const img = it.image
			? `<img class="awh-sa-img" src="${esc(it.image)}" alt="" loading="lazy" data-fallback="element" data-fallback-tag="span" data-fallback-class="awh-sa-ph" data-fallback-text="${esc(sym.slice(0, 2))}">`
			: `<span class="awh-sa-ph" aria-hidden="true">${esc(sym.slice(0, 2))}</span>`;
		const editable = s.phase === 'review' && !it.busy;
		const sub = it.busy
			? esc(it.busyReason)
			: it.state === 'failed'
				? `<span class="awh-sa-err">${esc(friendlyError(it))}</span>`
				: it.note
					? esc(it.note)
					: `${esc(it.name || '')}${it.name ? ' · ' : ''}<span class="awh-mono">${esc(short(it.mint, 4, 4))}</span>`;
		const check = s.phase === 'review'
			? `<input type="checkbox" data-sa-pick="${idx}" ${it.selected && !it.busy ? 'checked' : ''} ${editable ? '' : 'disabled'} aria-label="Sell ${esc(sym)}">`
			: '';
		return `<li class="awh-sa-row${it.busy ? ' is-busy' : ''}" data-sa-row="${idx}">
			${check ? `<label class="awh-sa-check">${check}</label>` : ''}
			${img}
			<div class="awh-sa-main">
				<div class="awh-sa-sym">${esc(sym)}${it.route === 'sniper' ? '<span class="awh-sa-tag" title="Closed through the sniper so its P&amp;L is booked">Sniper</span>' : ''}</div>
				<div class="awh-sa-meta">${sub}</div>
			</div>
			<div class="awh-sa-amt">${esc(fmtTokens(it.uiAmount))}${it.usdValue != null ? `<small>${esc(formatUsd(it.usdValue) || '')}</small>` : ''}</div>
			${rowStatusHtml(it)}
		</li>`;
	}

	function renderRow(it) {
		const idx = s.items.indexOf(it);
		const row = el.querySelector(`[data-sa-row="${idx}"]`);
		if (row) row.outerHTML = rowHtml(it, idx);
	}

	function progressText() {
		const sum = summarizeLiquidation(s.items);
		const total = s.items.filter((i) => i.selected && !i.busy).length + sum.skipped;
		const doneCount = sum.sold + sum.failed + sum.skipped;
		return `Selling ${Math.min(doneCount + 1, total)} of ${total}…${sum.solOut != null ? ` ◎${formatSol(sum.solOut)} received so far.` : ''}`;
	}

	function renderProgress() {
		const p = el.querySelector('[data-sa="progress"]');
		if (p && s.phase === 'running') p.textContent = progressText();
	}

	function summaryHtml() {
		const sum = summarizeLiquidation(s.items);
		const parts = [];
		if (sum.sold) parts.push(`Sold ${sum.sold} coin${sum.sold === 1 ? '' : 's'}${sum.solOut != null ? ` for ◎${formatSol(sum.solOut)}` : ''}.`);
		if (sum.failed) parts.push(`${sum.failed} failed; see the reason on each row.`);
		if (sum.skipped) parts.push(`${sum.skipped} skipped.`);
		if (sum.busy) parts.push(`${sum.busy} left to the agent, which was already trading ${sum.busy === 1 ? 'it' : 'them'}.`);
		if (!parts.length) parts.push('Nothing was sold.');
		const tone = sum.failed ? 'err' : sum.sold ? 'ok' : 'info';
		const paused = s.sniperPaused
			? ` The sniper is paused; re-arm it from <a href="/dashboard/sniper">the sniper dashboard</a> when you are ready.`
			: '';
		return `<div class="awh-sa-alert awh-sa-alert--${tone}" role="status">${esc(parts.join(' '))}${paused}</div>`;
	}

	function sweepHtml() {
		if (s.sweeping) return `<p class="awh-sa-note" aria-live="polite">Checking the wallet for anything left…</p>`;
		if (!s.leftovers) return '';
		if (!s.leftovers.length) return `<p class="awh-sa-note">Nothing else left to sell. Only SOL and stablecoins remain in the wallet.</p>`;
		const n = s.leftovers.length;
		return `<div class="awh-sa-alert awh-sa-alert--info" role="status">
			${n} coin${n === 1 ? ' is' : 's are'} still in the wallet (bought during the sell, or left over).
			<button class="awh-tr-link" type="button" data-sa="leftovers" style="color:var(--accent,#fff);background:none;border:none;font:inherit;font-weight:600;cursor:pointer;padding:0;text-decoration:underline">Review ${n === 1 ? 'it' : 'them'}</button>
		</div>`;
	}

	function renderSweep() {
		const host = el.querySelector('[data-sa="sweep"]');
		if (!host) return;
		host.innerHTML = sweepHtml();
		host.querySelector('[data-sa="leftovers"]')?.addEventListener('click', reviewLeftovers);
	}

	function listHtml() {
		return `<ul class="awh-sa-list">${s.items.map(rowHtml).join('')}</ul>`;
	}

	function render() {
		if (destroyed) return;
		if (s.phase === 'closed') { el.innerHTML = ''; return; }
		let body = '';
		const title = `<h3 class="awh-sa-h" id="awh-sa-h">Sell all coins</h3>`;
		if (s.phase === 'loading') {
			body = `${title}<p class="awh-sa-sub">Reading ${esc(agentName())}’s wallet and sniper positions…</p>
				<div aria-busy="true" aria-label="Loading holdings"><div class="awh-sa-skel"></div><div class="awh-sa-skel" style="width:85%"></div><div class="awh-sa-skel" style="width:70%"></div></div>`;
		} else if (s.phase === 'error') {
			body = `${title}<div class="awh-sa-alert awh-sa-alert--err" role="alert">Couldn’t read the wallet: ${esc(s.loadError)}. Nothing was sold.</div>
				<div class="awh-sa-actions"><button class="awh-btn" type="button" data-sa="close">Cancel</button><button class="awh-btn awh-btn--primary" type="button" data-sa="retry-load">Try again</button></div>`;
		} else if (s.phase === 'empty') {
			body = `${title}<div class="awh-sa-alert awh-sa-alert--info" role="status">Nothing to sell. ${esc(agentName())} holds no coins on ${esc(s.network)}, only SOL and stablecoins. When the agent buys something, it shows up here.</div>
				<div class="awh-sa-actions"><button class="awh-btn" type="button" data-sa="close">Close</button></div>`;
		} else if (s.phase === 'review') {
			const n = selected().length;
			const all = selectable();
			const allOn = all.length > 0 && all.every((i) => i.selected);
			const busyN = s.items.filter((i) => i.busy).length;
			body = `${title}
				<p class="awh-sa-sub">Sells the selected coins from ${esc(agentName())}’s wallet back to SOL, one at a time, at market price. SOL and stablecoins stay where they are.</p>
				<div class="awh-sa-bar">
					<label class="awh-sa-check"><input type="checkbox" data-sa="all" ${allOn ? 'checked' : ''} ${all.length ? '' : 'disabled'}> Select all (${all.length})</label>
					${busyN ? `<span>${busyN} coin${busyN === 1 ? '' : 's'} the agent is trading right now ${busyN === 1 ? 'is' : 'are'} left alone.</span>` : ''}
				</div>
				${listHtml()}
				<div class="awh-sa-opts">
					<div class="awh-sa-slip" role="group" aria-label="Max slippage per sell">
						<span>Max slippage</span>
						${SLIPPAGE_CHOICES.map((b) => `<button type="button" class="awh-sa-chip" data-sa-slip="${b}" aria-pressed="${s.slippageBps === b}">${b / 100}%</button>`).join('')}
					</div>
					${s.strategyArmed ? `<label class="awh-sa-check"><input type="checkbox" data-sa="pause" ${s.pauseSniper ? 'checked' : ''}> Pause ${esc(agentName())}’s sniper first, so it does not buy again while this runs</label>` : ''}
					<p class="awh-sa-note">Each sell is a real on-chain transaction. A coin with thin liquidity can fail on price impact; it stays in the wallet and you can retry it.</p>
				</div>
				${s.startError ? `<div class="awh-sa-alert awh-sa-alert--err" role="alert">${esc(s.startError)}</div>` : ''}
				<div class="awh-sa-actions">
					<button class="awh-btn" type="button" data-sa="close">Cancel</button>
					<button class="awh-btn awh-sa-go" type="button" data-sa="go" ${n ? '' : 'disabled'}>${n ? `Sell ${n} coin${n === 1 ? '' : 's'}` : 'Select coins to sell'}</button>
				</div>`;
		} else if (s.phase === 'running') {
			body = `${title}
				<p class="awh-sa-sub" data-sa="progress" aria-live="polite">${esc(progressText())}</p>
				${listHtml()}
				<p class="awh-sa-note">Keep this tab open until it finishes. Stop lets the current sell finish and skips the rest.</p>
				<div class="awh-sa-actions"><button class="awh-btn" type="button" data-sa="stop">Stop after this coin</button></div>`;
		} else if (s.phase === 'done') {
			const unsoldN = s.items.filter(isUnsold).length;
			body = `${title}
				${summaryHtml()}
				${listHtml()}
				<div data-sa="sweep">${sweepHtml()}</div>
				<div class="awh-sa-actions">
					${unsoldN ? `<button class="awh-btn awh-sa-go" type="button" data-sa="retry-failed">Sell the ${unsoldN} unsold</button>` : ''}
					<button class="awh-btn awh-btn--primary" type="button" data-sa="done">Done</button>
				</div>`;
		}
		el.innerHTML = `<section class="awh-sa" aria-labelledby="awh-sa-h">${body}</section>`;
		wire();
	}

	function wire() {
		el.querySelectorAll('[data-sa="close"], [data-sa="done"]').forEach((b) => b.addEventListener('click', close));
		el.querySelector('[data-sa="retry-load"]')?.addEventListener('click', open);
		el.querySelector('[data-sa="go"]')?.addEventListener('click', () => start(false));
		el.querySelector('[data-sa="retry-failed"]')?.addEventListener('click', () => start(true));
		el.querySelector('[data-sa="leftovers"]')?.addEventListener('click', reviewLeftovers);
		el.querySelector('[data-sa="stop"]')?.addEventListener('click', (e) => {
			controller?.abort();
			e.currentTarget.disabled = true;
			e.currentTarget.textContent = 'Stopping after this coin…';
		});
		el.querySelector('[data-sa="all"]')?.addEventListener('change', (e) => {
			for (const it of selectable()) it.selected = e.currentTarget.checked;
			render();
			el.querySelector('[data-sa="all"]')?.focus();
		});
		el.querySelectorAll('[data-sa-pick]').forEach((cb) => cb.addEventListener('change', () => {
			const it = s.items[Number(cb.dataset.saPick)];
			if (!it || it.busy) return;
			it.selected = cb.checked;
			render();
			el.querySelector(`[data-sa-pick="${cb.dataset.saPick}"]`)?.focus();
		}));
		el.querySelectorAll('[data-sa-slip]').forEach((b) => b.addEventListener('click', () => {
			s.slippageBps = Number(b.dataset.saSlip);
			el.querySelectorAll('[data-sa-slip]').forEach((x) => x.setAttribute('aria-pressed', String(Number(x.dataset.saSlip) === s.slippageBps)));
		}));
		el.querySelector('[data-sa="pause"]')?.addEventListener('change', (e) => { s.pauseSniper = e.currentTarget.checked; });
		el.querySelector('.awh-sa')?.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && s.phase !== 'running') { e.preventDefault(); close(); }
		});
	}

	return {
		el,
		open,
		close,
		isOpen: () => s.phase !== 'closed',
		isRunning: () => s.phase === 'running',
		/** The network changed under the panel: a review for the old network is stale. */
		reset() { if (s.phase !== 'running') { loadSeq += 1; s.phase = 'closed'; s.items = []; render(); } },
		destroy() {
			destroyed = true;
			controller?.abort();
		},
	};
}
