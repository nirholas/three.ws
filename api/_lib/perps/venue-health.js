// Perps venue health: which venues answer right now, and where an unpinned read
// should go when its venue is down.
//
// Same circuit-breaker pattern as the forge lanes (forge-lane-health.js): a
// failed read records a short cooldown in the shared cache
// (provider-health.js), every instance then skips that venue until it expires,
// and a probe reports latency. Everything is best-effort and fail-open: a cache
// or probe error reads as "usable", never as "down".
//
// Failover applies to READS only (markets, books, funding). A live order always
// runs on the venue the owner picked in the preview. It is never silently
// rerouted, because a different venue has different collateral, fees and
// liquidation rules.

import {
	providersInCooldown,
	markProviderCooldown,
	clearProviderCooldown,
} from '../provider-health.js';
import { listVenueModules, DEFAULT_VENUE, getVenue } from './index.js';

export const VENUE_COOLDOWN_SECONDS = 45;
const PROBE_TIMEOUT_MS = 4_000;

export const venueCooldownKey = (venueId) => `perps-venue:${venueId}`;

export const markVenueUnhealthy = (venueId, seconds = VENUE_COOLDOWN_SECONDS) =>
	markProviderCooldown(venueCooldownKey(venueId), seconds).catch(() => {});

export const markVenueHealthy = (venueId) =>
	clearProviderCooldown(venueCooldownKey(venueId)).catch(() => {});

/** Pure: is this error a venue outage (retryable, nothing signed) rather than a caller error? */
export function isVenueOutage(err) {
	const code = err?.code;
	if (code === 'venue_unavailable' || code === 'simulation_unavailable') return true;
	return typeof err?.status === 'number' && err.status >= 502 && err.status < 600;
}

function withTimeout(promise, ms) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(`probe timed out after ${ms} ms`)), ms);
		}),
	]).finally(() => clearTimeout(timer));
}

/** Probe every venue once and report status. Never throws. */
export async function venueHealth({ probe = true } = {}) {
	const venues = listVenueModules();
	const cooling = await providersInCooldown(venues.map((v) => venueCooldownKey(v.id))).catch(
		() => new Map(),
	);
	return Promise.all(
		venues.map(async (v) => {
			const base = {
				id: v.id,
				label: v.label,
				chain: v.chain,
				execution: v.execution,
				default: v.id === DEFAULT_VENUE,
			};
			if (cooling.has(venueCooldownKey(v.id)))
				return {
					...base,
					status: 'down',
					latency_ms: null,
					reason: 'recent failure, cooling down',
				};
			if (!probe) return { ...base, status: 'unknown', latency_ms: null, reason: null };
			try {
				const { latency_ms } = await withTimeout(v.ping(), PROBE_TIMEOUT_MS);
				await markVenueHealthy(v.id);
				return {
					...base,
					status: latency_ms > 2_500 ? 'degraded' : 'up',
					latency_ms,
					reason: null,
				};
			} catch (err) {
				await markVenueUnhealthy(v.id);
				return {
					...base,
					status: 'down',
					latency_ms: null,
					reason: String(err?.message || err).slice(0, 160),
				};
			}
		}),
	);
}

/**
 * Run a read against a venue. When the venue is pinned (`venueId` given) the
 * outage surfaces as the designed error. When unpinned, an outage on the
 * default venue falls over to the next healthy venue, and the answer says which
 * venue served it and why.
 */
export async function readWithFailover(venueId, run) {
	const pinned = Boolean(venueId);
	const first = getVenue(venueId || DEFAULT_VENUE);
	const order = pinned
		? [first]
		: [first, ...listVenueModules().filter((v) => v.id !== first.id)];
	const cooling = await providersInCooldown(order.map((v) => venueCooldownKey(v.id))).catch(
		() => new Map(),
	);
	const candidates = pinned ? order : order.filter((v) => !cooling.has(venueCooldownKey(v.id)));
	let lastErr = null;
	for (const venue of candidates.length ? candidates : order) {
		try {
			const out = await run(venue);
			await markVenueHealthy(venue.id);
			return {
				venue,
				failed_over_from: venue.id === first.id ? null : first.id,
				result: out,
			};
		} catch (err) {
			lastErr = err;
			if (!isVenueOutage(err)) throw err;
			await markVenueUnhealthy(venue.id);
		}
	}
	throw lastErr;
}
