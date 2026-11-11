// Partner Center analytics ingestion (api/_lib/microsoft-partner-center.js).
// CSV fixtures use the column names of Microsoft's system queries for ISVOrder,
// ISVUsage (metered) and ISVCustomer; HTTP responses follow the documented
// ScheduledReport and execution shapes.

import { describe, it, expect } from 'vitest';
import {
	DATASETS, mapRow, parseReport, toDate, reportRequest, needsReport, partnerCenterClient,
	ingestPartnerCenter, REPORT_RENEW_MS,
} from '../api/_lib/microsoft-partner-center.js';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const SUB = '8f2a4c1e-3b5d-4e6f-9a0b-1c2d3e4f5a6b';

const ORDERS_CSV = [
	'MarketplaceSubscriptionId,MonthStartDate,OfferType,Sku,CustomerCountry,Quantity,OrderStatus,OrderCancelDate,CustomerCompanyName,OrderPurchaseDate,OfferName,CustomerId,PurchaseRecordId,PurchaseRecordLineItemId,IsTrial,billedrevenue',
	`${SUB},2026-11-01 00:00:00,SaaS,team,US,3,Active,,Contoso Ltd,2026-11-03 14:22:10,three.ws,cust-1,pr-1,li-1,False,237.00`,
	`${SUB},2026-11-01 00:00:00,SaaS,team,US,3,Active,,Contoso Ltd,2026-11-03 14:22:10,three.ws,cust-1,pr-1,li-1,False,237.00`,
	`,2026-10-01 00:00:00,SaaS,pro,DE,1,Cancelled,2026-10-20,Fabrikam,2026-10-02,three.ws,cust-2,pr-2,li-1,True,0`,
].join('\n');

const USAGE_CSV = [
	'MarketplaceSubscriptionId,SKU,CustomerCompanyName,UsageDate,PayoutCurrencyPC,UsageReference,UsageUnit,CustomerId,MeteredUsage,EstimatedExtendedChargePC',
	`${SUB},team,Contoso Ltd,2026-11-09,USD,ref-123,per call,cust-1,1520,15.20`,
	`${SUB},team,Contoso Ltd,11/10/2026,USD,,per message,cust-1,40,0.40`,
].join('\n');

const CUSTOMERS_CSV = [
	'MarketplaceSubscriptionId,DateAcquired,DateLost,ProviderName,ProviderEmail,FirstName,LastName,Email,CustomerCompanyName,CustomerCountryRegion,CustomerId,ID',
	`${SUB},2026-11-03,,Contoso,ops@contoso.example,Ada,Lovelace,ada@contoso.example,Contoso Ltd,US,cust-1,1`,
	`,2026-10-02,2026-10-20,Fabrikam,,Bo,Ng,bo@fabrikam.example,Fabrikam,DE,cust-2,2`,
].join('\n');

describe('row mapping', () => {
	it('maps orders and keeps one row per purchase line and month', () => {
		const rows = parseReport('orders', ORDERS_CSV);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			dataset: 'orders', row_key: `pr-1:li-1:${SUB}:2026-11-01`, event_date: '2026-11-03', subscription_id: SUB,
			customer_id: 'cust-1', customer_name: 'Contoso Ltd', plan_id: 'team', status: 'Active', quantity: 3, amount: 237,
		});
		expect(rows[1]).toMatchObject({ subscription_id: null, status: 'Cancelled', amount: 0 });
	});

	it('maps metered usage, keyed by UsageReference when present', () => {
		const rows = parseReport('usage', USAGE_CSV);
		expect(rows.map((r) => r.row_key)).toEqual(['ref-123', `${SUB}:2026-11-10:team:per message`]);
		expect(rows[0]).toMatchObject({ event_date: '2026-11-09', quantity: 1520, amount: 15.2, currency: 'USD' });
	});

	it('maps customers and never stores personal contact fields', () => {
		const rows = parseReport('customers', CUSTOMERS_CSV);
		expect(rows.map((r) => [r.customer_id, r.status])).toEqual([['cust-1', 'active'], ['cust-2', 'lost']]);
		const stored = JSON.stringify(rows);
		for (const leak of ['ada@contoso.example', 'Lovelace', 'ops@contoso.example', 'bo@fabrikam.example']) expect(stored).not.toContain(leak);
		expect(rows[0].data.CustomerCompanyName).toBe('Contoso Ltd');
	});

	it('drops a record with no key and parses common date shapes', () => {
		expect(mapRow('usage', { MeteredUsage: '3' })).toBeNull();
		expect(toDate('2026-11-03 14:22:10')).toBe('2026-11-03');
		expect(toDate('11/10/2026')).toBe('2026-11-10');
		expect(toDate('')).toBeNull();
		expect(() => mapRow('revenue', {})).toThrow(/unknown/);
	});
});

