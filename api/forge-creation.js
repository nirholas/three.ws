/**
 * Forge creation — a single durable creation, fetched by id for sharing.
 *
 *   GET /api/forge-creation?id=<uuid>   → { enabled, creation }
 *
 * Unlike /api/forge-gallery (which is scoped to the requesting browser's
 * anonymous client key), this is a PUBLIC read: it returns any finished,
 * durably-stored creation by id so a share-link recipient — who never forged
 * the model and has no matching gallery row — can still view it in the full
 * forge UI. The share page (api/forge-share.js) lands real browsers on
 * /forge?share=<id>, and the page fetches this endpoint to open the model.
 *
 * Only finished creations with a durable glb_url are exposed; in-flight or
 * failed rows return { creation: null }. When persistence isn't configured the
 * endpoint returns { enabled: false, creation: null } so the page degrades
 * cleanly instead of showing a broken state.
 *
 * The model detail page (/m/:id) uses two additive params:
 *   ?related=<1..12>  includes a `related` array of suggested models
 *                     (same category first, newest, never the model itself)
 *   ?view=1           counts one page impression (fire-and-forget increment
 *                     of forge_creations.view_count; never blocks the read)
 *
 *   DELETE /api/forge-creation?id=<uuid>  → { deleted: true }
 *
 *   PATCH /api/forge-creation?id=<uuid>  { tags: string[] } → { tags, generatedTags }
 *   PATCH /api/forge-creation?id=<uuid>  { visibility } → { visibility }
 *
 * Owner credentials (any one is enough, issue #639):
 *   x-forge-client        the browser id the model was forged under
 *   session cookie        the signed-in account the model was forged under
 *   x-forge-manage-token  the per-creation `manage_token` the forge returned
 *                         with the job, for API callers that never sent (or
 *                         have lost) a client id
 * The shared anonymous bucket (callers that sent no x-forge-client) is never a
 * credential: everyone in it would otherwise own everyone else's models.
 *
 * Visibility: 'public' lists the model in the showcase, feeds, search and
 * sitemaps; 'unlisted' keeps its /m/:id page and share links working but out
 * of every list; 'private' takes the page down entirely.
 *
 * Owner tag edit (work order 819). Florence-2 tags every creation's poster;
 * the owner (the forging browser's x-forge-client, or the signed-in account
 * the model was forged under) can replace or clear them. Tags go through the
 * same normalization and blocklist as generated ones, and a later re-describe
 * never overwrites an edit. GET answers `can_edit_tags` so the page knows
 * whether to show the editor, and `is_owner` for the visibility and delete
 * controls.
 *
 * Deletion takes the same owner credentials. It permanently removes the stored GLB, the stored preview, every recorded
 * source upload (the reference photos an image-to-3D run was conditioned on),
 * every delivery variant stored under the creation's prefix, and the row, so a deleted creation is gone from the gallery, the
 * community showcase, and the share/embed pages alike.
 */

import { embedReadCors, json, method, wrap, rateLimited, readJson } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import {
	getPublicCreation,
	listRelated,
	recordCreationView,
	deleteCreation,
	hashClient,
	ownerClientKey,
	forgeStoreEnabled,
	isCreationOwner,
	setCreationVisibility,
	CREATION_VISIBILITIES,
} from './_lib/forge-store.js';
import { setOwnerTags } from './_lib/creation-descriptions.js';
import { MAX_TAGS } from './_lib/creation-tags.js';
import { getSessionUser } from './_lib/auth.js';
import { isUuid } from './_lib/validate.js';

function header(req, name) {
	const raw = req.headers[name];
	const value = Array.isArray(raw) ? raw[0] : raw;
	return typeof value === 'string' && value ? value : null;
}

// Every owner credential the request carries. The client key is dropped when it
// hashes to the shared anon bucket, so it can never authorize anything.
// `lazySession` skips the session lookup when the request carries no identity
// at all, so the anonymous public GET stays one query; writes always resolve it
// (a bearer-token session has no cookie).
async function ownerCredentials(req, res, { lazySession = false } = {}) {
	const clientHeader = header(req, 'x-forge-client');
	const manageToken = header(req, 'x-forge-manage-token') ?? undefined;
	const clientKey = clientHeader ? ownerClientKey(hashClient(clientHeader)) : null;
	const hasIdentity = Boolean(clientHeader || manageToken || req.headers.cookie || req.headers.authorization);
	const user = !lazySession || hasIdentity ? await getSessionUser(req, res).catch(() => null) : null;
	const creds = { clientKey, userId: user?.id ?? null };
	if (manageToken) creds.manageToken = manageToken;
	return creds;
}

