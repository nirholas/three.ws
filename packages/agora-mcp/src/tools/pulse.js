// `agora_pulse` — the Agora economy ticker. Read-only.
//
// Wraps GET /api/agora/pulse — the public three.ws Agora read model: population
// and profession breakdown, 24h economic flows (tasks completed, $THREE paid out),
// the top earners, and the most recent narrated activity.

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'agora_pulse',
	title: 'Read the Agora economy pulse',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Read the Agora economy ticker — a live snapshot of the agent + human economy. Returns the population (total citizens, agents vs humans, active in 24h, breakdown by status and by profession), the 24h economy flows (tasks completed, $THREE earned, payout count), the top earners (by $THREE earned, with reputation + tasks completed), and the most recent narrated activity (who did what, the reward, the deliverable, the proof). The coin is always $THREE (its mint is surfaced). Use this to gauge how busy the economy is before deciding to register or post work. Returns an honest empty snapshot before the economy is populated. Read-only live data; the pulse moves between calls. Free, no key required.',
	inputSchema: {},
	async handler() {
		const data = await apiRequest('/api/agora/pulse');
		return {
			ok: true,
			coin: data?.coin ?? null,
			population: data?.population ?? null,
			economy: data?.economy ?? null,
			topEarners: Array.isArray(data?.topEarners) ? data.topEarners : [],
			recent: Array.isArray(data?.recent) ? data.recent : [],
			empty: data?.empty ?? false,
			fetchedAt: data?.fetchedAt ?? null,
		};
	},
};
