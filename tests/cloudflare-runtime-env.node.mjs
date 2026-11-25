import assert from 'node:assert/strict';
import test from 'node:test';
import { runtimeEnvironment } from '../deploy/cloudflare/runtime-env.mjs';

const ORIGIN = 'https://three-ws-staging.workers.dev';

test('direct bindings keep Node defaults and exclude Worker controls and object bindings', () => {
	assert.deepEqual(runtimeEnvironment({
		NODE_ENV: 'development', PORT: '9000', API_URL: 'https://example.com',
		THREE_WS_INSTANCE: 'standard-3', THREE_WS_SLEEP_MS: '120000', THREE_WS: {},
	}, ORIGIN), { NODE_ENV: 'production', PORT: '8080', API_URL: 'https://example.com', PUBLIC_APP_ORIGIN: ORIGIN });
});

test('chunk boundaries preserve multiline and Unicode configuration exactly', () => {
	const expected = { CERTIFICATE: 'line one\nline two\n', UNICODE: 'café 🌎'.repeat(1000), EMPTY: '' };
	const serialized = JSON.stringify(expected);
	const chunks = serialized.match(/[\s\S]{1,4500}/g);
	const bindings = Object.fromEntries(chunks.map((part, index) => [`THREE_WS_ENV_${String(index).padStart(3, '0')}`, part]));
	bindings.THREE_WS_ENV_PARTS = String(chunks.length);
	assert.deepEqual(runtimeEnvironment(bindings, ORIGIN), {
		...expected, NODE_ENV: 'production', PORT: '8080', PUBLIC_APP_ORIGIN: ORIGIN,
	});
});

test('individual runtime bindings override imported configuration', () => {
	assert.equal(runtimeEnvironment({
		THREE_WS_ENV_PARTS: '1', THREE_WS_ENV_000: '{"DATABASE_URL":"imported"}',
		DATABASE_URL: 'staging override',
	}, ORIGIN).DATABASE_URL, 'staging override');
});

test('unused bundle parts and control names never enter the container', () => {
	const result = runtimeEnvironment({
		THREE_WS_ENV_PARTS: '1',
		THREE_WS_ENV_000: '{"THREE_WS_SLEEP_MS":"5","THREE_WS_ENV_001":"unused"}',
		THREE_WS_ENV_001: 'old unused configuration',
	}, ORIGIN);
	assert.deepEqual(result, { NODE_ENV: 'production', PORT: '8080', PUBLIC_APP_ORIGIN: ORIGIN });
});

test('invalid bundle counts and missing parts fail closed', () => {
	for (const count of ['', '0', '01', '-1', '96', '1.0', 1]) {
		assert.throws(() => runtimeEnvironment({ THREE_WS_ENV_PARTS: count }, ORIGIN), /part count/);
	}
	assert.throws(() => runtimeEnvironment({ THREE_WS_ENV_PARTS: '2', THREE_WS_ENV_000: '{}' }, ORIGIN), /Missing/);
});

test('invalid JSON never exposes its content in the error', () => {
	assert.throws(() => runtimeEnvironment({
		THREE_WS_ENV_PARTS: '1', THREE_WS_ENV_000: 'sensitive configuration text',
	}, ORIGIN), { message: 'Invalid environment bundle JSON' });
});

test('bundle rejects nonobjects, nonstring values, invalid names, and NULs', () => {
	for (const value of [null, [], 3, { API_KEY: 7 }, { 'INVALID-NAME': 'text' }, { API_KEY: '\0' }]) {
		assert.throws(() => runtimeEnvironment({
			THREE_WS_ENV_PARTS: '1', THREE_WS_ENV_000: JSON.stringify(value),
		}, ORIGIN), /Environment bundle/);
	}
});
