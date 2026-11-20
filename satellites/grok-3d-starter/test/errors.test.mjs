import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppError, mapToolProblem, mapXaiError, readXaiErrorBody, toAppError, xaiStreamFailed, xaiUnreachable } from '../lib/errors.mjs';
import { fixture } from './helpers.mjs';

const body = (path) => JSON.stringify(fixture(path).response);

test('the captured xAI 401 (no key) maps to "xAI did not accept the API key"', () => {
	const { _fixture } = fixture('xai/401-no-key.json');
	assert.equal(_fixture.source, 'captured');
	const err = mapXaiError(_fixture.httpStatus, body('xai/401-no-key.json'));
	assert.equal(err.code, 'xai_unauthorized');
	assert.equal(err.title, 'xAI did not accept the API key');
	assert.equal(err.link, 'https://console.x.ai');
	assert.match(err.fix, /XAI_API_KEY/);
	assert.equal(err.retryable, false);
});

test('the captured xAI 400 for a wrong key shows the same card, with its own code', () => {
	const { _fixture } = fixture('xai/400-wrong-key.json');
	assert.equal(_fixture.httpStatus, 400);
	const err = mapXaiError(400, body('xai/400-wrong-key.json'));
	assert.equal(err.code, 'xai_bad_key');
	assert.equal(err.title, 'xAI did not accept the API key');
});

test('readXaiErrorBody reads both of xAI\'s error shapes and survives non-JSON', () => {
	assert.deepEqual(readXaiErrorBody(body('xai/401-no-key.json')), { code: 'unauthenticated:no-credentials', message: 'No credentials presented.' });
	assert.deepEqual(readXaiErrorBody('{"error":{"code":"rate_limit","message":"slow"}}'), { code: 'rate_limit', message: 'slow' });
	assert.equal(readXaiErrorBody('<html>bad gateway</html>').message, '<html>bad gateway</html>');
});

test('xAI 429 is retryable and carries Retry-After', () => {
	const err = mapXaiError(429, '{"code":"rate-limited","error":"Too many requests"}', new Headers({ 'retry-after': '12' }));
	assert.equal(err.code, 'xai_rate_limited');
	assert.equal(err.retryable, true);
	assert.equal(err.retryAfterSeconds, 12);
	assert.match(err.message, /retry in 12s/);
	assert.equal(mapXaiError(429, '', new Headers()).retryAfterSeconds, null);
});

test('xAI 403, unknown model, 5xx and anything else each get their own message', () => {
	assert.equal(mapXaiError(403, '{"error":"no credits"}').code, 'xai_forbidden');
	assert.equal(mapXaiError(404, '{"error":"The model grok-x does not exist"}').code, 'xai_model');
	assert.equal(mapXaiError(400, '{"code":"invalid-argument","error":"Model not found: grok-x"}').code, 'xai_model');
	const down = mapXaiError(503, '');
	assert.equal(down.code, 'xai_unavailable');
	assert.equal(down.retryable, true);
	const other = mapXaiError(422, '{"code":"invalid-argument","error":"max_turns must be positive"}');
	assert.equal(other.code, 'xai_bad_request');
	assert.match(other.message, /422 \(invalid-argument\): max_turns must be positive/);
});

test('when xAI reports that the MCP server refused its key, the page blames the three.ws key', () => {
	const err = mapXaiError(400, '{"code":"invalid-argument","error":"MCP server three-ws returned 401 Unauthorized"}');
	assert.equal(err.code, 'three_ws_bad_key');
	assert.equal(err.link, 'https://three.ws/dashboard/api-keys');
	assert.equal(xaiStreamFailed({ message: 'mcp tools/list failed: 401 unauthorized' }).code, 'three_ws_bad_key');
});

test('stream failures map rate limits to 429 and everything else to a retryable stop', () => {
	assert.equal(xaiStreamFailed({ code: 'rate_limit_exceeded', message: 'tokens per minute' }).code, 'xai_rate_limited');
	const err = xaiStreamFailed({ message: 'internal' });
	assert.equal(err.code, 'xai_stream_failed');
	assert.equal(err.retryable, true);
	assert.equal(xaiUnreachable(new Error('getaddrinfo ENOTFOUND api.x.ai')).code, 'xai_unreachable');
});

test('three.ws tool problems map to sign-in, bad key or render failure; other results do not block', () => {
	assert.equal(mapToolProblem({ kind: 'sign_in_required', apiKeysUrl: 'https://three.ws/dashboard/api-keys' }).code, 'three_ws_sign_in');
	assert.equal(mapToolProblem({ kind: 'bad_key' }).code, 'three_ws_bad_key');
	const failed = mapToolProblem({ kind: 'failed', tool: 'forge_free', message: 'GPU out of memory', retryable: false });
	assert.equal(failed.code, 'render_failed');
	assert.equal(failed.message, 'GPU out of memory');
	assert.equal(mapToolProblem({ kind: 'failed', tool: 'search_catalog', message: 'x' }), null);
	assert.equal(mapToolProblem({ kind: 'catalog', items: [] }), null);
	assert.equal(mapToolProblem(null), null);
});

test('AppError serialises without its HTTP status, and unknown errors become a generic retryable one', () => {
	const json = mapXaiError(401, body('xai/401-no-key.json')).toJSON();
	assert.deepEqual(Object.keys(json).sort(), ['code', 'fix', 'link', 'message', 'retryAfterSeconds', 'retryable', 'title']);
	const internal = toAppError(new Error('x'.repeat(500)));
	assert.equal(internal.code, 'internal');
	assert.ok(internal.message.length <= 200);
	const same = new AppError('a', { title: 't', message: 'm' });
	assert.equal(toAppError(same), same);
});
