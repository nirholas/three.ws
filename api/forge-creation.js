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
 *
 * Owner tag edit (work order 819). Florence-2 tags every creation's poster;
 * the owner (the forging browser's x-forge-client, or the signed-in account
 * the model was forged under) can replace or clear them. Tags go through the
 * same normalization and blocklist as generated ones, and a later re-describe
 * never overwrites an edit. GET answers `can_edit_tags` so the page knows
 * whether to show the editor.
 *
 * Deletion is scoped to the owning browser (the x-forge-client header that
 * scopes the gallery): only the client that forged a creation can delete it.
 * It permanently removes the stored GLB, the stored preview, every recorded
 * source upload (the reference photos an image-to-3D run was conditioned on),
 * and the row itself, so a deleted creation is gone from the gallery, the
 * community showcase, and the share/embed pages alike.
 */

import { embedReadCors, json, method, wrap, rateLimited, readJson } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { getPublicCreation, listRelated, recordCreationView, deleteCreation, hashClient, forgeStoreEnabled, isCreationOwner } from './_lib/forge-store.js';
import { setOwnerTags } from './_lib/creation-descriptions.js';
import { MAX_TAGS } from './_lib/creation-tags.js';
import { getSessionUser } from './_lib/auth.js';
import { isUuid } from './_lib/validate.js';

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
		const rawClient = req.headers['x-forge-client'];
		const clientHeader = Array.isArray(rawClient) ? rawClient[0] : rawClient;
		const user = await getSessionUser(req, res).catch(() => null);
		const owner = await isCreationOwner({ id, clientKey: clientHeader ? hashClient(clientHeader) : null, userId: user?.id ?? null });
		if (!owner) {
			// Same answer for "missing" and "not yours", so ids cannot be probed.
			return json(res, 404, { error: 'not_found', message: 'Only the creator of this model can edit its tags.' });
		}
		const body = await readJson(req, 16_000).catch(() => null);
		if (!body || !Array.isArray(body.tags) || body.tags.length > 50 || body.tags.some((t) => typeof t !== 'string')) {
			return json(res, 400, { error: 'invalid_tags', message: `Send { "tags": [...] } with up to ${MAX_TAGS} short words or phrases.` });
		}
		const saved = await setOwnerTags({ creationId: id, tags: body.tags });
		return json(res, 200, saved);
	}

	if (req.method === 'DELETE') {
		const rawClient = req.headers['x-forge-client'];
		const clientHeader = Array.isArray(rawClient) ? rawClient[0] : rawClient;
		if (!clientHeader) {
			return json(res, 401, { error: 'missing_client', message: 'x-forge-client header required.' });
		}
		const outcome = await deleteCreation({ id, clientKey: hashClient(clientHeader) });
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

	const creation = await getPublicCreation({ id, voterKey });
	if (!creation) {
		return json(res, 404, { enabled: true, creation: null });
	}

	// Whether to show the owner's tag editor. Only resolved when the caller
	// carries an identity at all, so the anonymous public read stays one query.
	const user = clientHeader || req.headers.cookie ? await getSessionUser(req, res).catch(() => null) : null;
	creation.can_edit_tags = await isCreationOwner({ id, clientKey: voterKey, userId: user?.id ?? null });

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
