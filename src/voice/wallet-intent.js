/**
 * Conversational Wallet — the talk-to-trade layer for an owner's agent.
 *
 *   owner speaks/types ─▶ heuristic gate ─▶ /api/agents/:id/solana/intent
 *                                               │  (Claude tool use → strict intent)
 *                                               ▼
 *                         resolve amounts vs REAL balances/holdings
 *                                               │
 *                                               ▼
 *                         REAL preview (trade quote) / simulate (withdraw)
 *                                               │
 *                                               ▼
 *                     read-back card ── explicit confirm (tap or "yes") ──▶
 *                                               │
 *                                               ▼
 *               REAL task-05 trade / withdraw endpoint (owner-only, CSRF,
 *               spend-policy gated, audited) ─▶ signature + explorer link
 *
 * Nothing here signs or moves funds on its own path — it calls the same endpoints
 * the wallet HUD uses. Misunderstanding is treated as a safety event: the parsed
 * intent is shown next to the raw words, "cancel" is always one tap/word away, and
 * a confirm times out untouched after 30s. The only coin promoted is $THREE; any
 * other mint is a runtime snipe target the owner supplied.
 */

import {
	previewAgentTrade,
	executeAgentTrade,
	fetchAgentHoldings,
} from '../agent-solana-wallet.js';
import { getSolPriceUsd } from '../shared/usd-price.js';
import { consumeCsrfToken } from '../api.js';
import { log } from '../shared/log.js';
import { shortAddress as shortMint } from '../shared/address.js';

const DEFAULT_SLIPPAGE_BPS = 300; // 3% — matches the trade engine default
const CONFIRM_TIMEOUT_MS = 30_000;
const SOL_FEE_HEADROOM = 0.01; // leave room for fees/rent on a percent/max buy
const CONFIRM_WORDS = /\b(yes|yep|yeah|confirm|do it|send it|go|approve|proceed)\b/i;
const CANCEL_WORDS = /\b(no|nope|cancel|stop|abort|nevermind|never mind|wait)\b/i;

// Heuristic gate: does this utterance even look like a money command? Only matches
// route to the (paid) intent parser; everything else stays normal chat. A false
// positive is harmless — the parser returns action:"none" and we hand back to chat.
const MONEY_VERBS = /\b(tip|send|pay|swap|snipe|buy|sell|trade|withdraw|deposit|cash\s?out|convert)\b/i;
const MONEY_NOUNS = /(\bSOL\b|\bUSDC\b|\$?THREE\b|\bsolana\b|◎|\$\d|\bdollars?\b|\bcoins?\b|\btokens?\b|\bwallet\b)/i;

export function isWalletCommand(text) {
	const s = String(text || '');
	if (!MONEY_VERBS.test(s)) return false;
	// A bare verb ("buy") with no money noun/number is too weak — require a hint of
	// an asset or amount so ordinary chat ("sell me on this idea") doesn't trip it.
	return MONEY_NOUNS.test(s) || /\b\d+(\.\d+)?\b/.test(s) || /\b(half|all|everything|max)\b/i.test(s);
}

export class WalletIntentController {
	/**
	 * @param {object} o
	 * @param {string} o.agentId
	 * @param {string} o.network            'mainnet' | 'devnet'
	 * @param {HTMLElement} o.mountEl        overlay element to render the confirm card into
	 * @param {() => {balanceSol:number|null, history:Array}} o.getState
	 * @param {(text:string)=>Promise<void>} o.speak    voice a line through the avatar
	 * @param {(role:'user'|'assistant', text:string)=>void} o.appendTranscript
	 * @param {() => void} [o.onFlourish]    fire the avatar's celebrate emote on a real tx
	 * @param {() => void} [o.onManualFallback]  open the wallet HUD form
	 */
	constructor({ agentId, network, mountEl, getState, speak, appendTranscript, onFlourish, onManualFallback }) {
		this.agentId = agentId;
		this.network = network || 'mainnet';
		this.mountEl = mountEl;
		this.getState = getState || (() => ({ balanceSol: null, history: [] }));
		this.speak = speak || (async () => {});
		this.appendTranscript = appendTranscript || (() => {});
		this.onFlourish = onFlourish || (() => {});
		this.onManualFallback = onManualFallback || null;
		this._pending = null; // { plan } awaiting confirm
		this._card = null;
		this._timer = null;
		this._holdings = null; // cache within a session
		injectStylesOnce();
	}

