// Contract for the recording-pipeline guidance derivation (api/_lib/pipeline-summary.js).
//
// The endpoint and the /pipeline page both surface `health`, `summary`, and
// `next_action` from this pure function. These tests pin the "what should
// happen next" ladder so a regression can't silently tell an operator (or an
// agent reading /api/pipeline) the wrong move.

import { describe, it, expect } from 'vitest';
import { summarize, recorderState, MIN_TRAINING_SAMPLES, HEARTBEAT_FRESH_MS } from '../api/_lib/pipeline-summary.js';

/** Build a full stages object, overriding only what a case cares about. */
function stages(over = {}) {
	return {
		recorder: { state: 'live', mode: 'simulate', feedLive: true },
		intel: { observed_24h: 0, observed_1h: 0, avg_quality: null, smart_money_touched: 0 },
		outcomes: { labeled: 0, graduated: 0, rugged: 0, pumped: 0 },
		oracle: { scored_total: 0, scored_24h: 0, prime: 0, strong: 0, open_actions: 0 },
		reputation: { wallets: 0, smart_money: 0 },
		learning: { sample_size: 0, trained_at: null, weights: [] },
		trading: { strategies_armed: 0, open_positions: 0, snipes_24h: 0, trades_24h: 0 },
		...over,
	};
}

describe('pipeline summarize() — health', () => {
	it('is idle when the recorder is not live', () => {
		expect(summarize('mainnet', stages({ recorder: { state: 'offline' } })).health).toBe('idle');
		expect(summarize('mainnet', stages({ recorder: { state: 'down' } })).health).toBe('idle');
	});

	it('is recording when the worker is live but no launches in the last hour', () => {
		const r = summarize('mainnet', stages({ recorder: { state: 'live' }, intel: { observed_1h: 0 } }));
		expect(r.health).toBe('recording');
	});

	it('is flowing when the worker is live and launches are arriving', () => {
		const r = summarize('mainnet', stages({ recorder: { state: 'live' }, intel: { observed_1h: 3 } }));
		expect(r.health).toBe('flowing');
	});
});

describe('pipeline summarize() — next_action ladder', () => {
	it('a cold recorder blocks everything → deploy_recorder (with command)', () => {
		for (const state of ['offline', 'down', 'unknown']) {
			const na = summarize('mainnet', stages({ recorder: { state } })).next_action;
			expect(na.step).toBe('deploy_recorder');
			expect(na.command).toBe('npm run deploy:sniper');
		}
	});

	it('a live-but-silent feed → check_feed', () => {
		const na = summarize('mainnet', stages({ recorder: { state: 'degraded' } })).next_action;
		expect(na.step).toBe('check_feed');
	});

	it('recording but under the training threshold → accumulate (no action)', () => {
		const na = summarize('mainnet', stages({
			recorder: { state: 'live' }, intel: { observed_1h: 2 },
			outcomes: { labeled: MIN_TRAINING_SAMPLES - 1 },
		})).next_action;
		expect(na.step).toBe('accumulate');
		expect(na.command).toBeUndefined();
	});

	it('enough labels but no trained weights yet → await_training', () => {
		const na = summarize('mainnet', stages({
			recorder: { state: 'live' }, intel: { observed_1h: 2 },
			outcomes: { labeled: MIN_TRAINING_SAMPLES }, learning: { sample_size: 0 },
		})).next_action;
		expect(na.step).toBe('await_training');
	});

	it('trained but no agents armed → arm_agents (with command)', () => {
		const na = summarize('mainnet', stages({
			recorder: { state: 'live' }, intel: { observed_1h: 2 },
			outcomes: { labeled: 120 }, learning: { sample_size: 120 },
			trading: { strategies_armed: 0 },
		})).next_action;
		expect(na.step).toBe('arm_agents');
		expect(na.command).toBe('POST /api/sniper/strategy');
	});

	it('fully wired loop → running', () => {
		const na = summarize('mainnet', stages({
			recorder: { state: 'live' }, intel: { observed_1h: 5 },
			outcomes: { labeled: 200 }, learning: { sample_size: 200 },
			trading: { strategies_armed: 3, snipes_24h: 4 },
		})).next_action;
		expect(na.step).toBe('running');
	});
});

describe('pipeline summarize() — summary string', () => {
	it('names the network and is non-empty in every health state', () => {
		for (const recorder of [{ state: 'offline' }, { state: 'live' }]) {
			const r = summarize('devnet', stages({ recorder, intel: { observed_1h: recorder.state === 'live' ? 1 : 0 } }));
			expect(r.summary).toContain('devnet');
			expect(r.summary.length).toBeGreaterThan(20);
		}
	});
});

describe('recorderState(): the recorder is network-scoped', () => {
	const NOW = Date.parse('2026-09-09T00:00:00.000Z');
	const beat = (over = {}, meta = {}) => ({
		mode: 'live',
		last_beat_at: new Date(NOW - 5_000).toISOString(),
		meta: { network: 'mainnet', feedConnected: true, lastEventAgeMs: 2_000, ...meta },
		...over,
	});

	it('reports a mainnet worker as live when mainnet is what was asked', () => {
		const r = recorderState(beat(), 'mainnet', NOW);
		expect(r.state).toBe('live');
		expect(r.feedLive).toBe(true);
		expect(r.reason).toBeNull();
	});

	it('never lends one network\'s liveness to the other', () => {
		// bot_heartbeat is keyed by worker alone, so the devnet view of a mainnet
		// worker used to read LIVE and made every downstream devnet stage claim it
		// was "waiting on the next launch".
		const r = recorderState(beat(), 'devnet', NOW);
		expect(r.state).toBe('offline');
		expect(r.reason).toBe('recording mainnet, not devnet');
		expect(r.feedLive).toBe(false);
		expect(r.network).toBe('mainnet');
	});

	it('a heartbeat older than the freshness window is down', () => {
		const stale = beat({ last_beat_at: new Date(NOW - HEARTBEAT_FRESH_MS - 1_000).toISOString() });
		const r = recorderState(stale, 'mainnet', NOW);
		expect(r.state).toBe('down');
		expect(r.reason).toBe('heartbeat stale');
	});

	it('a fresh beat with a silent feed is degraded, and says which kind', () => {
		const silent = recorderState(beat({}, { lastEventAgeMs: 600_000 }), 'mainnet', NOW);
		expect(silent.state).toBe('degraded');
		expect(silent.reason).toBe('feed silent');

		const cut = recorderState(beat({}, { feedConnected: false }), 'mainnet', NOW);
		expect(cut.state).toBe('degraded');
		expect(cut.reason).toBe('feed disconnected');
	});

	it('no row at all is an honest offline, not a crash', () => {
		expect(recorderState(undefined, 'mainnet', NOW)).toEqual({ state: 'offline', reason: 'never started' });
	});

	it('a row with no network in meta is not second-guessed', () => {
		const r = recorderState(beat({}, { network: undefined }), 'devnet', NOW);
		expect(r.state).toBe('live');
	});

	it('feeds summarize(): a cross-network recorder makes the loop idle', () => {
		const rec = recorderState(beat(), 'devnet', NOW);
		const out = summarize('devnet', stages({ recorder: rec }));
		expect(out.health).toBe('idle');
		expect(out.next_action.step).toBe('deploy_recorder');
	});
});
