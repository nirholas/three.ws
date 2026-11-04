// A2A JSON-RPC wire protocol: one internal shape, two dialects on the wire.
//
// The A2A specification moved from 0.3 (methods `message/send`, `tasks/get`;
// parts tagged with `kind`; lowercase roles and states) to 1.0 (methods
// `SendMessage`, `GetTask`; untagged oneof parts; `ROLE_*` and `TASK_STATE_*`
// enums; the `A2A-Version` header). The spec asks servers to accept both during
// the overlap, and our own peers (api/_lib/x402/a2a-client.js) still speak 0.3.
//
// So the service works on one internal shape (the 0.3 one, which the existing
// a2a-x402 payment flow already produces) and this module translates at the
// edge:
//   inbound   detectDialect() picks the dialect from the method name and the
//             A2A-Version header; normalizeMessage() turns either message form
//             (and the even older `type`-tagged parts some clients still send)
//             into the internal form.
//   outbound  serializeTask() / serializeMessage() / sendResult() emit the
//             caller's dialect.
//
// Spec: https://a2a-protocol.org/dev/specification/ (specification/a2a.proto).

export const A2A_VERSION_HEADER = 'A2A-Version';
// 1.0 renamed the extension activation header; 0.3 clients send the X- form.
export const A2A_EXTENSIONS_HEADER_V1 = 'A2A-Extensions';
export const A2A_EXTENSIONS_HEADER_LEGACY = 'X-A2A-Extensions';

export const DIALECT_V1 = '1.0';
export const DIALECT_LEGACY = '0.3';
export const SUPPORTED_VERSIONS = [DIALECT_LEGACY, DIALECT_V1];

// JSON-RPC error codes: the standard ones plus the A2A-specific range.
export const RPC = {
	PARSE_ERROR: -32700,
	INVALID_REQUEST: -32600,
	METHOD_NOT_FOUND: -32601,
	INVALID_PARAMS: -32602,
	INTERNAL_ERROR: -32603,
	TASK_NOT_FOUND: -32001,
	TASK_NOT_CANCELABLE: -32002,
	PUSH_NOTIFICATION_NOT_SUPPORTED: -32003,
	UNSUPPORTED_OPERATION: -32004,
	CONTENT_TYPE_NOT_SUPPORTED: -32005,
	INVALID_AGENT_RESPONSE: -32006,
	EXTENDED_CARD_NOT_CONFIGURED: -32007,
	EXTENSION_SUPPORT_REQUIRED: -32008,
	VERSION_NOT_SUPPORTED: -32009,
};

// Method name to operation, per dialect.
const METHODS = {
	'message/send': { op: 'send', dialect: DIALECT_LEGACY },
	'tasks/get': { op: 'get', dialect: DIALECT_LEGACY },
	'tasks/cancel': { op: 'cancel', dialect: DIALECT_LEGACY },
	'message/stream': { op: 'stream', dialect: DIALECT_LEGACY },
	'tasks/resubscribe': { op: 'stream', dialect: DIALECT_LEGACY },
	'tasks/pushNotificationConfig/set': { op: 'push', dialect: DIALECT_LEGACY },
	'tasks/pushNotificationConfig/get': { op: 'push', dialect: DIALECT_LEGACY },
	'tasks/pushNotificationConfig/list': { op: 'push', dialect: DIALECT_LEGACY },
	'tasks/pushNotificationConfig/delete': { op: 'push', dialect: DIALECT_LEGACY },
	'agent/getAuthenticatedExtendedCard': { op: 'extendedCard', dialect: DIALECT_LEGACY },
	SendMessage: { op: 'send', dialect: DIALECT_V1 },
	GetTask: { op: 'get', dialect: DIALECT_V1 },
	CancelTask: { op: 'cancel', dialect: DIALECT_V1 },
	ListTasks: { op: 'list', dialect: DIALECT_V1 },
	SendStreamingMessage: { op: 'stream', dialect: DIALECT_V1 },
	SubscribeToTask: { op: 'stream', dialect: DIALECT_V1 },
	CreateTaskPushNotificationConfig: { op: 'push', dialect: DIALECT_V1 },
	GetTaskPushNotificationConfig: { op: 'push', dialect: DIALECT_V1 },
	ListTaskPushNotificationConfigs: { op: 'push', dialect: DIALECT_V1 },
	DeleteTaskPushNotificationConfig: { op: 'push', dialect: DIALECT_V1 },
	GetExtendedAgentCard: { op: 'extendedCard', dialect: DIALECT_V1 },
};