	/**
	 * Interceptor entry. Returns true when this layer handled the utterance (chat is
	 * skipped), false to let normal conversation proceed.
	 */
	async handle(utterance) {
		const text = String(utterance || '').trim();
		if (!text) return false;

		// A confirm is on the table — interpret yes / no first, before anything else.
		if (this._pending) {
			if (CANCEL_WORDS.test(text)) {
				this._cancel('You said cancel — nothing was sent.');
				return true;
			}
			if (CONFIRM_WORDS.test(text)) {
				await this._execute();
				return true;
			}
			await this.speak('Say "yes" to confirm, or "cancel" to call it off.');
			return true;
		}

		if (!isWalletCommand(text)) return false;

		let parsed;
		try {
			parsed = await this._parse(text);
		} catch (err) {
			if (err.code === 'intent_unavailable') {
				await this._fail('Voice trading isn\'t set up here — opening the wallet form instead.');
				this.onManualFallback?.();
				return true;
			}
			await this._fail(err.message || 'I couldn\'t understand that — try again or use the wallet form.');
			return true;
		}

		const intent = parsed.intent;
		if (!intent || intent.action === 'none') return false; // hand back to chat
		if (intent.action === 'clarify' || intent.confidence < 0.45) {
			const q = intent.clarifying_question || 'Could you say that again with the amount and destination?';
			this.appendTranscript('assistant', q);
			await this.speak(q);
			return true;
		}

		// Resolve the intent against REAL balances/holdings, then quote it for real.
		let plan;
		try {
			plan = await this._buildPlan(intent);
		} catch (err) {
			if (err.clarify) {
				this.appendTranscript('assistant', err.message);
				await this.speak(err.message);
				return true;
			}
			await this._fail(err.message || 'I couldn\'t prepare that trade.');
			return true;
		}

		this._pending = { plan, rawWords: text };
		this._renderConfirm(plan, text);
		this.appendTranscript('assistant', plan.readback);
		await this.speak(`${plan.readback} Confirm?`);
		return true;
	}

	/** Hard-abort any in-flight confirm (overlay closing, "stop" mid-flow). */
	dispose() {
		this._clearCard();
		this._pending = null;
	}

	// ── parse ──────────────────────────────────────────────────────────────────

