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

// ── Shareable permalinks ────────────────────────────────────────────────────

/*
 * A generated portfolio is shared by putting the manifest itself in the URL.
 *
 * The alternative was sharing the prompt, which is what `?q=` does, and a prompt
 * does not reproduce a portfolio: the screen is a language model, so the same
 * sentence returns a different basket tomorrow. A link that silently resolves to
 * something else is worse than no link. The manifest IS the portfolio, so it
 * travels whole and the recipient sees exactly what the sender saw.
 *
 * Deflate-compressed where the browser has CompressionStream (every current one),
 * which takes a typical manifest from ~4KB to under 1KB of base64url and keeps
 * the URL comfortably inside the limits proxies impose. Uncompressed is a valid
 * payload too, so an older browser still reads links and only writes longer ones.
 */

function bytesToBase64Url(bytes) {
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
	const padded = text.replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function encodeManifest(manifest) {
	const raw = new TextEncoder().encode(JSON.stringify(manifest));
	if (typeof CompressionStream !== 'function') return `0${bytesToBase64Url(raw)}`;
	const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
	const packed = new Uint8Array(await new Response(stream).arrayBuffer());
	return `1${bytesToBase64Url(packed)}`;
}

async function decodeManifest(text) {
	const flag = text[0];
	const bytes = base64UrlToBytes(text.slice(1));
	if (flag === '0') return JSON.parse(new TextDecoder().decode(bytes));
	if (flag !== '1' || typeof DecompressionStream !== 'function') {
		throw new Error('this link needs a browser with decompression support');
	}
	const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
	return JSON.parse(await new Response(stream).text());
}

/** Rebuild the on-screen result from a shared manifest, with the hash re-derived server-side. */
async function openSharedManifest(encoded) {
	setBusy(true);
	showSkeleton();
	el.status.textContent = 'Opening a shared portfolio...';
	try {
		const manifest = await decodeManifest(encoded);
		const constituents = (manifest.constituents || []).map((c) => ({
			address: c.address,
			symbol: c.symbol,
			assetClass: c.assetClass,
			weightBps: c.weightBps,
			rationale: c.rationale,
			priceUsd: c.priceUsdAtSelection ?? null,
			liquidityUsd: c.liquidityUsdAtSelection ?? null,
			change24hPct: null,
		}));
		if (constituents.length < 2) throw new Error('that link does not contain a portfolio');

		// The hash is never taken from the link. It is re-derived from the document
		// by the same canonicalisation the registry commits, so a tampered link
		// shows a different hash rather than a borrowed one.
		const { manifestHash } = await getJson(`${API}/manifest`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ manifest }),
		});

		el.prompt.value = manifest.prompt || '';
		updateCounter();
		renderResult({
			screen: {
				name: manifest.name,
				symbol: manifest.symbol,
				thesis: manifest.thesis,
				rebalanceDays: manifest.rebalance?.intervalDays ?? 30,
				constituents,
			},
			manifest,
			manifestHash,
			provider: 'shared link',
			model: null,
			universeConsidered: manifest.universe?.consideredCount ?? constituents.length,
			shared: true,
		});
		el.status.textContent = '';
	} catch (err) {
		showError(new Error(`That shared link could not be opened: ${err.message}`));
		el.status.textContent = '';
	} finally {
		setBusy(false);
	}
}

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

			<section class="hp-backtest" id="hp-backtest" aria-label="Backtest">
				<h3>What this basket would have done</h3>
				<div class="hp-sk-line" style="width:60%"></div>
				<div class="hp-sk-line" style="width:40%;margin-bottom:0"></div>
			</section>

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
					<button type="button" class="hp-btn hp-btn-ghost" data-action="copy-link">Copy shareable link</button>
					<button type="button" class="hp-btn hp-btn-ghost" data-action="refine">Refine this portfolio</button>
					<a class="hp-btn hp-btn-ghost" href="/markets/robinhood/portfolios/universe">Inspect the universe</a>
				</div>
			</div>
		</article>`;

	// Every surface that renders a portfolio gets its backtest, rather than only
	// the freshly generated one: a shared link showed an empty panel forever.
	loadBacktest(result);
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
		// Share the manifest, not the prompt: the screen is a model, so the same
		// sentence returns a different basket tomorrow.
		try {
			const url = new URL(window.location.href);
			url.searchParams.delete('q');
			url.searchParams.set('p', await encodeManifest(result.manifest));
			window.history.replaceState(null, '', url);
		} catch {
			// A URL that got too long for the browser is not a reason to lose the
			// result that is already on screen.
		}
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

// ── Backtest ────────────────────────────────────────────────────────────────

/**
 * A two-line area chart, drawn as inline SVG.
 *
 * No chart library: this is two polylines and a fill, the page already ships no
 * runtime dependencies, and an external script would be blocked by the CSP on
 * embedded surfaces anyway. Both series are scaled to one shared axis so the gap
 * between them is readable, which is the entire point of the chart.
 */
function sparkChart(rebalanced, held) {
	const W = 720;
	const H = 180;
	const PAD = 4;
	const all = [...rebalanced.map((p) => p.valueUsd), ...held.map((p) => p.valueUsd)];
	const min = Math.min(...all);
	const max = Math.max(...all);
	const span = max - min || 1;
	const x = (i, n) => PAD + (i / Math.max(1, n - 1)) * (W - PAD * 2);
	const y = (v) => H - PAD - ((v - min) / span) * (H - PAD * 2);
	const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${x(i, pts.length).toFixed(1)},${y(p.valueUsd).toFixed(1)}`).join(' ');

	const rPath = path(rebalanced);
	const area = `${rPath} L${x(rebalanced.length - 1, rebalanced.length).toFixed(1)},${H - PAD} L${PAD},${H - PAD} Z`;

	return `<svg class="hp-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
		aria-label="Value of the rebalanced basket against the same basket never rebalanced, over ${rebalanced.length} days">
		<path class="hp-chart-area" d="${area}" />
		<path class="hp-chart-held" d="${path(held)}" />
		<path class="hp-chart-line" d="${rPath}" />
	</svg>`;
}

