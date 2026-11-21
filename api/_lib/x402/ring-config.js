// api/_lib/x402/ring-config.js
//
// Routing + configuration truth for the closed-loop x402 ring.
//
// The ring's whole point is that NO third party ever touches a ring settlement
// — yet the stock Solana facilitator default is an external one (PayAI). This
// module is the single place that decides where Solana settlement routes and
// that says, loudly and structurally, when a deploy is mis-enveloped:
//
//   1. resolveSolanaFacilitator() — the resolution rule facilitatorFor() uses.
//      An EXPLICIT X402_FACILITATOR_URL_SOLANA (or legacy X402_FACILITATOR_URL)
//      always wins; with no explicit URL, X402_SELF_FACILITATOR_ENABLED=true
//      defaults to our own /api/x402-facilitator, and only a disabled
//      self-facilitator falls back to the external default. No surprise
//      re-routing for existing deploys: explicit env beats computed defaults.
//
//   2. validateRingConfig() — structured findings for every known ring
//      misconfiguration, surfaced by /api/x402-ring (config_warnings) and
//      /api/x402-status (ring.config_warnings).
//
//   3. warnIfRingRoutesExternal() — one structured console warning per boot
//      (not per call) when ring intent exists but settlement would route to an
//      external facilitator.
//
// Deliberately light: imports only env.js and x402-prices.js so the pure-logic
// tests (tests/api/x402-ring-config.test.js) never touch @solana/web3.js, the
// DB, or the network.

import { env } from '../env.js';
import { priceFor } from '../x402-prices.js';
import { RING_SETTLE_DEFAULT_PRICE_ATOMICS, volumePerRunCapAtomic } from './ring-constants.js';

// External default when the self-facilitator is off and no URL is set.
// Mirrors the default baked into env.js X402_FACILITATOR_URL_SOLANA.
export const EXTERNAL_FACILITATOR_URL_DEFAULT = 'https://facilitator.payai.network';

export function selfFacilitatorEnabled() {
	return String(process.env.X402_SELF_FACILITATOR_ENABLED || '').toLowerCase() === 'true';
}

export function ringSelfPayEnabled() {
	return String(process.env.X402_RING_SELF_PAY || '').toLowerCase() === 'true';
}

// The self-hosted facilitator's own URL. Anchored on APP_ORIGIN (canonical
// fallback https://three.ws) so preview deploys resolve to THEIR facilitator.
export function selfFacilitatorUrl() {
	return `${env.APP_ORIGIN}/api/x402-facilitator`;
}

// Does a facilitator URL point at (any deploy of) our self-hosted facilitator?
// Matched on the route path, not the host, so an explicit env var pinning the
// production origin still counts as self on a preview deploy.
export function isSelfFacilitatorUrl(url) {
	if (!url) return false;
	try {
		return new URL(url).pathname.replace(/\/$/, '').endsWith('/api/x402-facilitator');
	} catch {
		return false;
	}
}

// The explicitly-configured Solana facilitator URL, or null when unset/blank.
// Blank values (X402_FACILITATOR_URL_SOLANA= in a .env) count as unset —
// otherwise the resolver would emit '' and every facilitator call would fetch
// a relative path.
function explicitSolanaFacilitatorUrl() {
	const raw = process.env.X402_FACILITATOR_URL_SOLANA ?? process.env.X402_FACILITATOR_URL;
	const trimmed = String(raw ?? '').trim();
	if (!trimmed) return null;
	return trimmed.replace(/\/$/, '');
}

// Resolution rule for Solana settlement — the seam facilitatorFor() calls.
// Returns { url, self } where `self` is true when the resolved URL is our own
// facilitator. Order:
//   1. explicit env URL (always wins — existing deploys never re-route)
//   2. self-hosted facilitator, when X402_SELF_FACILITATOR_ENABLED=true
//   3. the external default (PayAI)
export function resolveSolanaFacilitator() {
	const explicit = explicitSolanaFacilitatorUrl();
	if (explicit) return { url: explicit, self: isSelfFacilitatorUrl(explicit) };
	if (selfFacilitatorEnabled()) return { url: selfFacilitatorUrl(), self: true };
	return { url: EXTERNAL_FACILITATOR_URL_DEFAULT, self: false };
}

