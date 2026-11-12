// WhatsApp (Cloud API): the subscription handshake, X-Hub-Signature-256 on the
// receiver over a real socket into a real Postgres inbox, fixture webhook
// messages mapped to GatewayEvents, and sends mapped to Graph payloads,
// including the 24-hour window refusal (131047) and its template fallback.

import http from 'node:http';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createGatewayDb } from './_db.js';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../../../api/_lib/db.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, sql: (strings, ...values) => holder.db.sql(strings, ...values) };
});

const APP_SECRET = 'fixture-whatsapp-app-secret';
process.env.WHATSAPP_APP_SECRET = APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = 'fixture-verify-token';
process.env.WHATSAPP_PHONE_NUMBER_ID = '200000000000001';

const { whatsappInboxEntries } = await import('../../../api/_lib/gateway/webhooks.js');
const { default: receiver } = await import('../../../api/gateway/whatsapp.js');
const { createWhatsAppAdapter, toWhatsAppError, OUTSIDE_WINDOW } = await import('../src/adapters/whatsapp.js');
const { PlatformError } = await import('../src/errors.js');

const raw = (name) => readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8');
const fixture = (name) => JSON.parse(raw(name));
const PREVIEW = '4d5e6f70-1111-4222-8333-944455566677';
const GRAPH = 'https://graph.facebook.com/v21.0';
const env = { WHATSAPP_ACCESS_TOKEN: 'fixture-access-token', WHATSAPP_PHONE_NUMBER_ID: '200000000000001' };

