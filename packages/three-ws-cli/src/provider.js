// The model provider a machine's clients use, and a completion client that
// honors it on every call.
//
// `three-ws provider use three-ws` writes ~/.config/three-ws/provider.json
// (owner-only): the OpenAI-compatible base URL, the model, and the inference
// key `three-ws fund` minted. readProvider() reads that file on every call and
// never caches it, so switching providers takes effect on the very next
// completion with no restart. complete() is that client; `three-ws ask` uses
// it, and any tool built on this package can import it.
//
// Hermes-style agents keep their model under `model:` in ~/.hermes/config.yaml
// (provider "custom" + base_url + api_key + default). writeHermesModel() edits
// only those four keys through the yaml Document API, so comments and every
// other setting survive.

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { configDir, systemEnv } from './paths.js';
import { request, ApiError } from './http.js';

export const THREE_WS_PROVIDER = Object.freeze({
	id: 'three-ws',
	model: 'three-ws/agent',
	path: '/api/v1',
});

export function providerPath(env = systemEnv()) {
	return env.vars.THREE_WS_PROVIDER_FILE || path.join(configDir(env), 'provider.json');
}

/** The active provider, read fresh from disk. null when none is configured. */
export function readProvider(env = systemEnv()) {
	let raw;
	try {
		raw = fs.readFileSync(providerPath(env), 'utf8');
	} catch (err) {
		if (err.code === 'ENOENT') return null;
		throw err;
	}
	try {
		const p = JSON.parse(raw);
		return p && p.base_url && p.api_key ? p : null;
	} catch {
		throw new Error(`${providerPath(env)} is not valid JSON. Run \`three-ws provider use three-ws\` to rewrite it.`);
	}
}

/** Atomically write the provider file, owner-only. */
export function writeProvider(provider, env = systemEnv()) {
	const file = providerPath(env);
	fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, `${JSON.stringify(provider, null, 2)}\n`, { mode: 0o600 });
	fs.renameSync(tmp, file);
	if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
	return file;
}

/** The provider record for three.ws at an origin, with a given inference key. */
export function threeWsProvider({ origin, key, agentId = null }) {
	return {
		provider: THREE_WS_PROVIDER.id,
		base_url: `${String(origin).replace(/\/+$/, '')}${THREE_WS_PROVIDER.path}`,
		model: THREE_WS_PROVIDER.model,
		api_key: key,
		agent_id: agentId,
		updated_at: new Date().toISOString(),
	};
}

export function hermesConfigPath(env = systemEnv()) {
	return path.join(env.vars.HERMES_HOME || path.join(env.home, '.hermes'), 'config.yaml');
}

/** Point a Hermes-style agent's model at a provider, preserving the rest of the file. */
export function writeHermesModel(provider, env = systemEnv()) {
	const file = hermesConfigPath(env);
	let before = '';
	try {
		before = fs.readFileSync(file, 'utf8');
	} catch (err) {
		if (err.code !== 'ENOENT') throw err;
	}
	const doc = YAML.parseDocument(before);
	if (doc.errors.length) throw new Error(`${file} is not valid YAML: ${doc.errors[0].message}`);
	if (!doc.contents) doc.contents = doc.createNode({});
	doc.setIn(['model', 'provider'], 'custom');
	doc.setIn(['model', 'base_url'], provider.base_url);
	doc.setIn(['model', 'api_key'], provider.api_key);
	doc.setIn(['model', 'default'], provider.model);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
	fs.writeFileSync(tmp, doc.toString(), { mode: 0o600 });
	fs.renameSync(tmp, file);
	return file;
}

/**
 * One chat completion against whatever provider is configured right now.
 * Streams content deltas to `onDelta` and resolves with the full text, the
 * token usage, and the three.ws billing line when the provider reports one.
 */
export async function complete({ messages, env = systemEnv(), onDelta, timeoutMs = 120_000 }) {
	const provider = readProvider(env);
	if (!provider) throw new ApiError('no model provider is configured. Run `three-ws provider use three-ws` first.');
	const res = await request(`${provider.base_url.replace(/\/+$/, '')}/chat/completions`, {
		method: 'POST',
		headers: { authorization: `Bearer ${provider.api_key}`, accept: 'text/event-stream' },
		json: {
			model: provider.model,
			messages,
			stream: true,
			stream_options: { include_usage: true },
			...(provider.agent_id ? { agent_id: provider.agent_id } : {}),
		},
		timeoutMs,
	});
	if (!res.ok) {
		const text = await res.text();
		let data = null;
		try {
			data = JSON.parse(text);
		} catch {
			data = null;
		}
		const code = typeof data?.error === 'string' ? data.error : null;
		throw new ApiError(`${res.status} ${code ? `${code}: ` : ''}${data?.error_description || text.slice(0, 200)}`, { status: res.status, code, body: data });
	}

	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let content = '';
	let usage = null;
	let billing = null;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let nl;
		while ((nl = buf.indexOf('\n')) >= 0) {
			const lineText = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (!lineText.startsWith('data:')) continue;
			const payload = lineText.slice(5).trim();
			if (payload === '[DONE]') continue;
			let evt;
			try {
				evt = JSON.parse(payload);
			} catch {
				continue;
			}
			if (evt.usage) usage = evt.usage;
			if (evt.billing) billing = evt.billing;
			const delta = evt.choices?.[0]?.delta?.content;
			if (delta) {
				content += delta;
				onDelta?.(delta);
			}
		}
	}
	return { content, usage, billing, provider: provider.provider, model: provider.model };
}
