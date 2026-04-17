// GET /api/pinning/status?cid=...
// Public endpoint — checks pin status across configured providers.
// Rate-limited to 60/min per IP.

import { cors, json, method, wrap, error } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

const CID_RE = /^[a-zA-Z0-9]+$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const ip = clientIp(req);
	const rl = await limits.pinStatusIp(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const cid = req.query?.cid || new URL(req.url, 'http://x').searchParams.get('cid');
	if (!cid || !CID_RE.test(cid)) {
		return error(res, 400, 'validation_error', 'cid query parameter is required and must be alphanumeric');
	}

	const pinataJwt = process.env.PINATA_JWT;
	const w3sToken = process.env.WEB3_STORAGE_TOKEN;

	const checks = [];

	if (pinataJwt) {
		checks.push(
			fetch(
				`https://api.pinata.cloud/data/pinList?hashContains=${encodeURIComponent(cid)}&status=pinned`,
				{ headers: { Authorization: `Bearer ${pinataJwt}` } },
			)
				.then(async (r) => {
					if (!r.ok) return null;
					const data = await r.json();
					const pinned = (data.rows || []).some((row) => row.ipfs_pin_hash === cid);
					return pinned ? 'pinata' : null;
				})
				.catch(() => null),
		);
	}

	if (w3sToken) {
		checks.push(
			fetch(`https://api.web3.storage/status/${encodeURIComponent(cid)}`, {
				headers: { Authorization: `Bearer ${w3sToken}` },
			})
				.then(async (r) => {
					if (!r.ok) return null;
					const data = await r.json();
					return data.cid === cid ? 'web3.storage' : null;
				})
				.catch(() => null),
		);
	}

	const providerResults = await Promise.all(checks);
	const activeProviders = providerResults.filter(Boolean);
	const pinned = activeProviders.length > 0;

	return json(res, 200, {
		cid,
		pinned,
		provider: activeProviders[0] || null,
		gatewayUrls: [
			`https://ipfs.io/ipfs/${cid}`,
			`https://cloudflare-ipfs.com/ipfs/${cid}`,
			`https://dweb.link/ipfs/${cid}`,
		],
	});
});
