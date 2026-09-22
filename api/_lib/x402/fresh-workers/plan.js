// api/_lib/x402/fresh-workers/plan.js
//
// Pure planning for the fresh-wallet workers lane: config parsing, the SOL a
// brand-new wallet needs to pay one job and empty itself, which jobs a tick buys,
// whether the funders can afford them, and what to do with a wallet that was
// left mid-flight. No I/O, no signing, unit-tested on its own.
//
// The lane exists so that x402 volume comes from wallets that have never existed
// before, and so that every payment buys real work: a 3D prop for the /forged
// library or a dataset for the /data-desk page. The reused payer pool
// (../pool.js) amortizes USDC-ATA rent across many settles; this lane instead
// closes the token account the moment the job is done and hands the rent back,
// so a throwaway wallet costs three base fees and strands nothing.

// Solana constants. The rent-exempt minimum for a data-less system account is
// read live at runtime (getMinimumBalanceForRentExemption(0)); this is the
// mainnet value it has returned since 2021 and the fallback when RPC is dark.
export const RENT_EXEMPT_FALLBACK_LAMPORTS = 890_880;
// Rent locked by a classic SPL token account (matches self-facilitator.js).
export const ATA_RENT_LAMPORTS = 2_039_280;
// One signature at the base fee. The sweep transaction sets a zero priority
// price so its fee is exactly this, which is what makes an exact drain possible.
export const BASE_FEE_LAMPORTS = 5_000;

const num = (v, d) => {
	const n = Number(v);
	return Number.isFinite(n) && n >= 0 ? n : d;
};

/** Every knob of the lane, parsed from env with the defaults documented in .env.example. */
export function freshWorkersConfig(e = process.env) {
	return {
		// 'false' pauses the lane; anything else leaves it on. X402_AUTONOMOUS_ENABLED
		// is the global kill switch and is honored by the cron before this is read.
		enabled: String(e.X402_FRESH_WORKERS_ENABLED ?? 'true').trim().toLowerCase() !== 'false',
		// Fresh wallets minted (and jobs bought) per minute.
		perTick: Math.max(0, Math.floor(num(e.X402_FRESH_WORKERS_PER_TICK, 3))),
		// One of the tick's jobs is a paid Forge generation every N ticks; the rest
		// buy datasets. 10 -> ~144 new library props a day at 1 tick/min.
		forgeEveryNTicks: Math.max(1, Math.floor(num(e.X402_FRESH_WORKERS_FORGE_EVERY_N_TICKS, 10))),
		// USDC the lane may spend per UTC day (atomics). Recirculates to the treasury.
		dailyCapAtomic: Math.floor(num(e.X402_FRESH_WORKERS_DAILY_CAP_ATOMIC, 40_000_000)),
		// Worst-case fee the pay transaction may carry (mirrors the ring ceiling).
		maxPayFeeLamports: Math.floor(num(e.X402_RING_MAX_FEE_PER_TX_LAMPORTS, 10_000)),
		// Wall-clock budget for one tick. The economy heartbeat aborts a target at
		// 60 s, so the lane stops launching new stages before that and lets the
		// next tick finish whatever is still in flight.
		tickBudgetMs: Math.max(10_000, Math.floor(num(e.X402_FRESH_WORKERS_TICK_BUDGET_MS, 50_000))),
		// A wallet untouched for this long in a non-terminal state is reclaimed.
		reclaimAfterS: Math.max(30, Math.floor(num(e.X402_FRESH_WORKERS_RECLAIM_AFTER_S, 90))),
		// Sweep retries before a wallet is declared stranded and alerted.
		maxSweepAttempts: Math.max(1, Math.floor(num(e.X402_FRESH_WORKERS_MAX_SWEEP_ATTEMPTS, 20))),
		// How long a fresh wallet stays in the controlled-wallet set after minting.
		// The leak scanner only classifies signatures newer than its cursor, so a
		// day and a half covers any scan gap without growing the set without bound.
		membershipWindowHours: Math.max(1, Math.floor(num(e.X402_FRESH_WORKERS_MEMBERSHIP_HOURS, 36))),
		// Reclaims attempted per tick, so a backlog drains without eating the tick.
		reclaimBatch: Math.max(1, Math.floor(num(e.X402_FRESH_WORKERS_RECLAIM_BATCH, 12))),
	};
}

/**
 * SOL a fresh wallet must hold to (1) stay rent-exempt as a system account,
 * (2) pay its own 1-signature x402 settle fee at the worst-case priority the
 * ring allows, and (3) pay the base fee of the sweep that empties it.
 */
export function walletSolLamports({
	rentExemptLamports = RENT_EXEMPT_FALLBACK_LAMPORTS,
	maxPayFeeLamports,
	sweepFeeLamports = BASE_FEE_LAMPORTS,
}) {
	return Math.floor(rentExemptLamports) + Math.floor(maxPayFeeLamports) + Math.floor(sweepFeeLamports);
}

