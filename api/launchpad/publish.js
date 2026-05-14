// POST /api/launchpad/publish
//
// Persists a Launchpad Studio configuration (src/editor/launchpad-studio.js)
// to launchpad_pages so it can be served at /p/<slug>. Anonymous publish is
// allowed — the studio is the "Wix of 3D avatars" surface and must work for
// drive-by creators with no account. If the request is authenticated the
// user_id is attached so the dashboard can list owned launchpads.
//
// Slug uniqueness: insert with ON CONFLICT — anonymous re-publish is
// rejected unless the wallet matches; authed re-publish is allowed if the
// user already owns the slug. This stops casual squat-and-overwrite without
// requiring a heavyweight ownership flow on day one.
//
// Body shape mirrors mountLaunchpadStudio's state object.

import { sql } from '../_lib/db.js';
import { authenticateBearer, extractBearer, getSessionUser } from '../_lib/auth.js';
import { cors, error, json, method, readJson, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { z } from 'zod';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_RE = /^0x[a-fA-F0-9]{40}$/;
const TEMPLATES = ['token-launchpad', 'paid-concierge', 'gated-showroom'];

const bodySchema = z.object({
	slug: z.string().regex(SLUG_RE, 'slug must be 1-40 chars, lowercase alphanumeric or hyphens'),
	template: z.enum(TEMPLATES),
	identity: z.object({
		slug: z.string().optional(),
		brand: z.string().max(20),
		wallet: z.string().min(20).max(64),
		website: z.string().max(300).optional().default(''),
		theme: z.enum(['light', 'dark']).default('light'),
	}),
	avatar: z.object({
		src: z.string().url().or(z.string().startsWith('/')),
		name: z.string().max(80),
	}),
	copy: z.object({
		headline: z.string().max(120),
		tagline: z.string().max(280),
		cta: z.string().max(40),
	}),
	token: z.object({
		name: z.string().max(80).optional().default(''),
		ticker: z.string().max(10).optional().default(''),
		supply: z.number().int().nonnegative().optional().default(0),
	}).optional(),
	skill: z.object({
		name: z.string().max(80).optional().default(''),
		priceUsdc: z.number().nonnegative().optional().default(0),
	}).optional(),
	scene: z.object({
		src: z.string().max(500).optional().default(''),
	}).optional(),
	monetize: z.object({
		kind: z.string().max(40),
		price: z.number().nonnegative(),
		currency: z.string().max(10),
		chain: z.string().max(20),
	}),
});

function validateWalletForChain(wallet, chain) {
	if (chain === 'solana') return SOL_RE.test(wallet);
	if (chain === 'base' || chain === 'polygon' || chain === 'ethereum') return EVM_RE.test(wallet);
	// Unknown chain — accept either format.
	return SOL_RE.test(wallet) || EVM_RE.test(wallet);
}

async function resolveAuth(req) {
	try {
		const session = await getSessionUser(req);
		if (session) return { userId: session.id };
	} catch {
		// Session decode failure is non-fatal; fall through to bearer/anon.
	}
	try {
		const bearer = await authenticateBearer(extractBearer(req));
		if (bearer) return { userId: bearer.userId };
	} catch {
		// Same — anonymous publish remains allowed.
	}
	return null;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many publish attempts — try again soon');

	const body = await readJson(req).catch(() => null);
	if (!body) return error(res, 400, 'validation_error', 'request body required');

	const parsed = bodySchema.safeParse(body);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return error(res, 400, 'validation_error', issue?.message || 'invalid input', { path: issue?.path });
	}
	const data = parsed.data;

	if (!validateWalletForChain(data.identity.wallet, data.monetize.chain)) {
		return error(
			res,
			400,
			'validation_error',
			`payout wallet does not look like a ${data.monetize.chain} address`,
		);
	}

	const auth = await resolveAuth(req);

	// Ownership check on existing slugs.
	const [existing] = await sql`
		SELECT slug, owner_wallet, user_id FROM launchpad_pages WHERE slug = ${data.slug}
	`;
	if (existing) {
		const wantsOwnerMatch =
			(auth && existing.user_id && existing.user_id === auth.userId) ||
			existing.owner_wallet?.toLowerCase() === data.identity.wallet.toLowerCase();
		if (!wantsOwnerMatch) {
			return error(res, 409, 'slug_taken', 'that slug is already published — pick a different one');
		}
	}

	const config = {
		identity: data.identity,
		avatar: data.avatar,
		copy: data.copy,
		token: data.token || {},
		skill: data.skill || {},
		scene: data.scene || {},
		monetize: data.monetize,
	};

	await sql`
		INSERT INTO launchpad_pages (slug, template, owner_wallet, user_id, config, updated_at)
		VALUES (${data.slug}, ${data.template}, ${data.identity.wallet}, ${auth?.userId || null}, ${JSON.stringify(config)}::jsonb, now())
		ON CONFLICT (slug) DO UPDATE SET
			template     = EXCLUDED.template,
			owner_wallet = EXCLUDED.owner_wallet,
			user_id      = COALESCE(EXCLUDED.user_id, launchpad_pages.user_id),
			config       = EXCLUDED.config,
			updated_at   = now()
	`;

	const origin =
		req.headers['x-forwarded-host']
			? `https://${req.headers['x-forwarded-host']}`
			: 'https://three.ws';

	return json(res, 200, {
		slug: data.slug,
		url: `${origin}/p/${data.slug}`,
		publishedAt: new Date().toISOString(),
	});
});
