/*
 * Robinhood Portfolios: the generator surface at /markets/robinhood/portfolios.
 *
 * One job: turn a sentence into a portfolio the user can read, check and take
 * on-chain. Everything it renders comes from /api/v1/hood-portfolios/*, which
 * reads Robinhood Chain and runs the screen server-side; there is no sample
 * data path in this file and no state that survives a failed request.
 */

const API = '/api/v1/hood-portfolios';
const MAX_PROMPT = 500;

const EXAMPLES = [
	'AI infrastructure: chip makers plus the crypto compute tokens',
	'Everything that benefits if rates fall',
	'The most traded memecoins on this chain, equal weight',
	'Gold and treasuries with a small crypto tail',
	'Consumer tech I actually use',
];

const el = {};
let currentResult = null;
let inFlight = null;

// ── Formatting ──────────────────────────────────────────────────────────────

const usd = (n, opts = {}) => {
	if (n == null || !Number.isFinite(Number(n))) return '-';
	const v = Number(n);
	const abs = Math.abs(v);
	if (abs >= 1_000_000_000) return `$${(v / 1_000_000_000).toFixed(2)}B`;
	if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
	if (abs >= 1_000) return `$${(v / 1_000).toFixed(1)}k`;
	if (abs >= 1) return `$${v.toFixed(2)}`;
	if (abs === 0) return '$0';
	return `$${v.toPrecision(opts.precision || 3)}`;
};

