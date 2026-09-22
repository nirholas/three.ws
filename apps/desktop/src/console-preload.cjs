// The only bridge between the console renderer and the machine.
//
// The renderer is sandboxed and context-isolated. It gets typed calls into the
// main process and nothing else: no fs, no process, no raw ipcRenderer, and no
// token. Every call resolves with data or throws an Error carrying the
// server's `code`, so views can tell "signed out" from "offline" from
// "preview expired".

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
	const res = await ipcRenderer.invoke(channel, ...args);
	if (res && res.ok) return res.data;
	const err = new Error(res?.error?.message || 'Something went wrong');
	err.code = res?.error?.code || null;
	err.status = res?.error?.status || null;
	throw err;
}

function on(channel, handler) {
	const listener = (_event, payload) => handler(payload);
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('threews', {
	session: {
		status: () => call('session:status'),
		signIn: (opts) => call('session:signIn', opts),
		cancelSignIn: () => call('session:cancelSignIn'),
		signOut: () => call('session:signOut'),
		refreshUser: () => call('session:refreshUser'),
		onChange: (fn) => on('session:changed', fn),
	},
	capabilities: () => call('capabilities'),
	agents: {
		list: () => call('agents:list'),
		setStatus: (agentId, running) => call('agents:setStatus', agentId, running),
	},
	chat: {
		history: (agentId) => call('chat:history', agentId),
		send: (payload) => call('chat:send', payload),
		abort: (requestId) => call('chat:abort', requestId),
		onEvent: (fn) => on('chat:event', fn),
	},
	runs: {
		list: (agentId) => call('runs:list', agentId),
		detail: (runId) => call('runs:detail', runId),
		create: (agentId, input) => call('runs:create', agentId, input),
		cancel: (runId) => call('runs:cancel', runId),
		watch: (runId) => call('runs:watch', runId),
		unwatch: (runId) => call('runs:unwatch', runId),
		onEvent: (fn) => on('runs:event', fn),
	},
	wallet: {
		get: (agentId) => call('wallet:get', agentId),
		dismissProposal: (agentId, proposalId) => call('proposal:dismiss', agentId, proposalId),
	},
	previews: {
		create: (kind, input) => call('preview:create', kind, input),
		approve: (previewId) => call('preview:approve', previewId),
		cancel: (previewId) => call('preview:cancel', previewId),
	},
	notifications: {
		list: (opts) => call('notifications:list', opts),
		read: (id) => call('notifications:read', id),
		readAll: () => call('notifications:readAll'),
		onUnread: (fn) => on('notifications:unread', fn),
	},
	editors: {
		detect: () => call('editors:detect'),
		connect: (id) => call('editors:connect', id),
		disconnect: (id) => call('editors:disconnect', id),
	},
	app: {
		info: () => call('app:info'),
		setCompanion: (enabled) => call('app:setCompanion', enabled),
		companionSignIn: () => call('app:companionSignIn'),
		checkUpdates: () => call('app:checkUpdates'),
		installUpdate: () => call('app:installUpdate'),
		setLaunchAtLogin: (enabled) => call('app:setLaunchAtLogin', enabled),
		openExternal: (url) => call('app:openExternal', url),
		onNavigate: (fn) => on('app:navigate', fn),
		onCompanion: (fn) => on('app:companion', fn),
		onUpdate: (fn) => on('updater:state', fn),
	},
	api: {
		get: (path) => call('api:get', path),
	},
});
