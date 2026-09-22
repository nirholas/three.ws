// three.ws Desktop: the main process.
//
// One app, two faces:
//
//   - The console: a window for operating your agents. Sign in once through
//     the browser (OAuth 2.1 + PKCE on a loopback port), then see your agents,
//     chat with them and watch their tools work, follow runs step by step,
//     check wallets and approve or cancel what an agent wants to spend,
//     receive account notifications as native OS notifications, and wire
//     three.ws into every coding client on the machine in one click.
//   - Companion mode (src/main/companion.js): the 3D character that walks the
//     desktop and delivers what matters in person. Toggle it from the tray or
//     from Settings.
//
// Security posture: the console renderer is sandboxed, context-isolated, has
// no network access of its own (its CSP allows no connections), and never sees
// a token. Every request goes through this process, which attaches the bearer.
// Anything that moves money goes through src/main/previews.js: a single-use
// preview id, then a native confirmation built from the stored request.

import { app, BrowserWindow, Tray, Menu, ipcMain, shell, Notification, nativeImage, dialog, safeStorage } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createSecureStore } from './main/secure-store.js';
import { createSession } from './main/session.js';
import { createConsoleApi } from './main/console-api.js';
import { createPreviewRegistry, isGuardedPath } from './main/previews.js';
import { createNotifier } from './main/notifier.js';
import { createUpdater } from './main/updater.js';
import { createCompanion } from './main/companion.js';
import { detectEditors, connectEditor, disconnectEditor, mcpServers } from './main/editors.js';

const SRC = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(SRC, '..', 'assets');

// ── Settings (non-secret preferences) ────────────────────────────────────────

const settingsFile = () => join(app.getPath('userData'), 'settings.json');

function readSettings() {
	try {
		return JSON.parse(readFileSync(settingsFile(), 'utf8'));
	} catch {
		return {};
	}
}

function writeSettings(patch) {
	const next = { ...readSettings(), ...patch };
	mkdirSync(dirname(settingsFile()), { recursive: true });
	writeFileSync(settingsFile(), JSON.stringify(next, null, 2));
	return next;
}

// ── State ────────────────────────────────────────────────────────────────────

const state = {
	console: null,
	tray: null,
	unread: 0,
	chats: new Map(),
	runWatches: new Map(),
};

let session;
let api;
let previews;
let notifier;
let updater;
let companion;
let store;

function sendToConsole(channel, payload) {
	const win = state.console;
	if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ── Console window ───────────────────────────────────────────────────────────

function openConsole(view) {
	if (state.console && !state.console.isDestroyed()) {
		if (state.console.isMinimized()) state.console.restore();
		state.console.show();
		state.console.focus();
		if (view) sendToConsole('app:navigate', view);
		return state.console;
	}
	if (process.platform === 'darwin') app.dock?.show();
	const win = new BrowserWindow({
		width: 1180,
		height: 780,
		minWidth: 860,
		minHeight: 560,
		show: false,
		title: 'three.ws',
		backgroundColor: '#0d0d10',
		...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } } : {}),
		icon: join(ASSETS, 'icon.png'),
		webPreferences: {
			preload: join(SRC, 'console-preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: true,
		},
	});
	win.loadFile(join(SRC, 'console', 'index.html'), view ? { hash: view } : undefined);
	win.once('ready-to-show', () => win.show());
	win.on('focus', () => notifier?.setFocused(true));
	win.on('blur', () => notifier?.setFocused(false));
	win.on('closed', () => {
		state.console = null;
		notifier?.setFocused(false);
		for (const c of state.chats.values()) c.abort();
		state.chats.clear();
		for (const w of state.runWatches.values()) w.abort();
		state.runWatches.clear();
		if (process.platform === 'darwin') app.dock?.hide();
	});
	if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
	state.console = win;
	return win;
}

// Links out of the app: https anywhere, and site-relative paths on the server
// the person signed in to. Everything else is dropped.
function openExternal(url) {
	const target = String(url || '');
	if (/^https:\/\//i.test(target)) return shell.openExternal(target).then(() => true);
	if (/^\/(?!\/)/.test(target)) return shell.openExternal(`${session.apiBase()}${target}`).then(() => true);
	if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(target)) return shell.openExternal(target).then(() => true);
	return Promise.resolve(false);
}

