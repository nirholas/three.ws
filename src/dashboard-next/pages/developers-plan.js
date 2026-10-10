// Developer Hub: the Plan tab.
//
// Live usage against the monthly quota, the plan ladder with a self-serve
// upgrade (credits, USDC or $THREE at the configured discount), downgrade or
// cancel at period end, and the receipts. Every number on screen comes from
// /api/v1/me/dev-plan and /api/v1/dev-plans; nothing is typed here.
//
// Money moves only from the user's own wallet: the server builds the unsigned
// transfer and this tab shows recipient, amount, asset and chain before the
// wallet is asked to sign. Credits are debited server side.

import { get, post, esc, relTime, ApiError } from '../api.js';
import { errorStateHTML, skeletonHTML } from '../../shared/state-kit.js';
import { getAdapter, isUserRejection } from '../../onchain/adapters/index.js';

const CONFIRM_POLL_MS = 3000;
const CONFIRM_MAX_TRIES = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fmtInt = (n) => Number(n || 0).toLocaleString();
const fmtUsd = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

let catalog = null;
let mine = null;

export async function renderPlanTab(root, { showToast }) {
	injectPlanStyles();
	const el = document.createElement('div');
	el.className = 'dev-plan-tab';
	el.innerHTML = skeletonHTML(3, 'card');
	root.appendChild(el);
	try {
		[catalog, mine] = await Promise.all([get('/api/v1/dev-plans'), get('/api/v1/me/dev-plan')]);
		catalog = catalog?.data ?? catalog;
		mine = mine?.data ?? mine;
	} catch (err) {
		el.innerHTML = errorStateHTML({
			title: "Couldn't load your plan",
			body: esc(err instanceof ApiError ? err.message : 'We had trouble reaching the plan service. Check your connection and try again.'),
			scope: 'plan',
		});
		el.querySelector('[data-sk-retry]')?.addEventListener('click', () => {
			el.remove();
			renderPlanTab(root, { showToast });
		});
		return;
	}
	paint(el, { showToast });
}

function paint(el, ctx) {
	const plan = mine.plan;
	const q = mine.quota;
	const pct = q.limit > 0 ? Math.min(100, (q.used / q.limit) * 100) : 0;
	const tone = pct >= 100 ? 'is-over' : pct >= 80 ? 'is-warn' : '';
	const scheduled = mine.scheduled_plan ? catalog.plans.find((p) => p.id === mine.scheduled_plan) : null;
	const periodEnds = fmtDate(mine.period_end);

	el.innerHTML = `
		<div class="dev-usage-header">
			<div>
				<h2 class="dev-section-title">Plan &amp; quota</h2>
				<p class="dev-section-desc">Every v1 API call counts against a monthly quota that is enforced, not just recorded. Burst and concurrency ceilings apply per minute and per request in flight.</p>
			</div>
			<a href="/developers" class="dn-btn ghost" target="_blank" rel="noopener">Public pricing</a>
		</div>

		${mine.degraded ? `<div class="dn-warn-banner">Plan data is temporarily unavailable, so your calls are being served on the Free plan ceilings until it recovers.</div>` : ''}

		<div class="dev-plan-grid">
			<div class="dn-panel dev-plan-card">
				<div class="dev-plan-card-head">
					<div>
						<div class="dev-plan-eyebrow">Current plan</div>
						<div class="dev-plan-name">${esc(plan.name)}</div>
						<div class="dev-plan-tagline">${esc(plan.tagline)}</div>
					</div>
					<div class="dev-plan-price">${plan.price_usd > 0 ? `${fmtUsd(plan.price_usd)}<span>/ ${catalog.period_days} days</span>` : 'Free'}</div>
				</div>
				<dl class="dev-plan-facts">
					<div><dt>Period</dt><dd>${fmtDate(mine.period_start)} to ${periodEnds}</dd></div>
					<div><dt>Burst</dt><dd>${fmtInt(mine.burst_per_minute)} calls / min</dd></div>
					<div><dt>Concurrent</dt><dd>${fmtInt(mine.concurrency.in_flight)} of ${fmtInt(mine.concurrency.limit)} in flight</dd></div>
					<div><dt>Webhooks</dt><dd>up to ${fmtInt(plan.webhooks)}</dd></div>
					<div><dt>Renews</dt><dd>${renewalLine(scheduled, periodEnds)}</dd></div>
				</dl>
				${scheduled ? `<button type="button" class="dn-btn ghost dev-plan-undo" data-act="schedule" data-plan="${esc(plan.id)}">Keep ${esc(plan.name)} instead</button>` : ''}
			</div>

			<div class="dn-panel dev-plan-card">
				<div class="dev-plan-eyebrow">Calls this period</div>
				<div class="dev-plan-usage-value">${fmtInt(q.used)} <span>of ${fmtInt(q.limit)}</span></div>
				<div class="dev-plan-bar ${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="${q.limit}" aria-valuenow="${q.used}" aria-label="Calls used this period">
					<div class="dev-plan-bar-fill" style="width:${pct.toFixed(2)}%"></div>
				</div>
				<div class="dev-plan-usage-meta">
					<span>${fmtInt(q.remaining)} remaining</span>
					<span>resets ${esc(relTime(q.reset_at))}</span>
				</div>
				${pct >= 100
					? `<div class="dev-plan-over">Quota reached. Calls answer <code>402 quota_exceeded</code> until ${periodEnds}${mine.next_plan ? `, or upgrade to ${esc(mine.next_plan.name)} for ${fmtInt(mine.next_plan.included_calls)} calls.` : '.'}</div>`
					: pct >= 80 && mine.next_plan
						? `<div class="dev-plan-near">Running hot. ${esc(mine.next_plan.name)} includes ${fmtInt(mine.next_plan.included_calls)} calls a period.</div>`
						: ''}
			</div>
		</div>

		<h3 class="dev-plan-sub">Plans</h3>
		<div class="dev-plan-ladder">
			${catalog.plans.map((p) => planCard(p, plan)).join('')}
		</div>
		<p class="dev-plan-note">${esc(catalog.calculation_note)}</p>

		<h3 class="dev-plan-sub">Receipts</h3>
		${receiptsTable(mine.receipts)}
	`;

	el.querySelectorAll('[data-act="buy"]').forEach((btn) => btn.addEventListener('click', () => openCheckout(btn.dataset.plan, el, ctx)));
	el.querySelectorAll('[data-act="schedule"]').forEach((btn) => btn.addEventListener('click', () => schedule(btn, el, ctx)));
}

