import { PutObjectCommand } from '@aws-sdk/client-s3';
import { r2, publicUrl } from '../_lib/r2.js';
import { cors, error, json, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { getSessionUser } from '../_lib/auth.js';
import { env } from '../_lib/env.js';

const ALLOWED = new Set([
	'model/gltf-binary',
	'model/gltf+json',
	'application/json',
	'application/octet-stream',
	'image/png',
	'image/jpeg',
	'image/webp',
]);

const MAX_SIZE = 25 * 1024 * 1024; // 25 MB

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (req.method !== 'POST') return error(res, 405, 'method_not_allowed', 'POST only');

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const ip = clientIp(req);
	const rl = await limits.authIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many uploads');

	const ct  = (req.headers['content-type'] || 'application/octet-stream').split(';')[0].trim();
	if (!ALLOWED.has(ct)) return error(res, 415, 'unsupported_media_type', 'unsupported content-type');

	const body = await readRaw(req, MAX_SIZE);

	// Determine extension from content-type
	const ext = getExt(ct);

	// Try IPFS first (web3.storage or nft.storage)
	const web3Token = process.env.WEB3_STORAGE_TOKEN;
	const nftToken = process.env.NFT_STORAGE_TOKEN;

	if (web3Token) {
		const result = await uploadToWeb3Storage(web3Token, ext, body, ct);
		return json(res, 200, result);
	}

	if (nftToken) {
		const result = await uploadToNftStorage(nftToken, ext, body, ct);
		return json(res, 200, result);
	}

	// Fallback to R2 with warning
	const key = `erc8004/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
	await r2.send(new PutObjectCommand({
		Bucket: env.S3_BUCKET,
		Key: key,
		Body: body,
		ContentType: ct,
	}));

	const url = publicUrl(key);
	return json(res, 200, {
		cid: null,
		uri: url,
		url,
		warning: 'R2-only pin — not decentralized',
	});
});

function getExt(ct) {
	switch (ct) {
		case 'application/json': return 'json';
		case 'model/gltf-binary': return 'glb';
		case 'image/png': return 'png';
		case 'image/jpeg': return 'jpg';
		case 'image/webp': return 'webp';
		default: return 'bin';
	}
}

async function uploadToWeb3Storage(token, ext, body, ct) {
	const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
	const formData = new FormData();
	const blob = new Blob([body], { type: ct });
	formData.append('file', blob, filename);

	const response = await fetch('https://api.web3.storage/upload', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${token}`,
		},
		body: formData,
	});

	if (!response.ok) {
		throw new Error(`web3.storage upload failed: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	const cid = data.cid;

	// web3.storage and nft.storage guarantee content-addressable uploads:
	// same bytes → same CID every time, idempotent by design.
	const uri = `ipfs://${cid}/${filename}`;
	const url = `https://w3s.link/ipfs/${cid}/${filename}`;

	return { cid, uri, url };
}

async function uploadToNftStorage(token, ext, body, ct) {
	const filename = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
	const formData = new FormData();
	const blob = new Blob([body], { type: ct });
	formData.append('file', blob, filename);

	const response = await fetch('https://api.nft.storage/upload', {
		method: 'POST',
		headers: {
			'Authorization': `Bearer ${token}`,
		},
		body: formData,
	});

	if (!response.ok) {
		throw new Error(`nft.storage upload failed: ${response.status} ${response.statusText}`);
	}

	const data = await response.json();
	const cid = data.value.cid;

	// nft.storage guarantees content-addressable uploads: same bytes → same CID.
	const uri = `ipfs://${cid}/${filename}`;
	const url = `https://w3s.link/ipfs/${cid}/${filename}`;

	return { cid, uri, url };
}

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
