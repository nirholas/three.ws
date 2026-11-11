// Partner Center commercial marketplace analytics ingestion
// (api/cron/microsoft-partner-center.js, daily). Pulls the Orders, Metered
// usage and Customers reports for the three.ws offer into
// microsoft_partner_center_rows so /admin/microsoft can show what Microsoft
// itself reports next to what three.ws recorded.
//
// Flow per dataset, with Microsoft's documented system queries
// (learn.microsoft.com/partner-center/insights/analytics-system-queries):
//   1. Schedule a daily report on the system query once (ScheduledReport) and
//      remember its id; recreate it before its recurrences run out.
//   2. Read the latest completed execution. 404 means the first run has not
//      happened yet, which is normal for the first day.
//   3. When the execution is new, download the CSV from its secure link,
//      map each row to the table's columns, and upsert by a stable key.
//
// Auth: client credentials for the Marketplace publisher app
// (MS_MARKETPLACE_TENANT_ID / CLIENT_ID / CLIENT_SECRET) against the Partner
// Center resource. The app must be added in Partner Center > Account settings >
// User management > Microsoft Entra applications with the Manager role (or the
// Developer role on the commercial marketplace program); without it every call
// answers 401/403 and the error is recorded per dataset.

import Papa from 'papaparse';
import { sql } from './db.js';
import { publisherConfig } from './microsoft-marketplace.js';

export const PC_RESOURCE = 'https://api.partnercenter.microsoft.com';
export const PC_BASE = 'https://api.partnercenter.microsoft.com/insights/v1.1/cmp';
const LOGIN_BASE = 'https://login.microsoftonline.com';

/** Microsoft's system query ids (six-month window) for the three datasets we ingest. */
export const DATASETS = Object.freeze({
	orders: { queryId: 'bd1b0cc1-ce45-4578-beba-6fe5a69fd421', name: 'Orders' },
	usage: { queryId: 'f0c4927f-1f23-4c99-be4a-1371a5a9a086', name: 'Metered usage' },
	customers: { queryId: 'b9df4929-073f-4795-b0cb-a2c81b11e28d', name: 'Customers' },
});

export const RECURRENCE_HOURS = 24;
export const RECURRENCE_COUNT = 365;
/** Recreate a report this long after creating it, before its 365 daily runs are spent. */
export const REPORT_RENEW_MS = 350 * 24 * 3_600_000;

// Personal fields in the Customers report. The board needs the company and
// the subscription, not who clicked buy, so these are never stored.
const PERSONAL_FIELDS = new Set(['firstname', 'lastname', 'email', 'provideremail', 'customeremail', 'providername']);

export class PartnerCenterError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/** A case-insensitive reader over one CSV record (Microsoft mixes 'BilledRevenue' and 'billedrevenue'). */
function reader(record) {
	const map = new Map(Object.entries(record).map(([k, v]) => [k.trim().toLowerCase(), v]));
	return (name) => {
		const v = map.get(name.toLowerCase());
		if (v == null) return null;
		const s = String(v).trim();
		return s === '' || s.toLowerCase() === 'null' ? null : s;
	};
}

