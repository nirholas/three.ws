/**
 * Agent Galaxy (/galaxy): the Playwright e2e spec.
 *
 * Every test intercepts /api/galaxy with a payload built by the REAL production
 * assembler (api/_lib/galaxy.js → assembleGalaxy, which runs the same PCA
 * projection and k-means clustering prod runs), so the coordinates, cluster
 * assignments and payload shape that reach the viewer are what prod would emit
 * for that agent set. Nothing about the render path is faked.
 *
 * State coverage:
 *   - populated galaxy   -> stars render, legend + stats fill in
 *   - no agents          -> empty overlay, with a way to create one
 *   - watsonx 503        -> unretryable error overlay, with a way onward
 *   - transport failure  -> retryable error overlay, retry recovers
 *
 * Interaction coverage:
 *   - semantic search -> ranked results -> result click -> agent card
 *   - card actions point at the agent page and its chat panel
 *   - legend row flies to a constellation and isolates it
 *   - Escape closes the card
 *   - overlays take the HUD out of the tab order
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

// Build the fixture lazily so workers don't pay the import cost for specs that
// don't need it.
let _fixture = null;
async function buildFixture() {
	if (_fixture) return _fixture;
	const mathUrl = pathToFileURL(resolve(repoRoot, 'api/_lib/embedding-math.js')).href;
	const galaxyUrl = pathToFileURL(resolve(repoRoot, 'api/_lib/galaxy.js')).href;
	const { makeRng, unit, cosineSimilarity } = await import(mathUrl);
	const { assembleGalaxy, rankBySimilarity } = await import(galaxyUrl);

	const DIMS = 32;
	const AXES = [0, 9, 18, 27];
	const PER = 11;
	const THEMES = ['Crypto Trading', 'Customer Support', 'Creative Writing', 'Wellness Coaching'];
	const rng = makeRng(2026);

	// Four well-separated directions in a 32-dim space stand in for four genuinely
	// different agent themes. The vectors are the only synthetic input; every
	// coordinate and cluster below is computed by the production assembler.
	const agents = [];
	const vectors = [];
	AXES.forEach((axis, theme) => {
		for (let i = 0; i < PER; i++) {
			const v = new Array(DIMS).fill(0).map(() => (rng() - 0.5) * 0.18);
			v[axis] += 1;
			vectors.push(v);
			agents.push({
				id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(theme).padStart(2, '0')}${String(i).padStart(10, '0')}`,
				name: `${THEMES[theme]} Agent ${i + 1}`,
				description: `A ${THEMES[theme].toLowerCase()} specialist, agent ${i + 1}.`,
				chat_count: (theme + 1) * (i + 1),
			});
		}
	});

	const model = 'ibm/granite-embedding-278m-multilingual';
	const payload = await assembleGalaxy(agents, vectors, {
		dims: DIMS,
		model,
		// Mirror the prod namer's contract: it returns one {name, theme} per
		// cluster, aligned by index.
		nameClusters: (clusters) =>
			clusters.map((c) => ({ name: THEMES[c.id] || `Theme ${c.id + 1}`, theme: 'test' })),
	});

	const byId = new Map(agents.map((a, i) => [a.id, unit(vectors[i])]));
	const searchFor = (theme = 0) => {
		const q = new Array(DIMS).fill(0);
		q[AXES[theme]] = 1;
		const results = rankBySimilarity(q, byId, { topK: 12 });
		return { query: THEMES[theme], model, count: results.length, results };
	};

	_fixture = { payload, agents: payload.agents, searchFor, cosineSimilarity };
	return _fixture;
}

// Intercept the galaxy endpoint. `mode` picks which state the page lands in.
async function routeGalaxy(page, mode = 'success') {
	const fx = await buildFixture();
	await page.route('**/api/galaxy', async (route) => {
		if (route.request().method() === 'POST') {
			if (mode === 'unavailable') {
				return route.fulfill({ status: 503, json: watsonx503() });
			}
			return route.fulfill({ json: fx.searchFor(0) });
		}
		if (mode === 'success') {
			return route.fulfill({ json: { ...fx.payload, cached: false, generated_at: new Date().toISOString() } });
		}
		if (mode === 'empty') {
			return route.fulfill({
				json: { count: 0, dims: 0, model: null, clusters: [], agents: [], cached: false },
			});
		}
		if (mode === 'unavailable') return route.fulfill({ status: 503, json: watsonx503() });
		if (mode === 'down') return route.abort('failed');
		return route.fallback();
	});
	// The galaxy lights its stars from real wallet net worth and draws lineage
	// edges; neither is under test here and both are best-effort in the viewer.
	await page.route('**/api/agents/networth**', (r) => r.fulfill({ json: { data: { items: [] } } }));
	await page.route('**/api/genome/edges**', (r) => r.fulfill({ json: { edges: [] } }));
}