function renewalLine(scheduled, periodEnds) {
	if (scheduled) return `switches to <strong>${esc(scheduled.name)}</strong> on ${periodEnds}`;
	if (mine.plan.price_usd === 0) return 'free, period rolls on its own';
	if (mine.renew_with === 'credits') return `from credits on ${periodEnds}`;
	return `not automatic: renew before ${periodEnds} or the plan lapses to Free`;
}

function planCard(p, current) {
	const isCurrent = p.id === current.id;
	const quotes = mine.quotes?.[p.id];
	let action = '';
	if (p.contact_sales && !isCurrent) {
		action = `<a class="dn-btn ghost" href="mailto:hello@three.ws?subject=${encodeURIComponent(`${p.name} developer plan`)}">Talk to us</a>`;
	}
	if (!p.contact_sales || isCurrent) {
		if (isCurrent && p.purchasable) action = `<button type="button" class="dn-btn ghost" data-act="buy" data-plan="${esc(p.id)}">Renew now</button>`;
		else if (isCurrent) action = `<span class="dn-tag success">Current</span>`;
		else if (p.rank > current.rank && p.purchasable) action = `<button type="button" class="dn-btn primary" data-act="buy" data-plan="${esc(p.id)}">Upgrade${quotes?.credits ? ` for ${fmtUsd(quotes.credits.amount_usd)}` : ''}</button>`;
		else if (p.rank < current.rank) action = mine.scheduled_plan === p.id
			? `<span class="dn-tag warn">Scheduled</span>`
			: `<button type="button" class="dn-btn ghost" data-act="schedule" data-plan="${esc(p.id)}">${p.price_usd === 0 ? 'Cancel at period end' : 'Downgrade at period end'}</button>`;
	}
	return `
		<div class="dn-panel dev-plan-tier${isCurrent ? ' is-current' : ''}">
			<div class="dev-plan-tier-name">${esc(p.name)}</div>
			<div class="dev-plan-tier-price">${p.price_usd > 0 ? fmtUsd(p.price_usd) : '$0'}<span>/ ${catalog.period_days} days</span></div>
			${p.price_usd > 0 ? `<div class="dev-plan-tier-three">${fmtUsd(p.three_price_usd)} in $THREE</div>` : '<div class="dev-plan-tier-three">no card, no wallet</div>'}
			<ul class="dev-plan-tier-list">
				<li><strong>${fmtInt(p.included_calls)}</strong> calls / period</li>
				<li><strong>${fmtInt(p.burst_per_minute)}</strong> calls / minute</li>
				<li><strong>${fmtInt(p.concurrent)}</strong> concurrent</li>
				<li><strong>${fmtInt(p.webhooks)}</strong> webhooks</li>
			</ul>
			<div class="dev-plan-tier-action">${action}</div>
		</div>
	`;
}