describe('report scheduling', () => {
	it('schedules a daily CSV report on the system query, starting in the future', () => {
		const req = reportRequest('orders', NOW);
		expect(req).toMatchObject({ QueryId: DATASETS.orders.queryId, RecurrenceInterval: 24, RecurrenceCount: 365, Format: 'csv' });
		expect(req.StartTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
		expect(Date.parse(req.StartTime)).toBeGreaterThan(NOW);
	});

	it('needs a report when none exists or the old one is near the end of its runs', () => {
		expect(needsReport(null, NOW)).toBe(true);
		expect(needsReport({ report_id: 'r', report_created_at: new Date(NOW - 1000).toISOString() }, NOW)).toBe(false);
		expect(needsReport({ report_id: 'r', report_created_at: new Date(NOW - REPORT_RENEW_MS - 1).toISOString() }, NOW)).toBe(true);
	});
});

/** Records the HTTP calls and answers with Partner Center's documented shapes. */
function fakeFetch(routes) {
	const calls = [];
	const fn = async (url, init = {}) => {
		calls.push({ url: String(url), method: init.method || 'GET', body: init.body });
		for (const [match, respond] of routes) {
			if (String(url).includes(match)) {
				const { status = 200, json, text } = respond(String(url), init);
				return new Response(text ?? JSON.stringify(json ?? {}), { status });
			}
		}
		return new Response('{}', { status: 500 });
	};
	fn.calls = calls;
	return fn;
}

const CFG = { tenantId: 'tenant-1', clientId: 'client-1', clientSecret: 'secret-1' };
const tokenRoute = ['login.microsoftonline.com', () => ({ json: { access_token: 'tok', expires_in: 3599 } })];

function memoryStore(initial = []) {
	const state = new Map(initial.map((s) => [s.dataset, { ...s }]));
	const rows = new Map();
	return {
		state, rows,
		async states() { return [...state.values()]; },
		async saveReport(dataset, queryId, reportId) { state.set(dataset, { ...(state.get(dataset) || { dataset }), query_id: queryId, report_id: reportId, report_created_at: new Date(NOW).toISOString(), last_error: null }); },
		async upsertRows(list) { for (const r of list) rows.set(`${r.dataset}:${r.row_key}`, r); },
		async markIngested(dataset, ex, count) { Object.assign(state.get(dataset), { last_execution_id: ex.executionId, last_row_count: count, last_error: null }); },
		async markError(dataset, message) { state.set(dataset, { ...(state.get(dataset) || { dataset }), last_error: message }); },
	};
}

describe('ingestPartnerCenter', () => {
	it('reports not_configured without publisher credentials', async () => {
		const res = await ingestPartnerCenter({ now: NOW, cfg: null });
		expect(res).toMatchObject({ ok: true, configured: false, reason: 'not_configured' });
	});

	it('schedules each report on the first run with a client-credentials token for Partner Center', async () => {
		let n = 0;
		const f = fakeFetch([tokenRoute, ['/ScheduledReport', () => ({ json: { value: [{ reportId: `rep-${++n}` }] } })]]);
		const store = memoryStore();
		const res = await ingestPartnerCenter({ now: NOW, cfg: CFG, client: partnerCenterClient(CFG, f), store });
		expect(res.ok).toBe(true);
		expect(Object.values(res.results).map((r) => r.status)).toEqual(['scheduled', 'scheduled', 'scheduled']);
		const tokenCall = f.calls.find((c) => c.url.includes('login.microsoftonline.com'));
		expect(tokenCall.url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/token');
		expect(String(tokenCall.body)).toContain('resource=https%3A%2F%2Fapi.partnercenter.microsoft.com');
		expect(f.calls.filter((c) => c.url.includes('login.')).length).toBe(1);
		const posted = JSON.parse(f.calls.find((c) => c.url.endsWith('/ScheduledReport')).body);
		expect(posted.QueryId).toBe(DATASETS.orders.queryId);
		expect(store.state.get('usage').report_id).toBe('rep-2');
	});

	it('downloads a new execution once, upserts its rows and skips it next time', async () => {
		const created = new Date(NOW - 2 * 86_400_000).toISOString();
		const store = memoryStore([
			{ dataset: 'orders', report_id: 'rep-o', report_created_at: created },
			{ dataset: 'usage', report_id: 'rep-u', report_created_at: created },
			{ dataset: 'customers', report_id: 'rep-c', report_created_at: created },
		]);
		const csv = { 'rep-o': ORDERS_CSV, 'rep-u': USAGE_CSV };
		const f = fakeFetch([
			tokenRoute,
			['/ScheduledReport/execution/rep-c', () => ({ status: 404 })],
			['/ScheduledReport/execution/', (url) => {
				const id = url.match(/execution\/([^?]+)/)[1];
				return { json: { value: [{ executionId: `ex-${id}`, executionStatus: 'Completed', reportAccessSecureLink: `https://pcreports.example/${id}.csv`, reportGeneratedTime: '2026-11-11T02:00:00Z' }] } };
			}],
			['pcreports.example/', (url) => ({ text: csv[url.match(/\/(rep-\w)\.csv/)[1]] })],
		]);
		const client = partnerCenterClient(CFG, f);
		const first = await ingestPartnerCenter({ now: NOW, cfg: CFG, client, store });
		expect(first.results).toEqual({
			orders: { status: 'ingested', execution_id: 'ex-rep-o', rows: 2 },
			usage: { status: 'ingested', execution_id: 'ex-rep-u', rows: 2 },
			customers: { status: 'awaiting_first_execution', report_id: 'rep-c' },
		});
		expect(store.rows.size).toBe(4);
		const downloads = f.calls.filter((c) => c.url.includes('pcreports.example')).length;
		const second = await ingestPartnerCenter({ now: NOW, cfg: CFG, client, store });
		expect(second.results.orders.status).toBe('up_to_date');
		expect(f.calls.filter((c) => c.url.includes('pcreports.example')).length).toBe(downloads);
	});

	it('records a missing Partner Center role per dataset with the exact fix', async () => {
		const f = fakeFetch([tokenRoute, ['/ScheduledReport', () => ({ status: 403, json: { message: 'Forbidden' } })]]);
		const store = memoryStore();
		const res = await ingestPartnerCenter({ now: NOW, cfg: CFG, client: partnerCenterClient(CFG, f), store });
		expect(res.ok).toBe(false);
		expect(res.results.orders.status).toBe('error');
		expect(store.state.get('orders').last_error).toMatch(/403.*Microsoft Entra applications with the Manager role/);
	});
});