/**
 * Which jobs this tick buys, in launch order. Deterministic in (tickSeq,
 * cursor) so two instances with the same inputs plan the same thing. The forge
 * job comes first on its tick because it is the slow one.
 * @param {{ tickSeq:number, perTick:number, forgeEveryNTicks:number, dataSlugs:string[], cursor:number }} p
 * @returns {Array<{ kind:'forge'|'data', slug:string }>}
 */
export function planTickJobs({ tickSeq, perTick, forgeEveryNTicks, dataSlugs, cursor }) {
	const jobs = [];
	if (perTick <= 0) return jobs;
	const forgeTick = forgeEveryNTicks > 0 && tickSeq % forgeEveryNTicks === 0;
	if (forgeTick) jobs.push({ kind: 'forge', slug: 'forge' });
	const len = dataSlugs.length;
	let i = 0;
	while (jobs.length < perTick && len > 0) {
		const idx = (((cursor + i) % len) + len) % len;
		jobs.push({ kind: 'data', slug: dataSlugs[idx] });
		i += 1;
	}
	return jobs;
}

/**
 * Trim a job list to the USDC still allowed today. Jobs are kept in order until
 * the next one would cross the cap; a $0 job never blocks.
 */
export function fitJobsToBudget({ jobs, priceOf, dailySpentAtomic, dailyCapAtomic }) {
	let remaining = Math.max(0, dailyCapAtomic - dailySpentAtomic);
	const kept = [];
	const dropped = [];
	for (const job of jobs) {
		const price = Math.max(0, Math.floor(priceOf(job)));
		if (price <= remaining) {
			kept.push(job);
			remaining -= price;
		} else {
			dropped.push(job);
		}
	}
	return { kept, dropped, remainingAtomic: remaining };
}

/**
 * What one funding transaction must move for a batch of jobs.
 *   solLamports  = per-wallet SOL + one ATA rent per wallet (paid by the SOL
 *                  funder, returned to it at close) + the funding tx's own fee
 *   usdcAtomic   = the sum of the job prices
 */
export function fundingRequirement({ jobs, priceOf, solPerWalletLamports, ataRentLamports = ATA_RENT_LAMPORTS, txFeeLamports = BASE_FEE_LAMPORTS }) {
	const n = jobs.length;
	const usdcAtomic = jobs.reduce((s, j) => s + Math.max(0, Math.floor(priceOf(j))), 0);
	const solLamports = n * (Math.floor(solPerWalletLamports) + Math.floor(ataRentLamports)) + (n > 0 ? txFeeLamports : 0);
	return { wallets: n, solLamports, usdcAtomic };
}

/**
 * Can the SOL funder cover `needLamports` while keeping `floorLamports` (the
 * facilitator's sponsor floor) untouched? Below the floor every sponsored
 * settle on the platform is refused, so this lane never eats into it.
 */
export function funderHeadroom({ balanceLamports, floorLamports, needLamports }) {
	const spendable = Math.max(0, Math.floor(balanceLamports) - Math.floor(floorLamports));
	const ok = spendable >= needLamports;
	return { ok, spendable, shortfall: ok ? 0 : needLamports - spendable };
}

/** Exact lamports a wallet can send in its own 1-signature sweep and end at zero. */
export function sweepAmountLamports({ balanceLamports, feeLamports = BASE_FEE_LAMPORTS }) {
	return Math.max(0, Math.floor(balanceLamports) - Math.floor(feeLamports));
}

/**
 * Decide what a reclaim pass does with a wallet that is not terminal.
 *   'sweep'    : try to empty and close it now
 *   'wait'     : it was touched recently; a live tick still owns it
 *   'stranded' : sweeps keep failing; stop retrying and alert
 */
export function classifyReclaim({ state, updatedAtMs, attempts, nowMs, reclaimAfterS, maxSweepAttempts }) {
	if (['closed', 'fund_failed', 'stranded', 'minted'].includes(state)) return 'skip';
	if (attempts >= maxSweepAttempts) return 'stranded';
	if (nowMs - updatedAtMs < reclaimAfterS * 1000) return 'wait';
	return 'sweep';
}

/** Payload kept for the data desk: bounded arrays, bounded bytes, never a throw. */
export function trimPayload(payload, { maxItems = 40, maxBytes = 60_000 } = {}) {
	if (payload == null || typeof payload !== 'object') return { value: payload };
	const clip = (v, depth) => {
		if (Array.isArray(v)) return v.slice(0, maxItems).map((x) => (depth < 2 ? clip(x, depth + 1) : x));
		if (v && typeof v === 'object' && depth < 2) {
			const out = {};
			for (const [k, x] of Object.entries(v)) out[k] = clip(x, depth + 1);
			return out;
		}
		return v;
	};
	let trimmed = clip(payload, 0);
	let text = JSON.stringify(trimmed);
	if (text.length > maxBytes) {
		trimmed = clip(payload, 0);
		for (const k of Object.keys(trimmed)) {
			if (Array.isArray(trimmed[k])) trimmed[k] = trimmed[k].slice(0, 10);
		}
		text = JSON.stringify(trimmed);
		if (text.length > maxBytes) {
			trimmed = { truncated: true, keys: Object.keys(payload).slice(0, 24) };
		}
	}
	return trimmed;
}