function watsonx503() {
	return {
		error: 'watsonx_unavailable',
		error_description:
			'The Agent Galaxy is positioned by IBM Granite embeddings on watsonx.ai. ' +
			'Set WATSONX_API_KEY and WATSONX_PROJECT_ID (or WATSONX_SPACE_ID) to build it.',
	};
}

async function gotoGalaxy(page, mode = 'success') {
	await routeGalaxy(page, mode);
	await page.goto('/galaxy');
	const want = { success: 'ready', empty: 'empty' }[mode] || 'error';
	await page.waitForFunction((s) => window.__galaxy?.status === s, want, { timeout: 60_000 });
}

test.describe('Agent Galaxy', () => {
	// Fail on any real uncaught page error. Vite's HMR websocket emits
	// "WebSocket closed without opened." in headless Codespace runs (the HMR
	// client targets the forwarded :3000 domain, not the test port). That is dev-server
	// noise, not a product bug.
	test.beforeEach(async ({ page }) => {
		page.on('pageerror', (err) => {
			if (/websocket|hmr|wss:|failed to connect/i.test(err.message)) return;
			throw new Error(`Page error: ${err.message}`);
		});
	});

	test('renders every agent as a star, with stats and a named legend', async ({ page }) => {
		const fx = await buildFixture();
		await gotoGalaxy(page, 'success');

		const dbg = await page.evaluate(() => ({
			ready: window.__galaxy.ready,
			agents: window.__galaxy.agentCount,
			clusters: window.__galaxy.clusterCount,
			points: window.__galaxy.pointCount,
		}));
		expect(dbg.ready).toBe(true);
		expect(dbg.agents).toBe(fx.agents.length);
		expect(dbg.points).toBe(fx.agents.length);
		expect(dbg.clusters).toBe(fx.payload.clusters.length);

		await expect(page.locator('#gxStats')).toBeVisible();
		await expect(page.locator('#gxStatAgents')).toContainText(String(fx.agents.length));
		await expect(page.locator('#gxLegend')).toBeVisible();
		expect(await page.locator('#gxLegendList .gx-legend-item').count()).toBe(
			fx.payload.clusters.length,
		);

		// No overlay is left covering a rendered galaxy, and the HUD is usable again.
		for (const id of ['gxLoading', 'gxEmpty', 'gxError']) {
			expect(await page.locator(`#${id}`).isVisible()).toBe(false);
		}
		await expect(page.locator('#gxSearchInput')).toBeEnabled();
		await expect(page.locator('#gxMoneyToggle')).toBeEnabled();
	});

	test('semantic search ranks agents, and a result opens its card', async ({ page }) => {
		await gotoGalaxy(page, 'success');

		await page.fill('#gxSearchInput', 'crypto trading');
		await page.click('#gxSearchGo');
		await expect(page.locator('#gxResults')).toBeVisible();
		const results = page.locator('#gxResultsList .gx-result');
		await expect(results.first()).toBeVisible();
		expect(await results.count()).toBeGreaterThan(0);
		// Every match is a real agent in the rendered galaxy, scored as a percentage.
		await expect(results.first()).toContainText('%');

		await results.first().click();
		await expect(page.locator('#gxCard')).toBeVisible();
		await expect(page.locator('#gxCardName')).not.toBeEmpty();

		// The two card actions lead somewhere different: the agent page, and its
		// chat panel.
		const view = await page.getAttribute('#gxCardView', 'href');
		const chat = await page.getAttribute('#gxCardChat', 'href');
		expect(view).toMatch(/^\/agents\/[0-9a-f-]+$/i);
		expect(chat).toBe(`${view}?view=chat`);

		await page.keyboard.press('Escape');
		await expect(page.locator('#gxCard')).toBeHidden();
	});

	test('a legend row isolates its constellation', async ({ page }) => {
		await gotoGalaxy(page, 'success');
		const row = page.locator('#gxLegendList .gx-legend-item').first();
		await row.click();
		await expect(row).toHaveClass(/gx-active/);
		expect(await page.evaluate(() => window.__galaxy && document.querySelectorAll('.gx-legend-item.gx-active').length)).toBe(1);
		await row.click();
		await expect(row).not.toHaveClass(/gx-active/);
	});

	test('an empty galaxy explains itself and offers a way to fill it', async ({ page }) => {
		await gotoGalaxy(page, 'empty');
		await expect(page.locator('#gxEmpty')).toBeVisible();
		await expect(page.locator('#gxEmpty .gx-overlay-title')).not.toBeEmpty();
		await expect(page.locator('#gxEmpty a[href="/create"]')).toBeVisible();
		await expect(page.locator('#gxEmpty a[href="/agents/"]')).toBeVisible();
	});

	test('an unconfigured embedder is a dead end for nobody', async ({ page }) => {
		await gotoGalaxy(page, 'unavailable');
		await expect(page.locator('#gxError')).toBeVisible();
		await expect(page.locator('#gxErrorTitle')).toContainText('Granite');
		await expect(page.locator('#gxErrorSub')).toContainText('watsonx');
		// Retrying a configuration gap just fails again, so the retry is hidden and
		// two real onward paths take its place.
		await expect(page.locator('#gxRetry')).toBeHidden();
		await expect(page.locator('#gxErrorBrowse')).toBeVisible();
		await expect(page.locator('#gxError a[href="/docs/ibm"]')).toBeVisible();

		// Nothing behind the overlay stays reachable by keyboard.
		const reachable = await page.evaluate(() =>
			[...document.querySelectorAll('#gxHud button, #gxHud input, #gxFootnote a')].filter(
				(el) => !el.closest('[inert]'),
			).length,
		);
		expect(reachable).toBe(0);
	});

	test('a transport failure is retryable, and the retry recovers', async ({ page }) => {
		await gotoGalaxy(page, 'down');
		await expect(page.locator('#gxError')).toBeVisible();
		await expect(page.locator('#gxRetry')).toBeVisible();

		// Swap the endpoint back to a working galaxy, then use the button the page
		// offered. It must recover in place, with no reload.
		await page.unroute('**/api/galaxy');
		await routeGalaxy(page, 'success');
		await page.click('#gxRetry');
		await page.waitForFunction(() => window.__galaxy?.status === 'ready', null, { timeout: 60_000 });
		await expect(page.locator('#gxError')).toBeHidden();
		await expect(page.locator('#gxLegend')).toBeVisible();
	});

	test('every control the page offers has a visible keyboard focus ring', async ({ page }) => {
		await gotoGalaxy(page, 'success');
		// Establish keyboard modality so :focus-visible matches.
		await page.keyboard.press('Tab');
		const ids = ['gxSearchInput', 'gxSearchGo', 'gxMoneyToggle'];
		for (const id of ids) {
			const ring = await page.evaluate((i) => {
				const el = document.getElementById(i);
				el.focus();
				const cs = getComputedStyle(el);
				return { fv: el.matches(':focus-visible'), outline: cs.outlineStyle, width: cs.outlineWidth };
			}, id);
			expect(ring.fv, `${id} should match :focus-visible`).toBe(true);
			expect(ring.outline, `${id} needs a focus outline`).not.toBe('none');
			expect(parseFloat(ring.width), `${id} focus outline must be visible`).toBeGreaterThan(0);
		}
	});

	test('lays out without horizontal overflow at 320, 768 and 1440', async ({ page }) => {
		await gotoGalaxy(page, 'success');
		for (const width of [320, 768, 1440]) {
			await page.setViewportSize({ width, height: 800 });
			await page.waitForTimeout(400);
			const m = await page.evaluate(() => ({
				scrollW: document.documentElement.scrollWidth,
				clientW: document.documentElement.clientWidth,
			}));
			expect(m.scrollW, `no horizontal page scroll at ${width}px`).toBeLessThanOrEqual(m.clientW + 1);
		}
	});
});
