// Spending-cap enforcement for x402 buyer clients (USE-22).
//
// Critical safety net for autonomous agents (USE-29..40): without per-call
// + sliding-window caps, a bug in agent logic could drain the buyer wallet
// across thousands of micropayments before anyone notices. The cap module
// is the chokepoint that every buyer client routes through.
//
// Surface:
//   installSpendingCap(client, opts) — for clients that expose the SDK's
//     onBeforePaymentCreation / onAfterPaymentCreation lifecycle hooks
//     (e.g. @x402/fetch's wrapFetchWithPayment style). Returns an
//     `uninstall()` function.
//   enforceCap({ requirement, opts }) — lower-level entrypoint used by the
//     buyer-fetch / buyer-axios helpers, which call us imperatively
//     instead of via lifecycle hooks. Returns `{ abort: false }` on
//     success or `{ abort: true, reason }`.
//   commit(reservation) / rollback(reservation) — pair with enforceCap
//     for transactional admission.
//
// Strict mode is the default: we reserve the spend in Redis BEFORE the
// payment is signed and rollback on any failure path. This closes the
// race where two concurrent calls would both pass a relaxed read-only
// cap check.

import { current, reserve, rollback } from './x402-spending-ledger.js';
import { toMicroUsd } from './x402-spending-price.js';
import { env } from './env.js';

const DEFAULT_OPTS = Object.freeze({
	// All thresholds are micro-USD (6 decimals) — i.e. atomics of a USDC.
	maxPerCall: null,
	maxPerHour: null,
	maxPerDay: null,
	// `strict: true` reserves the spend pre-signing for race-free caps;
	// `false` reads-then-writes (faster, but two concurrent calls under
	// the limit individually can both go through). Default true because
	// the agent use-case is exactly the scenario that creates the race.
	strict: true,
	// Hook fires after a successful payment; useful for sending audit
	// events to whatever observability stack the host process uses.
	onRecord: null,
});

function asBigInt(v, label) {
	if (v == null) return null;
	try {
		return BigInt(v);
	} catch (err) {
		throw new Error(
			`spending-cap: ${label} must be a base-10 integer string (got ${typeof v})`,
		);
	}
}

function normalizeOpts(input = {}) {
	const opts = { ...DEFAULT_OPTS, ...input };
	// Fall back to env-configured ceilings when the caller didn't set the
	// explicit option. Lets operators set process-wide caps once and trust
	// every paid endpoint inherits them.
	if (opts.maxPerCall == null) opts.maxPerCall = env.X402_MAX_PER_CALL_ATOMIC;
	if (opts.maxPerHour == null) opts.maxPerHour = env.X402_MAX_PER_HOUR_ATOMIC;
	if (opts.maxPerDay == null) opts.maxPerDay = env.X402_MAX_PER_DAY_ATOMIC;
	opts.maxPerCall = asBigInt(opts.maxPerCall, 'maxPerCall');
	opts.maxPerHour = asBigInt(opts.maxPerHour, 'maxPerHour');
	opts.maxPerDay = asBigInt(opts.maxPerDay, 'maxPerDay');
	if (input.onRecord != null && typeof input.onRecord !== 'function') {
		throw new Error('spending-cap: onRecord must be a function when provided');
	}
	if (!input.address || typeof input.address !== 'string') {
		throw new Error('spending-cap: address required');
	}
	opts.address = input.address;
	return opts;
}

// Single-shot admission check. Caller passes the resolved requirement
// (the entry the SDK picked off the 402 accepts[] list) plus the
// caps options. Returns one of:
//
//   { abort: true,  reason }                 — request must NOT proceed
//   { abort: false, reservation }            — proceed; pass reservation
//                                              into commit() or rollback()
//
// `reservation` is opaque from the caller's perspective; we use it to
// undo a strict-mode reserve without re-fetching from Redis.
export async function enforceCap({ requirement, opts }) {
	const settings = normalizeOpts(opts);
	// v2 requirements name the price `amount`; v1 requirements (still spoken by
	// most of the open x402 bazaar and the owner's x402-suite) name it
	// `maxAmountRequired`. Without this fallback every v1 payment threw here
	// instead of being admitted and capped.
	const amount = requirement?.amount ?? requirement?.maxAmountRequired;
	if (!requirement || !amount) {
		throw new Error('spending-cap: requirement.amount required');
	}

	const microUsd = await toMicroUsd(amount, requirement);

	if (settings.maxPerCall != null && microUsd > settings.maxPerCall) {
		return {
			abort: true,
			reason: `Payment ${microUsd}µUSD exceeds per-call cap ${settings.maxPerCall}µUSD`,
		};
	}

	const timestamp = Date.now();
	if (settings.strict) {
		// Pessimistic admission: reserve first, then check the post-state.
		const totals = await reserve({
			address: settings.address,
			microUsd,
			timestamp,
		});
		if (settings.maxPerHour != null && totals.hour > settings.maxPerHour) {
			await rollback({ address: settings.address, microUsd, timestamp });
			return {
				abort: true,
				reason: `Hourly cap exceeded: ${totals.hour}µUSD would exceed ${settings.maxPerHour}µUSD`,
			};
		}
		if (settings.maxPerDay != null && totals.day > settings.maxPerDay) {
			await rollback({ address: settings.address, microUsd, timestamp });
			return {
				abort: true,
				reason: `Daily cap exceeded: ${totals.day}µUSD would exceed ${settings.maxPerDay}µUSD`,
			};
		}
		return {
			abort: false,
			reservation: { address: settings.address, microUsd, timestamp, settings },
		};
	}

	// Relaxed admission: peek at the running totals, then commit only after
	// the payment is signed. Saves a write on every reject but has a race
	// between two in-flight calls.
	const totals = await current({ address: settings.address, timestamp });
	if (settings.maxPerHour != null && totals.hour + microUsd > settings.maxPerHour) {
		return {
			abort: true,
			reason: `Hourly cap would be exceeded: ${totals.hour + microUsd}µUSD > ${settings.maxPerHour}µUSD`,
		};
	}
	if (settings.maxPerDay != null && totals.day + microUsd > settings.maxPerDay) {
		return {
			abort: true,
			reason: `Daily cap would be exceeded: ${totals.day + microUsd}µUSD > ${settings.maxPerDay}µUSD`,
		};
	}
	return {
		abort: false,
		reservation: {
			address: settings.address,
			microUsd,
			timestamp,
			settings,
			pendingCommit: true,
		},
	};
}

