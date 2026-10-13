// Shopify Billing API: one usage-based AppSubscription per shop
// (shopify.dev/docs/apps/launch/billing/subscription-billing/create-usage-based-subscriptions),
// charged per product converted rather than a flat monthly fee, since usage
// tracks the real Forge cost this app incurs per model.

import { adminGraphql, assertNoUserErrors } from './graphql.js';
import { USAGE_PRICE_USD, USAGE_CAP_USD, billingTestMode } from './config.js';

const SUBSCRIPTION_CREATE = `
	mutation appSubscriptionCreate(
		$name: String!, $returnUrl: URL!, $test: Boolean!,
		$cappedAmount: MoneyInput!, $terms: String!
	) {
		appSubscriptionCreate(
			name: $name
			returnUrl: $returnUrl
			test: $test
			lineItems: [{
				plan: {
					appUsagePricingDetails: { cappedAmount: $cappedAmount, terms: $terms }
				}
			}]
		) {
			appSubscription { id lineItems { id } }
			confirmationUrl
			userErrors { field message }
		}
	}
`;

/**
 * Starts (or returns the pending confirmation for) a usage-based
 * subscription. The merchant must open `confirmationUrl` and approve it
 * before any usage record can be recorded: Shopify owns that approval
 * screen, this app only initiates it.
 */
export async function createUsageSubscription(shop, accessToken, returnUrl) {
	const data = await adminGraphql(shop, accessToken, SUBSCRIPTION_CREATE, {
		name: 'Photo to 3D product media',
		returnUrl,
		test: billingTestMode(),
		cappedAmount: { amount: USAGE_CAP_USD, currencyCode: 'USD' },
		terms: `$${USAGE_PRICE_USD} per product converted to a 3D model, capped at $${USAGE_CAP_USD}/month`,
	});
	assertNoUserErrors(data, 'appSubscriptionCreate');
	const { appSubscription, confirmationUrl } = data.appSubscriptionCreate;
	return {
		subscriptionId: appSubscription.id,
		lineItemId: appSubscription.lineItems[0].id,
		confirmationUrl,
		testMode: billingTestMode(),
	};
}

const ACTIVE_SUBSCRIPTIONS_QUERY = `
	query ActiveSubscriptions {
		currentAppInstallation {
			activeSubscriptions { id status lineItems { id } }
		}
	}
`;

/** Re-checks Shopify's own record of whether the subscription was approved. */
export async function fetchActiveSubscription(shop, accessToken) {
	const data = await adminGraphql(shop, accessToken, ACTIVE_SUBSCRIPTIONS_QUERY);
	return data.currentAppInstallation.activeSubscriptions[0] || null;
}

const USAGE_RECORD_CREATE = `
	mutation appUsageRecordCreate($subscriptionLineItemId: ID!, $price: MoneyInput!, $description: String!) {
		appUsageRecordCreate(
			subscriptionLineItemId: $subscriptionLineItemId
			price: $price
			description: $description
		) {
			appUsageRecord { id }
			userErrors { field message }
		}
	}
`;

export async function recordUsage(shop, accessToken, { lineItemId, description }) {
	const data = await adminGraphql(shop, accessToken, USAGE_RECORD_CREATE, {
		subscriptionLineItemId: lineItemId,
		price: { amount: USAGE_PRICE_USD, currencyCode: 'USD' },
		description,
	});
	assertNoUserErrors(data, 'appUsageRecordCreate');
	return data.appUsageRecordCreate.appUsageRecord.id;
}