export function rpcResult(id, result) {
	return { jsonrpc: '2.0', id, result };
}

export function rpcError(id, code, message, data) {
	const error = { code, message };
	if (data !== undefined) error.data = data;
	return { jsonrpc: '2.0', id, error };
}

function headerValue(headers, name) {
	const raw = headers?.[name.toLowerCase()];
	if (raw === undefined || raw === null) return null;
	return Array.isArray(raw) ? raw.join(',') : String(raw);
}

/**
 * Resolve the operation and dialect of an inbound JSON-RPC call.
 * Returns { op, dialect } or { error: { code, message } }.
 */
export function detectDialect(method, headers = {}) {
	const entry = Object.prototype.hasOwnProperty.call(METHODS, method) ? METHODS[method] : null;
	if (!entry) return { error: { code: RPC.METHOD_NOT_FOUND, message: `Method not found: ${method}` } };
	const requested = headerValue(headers, A2A_VERSION_HEADER);
	if (requested !== null && requested.trim() !== '') {
		const v = requested.trim();
		// Accept "1", "1.0" and "1.0.x"; "0.3" and "0.3.x".
		const major = v.split('.').slice(0, 2).join('.');
		const normalized = major === '1' ? DIALECT_V1 : major;
		if (!SUPPORTED_VERSIONS.includes(normalized)) {
			return {
				error: {
					code: RPC.VERSION_NOT_SUPPORTED,
					message: `A2A version ${v} is not supported; this agent speaks ${SUPPORTED_VERSIONS.join(' and ')}`,
				},
			};
		}
	}
	return { op: entry.op, dialect: entry.dialect };
}

/** Extension URIs the client activated, from either header name. */
export function requestedExtensions(headers = {}) {
	const out = new Set();
	for (const name of [A2A_EXTENSIONS_HEADER_V1, A2A_EXTENSIONS_HEADER_LEGACY]) {
		const raw = headerValue(headers, name);
		if (!raw) continue;
		for (const v of raw.split(',')) {
			const t = v.trim();
			if (t) out.add(t);
		}
	}
	return out;
}

// ── inbound ─────────────────────────────────────────────────────────────────

function normalizePart(part) {
	if (!part || typeof part !== 'object') return null;
	const tag = part.kind || part.type;
	const metadata = part.metadata && typeof part.metadata === 'object' ? part.metadata : undefined;
	if (typeof part.text === 'string' && (!tag || tag === 'text')) {
		return { kind: 'text', text: part.text, ...(metadata ? { metadata } : {}) };
	}
	if (part.data !== undefined && (!tag || tag === 'data')) {
		return { kind: 'data', data: part.data, ...(metadata ? { metadata } : {}) };
	}
	// 1.0 file reference: { url, mediaType, filename }.
	if (typeof part.url === 'string' && !tag) {
		return {
			kind: 'file',
			file: { uri: part.url, mimeType: part.mediaType, name: part.filename },
			...(metadata ? { metadata } : {}),
		};
	}
	// 1.0 inline bytes: { raw: <base64>, mediaType, filename }.
	if (typeof part.raw === 'string' && !tag) {
		return {
			kind: 'file',
			file: { bytes: part.raw, mimeType: part.mediaType, name: part.filename },
			...(metadata ? { metadata } : {}),
		};
	}
	// 0.3 file part: { kind: 'file', file: { uri | bytes, mimeType, name } }.
	if (tag === 'file' && part.file && typeof part.file === 'object') {
		return { kind: 'file', file: { ...part.file }, ...(metadata ? { metadata } : {}) };
	}
	return null;
}

/**
 * Validate and normalize an inbound message (either dialect) into the internal
 * 0.3 form. Returns { message } or { error }.
 */
