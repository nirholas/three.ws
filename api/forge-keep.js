/**
 * /api/forge-keep: pay-to-keep for Forge generations. OFF unless the owner sets
 * FORGE_PAY_TO_KEEP=on (npm run forge:pay-to-keep -- on). With it off every
 * generation is keepable and these endpoints answer `enabled:false, kept:true`, so
 * default behaviour is exactly what shipped before.
 *
 * When on, generating and previewing on a free lane stays free. The original file
 * is released once per creation to a $THREE holder (Bronze and above), or against
 * one settled $THREE payment for forge.keep.<tier> (the same quote, sign, settle
 * rail High and Game-Ready use: src/forge-pay.js payForConsumption). High needs no
 * keep payment because it is already held or paid for at generation time.
 *
 *   GET  /api/forge-keep?creation_id=<uuid>
 *     -> { enabled, kept, reason, price?: { action, usd }, holder_free?, tier }
 *   POST /api/forge-keep { creation_id, payment_id?, ref_id?, tier_pass? }
 *     -> 200 { enabled, kept:true, reason, download_url }
 *        402 { error:'three_hold_required', pay_per_use:{ action, usd } }
 *        402/409 payment errors (payment_invalid, payment_expired, payment_already_used)
 *
 * Settlement is $THREE on Solana (api/_lib/token). Nothing here signs or spends:
 * the caller pays through the token rail first and presents the settled proof.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { isUuid } from './_lib/validate.js';
import { priceForAction } from './_lib/pricing/catalog.js';
import { checkFeatureAccess } from './_lib/require-three.js';
import { payToKeepEnabled, keepActionForTier } from './_lib/forge-quote.js';
import { loadKeepableCreation, isCreationKept } from './_lib/forge-keep.js';
import { assertForgePurchase, redeemForgePurchase } from './_lib/forge-consumption-payment.js';

const PAYMENT_ERROR_CODES = new Set(['bad_request', 'payment_invalid', 'payment_expired', 'payment_already_used']);

function priceOf(action) {
	try {
		const usd = Number(priceForAction(action).usd);
		return Number.isFinite(usd) && usd > 0 ? { action, usd } : null;
	} catch {
		return null;
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const rl = await limits.mcp3dStatus(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const isPost = req.method === 'POST';
	const body = isPost ? await readJson(req, 4_000).catch(() => null) : null;
	const creationId = isPost
		? typeof body?.creation_id === 'string' ? body.creation_id.trim() : ''
		: (new URL(req.url, 'http://localhost').searchParams.get('creation_id') || '').trim();
	if (!isUuid(creationId)) {
		return json(res, 400, { error: 'invalid_creation', message: 'Pass creation_id as a valid creation id.' });
	}

	const creation = await loadKeepableCreation(creationId);
	if (!creation) {
		return json(res, 404, { error: 'creation_not_found', message: 'That generation is not finished or no longer exists.' });
	}

	const enabled = payToKeepEnabled();
	const action = keepActionForTier(creation.tier);
	const released = (reason) =>
		json(res, 200, { enabled, kept: true, reason, tier: creation.tier, download_url: creation.glb_url });

	if (!enabled) return released('pay_to_keep_off');
	if (!action) return released('included');
	if (await isCreationKept(creationId)) return released('paid');

	const price = priceOf(action);
	if (!price) return released('unpriced');

	if (!isPost) {
		const access = await checkFeatureAccess(req, res, 'forge.keep').catch(() => ({ eligible: false }));
		return json(res, 200, {
			enabled,
			kept: access.eligible,
			reason: access.eligible ? 'holder' : 'payment_required',
			tier: creation.tier,
			price,
			holder_free: access.eligible,
			...(access.eligible ? { download_url: creation.glb_url } : {}),
		});
	}

	const paymentId = typeof body?.payment_id === 'string' ? body.payment_id.trim() : '';
	const refId = typeof body?.ref_id === 'string' ? body.ref_id.trim() : '';
	if (paymentId && refId) {
		let proof;
		try {
			proof = await assertForgePurchase({ action, paymentId, refId });
		} catch (err) {
			if (!PAYMENT_ERROR_CODES.has(err?.code)) throw err;
			return json(res, err.status || 402, {
				error: err.code,
				feature: action,
				pay_per_use: price,
				message: err.message || 'That $THREE payment could not be verified.',
			});
		}
		const claim = await redeemForgePurchase({
			action,
			paymentId,
			refId,
			jobId: creationId,
			settledAt: proof.payment.settledAt,
		});
		if (!claim.redeemed) {
			return json(res, 409, {
				error: 'payment_already_used',
				feature: action,
				pay_per_use: price,
				message: 'That payment was already used. Pay again to keep this model.',
			});
		}
		return released('paid');
	}

	const access = await checkFeatureAccess(req, res, 'forge.keep', { body });
	if (access.eligible) return released('holder');
	return json(res, 402, {
		error: 'three_hold_required',
		feature: action,
		message: `Keeping this ${creation.tier} model costs $${price.usd.toFixed(2)} in $THREE, free for holders.`,
		pay_per_use: price,
		get_three_url: '/three-token',
	});
});
