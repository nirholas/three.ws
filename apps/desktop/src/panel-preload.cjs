// The only bridge between the menu bar panel and the machine. Sandboxed and
// context-isolated: typed calls into the main process and nothing else. There
// is no approve call. Approving a trade opens a native dialog built in the main
// process from the stored approval, so the panel can only ask for a review.

const { contextBridge, ipcRenderer } = require('electron');

async function call(channel, ...args) {
	const res = await ipcRenderer.invoke(channel, ...args);
	if (res && res.ok) return res.data;
	const err = new Error(res?.error?.message || 'Something went wrong');
	err.code = res?.error?.code || null;
	throw err;
}

function on(channel, handler) {
	const listener = (_event, payload) => handler(payload);
	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('panel', {
	state: () => call('panel:state'),
	refresh: () => call('panel:refresh'),
	select: (agentId) => call('panel:select', agentId),
	setAgentRunning: (agentId, running) => call('panel:setAgentRunning', agentId, running),
	toggleLocal: () => call('panel:toggleLocal'),
	review: (approvalId) => call('panel:review', approvalId),
	ask: (message) => call('panel:ask', message),
	abortAsk: (requestId) => call('panel:abortAsk', requestId),
	setCompanion: (enabled) => call('panel:setCompanion', enabled),
	open: (view) => call('panel:open', view),
	openExternal: (url) => call('panel:openExternal', url),
	hide: () => call('panel:hide'),
	onState: (fn) => on('panel:state', fn),
	onChat: (fn) => on('panel:chat', fn),
	onShow: (fn) => on('panel:show', fn),
});
