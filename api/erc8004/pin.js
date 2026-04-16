import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, publicUrl } from '../_lib/r2.js';
import { cors, error, json, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { env } from '../_lib/env.js';

const ALLOWED = new Set([
	'model/gltf-binary',
	'model/gltf+json',
	'application/json',
	'application/octet-stream',
]);

const MAX_GLB  = 100 * 1024 * 1024; // 100 MB
const MAX_JSON =        1024 * 1024; //  1 MB

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'POST only');

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many uploads');

	const ct  = (req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
	if (!ALLOWED.has(ct)) return error(res, 415, 'unsupported_type', 'unsupported content-type');

	const isJson = ct === 'application/json';
	const ext    = isJson ? 'json' : 'glb';
	const body   = await readRaw(req, isJson ? MAX_JSON : MAX_GLB);

	const key = `erc8004/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

	await r2.send(new PutObjectCommand({
		Bucket: env.R2_BUCKET,
		Key: key,
		Body: body,
		ContentType: ct,
	}));

	return json(res, 200, { url: publicUrl(key) });
});

function readRaw(req, limit) {
	return new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		req.on('data', (chunk) => {
			total += chunk.length;
			if (total > limit) {
				reject(Object.assign(new Error('payload too large'), { status: 413 }));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on('end', () => resolve(Buffer.concat(chunks)));
		req.on('error', reject);
	});
}
