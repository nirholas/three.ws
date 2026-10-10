// Who may see the staking panel. Everyone else gets the free-to-play version only.
// Order matters and every refusal names a reason the UI can explain:
//   flag off -> kill switch -> region -> attestation.
// Region comes from the edge geo header (api/_lib/client-geo.js), never from the
// client's claim. An unknown region is treated as blocked: when in doubt, free.

import { clientCountry } from '../../client-geo.js';
import { stakingConfig, TERMS_VERSION } from './config.js';

/**
 * @param {{req:object, attestation:?{min_age:number,country:string,terms_version:string}, stakesEnabled:boolean}} ctx
 * @returns {{available:boolean, reason:?string, country:?string, needs_attestation:boolean, min_age:number}}
 */
export function evaluateGate({ req, attestation, stakesEnabled }) {
	const cfg = stakingConfig();
	const country = clientCountry(req);
	const base = { country, min_age: cfg.minAge, needs_attestation: false };
	if (!cfg.enabled) return { ...base, available: false, reason: 'disabled' };
	if (!stakesEnabled) return { ...base, available: false, reason: 'paused' };
	if (!country) return { ...base, available: false, reason: 'region_unknown' };
	if (cfg.blockedCountries.has(country)) return { ...base, available: false, reason: 'region_blocked' };
	const current = attestation && attestation.terms_version === TERMS_VERSION && attestation.min_age >= cfg.minAge;
	if (!current) return { ...base, available: false, reason: 'attestation_required', needs_attestation: true };
	if (attestation.country !== country) return { ...base, available: false, reason: 'attestation_region_changed', needs_attestation: true };
	return { ...base, available: true, reason: null };
}

export const GATE_MESSAGES = {
	disabled: 'Staked markets are not open yet. You can still make free picks.',
	paused: 'New stakes are paused. Free picks are unaffected, and any claim or refund you are owed still works.',
	region_unknown: 'We could not confirm your region, so staking is unavailable. Free picks are open to everyone.',
	region_blocked: 'Staked markets are not available in your region. Free picks are open to everyone.',
	attestation_required: 'Confirm your age and region to unlock staking.',
	attestation_region_changed: 'Your region changed since you confirmed. Confirm again to continue.',
};
