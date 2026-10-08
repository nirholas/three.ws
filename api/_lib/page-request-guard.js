// SSRF guard for headless Chromium pages (puppeteer).
//
// A server-side browser is an outbound HTTP client like any other, with two
// extra hazards: it follows redirects and loads sub-resources on its own, and
// the bundled Chromium runs with --disable-web-security, so a page can read
// cross-origin responses. Any page that loads a caller-influenced URL routes
// its requests through guardPageRequests first.

import { assertSafePublicUrl } from './ssrf-guard.js';

/**
 * Route every request the headless page makes through the SSRF guard.
 *
 * Checking only the URL handed to page.goto() left Chromium free to follow a
 * redirect from that public page to an internal address, and to load any
 * iframe, image or script the page (or a caller's snippet) names, with the
 * screenshot, network log and console text handed back to the caller. With
 * interception on, Chromium surfaces every request, redirect hops included,
 * here first; a host that resolves to a private, loopback or metadata address
 * is aborted before a socket opens. The configured platform origin is always
 * allowed (it serves the embed itself, and is localhost in development).
 *
 * @param {import('puppeteer-core').Page} page
 * @param {{ platformOrigin: string, respond?: (req: any) => boolean }} opts
 *   `respond` may answer a request itself and return true to claim it.
 */
export async function guardPageRequests(page, { platformOrigin, respond = () => false }) {
	const verdicts = new Map();
	let platform = null;
	try {
		platform = new URL(platformOrigin).origin;
	} catch {
		platform = null;
	}
	const hostAllowed = (url) => {
		const key = `${url.protocol}//${url.host}`;
		if (!verdicts.has(key)) {
			verdicts.set(
				key,
				assertSafePublicUrl(url.href, { allowHttp: true }).then(
					() => true,
					() => false,
				),
			);
		}
		return verdicts.get(key);
	};
	await page.setRequestInterception(true);
	page.on('request', async (req) => {
		try {
			if (respond(req)) return;
			let url;
			try {
				url = new URL(req.url());
			} catch {
				await req.abort('blockedbyclient');
				return;
			}
			if (url.protocol === 'data:' || url.protocol === 'blob:') {
				await req.continue();
				return;
			}
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				await req.abort('blockedbyclient');
				return;
			}
			if (url.origin === platform || (await hostAllowed(url))) {
				await req.continue();
				return;
			}
			await req.abort('blockedbyclient');
		} catch {
			// The page closed or the request was already handled; nothing to do.
		}
	});
}
