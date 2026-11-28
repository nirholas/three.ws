// three-ws-forge: the Supabase Edge Function that turns three_ws_models rows
// into GLBs in Storage. Called by the insert trigger and the per-minute cron
// (see the schedule migration), authenticated by a shared secret header.
//
// POST /functions/v1/three-ws-forge            202, sweeps in the background
// POST /functions/v1/three-ws-forge?wait=1     200 with the sweep summary
//
// Secrets: THREE_WS_API_KEY (from three.ws/dashboard/api-keys) and
// THREE_WS_FORGE_SECRET (any long random string, also stored in Vault).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { normalizeBaseUrl } from './forge.ts';
import { type ModelPatch, type ModelRow, type Store, sweep } from './sweep.ts';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

const BUCKET = 'three-ws-models';

function env(name: string): string | undefined {
	const value = Deno.env.get(name);
	return value && value.trim() ? value.trim() : undefined;
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
	});
}

function sameSecret(given: string, expected: string): boolean {
	const a = new TextEncoder().encode(given);
	const b = new TextEncoder().encode(expected);
	let diff = a.length ^ b.length;
	for (let i = 0; i < b.length; i++) diff |= (a[i] ?? 0) ^ b[i];
	return diff === 0;
}

function supabaseStore(supabase: SupabaseClient): Store {
	return {
		async claim(maxRows, leaseSeconds) {
			const { data, error } = await supabase.rpc('three_ws_claim_models', { max_rows: maxRows, lease_seconds: leaseSeconds });
			if (error) throw new Error(`three_ws_claim_models: ${error.message}`);
			return (data ?? []) as ModelRow[];
		},
		async nextDueSeconds() {
			const { data, error } = await supabase.rpc('three_ws_next_due_seconds');
			if (error) throw new Error(`three_ws_next_due_seconds: ${error.message}`);
			return typeof data === 'number' ? data : null;
		},
		async update(id: string, patch: ModelPatch) {
			const { error } = await supabase.from('three_ws_models').update(patch).eq('id', id);
			if (error) throw new Error(`updating model ${id}: ${error.message}`);
		},
		async upload(path, bytes) {
			const { error } = await supabase.storage
				.from(BUCKET)
				.upload(path, bytes, { contentType: 'model/gltf-binary', upsert: true });
			if (error) throw new Error(`uploading ${path} to ${BUCKET}: ${error.message}`);
		},
	};
}

Deno.serve(async (req) => {
	if (req.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'POST to run a sweep.' });

	const secret = env('THREE_WS_FORGE_SECRET');
	const apiKey = env('THREE_WS_API_KEY');
	const supabaseUrl = env('SUPABASE_URL');
	const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
	if (!secret || !apiKey || !supabaseUrl || !serviceKey) {
		const missing = [
			!secret && 'THREE_WS_FORGE_SECRET',
			!apiKey && 'THREE_WS_API_KEY',
			!supabaseUrl && 'SUPABASE_URL',
			!serviceKey && 'SUPABASE_SERVICE_ROLE_KEY',
		].filter(Boolean);
		return json(500, {
			error: 'unconfigured',
			message: `Set ${missing.join(', ')} with \`supabase secrets set\`, then redeploy three-ws-forge.`,
		});
	}
	if (!sameSecret(req.headers.get('x-three-ws-forge-secret') ?? '', secret)) {
		return json(401, { error: 'unauthorized', message: 'Send the THREE_WS_FORGE_SECRET value in x-three-ws-forge-secret.' });
	}

	const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
	const run = sweep({
		store: supabaseStore(supabase),
		forge: { apiKey, baseUrl: normalizeBaseUrl(env('THREE_WS_BASE_URL')), client: 'supabase' },
		log: (event) => console.log(JSON.stringify({ fn: 'three-ws-forge', ...event })),
	});

	if (new URL(req.url).searchParams.get('wait') === '1') {
		try {
			return json(200, await run);
		} catch (err) {
			return json(500, { error: 'sweep_failed', message: err instanceof Error ? err.message : String(err) });
		}
	}
	EdgeRuntime.waitUntil(
		run.catch((err) => console.error(JSON.stringify({ fn: 'three-ws-forge', event: 'sweep_failed', message: String(err) }))),
	);
	return json(202, { accepted: true });
});
