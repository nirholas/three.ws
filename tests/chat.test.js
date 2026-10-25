/**
 * governActions: Granite Guardian must screen every sendSol in a turn, and the
 * turn's sends together must stay under the autonomous cap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const governSend = vi.fn();
vi.mock('../api/_lib/granite-guardian.js', () => ({
	guardianConfig: () => ({ configured: true, model: 'guardian-test' }),
	governSend: (...a) => governSend(...a),
	sendCapUsd: () => 100,
}));

import { governActions } from '../api/chat.js';

const ok = { decision: 'allow', reasons: [], cap: 100, capExceeded: false };
const block = { decision: 'block', reasons: [{ risk: 'jailbreak', label: 'Jailbreak', probability: 1 }], cap: 100, capExceeded: false };
const send = (usd, to = 'recipient') => ({ type: 'sendSol', usd, to });

beforeEach(() => {
	governSend.mockReset();
	delete process.env.GUARDIAN_DISABLE;
});

describe('governActions', () => {
	it('passes a turn with no sendSol through untouched', async () => {
		const actions = [{ type: 'wave' }];
		const out = await governActions(actions, 'hi');
		expect(out).toEqual({ actions, governance: null });
		expect(governSend).not.toHaveBeenCalled();
	});

	it('screens a second sendSol that the first one would have shielded', async () => {
		governSend.mockResolvedValueOnce(ok).mockResolvedValueOnce(block);
		const out = await governActions([send(5, 'a'), send(5, 'b')], 'send some sol');
		expect(governSend).toHaveBeenCalledTimes(2);
		expect(out.actions).toEqual([send(5, 'a')]);
		expect(out.governance.enforced).toBe(true);
		expect(out.governance.blocked).toEqual([{ type: 'sendSol', usd: 5 }]);
	});

	it('blocks every blocked send and keeps other actions in order', async () => {
		governSend.mockResolvedValue(block);
		const out = await governActions([send(1), { type: 'wave' }, send(2)], 'x');
		expect(out.actions).toEqual([{ type: 'wave' }]);
		expect(out.governance.blocked).toHaveLength(2);
	});

	it('holds sends that together exceed the per-turn cap', async () => {
		governSend.mockResolvedValue(ok);
		const out = await governActions([send(60, 'a'), send(60, 'b')], 'x');
		expect(out.actions).toEqual([send(60, 'a')]);
		expect(out.governance.capExceeded).toBe(true);
		expect(out.governance.blocked).toEqual([{ type: 'sendSol', usd: 60 }]);
	});

	it('still enforces the cap on each send when Guardian is unreachable', async () => {
		governSend.mockRejectedValue(new Error('down'));
		const out = await governActions([send(10, 'a'), send(500, 'b')], 'x');
		expect(out.actions).toEqual([send(10, 'a')]);
		expect(out.governance.enforced).toBe(true);
	});
});