// ── Tray / menu bar ──────────────────────────────────────────────────────────

function trayIcon() {
	const img = nativeImage.createFromPath(join(ASSETS, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray-icon.png'));
	if (img.isEmpty()) return nativeImage.createEmpty();
	if (process.platform === 'darwin') img.setTemplateImage(true);
	return img;
}

function refreshTray() {
	if (!state.tray) return;
	const s = session.status();
	const c = companion.status();
	const u = updater.state();
	const who = s.signedIn ? (s.user?.name || 'Signed in') : 'Not signed in';
	state.tray.setToolTip(`three.ws Desktop: ${who}${state.unread ? `, ${state.unread} unread` : ''}`);
	if (process.platform === 'darwin') state.tray.setTitle(state.unread ? String(state.unread) : '');

	const template = [
		{ label: `three.ws Desktop · ${who}`, enabled: false },
		{ type: 'separator' },
		{ label: 'Open console', accelerator: 'CommandOrControl+Shift+Space', click: () => openConsole() },
		...(s.signedIn ? [
			{ label: state.unread ? `Notifications (${state.unread} unread)` : 'Notifications', click: () => openConsole('notifications') },
			{ label: 'Chat', click: () => openConsole('chat') },
			{ label: 'Wallet and approvals', click: () => openConsole('wallet') },
		] : [
			{ label: 'Sign in…', click: () => openConsole() },
		]),
		{ type: 'separator' },
		{ label: 'Companion mode', type: 'checkbox', checked: c.enabled, click: (item) => setCompanionMode(item.checked) },
		...(c.enabled ? [
			{ label: c.paused ? 'Resume deliveries' : 'Pause deliveries', click: () => companion.togglePause() },
			{ label: 'Say the last one again', enabled: c.hasLastDelivery, click: () => companion.replayLast() },
			{ label: c.signedIn ? 'Change bridge token…' : 'Connect companion…', click: () => companion.openSignIn() },
		] : []),
		{ type: 'separator' },
		u.status === 'ready'
			? { label: `Restart to update to ${u.available}`, click: () => updater.installNow() }
			: { label: u.status === 'checking' ? 'Checking for updates…' : u.status === 'downloading' ? `Downloading update${u.progress != null ? ` (${u.progress}%)` : ''}…` : 'Check for updates', enabled: app.isPackaged && !['checking', 'downloading'].includes(u.status), click: () => updater.check() },
		{
			label: 'Start at login',
			type: 'checkbox',
			checked: app.getLoginItemSettings().openAtLogin,
			click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true }),
		},
		{ type: 'separator' },
		{ label: 'Quit three.ws', role: 'quit' },
	];
	state.tray.setContextMenu(Menu.buildFromTemplate(template));
}

function setCompanionMode(enabled) {
	writeSettings({ companionMode: Boolean(enabled) });
	const s = enabled ? companion.enable() : companion.disable();
	sendToConsole('app:companion', s);
	refreshTray();
	return s;
}

// ── Native notifications ─────────────────────────────────────────────────────

function showNativeNotification(n) {
	if (!Notification.isSupported()) return;
	const toast = new Notification({ title: n.title, body: n.text, silent: false });
	toast.on('click', () => {
		openConsole('notifications');
		api.markRead(n.id).catch(() => {});
	});
	toast.show();
}

// The last gate before real funds move. Built from the summary the main
// process stored with the preview, never from anything the renderer sent.
async function confirmFinancial(summary) {
	const lines = [
		`Recipient: ${summary.recipient || 'unknown'}`,
		`Amount: ${summary.amount ?? 'unknown'} ${summary.token || ''}`.trim(),
		`Chain: ${summary.chain || 'Solana'}`,
		summary.usd != null ? `Value: about $${Number(summary.usd).toFixed(2)}` : null,
		'',
		'This moves real funds and cannot be undone.',
	].filter((l) => l !== null);
	const parent = state.console && !state.console.isDestroyed() ? state.console : undefined;
	const { response } = await dialog.showMessageBox(parent, {
		type: 'warning',
		buttons: ['Cancel', 'Send'],
		defaultId: 0,
		cancelId: 0,
		noLink: true,
		title: 'Confirm send',
		message: `Send ${summary.amount ?? ''} ${summary.token || ''} to ${summary.recipient || 'this address'}?`.replace(/\s+/g, ' '),
		detail: lines.join('\n'),
	});
	return response === 1;
}

