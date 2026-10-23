/**
 * /fee-bridge: a coin's creator fees, paid to an X account in USDC.
 *
 * Data flow (all real, see api/fee-bridge/[action].js):
 *   GET  /api/fee-bridge/stats            totals, config, latest payouts
 *   GET  /api/fee-bridge/coins            coins routing fees to the bridge
 *   GET  /api/fee-bridge/me               the signed-in user's handle, balance, wallets
 *   GET  /api/fee-bridge/recipient?handle any handle's public balance
 *   POST /api/fee-bridge/register         register a routed coin to a handle
 *   POST /api/fee-bridge/withdraw         pay the signed-in user's balance
 *   POST /api/auth/wallets/nonce-solana + link-solana   link a payout wallet (SIWS)
 *   GET  /api/auth/x/connect?scope=read&return_to=/fee-bridge   prove the handle
 */

import { shortAddress as shortAddr } from './shared/address.js';

const $ = (id) => document.getElementById(id);

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const usd = (atomics) => {
	const n = Number(BigInt(atomics ?? 0)) / 1e6;
	return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const solscanTx = (sig) => `https://solscan.io/tx/${encodeURIComponent(sig)}`;
const HANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

function parseHandle(raw) {
	let s = String(raw || '').trim();
	s = s.replace(/^https?:\/\//i, '').replace(/^(?:www\.|mobile\.)?(?:x|twitter)\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
	return HANDLE_RE.test(s) ? s : null;
}

function timeAgo(iso) {
	if (!iso) return '';
	const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
	if (s < 60) return `${s}s ago`;
	if (s < 3600) return `${Math.round(s / 60)}m ago`;
	if (s < 86400) return `${Math.round(s / 3600)}h ago`;
	return `${Math.round(s / 86400)}d ago`;
}

async function api(path, { method = 'GET', body } = {}) {
	const res = await fetch(path, {
		method,
		credentials: 'include',
		headers: body ? { 'content-type': 'application/json' } : undefined,
		body: body ? JSON.stringify(body) : undefined,
	});
	let data = null;
	try {
		data = await res.json();
	} catch {
		data = null;
	}
	if (!res.ok) {
		const err = new Error(data?.error_description || `Request failed (${res.status})`);
		err.status = res.status;
		err.code = data?.error;
		err.body = data;
		throw err;
	}
	return data;
}

const state = { config: null, me: null, busy: false };

// ── Stats + ledger ──────────────────────────────────────────────────────────

function setStat(id, text) {
	const el = $(id);
	el.textContent = text;
	el.removeAttribute('data-skel');
}

function renderConfig(config) {
	state.config = config;
	const addr = $('fb-bridge-addr');
	const copy = $('fb-copy-addr');
	if (config.bridge_wallet) {
		addr.textContent = config.bridge_wallet;
		copy.disabled = false;
	} else {
		addr.textContent = 'Bridge wallet not configured on this deployment';
	}
	const a = config.recipient_bps / 100;
	const b = config.buyback_bps / 100;
	$('fb-split-a').style.setProperty('--w', `${a}%`);
	$('fb-split-b').style.setProperty('--w', `${b}%`);
	$('fb-split-a-l').textContent = `${a}%`;
	$('fb-split-b-l').textContent = `${b}%`;

	const banner = $('fb-banner');
	if (!config.enabled && !banner.dataset.status) {
		banner.dataset.status = 'shown';
		const status = config.bridge_wallet
			? 'Payouts are paused right now. Balances keep accruing and are safe; withdrawals reopen shortly.'
			: 'The Fee Bridge is not live on this deployment yet. Nothing below can be routed or withdrawn until it is.';
		// Keep an X-connect outcome that is already showing, and add the status after it.
		banner.textContent = banner.hidden ? status : `${banner.textContent} ${status}`;
		banner.dataset.tone = 'warn';
		banner.hidden = false;
	}
}

function renderPayouts(rows) {
	const ul = $('fb-payouts');
	if (!rows.length) {
		ul.innerHTML = `<li class="fb-empty">No payouts yet. The first one lands here the moment a recipient withdraws.</li>`;
		return;
	}
	ul.innerHTML = rows
		.map(
			(p) => `<li class="fb-row">
				<a class="fb-row-main" href="https://x.com/${esc(p.handle)}" target="_blank" rel="noopener">@${esc(p.handle)}</a>
				<span class="fb-row-amt">${usd(p.usdc_atomics)}</span>
				<a class="fb-row-meta" href="${solscanTx(p.signature)}" target="_blank" rel="noopener" title="View transaction">${esc(timeAgo(p.confirmed_at))} ↗</a>
			</li>`,
		)
		.join('');
}

function coinLabel(c) {
	return c.symbol ? `$${esc(c.symbol)}` : esc(shortAddr(c.mint));
}

function renderCoinRows(ul, coins, emptyText) {
	if (!coins.length) {
		ul.innerHTML = `<li class="fb-empty">${emptyText}</li>`;
		return;
	}
	ul.innerHTML = coins
		.map(
			(c) => `<li class="fb-row${c.status === 'active' ? '' : ' is-off'}">
				<a class="fb-row-main" href="/launches/${esc(c.mint)}">${coinLabel(c)}</a>
				<span class="fb-row-to">to <a href="https://x.com/${esc(c.handle)}" target="_blank" rel="noopener">@${esc(c.handle)}</a></span>
				<span class="fb-row-amt">${usd(c.credited_usdc_atomics)}</span>
				${c.status === 'active' ? '' : '<span class="fb-tag">no longer routed</span>'}
			</li>`,
		)
		.join('');
}

async function loadPublic() {
	try {
		const [stats, coins] = await Promise.all([api('/api/fee-bridge/stats'), api('/api/fee-bridge/coins?limit=25')]);
		renderConfig(stats.config);
		setStat('fb-stat-paid', usd(stats.totals.paid_usdc_atomics));
		setStat('fb-stat-unpaid', usd(stats.totals.unpaid_usdc_atomics));
		setStat('fb-stat-coins', String(stats.totals.coins));
		setStat('fb-stat-buyback', usd(stats.totals.buyback_usdc_atomics));
		renderPayouts(stats.recent_payouts);
		renderCoinRows($('fb-coins'), coins.coins, 'No coins route fees here yet. <a href="#route">Be the first</a>.');
	} catch (e) {
		for (const id of ['fb-stat-paid', 'fb-stat-unpaid', 'fb-stat-coins', 'fb-stat-buyback']) setStat(id, '-');
		const msg = `<li class="fb-error">Could not load the ledger (${esc(e.message)}). <button class="fb-link" data-retry>Retry</button></li>`;
		$('fb-payouts').innerHTML = msg;
		$('fb-coins').innerHTML = msg;
		document.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', loadPublic, { once: true }));
	}
}

// ── Claim panel ─────────────────────────────────────────────────────────────

function claimChip(text, tone) {
	const chip = $('fb-claim-chip');
	chip.hidden = !text;
	chip.textContent = text || '';
	chip.dataset.tone = tone || '';
}

function renderClaim(html) {
	$('fb-claim-body').innerHTML = html;
}

function connectXHref() {
	return '/api/auth/x/connect?scope=read&return_to=%2Ffee-bridge';
}

function renderPayoutHistory(payouts) {
	if (!payouts.length) return '';
	return `<h3 class="fb-h3">Your payouts</h3><ul class="fb-rows fb-rows-tight">${payouts
		.map(
			(p) => `<li class="fb-row">
				<span class="fb-row-main">${usd(p.usdc_atomics)}</span>
				<span class="fb-row-to">to ${esc(shortAddr(p.wallet))}</span>
				<span class="fb-status" data-status="${esc(p.status)}">${esc(p.status)}</span>
				${p.signature ? `<a class="fb-row-meta" href="${solscanTx(p.signature)}" target="_blank" rel="noopener">${esc(timeAgo(p.created_at))} ↗</a>` : `<span class="fb-row-meta">${esc(timeAgo(p.created_at))}</span>`}
			</li>`,
		)
		.join('')}</ul>`;
}

function renderMe(me) {
	state.me = me;
	const cfg = me.config;

	if (!me.x_connected) {
		claimChip('', '');
		renderClaim(`
			<p class="fb-lead">Fees addressed to your X handle wait here until you claim them.</p>
			<a class="fb-btn fb-btn-primary fb-btn-x" href="${connectXHref()}">Connect X to see your balance</a>
			<p class="fb-muted">Read-only access. The bridge only needs to know which handle is yours; it never posts.</p>`);
		return;
	}

	if (me.handle_conflict) {
		claimChip('Handle already claimed', 'warn');
		renderClaim(`
			<p class="fb-lead">@${esc(me.x_username)} was claimed by a different X account.</p>
			<p class="fb-muted">Balances bind to the X account that first withdrew them, so a renamed handle cannot be claimed by its new owner. If this is your original account, reconnect it on X.</p>
			<a class="fb-btn" href="${connectXHref()}">Reconnect X</a>`);
		return;
	}

	const bal = me.balance;
	const unpaid = BigInt(bal.unpaid_usdc_atomics);
	const minWithdraw = BigInt(Math.round(cfg.withdraw_min_usd * 1e6));
	const canWithdraw = cfg.enabled && unpaid >= minWithdraw && me.wallets.length > 0;
	claimChip(`@${me.handle}`, 'ok');

	const walletBlock = me.wallets.length
		? `<label class="fb-label" for="fb-wallet">Pay to</label>
			<select id="fb-wallet" class="fb-select">${me.wallets
				.map((w) => `<option value="${esc(w.address)}">${esc(shortAddr(w.address))}${w.primary ? ' (primary)' : ''}</option>`)
				.join('')}</select>`
		: `<div class="fb-note">Link a Solana wallet to receive USDC. Your wallet signs a message; no funds move.
			<button class="fb-btn fb-btn-sm" id="fb-link-wallet" type="button">Link Solana wallet</button></div>`;

	const hint = !cfg.enabled
		? 'Withdrawals are paused right now. Your balance is safe.'
		: unpaid === 0n
			? me.coins.length
				? 'Nothing to withdraw yet. Fees convert to USDC once a coin has earned at least a few dollars.'
				: 'No coin pays this handle yet. Share the bridge with a creator, or route one of your own coins below.'
			: unpaid < minWithdraw
				? `Withdrawals start at ${usd(minWithdraw)}.`
				: `Balances over ${usd(BigInt(Math.round(cfg.auto_payout_usd * 1e6)))} are sent to your primary wallet automatically.`;

	renderClaim(`
		<div class="fb-balance">
			<span class="fb-balance-n">${usd(unpaid)}</span>
			<span class="fb-balance-l">ready to withdraw, USDC on Solana</span>
		</div>
		<dl class="fb-kv">
			<div><dt>Earned</dt><dd>${usd(bal.credited_usdc_atomics)}</dd></div>
			<div><dt>Paid out</dt><dd>${usd(bal.paid_usdc_atomics)}</dd></div>
			<div><dt>Coins paying you</dt><dd>${me.coins.length}</dd></div>
		</dl>
		${walletBlock}
		<button class="fb-btn fb-btn-primary fb-btn-block" id="fb-withdraw" type="button" ${canWithdraw ? '' : 'disabled'}>Withdraw ${usd(unpaid)}</button>
		<p class="fb-muted" id="fb-claim-hint">${esc(hint)}</p>
		<div id="fb-claim-out" aria-live="polite"></div>
		${me.coins.length ? `<h3 class="fb-h3">Coins paying you</h3><ul class="fb-rows fb-rows-tight" id="fb-my-coins"></ul>` : ''}
		${renderPayoutHistory(me.payouts)}`);

	if (me.coins.length) renderCoinRows($('fb-my-coins'), me.coins, '');
	$('fb-withdraw')?.addEventListener('click', withdraw);
	$('fb-link-wallet')?.addEventListener('click', linkWallet);
}

async function loadMe() {
	try {
		renderMe(await api('/api/fee-bridge/me'));
	} catch (e) {
		if (e.status === 401) {
			claimChip('', '');
			renderClaim(`
				<p class="fb-lead">Sign in, connect your X account, and anything addressed to your handle is yours to withdraw.</p>
				<a class="fb-btn fb-btn-primary" href="/login?next=${encodeURIComponent('/fee-bridge#claim')}">Sign in to claim</a>`);
			return;
		}
		renderClaim(`<div class="fb-error">Could not load your balance (${esc(e.message)}). <button class="fb-link" id="fb-me-retry">Retry</button></div>`);
		$('fb-me-retry')?.addEventListener('click', loadMe, { once: true });
	}
}

async function withdraw(ev) {
	if (state.busy) return;
	const btn = ev.currentTarget;
	const out = $('fb-claim-out');
	const wallet = $('fb-wallet')?.value;
	state.busy = true;
	btn.disabled = true;
	btn.classList.add('is-busy');
	btn.textContent = 'Sending USDC…';
	out.innerHTML = '';
	try {
		const r = await api('/api/fee-bridge/withdraw', { method: 'POST', body: wallet ? { wallet } : {} });
		out.innerHTML =
			r.status === 'confirmed'
				? `<div class="fb-ok">Sent ${usd(r.usdc_atomics)} to ${esc(shortAddr(r.wallet))}. <a href="${solscanTx(r.signature)}" target="_blank" rel="noopener">View transaction ↗</a></div>`
				: `<div class="fb-ok">Payout of ${usd(r.usdc_atomics)} submitted and confirming. <a href="${solscanTx(r.signature)}" target="_blank" rel="noopener">Track it ↗</a></div>`;
		state.busy = false;
		await Promise.all([loadMe(), loadPublic()]);
		const again = $('fb-claim-out');
		if (again) again.innerHTML = out.innerHTML;
	} catch (e) {
		state.busy = false;
		btn.disabled = false;
		btn.classList.remove('is-busy');
		btn.textContent = 'Try again';
		out.innerHTML = `<div class="fb-error">${esc(e.message)}</div>`;
	}
}

function solanaProvider() {
	return window.phantom?.solana || window.solana || window.backpack || window.solflare || null;
}

async function linkWallet(ev) {
	const btn = ev.currentTarget;
	const provider = solanaProvider();
	if (!provider) {
		window.open('https://phantom.app/', '_blank', 'noopener');
		return;
	}
	const label = btn.textContent;
	btn.disabled = true;
	btn.textContent = 'Check your wallet…';
	const link = async (takeover) => {
		const res = await provider.connect();
		const address = res?.publicKey?.toString?.() || provider.publicKey?.toString?.();
		if (!address) throw new Error('Your wallet did not return an address.');
		const nonce = await api('/api/auth/wallets/nonce-solana', { method: 'POST', body: { address, chainId: 'mainnet' } });
		const signed = await provider.signMessage(new TextEncoder().encode(nonce.message), 'utf8');
		const signature = btoa(String.fromCharCode(...signed.signature));
		await api('/api/auth/wallets/link-solana', { method: 'POST', body: { message: nonce.message, signature, takeover } });
	};
	try {
		try {
			await link(false);
		} catch (e) {
			if (e?.body?.takeover_available !== true) throw e;
			if (!confirm('That wallet is linked to another three.ws account. Move it to this one?')) throw Object.assign(new Error('cancelled'), { code: 4001 });
			await link(true);
		}
		await loadMe();
	} catch (e) {
		btn.disabled = false;
		btn.textContent = label;
		if (e?.code === 4001 || /reject|denied|cancel/i.test(e?.message || '')) return;
		const out = $('fb-claim-out');
		if (out) out.innerHTML = `<div class="fb-error">${esc(e.message)}</div>`;
	}
}

// ── Lookup ──────────────────────────────────────────────────────────────────

async function lookup(ev) {
	ev.preventDefault();
	const out = $('fb-lookup-out');
	const handle = parseHandle($('fb-lookup-input').value);
	if (!handle) {
		out.innerHTML = `<div class="fb-error">Enter an X handle: letters, digits and underscores, up to 15 characters.</div>`;
		return;
	}
	out.innerHTML = `<div class="fb-skel fb-skel-lg"></div><div class="fb-skel"></div>`;
	try {
		const r = await api(`/api/fee-bridge/recipient?handle=${encodeURIComponent(handle)}`);
		const earned = BigInt(r.credited_usdc_atomics);
		out.innerHTML = `
			<div class="fb-balance fb-balance-sm">
				<span class="fb-balance-n">${usd(r.unpaid_usdc_atomics)}</span>
				<span class="fb-balance-l">waiting for <a href="https://x.com/${esc(r.handle)}" target="_blank" rel="noopener">@${esc(r.handle)}</a></span>
			</div>
			<dl class="fb-kv">
				<div><dt>Earned</dt><dd>${usd(r.credited_usdc_atomics)}</dd></div>
				<div><dt>Paid out</dt><dd>${usd(r.paid_usdc_atomics)}</dd></div>
				<div><dt>Claimed</dt><dd>${r.claimed ? 'Yes' : 'Not yet'}</dd></div>
			</dl>
			${r.coins.length ? '<ul class="fb-rows fb-rows-tight" id="fb-lookup-coins"></ul>' : `<p class="fb-muted">${earned > 0n ? '' : `No coin routes fees to @${esc(r.handle)} yet.`}</p>`}`;
		if (r.coins.length) renderCoinRows($('fb-lookup-coins'), r.coins, '');
	} catch (e) {
		out.innerHTML = `<div class="fb-error">${esc(e.message)}</div>`;
	}
}

// ── Register ────────────────────────────────────────────────────────────────

async function register(ev) {
	ev.preventDefault();
	const out = $('fb-reg-out');
	const submit = $('fb-reg-submit');
	const mint = $('fb-reg-mint').value.trim();
	const handle = parseHandle($('fb-reg-handle').value);
	if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) {
		out.innerHTML = `<div class="fb-error">That is not a Solana mint address.</div>`;
		$('fb-reg-mint').focus();
		return;
	}
	if (!handle) {
		out.innerHTML = `<div class="fb-error">Enter the X handle this coin should pay.</div>`;
		$('fb-reg-handle').focus();
		return;
	}
	submit.disabled = true;
	submit.textContent = 'Checking the chain…';
	out.innerHTML = '';
	try {
		const r = await api('/api/fee-bridge/register', { method: 'POST', body: { mint, handle } });
		out.innerHTML = `<div class="fb-ok">${r.created ? 'Registered.' : 'Already registered.'} Fees from this coin now pay <b>@${esc(r.handle)}</b> in USDC. <a href="/launches/${esc(r.mint)}">Open the coin</a></div>`;
		loadPublic();
	} catch (e) {
		out.innerHTML =
			e.status === 401
				? `<div class="fb-error">Sign in with the account that launched this coin, or that holds its creator wallet. <a href="/login?next=${encodeURIComponent('/fee-bridge#route')}">Sign in</a></div>`
				: `<div class="fb-error">${esc(e.message)}</div>`;
	} finally {
		submit.disabled = false;
		submit.textContent = 'Register coin';
	}
}

// ── Boot ────────────────────────────────────────────────────────────────────

function showConnectOutcome() {
	const params = new URLSearchParams(location.search);
	const x = params.get('x');
	if (!x) return;
	const banner = $('fb-banner');
	const messages = {
		connected: 'X connected. Your balance is below.',
		denied: 'X connection was cancelled. Connect again whenever you are ready.',
		error: 'X did not complete the connection. Try again in a moment.',
		unconfigured: 'X sign-in is not available on this deployment right now.',
	};
	if (messages[x]) {
		banner.hidden = false;
		banner.dataset.tone = x === 'connected' ? 'ok' : 'warn';
		banner.textContent = messages[x];
	}
	params.delete('x');
	history.replaceState(null, '', `${location.pathname}${params.size ? `?${params}` : ''}#claim`);
	$('claim')?.scrollIntoView({ block: 'start' });
}

$('fb-lookup-form').addEventListener('submit', lookup);
$('fb-register').addEventListener('submit', register);
$('fb-copy-addr').addEventListener('click', async (ev) => {
	const btn = ev.currentTarget;
	try {
		await navigator.clipboard.writeText(state.config?.bridge_wallet || '');
		btn.textContent = 'Copied';
	} catch {
		btn.textContent = 'Select and copy';
	}
	setTimeout(() => (btn.textContent = 'Copy'), 1600);
});

const presetHandle = new URLSearchParams(location.search).get('handle');
if (presetHandle && parseHandle(presetHandle)) {
	$('fb-lookup-input').value = parseHandle(presetHandle);
	$('fb-lookup-form').requestSubmit();
}

showConnectOutcome();
loadPublic();
loadMe();
