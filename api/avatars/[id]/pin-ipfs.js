// Pin an avatar's GLB to IPFS. Uses Pinata when PINATA_JWT is configured;
// otherwise falls back to a content-hash stub CID so dev environments still
// flip the pinned flag.

import { GetObjectCommand } from '@aws-sdk/client-s3';
import { sql } from '../../_lib/db.js';
import { getSessionUser } from '../../_lib/auth.js';
import { cors, json, method, wrap, error } from '../../_lib/http.js';
import { readStorageMode } from '../../_lib/storage-mode.js';
import { r2 } from '../../_lib/r2.js';
import { env } from '../../_lib/env.js';

const PINATA_ENDPOINT = 'https://api.pinata.cloud/pinning/pinFileToIPFS';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean)[2];
	if (!id) return error(res, 400, 'validation_error', 'avatar id required');

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const [row] = await sql`
		SELECT id, owner_id, checksum_sha256, storage_key, content_type, name
		FROM avatars WHERE id = ${id} AND deleted_at IS NULL
	`;
	if (!row) return error(res, 404, 'not_found', 'avatar not found');
	if (row.owner_id !== session.id) return error(res, 403, 'forbidden', 'not your avatar');

	const mode = await readStorageMode(id);
	if (!mode) return error(res, 500, 'internal', 'storage_mode unavailable');

	const pinataJwt = env.PINATA_JWT;
	let cid;
	let isStub = false;

	if (pinataJwt && row.storage_key) {
		try {
			cid = await pinToPinata({
				jwt: pinataJwt,
				key: row.storage_key,
				name: row.name || `avatar-${id}`,
				contentType: row.content_type || 'model/gltf-binary',
			});
		} catch (err) {
			return error(res, 502, 'upstream_error', `Pinata upload failed: ${err.message}`);
		}
	} else {
		isStub = true;
		cid = row.checksum_sha256 ? `stub:sha256-${row.checksum_sha256}` : `stub:no-hash-${id}`;
	}

	const next = {
		...mode,
		ipfs: { pinned: true, cid, pinned_at: new Date().toISOString() },
	};

	await sql`UPDATE avatars SET storage_mode = ${JSON.stringify(next)}::jsonb WHERE id = ${id}`;
	return json(res, 200, { storage_mode: next, stub: isStub });
});

async function pinToPinata({ jwt, key, name, contentType }) {
	const obj = await r2.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
	const bytes = await streamToBuffer(obj.Body);
	const blob = new Blob([bytes], { type: contentType });

	const form = new FormData();
	form.append('file', blob, name);
	form.append('pinataMetadata', JSON.stringify({ name }));

	const res = await fetch(PINATA_ENDPOINT, {
		method: 'POST',
		headers: { Authorization: `Bearer ${jwt}` },
		body: form,
	});
	if (!res.ok) {
		const body = await res.text().catch(() => '');
		throw new Error(`HTTP ${res.status} ${body.slice(0, 200)}`);
	}
	const data = await res.json();
	if (!data?.IpfsHash) throw new Error('no IpfsHash in Pinata response');
	return data.IpfsHash;
}

async function streamToBuffer(stream) {
	if (stream instanceof Uint8Array) return stream;
	if (typeof stream?.transformToByteArray === 'function') {
		return stream.transformToByteArray();
	}
	const chunks = [];
	for await (const chunk of stream) chunks.push(chunk);
	return Buffer.concat(chunks);
}
