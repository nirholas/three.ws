// dashboard-next — $THREE Token Utility page.
//
// The command center for the $THREE token. Shows real token data from
// Birdeye/Pump.fun, the holder's position, the spend allowance, what the
// token is used for, and the treasury acquisition ledger. It never presents
// the token as a source of yield or revenue share.
//
// Real endpoints:
//   GET /api/three-token/stats          { token, protocol }
//   GET /api/three-token/activity       { events }

import { mountShell } from '../shell.js';
import { requireUser, esc, relTime, ApiError } from '../api.js';
import { fetchTokenConfig, fetchTokenPrice } from '../../token-pay.js';
import { fetchAllowanceStatus, grantAllowance, revokeAllowance } from '../../three-allowance.js';
import { terminalLinks } from '../../shared/trading-terminals.js';
import { createThreeTokenData } from '../../pump/three-token-data.js';
import { paintVerifiedBadge } from '../../pump/verified-badge.js';
import { errorStateHTML, ensureStateKitStyles } from '../../shared/state-kit.js';
import { toast } from '../../shared/toast.js';
import { addressHtml } from '../../shared/address.js';
import { riskNoteHTML } from '../../shared/risk-note.js';

const MONO = `'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace`;
// THREE_MINT is fetched live from /api/token/config below. This fallback is
// used only for the static external links in renderTokenInfo() before config loads.
let THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

function fmtUsd(n) {
	if (n == null || !Number.isFinite(+n)) return '—';
	const v = +n;
	if (v === 0) return '$0.00';
	if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(2) + 'M';
	if (v >= 1_000) return '$' + (v / 1_000).toFixed(2) + 'K';
	if (v >= 1) return '$' + v.toFixed(2);
	if (v >= 0.0001) return '$' + v.toFixed(6);
	return '$' + v.toExponential(2);
}

function fmtCompact(n) {
	if (n == null) return '—';
	const v = +n;
	if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B';
	if (v >= 1_000_000) return (v / 1_000_000).toFixed(2) + 'M';
	if (v >= 1_000) return (v / 1_000).toFixed(1) + 'K';
	return v.toLocaleString();
}

function fmtPct(n) {
	if (n == null || !Number.isFinite(+n)) return '—';
	const v = +n;
	const sign = v >= 0 ? '+' : '';
	return sign + v.toFixed(2) + '%';
}

function pctColor(n) {
	if (n == null || !Number.isFinite(+n)) return 'var(--nxt-ink-dim)';
	return +n >= 0 ? 'var(--nxt-success)' : 'var(--nxt-danger)';
}


// ── Boot ──────────────────────────────────────────────────────────────────────

(async function boot() {
	try {
		const main = await mountShell();
		await requireUser();

		main.innerHTML = `
			<div style="margin-bottom:6px">
				<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
					<div style="width:36px;height:36px;border-radius:10px;background:#111116;border:1px solid #232329;display:grid;place-items:center;flex-shrink:0;overflow:hidden"><img loading="lazy" decoding="async" src="/favicon.svg" alt="three.ws" width="26" height="26" style="display:block" /></div>
					<div>
						<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><h1 class="dn-h1" style="margin:0">$THREE</h1><span data-verified></span></div>
						<p class="dn-h1-sub" style="margin:0">The protocol token powering the three.ws agent economy</p>
					</div>
				</div>
			</div>
			<div data-slot="content" style="display:flex;flex-direction:column;gap:20px"></div>
		`;

		const host = main.querySelector('[data-slot="content"]');

		// Single source of truth for all $THREE data — price, protocol metrics,
		// activity, treasury ledger, and the signed-in holder's live position.
		// The store wraps the same /api/three-token/* endpoints this page used to
		// fetch inline; centralising them keeps every section (and the position
		// widget) reading one consistent snapshot. It polls protocol + activity and
		// tears itself down when `host` leaves the DOM.
		const store = createThreeTokenData({ pollMs: 30_000, anchorEl: host, autoStart: false });

		// Load + render is a retryable unit: if the protocol snapshot can't be
		// reached (network down) we show a recoverable error rather than a
		// dashboard of blank "—" metrics that reads as deceptively empty.
		async function hydrate() {
			host.innerHTML = `
				${skeletonGrid(4)}
				${skeletonBlock(280)}
				${skeletonBlock(200)}
			`;

			let tokenConfig = null;
			try {
				[, tokenConfig] = await Promise.all([
					store.refresh(),
					fetchTokenConfig().catch(() => null),
				]);
			} catch {
				// Swallow — the status check below drives the error state uniformly
				// whether refresh rejected or resolved with an error status.
			}

			const snap = store.getState();

			if (snap.protocol.status !== 'ok') {
				ensureStateKitStyles();
				host.innerHTML = errorStateHTML({
					title: "Couldn't load $THREE data",
					body: 'We had trouble reaching the protocol feed. Check your connection and try again.',
				});
				host.querySelector('[data-sk-retry]')?.addEventListener('click', hydrate);
				return;
			}

			const stats = { token: snap.protocol.token, protocol: snap.protocol.protocol, buyback: snap.protocol.buyback };

			// pump.fun verification badge beside the page title. Same live flag and
			// same badge the public /three-token page renders.
			paintVerifiedBadge(main.querySelector('[data-verified]'), stats.token);
			const activity = snap.activity.status === 'ok' ? { events: snap.activity.events } : null;

			// Canonical mint comes from the store's /stats payload (single source);
			// fall back to /api/token/config only if stats didn't resolve.
			if (snap.protocol.token?.mint) THREE_MINT = snap.protocol.token.mint;
			else if (tokenConfig?.mint) THREE_MINT = tokenConfig.mint;

			host.innerHTML = riskNoteHTML('token');

			host.appendChild(renderHeroMetrics(stats));
			host.appendChild(renderPositionWidget(store));
			host.appendChild(renderSpendAllowance());
			host.appendChild(renderUtilityPillars(stats));
			host.appendChild(renderLiveConverter(tokenConfig));
			host.appendChild(renderBuyback(stats));
			host.appendChild(renderActivityFeed(activity));
			host.appendChild(renderTokenInfo());

			// Resolve the holder's on-chain position now that the widget is mounted;
			// it subscribes to the store and renders its own empty/error state.
			store.refreshPosition();
		}

		await hydrate();
	} catch (err) {
		if (err instanceof ApiError && err.status === 401) {
			location.href = `/login?return=${encodeURIComponent(location.pathname)}`;
		} else throw err;
	}
})();

