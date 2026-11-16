// The usage feed's entity model: five entity sets built from real tables, each
// scoped to what the caller's feed key may see.
//
//   UsageDaily    usage_events rolled up per UTC day, person and event kind
//   McpToolCalls  usage_events kind='tool_call', one row per MCP tool call
//   LlmUsage      usage_events kind='llm' rolled up per UTC day, person, provider, model
//   Generations   forge_creations (Forge text and image to 3D jobs) of signed-in people
//   Billing       Microsoft Marketplace metering events as reported to Microsoft
//                 (microsoft_saas_usage_events), plus metered three.ws charges
//                 (usage_events kind='metered') rolled up per UTC day
//
// A scope is { userId } (the key's creator only) or { userId, teamId, teamName }
// (the team owner plus every active person of the team, see team_people).
//
// Each entity's `base` returns a SELECT whose output columns are named exactly
// like the declared properties; api/_lib/usage-feed.js wraps it as `e` and
// applies $filter, $orderby and paging on top. Property names reach SQL only
// as those fixed aliases, never from the request.

/** @typedef {{ type: string, nullable?: boolean, description: string, precision?: number, scale?: number }} Prop */

export const NAMESPACE = 'ThreeWs.Usage';
export const CONTAINER = 'Container';

const S = (description, extra = {}) => ({ type: 'Edm.String', description, ...extra });
const ID = { type: 'Edm.String', nullable: false, description: 'Stable row key.' };
const SCOPE_PROPS = {
	TeamId: S('The team this row is reported under; empty for a personal feed key.'),
	TeamName: S('The team name; empty for a personal feed key.'),
	UserId: S('The three.ws account the usage belongs to.'),
	UserName: S('Display name of the account, when it has one.'),
	UserEmail: S('Email address of the account.'),
};

function scopeUsers(column, scope, p) {
	if (scope.teamId) {
		const t = p.add(scope.teamId, 'uuid');
		return `${column} in (
			select owner_user_id from teams where id = ${t} and archived_at is null
			union
			select user_id from team_people where team_id = ${t} and status = 'active' and user_id is not null
		)`;
	}
	return `${column} = ${p.add(scope.userId, 'uuid')}`;
}

function scopeColumns(scope, p, userColumn) {
	const teamId = scope.teamId ? p.add(scope.teamId, 'text') : 'null::text';
	const teamName = scope.teamId ? p.add(scope.teamName || '', 'text') : 'null::text';
	return `${teamId} as "TeamId", ${teamName} as "TeamName", ${userColumn}::text as "UserId",
		u.display_name::text as "UserName", u.email::text as "UserEmail"`;
}

const teamKey = (scope) => (scope.teamId ? 'team' : 'personal');

