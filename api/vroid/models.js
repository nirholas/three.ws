// GET /api/vroid/models: the user's own VRoid Hub character models plus
// their hearted models that allow download, each annotated with what their
// license permits on three.ws (api/_lib/vroid/license.js). The picker page
// at /import/vroid renders exactly this list.
//
// Hub API shapes used here, per developer.vroid.com/en/api/list-character.html
// ("List/Detail character models, Account information", the live API
// reference, not the consumer-facing hub.vroid.com pages):
//   GET /api/account/character_models: the signed-in user's own models
//   GET /api/hearts: models the user hearted (requires
//                     application_id=<our client id>)
// Both answer inside the {data,error,_links,rand} envelope; `data` is an
// array of CharacterModelSerializer objects whose `license` field is the
// CharacterModelLicenseSerializer shape api/_lib/vroid/license.js evaluates.

import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, error, wrap } from '../_lib/http.js';
import { vroidConfigured, clientId } from '../_lib/vroid/config.js';
import { hubGet, ACCOUNT_MODELS_PATH, HEARTS_PATH } from '../_lib/vroid/client.js';
import { getValidVroidToken } from '../_lib/vroid/token-store.js';
import { evaluateLicense } from '../_lib/vroid/license.js';

function summarizeModel(raw, { hearted } = {}) {
	const evaluated = evaluateLicense(raw?.license);
	return {
		id: raw?.id ?? null,
		name: raw?.name || raw?.character?.name || 'Untitled character',
		creator_name: raw?.character?.user?.name || null,
		thumbnail_url: raw?.portrait_image?.w300?.url || raw?.portrait_image?.original?.url || null,
		downloadable: raw?.is_downloadable !== false,
		hearted: Boolean(hearted || raw?.is_hearted),
		license: evaluated.license,
		actions: evaluated.actions,
		credit_required: evaluated.creditRequired,
		license_summary: evaluated.summary,
		license_url: evaluated.licenseUrl,
	};
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	if (!vroidConfigured()) {
		return error(res, 501, 'not_configured', 'VRoid Hub is not connected on this deployment yet');
	}

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const accessToken = await getValidVroidToken(session.id);
	if (!accessToken) {
		return error(res, 409, 'not_connected', 'connect your VRoid Hub account first', {
			connect_url: '/api/auth/vroid/connect',
		});
	}

	let ownModels = [];
	let heartedModels = [];
	try {
		const [ownData, heartsData] = await Promise.all([
			hubGet(ACCOUNT_MODELS_PATH, accessToken, { query: { publication: 'all', count: 100 } }).catch((err) => {
				console.error('[vroid-hub] account models fetch failed', err?.message || err);
				return [];
			}),
			// application_id is required by this endpoint; is_downloadable defaults
			// true server-side, so the hearted list is already download-eligible.
			hubGet(HEARTS_PATH, accessToken, { query: { application_id: clientId(), count: 100 } }).catch((err) => {
				console.error('[vroid-hub] hearts fetch failed', err?.message || err);
				return [];
			}),
		]);
		ownModels = Array.isArray(ownData) ? ownData : [];
		heartedModels = Array.isArray(heartsData) ? heartsData : [];
	} catch (err) {
		return error(res, 502, 'upstream_error', err?.message || 'VRoid Hub did not answer');
	}

	const own = ownModels.map((m) => summarizeModel(m, { hearted: false }));
	const hearted = heartedModels.map((m) => summarizeModel(m, { hearted: true })).filter((m) => m.downloadable);

	return json(res, 200, { own, hearted });
});
