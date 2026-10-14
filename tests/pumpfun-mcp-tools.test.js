import { describe, it, expect, vi, beforeEach } from 'vitest';

// pumpfun_* MCP tools (api/_mcp/tools/pumpfun.js), registered in
// api/_mcp/catalog.js. These are the pump.fun intel tools external MCP clients
// (Claude Desktop, Cursor) call against the platform server.
//
// Verifies: every tool is registered in the catalog with a read-only, live-feed
// annotation set; the handlers clamp the caller's limit and forward it to the
// upstream client; a successful array response is wrapped as { items }; an
// upstream failure and a missing mint/wallet both surface as clean tool errors
// rather than a bubbled fault; and an unconfigured feed says so instead of
// pretending the market is empty. Only the upstream client wrapper is mocked
// (its bot credentials are server-side); the tool defs themselves run real.

const recentClaimsMock = vi.fn();
const tokenIntelMock = vi.fn();
const creatorIntelMock = vi.fn();
const graduationsMock = vi.fn();
let botEnabled = true;

vi.mock('../api/_lib/pumpfun-mcp.js', () => ({
	pumpfunMcp: {
		recentClaims: (...a) => recentClaimsMock(...a),
		tokenIntel: (...a) => tokenIntelMock(...a),
		creatorIntel: (...a) => creatorIntelMock(...a),
		graduations: (...a) => graduationsMock(...a),
	},
	pumpfunBotEnabled: () => botEnabled,
}));

// pumpfun_prepare_launch fetches the coin image through the shared SSRF-hardened
// fetcher (api/_lib/fetch-model.js). Mocked here so these tests never touch the
// network; each test controls what it resolves/rejects with.
const fetchModelMock = vi.fn();
class FakeFetchModelError extends Error {
	constructor(message, code = 'fetch_failed') {
		super(message);
		this.code = code;
	}
}
vi.mock('../api/_lib/fetch-model.js', () => ({
	fetchModel: (...a) => fetchModelMock(...a),
	FetchModelError: FakeFetchModelError,
}));

const { toolDefs } = await import('../api/_mcp/tools/pumpfun.js');

const byName = (name) => toolDefs.find((t) => t.name === name);
const AUTH = { userId: null, rateKey: 'pumpfun-test', scope: '', source: 'free' };
const call = (name, args) => byName(name).handler(args, AUTH, {});

beforeEach(() => {
	recentClaimsMock.mockReset();
	tokenIntelMock.mockReset();
	creatorIntelMock.mockReset();
	graduationsMock.mockReset();
	fetchModelMock.mockReset();
	botEnabled = true;
});

describe('pumpfun MCP tools: registration', () => {
	it('exposes the five tools with the shared annotation set', () => {
		expect(toolDefs.map((t) => t.name)).toEqual([
			'pumpfun_recent_claims',
			'pumpfun_token_intel',
			'pumpfun_creator_intel',
			'pumpfun_recent_graduations',
			'pumpfun_prepare_launch',
		]);
		for (const t of toolDefs) {
			// destructiveHint defaults to true when omitted, so every read tool
			// must set it explicitly or clients treat intel reads as dangerous.
			expect(t.annotations).toEqual({
				readOnlyHint: true,
				destructiveHint: false,
				idempotentHint: false,
				openWorldHint: true,
			});
			expect(t.inputSchema.additionalProperties).toBe(false);
		}
	});
});

describe('pumpfun MCP tools: success path', () => {
	it('wraps an array upstream response as { items } in structuredContent', async () => {
		recentClaimsMock.mockResolvedValue({ ok: true, data: [{ tx_signature: 'sig-1' }] });
		const r = await call('pumpfun_recent_claims', { limit: 3 });
		expect(r.isError).toBeUndefined();
		expect(recentClaimsMock).toHaveBeenCalledWith({ limit: 3 });
		expect(r.structuredContent).toEqual({ items: [{ tx_signature: 'sig-1' }] });
		expect(JSON.parse(r.content[0].text)).toEqual({ items: [{ tx_signature: 'sig-1' }] });
	});

	it('passes an object upstream response through unwrapped', async () => {
		tokenIntelMock.mockResolvedValue({ ok: true, data: { mint: 'M1', graduated: false } });
		const r = await call('pumpfun_token_intel', { mint: 'M1' });
		expect(tokenIntelMock).toHaveBeenCalledWith({ mint: 'M1' });
		expect(r.structuredContent).toEqual({ mint: 'M1', graduated: false });
	});

	it('clamps limit into the advertised 1..50 range and defaults a junk value', async () => {
		graduationsMock.mockResolvedValue({ ok: true, data: [] });
		await call('pumpfun_recent_graduations', { limit: 5000 });
		expect(graduationsMock).toHaveBeenCalledWith({ limit: 50 });

		graduationsMock.mockClear();
		await call('pumpfun_recent_graduations', { limit: 'not-a-number' });
		expect(graduationsMock).toHaveBeenCalledWith({ limit: 10 });

		graduationsMock.mockClear();
		await call('pumpfun_recent_graduations', {});
		expect(graduationsMock).toHaveBeenCalledWith({ limit: 10 });
	});
});

