/**
 * Forge feedback — capture the human verdict on a generated 3D model.
 *
 *   POST /api/forge-feedback   { creation_id, outcome?, downloaded?, rating?, note?, destination? }
 *
 * This is the labeled half of the text→3D data flywheel. /forge stores every
 * (prompt → reference image → mesh) triple; this endpoint attaches whether a
 * human kept it, threw it away, downloaded it, or rated it — the signal a future
 * in-house reconstruction model trains and evaluates against.
 *
 * `destination` is what the model is for (game, web, avatar, simulation, print,
 * ar, play; see src/shared/forge-destinations.js). It is normally sent with the
 * generation request itself; accepting it here lets a maker answer after the
 * fact, on a model they already have. An unrecognised value is ignored.
 *
 * Auth-free like the rest of /forge: writes are scoped to the anonymous client
 * key (x-forge-client header) so a verdict can only be recorded against a row
 * the same browser created. When the store is unconfigured the endpoint returns
 * a clean { ok: false, stored: false } instead of failing.
 */

import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { hashClient, recordFeedback, forgeStoreEnabled } from './_lib/forge-store.js';
import { isUuid } from './_lib/validate.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.mcp3dStatus(clientIp(req));
	if (!rl.success) {
		return rateLimited(res, rl);
	}

	if (!forgeStoreEnabled()) {
		return json(res, 200, { ok: false, stored: false, reason: 'persistence_unconfigured' });
	}

	const body = await readJson(req, 8_000).catch(() => null);
	const creationId = typeof body?.creation_id === 'string' ? body.creation_id.trim() : '';
	if (!isUuid(creationId)) {
		return json(res, 400, { error: 'invalid_creation', message: 'creation_id must be a uuid.' });
	}

	const rawClient = req.headers['x-forge-client'];
	const clientKey = hashClient(Array.isArray(rawClient) ? rawClient[0] : rawClient);

	const stored = await recordFeedback({
		id: creationId,
		clientKey,
		outcome: body?.outcome,
		downloaded: body?.downloaded === true,
		rating: Number.isInteger(body?.rating) ? body.rating : undefined,
		note: typeof body?.note === 'string' ? body.note : undefined,
		destination: body?.destination,
	});

	// `stored: false` means no row matched this client+id (or nothing to write) —
	// not an error worth surfacing to the user, but honest to the caller.
	return json(res, 200, { ok: true, stored });
});