function renderBacktest(data) {
	const slot = document.getElementById('hp-backtest');
	if (!slot) return;

	if (!data || data.ok === false) {
		const uncovered = (data?.uncovered || []).map((u) => u.symbol).filter(Boolean);
		slot.innerHTML = `
			<h3>What this basket would have done</h3>
			<p class="hp-note" style="margin-top:0">
				${escapeHtml(data?.reason || 'No price history is available for this basket yet.')}
				${uncovered.length ? `Waiting on: ${escapeHtml(uncovered.join(', '))}.` : ''}
			</p>`;
		return;
	}

	const r = data.rebalanced;
	const h = data.heldWithoutRebalancing;
	const delta = data.rebalancingAddedPct;
	const sign = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
	const cls = (n) => (n > 0 ? 'hp-pos' : n < 0 ? 'hp-neg' : 'hp-muted');
	const coveredPct = ((data.coveredWeightBps / data.totalWeightBps) * 100).toFixed(0);
	const uncovered = data.uncovered || [];

	slot.innerHTML = `
		<h3>What this basket would have done</h3>
		<div class="hp-bt-grid">
			<div>
				<span class="hp-bt-label">Rebalanced every ${escapeHtml(String(data.rebalanceDays))} days</span>
				<span class="hp-bt-value ${cls(r.totalReturnPct)}">${escapeHtml(sign(r.totalReturnPct))}</span>
			</div>
			<div>
				<span class="hp-bt-label">Never rebalanced</span>
				<span class="hp-bt-value ${cls(h.totalReturnPct)}">${escapeHtml(sign(h.totalReturnPct))}</span>
			</div>
			<div>
				<span class="hp-bt-label">Rebalancing added</span>
				<span class="hp-bt-value ${cls(delta)}">${escapeHtml(`${delta >= 0 ? '+' : ''}${delta.toFixed(3)} pp`)}</span>
			</div>
			<div>
				<span class="hp-bt-label">Worst drawdown</span>
				<span class="hp-bt-value">${escapeHtml(`-${r.maxDrawdownPct.toFixed(2)}%`)}</span>
			</div>
		</div>

		${sparkChart(r.series, h.series)}

		<p class="hp-chart-key">
			<span class="hp-key-line"></span> rebalanced
			<span class="hp-key-held"></span> never rebalanced
			<span class="hp-muted">${escapeHtml(`${data.from} to ${data.to}, ${data.windowDays} days`)}</span>
		</p>

		<p class="hp-note" style="margin-top:.75rem">
			Real prices only: ${escapeHtml(String(data.covered.length))} of
			${escapeHtml(String(data.covered.length + uncovered.length))} holdings had history, covering
			${escapeHtml(coveredPct)}% of the portfolio by weight, and the window is the overlap where all of
			them have data.
			${uncovered.length ? `Not included: ${escapeHtml(uncovered.map((u) => u.symbol).join(', '))}, because ${escapeHtml(uncovered[0].reason)}.` : ''}
			Trading costs are not modelled. Past prices are not a forecast.
		</p>`;
}

async function loadBacktest(result) {
	try {
		const data = await getJson(`${API}/backtest`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				constituents: result.screen.constituents.map((c) => ({ address: c.address, weightBps: c.weightBps })),
				rebalanceDays: result.screen.rebalanceDays,
				days: 90,
			}),
		});
		renderBacktest(data);
	} catch (err) {
		renderBacktest({ ok: false, reason: `The backtest could not be run: ${err.message}` });
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

async function copyShareLink(button) {
	if (!currentResult) return;
	const original = button.textContent;
	try {
		const url = new URL(window.location.href);
		url.searchParams.delete('q');
		url.searchParams.set('p', await encodeManifest(currentResult.manifest));
		await navigator.clipboard.writeText(url.toString());
		button.textContent = 'Link copied';
	} catch {
		button.textContent = 'Could not copy';
	}
	setTimeout(() => {
		button.textContent = original;
	}, 1600);
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
		else if (action === 'copy-link') copyShareLink(button);
		else if (action === 'refine') refine();
		else if (action === 'retry') el.form.requestSubmit();
	});

	// `?p=` carries a whole manifest and reproduces the portfolio exactly. `?q=`
	// is the older prompt-only form, kept working: it re-runs the screen, which
	// may return something different, so the manifest link is what we now write.
	const params = new URL(window.location.href).searchParams;
	const packed = params.get('p');
	const prompt = params.get('q');
	if (packed) {
		openSharedManifest(packed);
	} else if (prompt) {
		el.prompt.value = prompt.slice(0, MAX_PROMPT);
		updateCounter();
		generate(el.prompt.value.trim());
	}
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