// ── Skeletons ─────────────────────────────────────────────────────────────────

function skeletonGrid(n) {
	return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
		${Array.from({ length: n }, () => `<div class="dn-skeleton" style="height:96px;border-radius:12px"></div>`).join('')}
	</div>`;
}

function skeletonBlock(h) {
	return `<div class="dn-skeleton" style="height:${h}px;border-radius:12px"></div>`;
}

// ── Hero metrics ──────────────────────────────────────────────────────────────

function renderHeroMetrics(stats) {
	const t = stats?.token || {};
	const p = stats?.protocol || {};

	const metrics = [
		{
			label: 'Price',
			value: fmtUsd(t.price_usd),
			sub:
				t.price_change_24h != null
					? `<span style="color:${pctColor(t.price_change_24h)};font-size:12px;font-weight:500">${fmtPct(t.price_change_24h)} 24h</span>`
					: '',
		},
		{
			label: 'Market Cap',
			value: t.market_cap != null ? fmtUsd(t.market_cap) : '—',
			sub: '',
		},
		{
			label: '24h Volume',
			value: t.volume_24h != null ? fmtUsd(t.volume_24h) : '—',
			sub: '',
		},
		{
			label: 'Holders',
			value: t.holders != null ? fmtCompact(t.holders) : '—',
			sub: '',
		},
	];

	const wrap = document.createElement('div');
	wrap.style.cssText =
		'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px';

	metrics.forEach(({ label, value, sub }) => {
		const card = document.createElement('div');
		card.className = 'dn-panel';
		card.style.cssText = 'position:relative;overflow:hidden;';
		card.innerHTML = `
			<div style="position:absolute;top:0;right:0;width:80px;height:80px;background:radial-gradient(circle at top right,rgba(255,255,255,0.03),transparent 70%);pointer-events:none"></div>
			<div style="font-size:11.5px;color:var(--nxt-ink-fade);text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">${esc(label)}</div>
			<div style="font-size:26px;font-weight:700;letter-spacing:-0.03em;font-family:${MONO}">${value}</div>
			${sub ? `<div style="margin-top:4px">${sub}</div>` : ''}
		`;
		wrap.appendChild(card);
	});

	return wrap;
}

// ── Your position (signed-in holder's live $THREE balance) ──────────────────────

// A reactive panel showing the connected wallet's real $THREE holding. Subscribes
// to the shared store, so it updates whenever the position refreshes (initial
// load, the Refresh button, a tab refocus after a trade) and whenever the price
// moves. Renders an independent state for every case: loading, signed-out,
// no-wallet, zero-balance, populated, and error — never a blank void.
function renderPositionWidget(store) {
	const section = document.createElement('div');
	section.className = 'dn-panel';
	section.setAttribute('aria-label', 'Your $THREE position');
	section.style.cssText = 'position:relative;overflow:hidden';
	section.innerHTML = `
		<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px">
			<div style="font-size:11.5px;color:var(--nxt-ink-fade);text-transform:uppercase;letter-spacing:0.06em">Your Position</div>
			<button data-action="refresh-position" class="dn-btn" aria-label="Refresh your position" style="font-size:12px;padding:4px 10px">Refresh</button>
		</div>
		<div data-slot="position-body"></div>
	`;

	const body = section.querySelector('[data-slot="position-body"]');
	const render = (state) => { body.innerHTML = positionBody(state.position, state.protocol.token || {}); };

	// Delegated so the inline Retry button (re-rendered on each state change) works
	// the same as the header Refresh button.
	section.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-action="refresh-position"]');
		if (!btn) return;
		btn.disabled = true;
		Promise.resolve(store.refreshPosition()).finally(() => { btn.disabled = false; });
	});

	// Cheap freshness: re-pull the position when the tab regains focus (e.g. after
	// the user buys/sells $THREE elsewhere). Position-only — never the heavy feeds.
	const onVisible = () => { if (document.visibilityState === 'visible') store.refreshPosition(); };
	document.addEventListener('visibilitychange', onVisible);

	const unsub = store.subscribe(render);

	// Tear down listeners when the panel leaves the DOM.
	new MutationObserver((_m, obs) => {
		if (!section.isConnected) {
			unsub();
			document.removeEventListener('visibilitychange', onVisible);
			obs.disconnect();
		}
	}).observe(document.body, { childList: true, subtree: true });

	return section;
}

function positionBody(pos, token) {
	switch (pos.status) {
		case 'idle':
		case 'loading':
			return `<div class="dn-skeleton" style="height:64px;border-radius:10px" aria-busy="true" aria-label="Loading your position"></div>`;
		case 'unauthenticated':
			return positionEmpty('Sign in to see your $THREE position.', 'Sign in', `/login?return=${encodeURIComponent(location.pathname)}`);
		case 'no_wallet':
			return positionEmpty('Link a Solana wallet to track your $THREE holdings.', 'Link wallet', '/dashboard/account');
		case 'zero':
			return positionEmpty('You don’t hold $THREE yet.', 'Get $THREE', `https://pump.fun/coin/${THREE_MINT}`, true);
		case 'error':
			return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
				<span style="color:var(--nxt-ink-fade);font-size:13.5px">Couldn’t load your position right now.</span>
				<button data-action="refresh-position" class="dn-btn" style="font-size:12px;padding:4px 10px">Retry</button>
			</div>`;
		case 'ok': {
			const amount = pos.amount ?? 0;
			const cells = [
				{ label: 'Balance', value: `${fmtCompact(amount)} <span style="font-size:13px;color:var(--nxt-ink-fade)">$THREE</span>` },
				{ label: 'Value', value: pos.usd != null ? fmtUsd(pos.usd) : '—' },
				{ label: 'Share of supply', value: pos.pctOfSupply != null ? fmtPct(pos.pctOfSupply * 100) : '—' },
			];
			return `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px">
				${cells.map((c) => `<div>
					<div style="font-size:11px;color:var(--nxt-ink-fade);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">${esc(c.label)}</div>
					<div style="font-size:20px;font-weight:700;font-family:${MONO}">${c.value}</div>
				</div>`).join('')}
			</div>`;
		}
		default:
			return '';
	}
}

function positionEmpty(message, ctaLabel, href, external = false) {
	return `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
		<span style="color:var(--nxt-ink-fade);font-size:13.5px">${esc(message)}</span>
		<a class="dn-btn" href="${esc(href)}" ${external ? 'target="_blank" rel="noopener"' : ''} style="font-size:12.5px;white-space:nowrap">${esc(ctaLabel)}</a>
	</div>`;
}

function expiryLabel(ts) {
	if (!ts || ts <= 0) return 'No expiry';
	const days = Math.round((ts - Date.now() / 1000) / 86_400);
	if (days <= 0) return 'Expired';
	if (days === 1) return 'Expires in 1 day';
	if (days < 45) return `Expires in ${days} days`;
	return `Expires in ${Math.round(days / 30)} months`;
}

function renderSpendAllowance() {
	const section = document.createElement('div');
	section.className = 'dn-panel';
	section.setAttribute('aria-label', 'Your $THREE spend allowance');
	section.innerHTML = `
		<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px">
			<div style="font-size:11.5px;color:var(--nxt-ink-fade);text-transform:uppercase;letter-spacing:0.06em">Spend Allowance</div>
			<span style="font-size:10.5px;color:var(--nxt-ink-fade);border:1px solid var(--nxt-line);border-radius:999px;padding:2px 8px">Non-custodial</span>
		</div>
		<p style="margin:0 0 12px;font-size:12px;color:var(--nxt-ink-fade);line-height:1.5">Authorize a $THREE spending cap once — then pay for forge, skills, names and cosmetics with no wallet popup each time. Your tokens stay in your wallet until a charge pulls them, never above the cap you set. Revoke anytime.</p>
		<div data-slot="allowance-body"><div class="dn-skeleton" style="height:96px;border-radius:10px" aria-busy="true"></div></div>
	`;
	const body = section.querySelector('[data-slot="allowance-body"]');

	let busy = false;
	let priceUsd = null; // live $THREE price, for "what this covers" translation

	const load = async () => {
		try {
			const [status, price] = await Promise.all([
				fetchAllowanceStatus(),
				priceUsd == null ? fetchTokenPrice().catch(() => null) : Promise.resolve(null),
			]);
			if (price?.price_usd != null) priceUsd = Number(price.price_usd);
			if (!status.enabled) {
				// The rail isn't configured on this deployment — show nothing rather
				// than a button that can't work.
				section.remove();
				return;
			}
			renderBody(status);
		} catch (err) {
			if (err?.code === 'unauthorized') {
				body.innerHTML = positionEmpty('Sign in to set a spend allowance.', 'Sign in', `/login?return=${encodeURIComponent(location.pathname)}`);
				return;
			}
			body.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
				<span style="color:var(--nxt-ink-fade);font-size:13.5px">Couldn’t load your allowance right now.</span>
				<button data-action="allowance-retry" class="dn-btn" style="font-size:12px;padding:4px 10px">Retry</button>
			</div>`;
		}
	};

	const renderBody = (status) => {
		if (!status.wallet) {
			body.innerHTML = positionEmpty('Link a Solana wallet to enable frictionless spending.', 'Link wallet', '/dashboard/account');
			return;
		}
		const remaining = Number(status.remaining_tokens || 0);
		const hasAllowance = remaining > 0;
		const usdValue = priceUsd != null ? remaining * priceUsd : null;
		const low = usdValue != null && usdValue < LOW_BALANCE_USD;

		// "What this covers" — concrete, relatable units from the live USD value.
		let covers = '';
		if (usdValue != null && hasAllowance) {
			const gens = Math.floor(usdValue / FORGE_STD_USD);
			const skills = Math.floor(usdValue / SKILL_TYPICAL_USD);
			covers = `≈ ${fmtUsd(usdValue)} — about ${fmtCompact(gens)} forge generations or ${fmtCompact(skills)} skill calls`;
		}

		const capChips = PRESET_CAPS.map(
			(c) => `<button type="button" data-cap="${c}" class="dn-btn" style="font-size:12.5px;padding:5px 12px">${fmtCompact(c)}</button>`,
		).join('');
		const expiryChips = EXPIRY_OPTIONS.map(
			(o, i) => `<button type="button" data-exp="${o.days ?? ''}" class="dn-btn${i === 0 ? ' is-active' : ''}" aria-pressed="${i === 0}" style="font-size:12px;padding:4px 10px">${esc(o.label)}</button>`,
		).join('');

		// One manageable row per active delegation (remaining + expiry + revoke).
		const grantsList = (status.delegations || [])
			.map((d) => {
				const tok = Number(d.remaining_tokens || 0);
				return `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--nxt-line)">
					<div style="min-width:0">
						<div style="font-size:14px;font-weight:600;font-family:${MONO}">${fmtCompact(tok)} <span style="font-size:12px;color:var(--nxt-ink-fade)">$THREE</span></div>
						<div style="font-size:11px;color:var(--nxt-ink-fade)">${esc(expiryLabel(d.expiry_ts))}</div>
					</div>
					<button data-action="allowance-revoke" data-pda="${esc(d.pubkey)}" class="dn-btn" style="font-size:11.5px;padding:4px 12px;white-space:nowrap">Revoke</button>
				</div>`;
			})
			.join('');

		body.innerHTML = `
			${hasAllowance ? `
				<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px">
					<div>
						<div style="font-size:11px;color:var(--nxt-ink-fade);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">Remaining cap</div>
						<div style="font-size:28px;font-weight:700;font-family:${MONO};color:${low ? '#fbbf24' : '#4ade80'};letter-spacing:-0.02em">${fmtCompact(remaining)} <span style="font-size:14px;color:var(--nxt-ink-fade)">$THREE</span></div>
					</div>
					<div style="font-size:12px;font-weight:600;color:${low ? '#fbbf24' : '#4ade80'};white-space:nowrap">${low ? '● Running low' : '● Frictionless spending on'}</div>
				</div>
				${covers ? `<div style="font-size:12px;color:var(--nxt-ink-fade);margin-bottom:${low ? '8' : '14'}px">${esc(covers)}</div>` : ''}
				${low ? `<div style="font-size:12.5px;color:#fbbf24;background:rgba(251,191,36,0.08);border:1px solid rgba(251,191,36,0.25);border-radius:8px;padding:8px 10px;margin-bottom:14px">Your cap is running low — top it up below to keep paying without popups.</div>` : ''}
				<div style="margin-bottom:14px">${grantsList}</div>
			` : `
				<div style="font-size:13.5px;color:var(--nxt-ink-dim);margin-bottom:14px">No active allowance — paid actions will ask for a signature each time. Authorize a cap to skip the popups.</div>
			`}
			<div style="display:flex;flex-direction:column;gap:10px">
				<div>
					<label for="allowance-cap" style="display:block;font-size:11px;color:var(--nxt-ink-fade);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">${hasAllowance ? 'Top up cap' : 'Spend cap'} ($THREE)</label>
					<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
						<input id="allowance-cap" type="number" min="1" step="1" inputmode="numeric" placeholder="1000" value="1000"
							style="width:120px;padding:7px 10px;background:var(--nxt-bg-soft,rgba(255,255,255,0.04));border:1px solid var(--nxt-line);border-radius:8px;color:var(--nxt-ink);font-family:${MONO};font-size:14px" />
						${capChips}
					</div>
				</div>
				<div>
					<span style="display:block;font-size:11px;color:var(--nxt-ink-fade);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:6px">Auto-expiry</span>
					<div data-slot="expiry-chips" style="display:flex;gap:8px;flex-wrap:wrap">${expiryChips}</div>
				</div>
				<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:2px">
					<button data-action="allowance-grant" class="dn-btn is-primary" style="font-size:13px;padding:8px 18px;font-weight:600">${hasAllowance ? 'Add to cap' : 'Authorize spending'}</button>
					<span data-slot="allowance-msg" style="font-size:12.5px;color:var(--nxt-ink-fade)" aria-live="polite"></span>
				</div>
			</div>
		`;

		const capInput = body.querySelector('#allowance-cap');
		body.querySelectorAll('[data-cap]').forEach((b) =>
			b.addEventListener('click', () => { capInput.value = b.getAttribute('data-cap'); capInput.focus(); }),
		);
		const expiryWrap = body.querySelector('[data-slot="expiry-chips"]');
		expiryWrap.addEventListener('click', (e) => {
			const btn = e.target.closest('[data-exp]');
			if (!btn) return;
			expiryWrap.querySelectorAll('[data-exp]').forEach((b) => { b.classList.remove('is-active'); b.setAttribute('aria-pressed', 'false'); });
			btn.classList.add('is-active');
			btn.setAttribute('aria-pressed', 'true');
		});
	};

	const doGrant = async (btn) => {
		if (busy) return;
		const capInput = body.querySelector('#allowance-cap');
		const msg = body.querySelector('[data-slot="allowance-msg"]');
		const capTokens = Math.floor(Number(capInput?.value));
		if (!(capTokens > 0)) { if (msg) msg.textContent = 'Enter a cap greater than zero.'; return; }
		const expSel = body.querySelector('[data-slot="expiry-chips"] .is-active');
		const expVal = expSel?.getAttribute('data-exp');
		const expiryDays = expVal ? Number(expVal) : undefined;

		busy = true;
		btn.disabled = true;
		const labels = { building: 'Building…', awaiting_signature: 'Confirm in wallet…', confirming: 'Confirming…', done: 'Done' };
		try {
			await grantAllowance({ capTokens, expiryDays, onStatus: (s) => { btn.textContent = labels[s] || 'Working…'; } });
			toast(`Authorized ${fmtCompact(capTokens)} $THREE — spending is now frictionless`);
			busy = false;
			await load(); // re-render with the new remaining cap
		} catch (err) {
			busy = false;
			btn.disabled = false;
			btn.textContent = 'Authorize spending';
			if (msg) msg.textContent = err?.message || 'Could not authorize spending.';
		}
	};

	const doRevoke = async (btn) => {
		if (busy) return;
		const pda = btn.getAttribute('data-pda');
		if (!pda) return;
		busy = true;
		btn.disabled = true;
		const labels = { building: 'Building…', awaiting_signature: 'Confirm in wallet…', confirming: 'Revoking…', done: 'Done' };
		const original = btn.textContent;
		try {
			await revokeAllowance({ delegationPda: pda, onStatus: (s) => { btn.textContent = labels[s] || 'Working…'; } });
			toast('Allowance revoked — your cap was cancelled and rent returned');
			busy = false;
			await load();
		} catch (err) {
			busy = false;
			btn.disabled = false;
			btn.textContent = original;
			const msg = body.querySelector('[data-slot="allowance-msg"]');
			if (msg) msg.textContent = err?.message || 'Could not revoke.';
		}
	};

	section.addEventListener('click', (e) => {
		const grantBtn = e.target.closest('[data-action="allowance-grant"]');
		if (grantBtn) { doGrant(grantBtn); return; }
		const revokeBtn = e.target.closest('[data-action="allowance-revoke"]');
		if (revokeBtn) { doRevoke(revokeBtn); return; }
		const retry = e.target.closest('[data-action="allowance-retry"]');
		if (retry) { body.innerHTML = `<div class="dn-skeleton" style="height:96px;border-radius:10px"></div>`; load(); }
	});

	load();
	return section;
}

