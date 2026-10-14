import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { ClaimListener } from './listener.js';

function fakeSubscriber() {
	let nextId = 1;
	const calls = [];
	const fn = (programId, handler) => {
		calls.push({ programId, handler });
		return nextId++;
	};
	fn.calls = calls;
	return fn;
}

function fakeConnection({ getSlot } = {}) {
	return {
		_removed: [],
		getSlot: getSlot || (async () => 123),
		removeOnLogsListener(id) {
			this._removed.push(id);
		},
	};
}

describe('ClaimListener', () => {
	test('subscribes on start and forwards entries to onEntry', () => {
		const subscriber = fakeSubscriber();
		const listener = new ClaimListener({ logSubscriber: subscriber });
		const entries = [];
		listener.start((entry) => entries.push(entry));

		assert.equal(subscriber.calls.length, 1);
		subscriber.calls[0].handler({ signature: 'sig1', logs: [] }, { slot: 10 });
		assert.equal(entries.length, 1);
		assert.equal(entries[0].signature, 'sig1');
		listener.stop();
	});

	test('a healthy heartbeat resets the missed counter', async () => {
		const connection = fakeConnection();
		const listener = new ClaimListener({ connection, logSubscriber: fakeSubscriber(), maxMissedHeartbeats: 3 });
		listener.start(() => {});
		await listener._heartbeatTick();
		assert.equal(listener.missedHeartbeats, 0);
		listener.stop();
	});

	test('repeated failed heartbeats force a resubscribe and call onReconnect', async () => {
		const subscriber = fakeSubscriber();
		const connection = fakeConnection({ getSlot: async () => { throw new Error('rpc down'); } });
		const listener = new ClaimListener({
			connection,
			logSubscriber: subscriber,
			maxMissedHeartbeats: 2,
			heartbeatTimeoutMs: 50,
		});
		let reconnects = 0;
		listener.start(() => {}, () => { reconnects += 1; });
		assert.equal(subscriber.calls.length, 1);

		await listener._heartbeatTick();
		assert.equal(listener.missedHeartbeats, 1);
		assert.equal(reconnects, 0);

		await listener._heartbeatTick();
		assert.equal(reconnects, 1);
		assert.equal(subscriber.calls.length, 2, 'resubscribed after reaching maxMissedHeartbeats');
		assert.equal(listener.missedHeartbeats, 0, 'counter resets after forcing a reconnect');

		listener.stop();
	});

	test('a heartbeat that times out counts as a miss', async () => {
		const subscriber = fakeSubscriber();
		const connection = fakeConnection({ getSlot: () => new Promise(() => {}) }); // never resolves
		const listener = new ClaimListener({
			connection,
			logSubscriber: subscriber,
			maxMissedHeartbeats: 5,
			heartbeatTimeoutMs: 20,
		});
		listener.start(() => {});
		await listener._heartbeatTick();
		assert.equal(listener.missedHeartbeats, 1);
		listener.stop();
	});

	test('stop() tears down the subscription and clears the heartbeat timer', () => {
		const subscriber = fakeSubscriber();
		const connection = fakeConnection();
		const listener = new ClaimListener({ connection, logSubscriber: subscriber });
		listener.start(() => {});
		listener.stop();
		// A second stop() must not throw (idempotent shutdown).
		listener.stop();
	});
});
