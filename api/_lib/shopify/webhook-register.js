// Registers the mandatory compliance webhooks plus app/uninstalled right
// after OAuth completes, via webhookSubscriptionCreate (GraphQL) rather than
// shopify.app.toml's static [[webhooks.subscriptions]] block: this app is not
// deployed through the Shopify CLI's config-push flow, so the subscriptions
// have to be created the same way any non-CLI-managed app does.

import { appUrl } from './config.js';
import { adminGraphql, assertNoUserErrors } from './graphql.js';

const MUTATION = `
	mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
		webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
			webhookSubscription { id }
			userErrors { field message }
		}
	}
`;

const TOPIC_ENDPOINTS = Object.freeze({
	CUSTOMERS_DATA_REQUEST: '/api/shopify/webhooks/customers-data-request',
	CUSTOMERS_REDACT: '/api/shopify/webhooks/customers-redact',
	SHOP_REDACT: '/api/shopify/webhooks/shop-redact',
	APP_UNINSTALLED: '/api/shopify/webhooks/app-uninstalled',
});

export async function registerMandatoryWebhooks(shop, accessToken) {
	const base = appUrl();
	const results = {};
	for (const [topic, path] of Object.entries(TOPIC_ENDPOINTS)) {
		const data = await adminGraphql(shop, accessToken, MUTATION, {
			topic,
			webhookSubscription: { callbackUrl: `${base}${path}`, format: 'JSON' },
		});
		assertNoUserErrors(data, 'webhookSubscriptionCreate');
		results[topic] = data.webhookSubscriptionCreate.webhookSubscription.id;
	}
	return results;
}