export function normalizeMessage(raw) {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { error: 'message is required' };
	}
	const parts = Array.isArray(raw.parts) ? raw.parts.map(normalizePart) : null;
	if (!parts || !parts.length) return { error: 'message.parts must be a non-empty array' };
	if (parts.some((p) => p === null)) {
		return { error: 'every message part must be a text, data, url or raw part' };
	}
	const role = String(raw.role || 'user').toLowerCase().replace(/^role_/, '');
	if (role !== 'user' && role !== 'agent') return { error: `unknown message role ${raw.role}` };
	const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
	return {
		message: {
			kind: 'message',
			role,
			messageId: str(raw.messageId),
			taskId: str(raw.taskId),
			contextId: str(raw.contextId),
			parts,
			metadata: raw.metadata && typeof raw.metadata === 'object' ? raw.metadata : undefined,
		},
	};
}

// ── outbound ────────────────────────────────────────────────────────────────

function stateV1(state) {
	return `TASK_STATE_${String(state || 'unknown').toUpperCase().replace(/-/g, '_')}`;
}

function partV1(part) {
	const metadata = part.metadata ? { metadata: part.metadata } : {};
	if (part.kind === 'text') return { text: part.text, ...metadata };
	if (part.kind === 'data') return { data: part.data, ...metadata };
	if (part.kind === 'file') {
		const f = part.file || {};
		const common = {
			...(f.mimeType ? { mediaType: f.mimeType } : {}),
			...(f.name ? { filename: f.name } : {}),
			...metadata,
		};
		if (f.uri) return { url: f.uri, ...common };
		if (f.bytes) return { raw: f.bytes, ...common };
	}
	return { data: part, ...metadata };
}

function clean(obj) {
	for (const k of Object.keys(obj)) if (obj[k] === undefined) delete obj[k];
	return obj;
}

export function serializeMessage(message, dialect) {
	if (!message) return undefined;
	if (dialect !== DIALECT_V1) return clean({ ...message });
	return clean({
		messageId: message.messageId,
		contextId: message.contextId,
		taskId: message.taskId,
		role: message.role === 'agent' ? 'ROLE_AGENT' : 'ROLE_USER',
		parts: (message.parts || []).map(partV1),
		metadata: message.metadata,
		extensions: message.extensions,
	});
}

function serializeArtifact(artifact, dialect) {
	if (dialect !== DIALECT_V1) return artifact;
	return clean({
		artifactId: artifact.artifactId,
		name: artifact.name,
		description: artifact.description,
		parts: (artifact.parts || []).map(partV1),
		metadata: artifact.metadata,
		extensions: artifact.extensions,
	});
}

/** Serialize an internal task for the wire. `historyLength` trims history. */
export function serializeTask(task, dialect, { historyLength } = {}) {
	let history = Array.isArray(task.history) ? task.history : undefined;
	if (history && Number.isInteger(historyLength) && historyLength >= 0) {
		history = historyLength === 0 ? undefined : history.slice(-historyLength);
	}
	const status = clean({
		state: dialect === DIALECT_V1 ? stateV1(task.status?.state) : task.status?.state,
		message: serializeMessage(task.status?.message, dialect),
		timestamp: task.status?.timestamp,
	});
	const out = clean({
		...(dialect === DIALECT_V1 ? {} : { kind: 'task' }),
		id: task.id,
		contextId: task.contextId,
		status,
		artifacts: Array.isArray(task.artifacts) && task.artifacts.length
			? task.artifacts.map((a) => serializeArtifact(a, dialect))
			: undefined,
		history: history?.map((m) => serializeMessage(m, dialect)),
		metadata: task.metadata,
	});
	return out;
}

/** The result of a send: 0.3 returns the Task itself, 1.0 wraps it in { task }. */
export function sendResult(task, dialect) {
	const t = serializeTask(task, dialect, { historyLength: 0 });
	return dialect === DIALECT_V1 ? { task: t } : t;
}

/** A direct agent reply with no task (both dialects allow it for a send). */
export function sendMessageResult(message, dialect) {
	const m = serializeMessage(message, dialect);
	return dialect === DIALECT_V1 ? { message: m } : m;
}

export const TERMINAL_STATES = new Set(['completed', 'failed', 'canceled', 'rejected']);
