// Resource-load failures reported by crawlers and headless renderers.
//
// On 2026-11-25, 2,900 of the last 3,000 "[client-error] failed to load ..."
// lines came from bots: Baiduspider-render, Bing's HeadlessChrome on Microsoft
// ranges, and a renderer that blocks every image while it walks each ?lang=
// variant of /avatars/<id> and /m/<id>. Every reported asset (/three.svg,
// /walk-companion.js, the meshopt decoder chunk, the NVIDIA badge, /cdn/forge
// thumbnails) served 200 at the time. A crawler that refuses to download an
// image is not a missing asset, and the volume buried the one class of report
// this stream exists for: a real 404 on our own files.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/_lib/sentry.js', () => ({ captureException: vi.fn() }));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn() }));

const { isCrawlerResourceNoise } = await import('../api/client-errors.js');

const resource = { type: 'resource', message: 'failed to load img', source: 'https://three.ws/three.svg', tag: 'img' };
const CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

describe('isCrawlerResourceNoise', () => {
	it('drops resource failures from self-identified crawlers and headless renderers', () => {
		for (const ua of [
			'Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)',
			'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/146.0.7680.165 Safari/537.36',
			'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) Chrome/146.0.0.0 Safari/537.36',
			'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
			'Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)',
		]) {
			expect(isCrawlerResourceNoise(resource, ua), ua).toBe(true);
		}
	});

	it('keeps resource failures from real browsers, including phones whose model ends in "bot"', () => {
		expect(isCrawlerResourceNoise(resource, CHROME)).toBe(false);
		expect(isCrawlerResourceNoise(resource, 'Mozilla/5.0 (Linux; Android 13; CUBOT KINGKONG 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Mobile Safari/537.36')).toBe(false);
		expect(isCrawlerResourceNoise(resource, undefined)).toBe(false);
	});

	it('keeps JS errors from crawlers: a renderer that executes our code can still hit a real bug', () => {
		const ua = 'Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)';
		expect(isCrawlerResourceNoise({ type: 'error', message: 'x is not a function' }, ua)).toBe(false);
	});

	it('keeps a crawler-reported failure the client confirmed is a real 404', () => {
		const ua = 'Mozilla/5.0 (compatible; Baiduspider-render/2.0; +http://www.baidu.com/search/spider.html)';
		expect(isCrawlerResourceNoise({ ...resource, status: 404 }, ua)).toBe(false);
	});
});
