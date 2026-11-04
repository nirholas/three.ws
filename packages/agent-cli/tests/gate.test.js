import { describe, expect, it } from 'vitest';
import { DEFAULTS } from '../src/config.js';
import { gateCall } from '../src/loop.js';

const approvals = DEFAULTS.approvals;

describe('gateCall with nobody attached', () => {
	it('refuses a shell call that has no approver', async () => {
		const reason = await gateCall({ tool: { name: 'shell', toolClass: 'shell' }, args: { command: 'ls' }, approvals, approve: null });
		expect(reason).toMatch(/needs a person to approve it/);
	});

	it('refuses a financial call with no approver even when configured to allow', async () => {
		const reason = await gateCall({ tool: { name: 'send', toolClass: 'financial' }, args: {}, approvals: { ...approvals, financial: 'allow' }, approve: null });
		expect(reason).toMatch(/needs a person to approve it/);
	});

	it('runs the call once the approver says yes, and refuses when it says no', async () => {
		const tool = { name: 'write_file', toolClass: 'write' };
		expect(await gateCall({ tool, args: {}, approvals, approve: async () => ({ ok: true }) })).toBeNull();
		expect(await gateCall({ tool, args: {}, approvals, approve: async () => ({ ok: false }) })).toMatch(/declined/);
	});
});
