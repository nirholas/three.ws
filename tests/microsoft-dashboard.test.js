// Aggregates behind the internal Microsoft partnership board
// (api/_lib/microsoft-dashboard.js). Fixture rows carry exactly the columns
// the loader selects from the real tables (20261104180000_microsoft_marketplace_saas.sql
// and 20261111160517_microsoft_partnership_ops.sql).

import { describe, it, expect } from 'vitest';
import {
	priceForMicrosoftPlan, summarizeSubscriptions, summarizeOperations, meteringVerdict,
	summarizeMetering, teamsKind, summarizeTeams, summarizeConnector, summarizePartnerCenter,
	attentionList, connectorThreshold, dayKeys, ACK_DEADLINE_MS, runbook,
} from '../api/_lib/microsoft-dashboard.js';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const H = 3_600_000;
const D = 24 * H;

function sub(over = {}) {
	return { id: 'c7f3a1d2-0001-4000-8000-000000000001', plan_id: 'pro', quantity: null, saas_status: 'Subscribed', is_test: false, created_at: at(5 * D), ...over };
}

function op(over = {}) {
	return {
		id: 'op-1', subscription_id: 'sub-1', action: 'Renew', plan_id: 'pro', quantity: null, status: 'Succeeded',
		outcome: 'applied', error: null, received_at: at(2 * H), processed_at: at(2 * H - 400), ...over,
	};
}

function usage(over = {}) {
	return {
		id: 'u-1', subscription_id: 'sub-1', plan_id: 'pro', dimension: 'mcp_tool_calls', effective_start_time: at(3 * H),
		quantity: '12.000000', status: 'accepted', message: 'Accepted', attempts: 1, updated_at: at(2 * H), ...over,
	};
}

function teamsRow(over = {}) {
	return {
		id: 1, surface: 'teams_bot', operation: 'composeExtension/query', status: 200, latency_ms: 180,
		tenant_id: 'tenant-a', conversation_id: 'conv-1', user_id: null, client_id: null, source: null, error: null, created_at: at(H), ...over,
	};
}

function connectorRow(over = {}) {
	return {
		id: 1, surface: 'power_platform', operation: 'SearchAgents', status: 200, latency_ms: 90,
		tenant_id: null, conversation_id: null, user_id: '6f1c2f8e-2b1a-4c55-9a51-1c2d3e4f5a6b', client_id: 'pp-client', source: 'header', error: null, created_at: at(H), ...over,
	};
}

describe('plan prices', () => {
	it('prices Microsoft plans from data/plans.json through the plan map', () => {
		expect(priceForMicrosoftPlan('pro')).toBe(49);
		expect(priceForMicrosoftPlan('team')).toBe(79);
		expect(priceForMicrosoftPlan('enterprise')).toBe(299);
		expect(priceForMicrosoftPlan('gold-unknown')).toBeNull();
		expect(priceForMicrosoftPlan(null)).toBeNull();
	});
});

describe('summarizeSubscriptions', () => {
	it('counts by status, prices MRR by seats for Subscribed only, and skips test subscriptions', () => {
		const s = summarizeSubscriptions([
			sub({ id: 'a' }),
			sub({ id: 'b', plan_id: 'team', quantity: 3 }),
			sub({ id: 'c', saas_status: 'Suspended' }),
			sub({ id: 'd', saas_status: 'Unsubscribed', plan_id: 'enterprise' }),
			sub({ id: 'e', is_test: true, plan_id: 'enterprise' }),
		], NOW);
		expect(s.total).toBe(4);
		expect(s.tests).toBe(1);
		expect(s.by_status).toEqual({ PendingFulfillmentStart: 0, Subscribed: 2, Suspended: 1, Unsubscribed: 1 });
		expect(s.mrr_usd).toBe(49 + 79 * 3);
		const team = s.by_plan.find((p) => p.plan_id === 'team');
		expect(team).toMatchObject({ three_ws_plan: 'team', subscribed: 1, seats: 3, mrr_usd: 237 });
		expect(s.by_plan[0].plan_id).toBe('team');
	});

	it('flags a Subscribed row on an unmapped plan and a purchase pending activation for over a day', () => {
		const s = summarizeSubscriptions([
			sub({ id: 'x', plan_id: 'legacy-gold' }),
			sub({ id: 'p1', saas_status: 'PendingFulfillmentStart', created_at: at(30 * H) }),
			sub({ id: 'p2', saas_status: 'PendingFulfillmentStart', created_at: at(2 * H) }),
		], NOW);
		expect(s.mrr_usd).toBe(0);
		expect(s.unmapped_plans).toEqual([{ id: 'x', plan_id: 'legacy-gold' }]);
		expect(s.pending_activation.map((p) => p.id)).toEqual(['p1']);
	});
});

