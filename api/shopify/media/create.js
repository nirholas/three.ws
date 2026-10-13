// POST /api/shopify/media/create { productId, productTitle, imageUrl }
//
// Starts a Forge image→3D job for one product photo and records a tracking
// row. Reuses the exact /api/forge pipeline every other three.ws surface
// runs on (api/_mcp-studio/forge-client.js) rather than any new generation
// logic: this app is a thin orchestration layer over production infra that
// already exists.

import { cors, method, wrap, error, json, readJson } from '../../_lib/http.js';
import { authenticateEmbeddedRequest, RequestAuthError } from '../../_lib/shopify/auth-request.js';
import { createMediaJob, setMediaJobForgeId, setMediaJobFailed } from '../../_lib/shopify/store.js';
import { startForge, originFromReq } from '../../_mcp-studio/forge-client.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	let shop;
	try {
		({ shop } = await authenticateEmbeddedRequest(req));
	} catch (err) {
		if (err instanceof RequestAuthError) return error(res, err.status, 'unauthorized', err.message);
		throw err;
	}

	const body = await readJson(req, 1_000_000);
	const productId = String(body?.productId || '');
	const productTitle = typeof body?.productTitle === 'string' ? body.productTitle.slice(0, 500) : '';
	const imageUrl = String(body?.imageUrl || '');
	if (!productId || !imageUrl) return error(res, 400, 'missing_fields', 'productId and imageUrl are required');
	if (!/^https?:\/\//i.test(imageUrl)) return error(res, 400, 'invalid_image_url', 'imageUrl must be an http(s) URL');

	const id = await createMediaJob({ shop, productId, productTitle, imageUrl });

	try {
		const base = originFromReq(req);
		const job = await startForge(base, {
			imageUrls: [imageUrl],
			path: 'image',
			internal: true,
			clientKey: `shopify:${shop}`,
		});
		if (job.job_id) await setMediaJobForgeId(id, job.job_id);
		return json(res, 202, { jobId: id, forgeJobId: job.job_id || null, status: 'generating' });
	} catch (err) {
		await setMediaJobFailed(id, err?.message || 'failed to start generation');
		return error(res, 502, 'forge_submit_failed', err?.message || 'failed to start 3D generation');
	}
});