// Boot-time ring configuration validation. Returns structured findings — empty
// when the ring envelope is complete. Each finding: { code, severity, message,
// fix }. severity 'error' = ring settlement will not work as intended;
// 'warn' = it works but costs more or a component is degraded.
export function validateRingConfig() {
	const findings = [];
	const enabled = selfFacilitatorEnabled();
	const route = resolveSolanaFacilitator();

	if (!enabled) {
		findings.push({
			code: 'self_facilitator_disabled',
			severity: 'error',
			message:
				'X402_SELF_FACILITATOR_ENABLED is not "true" — /api/x402-facilitator answers 503 and nothing settles in-house',
			fix: 'set X402_SELF_FACILITATOR_ENABLED=true',
		});
	}
	if (!route.self) {
		findings.push({
			code: 'facilitator_url_external',
			severity: 'error',
			message: `Solana settlement resolves to ${route.url} — an external facilitator would touch ring settlements`,
			fix: `set X402_SELF_FACILITATOR_ENABLED=true and either unset X402_FACILITATOR_URL_SOLANA or point it at ${selfFacilitatorUrl()}`,
		});
	}
	if (!String(process.env.X402_TREASURY_SECRET_BASE58 || '').trim()) {
		findings.push({
			code: 'treasury_secret_missing',
			severity: 'warn',
			message:
				'X402_TREASURY_SECRET_BASE58 is not set — the rebalancer cannot sweep treasury→payer, so the float drains one-way into the treasury',
			fix: 'set X402_TREASURY_SECRET_BASE58 from scripts/x402-ring-setup.mjs output',
		});
	}
	if (!env.X402_FEE_PAYER_SOLANA) {
		findings.push({
			code: 'fee_payer_pubkey_missing',
			severity: 'error',
			message:
				'X402_FEE_PAYER_SOLANA is not set — 402 challenges cannot advertise extra.feePayer, so no Solana accept entry is buildable',
			fix: 'set X402_FEE_PAYER_SOLANA to the sponsor pubkey from scripts/x402-ring-setup.mjs',
		});
	}
	// When settlement routes in-house, the sponsor SECRET must be present or every
	// sponsor-mode settle throws `sponsor_key_unconfigured` and the buyer gets a 502
	// AFTER paying. The advertising layer (solanaSettleable() in x402-spec.js) now
	// drops the Solana accept when this secret is missing, turning that 502 into a
	// clean unpayable state — but the deploy still can't earn on Solana until it is
	// set, so surface it here as an error the health board and /api/x402-status show.
	// Only meaningful when we route to our own facilitator; an external facilitator
	// co-signs with its own key.
	if (route.self && !ringSelfPayEnabled() && !String(process.env.X402_FEE_PAYER_SECRET_BASE58 || '').trim()) {
		findings.push({
			code: 'fee_payer_secret_missing',
			severity: 'error',
			message:
				'X402_FEE_PAYER_SECRET_BASE58 is not set and self-pay is off — the self-facilitator cannot co-sign sponsor-mode settlements, so the Solana accept is withheld and no Solana payment can settle in-house',
			fix: 'set X402_RING_SELF_PAY=true (buyer pays its own fee, no sponsor key needed) OR set X402_FEE_PAYER_SECRET_BASE58 to the sponsor secret (must match X402_FEE_PAYER_SOLANA)',
		});
	}
	const priceAtomic = Number(priceFor('ring-settle', RING_SETTLE_DEFAULT_PRICE_ATOMICS));
	const capAtomic = volumePerRunCapAtomic();
	if (capAtomic > 0 && priceAtomic > capAtomic) {
		findings.push({
			code: 'ring_price_exceeds_run_cap',
			severity: 'error',
			message: `priceFor('ring-settle')=${priceAtomic} atomics exceeds X402_VOLUME_PER_RUN_CAP_ATOMIC=${capAtomic} — the volume loop skips ring-settle on every tick`,
			fix: 'raise X402_VOLUME_PER_RUN_CAP_ATOMIC above X402_PRICE_RING_SETTLE (or lower the price)',
		});
	}
	if (!ringSelfPayEnabled()) {
		findings.push({
			code: 'ring_self_pay_off',
			severity: 'warn',
			message:
				'X402_RING_SELF_PAY is not "true" — sponsor mode needs 2 signatures (~2× the base fee) plus the sponsor secret on every settle',
			fix: 'set X402_RING_SELF_PAY=true and fund the payer with a little SOL',
		});
	}
	return findings;
}

// The response shape for validateRingConfig() findings on a PUBLIC endpoint.
// The findings name which signing secrets are missing from the deploy and how the
// ring is routed, so only an operator (authorizeOps) gets them; everyone else gets
// the count, which is enough to tell a green ring (0) from a degraded one.
export function ringConfigWarningsView(findings, { operator = false } = {}) {
	const list = Array.isArray(findings) ? findings : [];
	return operator
		? { config_warning_count: list.length, config_warnings: list }
		: { config_warning_count: list.length };
}

// One structured warning per boot (not per call) when ring settlement would
// route to an external facilitator. Returns the warning object (for surfacing
// in API responses) or null when routing is already self-hosted. Callers are
// the ring surfaces (/api/x402-ring) plus the module-load hook below for
// deploys that declare ring intent via X402_RING_SELF_PAY=true.
let externalRouteWarned = false;
export function warnIfRingRoutesExternal(context = 'ring') {
	const route = resolveSolanaFacilitator();
	if (route.self) return null;
	const warning = {
		code: 'ring_external_facilitator',
		context,
		facilitator_url: route.url,
		self_facilitator_enabled: selfFacilitatorEnabled(),
		ring_self_pay: ringSelfPayEnabled(),
		message: `ring settlement routes to EXTERNAL facilitator ${route.url}; set X402_SELF_FACILITATOR_ENABLED=true and unset X402_FACILITATOR_URL_SOLANA (or point it at ${selfFacilitatorUrl()})`,
	};
	if (!externalRouteWarned) {
		externalRouteWarned = true;
		console.warn(`[x402-ring-config] ${JSON.stringify(warning)}`);
	}
	return warning;
}

// Test hook — the once-per-boot latch above is process state.
export function _resetRingConfigWarningsForTest() {
	externalRouteWarned = false;
}

// Boot hook: a deploy that turned on self-pay declared ring intent — if its
// settlement still routes externally, say so once, immediately, instead of
// waiting for the first pipeline tick.
if (ringSelfPayEnabled()) {
	warnIfRingRoutesExternal('boot');
}
