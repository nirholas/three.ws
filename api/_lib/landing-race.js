// Landing race: send one signed transaction through several providers at once,
// resolve on the first real confirmation, and remember who lands.
//
// Three parts, all provider-agnostic:
//
//   raceLanes     runs a list of lanes concurrently with the SAME signature.
//                 Solana dedupes by signature, so the lanes are one transaction
//                 with several doors: the first lane to report a confirmed
//                 landing wins, the rest are aborted and counted as outpaced,
//                 and exactly one result is returned. A hard on-chain revert
//                 reported by any lane is terminal for all of them.
//
//   LandingStats  per provider landed / lost / outpaced counters, a latency
//                 average and a failure streak. The race orders lanes by recent
//                 success. A provider on a failure streak is skipped until a
//                 cheap health probe passes (the same lane-health pattern the
//                 generation lanes use), so a dead endpoint costs no latency.
//                 Counters persist through an optional store (landing_provider_stats).
//
//   rpcLane       a JSON-RPC provider lane: sendTransaction to the provider,
//                 then poll the provider's own getSignatureStatuses, so a slow
//                 provider genuinely loses instead of borrowing another's answer.

const FAIL_STREAK_LIMIT = 3;
const PROBE_INTERVAL_MS = 30_000;
const STATS_TTL_MS = 60_000;
const LATENCY_ALPHA = 0.3;
const RPC_POLL_MS = 400;
const RPC_REQUEST_TIMEOUT_MS = 8_000;

const COMMITMENT_OK = new Set(['confirmed', 'finalized']);

// ── stats ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {object} StatsRow
 * @property {number} landed
 * @property {number} lost       errored, or finished without landing
 * @property {number} outpaced   was still racing when another lane landed
 * @property {number} streak     consecutive losses since the last landing or passed probe
 * @property {number|null} latencyMs  moving average send-to-landing latency
 * @property {string|null} lastError
 * @property {number} lastProbeAt
 */

export class LandingStats {
	/**
	 * @param {object} o
	 * @param {'mainnet'|'devnet'} o.network
	 * @param {{ load: (network:string)=>Promise<Record<string,StatsRow>>,
	 *           flush: (network:string, deltas:Record<string,object>)=>Promise<void> } | null} [o.store]
	 * @param {() => number} [o.now]
	 */
	constructor({ network, store = null, now = Date.now }) {
		this.network = network;
		this.store = store;
		this.now = now;
		/** @type {Map<string, StatsRow>} */
		this.rows = new Map();
		/** @type {Map<string, {landed:number,lost:number,outpaced:number}>} */
		this.pending = new Map();
		this.hydratedAt = 0;
	}

	row(name) {
		let r = this.rows.get(name);
		if (!r) {
			r = { landed: 0, lost: 0, outpaced: 0, streak: 0, latencyMs: null, lastError: null, lastProbeAt: 0 };
			this.rows.set(name, r);
		}
		return r;
	}

	delta(name) {
		let d = this.pending.get(name);
		if (!d) {
			d = { landed: 0, lost: 0, outpaced: 0 };
			this.pending.set(name, d);
		}
		return d;
	}

	/** Load persisted counters once per TTL. A store failure leaves in-memory stats in force. */
	async hydrate() {
		if (!this.store || this.now() - this.hydratedAt < STATS_TTL_MS) return;
		this.hydratedAt = this.now();
		try {
			const loaded = await this.store.load(this.network);
			for (const [name, persisted] of Object.entries(loaded || {})) {
				const local = this.row(name);
				const pending = this.pending.get(name) || { landed: 0, lost: 0, outpaced: 0 };
				local.landed = persisted.landed + pending.landed;
				local.lost = persisted.lost + pending.lost;
				local.outpaced = persisted.outpaced + pending.outpaced;
				if (!this.pending.has(name)) {
					local.streak = persisted.streak;
					local.latencyMs = persisted.latencyMs;
					local.lastError = persisted.lastError;
				}
			}
		} catch {
			// best effort: the race still runs on in-memory stats
		}
	}