/** YYYY-MM-DD from a Partner Center date cell, or null. */
export function toDate(value) {
	if (!value) return null;
	const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
	if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
	const t = Date.parse(value);
	return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

function toNumber(value) {
	if (value == null) return null;
	const n = Number(String(value).replace(/,/g, ''));
	return Number.isFinite(n) ? n : null;
}

/** Map one CSV record of a dataset to a microsoft_partner_center_rows row. null when it has no usable key. */
export function mapRow(dataset, record) {
	const get = reader(record);
	const subscriptionId = get('MarketplaceSubscriptionId');
	const customerId = get('CustomerId');
	const data = Object.fromEntries(Object.entries(record).filter(([k]) => !PERSONAL_FIELDS.has(k.trim().toLowerCase())));
	if (dataset === 'orders') {
		const purchase = get('PurchaseRecordId');
		const line = get('PurchaseRecordLineItemId');
		if (!purchase && !subscriptionId) return null;
		return {
			dataset, row_key: [purchase, line, subscriptionId, toDate(get('MonthStartDate'))].map((v) => v || '').join(':'),
			event_date: toDate(get('OrderPurchaseDate')), subscription_id: subscriptionId, customer_id: customerId,
			customer_name: get('CustomerCompanyName'), plan_id: get('Sku'), status: get('OrderStatus'),
			quantity: toNumber(get('Quantity')), amount: toNumber(get('BilledRevenue')), currency: null, data,
		};
	}
	if (dataset === 'usage') {
		const ref = get('UsageReference');
		const date = toDate(get('UsageDate'));
		if (!ref && !(subscriptionId && date)) return null;
		return {
			dataset, row_key: ref || [subscriptionId, date, get('SKU'), get('UsageUnit')].map((v) => v || '').join(':'),
			event_date: date, subscription_id: subscriptionId, customer_id: customerId,
			customer_name: get('CustomerCompanyName'), plan_id: get('SKU'), status: null,
			quantity: toNumber(get('MeteredUsage')), amount: toNumber(get('EstimatedExtendedChargePC')), currency: get('PayoutCurrencyPC'), data,
		};
	}
	if (dataset === 'customers') {
		if (!customerId && !get('ID')) return null;
		return {
			dataset, row_key: [customerId || get('ID'), subscriptionId].map((v) => v || '').join(':'),
			event_date: toDate(get('DateAcquired')), subscription_id: subscriptionId, customer_id: customerId,
			customer_name: get('CustomerCompanyName'), plan_id: null, status: get('DateLost') ? 'lost' : 'active',
			quantity: null, amount: null, currency: null, data,
		};
	}
	throw new Error(`unknown Partner Center dataset ${dataset}`);
}

/** Parse a report CSV (or TSV) into mapped rows, last write wins per key. */
export function parseReport(dataset, text) {
	const parsed = Papa.parse(String(text || '').replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true });
	const byKey = new Map();
	for (const record of parsed.data) {
		const row = mapRow(dataset, record);
		if (row) byKey.set(row.row_key, row);
	}
	return [...byKey.values()];
}

