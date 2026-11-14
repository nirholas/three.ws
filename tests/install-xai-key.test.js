// Cover scripts/install-xai-key.mjs, the one command that puts a production xAI
// key on three-ws-api. The cases pin the properties that make it safe to hand to
// the owner: a rejected key stores nothing, the key only ever travels over
// stdin (never an argv), the service update is --update-secrets (never
// --set-env-vars, which replaces the whole env), and success is only claimed
// after the key read back off the service passes GET /v1/models.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { installKey, checkKey, plan, SECRET_NAME, ENV_NAME, RUNTIME_SA, MODELS_URL } from '../scripts/install-xai-key.mjs';

const MODELS = readFileSync(join(import.meta.dirname, 'fixtures', 'xai-v1-models.json'), 'utf8');
const KEY = 'xai-fixture-key-not-real';

function fetchOk() {
	const calls = [];
	const impl = async (url, init) => {
		calls.push({ url, auth: init.headers.authorization });
		return new Response(MODELS, { status: 200 });
	};
	return { impl, calls };
}

function recorder({ secretExists = false } = {}) {
	const calls = [];
	const gcloud = (args, { input } = {}) => {
		calls.push({ args, input });
		if (args[0] === 'secrets' && args[1] === 'describe' && !secretExists) throw new Error('NOT_FOUND');
		return '';
	};
	return { gcloud, calls };
}

describe('checkKey', () => {
	it('accepts a key that lists models', async () => {
		const { impl, calls } = fetchOk();
		const res = await checkKey(KEY, impl);
		expect(res.ok).toBe(true);
		expect(res.count).toBe(JSON.parse(MODELS).data.length);
		expect(calls).toEqual([{ url: MODELS_URL, auth: `Bearer ${KEY}` }]);
	});

	it('reports xAI\'s own reason on a rejected key', async () => {
		const impl = async () =>
			new Response(JSON.stringify({ code: 'Client specified an invalid argument', error: 'Incorrect API key provided' }), {
				status: 400,
			});
		const res = await checkKey(KEY, impl);
		expect(res).toMatchObject({ ok: false, status: 400, detail: 'Incorrect API key provided' });
	});
});

describe('installKey', () => {
	it('stores nothing when xAI rejects the key', async () => {
		const { gcloud, calls } = recorder();
		const impl = async () => new Response('{"error":"Incorrect API key provided"}', { status: 401 });
		await expect(installKey(KEY, { gcloud, readBack: () => KEY, fetchImpl: impl, log: () => {} })).rejects.toThrow(
			/Nothing was stored/,
		);
		expect(calls).toEqual([]);
	});

	it('creates the secret, grants the runtime SA, wires the service, then verifies the read-back', async () => {
		const { gcloud, calls } = recorder();
		const { impl, calls: fetches } = fetchOk();
		const res = await installKey(`  ${KEY}\n`, { gcloud, readBack: () => KEY, fetchImpl: impl, log: () => {} });
		expect(res.created).toBe(true);
		const verbs = calls.map((c) => c.args.slice(0, 3).join(' '));
		expect(verbs).toEqual([
			`secrets describe ${SECRET_NAME}`,
			`secrets create ${SECRET_NAME}`,
			`secrets versions add`,
			`secrets add-iam-policy-binding ${SECRET_NAME}`,
			'run services update',
		]);
		const add = calls.find((c) => c.args.includes('--data-file=-'));
		expect(add.input).toBe(KEY);
		expect(calls.find((c) => c.args.includes('add-iam-policy-binding')).args).toContain(`--member=serviceAccount:${RUNTIME_SA}`);
		const update = calls.at(-1).args;
		expect(update).toContain(`--update-secrets=${ENV_NAME}=${SECRET_NAME}:latest`);
		expect(update.some((a) => a.startsWith('--set-env-vars') || a.startsWith('--set-secrets'))).toBe(false);
		expect(fetches).toHaveLength(2);
	});

	it('never puts the key in a gcloud argv', async () => {
		const { gcloud, calls } = recorder({ secretExists: true });
		const { impl } = fetchOk();
		await installKey(KEY, { gcloud, readBack: () => KEY, fetchImpl: impl, log: () => {} });
		for (const c of calls) expect(c.args.join(' ')).not.toContain(KEY);
		expect(calls.some((c) => c.args.includes('create'))).toBe(false);
	});

	it('fails when the service does not resolve to the stored key', async () => {
		const { gcloud } = recorder({ secretExists: true });
		const { impl } = fetchOk();
		await expect(installKey(KEY, { gcloud, readBack: () => null, fetchImpl: impl, log: () => {} })).rejects.toThrow(
			/unreadable/,
		);
	});
});

describe('plan', () => {
	it('targets the production service in us-central1', () => {
		const p = plan();
		expect(p.updateService).toEqual(expect.arrayContaining(['three-ws-api', '--region=us-central1', '--project=aerial-vehicle-466722-p5']));
	});
});
