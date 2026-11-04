/**
 * env.js LiveKit and QStash getters: unit test.
 *
 * The LiveKit token route and the QStash adapter used to read process.env
 * directly, and the LiveKit route captured its credentials at module load, so
 * a key added to the running service never took effect and a pasted value
 * with a trailing newline signed every JWT with the wrong bytes. These getters
 * are the single read point: optional (undefined when unset, never a throw so
 * unrelated routes still answer), trimmed, and blank-means-unset.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { env } from '../api/_lib/env.js';

const KEYS = [
	'LIVEKIT_API_KEY',
	'LIVEKIT_API_SECRET',
	'LIVEKIT_SERVER_URL',
	'QSTASH_TOKEN',
	'QSTASH_CURRENT_SIGNING_KEY',
	'QSTASH_NEXT_SIGNING_KEY',
];
let saved;

beforeEach(() => {
	saved = {};
	for (const k of KEYS) {
		saved[k] = process.env[k];
		delete process.env[k];
	}
});

afterEach(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('env LiveKit and QStash getters', () => {
	it('returns undefined, without throwing, when every key is unset', () => {
		for (const k of KEYS) expect(env[k], k).toBeUndefined();
	});

	it('returns the configured values', () => {
		process.env.LIVEKIT_API_KEY = 'APIsynthetic';
		process.env.LIVEKIT_API_SECRET = 'synthetic-secret';
		process.env.LIVEKIT_SERVER_URL = 'wss://livekit.example.test';
		process.env.QSTASH_TOKEN = 'qstash-synthetic';
		process.env.QSTASH_CURRENT_SIGNING_KEY = 'sig_current';
		process.env.QSTASH_NEXT_SIGNING_KEY = 'sig_next';
		expect(env.LIVEKIT_API_KEY).toBe('APIsynthetic');
		expect(env.LIVEKIT_API_SECRET).toBe('synthetic-secret');
		expect(env.LIVEKIT_SERVER_URL).toBe('wss://livekit.example.test');
		expect(env.QSTASH_TOKEN).toBe('qstash-synthetic');
		expect(env.QSTASH_CURRENT_SIGNING_KEY).toBe('sig_current');
		expect(env.QSTASH_NEXT_SIGNING_KEY).toBe('sig_next');
	});

	it('trims dashboard paste whitespace and treats blank as unset', () => {
		process.env.LIVEKIT_API_SECRET = 'synthetic-secret\n';
		process.env.QSTASH_TOKEN = '  qstash-synthetic ';
		process.env.LIVEKIT_API_KEY = '   ';
		expect(env.LIVEKIT_API_SECRET).toBe('synthetic-secret');
		expect(env.QSTASH_TOKEN).toBe('qstash-synthetic');
		expect(env.LIVEKIT_API_KEY).toBeUndefined();
	});

	it('reads the environment at call time, not at import time', () => {
		expect(env.QSTASH_TOKEN).toBeUndefined();
		process.env.QSTASH_TOKEN = 'added-later';
		expect(env.QSTASH_TOKEN).toBe('added-later');
	});
});
