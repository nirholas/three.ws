// STUB — real pinning (Pinata / Web3.Storage) is a follow-up. For now this
// computes a placeholder CID from the stored sha256 and flips pinned_ipfs.

import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { readStorageMode } from '../../_lib/storage-mode.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2];
	if (!id) return error(res, 400, 'validation_error', 'avatar id required');

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const [row] = await sql`
		SELECT id, owner_id, checksum_sha256 FROM avatars WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!row) return error(res, 404, 'not_found', 'avatar not found');
	if (row.owner_id !== session.id) return error(res, 403, 'forbidden', 'not your avatar');

	const mode = await readStorageMode(id);
	if (!mode) return error(res, 500, 'internal', 'storage_mode unavailable');

	const stubCid = row.checksum_sha256
		? `stub:sha256-${row.checksum_sha256}`
		: `stub:no-hash-${id}`;

	const next = {
		...mode,
		ipfs: { pinned: true, cid: stubCid, pinned_at: new Date().toISOString() },
	};

	await sql`UPDATE avatars SET storage_mode = ${JSON.stringify(next)}::jsonb WHERE id = ${id}`;
	return json(res, 200, { storage_mode: next, stub: true });
});