describe('summarizeOperations', () => {
	it('counts by action and outcome and lists failures with the exact record', () => {
		const s = summarizeOperations([
			op(),
			op({ id: 'op-2', action: 'Suspend', outcome: 'failed', error: 'Fulfillment API 503', received_at: at(D) }),
		], NOW, 7);
		expect(s.total).toBe(2);
		expect(s.by_action).toEqual({ Renew: 1, Suspend: 1 });
		expect(s.by_outcome).toEqual({ applied: 1, failed: 1 });
		expect(s.failures).toHaveLength(1);
		expect(s.failures[0]).toMatchObject({ id: 'op-2', subscription_id: 'sub-1', action: 'Suspend', error: 'Fulfillment API 503' });
		expect(s.series).toHaveLength(7);
		expect(s.series.reduce((n, p) => n + p.total, 0)).toBe(2);
		expect(s.series.reduce((n, p) => n + p.errors, 0)).toBe(1);
	});

	it('treats an InProgress ChangePlan not acknowledged past the deadline as unacknowledged', () => {
		const s = summarizeOperations([
			op({ id: 'late', action: 'ChangePlan', status: 'InProgress', outcome: 'received', processed_at: null, received_at: at(ACK_DEADLINE_MS + 1000) }),
			op({ id: 'fresh', action: 'ChangeQuantity', status: 'InProgress', outcome: 'received', processed_at: null, received_at: at(3000) }),
			op({ id: 'followup', action: 'ChangePlan', status: 'Succeeded', outcome: 'applied' }),
		], NOW);
		expect(s.unacknowledged.map((o) => [o.id, o.reason])).toEqual([['late', 'ack_deadline']]);
	});

	it('flags a non-ack row stuck at received and an ack that landed after the deadline', () => {
		const s = summarizeOperations([
			op({ id: 'stuck', action: 'Unsubscribe', outcome: 'received', processed_at: null, received_at: at(5 * 60_000) }),
			op({ id: 'slow', action: 'Reinstate', status: 'InProgress', outcome: 'acknowledged_success', received_at: at(H), processed_at: at(H - 14_000) }),
		], NOW);
		expect(s.unacknowledged.map((o) => [o.id, o.reason])).toEqual([['stuck', 'stuck_received']]);
		expect(s.late_acks).toHaveLength(1);
		expect(s.late_acks[0]).toMatchObject({ id: 'slow', took_ms: 14_000 });
	});
});