let server;
const url = (path) => `http://127.0.0.1:${server.address().port}${path}`;
const sign = (body, secret = APP_SECRET) => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
async function deliver(body, signature = sign(body)) {
	const res = await fetch(url('/api/gateway/whatsapp'), { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': signature }, body });
	return { status: res.status, body: await res.json() };
}
const inbox = () => holder.db.query('SELECT platform, dedupe_key, chat_key, payload FROM gateway_inbox ORDER BY id');

/** Graph at the fetch boundary. */
function fakeGraph(answer = () => null) {
	const calls = [];
	let n = 0;
	const fetchImpl = async (u, init = {}) => {
		const body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
		calls.push({ url: String(u), method: init.method || 'GET', headers: init.headers || {}, body });
		const custom = answer(String(u), body, calls.length);
		if (custom) return custom;
		if (String(u).endsWith('/media')) return Response.json({ id: 'media-fixture-1' });
		return Response.json({ messaging_product: 'whatsapp', messages: [{ id: `wamid.OUT${++n}` }] });
	};
	return { fetchImpl, calls };
}
const queued = (name, i = 0) => whatsappInboxEntries(fixture(name))[i].payload;

beforeAll(async () => {
	holder.db = await createGatewayDb();
	server = http.createServer((req, res) => receiver(req, res));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
});
afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => {
	await holder.db.exec('TRUNCATE gateway_inbox RESTART IDENTITY CASCADE');
});

describe('whatsapp receiver', () => {
	it('answers the subscription handshake only with the right verify token', async () => {
		const ok = await fetch(url('/api/gateway/whatsapp?hub.mode=subscribe&hub.verify_token=fixture-verify-token&hub.challenge=1158201444'));
		expect([ok.status, await ok.text()]).toEqual([200, '1158201444']);
		const bad = await fetch(url('/api/gateway/whatsapp?hub.mode=subscribe&hub.verify_token=guess&hub.challenge=1158201444'));
		expect(bad.status).toBe(403);
	});

	it('refuses an unsigned or mis-signed delivery and queues nothing', async () => {
		const body = raw('whatsapp-text');
		expect((await deliver(body, 'sha256=00')).status).toBe(401);
		expect((await deliver(body, sign(body, 'another-app'))).status).toBe(401);
		expect(await inbox()).toEqual([]);
	});

	it('queues each message once by wamid, however often Meta redelivers', async () => {
		const body = raw('whatsapp-text');
		expect(await deliver(body)).toEqual({ status: 200, body: { ok: true, queued: 2 } });
		expect(await deliver(body)).toEqual({ status: 200, body: { ok: true, queued: 0 } });
		const rows = await inbox();
		expect(rows.map((r) => [r.dedupe_key, r.chat_key])).toEqual([
			['wamid.FIXTURETEXT0001', 'whatsapp:15551230000'],
			['wamid.FIXTURETEXT0002', 'whatsapp:15551230000'],
		]);
		expect(rows[0].payload).toMatchObject({ kind: 'whatsapp_message', phone_number_id: '200000000000001', contact: { wa_id: '15551230000' } });
	});

	it('drops status receipts and messages for another business number', async () => {
		expect((await deliver(raw('whatsapp-audio-status'))).body.queued).toBe(1);
		const other = fixture('whatsapp-text');
		other.entry[0].changes[0].value.metadata.phone_number_id = '999';
		expect((await deliver(JSON.stringify(other))).body.queued).toBe(0);
	});
});

describe('whatsapp normalize', () => {
	const adapter = createWhatsAppAdapter({ env, fetch: fakeGraph().fetchImpl });

	it('maps a text message to the common shape on the sender\'s number', () => {
		expect(adapter.normalize(queued('whatsapp-text'))).toEqual({
			platform: 'whatsapp', chatId: '15551230000', chatType: 'dm', chatTitle: null, userId: '15551230000',
			username: 'Fixture Owner', messageId: 'wamid.FIXTURETEXT0001', text: 'what is my balance?',
		});
	});

	it('maps a typed /link CODE to the link command', () => {
		expect(adapter.normalize(queued('whatsapp-text', 1))).toMatchObject({ command: 'link', args: 'ABCD-EFGH' });
	});

	it('maps a Cancel reply button to an action on the preview message', () => {
		expect(adapter.normalize(queued('whatsapp-button'))).toMatchObject({
			action: { verb: 'cancel', previewId: PREVIEW },
			messageRef: { chatId: '15551230000', messageId: 'wamid.FIXTUREPREVIEW01' },
		});
	});

	it('treats a forwarded message as forwarded', () => {
		const p = queued('whatsapp-text');
		p.message.context = { forwarded: true };
		expect(adapter.normalize(p)).toMatchObject({ forwarded: true });
		expect(adapter.normalize(p).text).toBeUndefined();
	});

	it('maps a voice note to a voice event that resolves the media id, then downloads with the token', async () => {
		const f = fakeGraph((u) => {
			if (u === `${GRAPH}/300000000000001`) return Response.json({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=fixture', mime_type: 'audio/ogg; codecs=opus', file_size: 5 });
			if (u.startsWith('https://lookaside.fbsbx.com/')) return new Response(Buffer.from('opus!'));
			return null;
		});
		const a = createWhatsAppAdapter({ env, fetch: f.fetchImpl });
		const clip = await a.normalize(queued('whatsapp-audio-status')).voice.fetch();
		expect(clip.mimeType).toBe('audio/ogg');
		expect(clip.buffer.toString()).toBe('opus!');
		expect(f.calls.map((c) => c.headers.authorization)).toEqual(['Bearer fixture-access-token', 'Bearer fixture-access-token']);
	});
});

describe('whatsapp sends', () => {
	it('sends text through the messages endpoint', async () => {
		const f = fakeGraph();
		const ref = await createWhatsAppAdapter({ env, fetch: f.fetchImpl }).gateway(null).sendText('15551230000', 'Your balance is 1.2 SOL.');
		expect(f.calls[0]).toMatchObject({
			url: `${GRAPH}/200000000000001/messages`,
			method: 'POST',
			headers: { authorization: 'Bearer fixture-access-token' },
			body: { messaging_product: 'whatsapp', to: '15551230000', type: 'text', text: { body: 'Your balance is 1.2 SOL.', preview_url: false } },
		});
		expect(ref).toEqual({ chatId: '15551230000', messageId: 'wamid.OUT1' });
	});

	it('renders a preview as interactive reply buttons within WhatsApp\'s limits', async () => {
		const f = fakeGraph();
		await createWhatsAppAdapter({ env, fetch: f.fetchImpl }).gateway(null).sendChoice('15551230000', 'Swap 0.1 SOL for $THREE?', [
			{ id: `gw:ap:${PREVIEW}`, label: 'Approve this swap right now' },
			{ id: `gw:cx:${PREVIEW}`, label: 'Cancel' },
		]);
		expect(f.calls[0].body).toMatchObject({
			type: 'interactive',
			interactive: {
				type: 'button',
				body: { text: 'Swap 0.1 SOL for $THREE?' },
				action: { buttons: [
					{ type: 'reply', reply: { id: `gw:ap:${PREVIEW}`, title: 'Approve this swap ri' } },
					{ type: 'reply', reply: { id: `gw:cx:${PREVIEW}`, title: 'Cancel' } },
				] },
			},
		});
	});

	it('cannot edit, so an edit arrives as a new message', async () => {
		const f = fakeGraph();
		await createWhatsAppAdapter({ env, fetch: f.fetchImpl }).gateway(null).editMessage({ chatId: '15551230000', messageId: 'wamid.OUT1' }, 'Cancelled.');
		expect(f.calls[0].body).toMatchObject({ type: 'text', text: { body: 'Cancelled.' } });
	});

	it('shows typing by marking the inbound message read', async () => {
		const f = fakeGraph();
		const a = createWhatsAppAdapter({ env, fetch: f.fetchImpl });
		await a.gateway(a.normalize(queued('whatsapp-text'))).typing('15551230000');
		expect(f.calls[0].body).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.FIXTURETEXT0001', typing_indicator: { type: 'text' } });
	});

	it('uploads a spoken reply, then sends it as audio by media id', async () => {
		const f = fakeGraph();
		await createWhatsAppAdapter({ env, fetch: f.fetchImpl }).gateway(null).sendVoice('15551230000', { buffer: Buffer.from('ogg'), mimeType: 'audio/ogg', filename: 'reply.ogg' });
		expect(f.calls[0].url).toBe(`${GRAPH}/200000000000001/media`);
		expect(f.calls[0].body).toBeInstanceOf(FormData);
		expect(f.calls[1].body).toMatchObject({ type: 'audio', audio: { id: 'media-fixture-1' } });
	});

	const outsideWindow = (u, body) => (body?.type === 'text'
		? Response.json({ error: { code: OUTSIDE_WINDOW, message: 'Re-engagement message', error_data: { details: 'Message failed to send because more than 24 hours have passed since the customer last replied to this number.' } } }, { status: 400 })
		: null);

	it('outside the 24-hour window, resends through the configured template', async () => {
		const f = fakeGraph(outsideWindow);
		const ref = await createWhatsAppAdapter({ env: { ...env, WHATSAPP_NOTIFY_TEMPLATE: 'agent_update' }, fetch: f.fetchImpl })
			.gateway(null).sendText('15551230000', 'Price alert\nSOL crossed your level.');
		expect(f.calls[1].body).toMatchObject({
			type: 'template',
			template: { name: 'agent_update', language: { code: 'en' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Price alert SOL crossed your level.' }] }] },
		});
		expect(ref.messageId).toBe('wamid.OUT1');
	});

	it('outside the window with no template, the refusal is permanent so the drain does not retry it', async () => {
		const f = fakeGraph(outsideWindow);
		const err = await createWhatsAppAdapter({ env, fetch: f.fetchImpl }).gateway(null).sendText('15551230000', 'hi').catch((e) => e);
		expect(err).toBeInstanceOf(PlatformError);
		expect(err).toMatchObject({ permanent: true, code: OUTSIDE_WINDOW });
		expect(f.calls).toHaveLength(1);
	});

	it('maps throughput limits to retryable errors and bad requests to permanent ones', () => {
		expect(toWhatsAppError(400, { error: { code: 131056, message: 'pair rate limit' } })).toMatchObject({ permanent: false, retryAfterMs: 5000 });
		expect(toWhatsAppError(429, {})).toMatchObject({ retryAfterMs: 5000 });
		expect(toWhatsAppError(400, { error: { code: 100, message: 'Invalid parameter' } })).toMatchObject({ permanent: true });
	});
});
