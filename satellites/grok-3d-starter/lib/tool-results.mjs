// Turns what a three.ws MCP tool returned into one small, typed result the
// page can act on. The input arrives through xAI's `mcp_call` output item,
// whose `output` may be the full MCP result as JSON, the structured content
// alone, or only the text content, so every branch reads both the structured
// fields and the text lines three.ws always writes ("GLB: ...", "Viewer: ...").

const LINK = String.raw`https:\/\/[^\s)"'\]<>]+`;
const GLB_LINE = new RegExp(String.raw`^\s*GLB:\s*(${LINK})`, 'mi');
const VIEWER_LINE = new RegExp(String.raw`^\s*Viewer[^:\n]*:\s*(${LINK})`, 'mi');
const POSTER_LINE = new RegExp(String.raw`^\s*Poster PNG:\s*(${LINK})`, 'mi');
const JOB_IN_LINK = /[?&]job=([\w.-]+)/;
const PENDING_TEXT = /still (?:rendering|running|working)/i;
const SIGN_IN_TEXT = /Sign in to make a 3D model/i;
const BAD_TOKEN_TEXT = /missing or invalid access token|\bunauthori[sz]ed\b/i;

/** "three-ws___forge_free", "three-ws.forge_free" and "forge_free" all name forge_free. */
export function bareToolName(name) {
	const s = String(name || '');
	const m = s.match(/(?:___|__|\.|\/|:)([a-z0-9_]+)$/i);
	return m ? m[1] : s;
}

function contentText(content) {
	if (!Array.isArray(content)) return '';
	return content
		.filter((part) => part && part.type === 'text' && typeof part.text === 'string')
		.map((part) => part.text)
		.join('\n');
}

/** Normalise an mcp_call output into { structured, text, isError }. */
export function parseToolOutput(output) {
	let value = output;
	if (typeof value === 'string') {
		const trimmed = value.trim();
		if (trimmed.startsWith('{')) {
			try {
				value = JSON.parse(trimmed);
			} catch {
				return { structured: null, text: value, isError: false };
			}
		} else {
			return { structured: null, text: value, isError: false };
		}
	}
	if (!value || typeof value !== 'object') return { structured: null, text: '', isError: false };
	// A JSON-RPC envelope, as three.ws answers tools/call.
	if (value.result && typeof value.result === 'object' && !Array.isArray(value.result)) value = value.result;
	if (Array.isArray(value.content) || value.structuredContent) {
		return {
			structured: value.structuredContent && typeof value.structuredContent === 'object' ? value.structuredContent : null,
			text: contentText(value.content),
			isError: value.isError === true,
		};
	}
	return { structured: value, text: typeof value.message === 'string' ? value.message : '', isError: value.error === true };
}

function first(...values) {
	for (const v of values) if (typeof v === 'string' && v) return v;
	return null;
}

function finite(value) {
	const n = typeof value === 'number' ? value : Number.NaN;
	return Number.isFinite(n) ? n : null;
}

