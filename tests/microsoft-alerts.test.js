// Microsoft surface alerts (api/_lib/microsoft-alerts.js): which incidents are
// active, and the dedup contract that sends exactly one message per incident.
// Rows carry the columns the loader selects from the real tables.

import { describe, it, expect } from 'vitest';
import { detectIncidents, planAlerts, runMicrosoftAlerts } from '../api/_lib/microsoft-alerts.js';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const MIN = 60_000;
const THRESHOLD = { rate: 0.05, minCalls: 20 };
const none = () => ({ operations: [], usage: [], connector: [], teams: [] });

function op(over = {}) {
	return {
		id: 'op-1', subscription_id: 'sub-1', action: 'ChangePlan', plan_id: 'team', quantity: null, status: 'InProgress',
		outcome: 'received', error: null, received_at: at(MIN), processed_at: null, ...over,
	};
}

function rejected(over = {}) {
	return {
		id: 'u-1', subscription_id: 'sub-1', plan_id: 'pro', dimension: 'mcp_tool_calls', effective_start_time: at(3 * 60 * MIN),
		quantity: '4', status: 'rejected', message: 'The dimension is not found', attempts: 1, updated_at: at(30 * MIN), ...over,
	};
}

function surface(over = {}) {
	return {
		id: 1, surface: 'power_platform', operation: 'GenerateModel', status: 200, latency_ms: 100, tenant_id: null,
		conversation_id: null, user_id: null, client_id: null, source: 'header', error: null, created_at: at(5 * MIN), ...over,
	};
}

/** In-memory store with the same contract as incidentStore (conditional open). */
function memoryStore() {
	const rows = new Map();
	return {
		rows,
		async listOpen() { return [...rows.values()].filter((r) => !r.resolved_at); },
		async open(inc) {
			const cur = rows.get(inc.key);
			if (cur && !cur.resolved_at) return false;
			rows.set(inc.key, { ...inc, opened_at: NOW, resolved_at: null, notified_at: null, occurrences: 1 });
			return true;
		},
		async markNotified(key) { rows.get(key).notified_at = NOW; },
		async touch(keys) { for (const k of keys) rows.get(k).occurrences += 1; },
		async resolve(keys) { for (const k of keys) rows.get(k).resolved_at = NOW; },
	};
}

describe('detectIncidents', () => {
	it('finds nothing in a quiet system', () => {
		expect(detectIncidents(none(), NOW, THRESHOLD)).toEqual([]);
	});

	it('raises one incident per unacknowledged webhook operation', () => {
		const rows = none();
		rows.operations = [op(), op({ id: 'op-2', received_at: at(4000) }), op({ id: 'op-3', outcome: 'acknowledged_success', processed_at: at(MIN - 900) })];
		const found = detectIncidents(rows, NOW, THRESHOLD);
		expect(found.map((i) => i.key)).toEqual(['webhook_unacknowledged:op-1']);
		expect(found[0].detail).toContain('subscription sub-1');
		expect(found[0].detail).toContain('#webhook-unacknowledged');
	});

	it('groups metering rejections by subscription and dimension', () => {
		const rows = none();
		rows.usage = [rejected(), rejected({ id: 'u-2' }), rejected({ id: 'u-3', dimension: 'agent_messages' }), rejected({ id: 'old', updated_at: at(25 * 60 * MIN) })];
		const found = detectIncidents(rows, NOW, THRESHOLD);
		expect(found.map((i) => i.key)).toEqual(['metering_rejected:sub-1:mcp_tool_calls', 'metering_rejected:sub-1:agent_messages']);
		expect(found[0].title).toContain('2 metering events');
	});

	it('raises the connector error rate over the threshold and minimum call count', () => {
		const rows = none();
		rows.connector = Array.from({ length: 20 }, (_, i) => surface({ id: i, status: i < 2 ? 502 : 200 }));
		expect(detectIncidents(rows, NOW, THRESHOLD).map((i) => i.key)).toEqual(['connector_error_rate']);
		expect(detectIncidents(rows, NOW, { rate: 0.2, minCalls: 20 })).toEqual([]);
		expect(detectIncidents({ ...rows, connector: rows.connector.slice(0, 10) }, NOW, THRESHOLD)).toEqual([]);
	});

	it('raises teams_5xx for a recent bot 5xx only', () => {
		const rows = none();
		rows.teams = [surface({ surface: 'teams_bot', operation: 'composeExtension/query', status: 500, error: 'db timeout', created_at: at(2 * MIN) })];
		expect(detectIncidents(rows, NOW, THRESHOLD).map((i) => i.key)).toEqual(['teams_5xx']);
		rows.teams[0].created_at = at(20 * MIN);
		expect(detectIncidents(rows, NOW, THRESHOLD)).toEqual([]);
	});
});

describe('planAlerts', () => {
	it('opens new keys, keeps open ones and resolves cleared ones', () => {
		const plan = planAlerts([{ key: 'a' }, { key: 'b' }], [{ key: 'b' }, { key: 'c' }]);
		expect(plan.open.map((i) => i.key)).toEqual(['a']);
		expect(plan.keep.map((i) => i.key)).toEqual(['b']);
		expect(plan.resolve.map((i) => i.key)).toEqual(['c']);
	});
});

describe('runMicrosoftAlerts dedup', () => {
	it('sends one message per incident across ticks and again only after it resolves and recurs', async () => {
		const store = memoryStore();
		const sent = [];
		const send = async (title, detail, opts) => { sent.push({ title, opts }); };
		const bad = none();
		bad.teams = [surface({ surface: 'teams_bot', operation: 'composeExtension/query', status: 500, created_at: at(MIN) })];

		const first = await runMicrosoftAlerts({ now: NOW, rows: bad, store, send, threshold: THRESHOLD });
		expect(first.opened).toEqual(['teams_5xx']);
		expect(sent).toHaveLength(1);
		expect(sent[0].opts).toEqual({ signature: 'microsoft:teams_5xx', severity: 'critical' });

		const second = await runMicrosoftAlerts({ now: NOW, rows: bad, store, send, threshold: THRESHOLD });
		expect(second.opened).toEqual([]);
		expect(second.kept).toEqual(['teams_5xx']);
		expect(sent).toHaveLength(1);
		expect(store.rows.get('teams_5xx').occurrences).toBe(2);

		const quiet = await runMicrosoftAlerts({ now: NOW, rows: none(), store, send, threshold: THRESHOLD });
		expect(quiet.resolved).toEqual(['teams_5xx']);
		expect(sent).toHaveLength(1);

		await runMicrosoftAlerts({ now: NOW, rows: bad, store, send, threshold: THRESHOLD });
		expect(sent).toHaveLength(2);
	});

	it('does not send when another run already opened the incident', async () => {
		const store = memoryStore();
		const sent = [];
		const bad = none();
		bad.operations = [op()];
		const racing = { ...store, listOpen: async () => [], open: async () => false };
		const res = await runMicrosoftAlerts({ now: NOW, rows: bad, store: racing, send: async (t) => sent.push(t), threshold: THRESHOLD });
		expect(res.opened).toEqual([]);
		expect(sent).toEqual([]);
	});
});
