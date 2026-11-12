// Voice: the phone leg end to end (Twilio-signed webhooks over a real socket,
// the turn queued in a real Postgres inbox, one drain cycle of the worker's
// voice adapter running the real gateway core, the call's poll leg playing the
// stored reply), the rule that a call can never approve a trade, the TwiML the
// legs speak, and the spoken form of a reply.
//
// Twilio's recording download is answered at the fetch boundary, and the turn's
// speech boundaries (transcription, synthesis, MP3 transcode) are injected, so
// nothing leaves the machine.

import http from 'node:http';
import { createHmac } from 'node:crypto';
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createGatewayDb, seedPairedChat } from './_db.js';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../../../api/_lib/db.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, sql: (strings, ...values) => holder.db.sql(strings, ...values) };
});

const AUTH_TOKEN = 'fixture-twilio-auth-token';
Object.assign(process.env, {
	GATEWAY_VOICE_TELEPHONY: '1',
	TWILIO_ACCOUNT_SID: 'ACfixture0000000000000000000000000',
	TWILIO_AUTH_TOKEN: AUTH_TOKEN,
});

const { default: receiver, callRefusal } = await import('../../../api/gateway/voice.js');
const voiceCalls = await import('../../../api/_lib/gateway/voice-calls.js');
const { createVoiceAdapter, TURN_APOLOGY } = await import('../src/adapters/voice.js');
const { createPreview } = await import('../../../api/_lib/gateway/store.js');
const { createDrainer } = await import('../src/drain.js');
const { loadConfig } = await import('../src/config.js');

const { collectingGateway, speakable, twimlGreeting, twimlWait, twimlReply, PHONE_PREVIEW_NOTE, telephonyConfigured } = voiceCalls;
const CALLER = '+15551230000';
const CALL_SID = 'CAfixture00000000000000000000000001';
const quietLog = { debug() {}, info() {}, warn() {}, error() {} };
let server;
let origin;

function twilioSign(fullUrl, params) {
	const data = Object.keys(params).sort().reduce((s, k) => s + k + params[k], fullUrl);
	return createHmac('sha1', AUTH_TOKEN).update(Buffer.from(data, 'utf8')).digest('base64');
}
async function twilio(query, params, { signature } = {}) {
	const path = `/api/gateway/voice?${new URLSearchParams(query).toString()}`;
	const res = await fetch(`${origin}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature || twilioSign(`${origin}${path}`, params) },
		body: new URLSearchParams(params).toString(),
	});
	return { status: res.status, type: res.headers.get('content-type'), body: await res.text() };
}
const inbox = () => holder.db.query('SELECT platform, dedupe_key, chat_key, payload, status FROM gateway_inbox ORDER BY id');

function recordingFetch() {
	const calls = [];
	const fetchImpl = async (u, init = {}) => {
		calls.push({ url: String(u), headers: init.headers || {} });
		return new Response(Buffer.from('RIFF-fixture-wav'), { headers: { 'content-type': 'audio/wav' } });
	};
	return { fetchImpl, calls };
}

function voiceWorker(deps) {
	const rec = recordingFetch();
	const adapter = createVoiceAdapter({ env: process.env, fetch: rec.fetchImpl, deps: { sleep: async () => {}, ...deps } });
	const drainer = createDrainer({ adapters: new Map([['voice', adapter]]), config: { ...loadConfig({}), pollMs: 50 }, log: quietLog });
	return {
		rec,
		async drainOnce() {
			const n = await drainer.tick();
			await Promise.allSettled([...drainer.inflight.values()]);
			return n;
		},
	};
}

beforeAll(async () => {
	holder.db = await createGatewayDb();
	server = http.createServer((req, res) => receiver(req, res));
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	origin = `http://127.0.0.1:${server.address().port}`;
	// Twilio signs the public URL it called; the legs build their own URLs from
	// the app origin, so the test server is the origin.
	process.env.PUBLIC_APP_ORIGIN = origin;
});
afterAll(async () => {
	await new Promise((resolve) => server.close(resolve));
});
beforeEach(async () => {
	await holder.db.exec('TRUNCATE gateway_inbox, gateway_voice_turns, gateway_previews, gateway_pair_codes, gateway_links, agent_identities, users RESTART IDENTITY CASCADE');
});

