// /dextools: the three.ws x DEXTools hub.
//
// Four live pieces, each reading real data:
//   1. $THREE both ways: DEXTools' chart widget for the three / SOL pair beside
//      the /coin3d scene keyed by that same pair.
//   2. Traffic: what /api/coin/dextools-stats has counted, by day, by surface
//      and by coin, over a range the viewer picks.
//   3. The embed builder: paste a DEXTools (or other terminal) link, resolve it
//      to a mint and pair, preview the 3D scene or the Social Boost card, copy
//      the snippet.
//   4. The Social Boost wins, from the one record /three-token also renders.

import { chartEmbedUrls } from './shared/chart-embeds.js';
import { watchEmbed, embedFallbackNode } from './shared/embed-guard.js';
import { THREE_MINT } from './shared/pnl-snapshot.js';
import { THREE_DEXTOOLS_PAIR, DEXTOOLS_PAIR_URL, SOCIAL_BOOST_WINS, socialBoostSummary } from './pump/dextools-social-boost.js';
import { parseTokenInput, embedSnippets } from './dextools-input.js';

const $ = (id) => document.getElementById(id);
const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const shortAddr = (a) => `${a.slice(0, 4)}…${a.slice(-4)}`;
const fmtInt = (n) => Number(n || 0).toLocaleString('en-US');
const fmtUsd0 = (n) => `$${Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
const theme = () => (document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
const loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

// ── 1. $THREE both ways ─────────────────────────────────────────────────────

function mountFrame(host, { src, title, name, href, label }) {
	let cancel = () => {};
	const fail = () => {
		cancel();
		host.replaceChildren(
			embedFallbackNode({
				name,
				href,
				label,
				onRetry: () => mountFrame(host, { src, title, name, href, label }),
				className: 'dx-preview-empty',
				buttonClassName: 'dx-btn',
			}),
		);
		host.style.display = 'grid';
		host.style.placeItems = 'center';
	};
	const skel = document.createElement('div');
	skel.className = 'dx-skel';
	skel.style.cssText = 'position:absolute;inset:0';
	const frame = document.createElement('iframe');
	frame.src = src;
	frame.title = title;
	frame.loading = 'lazy';
	frame.allow = 'clipboard-write; fullscreen';
	// DEXTools' edge refuses a loopback Referer; deployed origins send their own.
	frame.referrerPolicy = loopback ? 'no-referrer' : 'strict-origin-when-cross-origin';
	frame.addEventListener('load', () => {
		cancel();
		skel.remove();
	});
	frame.addEventListener('error', fail);
	cancel = watchEmbed(host, { onTimeout: fail });
	host.replaceChildren(skel, frame);
}

function mountThreeBothWays() {
	const chart = chartEmbedUrls('dextools', { chain: 'solana', token: THREE_MINT, pool: THREE_DEXTOOLS_PAIR, theme: theme() });
	const scene = embedSnippets({ mint: THREE_MINT, pair: THREE_DEXTOOLS_PAIR, origin: location.origin }).scene;
	$('dx-pair-link').href = DEXTOOLS_PAIR_URL;
	$('dx-scene-link').href = `/coin3d?pair=${THREE_DEXTOOLS_PAIR}`;
	mountFrame($('dx-chart'), {
		src: chart.embed,
		title: '$THREE live chart by DEXTools',
		name: 'The DEXTools chart',
		href: DEXTOOLS_PAIR_URL,
		label: 'Open $THREE on DEXTools',
	});
	mountFrame($('dx-scene'), {
		src: scene,
		title: '$THREE in 3D by three.ws',
		name: 'The 3D scene',
		href: `/coin3d?pair=${THREE_DEXTOOLS_PAIR}`,
		label: 'Open the full scene',
	});
}

// ── 2. Traffic ──────────────────────────────────────────────────────────────

const RANGES = [7, 30, 90];
let statsDays = 30;
let statsSeq = 0;

const SURFACE_LABELS = {
	direct: 'Direct link',
	terminals: 'Trading-terminal links',
	'embed-boost': 'Boost card embed',
};
const surfaceLabel = (s) => SURFACE_LABELS[s] || s.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function rangeControl() {
	return `<div class="dx-range" role="group" aria-label="Range">${RANGES.map(
		(d) => `<button type="button" data-days="${d}" aria-pressed="${d === statsDays}">${d}d</button>`,
	).join('')}</div>`;
}

function barsHtml(byDay) {
	const max = Math.max(1, ...byDay.map((d) => d.visits));
	const bars = byDay
		.map((d) => {
			const h = Math.round((d.visits / max) * 100);
			const label = `${d.day}: ${fmtInt(d.visits)} visit${d.visits === 1 ? '' : 's'}`;
			return `<div class="dx-bar${d.visits ? '' : ' is-zero'}" style="height:${h}%" title="${esc(label)}" role="img" aria-label="${esc(label)}"></div>`;
		})
		.join('');
	return `<div class="dx-bars">${bars}</div><div class="dx-axis"><span>${esc(byDay[0]?.day || '')}</span><span>${esc(byDay[byDay.length - 1]?.day || '')}</span></div>`;
}

function tokenRow(t) {
	const name = t.symbol ? `$${t.symbol}` : t.name || shortAddr(t.token);
	const page = t.network === 'solana' ? `/launches/${encodeURIComponent(t.token)}` : null;
	const label = page ? `<a href="${page}">${esc(name)}</a>` : esc(name);
	const sub = t.launchedOnThreeWs ? ' <span class="dx-muted">· launched on three.ws</span>' : '';
	return `<tr><td>${label}${sub}</td><td class="num">${fmtInt(t.visits)}</td></tr>`;
}

function renderStats(data) {
	const box = $('dx-stats');
	box.removeAttribute('aria-busy');
	const head = `
		<div class="dx-stats-head">
			<div>
				<div class="dx-big">${fmtInt(data.visits)}</div>
				<div class="dx-big-label">visits to DEXTools pair pages in the last ${data.days} days, across ${fmtInt(data.tokens)} coin${data.tokens === 1 ? '' : 's'}</div>
			</div>
			${rangeControl()}
		</div>`;
	if (!data.visits) {
		box.innerHTML = `${head}
			<p class="dx-sub" style="margin:8px 0 0">No visit has been counted in this range yet. Every DEXTools link on three.ws feeds this count, so the first click on a coin page, a launch or a boost card shows up here within a few minutes.</p>
			<div class="dx-row" style="margin-top:12px"><a class="dx-btn" href="#builder">Embed a boost card</a><a class="dx-btn" href="/launches">Browse launches</a></div>`;
		return;
	}
	const surfaces = data.bySurface.map((s) => `<tr><td>${esc(surfaceLabel(s.surface))}</td><td class="num">${fmtInt(s.visits)}</td></tr>`).join('');
	const tokens = data.topTokens.map(tokenRow).join('');
	box.innerHTML = `${head}${barsHtml(data.byDay)}
		<div class="dx-split">
			<table class="dx-table"><thead><tr><th>Sent from</th><th class="num">Visits</th></tr></thead><tbody>${surfaces}</tbody></table>
			<table class="dx-table"><thead><tr><th>Top coins</th><th class="num">Visits</th></tr></thead><tbody>${tokens}</tbody></table>
		</div>
		${data.lastVisitAt ? `<p class="dx-msg">Last visit counted ${esc(new Date(data.lastVisitAt).toLocaleString())}.</p>` : ''}`;
}

function renderStatsError(message) {
	const box = $('dx-stats');
	box.removeAttribute('aria-busy');
	box.innerHTML = `<p class="dx-msg is-error" style="margin:0 0 10px">${esc(message)}</p><button type="button" class="dx-btn" id="dx-stats-retry">Try again</button>`;
	$('dx-stats-retry').addEventListener('click', loadStats);
}

async function loadStats() {
	const seq = ++statsSeq;
	$('dx-stats').setAttribute('aria-busy', 'true');
	try {
		const r = await fetch(`/api/coin/dextools-stats?days=${statsDays}`, { headers: { accept: 'application/json' } });
		if (seq !== statsSeq) return;
		if (r.status === 429) return renderStatsError('Too many requests just now. Wait a few seconds and try again.');
		if (!r.ok) return renderStatsError(`The traffic counter did not answer (${r.status}).`);
		renderStats(await r.json());
	} catch {
		if (seq === statsSeq) renderStatsError('Could not reach the traffic counter. Check your connection and try again.');
	}
}

$('dx-stats').addEventListener('click', (e) => {
	const b = e.target.closest('[data-days]');
	if (!b) return;
	statsDays = Number(b.dataset.days);
	loadStats();
});

// ── 3. Embed builder ────────────────────────────────────────────────────────

const builder = { mint: null, pair: null, kind: 'scene', light: false, label: '' };

function setMsg(text, isError = false) {
	const m = $('dx-msg');
	m.textContent = text;
	m.classList.toggle('is-error', isError);
}

async function pairLookup(address) {
	const r = await fetch(`/api/coin/pair?address=${encodeURIComponent(address)}&network=solana`, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(12_000),
	});
	if (r.status === 404) return null;
	if (!r.ok) throw new Error(`pair lookup ${r.status}`);
	return r.json();
}

async function poolLookup(mint) {
	const r = await fetch(`/api/coin/pool?address=${encodeURIComponent(mint)}&network=solana`, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(12_000),
	});
	if (!r.ok) return null;
	return (await r.json())?.pool || null;
}

/** Resolves parsed input to { mint, pair, label }, asking /api/coin/pair whenever a pair is possible. */
async function resolveInput(parsed) {
	if (parsed.kind === 'mint') {
		return { mint: parsed.address, pair: await poolLookup(parsed.address).catch(() => null), label: shortAddr(parsed.address) };
	}
	const market = await pairLookup(parsed.address);
	if (market?.token?.address) {
		return { mint: market.token.address, pair: market.pair || parsed.address, label: market.pairName || market.token.symbol || shortAddr(market.token.address) };
	}
	if (parsed.kind === 'pair') return null;
	// Not a known pair, so the address is the token itself.
	return { mint: parsed.address, pair: await poolLookup(parsed.address).catch(() => null), label: shortAddr(parsed.address) };
}

function renderBuilder() {
	const s = embedSnippets({ mint: builder.mint, pair: builder.pair, theme: builder.light ? 'light' : 'dark' });
	const scene = builder.kind === 'scene';
	$('dx-snippet').textContent = scene ? s.sceneHtml : s.boostHtml;
	for (const b of document.querySelectorAll('[data-kind]')) b.setAttribute('aria-pressed', String(b.dataset.kind === builder.kind));
	const themeBtn = $('dx-theme');
	themeBtn.hidden = scene;
	themeBtn.setAttribute('aria-pressed', String(builder.light));
	$('dx-resolved').textContent = `${builder.label}: mint ${shortAddr(builder.mint)}${builder.pair ? `, pair ${shortAddr(builder.pair)}` : ', no pair indexed yet'}.`;

	// The preview loads the same-origin route so it works on every deployment;
	// the snippet always names production, which is what a host page pastes.
	const local = embedSnippets({ mint: builder.mint, pair: builder.pair, theme: builder.light ? 'light' : 'dark', origin: location.origin });
	const frame = document.createElement('iframe');
	frame.src = scene ? local.scene : local.boost;
	frame.title = scene ? 'Preview: token in 3D' : 'Preview: Boost on DEXTools card';
	frame.width = scene ? '420' : '380';
	frame.height = scene ? '560' : '400';
	frame.loading = 'lazy';
	$('dx-preview').replaceChildren(frame);
	$('dx-out').hidden = false;
}

async function build(raw) {
	const parsed = parseTokenInput(raw);
	if (parsed.error) {
		setMsg(parsed.error, true);
		$('dx-input').focus();
		return;
	}
	const go = $('dx-go');
	go.disabled = true;
	setMsg(`Resolving ${parsed.source === 'address' ? 'the address' : `the ${parsed.source} link`}…`);
	try {
		const out = await resolveInput(parsed);
		if (!out) {
			setMsg('No index knows this pair yet. A brand-new pair appears within minutes of its first trade.', true);
			return;
		}
		Object.assign(builder, out);
		setMsg('');
		renderBuilder();
		try {
			const next = new URL(location.href);
			next.searchParams.set('q', raw.trim());
			next.hash = 'builder';
			history.replaceState(null, '', next);
		} catch {
			/* history is unavailable inside some embedded browsers; the builder still works */
		}
	} catch {
		setMsg('The market index did not answer. This is usually brief, try again in a moment.', true);
	} finally {
		go.disabled = false;
	}
}

$('dx-form').addEventListener('submit', (e) => {
	e.preventDefault();
	build($('dx-input').value);
});
for (const b of document.querySelectorAll('[data-try]')) {
	b.addEventListener('click', () => {
		$('dx-input').value = b.dataset.try === 'mint' ? THREE_MINT : DEXTOOLS_PAIR_URL;
		build($('dx-input').value);
	});
}
for (const b of document.querySelectorAll('[data-kind]')) {
	b.addEventListener('click', () => {
		builder.kind = b.dataset.kind;
		renderBuilder();
	});
}
$('dx-theme').addEventListener('click', () => {
	builder.light = !builder.light;
	renderBuilder();
});
$('dx-copy').addEventListener('click', async (e) => {
	const btn = e.currentTarget;
	try {
		await navigator.clipboard.writeText($('dx-snippet').textContent);
		btn.textContent = 'Copied';
	} catch {
		btn.textContent = 'Select and copy';
	}
	setTimeout(() => (btn.textContent = 'Copy'), 1600);
});

// ── 4. Social Boost wins ────────────────────────────────────────────────────

function renderWins() {
	const { count, totalUsd } = socialBoostSummary(SOCIAL_BOOST_WINS);
	const fmtDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
	$('dx-wins').innerHTML =
		`<article class="dx-card dx-win"><b>${fmtUsd0(totalUsd)}</b><p>of $THREE bought by DEXTools across ${count} wins</p></article>` +
		SOCIAL_BOOST_WINS.map(
			(w) => `<article class="dx-card dx-win"><b>${fmtUsd0(w.prizeUsd)}</b><p>${w.period === 'weekly' ? 'Weekly' : 'Daily'} winner, ${esc(fmtDate(w.date))} · <a href="${esc(w.receipt)}" target="_blank" rel="noopener">Receipt ↗</a></p></article>`,
		).join('');
}

// ── boot ────────────────────────────────────────────────────────────────────

mountThreeBothWays();
renderWins();
loadStats();

const params = new URLSearchParams(location.search);
const deepLink = params.get('q') || params.get('mint') || params.get('pair');
if (deepLink) {
	$('dx-input').value = deepLink;
	build(deepLink);
}