/** @type {Array<{ name: string, description: string, props: Record<string, Prop>, base: (scope: object, p: import('./query.js').Params) => string }>} */
export const ENTITY_SETS = [
	{
		name: 'UsageDaily',
		description: 'Usage events per UTC day, person and event kind.',
		props: {
			Id: ID,
			Date: { type: 'Edm.Date', nullable: false, description: 'UTC calendar day.' },
			...SCOPE_PROPS,
			Metric: S('Event kind as recorded in the usage log (for example tool_call, llm, metered).', { nullable: false }),
			Quantity: { type: 'Edm.Int64', nullable: false, description: 'Number of events of this kind on this day.' },
			Bytes: { type: 'Edm.Int64', nullable: false, description: 'Bytes recorded on those events (uploads, downloads), 0 when none.' },
			ErrorCount: { type: 'Edm.Int64', nullable: false, description: 'Events whose status was not ok.' },
		},
		base: (scope, p) => `
			select concat_ws('|', d.day::text, ${p.add(teamKey(scope), 'text')}, d.user_id::text, d.kind) as "Id",
				d.day as "Date",
				${scopeColumns(scope, p, 'd.user_id')},
				d.kind as "Metric", d.quantity as "Quantity", d.bytes as "Bytes", d.errors as "ErrorCount"
			from (
				select (t.created_at at time zone 'UTC')::date as day, t.user_id, t.kind,
					count(*)::bigint as quantity,
					coalesce(sum(t.bytes), 0)::bigint as bytes,
					count(*) filter (where t.status <> 'ok')::bigint as errors
				from usage_events t
				where ${scopeUsers('t.user_id', scope, p)}
				group by 1, 2, 3
			) d
			left join users u on u.id = d.user_id`,
	},
	{
		name: 'McpToolCalls',
		description: 'One row per MCP tool call.',
		props: {
			Id: ID,
			Timestamp: { type: 'Edm.DateTimeOffset', nullable: false, description: 'When the call was recorded (UTC).' },
			...SCOPE_PROPS,
			Tool: S('MCP tool name.'),
			Status: S('Outcome as recorded: ok, or an error class.', { nullable: false }),
			DurationMs: { type: 'Edm.Int32', description: 'Server-side duration in milliseconds, when measured.' },
			ClientId: S('OAuth client that made the call, when it came through one.'),
			AgentId: S('three.ws agent the call was attributed to, when any.'),
		},
		base: (scope, p) => `
			select t.id::text as "Id", t.created_at as "Timestamp",
				${scopeColumns(scope, p, 't.user_id')},
				t.tool as "Tool", t.status as "Status", t.latency_ms as "DurationMs",
				t.client_id as "ClientId", t.agent_id::text as "AgentId"
			from usage_events t
			left join users u on u.id = t.user_id
			where t.kind = 'tool_call' and ${scopeUsers('t.user_id', scope, p)}`,
	},
	{
		name: 'LlmUsage',
		description: 'LLM calls and tokens per UTC day, person, provider and model.',
		props: {
			Id: ID,
			Date: { type: 'Edm.Date', nullable: false, description: 'UTC calendar day.' },
			...SCOPE_PROPS,
			Provider: S('LLM provider that served the calls, when recorded.'),
			Model: S('Model id, or unknown when the call predates model logging.', { nullable: false }),
			Calls: { type: 'Edm.Int64', nullable: false, description: 'Number of LLM calls.' },
			InputTokens: { type: 'Edm.Int64', nullable: false, description: 'Prompt tokens.' },
			OutputTokens: { type: 'Edm.Int64', nullable: false, description: 'Completion tokens.' },
			CostUsd: { type: 'Edm.Decimal', nullable: false, precision: 18, scale: 6, description: 'Provider cost in US dollars as recorded per call.' },
		},
		base: (scope, p) => `
			select concat_ws('|', d.day::text, ${p.add(teamKey(scope), 'text')}, d.user_id::text, coalesce(d.provider, ''), d.model) as "Id",
				d.day as "Date",
				${scopeColumns(scope, p, 'd.user_id')},
				d.provider as "Provider", d.model as "Model", d.calls as "Calls",
				d.input_tokens as "InputTokens", d.output_tokens as "OutputTokens", d.cost_usd as "CostUsd"
			from (
				select (t.created_at at time zone 'UTC')::date as day, t.user_id, t.provider,
					coalesce(t.model, 'unknown') as model,
					count(*)::bigint as calls,
					coalesce(sum(t.input_tokens), 0)::bigint as input_tokens,
					coalesce(sum(t.output_tokens), 0)::bigint as output_tokens,
					round(coalesce(sum(t.cost_micro_usd), 0)::numeric / 1000000, 6) as cost_usd
				from usage_events t
				where t.kind = 'llm' and ${scopeUsers('t.user_id', scope, p)}
				group by 1, 2, 3, 4
			) d
			left join users u on u.id = d.user_id`,
	},
	{
		name: 'Generations',
		description: 'Forge 3D generation jobs started while signed in.',
		props: {
			Id: ID,
			CreatedAt: { type: 'Edm.DateTimeOffset', nullable: false, description: 'When the job started (UTC).' },
			CompletedAt: { type: 'Edm.DateTimeOffset', description: 'When the job reached done or failed, when recorded.' },
			...SCOPE_PROPS,
			Tier: S('Quality tier: draft, standard or high, when recorded.'),
			Path: S('Generation path (text to 3D, image to 3D and so on), when recorded.'),
			Backend: S('Model backend that produced the mesh, when recorded.'),
			Status: S('generating, done or failed.', { nullable: false }),
			Outcome: S('generated, accepted or rejected (the creator\'s verdict).', { nullable: false }),
			DurationSeconds: { type: 'Edm.Double', description: 'CompletedAt minus CreatedAt in seconds, when completed.' },
			SizeBytes: { type: 'Edm.Int64', description: 'Size of the stored GLB, when stored.' },
		},
		base: (scope, p) => `
			select t.id::text as "Id", t.created_at as "CreatedAt", t.completed_at as "CompletedAt",
				${scopeColumns(scope, p, 't.user_id')},
				t.tier as "Tier", t.path as "Path", t.backend as "Backend", t.status as "Status", t.outcome as "Outcome",
				case when t.completed_at is not null
					then round(extract(epoch from (t.completed_at - t.created_at))::numeric, 3)::double precision end as "DurationSeconds",
				t.size_bytes::bigint as "SizeBytes"
			from forge_creations t
			left join users u on u.id = t.user_id
			where t.user_id is not null and t.internal is not true and ${scopeUsers('t.user_id', scope, p)}`,
	},
	{
		name: 'Billing',
		description: 'Metered quantities as reported to the billing source.',
		props: {
			Id: ID,
			PeriodStart: { type: 'Edm.DateTimeOffset', nullable: false, description: 'Start of the metered period (UTC).' },
			Granularity: S('hour for Microsoft Marketplace metering, day for metered three.ws charges.', { nullable: false }),
			...SCOPE_PROPS,
			Source: S('Billing source: microsoft_marketplace, or the settlement rail of a metered charge (three, x402, aws, card).', { nullable: false }),
			SubscriptionId: S('Microsoft Marketplace SaaS subscription id, for marketplace rows.'),
			Plan: S('Marketplace plan id, for marketplace rows.'),
			Dimension: S('Metered dimension (marketplace) or charged action id (three.ws).', { nullable: false }),
			Quantity: { type: 'Edm.Decimal', nullable: false, precision: 18, scale: 6, description: 'Quantity reported for the period.' },
			AmountUsd: { type: 'Edm.Decimal', precision: 18, scale: 6, description: 'Amount charged in USD for metered three.ws charges; empty for marketplace rows, which Microsoft prices.' },
			Status: S('Marketplace reporting status (pending, accepted, expired, rejected), or recorded for three.ws charges.', { nullable: false }),
		},
		base: (scope, p) => `
			select b.*, ${scopeColumns(scope, p, 'b.user_id')}
			from (
				select 'microsoft:' || m.id::text as "Id", m.effective_start_time as "PeriodStart", 'hour'::text as "Granularity",
					'microsoft_marketplace'::text as "Source", s.id::text as "SubscriptionId", m.plan_id::text as "Plan",
					m.dimension::text as "Dimension", m.quantity::numeric as "Quantity", null::numeric as "AmountUsd",
					m.status::text as "Status", s.user_id
				from microsoft_saas_usage_events m
				join microsoft_saas_subscriptions s on s.id = m.subscription_id
				where s.is_test is not true and ${scopeUsers('s.user_id', scope, p)}
				union all
				select concat_ws('|', 'metered', d.day::text, d.user_id::text, d.meter_action, d.source), (d.day::timestamp at time zone 'UTC'), 'day',
					d.source, null, null, d.meter_action, d.quantity, d.amount_usd, 'recorded', d.user_id
				from (
					select (t.created_at at time zone 'UTC')::date as day, t.user_id,
						coalesce(t.meter_action, 'unknown') as meter_action,
						coalesce(t.settlement_kind, 'unknown') as source,
						coalesce(sum(coalesce(t.units, 1)), 0)::numeric as quantity,
						round(coalesce(sum(t.price_usdc_atomics), 0)::numeric / 1000000, 6) as amount_usd
					from usage_events t
					where t.kind = 'metered' and ${scopeUsers('t.user_id', scope, p)}
					group by 1, 2, 3, 4
				) d
			) b
			left join users u on u.id = b.user_id`,
	},
];

/** Entity set by name (case-sensitive, as OData requires). */
export function entitySet(name) {
	return ENTITY_SETS.find((e) => e.name === name) || null;
}