function receiptsTable(receipts) {
	if (!receipts?.length) {
		return `<div class="dn-panel dev-plan-empty">No receipts yet. Receipts appear here, and in your inbox, the moment an upgrade or renewal settles.</div>`;
	}
	return `
		<div class="dn-table-wrap">
			<table class="dn-table">
				<thead><tr><th>Date</th><th>Plan</th><th>Kind</th><th>Paid</th><th>Period</th><th>Proof</th></tr></thead>
				<tbody>
					${receipts.map((r) => `
						<tr>
							<td><span class="dn-dim" title="${esc(r.created_at)}">${esc(fmtDate(r.created_at))}</span></td>
							<td>${esc(catalog.plans.find((p) => p.id === r.plan)?.name || r.plan)}</td>
							<td><span class="dn-tag">${esc(r.kind)}</span></td>
							<td>${fmtUsd(r.amount_usd)} <span class="dn-dim">${esc(r.asset === 'THREE' ? '$THREE' : r.asset)}</span></td>
							<td><span class="dn-dim">${esc(fmtDate(r.period_start))} to ${esc(fmtDate(r.period_end))}</span></td>
							<td>${r.tx_signature
								? `<a class="dn-link" href="https://solscan.io/tx/${encodeURIComponent(r.tx_signature)}" target="_blank" rel="noopener">${esc(r.tx_signature.slice(0, 8))}…</a>`
								: `<code class="dn-mono-sm">${esc(r.ledger_id ? `ledger ${String(r.ledger_id).slice(0, 8)}` : r.id.slice(0, 8))}</code>`}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>
		</div>
	`;
}

async function schedule(btn, el, ctx) {
	const planId = btn.dataset.plan;
	const target = catalog.plans.find((p) => p.id === planId);
	btn.disabled = true;
	try {
		const r = await post('/api/v1/me/dev-plan/schedule', { plan: planId });
		const out = r?.data ?? r;
		mine.scheduled_plan = out.scheduled_plan;
		ctx.showToast(out.scheduled_plan ? `${target.name} starts ${fmtDate(out.period_end)}` : `Staying on ${mine.plan.name}`);
		paint(el, ctx);
	} catch (err) {
		btn.disabled = false;
		ctx.showToast(err instanceof ApiError ? err.message : 'Could not schedule that change.', 'danger');
	}
}

// ── Checkout ─────────────────────────────────────────────────────────────────

function openCheckout(planId, tabEl, ctx) {
	const target = catalog.plans.find((p) => p.id === planId);
	const quotes = mine.quotes?.[planId] || {};
	const overlay = document.createElement('div');
	overlay.className = 'dev-modal-overlay';
	const kind = quotes.credits?.kind || quotes.USDC?.kind || 'upgrade';
	overlay.innerHTML = `
		<div class="dev-modal" role="dialog" aria-modal="true" aria-label="${esc(kind === 'renew' ? 'Renew' : 'Upgrade to')} ${esc(target.name)}">
			<h3 class="dev-modal-title">${kind === 'renew' ? `Renew ${esc(target.name)}` : `Upgrade to ${esc(target.name)}`}</h3>
			<p class="dev-modal-desc">${kind === 'renew'
				? `Extends your period by ${catalog.period_days} days from ${fmtDate(mine.period_end)}.`
				: quotes.credits?.remaining_fraction != null && quotes.credits.remaining_fraction < 1
					? `Prorated for the ${Math.round(quotes.credits.remaining_fraction * 100)}% of your period that remains. Your period end stays ${fmtDate(mine.period_end)}.`
					: `Starts a fresh ${catalog.period_days}-day period today with ${fmtInt(target.included_calls)} calls.`}</p>
			<div class="dev-plan-assets" role="radiogroup" aria-label="Pay with">
				${['credits', 'USDC', 'THREE'].map((asset, i) => {
					const qq = quotes[asset];
					return `
						<label class="dev-plan-asset${qq ? '' : ' is-disabled'}">
							<input type="radio" name="asset" value="${asset}" ${i === 0 ? 'checked' : ''} ${qq ? '' : 'disabled'}>
							<span class="dev-plan-asset-name">${asset === 'THREE' ? '$THREE' : asset === 'credits' ? 'Credits' : 'USDC'}</span>
							<span class="dev-plan-asset-amt">${qq ? fmtUsd(qq.amount_usd) : 'unavailable'}</span>
							<span class="dev-plan-asset-sub">${asset === 'credits' ? 'from your balance, instant' : asset === 'USDC' ? 'from your Solana wallet' : `${catalog.three_discount_bps / 100}% off, from your Solana wallet`}</span>
						</label>`;
				}).join('')}
			</div>
			<div class="dev-plan-review" data-review hidden></div>
			<div class="dn-error dev-plan-error" data-error hidden></div>
			<div class="dev-modal-actions" style="gap:8px">
				<button type="button" class="dn-btn ghost" data-cancel>Cancel</button>
				<button type="button" class="dn-btn primary" data-go>Continue</button>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);
	const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
	const onKey = (e) => { if (e.key === 'Escape') close(); };
	document.addEventListener('keydown', onKey);
	overlay.querySelector('[data-cancel]').addEventListener('click', close);
	overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

	const go = overlay.querySelector('[data-go]');
	const errSlot = overlay.querySelector('[data-error]');
	const review = overlay.querySelector('[data-review]');
	const showErr = (msg) => { errSlot.textContent = msg; errSlot.hidden = false; };
	go.focus();

	go.addEventListener('click', async () => {
		const asset = overlay.querySelector('input[name="asset"]:checked')?.value || 'credits';
		errSlot.hidden = true;
		go.disabled = true;
		try {
			if (asset === 'credits') {
				go.textContent = 'Paying…';
				const r = await post('/api/v1/me/dev-plan/checkout', { plan: planId, asset });
				const out = r?.data ?? r;
				close();
				await settled(tabEl, ctx, out.receipt, target);
				return;
			}
			await walletFlow({ asset, planId, target, overlay, go, review, showErr, close, tabEl, ctx });
		} catch (err) {
			go.disabled = false;
			go.textContent = 'Continue';
			if (err instanceof ApiError && err.code === 'insufficient_credits') {
				showErr(`You have ${fmtUsd(err.body.available_usd)} in credits and this costs ${fmtUsd(err.body.required_usd)}. Top up at /dashboard/billing or pay from your wallet.`);
				return;
			}
			showErr(isUserRejection(err) ? 'Signature declined in the wallet. Nothing was sent.' : err?.message || 'Checkout failed.');
		}
	});
}

