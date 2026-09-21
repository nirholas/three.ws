// A token price chart with a source switcher, for surfaces that embed one chart
// in a panel: /trades and the Mission Control focus pane.
//
// The default view is the platform's own live candle chart (TradingView's
// lightweight-charts engine over our OHLCV, mounted by mission-control/chart.js).
// Every provider in src/shared/chart-embeds.js is one tab away, so a trader who
// trusts DEXTools or DexScreener reads the chart they trust without leaving.
// /coin/:id and /launches/<mint> have richer, page-specific switchers built on
// the same provider list; this is the compact one for everywhere else.
//
// The tab bar reuses the `.mc-chart-ivs` / `.mc-chart-iv` segmented-control
// classes both host pages already style for the interval switcher, so it matches
// each page's design system without a second set of theme rules. A host with a
// segmented control of its own passes its class names through `classes`.
//
// A host that already draws a chart keeps it: `nativeViews` replaces the built-in
// candle view with the host's own, and the providers line up beside them. That is
// how /oracle/coin/<mint> keeps its agent-trade overlay and /pump-dashboard its
// canvas chart while gaining every provider. Buildless pages get it through
// chart-switcher-global.js, published at the stable /chart-switcher.js URL.

import { chartEmbedsFor, chartEmbedUrls, resolveChartPool } from './chart-embeds.js';
import { watchEmbed, embedFallbackNode, DEFAULT_EMBED_TIMEOUT_MS } from './embed-guard.js';

// Shared with /launches/<mint>, which uses the same view ids: the chart a trader
// picks is a viewing preference, so it follows them across coin surfaces.
const VIEW_KEY = 'ld_chart_view';

// The built-in native view: the platform's live candle chart. Imported on first
// use so a host that brings its own native views never downloads the engine.
const CANDLES = {
	id: 'tradingview',
	label: 'TradingView',
	mount: async ({ host, mint }) => {
		const { mountPriceChart } = await import('../mission-control/chart.js');
		return mountPriceChart({ host, mint });
	},
};

const DEFAULT_CLASSES = { tabs: 'mc-chart-ivs', tab: 'mc-chart-iv', active: '' };

const STYLE_ID = 'chart-switcher-style';
const CSS = `
.cs-root { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.cs-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px 12px; flex-wrap: wrap; }
.cs-tabs { flex-wrap: wrap; max-width: 100%; }
.cs-open { font-size: .6875rem; font-weight: 600; color: inherit; opacity: .7; text-decoration: none; white-space: nowrap; transition: opacity 140ms; }
.cs-open:hover, .cs-open:focus-visible { opacity: 1; text-decoration: underline; }
.cs-frame-wrap { position: relative; overflow: hidden; border-radius: 8px; min-height: 420px; }
@media (max-width: 640px) { .cs-frame-wrap { min-height: 340px; } }
.cs-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; opacity: 0; transition: opacity 240ms ease; }
.cs-ready .cs-frame { opacity: 1; }
.cs-skel { position: absolute; inset: 0; border-radius: 8px; background: linear-gradient(100deg, transparent 30%, color-mix(in srgb, currentColor 8%, transparent) 50%, transparent 70%) 0 0 / 200% 100%, color-mix(in srgb, currentColor 5%, transparent); animation: cs-shimmer 1.4s linear infinite; }
.cs-ready .cs-skel { display: none; }
.cs-state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 0 16px; text-align: center; font-size: .8125rem; opacity: .85; }
.cs-state p { margin: 0; max-width: 46ch; }
.cs-state a { color: inherit; font-weight: 600; }
.cs-state button { border: 1px solid color-mix(in srgb, currentColor 22%, transparent); padding: 5px 12px; }
.cs-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
@keyframes cs-shimmer { to { background-position: -200% 0, 0 0; } }
@media (prefers-reduced-motion: reduce) { .cs-skel { animation: none; } .cs-frame { transition: none; } }
`;

function ensureStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.appendChild(style);
}

function node(tag, props = {}, children = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'text') n.textContent = v;
		else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v);
	}
	n.append(...children);
	return n;
}