	/** Landing score in (0,1): Laplace-smoothed success rate. Unknown providers start at 0.5. */
	score(name) {
		const r = this.rows.get(name);
		if (!r) return 0.5;
		return (r.landed + 1) / (r.landed + r.lost + 2);
	}

	/** Names sorted best-first: higher success, then lower latency. */
	rank(names) {
		return [...names].sort((a, b) => {
			const d = this.score(b) - this.score(a);
			if (Math.abs(d) > 1e-9) return d;
			return (this.rows.get(a)?.latencyMs ?? Infinity) - (this.rows.get(b)?.latencyMs ?? Infinity);
		});
	}

	/** True while a provider is on a failure streak and has not passed a probe since. */
	isSkipped(name) {
		const r = this.rows.get(name);
		return !!r && r.streak >= FAIL_STREAK_LIMIT;
	}

	/** A skipped provider is probed at most once per interval. */
	probeDue(name) {
		const r = this.rows.get(name);
		return !!r && r.streak >= FAIL_STREAK_LIMIT && this.now() - r.lastProbeAt >= PROBE_INTERVAL_MS;
	}

	recordLanded(name, latencyMs) {
		const r = this.row(name);
		r.landed += 1;
		r.streak = 0;
		r.lastError = null;
		r.latencyMs = r.latencyMs == null ? latencyMs : Math.round(r.latencyMs * (1 - LATENCY_ALPHA) + latencyMs * LATENCY_ALPHA);
		this.delta(name).landed += 1;
	}

	recordLost(name, err) {
		const r = this.row(name);
		r.lost += 1;
		r.streak += 1;
		r.lastError = String(err?.code || err?.message || err || 'not_landed').slice(0, 200);
		this.delta(name).lost += 1;
	}

	recordOutpaced(name) {
		this.row(name).outpaced += 1;
		this.delta(name).outpaced += 1;
	}

	/**
	 * Run a provider's probe. A pass clears the streak so the provider rejoins the
	 * race on the next trade; a fail restarts the probe interval.
	 */
	async probe(name, probeFn) {
		const r = this.row(name);
		r.lastProbeAt = this.now();
		try {
			await probeFn();
			r.streak = 0;
			r.lastError = null;
			this.delta(name);
			return true;
		} catch (e) {
			r.lastError = `probe: ${String(e?.code || e?.message || e).slice(0, 180)}`;
			return false;
		}
	}

	/** Persist accumulated deltas. Best effort; a failed flush keeps the deltas for the next one. */
	async flush() {
		if (!this.store || this.pending.size === 0) return;
		const batch = {};
		for (const [name, d] of this.pending) {
			const r = this.rows.get(name);
			batch[name] = { ...d, streak: r?.streak ?? 0, latencyMs: r?.latencyMs ?? null, lastError: r?.lastError ?? null };
		}
		try {
			await this.store.flush(this.network, batch);
			this.pending.clear();
		} catch {
			// keep the deltas; the next flush retries them
		}
	}

	/** Serializable view for the stats table and the endpoint. */
	snapshot() {
		return [...this.rows.entries()].map(([name, r]) => ({
			provider: name,
			landed: r.landed,
			lost: r.lost,
			outpaced: r.outpaced,
			streak: r.streak,
			skipped: r.streak >= FAIL_STREAK_LIMIT,
			successRate: Number(this.score(name).toFixed(3)),
			latencyMs: r.latencyMs,
			lastError: r.lastError,
		}));
	}
}

/**
 * Postgres store for the stats. `run(text, params)` resolves to an array of rows,
 * so it works with the Neon client (`sql.query`) and with an in-process Postgres.
 */