async function walletFlow({ asset, planId, target, go, review, showErr, close, tabEl, ctx }) {
	const adapter = getAdapter('solana');
	if (!adapter.isAvailable()) {
		showErr('No Solana wallet detected. Install Phantom, or pay with credits.');
		window.open(adapter.installUrl(), '_blank', 'noopener');
		go.disabled = false;
		return;
	}
	go.textContent = 'Connecting wallet…';
	const { address, ref } = await adapter.connect({ ensureLinked: true, cluster: 'mainnet' });
	go.textContent = 'Preparing transfer…';
	const r = await post('/api/v1/me/dev-plan/checkout', { plan: planId, asset, wallet: address });
	const out = r?.data ?? r;
	const c = out.checkout;
	const label = asset === 'THREE' ? '$THREE' : 'USDC';

	// The gate before any signature: recipient, amount, asset and chain, then an explicit yes.
	review.hidden = false;
	review.innerHTML = `
		<div class="dev-plan-review-title">Review before you sign</div>
		<dl class="dev-plan-facts">
			<div><dt>Send</dt><dd><strong>${esc(c.amount_atomics)}</strong> atomic units of ${esc(label)}${c.asset_usd ? ` (about ${fmtUsd(c.amount_usd)} at ${fmtUsd(c.asset_usd)} per ${esc(label)})` : ` (${fmtUsd(c.amount_usd)})`}</dd></div>
			<div><dt>To</dt><dd><code class="dn-mono-sm">${esc(c.pay_to)}</code></dd></div>
			<div><dt>From</dt><dd><code class="dn-mono-sm">${esc(address)}</code></dd></div>
			<div><dt>Chain</dt><dd>Solana mainnet</dd></div>
			<div><dt>Buys</dt><dd>${esc(target.name)} until ${fmtDate(c.period_end)}</dd></div>
			<div><dt>Quote expires</dt><dd>${esc(relTime(c.expires_at))}</dd></div>
		</dl>
	`;
	go.disabled = false;
	go.textContent = `Sign and send ${label}`;
	go.replaceWith(go.cloneNode(true));
	const sign = document.querySelector('.dev-modal [data-go]');
	sign.focus();
	sign.addEventListener('click', async () => {
		sign.disabled = true;
		try {
			sign.textContent = 'Confirm in your wallet…';
			const { txHash } = await adapter.signAndSend({ txBase64: out.tx_base64 }, ref);
			sign.textContent = 'Confirming on Solana…';
			let last = null;
			for (let i = 0; i < CONFIRM_MAX_TRIES; i++) {
				const rr = await post('/api/v1/me/dev-plan/confirm', { checkout_id: c.id, tx_signature: txHash });
				last = rr?.data ?? rr;
				if (last.status === 'paid') break;
				await sleep(CONFIRM_POLL_MS);
			}
			if (last?.status !== 'paid') {
				showErr(`The transfer ${txHash.slice(0, 8)}… is still confirming. Your plan applies as soon as it lands; reload this tab in a minute.`);
				sign.disabled = false;
				sign.textContent = 'Check again';
				return;
			}
			close();
			await settled(tabEl, ctx, last.receipt, target);
		} catch (err) {
			sign.disabled = false;
			sign.textContent = `Sign and send ${label}`;
			showErr(isUserRejection(err) ? 'Signature declined in the wallet. Nothing was sent.' : err?.message || 'The transfer did not go through.');
		}
	});
}

