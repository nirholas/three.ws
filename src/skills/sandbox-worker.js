// Sandbox worker — executes skill handlers in an isolated Web Worker scope.
// No DOM, no window, no document. Only ctx.* and native worker APIs.

/** @type {Map<string, object>} skillURI → module exports */
const _skillHandlers = new Map();

/** @type {Map<number, { resolve: Function, reject: Function, timeoutId: number }>} */
const _pendingRequests = new Map();

/** @type {Map<string, Promise<void>>} skillURI → install promise (deduplication) */
const _installPromises = new Map();

/** @type {Map<string, { resolve: Function, reject: Function }>} */
const _installCallbacks = new Map();

let _requestId = 0;

self.onmessage = ({ data }) => {
	switch (data.type) {
		case 'install':
			_install(data);
			break;
		case 'invoke':
			_invoke(data);
			break;
		case 'response':
			_handleResponse(data);
			break;
	}
};

async function _install({ skillURI, handlersSrc }) {
	// Deduplicate concurrent install requests for the same skill
	if (_installPromises.has(skillURI)) return;

	const promise = new Promise((resolve, reject) => {
		_installCallbacks.set(skillURI, { resolve, reject });
	});
	_installPromises.set(skillURI, promise);

	let url;
	try {
		const blob = new Blob([handlersSrc], { type: 'text/javascript' });
		url = URL.createObjectURL(blob);
		// Dynamic import from blob URL — works in module workers
		const mod = await import(/* @vite-ignore */ url);
		_skillHandlers.set(skillURI, mod);
		_installCallbacks.get(skillURI)?.resolve();
		self.postMessage({ type: 'install-ack', skillURI, ok: true });
	} catch (err) {
		_installPromises.delete(skillURI);
		_installCallbacks.get(skillURI)?.reject(err);
		_installCallbacks.delete(skillURI);
		self.postMessage({ type: 'install-ack', skillURI, ok: false, error: err.message });
	} finally {
		if (url) URL.revokeObjectURL(url);
	}
}

function _makeCtx(invocationId, skillBaseURI) {
	// Each method sends a request to main thread and awaits a structured-cloneable response.
	// Non-serializable objects (AnimationClip, GLTF) are stored in the host's handle registry
	// and represented here as opaque "@h:N" strings.
	const proxy = (method, args) =>
		new Promise((resolve, reject) => {
			const id = ++_requestId;
			const timeoutId = setTimeout(() => {
				_pendingRequests.delete(id);
				reject(new Error(`ctx.${method} timed out after 30s`));
			}, 30_000);
			_pendingRequests.set(id, { resolve, reject, timeoutId });
			self.postMessage({ type: 'request', invocationId, requestId: id, method, args });
		});

	return {
		viewer: {
			play: (clip, opts) => proxy('viewer.play', [clip, opts]),
			stop: (clipName) => proxy('viewer.stop', [clipName]),
			setExpression: (preset, intensity) => proxy('viewer.setExpression', [preset, intensity]),
			lookAt: (target) => proxy('viewer.lookAt', [target]),
			moveTo: (position, opts) => proxy('viewer.moveTo', [position, opts]),
			playAnimationByHint: (hint, opts) => proxy('viewer.playAnimationByHint', [hint, opts]),
			playClipByName: (name, opts) => proxy('viewer.playClipByName', [name, opts]),
		},
		llm: {
			complete: (prompt, opts) => proxy('llm.complete', [prompt, opts]),
			embed: (text) => proxy('llm.embed', [text]),
		},
		memory: {
			read: (key) => proxy('memory.read', [key]),
			write: (key, value) => proxy('memory.write', [key, value]),
			note: (type, data) => proxy('memory.note', [type, data]),
			recall: (query) => proxy('memory.recall', [query]),
		},
		// Asset loading — results are opaque handle strings; pass back to viewer.play etc.
		loadClip: (uri) => proxy('loadClip', [uri]),
		loadGLB: (uri) => proxy('loadGLB', [uri]),
		// fetch and loadJSON use native worker fetch — no proxy needed
		fetch: (uri, opts) => fetch(uri, opts),
		loadJSON: async (uri) => (await fetch(uri)).json(),
		call: (toolName, toolArgs) => proxy('call', [toolName, toolArgs]),
		speak: (text) => proxy('speak', [text]),
		listen: (opts) => proxy('listen', [opts]),
		skillBaseURI,
	};
}

async function _invoke({ invocationId, skillURI, toolName, args, skillBaseURI }) {
	// Wait for install to complete (handles the install→invoke race)
	const installPromise = _installPromises.get(skillURI);
	if (installPromise) {
		try {
			await installPromise;
		} catch (err) {
			self.postMessage({ type: 'invoke-result', invocationId, error: `Install failed: ${err.message}` });
			return;
		}
	}

	const mod = _skillHandlers.get(skillURI);
	if (!mod) {
		self.postMessage({ type: 'invoke-result', invocationId, error: `Skill not installed: ${skillURI}` });
		return;
	}

	const fn = mod[toolName];
	if (typeof fn !== 'function') {
		self.postMessage({
			type: 'invoke-result',
			invocationId,
			error: `No handler "${toolName}" in skill "${skillURI}"`,
		});
		return;
	}

	try {
		const ctx = _makeCtx(invocationId, skillBaseURI);
		const result = await fn(args, ctx);
		self.postMessage({ type: 'invoke-result', invocationId, result: result ?? null });
	} catch (err) {
		self.postMessage({ type: 'invoke-result', invocationId, error: err.message || String(err) });
	}
}

function _handleResponse({ requestId, result, error }) {
	const pending = _pendingRequests.get(requestId);
	if (!pending) return;
	clearTimeout(pending.timeoutId);
	_pendingRequests.delete(requestId);
	if (error !== undefined) {
		pending.reject(new Error(error));
	} else {
		pending.resolve(result);
	}
}
