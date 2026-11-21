// GET /api/x402-status — operational probe for the x402 wiring.
//
// Reports the configured pay-to addresses, asset mints/contracts, and probes
// each facilitator's /supported endpoint to confirm it advertises scheme=exact
// for the network we route to it. Surfaces misconfigurations (e.g. Coinbase's
// reference facilitator, which only supports base-sepolia) before a paying
// client hits a 502.

import { cors, json, method, rateLimited, wrap } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { env } from './_lib/env.js';
import {
	EIP2612_EXTENSION_KEY,
	ERC20_APPROVAL_EXTENSION_KEY,
	declareEip2612GasSponsoringExtension,
	declareErc20ApprovalGasSponsoringExtension,
	paymentRequirements,
	probeFacilitators,
	X402_VERSION,
} from './_lib/x402-spec.js';
import { sql } from './_lib/db.js';
import { authorizeOps } from './_lib/ops-auth.js';
import { hasEvmVerifier } from './_lib/siwx-server.js';
import {
	selfFacilitatorEnabled,
	selfFacilitatorUrl,
	validateRingConfig,
	ringConfigWarningsView,
} from './_lib/x402/ring-config.js';
import { pendingSettlementStats } from './_lib/x402/pending-settlements.js';

// Read SIWX table counts so operators can confirm at-a-glance whether the
// SIWX rails are wired and active. The tables may not exist on a brand-new
// database (migrations not yet run) — surface that explicitly via
// `configured: false` instead of failing the whole status endpoint.
async function probeSiwx() {
	try {
		const [{ n: paymentsRowCount }] = await sql`
			select count(*)::int as n from siwx_payments
		`;
		const [{ n: noncesRowCount }] = await sql`
			select count(*)::int as n from siwx_nonces
		`;
		return {
			configured: true,
			paymentsRowCount,
			noncesRowCount,
			evmVerifierConfigured: hasEvmVerifier(),
		};
	} catch (err) {
		return {
			configured: false,
			error: 'siwx_tables_unreadable',
			detail: String(err?.message || err).slice(0, 160),
			evmVerifierConfigured: hasEvmVerifier(),
		};
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	// Checked before probeFacilitators(): each call fans out to the network.
	const rl = await limits.x402StatusIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl, 'too many status checks, retry in a minute');

	const accepts = paymentRequirements();
	const facilitators = await probeFacilitators();
	const siwx = await probeSiwx();
	const ok = facilitators.every((f) => f.ok);

	// This probe is public (the economy lab links it), so raw driver messages
	// and the ring config findings, which name the signing secrets missing from
	// the deploy, go only to the operator. Everyone else gets codes and a count.
	const operator = (await authorizeOps(req).catch(() => ({ ok: false }))).ok;
	if (siwx.detail && !operator) {
		console.warn('[x402-status] siwx probe failed:', siwx.detail);
		delete siwx.detail;
	}
	const configWarnings = validateRingConfig();

	// Ring config truth: the resolution behavior + every known misconfiguration.
	// When the self-facilitator is on, probeFacilitators() already added a
	// distinct `self: true` entry for /api/x402-facilitator (even if an external
	// URL wins routing), so operators see the in-house facilitator's health next
	// to wherever settlement actually routes.
	const ring = {
		self_facilitator_enabled: selfFacilitatorEnabled(),
		self_facilitator_url: selfFacilitatorUrl(),
		...ringConfigWarningsView(configWarnings, { operator }),
	};

	// Settlements that answered `settlement_pending` (broadcast, outcome not yet
	// known), plus how the last day's pending settlements resolved. A non-zero
	// `pending` is normal and self-clearing; a climbing `pending` with
	// `abandoned`/`failed` alongside it means transactions are being broadcast
	// into conditions where they cannot confirm, which is an RPC or sponsor-SOL
	// problem rather than a payment problem. Falls back to null rather than
	// failing the probe: this is an observability panel, not a health gate.
	let settlements = null;
	try {
		settlements = await pendingSettlementStats({ windowHours: 24 });
	} catch (err) {
		const detail = String(err?.message || err).slice(0, 160);
		if (!operator) console.warn('[x402-status] settlement stats failed:', detail);
		settlements = operator ? { error: 'settlement_stats_unavailable', detail } : { error: 'settlement_stats_unavailable' };
	}

	// Surface what we advertise in 402 challenges so operators can confirm at a
	// glance: which accept entries opt into the Permit2 transfer method, and
	// whether each facilitator's /supported probe actually advertises the
	// `eip2612GasSponsoring` extension we declare. A green `ok` here plus
	// `extensions.eip2612GasSponsoring.facilitatorsSupporting` matching the
	// EVM facilitator set means the gasless Permit2 onboarding path is live.
	const permit2Accepts = accepts.filter((a) => a?.extra?.assetTransferMethod === 'permit2');
	const sponsorshipDeclared = permit2Accepts.length > 0;
	const eip2612FacilitatorsSupporting = facilitators
		.filter((f) => f.supportsEip2612GasSponsoring)
		.map((f) => f.network);
	const erc20FacilitatorsSupporting = facilitators
		.filter((f) => f.supportsErc20ApprovalGasSponsoring)
		.map((f) => f.network);

	return json(
		res,
		ok ? 200 : 503,
		{
			ok,
			x402Version: X402_VERSION,
			accepts,
			facilitators,
			extensions: {
				[EIP2612_EXTENSION_KEY]: {
					declared: sponsorshipDeclared,
					declaration: sponsorshipDeclared
						? declareEip2612GasSponsoringExtension()[EIP2612_EXTENSION_KEY]
						: null,
					appliesTo: permit2Accepts.map((a) => a.network),
					facilitatorsSupporting: eip2612FacilitatorsSupporting,
				},
				[ERC20_APPROVAL_EXTENSION_KEY]: {
					declared: sponsorshipDeclared,
					declaration: sponsorshipDeclared
						? declareErc20ApprovalGasSponsoringExtension()[ERC20_APPROVAL_EXTENSION_KEY]
						: null,
					appliesTo: permit2Accepts.map((a) => a.network),
					facilitatorsSupporting: erc20FacilitatorsSupporting,
				},
			},
			ring,
			settlements,
			env: {
				X402_PAY_TO_SOLANA: env.X402_PAY_TO_SOLANA || null,
				X402_PAY_TO_BASE: env.X402_PAY_TO_BASE || null,
				X402_ASSET_MINT_SOLANA: env.X402_ASSET_MINT_SOLANA || null,
				X402_ASSET_ADDRESS_BASE: env.X402_ASSET_ADDRESS_BASE || null,
				X402_FEE_PAYER_SOLANA: env.X402_FEE_PAYER_SOLANA || null,
				X402_MAX_AMOUNT_REQUIRED: env.X402_MAX_AMOUNT_REQUIRED || null,
			},
			siwx,
		},
		{ 'cache-control': 'no-store' },
	);
});