describe('metering', () => {
	it('splits Duplicate out of accepted using the stored Microsoft status', () => {
		expect(meteringVerdict({ status: 'accepted', message: 'Accepted' })).toBe('accepted');
		expect(meteringVerdict({ status: 'accepted', message: 'Duplicate' })).toBe('duplicate');
		expect(meteringVerdict({ status: 'expired', message: 'not accepted by Microsoft inside the 24 hour window' })).toBe('expired');
		expect(meteringVerdict({ status: 'rejected', message: 'Invalid dimension' })).toBe('rejected');
	});

	it('counts verdicts, sums accepted quantity per dimension, and reports the latest error', () => {
		const s = summarizeMetering([
			usage(),
			usage({ id: 'u-2', message: 'Duplicate', quantity: '3' }),
			usage({ id: 'u-3', status: 'rejected', message: 'The dimension is not found', dimension: 'agent_messages', updated_at: at(H) }),
			usage({ id: 'u-4', status: 'expired', message: 'not accepted by Microsoft inside the 24 hour window', updated_at: at(4 * H) }),
			usage({ id: 'u-5', status: 'pending', message: null, attempts: 0 }),
		], NOW, 7);
		expect(s.verdicts).toEqual({ accepted: 1, duplicate: 1, expired: 1, rejected: 1, pending: 1 });
		expect(s.by_dimension.find((d) => d.dimension === 'mcp_tool_calls').accepted_quantity).toBe(12);
		expect(s.rejected.map((r) => r.id)).toEqual(['u-3']);
		expect(s.expired.map((r) => r.id)).toEqual(['u-4']);
		expect(s.last_error).toMatchObject({ id: 'u-3', message: 'The dimension is not found', verdict: 'rejected' });
	});
});

describe('Teams bot', () => {
	it('classifies invoke names into search, unfurl and card actions', () => {
		expect(teamsKind('composeExtension/query')).toBe('search');
		expect(teamsKind('composeExtension/queryLink')).toBe('unfurl');
		expect(teamsKind('composeExtension/anonymousQueryLink')).toBe('unfurl');
		expect(teamsKind('adaptiveCard/action')).toBe('card_action');
		expect(teamsKind('message')).toBe('other');
	});

	it('counts tenants, conversations, extension use and 5xx in the right windows', () => {
		const s = summarizeTeams([
			teamsRow({ id: 1 }),
			teamsRow({ id: 2, operation: 'composeExtension/queryLink', conversation_id: 'conv-2' }),
			teamsRow({ id: 3, operation: 'adaptiveCard/action', tenant_id: 'tenant-b', conversation_id: 'conv-3' }),
			teamsRow({ id: 4, status: 500, error: 'db timeout', created_at: at(2 * H) }),
			teamsRow({ id: 5, status: 401, tenant_id: null, conversation_id: null }),
			teamsRow({ id: 6, tenant_id: 'tenant-old', conversation_id: 'conv-old', created_at: at(20 * D) }),
		], NOW, 30, 7);
		expect(s.activities).toBe(6);
		expect(s.activities_recent).toBe(5);
		expect(s.tenants).toBe(3);
		expect(s.active_tenants).toBe(2);
		expect(s.conversations).toBe(4);
		expect(s.message_extension).toEqual({ search: 3, unfurl: 1 });
		expect(s.card_actions).toBe(1);
		expect(s.unverified).toBe(1);
		expect(s.server_errors).toBe(1);
		expect(s.errors[0]).toMatchObject({ id: '4', status: 500, error: 'db timeout' });
		expect(s.series).toHaveLength(30);
	});
});

describe('Power Platform connector', () => {
	it('reports calls and error rate per operation over the recent window', () => {
		const s = summarizeConnector([
			connectorRow({ id: 1 }),
			connectorRow({ id: 2, latency_ms: 300 }),
			connectorRow({ id: 3, operation: 'GenerateModel', status: 502, error: null, source: 'oauth_client' }),
			connectorRow({ id: 4, operation: 'GenerateModel', status: 401 }),
			connectorRow({ id: 5, operation: 'GenerateModel', status: 500, created_at: at(10 * D) }),
		], NOW, 30, 7);
		expect(s.calls).toBe(4);
		expect(s.errors).toBe(1);
		expect(s.client_errors).toBe(1);
		expect(s.error_rate).toBeCloseTo(0.25);
		expect(s.by_source).toEqual({ header: 3, oauth_client: 1 });
		const gen = s.by_operation.find((o) => o.operation === 'GenerateModel');
		expect(gen).toMatchObject({ calls: 2, errors: 1, client_errors: 1, error_rate: 0.5 });
		expect(s.by_operation.find((o) => o.operation === 'SearchAgents').p95_latency_ms).toBe(300);
		expect(s.failures.map((f) => f.id)).toEqual(['3']);
		expect(s.series.reduce((n, p) => n + p.errors, 0)).toBe(2);
	});
});