/** Catalog entries from the text form: "- `id` | Title | License | tags" then "GLB:" and "Viewer:" lines. */
function catalogFromText(text) {
	const items = [];
	const blocks = text.split(/\n(?=- `)/);
	for (const block of blocks) {
		const head = block.match(/^- `([^`]+)`\s*\|\s*([^|\n]+?)\s*\|\s*([^|\n]+?)\s*(?:\||$)/m);
		const glb = block.match(GLB_LINE);
		if (!head || !glb) continue;
		const viewer = block.match(VIEWER_LINE);
		const poster = block.match(POSTER_LINE);
		items.push({ id: head[1], title: head[2], license: head[3], glbUrl: glb[1], viewerUrl: viewer ? viewer[1] : null, thumb: poster ? poster[1] : null, bytes: null });
	}
	return items;
}

function catalogItem(item) {
	return {
		id: String(item.id || item.name || ''),
		title: String(item.title || item.name || item.id || 'Untitled'),
		license: item.license ? String(item.license) : null,
		glbUrl: first(item.glb_url, item.url),
		viewerUrl: first(item.viewer_url),
		thumb: first(item.thumb, item.poster_png_url),
		bytes: finite(item.bytes),
	};
}

function modelLabel(sc, tool) {
	if (typeof sc.instruction === 'string' && sc.instruction) return sc.instruction;
	if (typeof sc.title === 'string' && sc.title) return sc.title;
	if (typeof sc.prompt === 'string' && sc.prompt) return sc.prompt;
	return tool === 'refine_model' ? 'Refined model' : 'Model';
}

/**
 * The typed result of one tool call.
 * kind: 'model' | 'pending' | 'catalog' | 'sign_in_required' | 'bad_key' | 'failed' | 'info'
 */
export function interpretToolResult({ name, output, error } = {}) {
	const tool = bareToolName(name);
	const errorText = typeof error === 'string' ? error : error && typeof error === 'object' ? String(error.message || JSON.stringify(error)) : '';
	const parsed = parseToolOutput(output);
	const sc = parsed.structured || {};
	const text = parsed.text || '';
	const anyText = `${text}\n${errorText}\n${typeof sc.message === 'string' ? sc.message : ''}`;

	if (sc.status === 'sign_in_required' || sc.reason === 'sign_in_required' || SIGN_IN_TEXT.test(anyText)) {
		return {
			kind: 'sign_in_required',
			tool,
			message: first(sc.message, text, errorText) || 'Sign in to three.ws to make a model.',
			apiKeysUrl: first(sc.api_keys_url) || 'https://three.ws/dashboard/api-keys',
		};
	}

	if (sc.status === 'pending' || (!sc.status && !parsed.isError && PENDING_TEXT.test(text))) {
		const viewerUrl = first(sc.viewer_url, sc.viewerUrl) || (text.match(VIEWER_LINE) || [])[1] || null;
		const jobId = first(sc.job_id, sc.jobId) || (`${viewerUrl || ''} ${text}`.match(JOB_IN_LINK) || [])[1] || null;
		if (jobId) {
			return {
				kind: 'pending',
				tool,
				jobId,
				phase: first(sc.phase, sc.stage) || 'queued',
				progress: finite(sc.progress),
				etaSeconds: finite(sc.etaRemainingSeconds) ?? finite(sc.eta_seconds),
				elapsedSeconds: finite(sc.elapsed_seconds),
				viewerUrl,
				refine: sc.refine && typeof sc.refine === 'object' ? sc.refine : null,
				prompt: first(sc.prompt),
			};
		}
	}

	const glbUrl = first(sc.glb_url, sc.glbUrl) || (text.match(GLB_LINE) || [])[1] || null;
	if (glbUrl && !Array.isArray(sc.items) && !/^- `/m.test(text)) {
		return {
			kind: 'model',
			tool,
			glbUrl,
			viewerUrl: first(sc.viewer_url, sc.viewerUrl) || (text.match(VIEWER_LINE) || [])[1] || null,
			posterUrl: first(sc.poster_png_url) || (text.match(POSTER_LINE) || [])[1] || null,
			prompt: first(sc.prompt),
			instruction: first(sc.instruction),
			label: modelLabel(sc, tool),
			lineage: Array.isArray(sc.lineage) ? sc.lineage : null,
			activeIndex: finite(sc.activeIndex),
		};
	}

	if (Array.isArray(sc.items) || /^- `/m.test(text)) {
		const items = (Array.isArray(sc.items) ? sc.items.map(catalogItem) : catalogFromText(text)).filter((item) => item.glbUrl);
		return { kind: 'catalog', tool, items };
	}

	if (BAD_TOKEN_TEXT.test(anyText) && !sc.status) {
		return { kind: 'bad_key', tool, message: first(sc.error_description, sc.message, text, errorText) || 'three.ws rejected the API key.' };
	}

	if (parsed.isError || sc.error === true || errorText) {
		return {
			kind: 'failed',
			tool,
			message: first(sc.message, text, errorText) || 'The tool call failed.',
			reason: first(sc.reason, sc.status),
			retryable: sc.retryable === true,
		};
	}

	return { kind: 'info', tool, text };
}

/** A model link Grok wrote in its reply, used only when no tool result carried one. */
export function modelFromText(text) {
	const s = String(text || '');
	const viewer = s.match(new RegExp(String.raw`https:\/\/three\.ws\/viewer\?src=[^\s)"'\]<>]+`));
	if (viewer) {
		try {
			const src = new URL(viewer[0]).searchParams.get('src');
			if (src && /^https:\/\//.test(src)) return { kind: 'model', tool: null, glbUrl: src, viewerUrl: viewer[0], posterUrl: null, prompt: null, instruction: null, label: 'Model', lineage: null, activeIndex: null };
		} catch {
			return null;
		}
	}
	const glb = s.match(new RegExp(String.raw`https:\/\/[^\s)"'\]<>]+\.glb\b`));
	if (glb) return { kind: 'model', tool: null, glbUrl: glb[0], viewerUrl: null, posterUrl: null, prompt: null, instruction: null, label: 'Model', lineage: null, activeIndex: null };
	return null;
}