/** The ScheduledReport body for a dataset. */
export function reportRequest(dataset, now) {
	const def = DATASETS[dataset];
	return {
		ReportName: `threews_${dataset}_daily`,
		Description: `three.ws ${def.name} for /admin/microsoft`,
		QueryId: def.queryId,
		StartTime: new Date(Math.ceil((now + 10 * 60_000) / 60_000) * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
		RecurrenceInterval: RECURRENCE_HOURS,
		RecurrenceCount: RECURRENCE_COUNT,
		Format: 'csv',
	};
}

/** True when a dataset needs a (new) scheduled report. */
export function needsReport(state, now) {
	if (!state?.report_id) return true;
	const created = state.report_created_at ? new Date(state.report_created_at).getTime() : NaN;
	return !Number.isFinite(created) || now - created > REPORT_RENEW_MS;
}

function permissionHint(status) {
	return status === 401 || status === 403
		? ' (add the Marketplace app in Partner Center > Account settings > User management > Microsoft Entra applications with the Manager role)'
		: '';
}

/** Partner Center API client over an injectable fetch. */
export function partnerCenterClient(cfg, fetchImpl = fetch) {
	let token = null;
	async function accessToken() {
		if (token && token.expires > Date.now() + 60_000) return token.value;
		const res = await fetchImpl(`${LOGIN_BASE}/${encodeURIComponent(cfg.tenantId)}/oauth2/token`, {
			method: 'POST',
			headers: { 'content-type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret, resource: PC_RESOURCE }),
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok || !body.access_token) {
			throw new PartnerCenterError(res.status, `Entra token for Partner Center failed: ${body.error_description || body.error || res.status}`);
		}
		token = { value: body.access_token, expires: Date.now() + Number(body.expires_in || 3600) * 1000 };
		return token.value;
	}
	async function call(path, init = {}) {
		const res = await fetchImpl(`${PC_BASE}/${path}`, {
			...init,
			headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json', ...(init.headers || {}) },
		});
		if (res.status === 404) return null;
		const body = await res.json().catch(() => ({}));
		if (!res.ok) {
			throw new PartnerCenterError(res.status, `Partner Center ${path.split('?')[0]} answered ${res.status}: ${body.message || body.Message || body.error?.message || 'no message'}${permissionHint(res.status)}`);
		}
		return body;
	}
	return {
		async createReport(request) {
			const body = await call('ScheduledReport', { method: 'POST', body: JSON.stringify(request) });
			const v = (body?.value || body?.Value || [])[0];
			if (!v?.reportId) throw new PartnerCenterError(502, 'Partner Center created no report id');
			return v.reportId;
		},
		async latestExecution(reportId) {
			const body = await call(`ScheduledReport/execution/${encodeURIComponent(reportId)}?executionStatus=Completed&getLatestExecution=true`);
			return body ? (body.value || body.Value || [])[0] || null : null;
		},
		async download(link) {
			const res = await fetchImpl(link);
			if (!res.ok) throw new PartnerCenterError(res.status, `report download answered ${res.status}`);
			return res.text();
		},
	};
}

/** Persistence for the ingest, through the Neon client. */
export const partnerCenterStore = {
	async states() {
		return sql`select dataset, query_id, report_id, report_created_at, last_execution_id from microsoft_partner_center_reports`;
	},
	async saveReport(dataset, queryId, reportId) {
		await sql`
			insert into microsoft_partner_center_reports (dataset, query_id, report_id, report_created_at, last_error, updated_at)
			values (${dataset}, ${queryId}, ${reportId}, now(), null, now())
			on conflict (dataset) do update set query_id = excluded.query_id, report_id = excluded.report_id,
				report_created_at = now(), last_error = null, updated_at = now()
		`;
	},
	async upsertRows(rows, executionId) {
		for (let i = 0; i < rows.length; i += 500) {
			const batch = rows.slice(i, i + 500);
			await sql`
				insert into microsoft_partner_center_rows
					(dataset, row_key, event_date, subscription_id, customer_id, customer_name, plan_id, status, quantity, amount, currency, data, execution_id, ingested_at)
				select x.dataset, x.row_key, x.event_date, x.subscription_id, x.customer_id, x.customer_name, x.plan_id, x.status,
				       x.quantity, x.amount, x.currency, x.data, ${executionId}, now()
				from jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) as x(
					dataset text, row_key text, event_date date, subscription_id text, customer_id text, customer_name text,
					plan_id text, status text, quantity numeric, amount numeric, currency text, data jsonb)
				on conflict (dataset, row_key) do update set
					event_date = excluded.event_date, subscription_id = excluded.subscription_id, customer_id = excluded.customer_id,
					customer_name = excluded.customer_name, plan_id = excluded.plan_id, status = excluded.status,
					quantity = excluded.quantity, amount = excluded.amount, currency = excluded.currency, data = excluded.data,
					execution_id = excluded.execution_id, ingested_at = now()
			`;
		}
	},
	async markIngested(dataset, execution, count) {
		await sql`
			update microsoft_partner_center_reports
			set last_execution_id = ${execution.executionId}, last_generated_at = ${execution.reportGeneratedTime || null},
			    last_ingested_at = now(), last_row_count = ${count}, last_error = null, updated_at = now()
			where dataset = ${dataset}
		`;
	},
	async markError(dataset, message) {
		await sql`
			insert into microsoft_partner_center_reports (dataset, last_error, updated_at)
			values (${dataset}, ${message}, now())
			on conflict (dataset) do update set last_error = excluded.last_error, updated_at = now()
		`;
	},
};

/**
 * One ingest pass over every dataset. A failing dataset records its error and
 * does not stop the others. Returns a per-dataset result.
 */
export async function ingestPartnerCenter({ now = Date.now(), cfg = publisherConfig(), client, store = partnerCenterStore } = {}) {
	if (!cfg) return { ok: true, configured: false, reason: 'not_configured', missing: ['MS_MARKETPLACE_TENANT_ID', 'MS_MARKETPLACE_CLIENT_ID', 'MS_MARKETPLACE_CLIENT_SECRET'] };
	const pc = client || partnerCenterClient(cfg);
	const states = new Map((await store.states()).map((s) => [s.dataset, s]));
	const results = {};
	for (const dataset of Object.keys(DATASETS)) {
		try {
			const state = states.get(dataset) || { dataset };
			if (needsReport(state, now)) {
				const reportId = await pc.createReport(reportRequest(dataset, now));
				await store.saveReport(dataset, DATASETS[dataset].queryId, reportId);
				results[dataset] = { status: 'scheduled', report_id: reportId };
				continue;
			}
			const execution = await pc.latestExecution(state.report_id);
			if (!execution) {
				results[dataset] = { status: 'awaiting_first_execution', report_id: state.report_id };
				continue;
			}
			if (execution.executionId === state.last_execution_id) {
				results[dataset] = { status: 'up_to_date', execution_id: execution.executionId };
				continue;
			}
			if (!execution.reportAccessSecureLink) throw new PartnerCenterError(502, `execution ${execution.executionId} has no download link`);
			const rows = parseReport(dataset, await pc.download(execution.reportAccessSecureLink));
			await store.upsertRows(rows, execution.executionId);
			await store.markIngested(dataset, execution, rows.length);
			results[dataset] = { status: 'ingested', execution_id: execution.executionId, rows: rows.length };
		} catch (err) {
			const message = String(err?.message || err).slice(0, 500);
			await store.markError(dataset, message);
			results[dataset] = { status: 'error', error: message };
		}
	}
	return { ok: Object.values(results).every((r) => r.status !== 'error'), configured: true, results };
}
