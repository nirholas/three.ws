// The adapter registry, the retry policy and the setup command sets.

import { describe, it, expect } from 'vitest';
import { loadAdapters } from '../src/adapters/index.js';
import { backoffMs, classifyFailure, PlatformError } from '../src/errors.js';
import { loadConfig } from '../src/config.js';
import { discordCommandSet, telegramCommandSet } from '../src/setup.js';
import { COMMAND_HANDLERS } from '../../../api/_lib/gateway/commands.js';

describe('adapter registry', () => {
	it('loads only configured adapters and names the missing variables', () => {
		const { adapters, skipped } = loadAdapters({ env: { TELEGRAM_BOT_TOKEN: '1:fixture' } });
		expect([...adapters.keys()]).toEqual(['telegram']);
		expect(skipped).toEqual([{ platform: 'discord', missing: ['DISCORD_BOT_TOKEN', 'DISCORD_APP_ID'] }]);
	});

	it('honours GATEWAY_PLATFORMS and accepts a new platform without touching the loop', () => {
		const created = [];
		const factories = {
			telegram: { configured: () => ({ ok: true }), create: () => ({ platform: 'telegram' }) },
			x: { configured: () => ({ ok: true }), create: (o) => { created.push(o); return { platform: 'x', normalize: () => null, gateway: () => ({}) }; } },
		};
		const { adapters } = loadAdapters({ env: {}, config: { platforms: ['x'] }, factories });
		expect([...adapters.keys()]).toEqual(['x']);
		expect(created).toHaveLength(1);
		const unknown = loadAdapters({ env: {}, config: { platforms: ['fax'] }, factories });
		expect(unknown.skipped).toEqual([{ platform: 'fax', missing: [], reason: 'unknown platform' }]);
	});
});

describe('retry policy', () => {
	const ctx = { attempts: 1, maxAttempts: 5, delivered: 0, baseMs: 5000, maxMs: 300_000 };

	it('backs off exponentially, capped, never under the platform wait', () => {
		expect(backoffMs(1, { baseMs: 5000, maxMs: 300_000 })).toBe(5000);
		expect(backoffMs(3, { baseMs: 5000, maxMs: 300_000 })).toBe(20_000);
		expect(backoffMs(12, { baseMs: 5000, maxMs: 300_000 })).toBe(300_000);
		expect(backoffMs(1, { baseMs: 5000, maxMs: 300_000, retryAfterMs: 42_000 })).toBe(42_000);
	});

	it('classifies transient, permanent, exhausted and partially delivered failures', () => {
		expect(classifyFailure(new Error('socket hang up'), ctx)).toEqual({ deadLetter: false, retryAfterMs: 5000, reason: 'transient' });
		expect(classifyFailure(new PlatformError('telegram', 'chat not found', { status: 400, permanent: true }), ctx).reason).toBe('permanent');
		expect(classifyFailure(new Error('x'), { ...ctx, attempts: 5 }).reason).toBe('attempts_exhausted');
		expect(classifyFailure(new Error('x'), { ...ctx, delivered: 1 }).reason).toBe('partially_delivered');
	});
});

describe('config', () => {
	it('has production defaults and rejects a malformed number', () => {
		expect(loadConfig({})).toMatchObject({ port: 8080, concurrency: 8, leaseSeconds: 90, maxAttempts: 5, platforms: null, telegramPolling: false, discordGateway: true });
		expect(loadConfig({ GATEWAY_PLATFORMS: 'telegram, discord', GATEWAY_CHAT_KEYS: 'telegram:1' })).toMatchObject({ platforms: ['telegram', 'discord'], chatKeys: ['telegram:1'] });
		expect(() => loadConfig({ GATEWAY_CONCURRENCY: 'lots' })).toThrow(/GATEWAY_CONCURRENCY/);
	});
});

describe('setup command sets', () => {
	it('registers every command the core handles on Discord, top level and under /three', () => {
		const set = discordCommandSet();
		const names = set.map((c) => c.name);
		for (const name of [...Object.keys(COMMAND_HANDLERS), 'start', 'link', 'help']) expect(names).toContain(name);
		const three = set.find((c) => c.name === 'three');
		expect(three.options.map((o) => o.name)).toEqual(names.filter((n) => n !== 'three'));
		for (const c of set) {
			expect(c.name).toMatch(/^[a-z0-9_-]{1,32}$/);
			expect(c.description.length).toBeLessThanOrEqual(100);
			for (const o of c.options || []) expect(o.name).toMatch(/^[a-z0-9_-]{1,32}$/);
		}
		expect(set.find((c) => c.name === 'voice').options[0].choices.map((ch) => ch.value)).toEqual(['on', 'off']);
	});

	it('publishes a valid Telegram command menu', () => {
		const set = telegramCommandSet();
		expect(set[0]).toEqual({ command: 'start', description: 'Get a pairing code for this chat' });
		for (const c of set) expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
	});
});
