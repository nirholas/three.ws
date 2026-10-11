// Builds the machine-readable capability document served by
// GET /api/v1/capabilities. Everything is derived at request time from the
// registries that actually enforce it, so the document cannot drift:
//   tools + groups + tiers + confirm/preview rules  packages/mcp-policy (POLICY, GROUPS)
//   per-call prices                                  api/_lib/pump-pricing.js (TOOL_PRICING)
//   plan limits + API rate limits                    data/plans.json
//   owner-approval rules                             api/_lib/approvals.js

import { readFileSync } from 'node:fs';
import { POLICY, SERVERS, GROUPS, normalizeEntry } from '@three-ws/mcp-policy';
import { TOOL_PRICING } from './pump-pricing.js';
import { AUTO_POLICY_MAX_USD } from './approvals.js';

const PLANS = JSON.parse(readFileSync(new URL('../../data/plans.json', import.meta.url), 'utf8'));

export function buildCapabilities() {
	/** @type {Map<string, object>} */
	const tools = new Map();
	for (const [serverId, table] of Object.entries(POLICY)) {
		if (!SERVERS[serverId]?.endpoint?.startsWith('/api/')) continue;
		for (const [name, row] of Object.entries(table)) {
			const entry = normalizeEntry(name, row);
			const prior = tools.get(name);
			if (prior) {
				if (!prior.servers.includes(serverId)) prior.servers.push(serverId);
				continue;
			}
			const price = TOOL_PRICING[name];
			tools.set(name, {
				name,
				group: entry.group,
				tier: entry.tier,
				requires: entry.tier === 'financial' ? { confirm_flag: entry.confirmFlag, preview_tool: entry.previewTool } : null,
				price: price ? { amount_usdc: price.amount_usdc, note: price.description } : null,
				servers: [serverId],
			});
		}
	}

	const groups = GROUPS.map((g) => {
		const members = [...tools.values()].filter((t) => t.group === g.id).sort((a, b) => a.name.localeCompare(b.name));
		return { id: g.id, label: g.label, summary: g.summary, tool_count: members.length, tools: members };
	}).filter((g) => g.tool_count > 0);

	return {
		groups,
		servers: Object.entries(SERVERS)
			.filter(([, s]) => s.endpoint?.startsWith('/api/'))
			.map(([id, s]) => ({ id, title: s.title, endpoint: s.endpoint, transport: s.transport })),
		tiers: {
			read: 'On by default. No state change.',
			write: 'On by default. Changes agent or account state, never moves funds.',
			financial: 'Off by default. Moves funds: needs the group enabled by the owner, a fresh preview from the named preview tool, and the named confirm flag on the call.',
		},
		approval_rules: {
			financial_tools: 'Every financial tool runs a preview first and the call must carry the confirm flag shown in `requires`.',
			owner_approval: `Spends the owner's policy marks "needs my approval" wait in the approvals inbox (/approvals) until the owner approves the exact action. Auto-approve policies are capped at $${AUTO_POLICY_MAX_USD} per action and never cover an address the wallet has never paid.`,
			self_signed_agents: 'An agent created through POST /api/v1/agents/signup runs in paper mode with a frozen wallet and a trade kill switch until a human claims it.',
		},
		plans: PLANS.plans.map((p) => ({
			id: p.id,
			name: p.name,
			price_usd: p.price_usd,
			limits: p.limits,
			rate_limit: p.rate_limit,
		})),
		sources: {
			tools: 'packages/mcp-policy',
			prices: 'api/_lib/pump-pricing.js',
			plans: 'data/plans.json',
			approvals: 'api/_lib/approvals.js',
		},
	};
}
