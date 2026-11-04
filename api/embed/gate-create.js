// POST   /api/embed/gate-create
// GET    /api/embed/gate-create?assetId=   the asset's active gate, or gate: null
// DELETE /api/embed/gate-create?assetId=   remove the gate (back to an open embed)
//
// create_gated_embed(asset_id, gate) — turn an existing embeddable asset
// (avatar or on-chain agent) into a holder-only interactive 3D embed. The
// caller must own the asset; the gate config `{ mint, min_amount, chain }` is
// persisted alongside the embed record (embed_gates) and enforced server-side
// by api/embed/resolve.js on every subsequent fetch — this endpoint never
// hands back the glbUrl itself, only the gate + a ready-to-paste snippet.
//
// `mint` defaults to $THREE but is a runtime parameter — the coin-agnostic
// plumbing exception in CLAUDE.md — so any community can gate with their own
// SPL token. This endpoint never suggests or defaults to any other mint.
//
// GET and DELETE back Widget Studio's "Holders only" panel (public/studio/
// gate-panel.js), which reads the gate from here on every avatar pick so it
// shows what resolve.js actually enforces. Both are owner-only, like create.
import { z } from 'zod';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';
import { parse } from '../_lib/validate.js';
import { isEmbedAssetRef, resolveEmbedAsset } from '../_lib/embed-asset.js';
import {
	DEFAULT_GATE_MINT,
	createEmbedGate,
	checkAssetOwnership,
	readEmbedGateByAsset,
	revokeEmbedGate,
} from '../_lib/embed-gate.js';

const bodySchema = z.object({
	assetId: z.string().trim().min(3).max(80),
	gate: z.object({
		mint: z.string().trim().min(3).max(64).optional(),
		minAmount: z.number().positive(),
		chain: z.enum(['solana']).optional(),
	}),
});

const ASSET_SPEC_MESSAGE = 'assetId must be "<chainId>:<agentId>", "eip155:<chainId>:<agentId>", or "avatar:<uuid>"';
const NOT_OWNER_MESSAGE = 'you do not own this asset, link the owning wallet (or account) to gate it';

/** The paste-ready embed for a gated asset. The glbUrl never appears here. */
function gatedEmbed(assetId) {
	const scriptSrc = `${env.APP_ORIGIN}/embed/v1.js`;
	return {
		scriptSrc,
		snippet: `<script src="${scriptSrc}" async></script>\n` + `<three-d agent="${assetId}" interactive></three-d>`,
		previewUrl: `${env.APP_ORIGIN}/embed/v1/gated.html?asset=${encodeURIComponent(assetId)}`,
	};
}

/**
 * Session or bearer identity, the rate limit, then the owner check every
 * method shares. `assetId` may be a function so create can parse its body only
 * after the caller is known. Returns { userId, assetId, asset }, or null once
 * it has written the error response.
 */
async function authorizeOwner(req, res, assetId, { limiter }) {
	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) {
		error(res, 401, 'unauthorized', 'sign in required to gate an embed');
		return null;
	}
	const userId = session?.id ?? bearer.userId;

	const rl = await limiter(userId);
	if (!rl.success) {
		rateLimited(res, rl);
		return null;
	}

	const spec = typeof assetId === 'function' ? await assetId() : assetId;
	if (!isEmbedAssetRef(spec)) {
		error(res, 400, 'validation_error', ASSET_SPEC_MESSAGE);
		return null;
	}

	const asset = await resolveEmbedAsset(spec);
	if (!asset) {
		error(res, 404, 'not_found', 'embed asset not found');
		return null;
	}

	const ownership = await checkAssetOwnership(spec, userId);
	if (!ownership.ok) {
		if (ownership.reason === 'not_owner') error(res, 403, 'not_owner', NOT_OWNER_MESSAGE);
		else error(res, 404, 'not_found', 'embed asset not found');
		return null;
	}
	return { userId, assetId: spec, asset };
}

function queryAssetId(req) {
	return String(new URL(req.url, 'http://x').searchParams.get('assetId') || '').trim();
}

async function handleRead(req, res) {
	const auth = await authorizeOwner(req, res, queryAssetId(req), {
		limiter: (userId) => limits.embedGateReadUser(userId),
	});
	if (!auth) return;
	const row = await readEmbedGateByAsset(auth.assetId);
	if (!row) {
		return json(res, 200, { gateId: null, assetId: auth.assetId, gate: null, name: auth.asset.name || null, embed: null });
	}
	return json(res, 200, {
		gateId: row.id,
		assetId: auth.assetId,
		gate: { mint: row.mint, minAmount: Number(row.min_amount), chain: row.chain },
		name: auth.asset.name || null,
		createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
		embed: gatedEmbed(auth.assetId),
	});
}

async function handleRevoke(req, res) {
	const auth = await authorizeOwner(req, res, queryAssetId(req), {
		limiter: () => limits.embedGateCreateIp(clientIp(req)),
	});
	if (!auth) return;
	const revoked = await revokeEmbedGate(auth.assetId);
	return json(res, 200, { assetId: auth.assetId, revoked: revoked > 0 });
}

async function handleCreate(req, res) {
	let body = null;
	const auth = await authorizeOwner(
		req,
		res,
		async () => {
			body = parse(bodySchema, await readJson(req));
			return body.assetId;
		},
		{ limiter: () => limits.embedGateCreateIp(clientIp(req)) },
	);
	if (!auth) return;

	let gate;
	try {
		gate = await createEmbedGate({
			assetId: auth.assetId,
			ownerUserId: auth.userId,
			mint: body.gate.mint || DEFAULT_GATE_MINT,
			minAmount: body.gate.minAmount,
			chain: body.gate.chain || 'solana',
		});
	} catch (err) {
		return error(res, err.status || 400, 'validation_error', err.message);
	}

	return json(res, 201, {
		gateId: gate.gateId,
		assetId: gate.assetId,
		gate: { mint: gate.mint, minAmount: gate.minAmount, chain: gate.chain },
		name: auth.asset.name || null,
		embed: gatedEmbed(auth.assetId),
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;
	res.setHeader('cache-control', 'no-store');

	if (req.method === 'GET') return handleRead(req, res);
	if (req.method === 'DELETE') return handleRevoke(req, res);
	return handleCreate(req, res);
});
