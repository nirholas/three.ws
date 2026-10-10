// `get_portfolio_history` — the time series of total portfolio USD value from
// stored snapshots. Account-scoped (session). Read-only.
//
// Wraps GET /api/portfolio/history?days=. Each point is a snapshot persisted by
// a prior get_portfolio_summary(snapshot:true) (or the website's auto-capture).

import { z } from 'zod';

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'get_portfolio_history',
	title: 'My portfolio value over time',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		'Time series of your total portfolio USD value, oldest point first, for charting performance over time. ' +
		'Returns `points` as { t (ISO timestamp), usd } pairs, drawn from snapshots persisted by ' +
		'get_portfolio_summary(snapshot:true) or the website. An empty `points` array means no snapshots have been ' +
		'captured yet in the window — take one with get_portfolio_summary(snapshot:true) to start the series. ' +
		'Use this to chart or describe performance over time; for the current value call get_portfolio_summary. ' +
		'Requires THREE_WS_SESSION. Read-only.',
	inputSchema: {
		days: z
			.number()
			.int()
			.min(1)
			.max(365)
			.default(90)
			.describe('How many days of history to return, 1–365 (default 90).'),
	},
	async handler(args) {
		const data = await apiRequest('/api/portfolio/history', {
			auth: true,
			query: { days: args?.days ?? 90 },
		});
		const points = Array.isArray(data?.points) ? data.points : [];
		return {
			ok: true,
			days: data?.days ?? args?.days ?? 90,
			point_count: points.length,
			points,
		};
	},
};