function readView(views, fallback) {
	try {
		const v = localStorage.getItem(VIEW_KEY);
		if (views.some((view) => view.id === v)) return v;
	} catch {
		// Storage blocked: fall through to the default.
	}
	return views.some((view) => view.id === fallback) ? fallback : views[0].id;
}

function currentTheme() {
	return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.host
 * @param {string} opts.mint             Token address.
 * @param {string} [opts.chain]          A CHART_CHAINS id. Solana is the home chain.
 * @param {'mainnet'|'devnet'} [opts.network]  The providers index mainnet only,
 *   so on devnet the candle chart stands alone and no source bar is drawn.
 * @param {Array<{ id: string, label: string, mount: (ctx: { host: HTMLElement, mint: string }) => ({ destroy?(): void } | void | Promise<{ destroy?(): void } | void>) }>} [opts.nativeViews]
 *   The host's own chart views, shown ahead of the providers. Defaults to the
 *   platform candle chart.
 * @param {string} [opts.defaultView]  View to open on when the viewer has no
 *   stored preference that applies here. Defaults to the first view.
 * @param {{ tabs?: string, tab?: string, active?: string }} [opts.classes]
 *   The host's segmented-control class names. `active` is toggled on the selected
 *   tab for hosts whose styles key off a class instead of `aria-selected`.
 * @returns {{ destroy(): void, select(id: string): void }}
 */
export function mountSwitchableChart({
	host,
	mint,
	chain = 'solana',
	network = 'mainnet',
	nativeViews = [CANDLES],
	defaultView,
	classes,
}) {
	ensureStyle();
	const cls = { ...DEFAULT_CLASSES, ...classes };
	const providers = network === 'mainnet' ? chartEmbedsFor(chain) : [];
	const views = [
		...nativeViews.map((v) => ({ ...v, kind: 'native' })),
		...providers.map((p) => ({ id: p.id, label: p.label, kind: 'embed', provider: p })),
	];
	const pools = {}; // provider id → { pool, indexed }
	let active = readView(views, defaultView);
	let teardown = null;
	let seq = 0;
	let destroyed = false;

	const tabs = node('div', { class: `${cls.tabs} cs-tabs`, role: 'tablist', 'aria-label': 'Chart source' });
	const openSlot = node('span', { class: 'cs-open-slot' });
	const viewHost = node('div', { class: 'cs-view' });
	const buttons = views.map((view) =>
		node('button', {
			type: 'button',
			class: cls.tab,
			role: 'tab',
			'data-view': view.id,
			text: view.label,
			onclick: () => select(view.id, { persist: true }),
		}),
	);
	tabs.append(...buttons);
	// Roving tabindex: arrows move between sources, Home/End jump to the ends.
	tabs.addEventListener('keydown', (e) => {
		const i = buttons.indexOf(document.activeElement);
		if (i < 0) return;
		const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: buttons.length - 1 }[e.key];
		if (next == null) return;
		e.preventDefault();
		const target = buttons[(next + buttons.length) % buttons.length];
		select(target.dataset.view, { persist: true });
		target.focus();
	});
	// A switcher with one source is noise: draw the bar only when there is a choice.
	const bar = views.length > 1 ? [node('div', { class: 'cs-bar' }, [tabs, openSlot])] : [];
	host.replaceChildren(node('div', { class: 'cs-root' }, [...bar, viewHost]));

	function select(id, { persist = false } = {}) {
		if (id === active && teardown) return;
		active = id;
		if (persist) {
			try {
				localStorage.setItem(VIEW_KEY, id);
			} catch {
				// Storage blocked: the switch still holds for this page view.
			}
		}
		render();
	}

	function clear() {
		seq += 1;
		try {
			teardown?.();
		} catch {
			// The view already tore itself down.
		}
		teardown = null;
		openSlot.replaceChildren();
	}

	function render() {
		clear();
		if (destroyed) return;
		for (const b of buttons) {
			const on = b.dataset.view === active;
			b.setAttribute('aria-selected', String(on));
			if (cls.active) b.classList.toggle(cls.active, on);
			b.tabIndex = on ? 0 : -1;
		}
		const view = views.find((v) => v.id === active) || views[0];
		if (view.kind === 'native') {
			renderNative(view, seq);
			return;
		}
		renderEmbed(view.provider, seq);
	}

	async function renderNative(view, mySeq) {
		const slot = node('div', { class: 'cs-native' });
		viewHost.replaceChildren(slot);
		// Set before the await: a switch away mid-mount must still find something
		// to tear down, and the late-arriving chart is destroyed on arrival.
		let mounted = null;
		let gone = false;
		teardown = () => {
			gone = true;
			mounted?.destroy?.();
		};
		mounted = (await view.mount({ host: slot, mint })) || null;
		if (gone || mySeq !== seq) mounted?.destroy?.();
	}

	function statePanel(wrap, lines, actions) {
		wrap.replaceChildren(
			node('div', { class: 'cs-state', role: 'status' }, [
				...lines.map((text) => node('p', { text })),
				node('div', { class: 'cs-actions' }, actions),
			]),
		);
	}

	const actionBtn = (text, onclick) => node('button', { type: 'button', class: cls.tab, text, onclick });

	async function renderEmbed(provider, mySeq) {
		// Taller than the candle chart's box on purpose: a provider's embed carries
		// its own toolbars, and at the 240-300px the native chart uses they crowd
		// out the candles.
		const wrap = node('div', { class: 'cs-frame-wrap' }, [node('div', { class: 'cs-skel' })]);
		viewHost.replaceChildren(wrap);
		let cancelWatch = () => {};
		teardown = () => cancelWatch();

		let pool = null;
		if (provider.needs === 'pool') {
			try {
				pools[provider.id] ||= await resolveChartPool(provider.id, chain, mint, { signal: AbortSignal.timeout(10_000) });
			} catch {
				if (mySeq !== seq) return;
				statePanel(wrap, [`We could not look up this coin's trading pool for ${provider.label}.`], [actionBtn('Try again', render)]);
				return;
			}
			if (mySeq !== seq) return;
			if (!pools[provider.id].indexed) {
				const alt = views.find((v) => v.kind === 'embed' && v.provider.needs === 'token');
				statePanel(
					wrap,
					[`${provider.label} cannot chart this coin yet.`, 'It picks up new coins once they build trading history.'],
					[
						...(alt ? [actionBtn(`Show ${alt.label}`, () => select(alt.id, { persist: true }))] : []),
						actionBtn('Check again', () => {
							delete pools[provider.id];
							render();
						}),
					],
				);
				return;
			}
			pool = pools[provider.id].pool;
		}

		const urls = chartEmbedUrls(provider.id, { chain, token: mint, pool, theme: currentTheme() });
		openSlot.replaceChildren(
			node('a', { class: 'cs-open', href: urls.page, target: '_blank', rel: 'noopener', text: `Open in ${provider.label} ↗` }),
		);
		const fail = () => {
			cancelWatch();
			if (mySeq !== seq) return;
			wrap.classList.remove('cs-ready');
			wrap.replaceChildren(
				embedFallbackNode({
					name: `The ${provider.label} chart`,
					href: urls.page,
					label: `Open in ${provider.label}`,
					onRetry: render,
					className: 'cs-state',
					buttonClassName: cls.tab,
				}),
			);
		};
		const iframe = node('iframe', {
			class: 'cs-frame',
			src: urls.embed,
			title: `${provider.label} live chart`,
			loading: 'lazy',
			allow: 'clipboard-write; fullscreen',
			referrerpolicy: 'strict-origin-when-cross-origin',
			onload: () => {
				cancelWatch();
				wrap.classList.add('cs-ready');
			},
			onerror: fail,
		});
		cancelWatch = watchEmbed(wrap, { timeoutMs: DEFAULT_EMBED_TIMEOUT_MS, onTimeout: fail });
		wrap.append(iframe);
	}

	// The iframe providers bake the theme in at load, so a live theme switch
	// reloads whichever embed is showing. The candle view is left to chart.js.
	const themeObserver = new MutationObserver(() => {
		if (views.find((v) => v.id === active)?.kind === 'embed') render();
	});
	themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

	render();

	return {
		select: (id) => views.some((v) => v.id === id) && select(id, { persist: true }),
		destroy() {
			destroyed = true;
			themeObserver.disconnect();
			clear();
			host.replaceChildren();
		},
	};
}
