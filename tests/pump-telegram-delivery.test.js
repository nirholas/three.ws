import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Readable } from 'node:stream';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

// ── helpers ────────────────────────────────────────────────────────────────
function makeReq(body) {
	const stream = body
		? Readable.from([Buffer.from(JSON.stringify(body))])
		: Readable.from([]);
	stream.method = 'POST';
	stream.url = '/api/pump/deliver-telegram';
	stream.headers = { host: 'localhost', 'content-type': 'application/json' };
	return stream;
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		end(chunk) {
			if (chunk !== undefined) this.body += chunk;
			this.writableEnded = true;
		},
	};
}

async function callEndpoint(body) {
	const { default: handler } = await import('../api/pump/deliver-telegram.js');
	const res = makeRes();
	await handler(makeReq(body), res);
	return { res, json: res.body ? JSON.parse(res.body) : null };
}

const SIGNAL = {
	kind: 'mint',
	mint: 'TokenMint123abc',
	summary: 'New token launched with 1 SOL',
	ts: 1700000000000,
};

beforeEach(() => {
	fetchMock.mockReset();
	delete process.env.TELEGRAM_BOT_TOKEN;
});

// ── sendTelegramSignal ─────────────────────────────────────────────────────

describe('sendTelegramSignal', () => {
	it('posts to the correct URL with POST method and Markdown parse_mode', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ result: { message_id: 42 } }),
		});
		const { sendTelegramSignal } = await import('../src/pump/telegram-delivery.js');
		const result = await sendTelegramSignal({
			botToken: 'bot123',
			chatId: '-100456',
			signal: SIGNAL,
		});

		expect(fetchMock).toHaveBeenCalledOnce();
		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toBe('https://api.telegram.org/botbot123/sendMessage');
		expect(opts.method).toBe('POST');
		const sent = JSON.parse(opts.body);
		expect(sent.chat_id).toBe('-100456');
		expect(sent.parse_mode).toBe('Markdown');
		expect(typeof sent.text).toBe('string');
		expect(result).toEqual({ ok: true, messageId: 42 });
	});

	it('throws on a non-2xx Telegram response', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: false,
			status: 400,
			text: async () => 'Bad Request',
		});
		const { sendTelegramSignal } = await import('../src/pump/telegram-delivery.js');
		await expect(
			sendTelegramSignal({ botToken: 'bot123', chatId: '1', signal: SIGNAL }),
		).rejects.toThrow(/400/);
	});
});

// ── POST /api/pump/deliver-telegram ────────────────────────────────────────

describe('POST /api/pump/deliver-telegram', () => {
	it('returns 500 when TELEGRAM_BOT_TOKEN is not set', async () => {
		const { res, json } = await callEndpoint({ chatId: '123', signal: SIGNAL });
		expect(res.statusCode).toBe(500);
		expect(json.error_description).toMatch(/TELEGRAM_BOT_TOKEN/);
	});

	it('returns 400 when chatId is missing', async () => {
		process.env.TELEGRAM_BOT_TOKEN = 'test-token';
		const { res } = await callEndpoint({ signal: SIGNAL });
		expect(res.statusCode).toBe(400);
	});

	it('returns 200 with ok and messageId on success', async () => {
		process.env.TELEGRAM_BOT_TOKEN = 'test-token';
		fetchMock.mockResolvedValueOnce({
			ok: true,
			json: async () => ({ result: { message_id: 99 } }),
		});
		const { res, json } = await callEndpoint({ chatId: '-100789', signal: SIGNAL });
		expect(res.statusCode).toBe(200);
		expect(json).toEqual({ ok: true, messageId: 99 });
	});
});