// ── What the token does ──────────────────────────────────────────────────────

function renderUtilityPillars(stats) {
	const p = stats?.protocol || {};
	const t = stats?.token || {};

	const pillars = [
		{
			icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>`,
			title: 'Agent Payment Rail',
			desc: 'Agents and people can pay for three.ws features and for each other\'s services in $THREE.',
			metric: fmtCompact(p.total_payments || 0),
			metricLabel: 'protocol payments',
			color: '#4ade80',
		},
		{
			icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="width:28px;height:28px"><path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/></svg>`,
			title: 'Treasury acquisitions',
			desc: `The treasury may use part of platform revenue to acquire $THREE for platform use. This is discretionary, can change or stop at any time, and is not a promise of price support.`,
			metric: fmtCompact(stats?.buyback?.three_bought || 0),
			metricLabel: '$THREE bought back',
			color: '#f97316',
		},
	];

	const section = document.createElement('div');

	const header = document.createElement('div');
	header.style.cssText = 'margin-bottom:16px';
	header.innerHTML = `
		<h2 style="font-size:18px;font-weight:700;margin:0 0 4px">What $THREE does</h2>
		<p style="font-size:13.5px;color:var(--nxt-ink-dim);margin:0">How the token is used on three.ws today.</p>
	`;
	section.appendChild(header);

	const grid = document.createElement('div');
	grid.style.cssText =
		'display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px';

	pillars.forEach(({ icon, title, desc, metric, metricLabel, color }) => {
		const card = document.createElement('div');
		card.className = 'dn-panel';
		card.style.cssText = `position:relative;overflow:hidden;transition:border-color .2s,box-shadow .2s;cursor:default;`;
		card.innerHTML = `
			<div style="position:absolute;top:0;left:0;right:0;height:3px;background:${color};opacity:0.6;border-radius:2px 2px 0 0"></div>
			<div style="display:flex;align-items:flex-start;gap:12px;margin-bottom:12px;margin-top:6px">
				<div style="flex-shrink:0;color:${color};opacity:0.9">${icon}</div>
				<div>
					<div style="font-size:15px;font-weight:700;margin-bottom:4px">${esc(title)}</div>
					<div style="font-size:12.5px;color:var(--nxt-ink-dim);line-height:1.5">${esc(desc)}</div>
				</div>
			</div>
			<div style="display:flex;align-items:baseline;gap:8px;padding:10px 12px;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid var(--nxt-stroke)">
				<span style="font-size:20px;font-weight:700;font-family:${MONO};letter-spacing:-0.02em">${metric}</span>
				<span style="font-size:11.5px;color:var(--nxt-ink-fade)">${esc(metricLabel)}</span>
			</div>
		`;
		card.addEventListener('mouseenter', () => {
			card.style.borderColor = color + '33';
			card.style.boxShadow = `0 0 20px ${color}11`;
		});
		card.addEventListener('mouseleave', () => {
			card.style.borderColor = '';
			card.style.boxShadow = '';
		});
		grid.appendChild(card);
	});

	section.appendChild(grid);
	return section;
}

