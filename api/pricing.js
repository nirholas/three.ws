// GET /api/pricing — the canonical pricing surface, server-truth.
//
// One endpoint a buyer reads before they spend a cent. It aggregates the THREE
// sources of pricing truth into one shape so the pricing page never hardcodes a
// number:
//   • actions — every priced action from the pricing catalog (USD, settled in $THREE)
//   • fee     — the platform fee rate (api/_lib/fee.js)
//   • tiers   — the $THREE holder discount ladder (api/_lib/three-tier.js, D1)
//   • holder  — PERSONALIZED "you hold $THREE, your price": when the caller is
//               signed in with a linked wallet, their resolved tier + the
//               discounted price of every fixed action. Never blocks on the
//               balance read — degrades to the public price on any RPC hiccup.
//
// Public + cacheable for the anonymous shape; the personalized shape is computed
// per-user and sent no-store. No secrets — safe to serve unauthenticated.

import { cors, json, method, wrap } from './_lib/http.js';
import { getSessionUser } from './_lib/auth.js';
import { getFeeBps } from './_lib/fee.js';
import { publicCatalog, priceForAction } from './_lib/pricing/catalog.js';
import { TIERS, resolveUserTier, nextTier } from './_lib/three-tier.js';
import { TOKEN_MINT, TOKEN_SYMBOL } from './_lib/token/config.js';

function tierLadder() {
	return TIERS.map((t) => ({
		level: t.level,
		id: t.id,
		label: t.label,
		min_usd: t.minUsd,
		discount_bps: t.discountBps,
		discount_percent: (t.discountBps / 100).toFixed(t.discountBps % 100 === 0 ? 0 : 1),
		rate_multiplier: t.rateMultiplier,
		// Delivered today vs registered-but-unenforced. Kept apart so a machine
		// reading this endpoint cannot mistake a roadmap line for a benefit.
		perks: t.perks,
		planned: t.planned ?? [],
	}));
}

// Apply a holder discount to every fixed-price action, mirroring the EXACT clamp
// logic the charge rail uses (priceForAction) so the "your price" shown here is
// the price actually quoted at checkout — never a second, drifting copy.
function personalizedActions(actions, discountBps) {
	return actions.map((a) => {
		if (a.usd == null || discountBps <= 0) return { ...a, your_usd: a.usd };
		try {
			const { usd } = priceForAction(a.id, { discountBps });
			return { ...a, your_usd: usd };
		} catch {
			return { ...a, your_usd: a.usd };
		}
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const fee_bps = getFeeBps();
	const actions = publicCatalog();
	const base = {
		currency: { quote: 'USD', settle: TOKEN_SYMBOL, mint: TOKEN_MINT },
		fee: { bps: fee_bps, percent: (fee_bps / 100).toFixed(1) },
		tiers: tierLadder(),
		actions,
	};

	// Personalize when signed in — but never let the balance read fail the page.
	let user = null;
	try {
		user = await getSessionUser(req);
	} catch {
		user = null;
	}

	if (!user) {
		return json(res, 200, { ...base, holder: null }, {
			'cache-control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
		});
	}

	let holder = null;
	let pricedActions = actions;
	try {
		const { tier, usd, next } = await resolveUserTier(user);
		const nt = next ?? nextTier(tier);
		holder = {
			tier: {
				level: tier.level,
				id: tier.id,
				label: tier.label,
				discount_bps: tier.discountBps,
				perks: tier.perks,
				planned: tier.planned ?? [],
			},
			usd_held: Math.round((Number(usd) || 0) * 100) / 100,
			discount_bps: tier.discountBps,
			discount_percent: (tier.discountBps / 100).toFixed(tier.discountBps % 100 === 0 ? 0 : 1),
			next_tier: nt ? { id: nt.id, label: nt.label, min_usd: nt.minUsd, discount_bps: nt.discountBps } : null,
			usd_to_next: nt ? Math.max(0, Math.round((nt.minUsd - (Number(usd) || 0)) * 100) / 100) : 0,
		};
		if (tier.discountBps > 0) pricedActions = personalizedActions(actions, tier.discountBps);
	} catch {
		holder = null;
	}

	return json(res, 200, { ...base, actions: pricedActions, holder }, { 'cache-control': 'no-store' });
});
