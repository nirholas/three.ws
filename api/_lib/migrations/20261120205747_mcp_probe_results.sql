-- mcp_probe_results: one row per synthetic probe of a Grok-facing MCP
-- connector. api/cron/mcp-probe.js writes a row per server every five minutes
-- (initialize, notifications/initialized, tools/list, one read-only tool call,
-- and the ?auth=oauth discovery path) and deletes rows older than 90 days in
-- the same run. Read by the mcp_probe subsystem in /api/healthz and by the
-- public uptime feed GET /api/status/mcp. Fully idempotent.

create table if not exists mcp_probe_results (
    id           bigserial primary key,
    checked_at   timestamptz not null default now(),
    server       text not null,
    ok           boolean not null,
    failed_step  text,
    latency_ms   jsonb not null default '{}'::jsonb,
    error        text,
    detail       jsonb not null default '{}'::jsonb
);

create index if not exists mcp_probe_results_server_checked_at
    on mcp_probe_results(server, checked_at desc);

-- The 90-day retention delete scans by age alone.
create index if not exists mcp_probe_results_checked_at
    on mcp_probe_results(checked_at);