// ── Live USD → $THREE converter ───────────────────────────────────────────────

function renderLiveConverter(tokenConfig) {
	const section = document.createElement('div');
	section.className = 'dn-panel';
	section.style.cssText = 'position:relative;overflow:hidden;';

	const decimals = tokenConfig?.decimals ?? 6;
	const policyRows = tokenConfig?.split_policies
		? Object.entries(tokenConfig.split_policies)
				.map(
					([key, legs]) =>
						`<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--nxt-stroke)">
					<span style="font-size:12px;color:var(--nxt-ink-dim);flex:0 0 160px">${esc(key.replace(/_/g, ' '))}</span>
					${legs
						.map(
							(l) =>
								`<span style="font-size:11.5px;padding:2px 8px;border-radius:4px;background:rgba(255,255,255,.04);border:1px solid var(--nxt-stroke)">${esc(l.role)} ${(l.bps / 100).toFixed(0)}%</span>`,
						)
						.join('')}
				</div>`,
				)
				.join('')
		: '';

	section.innerHTML = `
		<div style="position:absolute;top:0;left:0;right:0;height:3px;background:linear-gradient(90deg,rgba(255,255,255,0.4),rgba(255,255,255,0.15));opacity:0.6;border-radius:2px 2px 0 0"></div>
		<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:20px;margin-top:4px">
			<div>
				<h2 style="font-size:18px;font-weight:700;margin:0 0 4px">Live USD → $THREE Converter</h2>
				<p style="font-size:13px;color:var(--nxt-ink-dim);margin:0">Real-time price quote from Jupiter. Price updates every 30 seconds.</p>
			</div>
			<div data-slot="price-badge" style="display:flex;align-items:center;gap:8px;padding:6px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:999px">
				<div style="width:6px;height:6px;border-radius:50%;background:#888888;animation:pulse-dot 2s ease-in-out infinite"></div>
				<span style="font-size:12px;color:#888888;font-weight:500" data-slot="price-label">fetching price…</span>
			</div>
		</div>

		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px;align-items:start;margin-bottom:20px">
			<div>
				<label style="display:block;font-size:12.5px;color:var(--nxt-ink-dim);margin-bottom:8px">Amount in USD</label>
				<div style="position:relative">
					<span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px;color:var(--nxt-ink-fade);pointer-events:none;font-family:${MONO}">$</span>
					<input type="number" data-input="usd" value="1" min="0.01" step="0.01" aria-label="Amount in USD" style="
						width:100%;box-sizing:border-box;padding:12px 14px 12px 30px;
						background:rgba(255,255,255,0.04);border:1px solid var(--nxt-stroke);
						border-radius:var(--nxt-radius-sm);color:var(--nxt-ink);font-size:18px;
						font-family:${MONO};font-weight:600;outline:none;transition:border-color .15s;
					" />
				</div>
				<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">
					${[0.1, 0.5, 1, 5, 10].map((v) => `<button class="dn-btn ghost" data-quick="${v}" style="font-size:12px;padding:4px 10px">$${v}</button>`).join('')}
				</div>
			</div>

			<div data-slot="result" style="display:flex;flex-direction:column;gap:10px">
				<div style="padding:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:var(--nxt-radius-sm)">
					<div style="font-size:11.5px;color:var(--nxt-ink-dim);margin-bottom:4px">You receive</div>
					<div data-slot="token-amount" style="font-size:28px;font-weight:700;font-family:${MONO};color:#ffffff;letter-spacing:-0.02em">—</div>
					<div style="font-size:12px;color:var(--nxt-ink-fade);margin-top:3px">$THREE</div>
				</div>
				<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
					<div style="padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid var(--nxt-stroke);border-radius:8px">
						<div style="font-size:11px;color:var(--nxt-ink-fade);margin-bottom:3px">Atomics</div>
						<div data-slot="atomics" style="font-size:12px;font-weight:500;font-family:${MONO};word-break:break-all">—</div>
					</div>
					<div style="padding:10px 12px;background:rgba(255,255,255,0.02);border:1px solid var(--nxt-stroke);border-radius:8px">
						<div style="font-size:11px;color:var(--nxt-ink-fade);margin-bottom:3px">Price per token</div>
						<div data-slot="unit-price" style="font-size:12px;font-weight:500;font-family:${MONO}">—</div>
					</div>
				</div>
			</div>
		</div>

		${
			policyRows
				? `<div>
			<div style="font-size:12.5px;color:var(--nxt-ink-dim);margin-bottom:10px;font-weight:600">Split Policies</div>
			<div style="border-radius:8px;border:1px solid var(--nxt-stroke);overflow:hidden;padding:0 12px">${policyRows}</div>
		</div>`
				: ''
		}

		<style>@keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.4}}@media (prefers-reduced-motion:reduce){@keyframes pulse-dot{0%,100%{opacity:1}}}</style>
	`;

	const usdInput = section.querySelector('[data-input="usd"]');
	const tokenAmountEl = section.querySelector('[data-slot="token-amount"]');
	const atomicsEl = section.querySelector('[data-slot="atomics"]');
	const unitPriceEl = section.querySelector('[data-slot="unit-price"]');
	const priceLabelEl = section.querySelector('[data-slot="price-label"]');

	let currentPrice = null;
	let debounceTimer = null;

	async function refreshPrice() {
		try {
			const usd = Number(usdInput.value) || 1;
			const data = await fetchTokenPrice(usd);
			currentPrice = data.price_usd;
			priceLabelEl.textContent = `$${data.price_usd.toExponential(4)} / $THREE · ${data.source}`;
			if (data.quote) {
				tokenAmountEl.textContent = Number(data.quote.token_amount).toLocaleString(
					undefined,
					{
						maximumFractionDigits: 2,
					},
				);
				atomicsEl.textContent = BigInt(data.quote.atomics).toLocaleString();
			}
			unitPriceEl.textContent = fmtUsd(data.price_usd);
		} catch {
			priceLabelEl.textContent = 'price unavailable';
		}
	}

	function scheduleRefresh(delay = 0) {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(refreshPrice, delay);
	}

	usdInput.addEventListener('input', () => scheduleRefresh(300));
	usdInput.addEventListener('focus', () => {
		usdInput.style.borderColor = 'rgba(255,255,255,0.28)';
	});
	usdInput.addEventListener('blur', () => {
		usdInput.style.borderColor = '';
	});

	section.querySelectorAll('[data-quick]').forEach((btn) => {
		btn.addEventListener('click', () => {
			usdInput.value = btn.dataset.quick;
			scheduleRefresh(0);
		});
	});

	// Initial fetch + auto-refresh every 30 s
	refreshPrice();
	const interval = setInterval(refreshPrice, 30_000);
	// Clean up interval when element is removed from DOM
	new MutationObserver((_m, obs) => {
		if (!document.contains(section)) {
			clearInterval(interval);
			obs.disconnect();
		}
	}).observe(document.body, { childList: true, subtree: true });

	return section;
}