describe('Partner Center', () => {
	it('reports each dataset, its last ingest and its error', () => {
		const s = summarizePartnerCenter(
			[{ dataset: 'orders', report_id: 'r-1', last_generated_at: at(D), last_ingested_at: at(H), last_row_count: 4, last_error: null, updated_at: at(H) },
			 { dataset: 'usage', report_id: null, last_generated_at: null, last_ingested_at: null, last_row_count: null, last_error: 'Partner Center returned 403', updated_at: at(H) }],
			[{ dataset: 'orders', rows: 4, customers: 2, revenue: '98.000000', currency: 'USD', latest: '2026-11-10' }],
			{ configured: true });
		expect(s.datasets.map((d) => d.dataset)).toEqual(['orders', 'usage', 'customers']);
		expect(s.datasets[0]).toMatchObject({ rows: 4, customers: 2, revenue: 98, currency: 'USD' });
		expect(s.errors.map((d) => d.dataset)).toEqual(['usage']);
	});
});

describe('attentionList', () => {
	const empty = () => ({
		subscriptions: summarizeSubscriptions([], NOW),
		operations: summarizeOperations([], NOW),
		metering: summarizeMetering([], NOW),
		teams: summarizeTeams([], NOW),
		connector: summarizeConnector([], NOW),
		partnerCenter: summarizePartnerCenter([], [], { configured: true }),
		incidents: { open: [], resolved: [] },
		config: { missing: [] },
		connectorThreshold: { rate: 0.05, minCalls: 20 },
	});

	it('is empty when nothing is wrong', () => {
		expect(attentionList(empty())).toEqual([]);
	});

	it('orders critical first and links each item to its runbook section', () => {
		const input = empty();
		input.config = { missing: ['MS_MARKETPLACE_TENANT_ID'] };
		input.metering = summarizeMetering([usage({ status: 'rejected', message: 'bad plan' })], NOW);
		input.subscriptions = summarizeSubscriptions([sub({ saas_status: 'PendingFulfillmentStart', created_at: at(2 * D) })], NOW);
		const list = attentionList(input);
		expect(list.map((i) => i.kind)).toEqual(['metering_rejected', 'pending_activation', 'config_missing']);
		expect(list[0].runbook).toBe(runbook('metering-rejected'));
		expect(list[0].record.message).toBe('bad plan');
	});

	it('raises the connector error rate only over the minimum call count', () => {
		const input = empty();
		const rows = Array.from({ length: 10 }, (_, i) => connectorRow({ id: i, status: i < 5 ? 500 : 200 }));
		input.connector = summarizeConnector(rows, NOW);
		expect(attentionList(input)).toEqual([]);
		input.connectorThreshold = { rate: 0.05, minCalls: 10 };
		expect(attentionList(input).map((i) => i.kind)).toEqual(['connector_error_rate']);
	});
});

describe('helpers', () => {
	it('builds UTC day keys ending today', () => {
		expect(dayKeys(NOW, 3)).toEqual(['2026-11-09', '2026-11-10', '2026-11-11']);
	});

	it('reads the connector threshold from env with safe defaults', () => {
		expect(connectorThreshold({})).toEqual({ rate: 0.05, minCalls: 20 });
		expect(connectorThreshold({ MS_ALERT_CONNECTOR_ERROR_RATE: '0.2', MS_ALERT_CONNECTOR_MIN_CALLS: '5' })).toEqual({ rate: 0.2, minCalls: 5 });
		expect(connectorThreshold({ MS_ALERT_CONNECTOR_ERROR_RATE: 'x', MS_ALERT_CONNECTOR_MIN_CALLS: '0' })).toEqual({ rate: 0.05, minCalls: 20 });
	});
});
