// GET /api/shopify/media/status?job=<id>
//
// One-shot status check for a media job, polled by the embedded UI. Does a
// single non-blocking GET against /api/forge (never the blocking pollJob
// loop: this is an HTTP handler, not a background worker) and, the moment
// Forge reports done, stages the resulting GLB into Shopify's upload storage
// so the UI's next action (attach) is instant.

import { cors, method, wrap, error, json } from '../../_lib/http.js';
import { authenticateEmbeddedRequest, RequestAuthError } from '../../_lib/shopify/auth-request.js';
import { getMediaJob, setMediaJobReadyToAttach, setMediaJobFailed } from '../../_lib/shopify/store.js';
import { originFromReq } from '../../_mcp-studio/forge-client.js';
import { stageAndUploadGlb } from '../../_lib/shopify/media.js';
import { ShopifyApiError } from '../../_lib/shopify/graphql.js';

async function pollForgeOnce(base, forgeJobId) {
	const res = await fetch(`${base}/api/forge?job=${encodeURIComponent(forgeJobId)}`, {
		headers: { accept: 'application/json' },
		signal: AbortSignal.timeout(20_000),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.message || `generation poll returned ${res.status}`);
	return data;
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	let shop, accessToken;
	try {
		({ shop, accessToken } = await authenticateEmbeddedRequest(req));
	} catch (err) {
		if (err instanceof RequestAuthError) return error(res, err.status, 'unauthorized', err.message);
		throw err;
	}

	const url = new URL(req.url, 'http://x');
	const jobId = url.searchParams.get('job') || '';
	if (!jobId) return error(res, 400, 'missing_job', 'job query param is required');

	const job = await getMediaJob(shop, jobId);
	if (!job) return error(res, 404, 'not_found', 'no media job with that id for this shop');

	if (job.status !== 'generating' || !job.forge_job_id) {
		return json(res, 200, { jobId, status: job.status, glbUrl: job.glb_url || null, error: job.error || null });
	}

	let forgeState;
	try {
		forgeState = await pollForgeOnce(originFromReq(req), job.forge_job_id);
	} catch (err) {
		return json(res, 200, { jobId, status: 'generating', error: null, pollError: err?.message || 'poll failed' });
	}

	if (forgeState.status === 'failed') {
		await setMediaJobFailed(jobId, forgeState.error || 'generation failed');
		return json(res, 200, { jobId, status: 'failed', error: forgeState.error || 'generation failed' });
	}

	if (!(forgeState.status === 'done' && forgeState.glb_url)) {
		return json(res, 200, { jobId, status: 'generating', error: null });
	}

	try {
		const glbRes = await fetch(forgeState.glb_url, { signal: AbortSignal.timeout(30_000) });
		if (!glbRes.ok) throw new Error(`fetching generated GLB returned ${glbRes.status}`);
		const bytes = Buffer.from(await glbRes.arrayBuffer());
		const resourceUrl = await stageAndUploadGlb(shop, accessToken, {
			filename: `${job.product_id.replace(/[^a-zA-Z0-9-]/g, '_')}.glb`,
			bytes,
		});
		await setMediaJobReadyToAttach(jobId, { glbUrl: forgeState.glb_url, stagedResourceUrl: resourceUrl });
		return json(res, 200, { jobId, status: 'ready_to_attach', glbUrl: forgeState.glb_url, error: null });
	} catch (err) {
		const message = err instanceof ShopifyApiError ? err.message : err?.message || 'staging the GLB to Shopify failed';
		await setMediaJobFailed(jobId, message);
		return json(res, 200, { jobId, status: 'failed', error: message });
	}
});