// ── Buyback section ───────────────────────────────────────────────────────────

// The platform never burns $THREE. What it commits to is buying $THREE with a
// fixed share of revenue, so this panel reports that ledger exactly as
// /api/three-token/stats returns it, including when the engine is switched off.
function renderBuyback(stats) {
	const bb = stats?.buyback || {};
	const enabled = bb.enabled === true;
	const lastRun = bb.last_run?.created_at || bb.last_run?.at || null;

	const section = document.createElement('div');
	section.className = 'dn-panel';
	section.style.cssText = 'position:relative;overflow:hidden;';

	const cell = (label, value, sub) => `
		<div style="padding:16px;background:rgba(255,255,255,0.02);border:1px solid var(--nxt-stroke);border-radius:var(--nxt-radius-sm)">
			<div style="font-size:11.5px;color:var(--nxt-ink-dim);margin-bottom:4px">${label}</div>
			<div style="font-size:22px;font-weight:700;font-family:${MONO}">${value}</div>
			<div style="font-size:11.5px;color:var(--nxt-ink-fade);margin-top:2px">${sub}</div>
		</div>`;

	section.innerHTML = `
		<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-top:4px;margin-bottom:20px">
			<div>
				<h2 style="font-size:18px;font-weight:700;margin:0 0 4px">Treasury acquisitions</h2>
				<p style="font-size:13px;color:var(--nxt-ink-dim);margin:0">The treasury may use part of platform revenue to acquire $THREE for platform use. This ledger reports what it has done. It is discretionary and not a promise of price support.</p>
			</div>
			<span style="font-size:11.5px;padding:4px 10px;border-radius:999px;border:1px solid var(--nxt-stroke);color:${enabled ? 'var(--nxt-success)' : 'var(--nxt-ink-dim)'}">${enabled ? 'Engine on' : 'Engine off'}</span>
		</div>
		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
			${cell('Committed', fmtUsd(bb.committed_usd || 0), `of ${fmtUsd(bb.revenue_usd || 0)} revenue`)}
			${cell('Deployed', fmtUsd(bb.deployed_usd || 0), `${Number(bb.commitment_progress_pct || 0).toFixed(1)}% of commitment`)}
			${cell('$THREE bought', fmtCompact(bb.three_bought || 0), `${fmtCompact(bb.runs || 0)} run${bb.runs === 1 ? '' : 's'}${lastRun ? `, last ${new Date(lastRun).toLocaleDateString()}` : ''}`)}
		</div>
		${enabled ? '' : '<div style="margin-top:16px;padding:12px 16px;border:1px solid var(--nxt-stroke);border-radius:8px;font-size:12.5px;color:var(--nxt-ink-dim);line-height:1.55">The buyback engine is not running yet, so nothing has been bought. These figures update from the live ledger the moment it starts.</div>'}
	`;

	return section;
}

