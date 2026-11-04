// A production game server with no $THREE treasury configured must degrade to
// "paid features unavailable", never throw. tokenConfigured() is the predicate
// every gate asks (spin wheel info, paid spin, market listings, quotes); when it
// threw instead of answering, one player opening the spin wheel raised an
// uncaught exception that took the single production instance down for every
// connected player (Cloud Run log 2026-11-04T06:28:13Z, "Container called exit(1)").
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';

const saved = {};
const KEYS = ['NODE_ENV', 'GAME_TOKEN_TREASURY', 'PAYMENT_RECIPIENT_SOLANA', 'GAME_TOKEN_SECRET'];

beforeAll(() => {
	for (const k of KEYS) saved[k] = process.env[k];
	process.env.NODE_ENV = 'production';
	delete process.env.GAME_TOKEN_TREASURY;
	delete process.env.PAYMENT_RECIPIENT_SOLANA;
	process.env.GAME_TOKEN_SECRET = 'test-secret-unconfigured-treasury';
});
afterAll(() => {
	for (const k of KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('a production server without a treasury wallet', () => {
	it('answers tokenConfigured() with false instead of throwing', async () => {
		const { tokenConfigured } = await import('../multiplayer/src/game-token.js');
		expect(() => tokenConfigured()).not.toThrow();
		expect(tokenConfigured()).toBe(false);
	});

	it('still serves spinInfo, with the paid spin marked unavailable', async () => {
		const { handleSpinInfo } = await import('../multiplayer/src/spin-wheel.js');
		const { newProfile } = await import('../multiplayer/src/economy.js');
		const { WHEEL } = await import('../multiplayer/src/world-features.js');
		const sent = [];
		const room = {
			state: { players: new Map([['s1', { x: WHEEL[0].x, z: WHEEL[0].z }]]) },
			econ: new Map([['s1', newProfile('acct-1')]]),
			_actionOk: () => true,
		};
		const client = { sessionId: 's1', send: (type, msg) => sent.push({ type, msg }) };
		expect(() => handleSpinInfo(room, client)).not.toThrow();
		expect(sent[0]?.type).toBe('spinInfo');
		expect(sent[0].msg.paidAvailable).toBe(false);
	});

	it('refuses a paid spin with the reason the UI has copy for', async () => {
		const { handleSpinPaidPrep, MIN_AVG_LEVEL } = await import('../multiplayer/src/spin-wheel.js');
		const { newProfile } = await import('../multiplayer/src/economy.js');
		const { WHEEL } = await import('../multiplayer/src/world-features.js');
		const p = newProfile('acct-2');
		for (const skill of Object.keys(p.levels)) p.levels[skill] = MIN_AVG_LEVEL;
		const sent = [];
		const room = {
			state: { players: new Map([['s1', { x: WHEEL[0].x, z: WHEEL[0].z }]]) },
			econ: new Map([['s1', p]]),
			_spinNonces: new Map(),
			_pruneSpinNonces: vi.fn(),
			_actionOk: () => true,
		};
		const client = { sessionId: 's1', send: (type, msg) => sent.push({ type, msg }) };
		await handleSpinPaidPrep(room, client, {});
		expect(sent.find((m) => m.type === 'spinDenied')?.msg.reason).toBe('token_unavailable');
	});
});
