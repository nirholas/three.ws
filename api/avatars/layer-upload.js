// POST /api/avatars/layer-upload: store a user's own sprite for an avatar texture layer.
// GET  /api/avatars/layer-upload?id=<id>: read back the signed-in user's own sprite.
//
// Body (POST): { png_base64: "data:image/png;base64,..." | "<raw base64>" }
// The image is decoded, fitted inside 512x512 and re-encoded as a plain RGBA
// PNG (which drops metadata and anything that is not a real image), then stored
// at u/<userId>/layers/<id>.png where <id> is a content hash. The appearance
// references it as `upload:<id>`; the baker reads the key from the avatar's own
// owner prefix, so one account can never bake another's upload.

import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { getSessionUser, authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { putObject, getObjectBuffer } from '../_lib/r2.js';
import { cors, error, json, method, readJson, wrap, rateLimited } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';

const MAX_INPUT_BYTES = 2_000_000;
// base64 inflates 4/3, plus the JSON envelope
const MAX_BODY_BYTES = Math.ceil((MAX_INPUT_BYTES * 4) / 3) + 1024;
const MAX_EDGE = 512;
const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const auth = await resolveAuth(req);
	if (!auth) return error(res, 401, 'unauthorized', 'sign in to use your own layer images');

	if (req.method === 'GET') {
		const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
		if (!ID_RE.test(id)) return error(res, 400, 'invalid_request', 'id is not a valid layer id');
		let buf;
		try {
			buf = await getObjectBuffer(`u/${auth.userId}/layers/${id}.png`);
		} catch {
			return error(res, 404, 'not_found', 'no such layer image on your account');
		}
		res.statusCode = 200;
		res.setHeader('content-type', 'image/png');
		res.setHeader('cache-control', 'private, max-age=3600');
		res.end(buf);
		return;
	}

	const rl = await limits.upload(auth.userId);
	if (!rl.success) return rateLimited(res, rl, 'layer upload rate exceeded');

	const body = await readJson(req, MAX_BODY_BYTES).catch(() => null);
	const raw = typeof body?.png_base64 === 'string' ? body.png_base64.replace(/^data:image\/[a-z]+;base64,/, '') : '';
	if (!raw) return error(res, 400, 'invalid_request', 'png_base64 required');
	const input = Buffer.from(raw, 'base64');
	if (input.length < 64 || input.length > MAX_INPUT_BYTES) {
		return error(res, 413, 'too_large', `image must be 64..${MAX_INPUT_BYTES} bytes`);
	}

	let png;
	try {
		png = await sharp(input, { limitInputPixels: 16_000_000 })
			.rotate()
			.resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
			.ensureAlpha()
			.png()
			.toBuffer();
	} catch {
		return error(res, 422, 'invalid_image', 'that file is not an image we can read: use a PNG, JPEG or WebP');
	}

	const id = createHash('sha256').update(png).digest('hex').slice(0, 24);
	await putObject({
		key: `u/${auth.userId}/layers/${id}.png`,
		body: png,
		contentType: 'image/png',
		metadata: { 'uploaded-by': auth.userId },
	});
	return json(res, 200, { data: { id, source: `upload:${id}`, bytes: png.length } });
});

async function resolveAuth(req) {
	const session = await getSessionUser(req);
	if (session) return { userId: session.id };
	const bearer = await authenticateBearer(extractBearer(req));
	if (bearer && hasScope(bearer.scope, 'avatars:write')) return { userId: bearer.userId };
	return null;
}
