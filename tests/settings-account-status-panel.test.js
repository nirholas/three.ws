// @vitest-environment jsdom
//
// GET /api/v1/me/status answers { data: {...}, meta }. The settings page wraps the
// parsed body as { ok, data: body }, so the panel receives the envelope one level
// down. It read resp.data directly and threw "Cannot read properties of undefined
// (reading 'api_calls_reset_at')" on a live account, leaving Settings blank.
import { describe, it, expect } from 'vitest';
import { renderAccountStatus } from '../src/dashboard-next/pages/settings-account-status.js';

const status = {
	userId: 'u1',
	plan: { account: 'free', api: { id: 'free', name: 'Free', manage_url: 'https://three.ws/dashboard/developers' } },
	limits: { api_calls_per_period: 10000, burst_per_minute: 60, concurrent: 4, free_chat_per_day: 100 },
	remaining: { api_calls: 9990, api_calls_reset_at: '2026-12-10T00:00:00.000Z', free_chat_messages: 100 },
	agents: { count: 1, url: 'https://three.ws/agents' },
	wallet: { provisioned: false, spend_enabled: false },
	approvals: { pending: 2, url: 'https://three.ws/approvals' },
};

describe('renderAccountStatus', () => {
	it('renders the enveloped /me/status response the settings page passes in', () => {
		const panel = renderAccountStatus({ ok: true, data: { data: status, meta: {} } }, () => {});
		expect(panel.textContent).toContain('Free plan');
		expect(panel.textContent).toContain('2 approvals waiting');
	});
});