// Commit a successful payment to the ledger. For strict admission the
// reserve already happened; commit is a no-op aside from the onRecord hook.
// For relaxed admission, commit is where the running totals actually grow.
export async function commit(reservation, extra = {}) {
	if (!reservation) return;
	const { address, microUsd, timestamp, settings, pendingCommit } = reservation;
	if (pendingCommit) {
		await reserve({ address, microUsd, timestamp });
	}
	if (settings?.onRecord) {
		try {
			await settings.onRecord({
				address,
				microUsd: String(microUsd),
				timestamp,
				...extra,
			});
		} catch (err) {
			// onRecord failures must not break paid flows. Log and continue.
			// eslint-disable-next-line no-console
			console.error('[spending-cap] onRecord hook failed:', err?.message || err);
		}
	}
}

// Roll back an admission reservation. Idempotent in the sense that calling
// it twice is harmless aside from the negative ledger write — we trust
// callers to track a "did I roll back yet" boolean. This is fine because
// the same physical reservation typically only has one terminal path.
export async function rollbackReservation(reservation) {
	if (!reservation) return;
	const { address, microUsd, timestamp, pendingCommit } = reservation;
	if (pendingCommit) return; // never reserved → nothing to undo
	await rollback({ address, microUsd, timestamp });
}

// Install the cap as SDK-style lifecycle hooks on a client. Compatible with
// any client object that exposes `onBeforePaymentCreation` and
// `onAfterPaymentCreation` callbacks (e.g. @x402/fetch's createPaymentClient).
//
// `client.onBeforePaymentCreation(fn)` is expected to register `fn` and
// invoke it with `{ selectedRequirements }` immediately before signing.
// Returning `{ abort: true, reason }` aborts the call. We stash the
// reservation in a per-client WeakMap so the after-hook can commit it.
export function installSpendingCap(client, opts) {
	const settings = normalizeOpts(opts);
	if (!client || typeof client.onBeforePaymentCreation !== 'function') {
		throw new Error('installSpendingCap: client.onBeforePaymentCreation not found');
	}
	if (typeof client.onAfterPaymentCreation !== 'function') {
		throw new Error('installSpendingCap: client.onAfterPaymentCreation not found');
	}
	const reservations = new WeakMap();

	const before = async (ctx = {}) => {
		const requirement = ctx.selectedRequirements || ctx.requirement;
		if (!requirement) return;
		const res = await enforceCap({ requirement, opts: settings });
		if (res.abort) {
			return { abort: true, reason: res.reason };
		}
		reservations.set(ctx, res.reservation);
		return undefined;
	};

	const after = async (ctx = {}) => {
		const reservation = reservations.get(ctx);
		if (!reservation) return;
		reservations.delete(ctx);
		const requirement = ctx.selectedRequirements || ctx.requirement || {};
		await commit(reservation, {
			network: requirement.network,
			asset: requirement.asset,
		});
	};

	const onError = async (ctx = {}) => {
		const reservation = reservations.get(ctx);
		if (!reservation) return;
		reservations.delete(ctx);
		await rollbackReservation(reservation);
	};

	const removeBefore = client.onBeforePaymentCreation(before);
	const removeAfter = client.onAfterPaymentCreation(after);
	// Best-effort error hook — not every SDK exposes it. We register only
	// when present; otherwise relaxed-mode rollback relies on the caller
	// catching errors.
	const removeError =
		typeof client.onPaymentError === 'function'
			? client.onPaymentError(onError)
			: typeof client.onPaymentFailure === 'function'
				? client.onPaymentFailure(onError)
				: () => undefined;

	return function uninstall() {
		if (typeof removeBefore === 'function') removeBefore();
		if (typeof removeAfter === 'function') removeAfter();
		if (typeof removeError === 'function') removeError();
	};
}