const pct = (n) => (n == null || !Number.isFinite(Number(n)) ? '-' : `${Number(n).toFixed(2)}%`);
const bpsToPct = (bps) => `${(Number(bps) / 100).toFixed(2)}%`;
const shortHash = (h) => (typeof h === 'string' && h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-8)}` : h || '');

function escapeHtml(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

const CLASS_LABEL = {
	'rwa-equity': 'Equity',
	'crypto-major': 'Major',
	'crypto-native': 'Native',
	stablecoin: 'Stable',
};

// ── Network ─────────────────────────────────────────────────────────────────

async function getJson(url, init) {
	const res = await fetch(url, init);
	let body = null;
	try {
		body = await res.json();
	} catch {
		body = null;
	}
	if (!res.ok) {
		const message = body?.error_description || body?.error || `request failed (HTTP ${res.status})`;
		const err = new Error(message);
		err.status = res.status;
		err.code = body?.error;
		throw err;
	}
	return body?.data ?? body;
}

// ── Header stats ────────────────────────────────────────────────────────────

async function loadStats() {
	try {
		const [health, universe] = await Promise.all([
			getJson(`${API}/health`),
			getJson(`${API}/universe?selectable=1`),
		]);

		if (el.badge) {
			el.badge.dataset.live = health.chainOk ? '1' : '0';
			el.badgeText.textContent = health.chainOk
				? `Robinhood Chain · block ${Number(health.head).toLocaleString('en-US')}`
				: 'Robinhood Chain · unreachable';
		}

		const byClass = universe.tokens.reduce((acc, t) => {
			acc[t.assetClass] = (acc[t.assetClass] || 0) + 1;
			return acc;
		}, {});
		const liquidity = universe.tokens.reduce((s, t) => s + (t.liquidityUsd || 0), 0);

		renderStats([
			{ label: 'Holdable assets', value: universe.tokens.length.toLocaleString('en-US'), sub: 'live liquidity, priced now' },
			{ label: 'Tokenized equities', value: (byClass['rwa-equity'] || 0).toLocaleString('en-US'), sub: `${health.equitiesWithFeeds} with Chainlink feeds` },
			{ label: 'Crypto & long tail', value: ((byClass['crypto-major'] || 0) + (byClass['crypto-native'] || 0)).toLocaleString('en-US'), sub: 'majors and chain-native' },
			{ label: 'Universe liquidity', value: usd(liquidity), sub: 'across every holdable pool' },
		]);
	} catch (err) {
		renderStats([]);
		if (el.badge) {
			el.badge.dataset.live = '0';
			el.badgeText.textContent = 'Market data unavailable';
		}
		console.warn('[portfolios] stats unavailable:', err.message);
	}
}

function renderStats(rows) {
	if (!el.stats) return;
	if (!rows.length) {
		el.stats.innerHTML = `<div class="hp-stat"><dt>Universe</dt><dd>-<small>Could not reach Robinhood Chain. The generator still works once it is back.</small></dd></div>`;
		return;
	}
	el.stats.innerHTML = rows
		.map(
			(r) =>
				`<div class="hp-stat"><dt>${escapeHtml(r.label)}</dt><dd>${escapeHtml(r.value)}<small>${escapeHtml(r.sub)}</small></dd></div>`,
		)
		.join('');
}

// ── The generator ───────────────────────────────────────────────────────────

function setBusy(busy) {
	if (!el.submit) return;
	el.submit.disabled = busy;
	el.submit.innerHTML = busy
		? '<span class="hp-spinner" aria-hidden="true"></span> Screening…'
		: 'Generate portfolio';
	el.prompt.readOnly = busy;
}

function showSkeleton() {
	el.output.innerHTML = `
		<div class="hp-skeleton" role="status" aria-live="polite">
			<span class="sr-only">Screening the universe against your prompt</span>
			<div class="hp-sk-line" style="width:38%;height:20px"></div>
			<div class="hp-sk-line" style="width:72%"></div>
			<div class="hp-sk-line" style="width:64%"></div>
			<div class="hp-sk-line" style="width:80%"></div>
			<div class="hp-sk-line" style="width:56%;margin-bottom:0"></div>
		</div>`;
}

function showError(err) {
	const hint =
		err.code === 'screen_unavailable'
			? 'Every model provider in the chain is busy. This usually clears within a minute.'
			: err.code === 'universe_unavailable'
				? 'Robinhood Chain did not answer, so there was no universe to screen. Try again shortly.'
				: err.status === 429
					? 'You have hit the free rate limit. Wait a moment and try again.'
					: 'Rephrase the prompt, or try one of the examples above.';
	el.output.innerHTML = `
		<div class="hp-error" role="alert">
			<h3>That did not produce a portfolio</h3>
			<p>${escapeHtml(err.message)}</p>
			<p style="margin-top:.5rem">${escapeHtml(hint)}</p>
			<div class="hp-actions"><button type="button" class="hp-btn hp-btn-ghost" data-action="retry">Try again</button></div>
		</div>`;
}

function renderResult(result) {
	currentResult = result;
	const { screen, manifest, manifestHash, provider, model, universeConsidered } = result;
	const maxWeight = Math.max(...screen.constituents.map((c) => c.weightBps), 1);

	const rows = screen.constituents
		.map((c) => {
			const width = ((c.weightBps / maxWeight) * 100).toFixed(1);
			return `
			<tr>
				<td>
					<span class="hp-sym">${escapeHtml(c.symbol || '?')}</span>
					<span class="hp-class" data-class="${escapeHtml(c.assetClass)}">${escapeHtml(CLASS_LABEL[c.assetClass] || c.assetClass)}</span>
					<span class="hp-rationale">${escapeHtml(c.rationale)}</span>
				</td>
				<td class="num">
					${bpsToPct(c.weightBps)}
					<span class="hp-weight-bar" aria-hidden="true"><i style="width:${width}%"></i></span>
				</td>
				<td class="num hp-hide-sm">${escapeHtml(usd(c.priceUsd))}</td>
				<td class="num hp-hide-sm">${escapeHtml(usd(c.liquidityUsd))}</td>
				<td class="num hp-hide-sm ${c.change24hPct > 0 ? 'hp-pos' : c.change24hPct < 0 ? 'hp-neg' : 'hp-muted'}">${escapeHtml(pct(c.change24hPct))}</td>
			</tr>`;
		})
		.join('');

	const classes = [...new Set(screen.constituents.map((c) => c.assetClass))];
	const spansClasses = classes.length > 1;

	el.output.innerHTML = `
		<article class="hp-result" aria-label="Generated portfolio">
			<header class="hp-result-head">
				<div>
					<h2 class="hp-result-title">${escapeHtml(screen.name)}<span class="hp-ticker">${escapeHtml(screen.symbol)}</span></h2>
					<p class="hp-thesis">${escapeHtml(screen.thesis)}</p>
				</div>
			</header>

			<div style="overflow-x:auto">
			<table class="hp-alloc">
				<thead>
					<tr>
						<th scope="col">Constituent</th>
						<th scope="col" class="num">Weight</th>
						<th scope="col" class="num hp-hide-sm">Price</th>
						<th scope="col" class="num hp-hide-sm">Liquidity</th>
						<th scope="col" class="num hp-hide-sm">24h</th>
					</tr>
				</thead>
				<tbody>${rows}</tbody>
			</table>
			</div>

			<div class="hp-manifest">
				<h3>Manifest</h3>
				<div class="hp-hash">
					<code title="${escapeHtml(manifestHash)}">${escapeHtml(shortHash(manifestHash))}</code>
					<button type="button" class="hp-btn hp-btn-ghost" data-action="copy-hash">Copy hash</button>
					<button type="button" class="hp-btn hp-btn-ghost" data-action="download">Download manifest</button>
				</div>
				<p class="hp-note">
					This is the keccak256 of the canonical manifest, and the exact value
					<code>PortfolioRegistry.publish</code> commits on-chain. The document below the hash records the
					prompt, the universe snapshot it was screened against, and every constituent's price and
					liquidity at selection time, so anyone can re-run the screen and check it.
					Rebalances every ${escapeHtml(String(screen.rebalanceDays))} days back to these weights.
				</p>
				<p class="hp-note">
					Screened ${escapeHtml(String(universeConsidered))} holdable assets
					${spansClasses ? `across ${escapeHtml(String(classes.length))} asset classes` : ''}
					via ${escapeHtml(provider || 'the model chain')}${model ? ` (${escapeHtml(model)})` : ''}.
					Weights are binding; the prompt is provenance.
				</p>
				<div class="hp-actions">
					<button type="button" class="hp-btn hp-btn-ghost" data-action="refine">Refine this portfolio</button>
					<a class="hp-btn hp-btn-ghost" href="/markets/robinhood/portfolios/universe">Inspect the universe</a>
				</div>
			</div>
		</article>`;
}

async function generate(prompt) {
	if (inFlight) inFlight.abort();
	const controller = new AbortController();
	inFlight = controller;

	setBusy(true);
	showSkeleton();
	el.status.textContent = 'Reading Robinhood Chain and screening the universe…';

	try {
		const result = await getJson(`${API}/generate`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ prompt }),
			signal: controller.signal,
		});
		renderResult(result);
		el.status.textContent = '';
		// Make the result shareable without a backend: the prompt reproduces it.
		const url = new URL(window.location.href);
		url.searchParams.set('q', prompt);
		window.history.replaceState(null, '', url);
		el.output.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	} catch (err) {
		if (err.name === 'AbortError') return;
		showError(err);
		el.status.textContent = '';
	} finally {
		if (inFlight === controller) inFlight = null;
		setBusy(false);
	}
}

// ── Actions ─────────────────────────────────────────────────────────────────

async function copyHash(button) {
	if (!currentResult) return;
	try {
		await navigator.clipboard.writeText(currentResult.manifestHash);
		const original = button.textContent;
		button.textContent = 'Copied';
		setTimeout(() => {
			button.textContent = original;
		}, 1400);
	} catch {
		// Clipboard is blocked in some embedded contexts; select the code instead
		// so the value is still obtainable rather than silently doing nothing.
		const code = button.parentElement?.querySelector('code');
		if (code) {
			const range = document.createRange();
			range.selectNodeContents(code);
			const sel = window.getSelection();
			sel.removeAllRanges();
			sel.addRange(range);
		}
	}
}

function downloadManifest() {
	if (!currentResult) return;
	const blob = new Blob([JSON.stringify(currentResult.manifest, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = `${currentResult.screen.symbol.toLowerCase()}-manifest.json`;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

function refine() {
	if (!currentResult) return;
	el.prompt.value = `${currentResult.manifest.prompt}, but `;
	el.prompt.focus();
	el.prompt.setSelectionRange(el.prompt.value.length, el.prompt.value.length);
	updateCounter();
	el.prompt.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Wiring ──────────────────────────────────────────────────────────────────

function updateCounter() {
	const len = el.prompt.value.length;
	el.counter.textContent = `${len} / ${MAX_PROMPT}`;
	el.counter.dataset.over = len > MAX_PROMPT ? '1' : '0';
	el.submit.disabled = len === 0 || len > MAX_PROMPT || Boolean(inFlight);
}

function renderExamples() {
	el.examples.innerHTML = EXAMPLES.map(
		(e) => `<button type="button" class="hp-chip" data-example="${escapeHtml(e)}">${escapeHtml(e)}</button>`,
	).join('');
}

function init() {
	el.badge = document.getElementById('hp-badge');
	el.badgeText = document.getElementById('hp-badge-text');
	el.stats = document.getElementById('hp-stats');
	el.form = document.getElementById('hp-form');
	el.prompt = document.getElementById('hp-prompt');
	el.counter = document.getElementById('hp-counter');
	el.submit = document.getElementById('hp-submit');
	el.examples = document.getElementById('hp-examples');
	el.output = document.getElementById('hp-output');
	el.status = document.getElementById('hp-status');
	if (!el.form) return;

	renderExamples();
	updateCounter();
	loadStats();

	el.prompt.addEventListener('input', updateCounter);
	el.prompt.addEventListener('keydown', (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			e.preventDefault();
			el.form.requestSubmit();
		}
	});

	el.form.addEventListener('submit', (e) => {
		e.preventDefault();
		const prompt = el.prompt.value.trim();
		if (!prompt || prompt.length > MAX_PROMPT) return;
		generate(prompt);
	});

	el.examples.addEventListener('click', (e) => {
		const button = e.target.closest('[data-example]');
		if (!button) return;
		el.prompt.value = button.dataset.example;
		updateCounter();
		el.form.requestSubmit();
	});

	el.output.addEventListener('click', (e) => {
		const button = e.target.closest('[data-action]');
		if (!button) return;
		const action = button.dataset.action;
		if (action === 'copy-hash') copyHash(button);
		else if (action === 'download') downloadManifest();
		else if (action === 'refine') refine();
		else if (action === 'retry') el.form.requestSubmit();
	});

	// A shared link carries its prompt, so the page reproduces the portfolio.
	const shared = new URL(window.location.href).searchParams.get('q');
	if (shared) {
		el.prompt.value = shared.slice(0, MAX_PROMPT);
		updateCounter();
		generate(el.prompt.value.trim());
	}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
