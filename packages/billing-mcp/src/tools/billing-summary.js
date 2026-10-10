// `get_billing_summary` — your plan, its quotas, and current usage against them.
// Account-scoped (session). Read-only.
//
// Wraps GET /api/billing/summary. The route resolves the caller from the
// three.ws session and returns the plan tier, the quota ceilings for that tier,
// and the live usage roll-ups counted against them (avatars + storage bytes,
// agents, MCP tool calls in the last 24h, LLM calls this month). This is the
// "how much of my plan have I used?" call.

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_billing_summary',
	title: 'My plan, quotas, and current usage',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Your account\'s plan tier, the quota ceilings for that tier, and live usage measured against them — the ' +
		'"how much of my plan is left?" call. Returns `plan` (e.g. free | pro), `quotas` (max_avatars, ' +
		'max_bytes_per_avatar, max_total_bytes, mcp_calls_per_day — or null when the tier has no metered ceilings), ' +
		'and `usage` (avatar_count, total_bytes of avatar storage, agent_count, mcp_calls_24h tool calls in the last ' +
		'24 hours, llm_calls_month LLM calls since the start of this UTC month). Each tool returns a `remaining` map ' +
		'computed from quotas − usage so an agent can see headroom at a glance. Resolved from your three.ws session; ' +
		'requires THREE_WS_SESSION. Read-only. ' +
		'Use this before a heavy job to check how much of the plan is left; for what you were charged call query_usage.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/billing/summary', { auth: true });
		const quotas = data?.quotas ?? null;
		const usage = data?.usage ?? {};

		// Headroom: quota − usage, clamped at 0. null quota → unmetered (null remaining).
		const left = (cap, used) =>
			cap === null || cap === undefined ? null : Math.max(0, Number(cap) - Number(used || 0));

		return {
			ok: true,
			plan: data?.plan ?? 'free',
			quotas,
			usage: {
				avatar_count: usage.avatar_count ?? 0,
				total_bytes: usage.total_bytes ?? 0,
				agent_count: usage.agent_count ?? 0,
				mcp_calls_24h: usage.mcp_calls_24h ?? 0,
				llm_calls_month: usage.llm_calls_month ?? 0,
			},
			remaining: {
				avatars: left(quotas?.max_avatars, usage.avatar_count),
				total_bytes: left(quotas?.max_total_bytes, usage.total_bytes),
				mcp_calls_today: left(quotas?.mcp_calls_per_day, usage.mcp_calls_24h),
			},
		};
	},
};
