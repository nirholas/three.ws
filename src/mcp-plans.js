// /mcp-plans: credit bundles and time passes for paid MCP tools.
// Data and purchase come from /api/mcp-plans; plans are paid from the prepaid
// USD balance shown on /credits.

const root = document.getElementById('mp-root');

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = (n) => `$${Number(n).toFixed(2)}`;
const when = (iso) => new Date(iso).toLocaleString();

function duration(seconds) {
	const days = seconds / 86400;
	return days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : `${seconds / 3600} hours`;
}

let csrf = null;
async function csrfToken() {
	if (csrf && csrf.expiresAt > Date.now() + 5000) return csrf.token;
	const r = await fetch('/api/csrf-token', { credentials: 'include' });
	if (!r.ok) throw new Error('Could not get a security token. Sign in again.');
	const j = await r.json();
	csrf = { token: j.data.token, expiresAt: Date.now() + (j.data.expires_in - 30) * 1000 };
	return csrf.token;
}

async function load() {
	const r = await fetch('/api/mcp-plans', { credentials: 'include' });
	if (!r.ok) throw new Error(`Could not load plans (${r.status}).`);
	return (await r.json()).data;
}

function planCard(p, signedIn) {
	const what = p.kind === 'credits' ? `${p.credits.toLocaleString()} credits` : `${duration(p.durationSeconds)} unlimited`;
	return `<div class="mp-card mp-plan">
		<h3>${esc(p.name)}</h3>
		<div class="mp-price">${usd(p.priceUsd)}</div>
		<p>${esc(what)}. ${esc(p.description)}</p>
		<button class="mp-btn" data-plan="${esc(p.slug)}" ${signedIn ? '' : 'disabled'}>${signedIn ? 'Buy with balance' : 'Sign in to buy'}</button>
	</div>`;
}

function render(data, notice) {
	const acct = data.account;
	const signedIn = Boolean(acct);
	const balance = signedIn
		? `<section class="mp-card mp-section"><h2>Your balance</h2>
			<div class="mp-balance">${acct.creditsRemaining.toLocaleString()} <span style="font-size:1rem;font-weight:500">credits</span></div>
			<div class="mp-sub">${
				acct.timePasses.length
					? acct.timePasses.map((t) => `${esc(t.plan)} active until ${esc(when(t.expiresAt))}`).join('. ')
					: 'No active time pass.'
			}</div>
			<div class="mp-sub">Prepaid balance ${usd(acct.usdBalance)}. <a class="mp-link" href="/credits">Top up</a></div>
		</section>`
		: `<section class="mp-card mp-section"><div class="mp-empty"><a class="mp-link" href="/login?next=/mcp-plans">Sign in</a> to buy a plan, see your balance and spend history.</div></section>`;

	const trials = signedIn
		? `<section class="mp-card mp-section"><h2>Free trial calls (${data.trialCallsPerTool} per tool)</h2>${
				acct.trials.used.length
					? `<div class="mp-scroll"><table class="mp-table"><thead><tr><th>Tool</th><th class="num">Used</th><th class="num">Left</th></tr></thead><tbody>${acct.trials.used
							.map((t) => `<tr><td>${esc(t.tool)}</td><td class="num">${t.used}</td><td class="num">${t.remaining}</td></tr>`)
							.join('')}</tbody></table></div>`
					: `<div class="mp-empty">No trial calls used yet. Your first ${data.trialCallsPerTool} calls to each paid tool are free.</div>`
			}</section>`
		: '';

	const tools = `<section class="mp-card mp-section"><h2>Credits per call</h2><div class="mp-scroll"><table class="mp-table"><thead><tr><th>Tool</th><th class="num">Credits</th><th class="num">Pay-per-call</th></tr></thead><tbody>${data.tools
		.map((t) => `<tr><td>${esc(t.tool)}</td><td class="num">${t.credits}</td><td class="num">$${t.amountUsdc}</td></tr>`)
		.join('')}</tbody></table></div></section>`;

	const history = signedIn
		? `<section class="mp-card mp-section"><h2>History</h2>${
				acct.history.length
					? `<div class="mp-scroll"><table class="mp-table"><thead><tr><th>When</th><th>Tool</th><th>Event</th><th class="num">Credits</th></tr></thead><tbody>${acct.history
							.map((h) => `<tr><td>${esc(when(h.at))}</td><td>${esc(h.tool)}</td><td>${esc(h.kind.replace('_', ' '))}</td><td class="num">${h.kind === 'refund' ? '+' : h.kind === 'debit' ? '-' : ''}${h.credits}</td></tr>`)
							.join('')}</tbody></table></div>`
					: '<div class="mp-empty">No metered calls yet. Buy a plan above, then call a paid tool through <code>/api/mcp</code> with your bearer token.</div>'
			}</section>`
		: '';

	root.innerHTML = `${notice ? `<div class="${notice.error ? 'mp-error' : 'mp-empty'}" role="status">${notice.html}</div>` : ''}
		${balance}
		<div class="mp-grid mp-section">${data.plans.map((p) => planCard(p, signedIn)).join('')}</div>
		${trials}${tools}${history}`;
}

async function buy(slug, button) {
	button.disabled = true;
	button.textContent = 'Buying...';
	try {
		const key = crypto.randomUUID();
		const r = await fetch('/api/mcp-plans', {
			method: 'POST',
			credentials: 'include',
			headers: { 'content-type': 'application/json', 'x-csrf-token': await csrfToken() },
			body: JSON.stringify({ plan: slug, idempotency_key: key }),
		});
		const body = await r.json().catch(() => ({}));
		if (r.status === 402) {
			render(await load(), {
				error: true,
				html: `Your prepaid balance is ${usd(body.available_usd ?? 0)}, this plan costs ${usd(body.required_usd ?? 0)}. <a class="mp-link" href="/credits">Top up</a> and try again.`,
			});
			return;
		}
		if (!r.ok) throw new Error(body.error_description || `Purchase failed (${r.status}).`);
		render(await load(), { html: 'Plan purchased. Your credits are ready to use.' });
	} catch (err) {
		try {
			render(await load(), { error: true, html: esc(err.message) });
		} catch {
			root.innerHTML = `<div class="mp-error" role="alert">${esc(err.message)}</div>`;
		}
	}
}

root.addEventListener('click', (e) => {
	const b = e.target.closest('button[data-plan]');
	if (b) buy(b.dataset.plan, b);
});

load().then(
	(data) => render(data),
	(err) => {
		root.innerHTML = `<div class="mp-error" role="alert">${esc(err.message)} <button class="mp-btn" style="width:auto" id="mp-retry">Retry</button></div>`;
		document.getElementById('mp-retry').addEventListener('click', () => location.reload());
	},
);