	async _parse(utterance) {
		const { balanceSol, history } = this.getState();
		const holdings = await this._getHoldings();
		const resp = await fetch(`/api/agents/${encodeURIComponent(this.agentId)}/solana/intent`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				utterance,
				network: this.network,
				history: (history || []).slice(-6),
				context: {
					balance_sol: typeof balanceSol === 'number' ? balanceSol : null,
					holdings: holdings.map((h) => ({ mint: h.mint, symbol: h.symbol || null, ui_amount: h.ui_amount })),
				},
			}),
		});
		const j = await resp.json().catch(() => ({}));
		if (!resp.ok) {
			const e = new Error(j.error_description || j.error?.message || `parse failed (${resp.status})`);
			e.code = typeof j.error === 'string' ? j.error : j.error?.code;
			throw e;
		}
		return j.data;
	}

	async _getHoldings() {
		if (this._holdings) return this._holdings;
		try {
			const data = await fetchAgentHoldings(this.agentId, this.network);
			this._holdings = Array.isArray(data?.tokens) ? data.tokens : [];
		} catch {
			this._holdings = [];
		}
		return this._holdings;
	}

	// ── plan (resolve amounts + real quote) ──────────────────────────────────────

	async _buildPlan(intent) {
		const slippageBps = intent.slippage_pct != null ? Math.round(intent.slippage_pct * 100) : DEFAULT_SLIPPAGE_BPS;
		if (intent.action === 'buy' || intent.action === 'snipe') {
			return this._planBuy(intent, slippageBps);
		}
		if (intent.action === 'sell') {
			return this._planSell(intent, slippageBps);
		}
		if (intent.action === 'tip' || intent.action === 'withdraw') {
			return this._planTransfer(intent);
		}
		throw clarifyErr('I\'m not sure what to do with that — try "buy", "sell", "tip", or "withdraw".');
	}

	async _planBuy(intent, slippageBps) {
		const mint = intent.target?.mint;
		if (!mint) throw clarifyErr('Which token should I buy? Paste its mint address or say "$THREE".');
		const solAmount = await this._resolveSolSpend(intent);
		const quote = await previewAgentTrade({
			agentId: this.agentId, side: 'buy', mint, solAmount, slippageBps, network: this.network,
		});
		return this._tradePlan({
			kind: intent.action === 'snipe' ? 'snipe' : 'buy',
			side: 'buy', mint, solAmount, slippageBps, quote, intent,
		});
	}

	async _planSell(intent, slippageBps) {
		const mint = intent.target?.mint;
		if (!mint) throw clarifyErr('Which token should I sell? Name it or paste its mint.');
		const holdings = await this._getHoldings();
		const held = holdings.find((h) => h.mint === mint);
		if (!held || !(Number(held.ui_amount) > 0)) {
			throw clarifyErr('You don\'t hold any of that token, so there\'s nothing to sell.');
		}
		const rawTotal = BigInt(held.amount_raw);
		let raw;
		if (intent.amount_unit === 'max' || (intent.amount == null && /all|everything/i.test(intent.readback))) {
			raw = rawTotal;
		} else if (intent.amount_unit === 'percent' && intent.amount != null) {
			raw = (rawTotal * BigInt(Math.round(Math.min(100, intent.amount) * 100))) / 10000n;
		} else if (intent.amount_unit === 'token' && intent.amount != null) {
			raw = BigInt(Math.floor(intent.amount * 10 ** held.decimals));
		} else {
			throw clarifyErr('How much should I sell — a number of tokens, a percentage, or all of it?');
		}
		if (raw <= 0n) throw clarifyErr('That sell amount rounds to zero — try a larger amount.');
		if (raw > rawTotal) raw = rawTotal;
		const quote = await previewAgentTrade({
			agentId: this.agentId, side: 'sell', mint, tokenAmountRaw: raw.toString(), slippageBps, network: this.network,
		});
		return this._tradePlan({
			kind: 'sell', side: 'sell', mint, tokenAmountRaw: raw.toString(),
			sellUi: Number(raw) / 10 ** held.decimals, symbol: held.symbol || shortMint(mint),
			slippageBps, quote, intent,
		});
	}

	_tradePlan({ kind, side, mint, solAmount, tokenAmountRaw, sellUi, symbol, slippageBps, quote, intent }) {
		const tokenSymbol = symbol || (intent.target?.symbol) || shortMint(mint);
		const rows = [];
		if (side === 'buy') {
			rows.push(['Spend', `◎${fmt(solAmount, 4)} SOL`]);
			rows.push(['Receive (est.)', `${fmt(quote.out?.amount, 4)} ${tokenSymbol}`]);
		} else {
			rows.push(['Sell', `${fmt(sellUi, 4)} ${tokenSymbol}`]);
			rows.push(['Receive (est.)', `◎${fmt(quote.out?.amount, 4)} SOL`]);
		}
		if (quote.usd != null) rows.push(['Value', `≈ $${fmt(quote.usd, 2)}`]);
		if (quote.price_impact_pct != null) rows.push(['Price impact', `${fmt(quote.price_impact_pct, 2)}%`]);
		rows.push(['Slippage', `${(slippageBps / 100).toFixed(1)}%`]);
		rows.push(['Network', this.network]);

		const block = quote.guard || quote.funds || (quote.firewall?.verdict === 'block' ? quote.firewall : null);
		return {
			kind,
			title: kind === 'snipe' ? `Snipe ${tokenSymbol}` : side === 'buy' ? `Buy ${tokenSymbol}` : `Sell ${tokenSymbol}`,
			readback: intent.readback || (side === 'buy'
				? `Buy ${tokenSymbol} with ${fmt(solAmount, 4)} SOL.`
				: `Sell ${fmt(sellUi, 4)} ${tokenSymbol} for SOL.`),
			rows,
			blocked: block ? (block.message || 'This trade is blocked by your safety policy.') : null,
			execute: () =>
				executeAgentTrade({
					agentId: this.agentId, side, mint, solAmount, tokenAmountRaw, slippageBps,
					network: this.network, idempotencyKey: cryptoRandom(),
				}),
		};
	}

	async _planTransfer(intent) {
		const dest = intent.destination;
		if (!dest) throw clarifyErr('Where should I send it? Give me a Solana address or a .sol name.');
		const asset = intent.asset || { kind: 'sol' };
		const isSol = asset.kind === 'sol' || asset.kind === 'none';
		const assetField = isSol ? 'SOL' : asset.mint || (asset.kind === 'usdc' ? USDC_MINT[this.network] : null);
		if (!assetField) throw clarifyErr('Which asset should I send — SOL, USDC, or a specific token?');

		let amountField;
		if (intent.amount_unit === 'max') {
			amountField = 'max';
		} else if (intent.amount != null) {
			amountField = intent.amount_unit === 'USD' && isSol ? await this._usdToSol(intent.amount) : intent.amount;
		} else {
			throw clarifyErr('How much should I send?');
		}

		// Real simulate — never touches the key; returns the true amount + USD + any
		// spend-policy rejection before the owner ever confirms.
		const sim = await this._simulateWithdraw({ asset: assetField, amount: amountField, destination: dest });
		const human = sim.amount != null ? sim.amount : amountField;
		const symbol = isSol ? 'SOL' : asset.kind === 'usdc' ? 'USDC' : shortMint(assetField);
		const verb = intent.action === 'tip' ? 'Tip' : 'Withdraw';
		const destShown = intent.destination_label ? `${intent.destination_label} (${shortMint(dest)})` : shortMint(dest);
		const rows = [
			['Send', `${isSol ? '◎' : ''}${fmt(human, 4)} ${symbol}`],
			['To', destShown],
		];
		if (sim.usd != null) rows.push(['Value', `≈ $${fmt(sim.usd, 2)}`]);
		rows.push(['Network', this.network]);

		return {
			kind: intent.action,
			title: `${verb} ${symbol}`,
			readback: intent.readback || `${verb} ${fmt(human, 4)} ${symbol} to ${destShown}.`,
			rows,
			blocked: sim.blocked || null,
			execute: () =>
				this._executeWithdraw({ asset: assetField, amount: amountField, destination: dest }),
		};
	}

	// ── amount resolution ────────────────────────────────────────────────────────

	async _resolveSolSpend(intent) {
		const { balanceSol } = this.getState();
		const unit = intent.amount_unit;
		const amt = intent.amount;
		if (unit === 'SOL' && amt != null) return amt;
		if (unit === 'USD' && amt != null) return this._usdToSol(amt);
		if ((unit === 'percent' || unit === 'max') && balanceSol != null) {
			const spendable = Math.max(0, balanceSol - SOL_FEE_HEADROOM);
			const sol = unit === 'max' ? spendable : spendable * (Math.min(100, amt ?? 0) / 100);
			if (!(sol > 0)) throw clarifyErr('There isn\'t enough SOL in the wallet to cover that and fees.');
			return round(sol, 4);
		}
		if (unit === 'USDC') {
			throw clarifyErr('Trades here are priced in SOL — how much SOL should I spend?');
		}
		throw clarifyErr('How much SOL should I spend?');
	}

	async _usdToSol(usd) {
		const price = await getSolPriceUsd().catch(() => null);
		if (!price) throw clarifyErr('I can\'t fetch the SOL price right now — tell me the amount in SOL instead.');
		return round(usd / price, 4);
	}

	// ── withdraw plumbing ────────────────────────────────────────────────────────

	async _simulateWithdraw({ asset, amount, destination }) {
		const resp = await fetch(`/api/agents/${encodeURIComponent(this.agentId)}/solana/withdraw`, {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ asset, amount, destination, network: this.network, simulate: true }),
		});
		const j = await resp.json().catch(() => ({}));
		if (!resp.ok) {
			// A spend-policy / balance rejection on simulate is the real, honest answer —
			// surface it as a blocked plan rather than throwing.
			return { blocked: j.error_description || j.error?.message || `That transfer was rejected (${resp.status}).` };
		}
		return { amount: j.data?.amount ?? null, usd: j.data?.usd ?? null, blocked: j.data?.err ? 'Simulation reverted on-chain.' : null };
	}

	async _executeWithdraw({ asset, amount, destination }) {
		const headers = { 'content-type': 'application/json' };
		const token = await consumeCsrfToken();
		if (token) headers['x-csrf-token'] = token;
		const resp = await fetch(`/api/agents/${encodeURIComponent(this.agentId)}/solana/withdraw`, {
			method: 'POST',
			credentials: 'include',
			headers,
			body: JSON.stringify({ asset, amount, destination, network: this.network, idempotency_key: cryptoRandom() }),
		});
		const j = await resp.json().catch(() => ({}));
		if (!resp.ok || (j.error != null && j.data == null)) {
			const e = new Error(j.error_description || j.error?.message || `Withdrawal failed (${resp.status})`);
			e.signature = j.signature || j.data?.signature || null;
			e.explorer = j.explorer || j.data?.explorer || null;
			throw e;
		}
		return j.data;
	}

	// ── execute (shared) ─────────────────────────────────────────────────────────

	async _execute() {
		if (!this._pending) return;
		const { plan } = this._pending;
		this._pending = null;
		this._setCardBusy(plan);
		try {
			const result = await plan.execute();
			this._clearCard();
			const sig = result.signature;
			const explorer = result.explorer;
			const line = `Done — ${plan.title.toLowerCase()} confirmed.`;
			this.appendTranscript('assistant', explorer ? `${line} ${explorer}` : line);
			if (explorer) this._renderReceipt(plan, sig, explorer);
			await this.speak(`${line} The signature's in the chat.`);
			this.onFlourish();
		} catch (err) {
			this._clearCard();
			// A submitted-but-unconfirmed trade/withdraw still carries a signature the
			// owner can verify — surface its explorer link rather than implying nothing
			// happened. Trade errors stash it under `detail`; withdraw on the error.
			const explorer = err.explorer || err.detail?.explorer || null;
			const extra = explorer ? ` You can check it here: ${explorer}` : '';
			await this._fail(`${err.message}${extra}`);
		}
	}

	_cancel(line) {
		this._pending = null;
		this._clearCard();
		this.appendTranscript('assistant', line);
		this.speak(line).catch(() => {});
	}

	async _fail(message) {
		this.appendTranscript('assistant', message);
		await this.speak(message).catch(() => {});
	}

	// ── confirm card UI ──────────────────────────────────────────────────────────

	_renderConfirm(plan, rawWords) {
		this._clearCard();
		const card = document.createElement('div');
		card.className = 'tws-wic';
		card.setAttribute('role', 'dialog');
		card.setAttribute('aria-modal', 'true');
		card.setAttribute('aria-label', `Confirm: ${plan.title}`);
		const rowsHtml = plan.rows
			.map(
				([k, v]) =>
					`<div class="tws-wic-row"><span class="tws-wic-k">${esc(k)}</span><span class="tws-wic-v">${esc(v)}</span></div>`,
			)
			.join('');
		card.innerHTML = `
			<div class="tws-wic-head">
				<span class="tws-wic-badge" aria-hidden="true">◎</span>
				<span class="tws-wic-title">${esc(plan.title)}</span>
			</div>
			<div class="tws-wic-said">“${esc(rawWords)}”</div>
			<div class="tws-wic-rows">${rowsHtml}</div>
			${plan.blocked ? `<div class="tws-wic-blocked" role="alert">${esc(plan.blocked)}</div>` : ''}
			<div class="tws-wic-actions">
				<button class="tws-wic-cancel" type="button">Cancel</button>
				<button class="tws-wic-confirm" type="button"${plan.blocked ? ' disabled' : ''}>
					Confirm <span class="tws-wic-count" aria-hidden="true">30</span>
				</button>
			</div>
			<div class="tws-wic-hint">Or say “yes” to confirm, “cancel” to stop.</div>
		`;
		this.mountEl.appendChild(card);
		this._card = card;

		const confirmBtn = card.querySelector('.tws-wic-confirm');
		const cancelBtn = card.querySelector('.tws-wic-cancel');
		cancelBtn.addEventListener('click', () => this._cancel('Cancelled — nothing was sent.'));
		if (!plan.blocked) {
			confirmBtn.addEventListener('click', () => this._execute());
			confirmBtn.focus();
		} else {
			cancelBtn.focus();
		}

		card._onKey = (e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				this._cancel('Cancelled — nothing was sent.');
			}
		};
		card.addEventListener('keydown', card._onKey);

		// 30-second auto-cancel — funds stay untouched if the owner walks away.
		if (!plan.blocked) {
			let left = 30;
			const countEl = card.querySelector('.tws-wic-count');
			this._timer = setInterval(() => {
				left -= 1;
				if (countEl) countEl.textContent = String(Math.max(0, left));
				if (left <= 0) this._cancel('Confirmation timed out — nothing was sent.');
			}, 1000);
		}
	}

	_setCardBusy(plan) {
		if (!this._card) return;
		this._stopTimer();
		this._card.classList.add('tws-wic-busy');
		const actions = this._card.querySelector('.tws-wic-actions');
		if (actions) actions.innerHTML = `<div class="tws-wic-sending">Sending… <span class="tws-wic-spin" aria-hidden="true"></span></div>`;
	}

	_renderReceipt(plan, sig, explorer) {
		const card = document.createElement('div');
		card.className = 'tws-wic tws-wic-done';
		card.setAttribute('role', 'status');
		card.innerHTML = `
			<div class="tws-wic-head">
				<span class="tws-wic-badge tws-wic-ok" aria-hidden="true">✓</span>
				<span class="tws-wic-title">${esc(plan.title)} confirmed</span>
			</div>
			${sig ? `<div class="tws-wic-said tws-wic-sig">${esc(shortMint(sig))}</div>` : ''}
			<div class="tws-wic-actions">
				<a class="tws-wic-explorer" href="${esc(explorer)}" target="_blank" rel="noopener noreferrer">View on explorer ↗</a>
				<button class="tws-wic-cancel" type="button">Done</button>
			</div>
		`;
		this.mountEl.appendChild(card);
		this._card = card;
		const doneBtn = card.querySelector('.tws-wic-cancel');
		doneBtn.addEventListener('click', () => this._clearCard());
		doneBtn.focus();
		setTimeout(() => { if (this._card === card) this._clearCard(); }, 12_000);
	}

	_clearCard() {
		this._stopTimer();
		if (this._card) {
			try { this._card.remove(); } catch {}
			this._card = null;
		}
	}

	_stopTimer() {
		if (this._timer) {
			clearInterval(this._timer);
			this._timer = null;
		}
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────────

const USDC_MINT = {
	mainnet: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
	devnet: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
};

function clarifyErr(message) {
	const e = new Error(message);
	e.clarify = true;
	return e;
}

function cryptoRandom() {
	try {
		return crypto.randomUUID();
	} catch {
		return `wic-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
	}
}

function fmt(n, dp = 2) {
	const x = Number(n);
	if (!Number.isFinite(x)) return '—';
	return x.toLocaleString('en-US', { maximumFractionDigits: dp });
}

function round(n, dp) {
	const f = 10 ** dp;
	return Math.round(n * f) / f;
}


function esc(s) {
	return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function injectStylesOnce() {
	if (typeof document === 'undefined' || document.getElementById('tws-wic-css')) return;
	const el = document.createElement('style');
	el.id = 'tws-wic-css';
	el.textContent = WIC_CSS;
	document.head.appendChild(el);
}

const WALLET_ACCENT = 'rgba(196,181,253,0.9)';
const WIC_CSS = `
.tws-wic {
	position: absolute; left: 50%; bottom: 120px; transform: translateX(-50%);
	width: min(420px, calc(100vw - 32px)); z-index: 30;
	background: rgba(12,12,16,0.92);
	border: 1px solid rgba(139,92,246,0.35);
	border-radius: 16px;
	box-shadow: 0 18px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03) inset;
	backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
	padding: 16px 18px;
	font-family: 'Inter', system-ui, sans-serif; color: #fafafa;
	animation: tws-wic-in 180ms cubic-bezier(0.2,0.8,0.2,1);
}
@keyframes tws-wic-in { from { opacity: 0; transform: translateX(-50%) translateY(8px); } to { opacity: 1; transform: translateX(-50%) translateY(0); } }
.tws-wic-head { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
.tws-wic-badge {
	width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
	display: inline-flex; align-items: center; justify-content: center;
	font-size: 13px; color: ${WALLET_ACCENT};
	background: rgba(139,92,246,0.14); border: 1px solid rgba(139,92,246,0.3);
}
.tws-wic-ok { color: #4ade80; background: rgba(74,222,128,0.14); border-color: rgba(74,222,128,0.35); }
.tws-wic-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 15px; letter-spacing: -0.01em; }
.tws-wic-said {
	font-size: 12.5px; color: #a1a1aa; font-style: italic;
	margin-bottom: 12px; line-height: 1.4;
	border-left: 2px solid rgba(139,92,246,0.4); padding-left: 9px;
}
.tws-wic-sig { font-family: 'JetBrains Mono', monospace; font-style: normal; }
.tws-wic-rows { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.tws-wic-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; font-size: 13px; }
.tws-wic-k { color: #71717a; }
.tws-wic-v { font-family: 'JetBrains Mono', monospace; color: #fafafa; text-align: right; word-break: break-word; }
.tws-wic-blocked {
	font-size: 12.5px; line-height: 1.45; color: #fda4af;
	background: rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.32);
	border-radius: 10px; padding: 8px 11px; margin-bottom: 12px;
}
.tws-wic-actions { display: flex; gap: 8px; align-items: center; }
.tws-wic-actions button { flex: 1; }
.tws-wic-confirm {
	background: ${WALLET_ACCENT}; color: #14101f; border: 0;
	font-family: inherit; font-weight: 700; font-size: 14px;
	padding: 11px 14px; border-radius: 10px; cursor: pointer;
	display: inline-flex; align-items: center; justify-content: center; gap: 7px;
	transition: transform 0.1s, box-shadow 0.15s, opacity 0.15s;
}
.tws-wic-confirm:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(139,92,246,0.35); }
.tws-wic-confirm:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.tws-wic-confirm:disabled { opacity: 0.4; cursor: not-allowed; }
.tws-wic-count {
	font-family: 'JetBrains Mono', monospace; font-size: 11px;
	background: rgba(0,0,0,0.18); border-radius: 6px; padding: 1px 6px; min-width: 22px;
}
.tws-wic-cancel {
	background: rgba(255,255,255,0.06); color: #fafafa;
	border: 1px solid rgba(255,255,255,0.14); font-family: inherit; font-weight: 600;
	font-size: 14px; padding: 11px 14px; border-radius: 10px; cursor: pointer;
	transition: background 0.15s, border-color 0.15s;
}
.tws-wic-cancel:hover { background: rgba(255,255,255,0.12); border-color: rgba(255,255,255,0.25); }
.tws-wic-cancel:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.tws-wic-explorer {
	flex: 1; text-align: center; text-decoration: none;
	background: rgba(139,92,246,0.14); color: ${WALLET_ACCENT};
	border: 1px solid rgba(139,92,246,0.3); font-weight: 600; font-size: 13px;
	padding: 11px 14px; border-radius: 10px; transition: background 0.15s;
}
.tws-wic-explorer:hover { background: rgba(139,92,246,0.24); }
.tws-wic-hint { font-size: 11px; color: #52525b; text-align: center; margin-top: 9px; }
.tws-wic-sending { display: flex; align-items: center; justify-content: center; gap: 9px; font-size: 13px; color: #d4d4d8; padding: 9px; width: 100%; }
.tws-wic-spin { width: 13px; height: 13px; border: 2px solid rgba(255,255,255,0.2); border-top-color: ${WALLET_ACCENT}; border-radius: 50%; animation: tws-wic-spin 0.7s linear infinite; }
@keyframes tws-wic-spin { to { transform: rotate(360deg); } }
.tws-wic-busy { opacity: 0.92; }
@media (max-width: 600px) { .tws-wic { bottom: 96px; padding: 14px; } }
@media (prefers-reduced-motion: reduce) { .tws-wic { animation: none; } .tws-wic-spin { animation-duration: 1.4s; } }
`;

export const __test = { isWalletCommand };