export default wrap(async (req, res) => {
	// The anonymous read is public and is made from other origins (embeds, the Power
	// BI visual's sandboxed iframe), so it is open to any origin. DELETE keeps the
	// strict allowlist with credentials.
	if (embedReadCors(req, res, { methods: 'GET,OPTIONS', authedMethods: 'GET,PATCH,DELETE,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'PATCH', 'DELETE'])) return;

	const rl = await limits.mcp3dStatus(clientIp(req));
	if (!rl.success) {
		return rateLimited(res, rl);
	}

	if (!forgeStoreEnabled()) {
		return json(res, 200, { enabled: false, creation: null });
	}

	const url = new URL(req.url, 'http://localhost');
	const id = url.searchParams.get('id');
	if (!id || !isUuid(id)) {
		return json(res, 400, { enabled: true, creation: null, error: 'invalid id' });
	}

	if (req.method === 'PATCH') {
		const creds = await ownerCredentials(req, res);
		const body = await readJson(req, 16_000).catch(() => null);
		if (body && Object.prototype.hasOwnProperty.call(body, 'visibility')) {
			if (!CREATION_VISIBILITIES.includes(body.visibility)) {
				return json(res, 400, { error: 'invalid_visibility', message: `visibility must be one of: ${CREATION_VISIBILITIES.join(', ')}.` });
			}
			const out = await setCreationVisibility({ id, ...creds, visibility: body.visibility });
			if (out.outcome === 'updated') return json(res, 200, { visibility: out.visibility });
			if (out.outcome === 'not_found') {
				return json(res, 404, { error: 'not_found', message: 'Only the creator of this model can change who sees it.' });
			}
			return json(res, 503, { error: 'update_failed', message: 'Could not change visibility right now. Nothing changed; try again shortly.' });
		}
		const owner = await isCreationOwner({ id, ...creds });
		if (!owner) {
			// Same answer for "missing" and "not yours", so ids cannot be probed.
			return json(res, 404, { error: 'not_found', message: 'Only the creator of this model can edit its tags.' });
		}
		if (!body || !Array.isArray(body.tags) || body.tags.length > 50 || body.tags.some((t) => typeof t !== 'string')) {
			return json(res, 400, { error: 'invalid_tags', message: `Send { "tags": [...] } with up to ${MAX_TAGS} short words or phrases.` });
		}
		const saved = await setOwnerTags({ creationId: id, tags: body.tags });
		return json(res, 200, saved);
	}

	if (req.method === 'DELETE') {
		const creds = await ownerCredentials(req, res);
		if (!creds.clientKey && !creds.userId && !creds.manageToken) {
			return json(res, 401, {
				error: 'missing_credentials',
				message:
					'Send the x-forge-client id the model was forged under, the x-forge-manage-token the forge returned, or sign in to the account that made it. Lost all three? Ask for removal at /api/forge-removal-request.',
			});
		}
		const outcome = await deleteCreation({ id, ...creds });
		if (outcome === 'deleted') return json(res, 200, { deleted: true });
		if (outcome === 'not_found') {
			// Either the id doesn't exist or it belongs to another client; both
			// answer the same so ids can't be probed for existence.
			return json(res, 404, { deleted: false, error: 'not_found' });
		}
		return json(res, 503, {
			deleted: false,
			error: 'delete_failed',
			message: 'Could not delete right now. Nothing was removed; try again shortly.',
		});
	}

	// Optional anonymous browser id (same forge:cid the gallery uses) resolves
	// this browser's own voted-state on the model's like button.
	const rawClient = req.headers['x-forge-client'];
	const clientHeader = Array.isArray(rawClient) ? rawClient[0] : rawClient;
	const voterKey = clientHeader ? hashClient(clientHeader) : null;

	// Whether to show the owner's tag, visibility and delete controls. Only
	// resolved when the caller carries an identity at all, so the anonymous
	// public read stays one query.
	const creds = await ownerCredentials(req, res, { lazySession: true });
	const hasCreds = Boolean(creds.clientKey || creds.userId || creds.manageToken);

	let creation = await getPublicCreation({ id, voterKey });
	let isOwner = creation && hasCreds ? await isCreationOwner({ id, ...creds }) : false;
	// A private model is invisible to everyone but its maker, who still needs
	// the page to publish it again or delete it. Ownership is proven before the
	// private row is read, and that answer is never cached.
	let ownerOnly = false;
	if (!creation && hasCreds && (await isCreationOwner({ id, ...creds }))) {
		creation = await getPublicCreation({ id, voterKey, includePrivate: true });
		isOwner = Boolean(creation);
		ownerOnly = isOwner;
	}
	if (!creation) {
		return json(res, 404, { enabled: true, creation: null });
	}
	creation.can_edit_tags = isOwner;
	creation.is_owner = isOwner;
	const headers = ownerOnly || creation.visibility === 'private' ? { 'cache-control': 'private, no-store' } : undefined;

	if (url.searchParams.get('view') === '1') {
		// Deliberately not awaited past the increment failing soft: an uncounted
		// view must never break (or slow) the model read.
		recordCreationView({ id }).catch(() => {});
	}

	const relatedParam = Number(url.searchParams.get('related'));
	if (Number.isFinite(relatedParam) && relatedParam > 0) {
		const related = await listRelated({
			id,
			category: creation.model_category,
			limit: relatedParam,
		});
		return json(res, 200, { enabled: true, creation, related });
	}
	return json(res, 200, { enabled: true, creation });
});
