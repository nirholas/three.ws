import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error, readJson } from '../../_lib/http.js';
import { parse } from '../../_lib/validate.js';
import { readStorageMode, storageModeSchema, defaultStorageMode } from '../../_lib/storage-mode.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,PUT,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'PUT'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2];
	if (!id) return error(res, 400, 'validation_error', 'avatar id required');

	const [row] = await sql`
		SELECT id, owner_id, visibility FROM avatars WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!row) return error(res, 404, 'not_found', 'avatar not found');

	if (req.method === 'GET') {
		if (row.visibility === 'private') {
			const session = await getSessionUser(req);
			if (!session || session.id !== row.owner_id)
				return error(res, 403, 'forbidden', 'private avatar');
		}
		const mode = await readStorageMode(id);
		return json(res, 200, { storage_mode: mode });
	}

	// PUT — owner only
	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');
	if (session.id !== row.owner_id) return error(res, 403, 'forbidden', 'not your avatar');

	const body = parse(storageModeSchema, await readJson(req));

	// Read current stored mode to preserve attestation fields — clients must not
	// be able to forge tx_hash / chain_id / attested_at from the UI.
	const current = await readStorageMode(id);
	const safeBody = {
		...body,
		attestation: current?.attestation ?? defaultStorageMode().attestation,
	};

	await sql`UPDATE avatars SET storage_mode = ${JSON.stringify(safeBody)}::jsonb WHERE id = ${id}`;
	return json(res, 200, { storage_mode: safeBody });
});
