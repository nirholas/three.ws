// The server's contract: input validation, the xAI request shape, reading the
// structured reply, and honest errors when the key is missing or rejected.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MOODS, buildRequest, readReply, server, validateMessages } from './server.mjs';

test('validateMessages accepts a conversation that ends with the user', () => {
	assert.equal(validateMessages([{ role: 'user', content: 'hi' }]), null);
	assert.match(validateMessages([]), /non-empty/);
	assert.match(validateMessages([{ role: 'system', content: 'x' }]), /role/);
	assert.match(validateMessages([{ role: 'user', content: 'x'.repeat(2001) }]), /2000/);
	assert.match(validateMessages([{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]), /last message/);
});

test('buildRequest asks for a strict reply plus a mood from the fixed list', () => {
	const req = buildRequest([{ role: 'user', content: 'hello' }]);
	assert.equal(req.text.format.type, 'json_schema');
	assert.equal(req.text.format.strict, true);
	assert.deepEqual(req.text.format.schema.properties.mood.enum, MOODS);
	assert.deepEqual(req.input, [{ role: 'user', content: 'hello' }]);
	assert.equal(req.store, false);
});

test('readReply reads the output_text JSON, and calms an unknown mood to neutral', () => {
	const shape = (json) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(json) }] }] });
	assert.deepEqual(readReply(shape({ reply: ' Hi there! ', mood: 'excited' })), { reply: 'Hi there!', mood: 'excited' });
	assert.deepEqual(readReply(shape({ reply: 'Hm.', mood: 'grumpy' })), { reply: 'Hm.', mood: 'neutral' });
	assert.throws(() => readReply(shape({ reply: '', mood: 'happy' })), /without a reply/);
});

async function withServer(env, fn) {
	const saved = { XAI_API_KEY: process.env.XAI_API_KEY, GROK_API_KEY: process.env.GROK_API_KEY };
	delete process.env.GROK_API_KEY;
	if (env.XAI_API_KEY === undefined) delete process.env.XAI_API_KEY;
	else process.env.XAI_API_KEY = env.XAI_API_KEY;
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		await fn(base);
	} finally {
		await new Promise((r) => server.close(r));
		for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
	}
}

const post = (base, body) =>
	fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('without a key: health says so and chat answers 503 with the fix', async () => {
	await withServer({}, async (base) => {
		const health = await (await fetch(`${base}/api/health`)).json();
		assert.equal(health.key, false);
		const res = await post(base, { messages: [{ role: 'user', content: 'hi' }] });
		assert.equal(res.status, 503);
		assert.match((await res.json()).message, /XAI_API_KEY/);
	});
});

test('static files are served and traversal is refused', async () => {
	await withServer({}, async (base) => {
		const page = await fetch(`${base}/`);
		assert.equal(page.status, 200);
		assert.match(await page.text(), /<agent-3d/);
		assert.equal((await fetch(`${base}/..%2fserver.mjs`)).status, 404);
	});
});

test('a rejected key is reported with xAI\'s own message (live call to api.x.ai)', async () => {
	await withServer({ XAI_API_KEY: 'placeholder-not-a-key' }, async (base) => {
		const bad = await post(base, { messages: [] });
		assert.equal(bad.status, 400);
		const res = await post(base, { messages: [{ role: 'user', content: 'hi' }] });
		const body = await res.json();
		assert.equal(res.status, 502);
		assert.equal(body.error, 'xai_error');
		assert.equal(body.status, 400);
		assert.match(body.message, /Incorrect API key/);
	});
});

test('the load label reads agent:load-progress pct, a 0..1 fraction, as a percentage', async () => {
	const { loadLabel } = await import('./public/moods.js');
	assert.equal(loadLabel(0.45), '45%');
	assert.equal(loadLabel(0.9), '90%');
	assert.equal(loadLabel(1), '100%');
	assert.equal(loadLabel(0), '');
	assert.equal(loadLabel(undefined), '');
});

test('every mood maps to a known emote or to a spoken reply', async () => {
	const { MOOD_MAP, moodFor } = await import('./public/moods.js');
	assert.deepEqual(Object.keys(MOOD_MAP).sort(), [...MOODS].sort());
	assert.equal(moodFor('grumpy'), MOOD_MAP.neutral);
});
