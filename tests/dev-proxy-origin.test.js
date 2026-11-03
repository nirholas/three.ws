// `npm run dev` proxies /api to the production API. Same-site guarded POSTs
// (OAuth consent, seasonal claims, launch intents, Privy verify) compare the
// request's Origin with the API's own origin, and the proxy forwarded the
// browser's http://localhost:<port> unchanged, so every one of them answered
// 403 "cross-site request blocked" in dev. The OAuth cloud-connector e2e spec
// hit it on the consent Allow button. The proxy now presents a request that
// came from the dev server's own page as same-site to the upstream, and leaves
// any other origin untouched so the upstream still refuses real cross-site
// requests.
import { describe, it, expect } from 'vitest';
import { upstreamSameSiteHeaders } from '../server/dev-proxy-origin.mjs';

const UPSTREAM = 'https://three.ws';

describe('upstreamSameSiteHeaders', () => {
	it('rewrites an Origin from the dev server itself to the upstream origin', () => {
		const out = upstreamSameSiteHeaders({ host: 'localhost:3000', origin: 'http://localhost:3000' }, UPSTREAM);
		expect(out).toEqual({ origin: 'https://three.ws' });
	});

	it('rewrites a same-origin Referer, keeping its path and query', () => {
		const out = upstreamSameSiteHeaders(
			{ host: '127.0.0.1:3317', referer: 'http://127.0.0.1:3317/api/oauth/authorize?client_id=c1' },
			UPSTREAM,
		);
		expect(out).toEqual({ referer: 'https://three.ws/api/oauth/authorize?client_id=c1' });
	});

	it('leaves a foreign Origin and Referer alone so the upstream still blocks them', () => {
		const out = upstreamSameSiteHeaders(
			{ host: 'localhost:3000', origin: 'https://evil.example', referer: 'https://evil.example/x' },
			UPSTREAM,
		);
		expect(out).toEqual({});
	});

	it('does not treat a different port on the same host as same-site', () => {
		expect(upstreamSameSiteHeaders({ host: 'localhost:3000', origin: 'http://localhost:4000' }, UPSTREAM)).toEqual({});
	});

	it('ignores a malformed Referer and a missing Host', () => {
		expect(upstreamSameSiteHeaders({ host: 'localhost:3000', referer: 'not a url' }, UPSTREAM)).toEqual({});
		expect(upstreamSameSiteHeaders({ origin: 'http://localhost:3000' }, UPSTREAM)).toEqual({});
	});
});
