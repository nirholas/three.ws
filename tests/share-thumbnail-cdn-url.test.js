// The agent share page (/api/agent-share, og:image) and the wallet embed
// (/api/agents/wallet-embed, `avatar`) built their thumbnail URL as
// `<S3_PUBLIC_DOMAIN>/<key>`, the bucket's raw *.r2.dev domain. That domain
// serves only objects that live in R2; a thumbnail written while R2 refused our
// credential lives in the GCS fallback bucket, so every share card and wallet
// embed for an avatar made since 2026-11-14 showed a broken image. Both now use
// the /cdn/<key> proxy, which reads R2 and the fallback alike.

import { describe, it, expect, vi, beforeAll } from 'vitest';

const ID = '5b0c6a43-2f71-4e0e-9d55-1d5b9a3c7e21';
const row = {
	id: ID,
	name: 'Sharp',
	description: 'An agent',
	chain_id: null,
	erc8004_agent_id: null,
	meta: {},
	thumbnail_key: 'u/42/sharp thumb.webp',
	storage_key: 'u/42/sharp.glb',
	visibility: 'public',
};

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => [row]) }));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: new Proxy({}, { get: () => async () => ({ success: true, reset: 0 }) }),
	clientIp: () => '203.0.113.9',
}));
vi.mock('../api/_lib/balances.js', () => ({ getBalances: async () => null, walletUsdTotal: () => 0 }));

beforeAll(() => {
	process.env.S3_PUBLIC_DOMAIN = 'https://pub-test.r2.dev';
	delete process.env.PUBLIC_APP_ORIGIN;
});

function mkRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		headersSent: false,
		writableEnded: false,
		getHeader(k) { return this.headers[k.toLowerCase()]; },
		setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
		writeHead(s, h) { this.statusCode = s; Object.assign(this.headers, h || {}); return this; },
		end(b) { this.body = String(b ?? ''); this.writableEnded = true; },
	};
}

const mkReq = (url) => ({ method: 'GET', url, query: Object.fromEntries(new URL(url, 'http://x').searchParams), headers: {}, socket: { remoteAddress: '127.0.0.1' } });

const THUMB = 'https://three.ws/cdn/u/42/sharp%20thumb.webp';

describe('share and embed thumbnails', () => {
	it('the share page points og:image at the /cdn/ proxy', async () => {
		const { default: handler } = await import('../api/agent-share.js');
		const res = mkRes();
		await handler(mkReq(`/api/agent-share?id=${ID}`), res);
		expect(res.body).toContain(`content="${THUMB}"`);
		expect(res.body).not.toContain('r2.dev');
	});

	it('the wallet embed returns the /cdn/ proxy as the avatar', async () => {
		const { default: handler } = await import('../api/agents/wallet-embed.js');
		const res = mkRes();
		await handler(mkReq(`/api/agents/wallet-embed?id=${ID}`), res);
		expect(JSON.parse(res.body).data.avatar).toBe(THUMB);
	});
});