// ── Activity feed ─────────────────────────────────────────────────────────────

function renderActivityFeed(activityData) {
	const events = activityData?.events || [];

	const section = document.createElement('div');
	section.className = 'dn-panel';

	const sourceColors = {
		payment: '#4ade80',
		echo: '#60a5fa',
		validate_model: '#888888',
		inspect_model: '#fbbf24',
		optimize_model: '#f472b6',
		search_public_avatars: '#60a5fa',
	};

	if (!events.length) {
		section.innerHTML = `
			<h2 style="font-size:18px;font-weight:700;margin:0 0 4px">Protocol Activity</h2>
			<p style="font-size:13px;color:var(--nxt-ink-dim);margin:0 0 20px">Real-time feed of $THREE protocol events</p>
			<div style="text-align:center;padding:32px 16px">
				<div style="font-size:32px;margin-bottom:12px;opacity:0.5">&#9678;</div>
				<p style="font-size:14px;color:var(--nxt-ink-dim);margin:0 0 6px">No protocol activity yet</p>
				<p style="font-size:12.5px;color:var(--nxt-ink-fade);margin:0;max-width:360px;margin-left:auto;margin-right:auto">
					Activity will appear here as agents transact, skills are purchased, and revenue flows through the protocol.
				</p>
			</div>
		`;
		return section;
	}

	section.innerHTML = `
		<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
			<div>
				<h2 style="font-size:18px;font-weight:700;margin:0 0 4px">Protocol Activity</h2>
				<p style="font-size:13px;color:var(--nxt-ink-dim);margin:0">Real-time feed of $THREE protocol events</p>
			</div>
			<div style="font-size:12px;color:var(--nxt-ink-fade)">${events.length} recent events</div>
		</div>
		<div data-slot="events" style="display:flex;flex-direction:column;gap:1px;border-radius:var(--nxt-radius-sm);overflow:hidden;border:1px solid var(--nxt-stroke)"></div>
	`;

	const eventsHost = section.querySelector('[data-slot="events"]');

	events.slice(0, 15).forEach((evt) => {
		const row = document.createElement('div');
		const srcColor = sourceColors[evt.type] || '#4ade80';
		const srcLabel = evt.type || 'payment';
		row.style.cssText = `display:flex;align-items:center;gap:12px;padding:10px 14px;background:rgba(255,255,255,0.015);transition:background .12s;`;
		row.innerHTML = `
			<div style="width:8px;height:8px;border-radius:50%;background:${srcColor};flex-shrink:0;opacity:0.8"></div>
			<div style="flex:1;min-width:0">
				<div style="font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
					<span style="color:${srcColor};font-weight:600">${esc(srcLabel)}</span>
					<span style="color:var(--nxt-ink-fade);margin:0 6px">&middot;</span>
					<span>${esc(evt.agent_name)}</span>
				</div>
			</div>
			<div style="font-size:13px;font-weight:600;font-family:${MONO};flex-shrink:0">
				${evt.gross_usd != null ? fmtUsd(evt.gross_usd) : '—'}
			</div>
			<div style="font-size:11.5px;color:var(--nxt-ink-fade);flex-shrink:0;min-width:60px;text-align:right">
				${evt.created_at ? relTime(evt.created_at) : ''}
			</div>
		`;
		row.addEventListener('mouseenter', () => {
			row.style.background = 'rgba(255,255,255,0.04)';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = 'rgba(255,255,255,0.015)';
		});
		eventsHost.appendChild(row);
	});

	return section;
}

