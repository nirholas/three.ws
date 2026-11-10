import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { rpcCallerTag } from '../server/rpc-caller-tag.mjs';

// Every Solana RPC call is attributed to the route that made it (the RPC spend
// ledger behind /api/ops/rpc-spend and the healthz rpc_lanes line). On
// 2026-11-10 roughly 220k calls a day (146,716 getSignaturesForAddress alone,
// the second largest caller) were booked to the literal "/api/cron/[name]":
// crons reach that shared file through the vercel.json rewrite
// /api/cron/<job> -> /api/cron/[name]?name=<job>, so the dispatched path is the
// template itself and the job that spent the quota was invisible.
const API_ROOT = path.join('/app', 'api');
const file = (rel) => path.join(API_ROOT, ...rel.split('/'));

describe('rpcCallerTag', () => {
	it('tags an ordinary route by its template, never by the raw id', () => {
		expect(rpcCallerTag(API_ROOT, file('agents/[id].js'), '/api/agents/abc123', {})).toBe('/api/agents/[id]');
		expect(rpcCallerTag(API_ROOT, file('crypto/index.js'), '/api/crypto', {})).toBe('/api/crypto');
	});

	it('tags a cron dispatched by its own path with that path', () => {
		expect(rpcCallerTag(API_ROOT, file('cron/[name].js'), '/api/cron/pump-claims-scan', {})).toBe('/api/cron/pump-claims-scan');
	});

	it('tags a cron that arrived through the rewrite by the job name in the query', () => {
		expect(rpcCallerTag(API_ROOT, file('cron/[name].js'), '/api/cron/[name]', { name: 'treasury-topup' })).toBe('/api/cron/treasury-topup');
	});

	it('never lets a rewritten cron name widen the key space with junk', () => {
		expect(rpcCallerTag(API_ROOT, file('cron/[name].js'), '/api/cron/[name]', { name: '../../etc/passwd' })).toBe('/api/cron/[name]');
		expect(rpcCallerTag(API_ROOT, file('cron/[name].js'), '/api/cron/[name]', {})).toBe('/api/cron/[name]');
	});
});
