// All shopify_* table access, isolated here so every route and webhook
// handler is a thin, mockable caller (see tests/shopify-*.test.js) instead of
// embedding `sql` queries inline.

import { sql } from '../db.js';

export async function saveShopSession(shop, accessToken, scope) {
	await sql`
		insert into shopify_shops (shop_domain, access_token, scope, installed_at, uninstalled_at)
		values (${shop}, ${accessToken}, ${scope}, now(), null)
		on conflict (shop_domain) do update
			set access_token = excluded.access_token,
			    scope = excluded.scope,
			    installed_at = now(),
			    uninstalled_at = null
	`;
}

export async function getShopSession(shop) {
	const rows = await sql`
		select shop_domain, access_token, scope, installed_at, uninstalled_at
		from shopify_shops
		where shop_domain = ${shop}
		limit 1
	`;
	return rows[0] || null;
}

export async function markShopUninstalled(shop) {
	await sql`update shopify_shops set uninstalled_at = now() where shop_domain = ${shop}`;
}

// Claims a webhook delivery before its body is interpreted, the same
// claim-before-parse shape as print_webhook_deliveries / forge_webhook_deliveries.
// Returns false when this (topic, delivery_id) pair has already been claimed,
// so the caller can answer Shopify's retry 200 without re-running the handler.
export async function claimWebhookDelivery(shop, topic, deliveryId) {
	const rows = await sql`
		insert into shopify_webhook_deliveries (shop_domain, topic, delivery_id)
		values (${shop}, ${topic}, ${deliveryId})
		on conflict (topic, delivery_id) do nothing
		returning topic
	`;
	return rows.length > 0;
}

export async function createMediaJob({ shop, productId, productTitle, imageUrl, forgeJobId }) {
	const rows = await sql`
		insert into shopify_media_jobs (shop_domain, product_id, product_title, image_url, forge_job_id, status)
		values (${shop}, ${productId}, ${productTitle || null}, ${imageUrl}, ${forgeJobId || null}, 'generating')
		returning id
	`;
	return rows[0].id;
}

export async function getMediaJob(shop, id) {
	const rows = await sql`
		select * from shopify_media_jobs where id = ${id} and shop_domain = ${shop} limit 1
	`;
	return rows[0] || null;
}

export async function setMediaJobReadyToAttach(id, { glbUrl, stagedResourceUrl }) {
	await sql`
		update shopify_media_jobs
		set status = 'ready_to_attach', glb_url = ${glbUrl}, staged_resource_url = ${stagedResourceUrl}, updated_at = now()
		where id = ${id}
	`;
}

export async function setMediaJobAttached(id, mediaId) {
	await sql`
		update shopify_media_jobs
		set status = 'attached', media_id = ${mediaId}, updated_at = now()
		where id = ${id}
	`;
}

export async function setMediaJobFailed(id, errorMessage) {
	await sql`
		update shopify_media_jobs
		set status = 'failed', error = ${String(errorMessage).slice(0, 2000)}, updated_at = now()
		where id = ${id}
	`;
}

export async function setMediaJobForgeId(id, forgeJobId) {
	await sql`update shopify_media_jobs set forge_job_id = ${forgeJobId}, updated_at = now() where id = ${id}`;
}

export async function saveBillingSubscription(shop, { subscriptionId, lineItemId, testMode, status }) {
	await sql`
		insert into shopify_billing (shop_domain, subscription_id, line_item_id, test_mode, status)
		values (${shop}, ${subscriptionId}, ${lineItemId}, ${testMode}, ${status})
		on conflict (shop_domain) do update
			set subscription_id = excluded.subscription_id,
			    line_item_id = excluded.line_item_id,
			    test_mode = excluded.test_mode,
			    status = excluded.status,
			    updated_at = now()
	`;
}

export async function getBillingSubscription(shop) {
	const rows = await sql`select * from shopify_billing where shop_domain = ${shop} limit 1`;
	return rows[0] || null;
}

export async function setBillingStatus(shop, status) {
	await sql`update shopify_billing set status = ${status}, updated_at = now() where shop_domain = ${shop}`;
}

// shop/redact fires 48h after uninstall and requires the app to actually
// erase shop-scoped records, unlike the two customer-scoped privacy webhooks
// (this app holds no customer PII, so those are no-ops). Deletes everything
// this app ever stored for the shop: media jobs, billing, and the session row.
export async function eraseShopData(shop) {
	await sql`delete from shopify_media_jobs where shop_domain = ${shop}`;
	await sql`delete from shopify_billing where shop_domain = ${shop}`;
	await sql`delete from shopify_shops where shop_domain = ${shop}`;
}