// ── Token info footer ─────────────────────────────────────────────────────────

function renderTokenInfo() {
	const section = document.createElement('div');
	section.className = 'dn-panel';
	section.style.cssText = 'position:relative;overflow:hidden;';

	section.innerHTML = `
		<h2 style="font-size:18px;font-weight:700;margin:0 0 16px">Token Info</h2>
		<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px">
			<div>
				<table style="width:100%;border-collapse:collapse">
					<tbody>
						${infoRow('Token', '$THREE')}
						${infoRow('Network', 'Solana')}
						${infoRow('Standard', 'SPL Token')}
						${infoRow('Decimals', '6')}
					</tbody>
				</table>
			</div>
			<div>
				<table style="width:100%;border-collapse:collapse">
					<tbody>
						${infoRow('Contract', shortAddr(THREE_MINT))}
						${infoRow('Launched on', 'Pump.fun')}
						${infoRow('Burn per deploy', '1,000 $THREE')}
					</tbody>
				</table>
			</div>
		</div>
		<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
			<a class="dn-btn" href="https://pump.fun/coin/${THREE_MINT}" target="_blank" rel="noopener" style="font-size:12.5px">
				View on Pump.fun &#8599;
			</a>
			<a class="dn-btn" href="https://solscan.io/token/${THREE_MINT}" target="_blank" rel="noopener" style="font-size:12.5px">
				Solscan &#8599;
			</a>
			<a class="dn-btn" href="https://birdeye.so/token/${THREE_MINT}?chain=solana" target="_blank" rel="noopener" style="font-size:12.5px">
				Birdeye &#8599;
			</a>
			<button class="dn-btn ghost" data-action="copy-ca" style="font-size:12.5px">
				Copy Contract Address
			</button>
		</div>
		<div style="margin-top:12px">
			<div style="font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dn-dim,#8a8a9c);margin-bottom:6px">Trade $THREE on</div>
			<div style="display:flex;gap:8px;flex-wrap:wrap">
				${terminalLinks(THREE_MINT, { from: 'dashboard-three' }).map((t) => `
					<a class="dn-btn" href="${esc(t.url)}" target="_blank" rel="noopener" style="font-size:12.5px">
						${esc(t.label)} &#8599;
					</a>
				`).join('')}
			</div>
		</div>
	`;

	section.querySelector('[data-action="copy-ca"]').addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(THREE_MINT);
			toast('Contract address copied');
		} catch {
			toast('Copy failed');
		}
	});

	return section;
}

function infoRow(label, value) {
	return `<tr>
		<td style="padding:6px 12px 6px 0;font-size:12.5px;color:var(--nxt-ink-fade);white-space:nowrap">${esc(label)}</td>
		<td style="padding:6px 0;font-size:13px;font-weight:500;font-family:${MONO}">${value}</td>
	</tr>`;
}

function shortAddr(addr) {
	return addressHtml(addr, { head: 6, tail: 4 });
}