describe('pumpfun MCP tools: failure paths', () => {
	it('surfaces an upstream failure as a tool error, not a thrown fault', async () => {
		creatorIntelMock.mockResolvedValue({ ok: false, error: 'upstream 503' });
		const r = await call('pumpfun_creator_intel', { wallet: 'W1' });
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toContain('upstream 503');
		expect(r.structuredContent).toBeUndefined();
	});

	it('rejects a missing mint / wallet with a 400-tagged error', async () => {
		await expect(call('pumpfun_token_intel', {})).rejects.toMatchObject({
			status: 400,
			message: 'mint required',
		});
		await expect(call('pumpfun_creator_intel', {})).rejects.toMatchObject({
			status: 400,
			message: 'wallet required',
		});
		expect(tokenIntelMock).not.toHaveBeenCalled();
		expect(creatorIntelMock).not.toHaveBeenCalled();
	});

	it('says the feed is unconfigured instead of reporting an empty market', async () => {
		botEnabled = false;
		recentClaimsMock.mockResolvedValue({ ok: true, data: [] });
		const r = await call('pumpfun_recent_claims', {});
		expect(r.isError).toBe(true);
		expect(r.content[0].text).toMatch(/not configured/i);
	});
});

describe('pumpfun_prepare_launch', () => {
	const VALID_ARGS = {
		name: 'Agent Nova',
		symbol: 'nova!!',
		description: 'A trading agent with a coin.',
		image_url: 'https://cdn.example.com/nova.png',
		initial_buy_sol: 0.5,
		agent_id: 'agent-123',
	};

	it('returns a /launch URL with every field pre-filled, plus a human-signs summary', async () => {
		fetchModelMock.mockResolvedValue({
			bytes: new Uint8Array(1024),
			url: VALID_ARGS.image_url,
			contentType: 'image/png',
			filename: 'nova.png',
		});
		const r = await call('pumpfun_prepare_launch', VALID_ARGS);
		expect(r.isError).toBeUndefined();
		const data = r.structuredContent;
		expect(data.requires_human_signature).toBe(true);
		expect(data.image_checked).toBe(true);
		expect(data.name).toBe('Agent Nova');
		// Punctuation is stripped and the ticker is uppercased, same rule the
		// launch page's own normalizeSymbol applies.
		expect(data.symbol).toBe('NOVA');

		const url = new URL(data.launch_url);
		expect(url.pathname).toBe('/launch');
		expect(url.searchParams.get('name')).toBe('Agent Nova');
		expect(url.searchParams.get('symbol')).toBe('NOVA');
		expect(url.searchParams.get('description')).toBe(VALID_ARGS.description);
		expect(url.searchParams.get('image')).toBe(VALID_ARGS.image_url);
		expect(url.searchParams.get('initialBuy')).toBe('0.5');
		expect(url.searchParams.get('avatar')).toBe('agent-123');
		expect(url.searchParams.get('prepared')).toBeTruthy();

		expect(r.content[0].text).toContain(data.launch_url);
		expect(r.content[0].text).toMatch(/nothing is launched/i);
	});

	it('rejects a ticker that normalizes to fewer than two characters', async () => {
		await expect(call('pumpfun_prepare_launch', { ...VALID_ARGS, symbol: '#' })).rejects.toMatchObject({
			code: -32602,
		});
		expect(fetchModelMock).not.toHaveBeenCalled();
	});

	it('rejects a name over the launch page limit', async () => {
		await expect(
			call('pumpfun_prepare_launch', { ...VALID_ARGS, name: 'x'.repeat(100) }),
		).rejects.toMatchObject({ code: -32602 });
	});

	it('rejects an image URL that resolves to a private address (SSRF guard)', async () => {
		fetchModelMock.mockRejectedValue(new FakeFetchModelError('host resolves to private address: 10.0.0.5', 'private_address'));
		await expect(call('pumpfun_prepare_launch', VALID_ARGS)).rejects.toMatchObject({
			code: -32602,
			message: expect.stringContaining('image_url rejected'),
		});
	});

	it('rejects an oversized image', async () => {
		fetchModelMock.mockRejectedValue(new FakeFetchModelError('file exceeded 4194304 bytes during download', 'file_too_large'));
		await expect(call('pumpfun_prepare_launch', VALID_ARGS)).rejects.toMatchObject({
			code: -32602,
			message: expect.stringContaining('image_url rejected'),
		});
	});

	it('degrades to image_checked: false when the image host just blocks server fetches', async () => {
		fetchModelMock.mockRejectedValue(new FakeFetchModelError('upstream returned 403', 'upstream_error'));
		const r = await call('pumpfun_prepare_launch', VALID_ARGS);
		expect(r.isError).toBeUndefined();
		expect(r.structuredContent.image_checked).toBe(false);
		expect(r.structuredContent.launch_url).toContain('/launch');
		expect(r.content[0].text).toMatch(/not pre-checked/i);
	});

	it('rejects a URL that answers but is not an image', async () => {
		fetchModelMock.mockResolvedValue({
			bytes: new Uint8Array(10),
			url: VALID_ARGS.image_url,
			contentType: 'text/html',
			filename: 'index.html',
		});
		await expect(call('pumpfun_prepare_launch', VALID_ARGS)).rejects.toMatchObject({
			code: -32602,
			message: expect.stringContaining('did not return an image'),
		});
	});

	it('omits initialBuy and avatar when not provided', async () => {
		fetchModelMock.mockResolvedValue({ bytes: new Uint8Array(1), url: '', contentType: 'image/png', filename: 'x' });
		const r = await call('pumpfun_prepare_launch', {
			name: 'Agent Nova',
			symbol: 'NOVA',
			description: '',
			image_url: 'https://cdn.example.com/nova.png',
		});
		const url = new URL(r.structuredContent.launch_url);
		expect(url.searchParams.has('initialBuy')).toBe(false);
		expect(url.searchParams.has('avatar')).toBe(false);
	});
});
