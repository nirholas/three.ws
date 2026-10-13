// POST /api/shopify/media/attach { jobId }
//
// Attaches a staged GLB to its product via productCreateMedia, then records
// the Billing API usage charge for the conversion (the shop is only charged
// once the model is actually on the product, never for a generation the
// merchant discarded).

import { cors, method, wrap, error, json, readJson } from '../../_lib/http.js';
import { authenticateEmbeddedRequest, RequestAuthError } from '../../_lib/shopify/auth-request.js';
import { getMediaJob, setMediaJobAttached, getBillingSubscription } from '../../_lib/shopify/store.js';
import { attachModel3d } from '../../_lib/shopify/media.js';
import { recordUsage } from '../../_lib/shopify/billing.js';
import { ShopifyApiError } from '../../_lib/shopify/graphql.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	let shop, accessToken;
	try {
		({ shop, accessToken } = await authenticateEmbeddedRequest(req));
	} catch (err) {
		if (err instanceof RequestAuthError) return error(res, err.status, 'unauthorized', err.message);
		throw err;
	}

	const body = await readJson(req, 100_000);
	const jobId = String(body?.jobId || '');
	if (!jobId) return error(res, 400, 'missing_job_id', 'jobId is required');

	const job = await getMediaJob(shop, jobId);
	if (!job) return error(res, 404, 'not_found', 'no media job with that id for this shop');
	if (job.status !== 'ready_to_attach') {
		return error(res, 409, 'not_ready', `job is not ready to attach (status: ${job.status})`);
	}

	let media;
	try {
		media = await attachModel3d(shop, accessToken, {
			productId: job.product_id,
			resourceUrl: job.staged_resource_url,
			alt: job.product_title ? `${job.product_title} 3D model` : '3D model',
		});
	} catch (err) {
		if (err instanceof ShopifyApiError) return error(res, err.status || 502, 'shopify_api_error', err.message);
		throw err;
	}

	await setMediaJobAttached(jobId, media.id || null);

	const billing = await getBillingSubscription(shop);
	let usageRecorded = false;
	if (billing && billing.status === 'active') {
		try {
			await recordUsage(shop, accessToken, {
				lineItemId: billing.line_item_id,
				description: `3D model for "${job.product_title || job.product_id}"`,
			});
			usageRecorded = true;
		} catch (err) {
			// Attach already succeeded and must not be rolled back for a billing
			// hiccup; log loudly so a missed usage record is investigable, not silent.
			console.error('shopify usage record failed', shop, jobId, err?.message || err);
		}
	}

	return json(res, 200, { jobId, status: 'attached', media, usageRecorded });
});
