import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getParsedTransactionWithBackoff } from './rpc-pace.js';

function fakeConnection(responses) {
	let i = 0;
	return {
		calls: 0,
		async getParsedTransaction() {
			this.calls += 1;
			const next = responses[Math.min(i, responses.length - 1)];
			i += 1;
			if (next instanceof Error) throw next;
			return next;
		},
	};
}

const noSleep = async () => {};

describe('getParsedTransactionWithBackoff', () => {
	test('returns the result once a 429 clears', async () => {
		const connection = fakeConnection([new Error('429 Too Many Requests'), { meta: { logMessages: [] } }]);
		const result = await getParsedTransactionWithBackoff(connection, 'sig', {}, noSleep);
		assert.deepEqual(result, { meta: { logMessages: [] } });
		assert.equal(connection.calls, 2);
	});

	test('rethrows a non-429 error immediately, with no retry', async () => {
		const connection = fakeConnection([new Error('boom')]);
		await assert.rejects(() => getParsedTransactionWithBackoff(connection, 'sig', {}, noSleep), /boom/);
		assert.equal(connection.calls, 1);
	});

	test('gives up after the retry budget on a persistent 429', async () => {
		const connection = fakeConnection([new Error('429 Too Many Requests')]);
		await assert.rejects(() => getParsedTransactionWithBackoff(connection, 'sig', {}, noSleep), /429/);
		assert.ok(connection.calls > 1);
	});
});
