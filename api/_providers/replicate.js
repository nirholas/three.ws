// Replicate provider for avatar regeneration jobs.
//
// Implements the contract documented in api/avatars/REGENERATE.md:
//   - submit(request)  → { jobId, eta, extJobId }
//   - status(extJobId) → { status, resultGlbUrl?, error? }
//
// Each regen `mode` maps to a Replicate model that takes a GLB or image and
// returns a regenerated GLB asset. The choice of model is configurable via
// env so the provider can be tuned without code changes:
//
//   REPLICATE_API_TOKEN          — required, from replicate.com/account
//   REPLICATE_RESTYLE_MODEL      — version hash for text-to-3D (Hunyuan3D, Tripo, etc.)
//   REPLICATE_REMESH_MODEL       — version hash for mesh cleanup
//   REPLICATE_RETEX_MODEL        — version hash for re-texturing
//   REPLICATE_RERIG_MODEL        — version hash for rig regeneration
//
// At submit time the provider POSTs to the Replicate predictions API. The
// returned prediction id is stored as `ext_job_id`. The status endpoint
// polls Replicate to translate the predictions API state into our 4-state
// machine.

const REPLICATE_BASE = 'https://api.replicate.com/v1';

function readEnv(name) {
	if (typeof process !== 'undefined' && process.env && process.env[name]) return process.env[name];
	return null;
}

const MODE_TO_ENV = Object.freeze({
	restyle: 'REPLICATE_RESTYLE_MODEL',
	remesh: 'REPLICATE_REMESH_MODEL',
	retex: 'REPLICATE_RETEX_MODEL',
	rerig: 'REPLICATE_RERIG_MODEL',
});

function modelForMode(mode) {
	const envName = MODE_TO_ENV[mode];
	if (!envName) return null;
	return readEnv(envName);
}

// Map our 4 modes onto the input shape each model expects. The exact shape
// depends on the model; we default to a generic { source_url, prompt, mode }
// payload and let provider-side models pick the fields they care about.
// Caller-supplied params override the default shape.
function buildInput({ mode, sourceUrl, params }) {
	const base = {
		mode,
		source_url: sourceUrl,
		source_glb: sourceUrl,
		// Pass through every caller param; later spread wins so explicit
		// overrides take precedence over the defaults above.
		prompt: typeof params?.prompt === 'string' ? params.prompt : undefined,
	};
	return { ...base, ...(params || {}) };
}

function translateStatus(replicateStatus) {
	switch (replicateStatus) {
		case 'starting':
		case 'queued':
			return 'queued';
		case 'processing':
			return 'running';
		case 'succeeded':
			return 'done';
		case 'failed':
		case 'canceled':
			return 'failed';
		default:
			return 'queued';
	}
}

// Extract the first plausible GLB url from a Replicate `output` field. Different
// models emit different shapes — sometimes a string, sometimes an array, sometimes
// a nested object — so we accept a small whitelist of common forms.
function extractGlbUrl(output) {
	if (!output) return null;
	if (typeof output === 'string') return output;
	if (Array.isArray(output)) {
		for (const v of output) {
			if (typeof v === 'string' && /\.glb(\?|$)/i.test(v)) return v;
		}
		// Fall back to the first stringy entry if nothing matched the .glb pattern.
		for (const v of output) {
			if (typeof v === 'string' && /^https?:\/\//.test(v)) return v;
		}
	}
	if (typeof output === 'object') {
		for (const key of ['glb', 'mesh', 'mesh_url', 'output_url', 'url', 'model']) {
			if (typeof output[key] === 'string') return output[key];
		}
	}
	return null;
}

export function createRegenProvider() {
	const token = readEnv('REPLICATE_API_TOKEN');
	if (!token) {
		throw new Error('REPLICATE_API_TOKEN env var is required for the replicate provider');
	}

	const authHeaders = {
		authorization: `Bearer ${token}`,
		'content-type': 'application/json',
	};

	return {
		async submit(request) {
			const version = modelForMode(request.mode);
			if (!version) {
				throw Object.assign(
					new Error(
						`replicate provider has no model configured for mode "${request.mode}" — set ${MODE_TO_ENV[request.mode] || 'the matching REPLICATE_*_MODEL env var'}`,
					),
					{ code: 'mode_unconfigured', status: 501 },
				);
			}

			const input = buildInput({
				mode: request.mode,
				sourceUrl: request.sourceUrl,
				params: request.params,
			});

			let response;
			try {
				response = await fetch(`${REPLICATE_BASE}/predictions`, {
					method: 'POST',
					headers: authHeaders,
					body: JSON.stringify({ version, input }),
				});
			} catch (err) {
				throw Object.assign(new Error(`replicate submit failed: ${err?.message}`), {
					code: 'provider_unreachable',
					status: 502,
				});
			}

			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				throw Object.assign(
					new Error(data?.detail || data?.title || `replicate returned ${response.status}`),
					{ code: 'provider_error', status: 502, providerStatus: response.status },
				);
			}

			return {
				extJobId: data.id,
				eta: typeof data.eta === 'number' ? data.eta : undefined,
				rawStatus: data.status,
			};
		},

		async status(extJobId) {
			if (!extJobId) {
				return { status: 'failed', error: 'missing ext_job_id' };
			}

			let response;
			try {
				response = await fetch(`${REPLICATE_BASE}/predictions/${encodeURIComponent(extJobId)}`, {
					headers: authHeaders,
				});
			} catch (err) {
				return { status: 'running', error: `provider poll failed: ${err?.message}` };
			}

			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				return {
					status: 'failed',
					error: data?.detail || `replicate returned ${response.status}`,
				};
			}

			const status = translateStatus(data.status);
			const result = {
				status,
				rawStatus: data.status,
			};

			if (status === 'done') {
				const glb = extractGlbUrl(data.output);
				if (glb) result.resultGlbUrl = glb;
				else result.error = 'model finished but no GLB found in output';
			}
			if (status === 'failed' && data.error) result.error = String(data.error);

			return result;
		},
	};
}
