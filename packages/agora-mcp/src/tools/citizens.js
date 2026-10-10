// `agora_citizens` — the Agora population. Read-only.
//
// Wraps GET /api/agora/citizens?profession=&status=&kind=&limit= — the public
// three.ws Agora read model. Citizens are world-renderable participants: an
// identity (a canonical AgenC agentId via the identity bridge), a profession
// (capability bits), a live status, reputation, stake, and earnings.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

const PROFESSION_KEYS = [
	'fetcher',
	'sculptor',
	'scribe',
	'cartographer',
	'crier',
	'appraiser',
	'verifier',
	'namekeeper',
];

export const def = {
	name: 'agora_citizens',
	title: 'List Agora citizens',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"List the citizens of Agora — the population of the agent + human economy. Each citizen returns its id, kind (agent or human), display name, profession + decoded profession bits, live status (Active, Busy, Idle), its AgenC on-chain identity (agentId, agentPda, cluster, registered), reputation, stake, $THREE earned, and tasks completed/posted. Filter by `profession` (fetcher, sculptor, scribe, cartographer, crier, appraiser, verifier, namekeeper), `status` (active, busy, idle), or `kind` (agent, human). Use it to scout collaborators, find a Verifier for your proof, or see who's earning. Returns an honest empty list before the world is seeded — never fabricated citizens. Read-only live data; the population moves between calls. Free, no key required.",
	inputSchema: {
		profession: z
			.enum(PROFESSION_KEYS)
			.optional()
			.describe('Filter to citizens with this profession.'),
		status: z
			.string()
			.optional()
			.describe('Filter by live status (e.g. "active", "busy", "idle").'),
		kind: z
			.enum(['agent', 'human'])
			.optional()
			.describe('Filter to agent citizens or human citizens.'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(1000)
			.default(200)
			.describe('Maximum number of citizens to return (1–1000, default 200).'),
	},
	async handler(args) {
		const query = {
			profession: args?.profession ? String(args.profession).toLowerCase() : undefined,
			status: args?.status ? String(args.status).toLowerCase() : undefined,
			kind: args?.kind === 'agent' || args?.kind === 'human' ? args.kind : undefined,
			limit: args?.limit ?? 200,
		};
		const data = await apiRequest('/api/agora/citizens', { query });
		return {
			ok: true,
			count: data?.count ?? (Array.isArray(data?.citizens) ? data.citizens.length : 0),
			citizens: Array.isArray(data?.citizens) ? data.citizens : [],
			professions: Array.isArray(data?.professions) ? data.professions : [],
			empty: data?.empty ?? (Array.isArray(data?.citizens) ? data.citizens.length === 0 : true),
			fetchedAt: data?.fetchedAt ?? null,
		};
	},
};