describe('phone call legs', () => {
	const attested = { CallSid: CALL_SID, From: CALLER, To: '+15550000000', StirVerstat: 'TN-Validation-Passed-A' };

	it('greets an attested caller and records after the beep', async () => {
		const res = await twilio({ leg: 'call' }, attested);
		expect(res.status).toBe(200);
		expect(res.type).toMatch(/text\/xml/);
		expect(res.body).toContain('<Record action="');
		expect(res.body).toContain('leg=recorded');
	});

	it('refuses a request without a valid Twilio signature', async () => {
		expect((await twilio({ leg: 'call' }, attested, { signature: 'AAAA' })).status).toBe(401);
		const forgedUrl = twilioSign(`${origin}/api/gateway/voice?leg=poll`, attested);
		expect((await twilio({ leg: 'call' }, attested, { signature: forgedUrl })).status).toBe(401);
	});

	it('hangs up on a caller ID the carrier did not attest, and on a withheld number', () => {
		expect(callRefusal({ From: CALLER, StirVerstat: 'TN-Validation-Passed-C' })).toMatch(/did not verify/);
		expect(callRefusal({ From: 'anonymous' })).toMatch(/caller ID/);
		expect(callRefusal({ From: CALLER })).toMatch(/did not verify/);
		expect(callRefusal({ From: CALLER }, { GATEWAY_VOICE_REQUIRE_ATTESTATION: '0' })).toBeNull();
		expect(callRefusal(attested)).toBeNull();
	});

	it('runs a turn end to end: queue the recording, the worker answers, the poll plays it', async () => {
		const recorded = { ...attested, RecordingSid: 'REfixture0000000000000000000000001', RecordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/ACfixture/Recordings/REfixture0000000000000000000000001', RecordingDuration: '3' };
		const queued = await twilio({ leg: 'recorded' }, recorded);
		expect(queued.body).toContain('One moment.');
		expect(queued.body).toContain('leg=poll');
		const [row] = await inbox();
		expect(row).toMatchObject({ platform: 'voice', dedupe_key: `turn:${recorded.RecordingSid}`, chat_key: `voice:${CALLER}`, payload: { kind: 'voice_call_turn', turnId: recorded.RecordingSid } });

		// Twilio redelivering the same recording callback queues nothing new.
		await twilio({ leg: 'recorded' }, recorded);
		expect(await inbox()).toHaveLength(1);

		const pending = await twilio({ leg: 'poll', turn: recorded.RecordingSid, n: '1' }, attested);
		expect(pending.body).toContain('<Pause');

		const heard = [];
		const { rec, drainOnce } = voiceWorker({
			transcribeVoice: async (audio) => { heard.push(audio.mimeType); return 'hello agent'; },
			synthesizeReply: async () => ({ buffer: Buffer.from('ogg'), mimeType: 'audio/ogg' }),
			toMp3: async () => Buffer.from('ID3-fixture-mp3'),
		});
		expect(await drainOnce()).toBe(1);
		expect(rec.calls[0].url).toBe(`${recorded.RecordingUrl}.wav`);
		expect(rec.calls[0].headers.authorization).toMatch(/^Basic /);
		expect(heard).toEqual(['audio/wav']);

		// An unpaired caller is offered a pairing code, spelled out to be heard.
		const [turn] = await holder.db.query('SELECT status, reply_text, clip_id FROM gateway_voice_turns');
		expect(turn.status).toBe('ready');
		expect(turn.reply_text).toMatch(/pairing code: [A-Z0-9] [A-Z0-9] [A-Z0-9] [A-Z0-9], /);
		expect(turn.reply_text).not.toMatch(/https?:/);

		const ready = await twilio({ leg: 'poll', turn: recorded.RecordingSid, n: '2' }, attested);
		expect(ready.body).toContain(`leg=clip&amp;id=${turn.clip_id}`);
		expect(ready.body).toContain('<Record');

		const clip = await fetch(`${origin}/api/gateway/voice?leg=clip&id=${turn.clip_id}`);
		expect(clip.headers.get('content-type')).toBe('audio/mpeg');
		expect(Buffer.from(await clip.arrayBuffer()).toString()).toBe('ID3-fixture-mp3');

		// The turn only plays on the call that recorded it.
		const otherCall = await twilio({ leg: 'poll', turn: recorded.RecordingSid, n: '2' }, { ...attested, CallSid: 'CAother' });
		expect(otherCall.body).toContain('lost track');
	});

	it('stores a spoken apology when the recording cannot be fetched', async () => {
		await voiceCalls.createVoiceTurn({ id: 'REbroken', callSid: CALL_SID, caller: CALLER });
		const adapter = createVoiceAdapter({
			env: process.env,
			fetch: async () => new Response('gone', { status: 404 }),
			deps: { sleep: async () => {} },
		});
		const event = adapter.normalize({ kind: 'voice_call_turn', turnId: 'REbroken', caller: CALLER, recordingUrl: 'https://api.twilio.com/2010-04-01/Accounts/AC/Recordings/REbroken' });
		await adapter.handle(event, adapter.gateway(event));
		const [turn] = await holder.db.query("SELECT status, reply_text FROM gateway_voice_turns WHERE id = 'REbroken'");
		expect(turn).toEqual({ status: 'failed', reply_text: TURN_APOLOGY });
	});

	it('only takes recordings hosted by Twilio', () => {
		const adapter = createVoiceAdapter({ env: process.env, fetch: async () => new Response('') });
		expect(adapter.normalize({ kind: 'voice_call_turn', turnId: 'RE1', caller: CALLER, recordingUrl: 'https://attacker.example/r' })).toBeNull();
	});
});

describe('a phone call never approves a trade', () => {
	it('cancels the preview and says why instead of offering buttons', async () => {
		const { user, agent, link } = await seedPairedChat(holder.db, { platform: 'voice', chatId: CALLER, platformUserId: CALLER });
		const preview = await createPreview({ linkId: link.id, userId: user.id, agentId: agent.id, kind: 'buy', proposal: { mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump', sol: 0.1 } });
		const gw = collectingGateway({ buttons: false });
		await gw.sendChoice(CALLER, 'Buy 0.1 SOL of $THREE?', [{ id: `gw:ap:${preview.id}`, label: 'Approve' }, { id: `gw:cx:${preview.id}`, label: 'Cancel' }]);
		expect(gw.choices).toEqual([]);
		expect(gw.transcript()).toBe(PHONE_PREVIEW_NOTE);
		const [row] = await holder.db.query('SELECT status FROM gateway_previews WHERE id = $1', [preview.id]);
		expect(row.status).toBe('cancelled');
	});

	it('the signed-in browser leg keeps the buttons', async () => {
		const gw = collectingGateway({ buttons: true });
		await gw.sendChoice('web:u', 'Buy?', [{ id: 'gw:ap:x', label: 'Approve', style: 'primary' }]);
		expect(gw.choices).toEqual([{ messageId: 1, choices: [{ id: 'gw:ap:x', label: 'Approve', style: 'primary' }] }]);
	});
});

describe('voice text and TwiML', () => {
	it('spells pairing codes and drops links', () => {
		const said = speakable(`Your pairing code: ABCD-EFGH\nOpen ${origin}/settings/connections?code=ABCDEFGH\nDone.`);
		expect(said).toContain('A B C D, E F G H');
		expect(said).not.toContain('http');
	});

	it('escapes what it says and loops back to recording', () => {
		expect(twimlGreeting()).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><Response><Say>/);
		expect(twimlReply({ text: 'Tom & Jerry <3' })).toContain('<Say>Tom &amp; Jerry &lt;3</Say><Record');
		expect(twimlWait('RE1', 3)).not.toContain('One moment.');
		expect(twimlWait('RE1', 3)).toContain('n=4');
	});

	it('is off unless the telephony flag and Twilio credentials are all set', () => {
		expect(telephonyConfigured({})).toEqual({ ok: false, missing: ['GATEWAY_VOICE_TELEPHONY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN'] });
		expect(telephonyConfigured(process.env)).toEqual({ ok: true });
	});
});