export function createSqlStatsStore(run) {
	return {
		async load(network) {
			const rows = await run(
				`select provider, landed, lost, outpaced, streak, latency_ms, last_error
				   from landing_provider_stats where network = $1`,
				[network],
			);
			const out = {};
			for (const r of rows) {
				out[r.provider] = {
					landed: Number(r.landed),
					lost: Number(r.lost),
					outpaced: Number(r.outpaced),
					streak: Number(r.streak),
					latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
					lastError: r.last_error,
					lastProbeAt: 0,
				};
			}
			return out;
		},
		async flush(network, deltas) {
			for (const [provider, d] of Object.entries(deltas)) {
				await run(
					`insert into landing_provider_stats
					   (provider, network, landed, lost, outpaced, streak, latency_ms, last_error, last_landed_at, updated_at)
					 values ($1, $2, $3, $4, $5, $6, $7, $8, case when $3 > 0 then now() end, now())
					 on conflict (provider, network) do update set
					   landed = landing_provider_stats.landed + excluded.landed,
					   lost = landing_provider_stats.lost + excluded.lost,
					   outpaced = landing_provider_stats.outpaced + excluded.outpaced,
					   streak = excluded.streak,
					   latency_ms = coalesce(excluded.latency_ms, landing_provider_stats.latency_ms),
					   last_error = excluded.last_error,
					   last_landed_at = coalesce(excluded.last_landed_at, landing_provider_stats.last_landed_at),
					   updated_at = now()`,
					[provider, network, d.landed, d.lost, d.outpaced, d.streak, d.latencyMs, d.lastError],
				);
			}
		},
	};
}

// ── race ──────────────────────────────────────────────────────────────────────

/**
 * Race lanes carrying the same signed transaction.
 *
 * A lane is `{ name, run(signal) }` and resolves `{ landed, slot }`. It may throw:
 * an error with `code: 'TX_ERR'` is an on-chain revert and ends the race for
 * everyone; any other error is that lane's loss only.
 *
 * @returns {Promise<{ winner: {name:string, slot:number|null, ms:number}|null,
 *   lanes: Array<{name:string, outcome:'landed'|'lost'|'outpaced', ms:number, error:string|null}> }>}
 */
export async function raceLanes({ lanes, stats = null, now = Date.now }) {
	const startedAt = now();
	const controller = new AbortController();
	const report = lanes.map((l) => ({ name: l.name, outcome: /** @type {'landed'|'lost'|'outpaced'|null} */ (null), ms: 0, error: null }));
	let winner = null;
	let revert = null;

	await new Promise((resolve) => {
		let open = lanes.length;
		if (open === 0) return resolve();
		const finish = () => {
			open -= 1;
			if (open === 0) resolve();
		};
		lanes.forEach((lane, i) => {
			const settled = () => report[i].outcome !== null;
			Promise.resolve()
				.then(() => lane.run(controller.signal))
				.then((res) => {
					if (settled()) return;
					report[i].ms = now() - startedAt;
					if (res?.landed && !winner && !revert) {
						winner = { name: lane.name, slot: res.slot ?? null, ms: report[i].ms };
						report[i].outcome = 'landed';
						stats?.recordLanded(lane.name, report[i].ms);
						controller.abort();
						resolve();
					} else if (res?.landed) {
						report[i].outcome = 'outpaced';
						stats?.recordOutpaced(lane.name);
					} else {
						report[i].outcome = 'lost';
						report[i].error = 'not_landed';
						stats?.recordLost(lane.name, 'not_landed');
					}
				})
				.catch((err) => {
					if (settled()) return;
					report[i].ms = now() - startedAt;
					if (winner) {
						report[i].outcome = 'outpaced';
						stats?.recordOutpaced(lane.name);
						return;
					}
					report[i].outcome = 'lost';
					report[i].error = String(err?.code || err?.message || err).slice(0, 200);
					if (err?.code === 'TX_ERR') {
						revert = err;
						controller.abort();
						resolve();
						return;
					}
					stats?.recordLost(lane.name, err);
				})
				.finally(finish);
		});
	});

	// Lanes still in flight when the race ended were outpaced, not failures.
	report.forEach((r, i) => {
		if (r.outcome === null) {
			r.outcome = 'outpaced';
			r.ms = now() - startedAt;
			stats?.recordOutpaced(lanes[i].name);
		}
	});
	if (revert) throw revert;
	return { winner, lanes: report };
}

