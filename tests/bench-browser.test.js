// scripts/lib/bench-browser.mjs: the Chromium launch shared by the renderer
// benches. Regressions reproduced on a Google Cloud L4 VM (2026-11-04):
//  - headless `--adapter hardware` without --use-vulkan=native and
//    --disable-vulkan-surface left WebGPU on the SwiftShader adapter, and every
//    WebGPU case then failed in createBuffer;
//  - the adapter probe navigated to `${base}/`, which a static server without a
//    root page answers with an HTTP error, so the bench died before any case ran;
//  - the first requestAdapter() in a freshly launched browser can return null.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const launch = vi.fn(async (opts) => ({ opts }));
vi.mock('playwright', () => ({ chromium: { launch: (opts) => launch(opts) } }));

const { launchBenchBrowser, probeAdapters } = await import('../scripts/lib/bench-browser.mjs');

beforeEach(() => launch.mockClear());

describe('launchBenchBrowser', () => {
	it('keeps the software adapter by default', async () => {
		await launchBenchBrowser();
		const { args, headless } = launch.mock.calls[0][0];
		expect(args).toContain('--use-webgpu-adapter=swiftshader');
		expect(args).toContain('--use-angle=swiftshader');
		expect(headless).toBe(true);
	});

	it('gives headless hardware runs a Vulkan instance without a window surface', async () => {
		await launchBenchBrowser({ adapter: 'hardware' });
		const opts = launch.mock.calls[0][0];
		expect(opts.args).toEqual(expect.arrayContaining(['--use-angle=vulkan', '--use-vulkan=native', '--disable-vulkan-surface']));
		expect(opts.args.some((a) => a.includes('swiftshader'))).toBe(false);
		expect(opts.channel).toBe('chromium');
	});

	it('rejects an unknown adapter', async () => {
		await expect(launchBenchBrowser({ adapter: 'metal' })).rejects.toThrow(/swiftshader.*hardware/);
		expect(launch).not.toHaveBeenCalled();
	});
});

function fakeBrowser({ adapters }) {
	const visited = [];
	const routed = [];
	const page = {
		route: vi.fn(async (url, handler) => routed.push({ url, handler })),
		goto: vi.fn(async (url) => {
			visited.push(url);
			const r = routed.find((x) => x.url === url);
			if (!r) throw new Error(`page.goto: net::ERR_HTTP_RESPONSE_CODE_FAILURE at ${url}`);
			let fulfilled = null;
			await r.handler({ fulfill: async (res) => (fulfilled = res) });
			if (!fulfilled) throw new Error('route not fulfilled');
		}),
		evaluate: vi.fn(async (fn) => {
			let call = 0;
			const g = globalThis;
			const saved = { navigator: g.navigator, document: g.document };
			Object.defineProperty(g, 'navigator', {
				configurable: true,
				value: { gpu: { requestAdapter: async () => adapters[call++] ?? null } },
			});
			g.document = { createElement: () => ({ getContext: () => null }) };
			try {
				return await fn();
			} finally {
				Object.defineProperty(g, 'navigator', { configurable: true, value: saved.navigator });
				g.document = saved.document;
			}
		}),
		close: vi.fn(async () => {}),
	};
	return { browser: { newPage: async () => page }, page, visited };
}

describe('probeAdapters', () => {
	it('probes on a page it serves itself, not the server root', async () => {
		const nvidia = { info: { vendor: 'nvidia', architecture: 'lovelace' } };
		const { browser, visited, page } = fakeBrowser({ adapters: [nvidia] });
		const info = await probeAdapters(browser, 'http://localhost:3000');
		expect(visited).toHaveLength(1);
		expect(visited[0]).not.toBe('http://localhost:3000');
		expect(visited[0].startsWith('http://localhost:3000/')).toBe(true);
		expect(info.webgpu).toBe('nvidia lovelace');
		expect(page.close).toHaveBeenCalled();
	});

	it('retries an adapter request that comes back null while the GPU process starts', async () => {
		const nvidia = { info: { vendor: 'nvidia', architecture: 'lovelace' } };
		const { browser } = fakeBrowser({ adapters: [null, nvidia] });
		const info = await probeAdapters(browser, 'http://localhost:3000');
		expect(info.webgpu).toBe('nvidia lovelace');
	});
});
