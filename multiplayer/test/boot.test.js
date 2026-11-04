// Boot contract: a set-but-unusable REDIS_URI must fail the process (so Cloud
// Run keeps the previous revision) rather than silently run single-instance,
// and an unset one must report presence 'local'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, freePort } from './helpers.js';

test('no REDIS_URI: /health reports local presence', async () => {
	const s = await startServer();
	try {
		assert.equal(s.health.presence, 'local');
		assert.equal(s.health.ok, true);
	} finally {
		await s.stop();
	}
});

test('unreachable REDIS_URI exits non-zero instead of falling back', async () => {
	const dead = await freePort();
	const s = await startServer({ env: { REDIS_URI: `redis://127.0.0.1:${dead}`, REDIS_BOOT_TIMEOUT_MS: '3000' } });
	try {
		const code = await Promise.race([s.exited, new Promise((r) => setTimeout(() => r('still-running'), 15_000))]);
		assert.notEqual(code, 'still-running', s.log());
		assert.notEqual(code, 0);
		assert.match(s.log(), /FATAL: REDIS_URI is set but Redis is unusable/);
	} finally {
		await s.stop();
	}
});