// ── IPC ──────────────────────────────────────────────────────────────────────

// Every console call answers { ok, data } or { ok: false, error }, because a
// rejected ipcMain.handle loses everything but the message, and the renderer
// needs the code (signed_out, preview_expired, ...) to pick the right state.
function handle(channel, fn) {
	ipcMain.handle(channel, async (event, ...args) => {
		if (!state.console || event.sender !== state.console.webContents) return { ok: false, error: { message: 'Not allowed from this window', code: 'forbidden' } };
		try {
			return { ok: true, data: await fn(...args) };
		} catch (err) {
			return { ok: false, error: { message: err?.message || String(err), code: err?.code || null, status: err?.status || null } };
		}
	});
}

function editorContext() {
	return {
		home: homedir(),
		platform: process.platform,
		env: process.env,
		claudeCli: (args) => new Promise((resolve, reject) => {
			execFile('claude', args, { timeout: 20_000, shell: process.platform === 'win32' }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
		}),
	};
}

function appInfo() {
	return {
		version: app.getVersion(),
		platform: process.platform,
		arch: process.arch,
		packaged: app.isPackaged,
		update: updater.state(),
		companion: companion.status(),
		encryptedStore: store.encrypted(),
		launchAtLogin: app.getLoginItemSettings().openAtLogin,
		mcpServers: mcpServers(session.apiBase()),
	};
}

function registerIpc() {
	handle('session:status', () => session.status());
	handle('session:signIn', (opts) => session.signIn(opts || {}));
	handle('session:cancelSignIn', () => session.cancelSignIn());
	handle('session:signOut', async () => {
		notifier.stop();
		api.resetCapabilities();
		return session.signOut();
	});
	handle('session:refreshUser', () => session.refreshUser());

	handle('capabilities', () => api.capabilities());
	handle('agents:list', () => api.listAgents());
	handle('agents:setStatus', (agentId, running) => api.setAgentStatus(agentId, running));

	handle('chat:history', (agentId) => api.chatHistory(agentId));
	handle('chat:send', ({ agentId, message, history }) => {
		const requestId = randomUUID();
		const controller = new AbortController();
		state.chats.set(requestId, controller);
		api.sendChat({ agentId, message, history, signal: controller.signal }, (evt) => sendToConsole('chat:event', { requestId, ...evt }))
			.catch((err) => {
				if (controller.signal.aborted) sendToConsole('chat:event', { requestId, type: 'aborted' });
				else sendToConsole('chat:event', { requestId, type: 'error', message: err.message, code: err.code || null });
			})
			.finally(() => {
				state.chats.delete(requestId);
				sendToConsole('chat:event', { requestId, type: 'end' });
			});
		return { requestId };
	});
	handle('chat:abort', (requestId) => {
		state.chats.get(requestId)?.abort();
		return true;
	});

	handle('runs:list', (agentId) => api.listRuns(agentId));
	handle('runs:detail', (runId) => api.runDetail(runId));
	handle('runs:create', (agentId, input) => api.createRun(agentId, input));
	handle('runs:cancel', (runId) => api.cancelRun(runId));
	handle('runs:watch', (runId) => {
		state.runWatches.get(runId)?.abort();
		const controller = new AbortController();
		state.runWatches.set(runId, controller);
		api.streamRun(runId, (evt) => sendToConsole('runs:event', { runId, ...evt }), controller.signal)
			.catch((err) => {
				if (!controller.signal.aborted) sendToConsole('runs:event', { runId, type: 'error', message: err.message });
			})
			.finally(() => {
				if (state.runWatches.get(runId) === controller) state.runWatches.delete(runId);
				sendToConsole('runs:event', { runId, type: 'end' });
			});
		return true;
	});
	handle('runs:unwatch', (runId) => {
		state.runWatches.get(runId)?.abort();
		state.runWatches.delete(runId);
		return true;
	});

	handle('wallet:get', (agentId) => api.wallet(agentId));
	handle('preview:create', (kind, input) => previews.create(kind, input));
	handle('preview:approve', (previewId) => previews.approve(previewId));
	handle('preview:cancel', (previewId) => previews.cancel(previewId));
	handle('proposal:dismiss', (agentId, proposalId) => api.dismissProposal(agentId, proposalId));

	handle('notifications:list', (opts) => api.notifications(opts || {}));
	handle('notifications:read', async (id) => {
		await api.markRead(id);
		return notifier.poll();
	});
	handle('notifications:readAll', async () => {
		await api.markAllRead();
		return notifier.poll();
	});

	handle('editors:detect', () => detectEditors(editorContext(), session.apiBase()));
	handle('editors:connect', (id) => connectEditor(editorContext(), id, session.apiBase()));
	handle('editors:disconnect', (id) => disconnectEditor(editorContext(), id, session.apiBase()));

	handle('app:info', () => appInfo());
	handle('app:setCompanion', (enabled) => setCompanionMode(enabled));
	handle('app:companionSignIn', () => companion.openSignIn());
	handle('app:checkUpdates', () => updater.check());
	handle('app:installUpdate', () => updater.installNow());
	handle('app:setLaunchAtLogin', (enabled) => {
		app.setLoginItemSettings({ openAtLogin: Boolean(enabled), openAsHidden: true });
		refreshTray();
		return app.getLoginItemSettings().openAtLogin;
	});
	handle('app:openExternal', (url) => openExternal(url));
	// A generic read for views that need a route not wrapped above. Reads only:
	// every write has its own typed channel, and money has none but previews.
	handle('api:get', (path) => {
		if (isGuardedPath(path, 'GET')) throw new Error('Not allowed');
		return session.request(String(path));
	});
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

function lockDownNavigation() {
	app.on('web-contents-created', (_event, contents) => {
		contents.setWindowOpenHandler(({ url }) => {
			openExternal(url);
			return { action: 'deny' };
		});
		contents.on('will-navigate', (event, url) => {
			if (!url.startsWith('file://')) {
				event.preventDefault();
				openExternal(url);
			}
		});
	});
}

function boot() {
	store = createSecureStore({ file: join(app.getPath('userData'), 'session.bin'), safeStorage });
	session = createSession({
		store,
		version: app.getVersion(),
		openBrowser: (url) => shell.openExternal(url),
		onChange: (status) => {
			sendToConsole('session:changed', status);
			if (status.signedIn) notifier?.start();
			else notifier?.stop();
			refreshTray();
		},
	});
	api = createConsoleApi({ session });
	previews = createPreviewRegistry({ request: (path, init) => session.request(path, init), confirm: confirmFinancial });
	notifier = createNotifier({
		api,
		onNew: showNativeNotification,
		onUnread: (count) => {
			state.unread = count;
			sendToConsole('notifications:unread', count);
			if (process.platform !== 'win32') app.setBadgeCount(count);
			refreshTray();
		},
	});
	updater = createUpdater({
		app,
		onState: (s) => {
			sendToConsole('updater:state', s);
			refreshTray();
		},
	});
	companion = createCompanion({ srcDir: SRC, onChange: (s) => { sendToConsole('app:companion', s); refreshTray(); } });

	registerIpc();

	state.tray = new Tray(trayIcon());
	state.tray.on('click', () => (process.platform === 'darwin' ? state.tray.popUpContextMenu() : openConsole()));
	refreshTray();

	if (readSettings().companionMode) companion.enable();
	if (session.status().signedIn) notifier.start();
	updater.start();

	// Launched at login stays in the tray; launched by hand opens the console.
	const hidden = app.getLoginItemSettings().wasOpenedAsHidden || process.argv.includes('--hidden');
	if (!hidden) openConsole();
}

// One instance only: two consoles would double every notification.
if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.setAppUserModelId('ws.three.desktop');
	lockDownNavigation();
	app.on('second-instance', () => openConsole());
	app.on('activate', () => openConsole());
	app.whenReady().then(boot);
	// Closing the console leaves the app in the tray; Quit lives in the tray menu.
	app.on('window-all-closed', () => {});
	app.on('before-quit', () => {
		companion?.stop();
		notifier?.stop();
	});
}
