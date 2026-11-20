import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { ALLOWED_TOOLS, DEFAULT_MODEL, loadConfig, missingKeys } from '../lib/config.mjs';
import { LIMITS, clientAddress, createRateLimiter, readJsonBody, validateChatInput } from '../lib/validate.mjs';
import { SYSTEM_PROMPT, buildRequest, mcpTool, userTurnText, visitorId } from '../lib/xai.mjs';
import { testConfig } from './helpers.mjs';

test('a well-formed chat request passes, trimmed and with NUL bytes removed', () => {
	assert.deepEqual(validateChatInput({ message: '  a brass lamp\u0000 ' }), { message: 'a brass lamp', previousResponseId: null, stage: null });
	assert.deepEqual(validateChatInput({ message: 'make it chrome', previousResponseId: 'resp_abc-123', stage: { glbUrl: 'https://three.ws/cdn/a.glb', label: ' Robot ' } }), {
		message: 'make it chrome',
		previousResponseId: 'resp_abc-123',
		stage: { glbUrl: 'https://three.ws/cdn/a.glb', label: 'Robot' },
	});
});

test('the message length cap is enforced with the exact count', () => {
	assert.doesNotThrow(() => validateChatInput({ message: 'x'.repeat(LIMITS.message) }));
	assert.throws(() => validateChatInput({ message: 'x'.repeat(LIMITS.message + 1) }), { code: 'bad_input', message: /limited to 1200 characters; this one has 1201/ });
});

test('malformed requests are refused with a bad_input error', () => {
	for (const bad of [null, [], 'text', {}, { message: '   ' }, { message: 5 }, { message: 'hi', previousResponseId: 'has spaces' }, { message: 'hi', previousResponseId: 42 }, { message: 'hi', stage: [] }, { message: 'hi', stage: { glbUrl: 'http://insecure.example/a.glb' } }, { message: 'hi', stage: { glbUrl: 'javascript:alert(1)' } }, { message: 'hi', stage: { glbUrl: `https://a.example/${'x'.repeat(LIMITS.glbUrl)}` } }]) {
		assert.throws(() => validateChatInput(bad), { code: 'bad_input' }, JSON.stringify(bad));
	}
});

test('readJsonBody refuses oversized and non-JSON bodies', async () => {
	const req = (text, headers = {}) => Object.assign(Readable.from([Buffer.from(text)]), { headers });
	assert.deepEqual(await readJsonBody(req('{"message":"hi"}')), { message: 'hi' });
	await assert.rejects(readJsonBody(req('{}', { 'content-length': String(LIMITS.body + 1) })), { code: 'bad_input' });
	await assert.rejects(readJsonBody(req('x'.repeat(LIMITS.body + 1))), { code: 'bad_input' });
	await assert.rejects(readJsonBody(req('{oops')), { code: 'bad_input', message: /not valid JSON/ });
});

test('the rate limiter allows N per window per address, says when to retry, and resets', () => {
	let t = 0;
	const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => t });
	assert.equal(limiter.check('a').ok, true);
	assert.equal(limiter.check('a').ok, true);
	t = 20_000;
	assert.deepEqual(limiter.check('a'), { ok: false, retryAfterSeconds: 40 });
	assert.equal(limiter.check('b').ok, true, 'each address has its own window');
	t = 60_000;
	assert.equal(limiter.check('a').ok, true);
});

test('clientAddress uses the proxy-appended X-Forwarded-For entry only when trusted', () => {
	const req = { headers: { 'x-forwarded-for': '6.6.6.6, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } };
	assert.equal(clientAddress(req, false), '127.0.0.1');
	assert.equal(clientAddress(req, true), '10.0.0.1');
	assert.equal(clientAddress({ headers: {}, socket: {} }, true), 'unknown');
});

test('config defaults to grok-4.7 and low effort, and forgives a pasted "Bearer " prefix', () => {
	const c = loadConfig({ XAI_API_KEY: ' Bearer xai-abc ', THREE_WS_API_KEY: 'sk_live_x', XAI_REASONING_EFFORT: 'extreme', PORT: 'nope' });
	assert.equal(DEFAULT_MODEL, 'grok-4.7');
	assert.equal(c.model, 'grok-4.7');
	assert.equal(c.reasoningEffort, 'low');
	assert.equal(c.xaiApiKey, 'xai-abc');
	assert.equal(c.port, 8080);
	assert.equal(loadConfig({ XAI_MODEL: 'grok-4.7-fast', XAI_REASONING_EFFORT: 'HIGH' }).model, 'grok-4.7-fast');
	assert.equal(loadConfig({ XAI_REASONING_EFFORT: 'HIGH' }).reasoningEffort, 'high');
	assert.equal(loadConfig({ MAX_RENDER_WAIT_SECONDS: '5' }).maxRenderWaitSeconds, 30);
});

test('missingKeys names each missing or malformed key with where to create it', () => {
	const none = missingKeys(loadConfig({}));
	assert.deepEqual(none.map((m) => [m.name, m.problem]), [['XAI_API_KEY', 'missing'], ['THREE_WS_API_KEY', 'missing']]);
	assert.equal(none[0].url, 'https://console.x.ai/team/default/api-keys');
	assert.equal(none[1].url, 'https://three.ws/dashboard/api-keys');
	const smartQuote = missingKeys(loadConfig({ XAI_API_KEY: 'xai-“abc”', THREE_WS_API_KEY: 'sk_live_x' }));
	assert.deepEqual(smartQuote.map((m) => [m.name, m.problem]), [['XAI_API_KEY', 'malformed']]);
	assert.deepEqual(missingKeys(testConfig()), []);
});

test('the MCP tool is limited to the five allowed tools and carries the three.ws key', () => {
	const tool = mcpTool(testConfig());
	assert.deepEqual(ALLOWED_TOOLS, ['search_catalog', 'forge_free', 'refine_model', 'check_job', 'get_job']);
	assert.deepEqual(tool.allowed_tools, ALLOWED_TOOLS);
	assert.equal(tool.type, 'mcp');
	assert.equal(tool.server_url, 'https://three.ws/api/mcp-grok');
	assert.equal(tool.authorization, 'sk_test_unit');
});

test('the first request carries the instructions; a continuation carries previous_response_id instead', () => {
	const config = testConfig();
	const first = buildRequest({ config, text: 'a lamp', safetyIdentifier: 'v1' });
	assert.equal(first.model, 'grok-4.7');
	assert.equal(first.instructions, SYSTEM_PROMPT);
	assert.equal(first.stream, true);
	assert.equal(first.store, true);
	assert.equal(first.safety_identifier, 'v1');
	assert.deepEqual(first.input, [{ role: 'user', content: 'a lamp' }]);
	const next = buildRequest({ config, text: 'make it chrome', previousResponseId: 'resp_1' });
	assert.equal(next.previous_response_id, 'resp_1');
	assert.equal('instructions' in next, false);
	assert.equal('safety_identifier' in next, false);
});

test('userTurnText puts the stage model first, and visitorId is stable and does not reveal the address', () => {
	assert.equal(userTurnText('hi', null), 'hi');
	assert.equal(userTurnText('make it red', { glbUrl: 'https://a/b.glb', label: '' }), '[Model on the stage: glb_url https://a/b.glb]\nmake it red');
	assert.equal(visitorId('1.2.3.4'), visitorId('1.2.3.4'));
	assert.notEqual(visitorId('1.2.3.4'), visitorId('1.2.3.5'));
	assert.doesNotMatch(visitorId('1.2.3.4'), /1\.2\.3\.4/);
	assert.match(visitorId('1.2.3.4'), /^[0-9a-f]{32}$/);
});
