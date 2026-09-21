// @vitest-environment jsdom
//
// The chart-source switcher, as the surfaces that bring their own chart use it.
//
// /oracle/coin/<mint> and /pump-dashboard each already drew a chart when the
// switcher arrived, so they hand it their own views through `nativeViews` and
// their own segmented-control class names through `classes`. What is pinned:
//
//   1. Every provider in the shared list, DEXTools included, lines up behind the
//      host's views. A surface that adopts the switcher cannot quietly offer a
//      shorter list than the rest of three.ws.
//   2. The platform candle engine is never imported for a host that brought its
//      own native views. It is the heaviest thing in the module graph.
//   3. A host's native view is torn down when the viewer switches away, and a
//      pool-keyed provider (DEXTools) resolves its pair before it mounts a frame.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mountPriceChart = vi.fn(() => ({ destroy: vi.fn() }));
vi.mock('../src/mission-control/chart.js', () => ({ mountPriceChart }));

const { mountSwitchableChart } = await import('../src/shared/chart-switcher.js');

// $THREE and the three / SOL pool DEXTools tracks it under.
const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const PAIR = 'CnK82s8exdsK9nwqQ55kd9wcxoA22NwTchZJCBdu8LDa';

const tabs = (host) => [...host.querySelectorAll('[role=tab]')];
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('mountSwitchableChart with host-native views', () => {
	let host;
	beforeEach(() => {
		document.body.innerHTML = '<div id="h"></div>';
		host = document.getElementById('h');
		localStorage.clear();
		mountPriceChart.mockClear();
		globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ pool: PAIR }), { status: 200 }));
	});

	it('offers every shared provider, DEXTools included, behind the host views', async () => {
		mountSwitchableChart({
			host,
			mint: MINT,
			nativeViews: [{ id: 'line', label: 'Line', mount: () => {} }],
		});
		await tick();
		expect(tabs(host).map((t) => t.dataset.view)).toEqual([
			'line',
			'dexscreener',
			'birdeye',
			'gmgn',
			'dextools',
			'geckoterminal',
		]);
	});

	it('never loads the platform candle engine for a host that brought its own view', async () => {
		mountSwitchableChart({ host, mint: MINT, nativeViews: [{ id: 'line', label: 'Line', mount: () => {} }] });
		await tick();
		expect(mountPriceChart).not.toHaveBeenCalled();
	});

	it('still opens on the platform candle chart when no native views are given', async () => {
		mountSwitchableChart({ host, mint: MINT });
		await tick();
		expect(tabs(host)[0].dataset.view).toBe('tradingview');
		expect(mountPriceChart).toHaveBeenCalledTimes(1);
	});

	it('uses the host segmented-control classes and marks the active tab', async () => {
		mountSwitchableChart({
			host,
			mint: MINT,
			nativeViews: [{ id: 'line', label: 'Line', mount: () => {} }],
			classes: { tabs: 'oc-seg', tab: 'oc-seg-btn', active: 'on' },
		});
		await tick();
		expect(host.querySelector('[role=tablist]').classList.contains('oc-seg')).toBe(true);
		const [first, second] = tabs(host);
		expect(first.className).toBe('oc-seg-btn on');
		expect(second.classList.contains('on')).toBe(false);
	});

	it('opens on defaultView, and lets a stored preference win over it', async () => {
		const views = [
			{ id: 'line', label: 'Line', mount: () => {} },
			{ id: 'trades', label: 'Agent trades', mount: () => {} },
		];
		mountSwitchableChart({ host, mint: MINT, nativeViews: views, defaultView: 'trades' });
		await tick();
		expect(host.querySelector('[aria-selected=true]').dataset.view).toBe('trades');

		localStorage.setItem('ld_chart_view', 'line');
		mountSwitchableChart({ host, mint: MINT, nativeViews: views, defaultView: 'trades' });
		await tick();
		expect(host.querySelector('[aria-selected=true]').dataset.view).toBe('line');
	});

	it('tears the host view down on switching to DEXTools, and frames the resolved pair', async () => {
		const destroy = vi.fn();
		mountSwitchableChart({
			host,
			mint: MINT,
			nativeViews: [{ id: 'threews', label: 'three.ws', mount: () => ({ destroy }) }],
		});
		await tick();
		host.querySelector('[data-view=dextools]').click();
		await tick();
		await tick();

		expect(destroy).toHaveBeenCalledTimes(1);
		expect(globalThis.fetch.mock.calls[0][0]).toContain(`/api/coin/pool?address=${MINT}`);
		const frame = host.querySelector('iframe.cs-frame');
		expect(frame.src).toContain(`dextools.io/widget-chart/en/solana/pe-light/${PAIR}`);
		expect(host.querySelector('.cs-open').href).toContain(`/app/solana/pair-explorer/${PAIR}`);
		expect(localStorage.getItem('ld_chart_view')).toBe('dextools');
	});
});

// A stable-named build entry re-exports nothing (the build emits a facade that
// imports its hashed chunk for side effects), so the buildless Oracle coin page
// cannot import a named export from /chart-switcher.js. It reads this global.
describe('the /chart-switcher.js entry for buildless pages', () => {
	it('publishes the switcher on window', async () => {
		await import('../src/shared/chart-switcher-global.js');
		expect(window.threeChartSwitcher.mountSwitchableChart).toBe(mountSwitchableChart);
	});
});
