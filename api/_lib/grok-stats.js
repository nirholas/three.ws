// The live numbers /grok shows, from usage_events rows the Grok MCP surface
// writes (api/_mcp-studio/dispatch.js tags each tools/call with a hashed
// client label and, when the call finished a model, its GLB URL; see
// api/_mcp-studio/usage-tags.js).
//
// Only the Grok surface (/api/mcp-grok) counts. The free studio endpoint
// (/api/mcp-studio) also serves Cursor, Claude and every other MCP client, so
// counting it here would credit Grok with traffic it did not send.
//
// The payload is counts and timestamps only: no user ids, client labels,
// prompts or model URLs (tests/grok-stats.test.js scans every served byte).

import { sql as defaultSql } from './db.js';
import { env } from './env.js';
import { PREFERRED_CALLS } from './mcp-probe.js';

export const GROK_SERVER = 'mcp-grok';

// Our own uptime probe (api/cron/mcp-probe.js) makes this exact read on the
// Grok endpoint every five minutes. It is synthetic traffic, so a row with its
// tool and arguments is never counted as Grok usage.
const PROBE_CALL = PREFERRED_CALLS[`/api/${GROK_SERVER}`];

// A stable identity: a signed-in account or a verified install token. MCP
// sessions and IPs rotate, so counting them would inflate "clients".
const STABLE_CLIENT_PATTERNS = [`${GROK_SERVER}:account:%`, `${GROK_SERVER}:install:%`];

function origin() {
	return (env.PUBLIC_APP_ORIGIN || 'https://three.ws').replace(/\/+$/, '');
}

const n = (v) => Number(v ?? 0);

/**
 * @param {{ sql?: Function }} [deps]
 */
export async function buildGrokStats({ sql = defaultSql } = {}) {
	const [row] = await sql`
		select
			count(distinct meta->>'glb') filter (where created_at > now() - interval '24 hours') as models_24h,
			count(distinct meta->>'glb') as models_30d,
			count(*) filter (where created_at > now() - interval '24 hours') as calls_24h,
			count(*) as calls_30d,
			count(distinct client_id) filter (
				where client_id like ${STABLE_CLIENT_PATTERNS[0]} or client_id like ${STABLE_CLIENT_PATTERNS[1]}
			) as clients_30d,
			min(created_at) filter (where client_id like ${`${GROK_SERVER}:%`}) as counting_since
		from usage_events
		where kind = 'tool_call'
			and meta->>'server' = ${GROK_SERVER}
			and not coalesce(tool = ${PROBE_CALL.name} and meta->'args_summary' @> ${JSON.stringify(PROBE_CALL.arguments)}::jsonb, false)
			and created_at > now() - interval '30 days'
	`;
	const since = row?.counting_since ? new Date(row.counting_since).toISOString() : null;
	return {
		surface: GROK_SERVER,
		endpoint: `${origin()}/api/${GROK_SERVER}`,
		generated_at: new Date().toISOString(),
		counting_since: since,
		models: { '24h': n(row?.models_24h), '30d': n(row?.models_30d) },
		clients: { '30d': n(row?.clients_30d) },
		tool_calls: { '24h': n(row?.calls_24h), '30d': n(row?.calls_30d) },
		methodology: {
			models: 'Distinct finished 3D models (GLB files) returned by a model tool or a job collection on /api/mcp-grok.',
			clients: 'Distinct signed-in accounts and install tokens that called /api/mcp-grok. Anonymous sessions are not counted.',
			tool_calls: 'Every tools/call on /api/mcp-grok, including calls that asked the user to sign in.',
			scope: 'Only the Grok endpoint counts. The free studio endpoint also serves other MCP clients and is excluded.',
			counting_since: 'The first call in the 30 day window that carries attribution. Windows that start earlier cover less time.',
		},
	};
}
