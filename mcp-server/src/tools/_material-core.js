// `restyle_material` core: thin HTTP client over the hosted, free
// api/material-studio endpoint. Mirrors _studio-core.js: the real generation
// logic (watsonx PBR proposal, @gltf-transform mutation, gltf-validator,
// persistence) lives server-side in api/_lib/material-studio-store.js so the
// free web Material Studio page and this paid stdio tool call the exact same
// code path and can never drift. This module stays dependency-free (only the
// global `fetch`) so it loads in every runtime the repo bundles it into.
//
// Environment:
//   THREE_WS_API_KEY    : a three.ws API key (a free account is enough). Every
//   material-studio action persists a new model, so the endpoint answers an
//   anonymous caller with 401 sign_in_required; this server restyles on behalf
//   of whoever runs it and sends their key, like the forge tools.
//   MESH_FORGE_API_BASE : three.ws origin. Default https://three.ws (same env
//   key the other generation cores already read, so one override covers all).

export function coreError(code, message, extra) {
	return { ok: false, error: code, message, ...(extra || {}) };
}

function env(k, def) {
	const v = process.env[k];
	return v && String(v).trim() ? String(v).trim() : def;
}

function apiBase() {
	return env('MESH_FORGE_API_BASE', 'https://three.ws').replace(/\/$/, '');
}

const API_KEYS_PATH = '/dashboard/api-keys';

function requestHeaders() {
	const key = env('THREE_WS_API_KEY');
	const headers = { 'content-type': 'application/json' };
	return key ? { ...headers, authorization: `Bearer ${key}` } : headers;
}

function signInError(base) {
	const apiKeysUrl = `${base}${API_KEYS_PATH}`;
	const e = new Error(
		env('THREE_WS_API_KEY')
			? `three.ws refused the API key in THREE_WS_API_KEY. Create a new key at ${apiKeysUrl} and set it in this MCP server's environment.`
			: `Restyling a 3D model needs a three.ws account. Create a free account and an API key at ${apiKeysUrl}, then set THREE_WS_API_KEY in this MCP server's environment.`,
	);
	e.code = 'sign_in_required';
	return e;
}

async function postJson(path, payload) {
	const base = apiBase();
	let res;
	try {
		res = await fetch(`${base}${path}`, {
			method: 'POST',
			headers: requestHeaders(),
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(60_000),
		});
	} catch (err) {
		const e = new Error(`material studio unreachable: ${err?.message || err}`);
		e.code = 'provider_error';
		throw e;
	}
	const data = await res.json().catch(() => ({}));
	if (res.status === 401 || res.status === 403 || data?.error === 'sign_in_required') throw signInError(base);
	if (res.status === 503) {
		const e = new Error(data?.message || 'material restyle is not configured on the three.ws deployment');
		e.code = 'not_configured';
		throw e;
	}
	if (res.status === 429) {
		const e = new Error(data?.message || 'material studio is busy; try again shortly');
		e.code = 'rate_limited';
		throw e;
	}
	if (!res.ok || data?.ok === false) {
		const e = new Error(data?.message || `material studio returned ${res.status}`);
		e.code = data?.error || 'provider_error';
		throw e;
	}
	return data;
}

// ---------------------------------------------------------------------------
// restyle_material: AI PBR restyle (instruction mode) OR seeded colorway
// variant fan-out (preset/seed/count mode). Exactly one of `instruction` /
// `preset` drives which server action runs.
// ---------------------------------------------------------------------------
export async function runRestyleMaterial({
	glb_url,
	instruction,
	preset,
	seed,
	count,
	material_index,
	parent_lineage,
	parent_index,
}) {
	if (!glb_url || typeof glb_url !== 'string' || !glb_url.trim()) {
		return coreError('invalid_input', 'Provide glb_url of the model to restyle.');
	}
	const instructionTrimmed = typeof instruction === 'string' ? instruction.trim() : '';
	const started = Date.now();
	const lineageArgs = {
		...(Array.isArray(parent_lineage) ? { parent_lineage } : {}),
		...(Number.isInteger(parent_index) ? { parent_index } : {}),
	};

	if (instructionTrimmed) {
		let data;
		try {
			data = await postJson('/api/material-studio?action=restyle', {
				glb_url: glb_url.trim(),
				instruction: instructionTrimmed,
				...(Number.isInteger(material_index) ? { material_index } : {}),
				...lineageArgs,
			});
		} catch (err) {
			return coreError(err.code || 'provider_error', err.message);
		}
		return {
			ok: true,
			mode: 'restyle',
			glbUrl: data.glbUrl,
			sourceGlbUrl: data.sourceGlbUrl,
			viewerUrl: `${apiBase()}/viewer?src=${encodeURIComponent(data.glbUrl)}`,
			instruction: data.instruction,
			factors: data.factors,
			materialsEdited: data.materialsEdited,
			lineage: data.lineage,
			activeIndex: data.activeIndex,
			durationMs: Date.now() - started,
			fetchedAt: new Date().toISOString(),
		};
	}

	let data;
	try {
		data = await postJson('/api/material-studio?action=variants', {
			glb_url: glb_url.trim(),
			...(typeof preset === 'string' ? { preset } : {}),
			...(Number.isInteger(seed) ? { seed } : {}),
			...(Number.isInteger(count) ? { count } : {}),
			...(Number.isInteger(material_index) ? { material_index } : {}),
			...lineageArgs,
		});
	} catch (err) {
		return coreError(err.code || 'provider_error', err.message);
	}
	const base = apiBase();
	return {
		ok: true,
		mode: 'variants',
		sourceGlbUrl: data.sourceGlbUrl,
		preset: data.preset,
		seed: data.seed,
		count: data.count,
		variants: (data.variants || []).map((v) => ({
			...v,
			viewerUrl: `${base}/viewer?src=${encodeURIComponent(v.glbUrl)}`,
		})),
		lineage: data.lineage,
		activeIndex: data.activeIndex,
		durationMs: Date.now() - started,
		fetchedAt: new Date().toISOString(),
	};
}
