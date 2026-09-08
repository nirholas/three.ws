// POST /api/v1/hood-portfolios/backtest - what this basket would have done, and
// what its rebalancing schedule did to it.
//
// Every backtest runs the same basket twice: once rebalanced on the schedule the
// manifest published, and once never rebalanced. The difference is the only
// number that judges the schedule, and it goes both ways: rebalancing harvests
// swings in a basket that oscillates and gives up upside in one that trends.
//
// Coverage is reported honestly. A constituent with no price history is excluded
// and named, the remaining weights are renormalised, and `coveredWeightBps` says
// how much of the portfolio the result actually describes. Nothing is carried
// forward or interpolated to fill a gap.

import { defineEndpoint, fail } from '../../_lib/gateway.js';
import { rateLimited } from '../../_lib/http.js';
import { limits } from '../../_lib/rate-limit.js';
import { liveUniverse } from '../../_lib/hood-portfolios.js';
import { readSnapshots, tokenHistory } from '../../_lib/hood-portfolios-history.js';
import { backtest } from '../../_lib/hood-portfolios-backtest.js';

const MAX_LEGS = 12;

export default defineEndpoint({
	name: 'v1.hood-portfolios.backtest',
	method: 'POST',
	auth: 'optional',
	handler: async ({ res, body, ip, principal }) => {
		const rl = await limits.robinhoodRead(principal?.userId || ip);
		if (!rl.success) return rateLimited(res, rl, 'backtests are capped at 60 requests/min per caller');

		const raw = Array.isArray(body?.constituents) ? body.constituents : [];
		if (raw.length < 2) fail(400, 'bad_basket', 'supply at least two constituents as [{ address, weightBps }]');
		if (raw.length > MAX_LEGS) fail(400, 'bad_basket', `a portfolio holds at most ${MAX_LEGS} constituents`);

		const rebalanceDays = Math.max(0, Math.min(Number(body?.rebalanceDays) || 30, 365));
		const days = Math.max(7, Math.min(Number(body?.days) || 90, 365));

		const universe = await liveUniverse();
		const byAddress = new Map(universe.tokens.map((t) => [t.address, t]));

		const legs = [];
		// An address the universe does not know is reported, never quietly skipped:
		// silently backtesting two legs of a three-leg basket produces a number that
		// looks complete and describes something the caller never asked for.
		const unknown = [];
		for (const c of raw) {
			const address = String(c?.address || '').toLowerCase();
			const token = byAddress.get(address);
			const weightBps = Number(c?.weightBps);
			if (!Number.isFinite(weightBps) || weightBps <= 0) {
				unknown.push({ address, reason: 'weightBps must be a positive number' });
				continue;
			}
			if (!token) {
				unknown.push({ address, reason: 'not in the holdable universe on this chain' });
				continue;
			}
			legs.push({ token, weightBps: Math.round(weightBps) });
		}
		if (legs.length < 2) {
			fail(
				422,
				'unknown_constituents',
				`fewer than two constituents resolved to holdable tokens${unknown.length ? `: ${unknown.map((u) => `${u.address} (${u.reason})`).join('; ')}` : ''}`,
			);
		}

		// One snapshot read shared across every leg, rather than one per leg.
		const snapshots = await readSnapshots({ days });

		// Sequential on purpose. Each feed-backed leg is an 80-call multicall, and
		// firing several at this RPC concurrently makes most of them fail: a
		// three-equity basket read in parallel came back with one leg covered and
		// the other two reported as having no history at all.
		const histories = [];
		for (const leg of legs) {
			histories.push({ leg, history: await tokenHistory(leg.token, { days, snapshots }) });
		}

		const covered = [];
		const uncovered = [];
		const series = {};
		for (const { leg, history } of histories) {
			// Two points is the minimum that can express a return at all.
			if (history.closes.length >= 2) {
				covered.push({ ...leg, source: history.source, points: history.closes.length });
				series[leg.token.address] = history.closes;
			} else {
				uncovered.push({
					address: leg.token.address,
					symbol: leg.token.symbol,
					weightBps: leg.weightBps,
					reason:
						history.source === 'unavailable'
							? 'its Chainlink feed could not be read just now, so its history is temporarily unavailable'
							: leg.token.feed
								? 'its Chainlink feed returned no usable rounds'
								: 'it has no price feed, and the daily snapshot has not recorded it yet',
					temporary: history.source === 'unavailable',
				});
			}
		}

		const totalBps = legs.reduce((a, l) => a + l.weightBps, 0);
		const coveredBps = covered.reduce((a, l) => a + l.weightBps, 0);

		if (covered.length < 2) {
			return {
				ok: false,
				reason:
					'fewer than two constituents have price history yet. Equities are covered by their Chainlink feeds; every other token is covered from the day the daily snapshot first recorded it.',
				coveredWeightBps: coveredBps,
				totalWeightBps: totalBps,
				covered: covered.map((c) => ({ address: c.token.address, symbol: c.token.symbol, source: c.source })),
				uncovered,
				unknown,
			};
		}

		const result = backtest({
			legs: covered.map((c) => ({ address: c.token.address, weightBps: c.weightBps })),
			series,
			rebalanceDays,
			startValueUsd: 10_000,
		});

		res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
		return {
			...result,
			rebalanceDays,
			requestedDays: days,
			coveredWeightBps: coveredBps,
			totalWeightBps: totalBps,
			covered: covered.map((c) => ({
				address: c.token.address,
				symbol: c.token.symbol,
				weightBps: c.weightBps,
				source: c.source,
				points: c.points,
			})),
			uncovered,
			unknown,
			snapshotDays: snapshots.length,
		};
	},
});