async function settled(tabEl, ctx, receipt, target) {
	ctx.showToast(`${target.name} is active. Receipt ${receipt?.id ? receipt.id.slice(0, 8) : 'sent'} is in your inbox.`);
	try {
		const fresh = await get('/api/v1/me/dev-plan');
		mine = fresh?.data ?? fresh;
	} catch {
		mine.plan = target;
	}
	paint(tabEl, ctx);
}

// ── Styles ───────────────────────────────────────────────────────────────────

function injectPlanStyles() {
	if (document.getElementById('dev-plan-styles')) return;
	const style = document.createElement('style');
	style.id = 'dev-plan-styles';
	style.textContent = `
.dev-plan-grid { display:grid; grid-template-columns:1.2fr 1fr; gap:14px; margin-bottom:28px; }
@media (max-width:860px) { .dev-plan-grid { grid-template-columns:1fr; } }
.dev-plan-card { padding:22px; display:flex; flex-direction:column; gap:14px; }
.dev-plan-card-head { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap; }
.dev-plan-eyebrow { font-size:11px; text-transform:uppercase; letter-spacing:0.08em; color:var(--nxt-ink-dim); font-weight:600; }
.dev-plan-name { font-size:26px; font-weight:700; letter-spacing:-0.02em; margin-top:4px; }
.dev-plan-tagline { color:var(--nxt-ink-dim); font-size:13px; margin-top:2px; }
.dev-plan-price { font-size:22px; font-weight:700; letter-spacing:-0.02em; white-space:nowrap; }
.dev-plan-price span, .dev-plan-tier-price span { font-size:12px; font-weight:500; color:var(--nxt-ink-dim); margin-left:4px; }
.dev-plan-facts { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:10px 18px; margin:0; }
.dev-plan-facts div { display:flex; flex-direction:column; gap:2px; min-width:0; }
.dev-plan-facts dt { font-size:11px; color:var(--nxt-ink-dim); text-transform:uppercase; letter-spacing:0.06em; }
.dev-plan-facts dd { margin:0; font-size:13.5px; overflow-wrap:anywhere; }
.dev-plan-undo { align-self:flex-start; }
.dev-plan-usage-value { font-size:30px; font-weight:700; letter-spacing:-0.02em; }
.dev-plan-usage-value span { font-size:14px; font-weight:500; color:var(--nxt-ink-dim); }
.dev-plan-bar { height:10px; border-radius:999px; background:var(--nxt-bg-3); overflow:hidden; }
.dev-plan-bar-fill { height:100%; border-radius:999px; background:linear-gradient(90deg,#6c8aff,#34d399); transition:width 0.4s ease; }
.dev-plan-bar.is-warn .dev-plan-bar-fill { background:linear-gradient(90deg,#fbbf24,#f97316); }
.dev-plan-bar.is-over .dev-plan-bar-fill { background:var(--nxt-danger); }
.dev-plan-usage-meta { display:flex; justify-content:space-between; font-size:12px; color:var(--nxt-ink-dim); }
.dev-plan-over, .dev-plan-near { font-size:13px; line-height:1.5; padding:10px 12px; border-radius:8px; }
.dev-plan-over { background:rgba(248,113,113,0.1); color:var(--nxt-danger); }
.dev-plan-near { background:rgba(251,191,36,0.1); color:#fbbf24; }
.dev-plan-sub { font-size:15px; font-weight:600; margin:0 0 12px; }
.dev-plan-ladder { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
@media (max-width:1100px) { .dev-plan-ladder { grid-template-columns:repeat(2,1fr); } }
@media (max-width:520px) { .dev-plan-ladder { grid-template-columns:1fr; } }
.dev-plan-tier { padding:18px; display:flex; flex-direction:column; gap:8px; transition:border-color 0.15s ease, transform 0.15s ease; }
.dev-plan-tier:hover { transform:translateY(-2px); }
.dev-plan-tier.is-current { border-color:var(--nxt-accent); }
.dev-plan-tier-name { font-weight:600; font-size:15px; }
.dev-plan-tier-price { font-size:22px; font-weight:700; letter-spacing:-0.02em; }
.dev-plan-tier-three { font-size:12px; color:#34d399; }
.dev-plan-tier-list { list-style:none; margin:6px 0 0; padding:0; display:flex; flex-direction:column; gap:4px; font-size:13px; color:var(--nxt-ink-dim); }
.dev-plan-tier-list strong { color:var(--nxt-ink); }
.dev-plan-tier-action { margin-top:auto; padding-top:10px; }
.dev-plan-tier-action .dn-btn { width:100%; justify-content:center; }
.dev-plan-note { font-size:12px; color:var(--nxt-ink-dim); line-height:1.6; margin:12px 0 28px; max-width:760px; }
.dev-plan-empty { padding:22px; color:var(--nxt-ink-dim); font-size:13.5px; line-height:1.5; }
.dev-plan-assets { display:flex; flex-direction:column; gap:8px; }
.dev-plan-asset { display:grid; grid-template-columns:auto 1fr auto; grid-template-areas:"radio name amt" "radio sub sub"; gap:2px 10px; align-items:center; padding:10px 12px; border:1px solid var(--nxt-stroke); border-radius:10px; cursor:pointer; transition:border-color 0.15s ease, background 0.15s ease; }
.dev-plan-asset:hover { background:rgba(255,255,255,0.03); }
.dev-plan-asset:has(input:checked) { border-color:var(--nxt-accent); background:rgba(108,138,255,0.08); }
.dev-plan-asset:has(input:focus-visible) { outline:2px solid var(--nxt-accent); outline-offset:2px; }
.dev-plan-asset.is-disabled { opacity:0.5; cursor:not-allowed; }
.dev-plan-asset input { grid-area:radio; margin:0; }
.dev-plan-asset-name { grid-area:name; font-weight:600; font-size:14px; }
.dev-plan-asset-amt { grid-area:amt; font-weight:600; font-size:14px; }
.dev-plan-asset-sub { grid-area:sub; font-size:12px; color:var(--nxt-ink-dim); }
.dev-plan-review { margin-top:14px; padding:14px; border:1px solid rgba(251,191,36,0.4); background:rgba(251,191,36,0.06); border-radius:10px; }
.dev-plan-review-title { font-weight:600; font-size:13px; margin-bottom:10px; color:#fbbf24; }
.dev-plan-error { margin-top:12px; font-size:13px; color:var(--nxt-danger); line-height:1.5; }
@media (prefers-reduced-motion: reduce) { .dev-plan-bar-fill, .dev-plan-tier, .dev-plan-asset { transition:none !important; } .dev-plan-tier:hover { transform:none; } }
	`;
	document.head.appendChild(style);
}
