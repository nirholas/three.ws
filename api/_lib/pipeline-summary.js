// @ts-check
/**
 * Pure derivation of the recording pipeline's health, one-line summary, and the
 * single most useful next action — given the per-stage stats gathered by
 * api/pipeline.js. Kept dependency-free (no DB, no HTTP) so it is trivially
 * unit-testable and so both the endpoint and any caller share one source of
 * truth for "what does this state mean and what should happen next".
 *
 * The next-action ladder is ordered by where the loop is actually blocked:
 * a cold recorder blocks everything; a silent feed blocks recording; too few
 * labeled outcomes blocks learning; no trained weights blocks informed trading;
 * no armed agents blocks trading entirely. Passive states ("accumulating",
 * "awaiting training", "running") carry no operator action.
 */

/** Number of labeled outcomes the learner needs before it trains weights. */
export const MIN_TRAINING_SAMPLES = 50;

/**
 * Freshness window for the recorder's heartbeat: 2x the 30s cadence plus slack,
 * so one skipped beat under load cannot flap it between "live" and "down".
 */
export const HEARTBEAT_FRESH_MS = 90_000;

/**
 * Derive the recorder's operational truth from its bot_heartbeat row.
 *
 * bot_heartbeat is keyed by worker alone, so a single row describes whichever
 * network that worker is actually recording. Asking about the other network
 * must not inherit its liveness: a mainnet worker is honestly "offline" from
 * devnet's point of view, and reporting otherwise made every downstream devnet
 * stage read as "waiting on the next launch" when nothing was ever recording.
 *
 * @param {any} beat        the bot_heartbeat row, or undefined
 * @param {string} network  the network the caller asked about
 * @param {number} [now]    epoch ms, injectable for tests
 */
export function recorderState(beat, network, now = Date.now()) {
	if (!beat) return { state: 'offline', reason: 'never started' };
	const lastBeatMs = beat.last_beat_at ? new Date(beat.last_beat_at).getTime() : 0;
	const ageMs = lastBeatMs ? now - lastBeatMs : null;
	const alive = ageMs != null && ageMs < HEARTBEAT_FRESH_MS;
	const meta = beat.meta && typeof beat.meta === 'object' ? beat.meta : {};
	if (meta.network && meta.network !== network) {
		return {
			state: 'offline',
			reason: `recording ${meta.network}, not ${network}`,
			mode: beat.mode || meta.mode || 'unknown',
			network: meta.network,
			feedLive: false,
			feedSilent: false,
			heartbeatAgeMs: ageMs,
			lastEventAgeMs: null,
			reconnects: null,
			errors: null,
			lastError: null,
			intel: null,
			bootAt: meta.bootAt ?? null,
		};
	}
	const feedLive = alive && meta.feedConnected === true;
	const watchdogMs = Number(meta.feedWatchdogMs) || 180_000;
	const feedSilent = alive && Number(meta.lastEventAgeMs) > watchdogMs;
	const state = !alive ? 'down' : feedSilent || !feedLive ? 'degraded' : 'live';
	return {
		state,
		reason: state === 'down' ? 'heartbeat stale' : state === 'degraded' ? (feedLive ? 'feed silent' : 'feed disconnected') : null,
		mode: beat.mode || meta.mode || 'unknown',
		network: meta.network || null,
		feedLive,
		feedSilent: !!feedSilent,
		heartbeatAgeMs: ageMs,
		lastEventAgeMs: meta.lastEventAgeMs ?? null,
		reconnects: meta.reconnects ?? null,
		errors: meta.errors ?? null,
		lastError: meta.lastError ?? null,
		intel: meta.intel ?? null,
		bootAt: meta.bootAt ?? null,
	};
}

/**
 * @param {string} network
 * @param {{recorder:any,intel:any,outcomes:any,oracle:any,reputation:any,learning:any,trading:any}} stages
 * @returns {{health:'flowing'|'recording'|'idle', summary:string, next_action:{step:string,label:string,detail:string,command?:string}}}
 */
export function summarize(network, stages) {
	const { recorder, intel, outcomes, oracle, trading } = stages;

	const recording = recorder.state === 'live';
	const flowing = (intel.observed_1h ?? 0) > 0;
	const health = recording && flowing ? 'flowing' : recording ? 'recording' : 'idle';

	const next_action = nextAction(stages);

	const summary = health === 'flowing'
		? `Pipeline flowing on ${network}: ${intel.observed_1h} launches recorded in the last hour, ${oracle.scored_total} scored, ${outcomes.labeled} outcomes labeled, ${trading.strategies_armed} agents armed.`
		: health === 'recording'
		? `Recorder live on ${network} but no launches in the last hour. ${outcomes.labeled} outcomes labeled so far.`
		: `Pipeline idle on ${network}: the recorder worker is ${recorder.state}. Nothing downstream can run until it records launches.`;

	return { health, summary, next_action };
}

/** @param {any} stages */
function nextAction({ recorder, outcomes, learning, trading }) {
	const s = recorder.state;
	if (s === 'offline' || s === 'down' || s === 'unknown') {
		return {
			step: 'deploy_recorder',
			label: 'Deploy the recorder worker',
			detail: 'The always-on agent-sniper worker is not reporting a heartbeat. Deploy it in simulate mode to begin recording every launch — zero SOL spent.',
			command: 'npm run deploy:sniper',
		};
	}
	if (s === 'degraded') {
		return {
			step: 'check_feed',
			label: 'Recover the feed',
			detail: 'The worker is alive but its pump.fun feed has gone silent — no launches are being recorded. Check the worker logs and RPC/PumpPortal connectivity.',
		};
	}
	if ((outcomes.labeled ?? 0) < MIN_TRAINING_SAMPLES) {
		return {
			step: 'accumulate',
			label: 'Let the dataset mature',
			detail: `Recording is live. ${outcomes.labeled}/${MIN_TRAINING_SAMPLES} outcomes labeled — the learner trains once enough launches resolve. No action needed; data is accumulating.`,
		};
	}
	if ((learning.sample_size ?? 0) === 0) {
		return {
			step: 'await_training',
			label: 'Awaiting first training pass',
			detail: 'Enough outcomes are labeled; the next learning pass will train per-signal weights. No action needed.',
		};
	}
	if ((trading.strategies_armed ?? 0) === 0) {
		return {
			step: 'arm_agents',
			label: 'Arm agents on the signal',
			detail: 'The loop has trained weights and conviction scores. Arm sniper strategies (gated on Oracle conviction + smart money) to trade on the data.',
			command: 'POST /api/sniper/strategy',
		};
	}
	return {
		step: 'running',
		label: 'Loop is running end to end',
		detail: 'Recording, scoring, learning, and trading are all active. Monitor outcomes and tune strategy filters.',
	};
}