// ── JSON-RPC provider lane ────────────────────────────────────────────────────

async function rpcCall(url, method, params, signal, timeoutMs = RPC_REQUEST_TIMEOUT_MS) {
	const timeout = AbortSignal.timeout(timeoutMs);
	const resp = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
		signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
	});
	if (!resp.ok) {
		const err = new Error(`${method} http ${resp.status}`);
		err.code = 'LANDING_HTTP';
		throw err;
	}
	const body = await resp.json();
	if (body.error) {
		const err = new Error(`${method}: ${body.error.message || JSON.stringify(body.error)}`);
		err.code = 'LANDING_RPC';
		throw err;
	}
	return body.result;
}

function sleepAbortable(ms, signal) {
	return new Promise((resolve) => {
		const t = setTimeout(resolve, ms);
		signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
	});
}

/**
 * A lane that submits through a JSON-RPC endpoint and confirms against that same
 * endpoint. `rawTx` is the serialized signed transaction.
 */
export function rpcLane({ name, url, rawTx, signature, confirmTimeoutMs = 45_000 }) {
	const b64 = Buffer.from(rawTx).toString('base64');
	return {
		name,
		async run(signal) {
			await rpcCall(url, 'sendTransaction', [b64, { encoding: 'base64', skipPreflight: true, maxRetries: 0 }], signal);
			const deadline = Date.now() + confirmTimeoutMs;
			while (Date.now() < deadline && !signal?.aborted) {
				const result = await rpcCall(url, 'getSignatureStatuses', [[signature], { searchTransactionHistory: false }], signal);
				const st = result?.value?.[0];
				if (st?.err) {
					const e = new Error(`tx failed on-chain: ${JSON.stringify(st.err)}`);
					e.code = 'TX_ERR';
					throw e;
				}
				if (st && COMMITMENT_OK.has(st.confirmationStatus)) return { landed: true, slot: st.slot ?? null };
				await sleepAbortable(RPC_POLL_MS, signal);
			}
			return { landed: false, slot: null };
		},
	};
}

/** Cheap liveness check for an rpc provider. Throws when the endpoint is not healthy. */
export function rpcProbe(url) {
	return async () => {
		const r = await rpcCall(url, 'getLatestBlockhash', [{ commitment: 'confirmed' }], null, 3_000);
		if (!r?.value?.blockhash) throw Object.assign(new Error('no blockhash'), { code: 'LANDING_PROBE' });
	};
}

// ── per-network singleton stats ───────────────────────────────────────────────

const _stats = new Map();

/** Shared stats for a network, persisted to Postgres when a database is configured. */
export function getLandingStats(network, store = defaultStore()) {
	let s = _stats.get(network);
	if (!s) {
		s = new LandingStats({ network, store });
		_stats.set(network, s);
	}
	return s;
}

let _defaultStore;
function defaultStore() {
	if (_defaultStore !== undefined) return _defaultStore;
	_defaultStore = null;
	if (process.env.DATABASE_URL) {
		_defaultStore = {
			async load(network) {
				const { sql } = await import('./db.js');
				return createSqlStatsStore((t, p) => sql(t, p)).load(network);
			},
			async flush(network, deltas) {
				const { sql } = await import('./db.js');
				return createSqlStatsStore((t, p) => sql(t, p)).flush(network, deltas);
			},
		};
	}
	return _defaultStore;
}

export const LANDING_TUNING = { FAIL_STREAK_LIMIT, PROBE_INTERVAL_MS };
