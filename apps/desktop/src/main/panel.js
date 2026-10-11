// The menu bar panel: a small popover under the tray icon (above it on a
// taskbar) that shows your agent alive in 3D with the numbers you would
// otherwise open the console for. It owns no business logic. Everything it
// shows comes from the same services the console uses (cloud agents, wallet,
// local runtime, notifications, companion), and every action goes through a
// typed channel to those services. Approving a trade is not one of them: the
// panel can only ask for the native review dialog.

import { BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PANEL_WIDTH, PANEL_HEIGHT, placePanel, anchorFor, shouldOpenOnClick, faceView, localSummary } from '../panel/model.js';

const SYNC_VISIBLE_MS = 45_000;
const SYNC_HIDDEN_MS = 5 * 60_000;

export function createPanel({ srcDir, session, api, runtime, companion, getUnread, readSettings, writeSettings, openConsole, setCompanionMode, openExternal, onChange }) {
	let win = null;
	let tray = null;
	let lastBlurHideAt = 0;
	let timer = null;
	let syncing = false;
	let syncedAt = null;
	let syncError = null;
	let agents = [];
	let wallet = null;
	let walletFor = null;
	const asks = new Map();

	const send = (channel, payload) => {
		if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
	};

	function selectedAgent() {
		const want = readSettings().panelAgent;
		return agents.find((a) => a.id === want) || agents[0] || null;
	}

	function localAgentName(id) {
		return runtime.listAgents().find((a) => a.id === id)?.name || 'Local agent';
	}

	/** Everything the panel draws, built from caches so it is instant and never hits the network. */
	function snapshot() {
		const status = session.status();
		const local = runtime.listAgents();
		const pending = runtime.listApprovals({ status: 'pending' }).map((a) => ({
			id: a.id,
			agentName: localAgentName(a.agentId || a.agent_id),
			text: String(a.text || '').split('\n').slice(0, 2).join(' '),
			hash: String(a.hash || '').slice(0, 12),
		}));
		const selected = selectedAgent();
		const c = companion.status();
		return {
			signedIn: status.signedIn,
			user: status.user ? { name: status.user.name || null } : null,
			apiBase: session.apiBase(),
			agents: agents.map((a) => ({ id: a.id, name: a.name, status: a.status, isPublished: a.isPublished })),
			selected: selected ? { id: selected.id, name: selected.name, status: selected.status, isPublished: selected.isPublished, solanaAddress: selected.solanaAddress } : null,
			wallet: wallet && walletFor === selected?.id ? wallet : null,
			local: { agents: local.map((a) => ({ id: a.id, name: a.name, status: a.status })), face: runtime.face(), summary: localSummary(local) },
			face: faceView(runtime.face()),
			pending,
			unread: getUnread(),
			companion: { enabled: c.enabled, paused: c.paused, signedIn: c.signedIn },
			syncing,
			syncedAt,
			syncError,
		};
	}

	function push() {
		const snap = snapshot();
		send('panel:state', snap);
		onChange?.(snap);
	}

	/** Refreshes the network-backed parts (agents, wallet) and pushes the result. */
	async function sync() {
		if (!session.status().signedIn) {
			agents = [];
			wallet = null;
			walletFor = null;
			syncedAt = null;
			syncError = null;
		}
		if (syncing || !session.status().signedIn) {
			push();
			return;
		}
		syncing = true;
		push();
		try {
			agents = await api.listAgents();
			syncError = null;
			const selected = selectedAgent();
			if (selected) {
				try {
					const w = await api.wallet(selected.id);
					wallet = { sol: w.sol, address: w.address, network: w.network, error: w.balanceError || null };
				} catch (err) {
					wallet = { sol: null, address: selected.solanaAddress, network: null, error: err.message };
				}
				walletFor = selected.id;
			}
			syncedAt = Date.now();
		} catch (err) {
			syncError = err.code === 'signed_out' ? null : err.message || 'Could not reach three.ws';
		} finally {
			syncing = false;
			push();
		}
	}

	function schedule() {
		clearTimeout(timer);
		const visible = win && !win.isDestroyed() && win.isVisible();
		timer = setTimeout(() => {
			sync().finally(schedule);
		}, visible ? SYNC_VISIBLE_MS : SYNC_HIDDEN_MS);
	}

	// ── Window ──────────────────────────────────────────────────────────────

	function ensureWindow() {
		if (win && !win.isDestroyed()) return win;
		win = new BrowserWindow({
			width: PANEL_WIDTH,
			height: PANEL_HEIGHT,
			show: false,
			frame: false,
			resizable: false,
			movable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			skipTaskbar: true,
			alwaysOnTop: true,
			transparent: process.platform === 'darwin',
			hasShadow: true,
			roundedCorners: true,
			backgroundColor: process.platform === 'darwin' ? '#00000000' : '#0d0d10',
			...(process.platform === 'darwin' ? { vibrancy: 'under-window', visualEffectState: 'active' } : {}),
			webPreferences: {
				preload: join(srcDir, 'panel-preload.cjs'),
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
			},
		});
		if (process.platform === 'darwin') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		win.loadFile(join(srcDir, 'panel', 'index.html'));
		win.on('blur', () => {
			if (win.webContents.isDevToolsOpened()) return;
			if (win.isVisible()) {
				lastBlurHideAt = Date.now();
				win.hide();
				schedule();
			}
		});
		win.on('closed', () => {
			win = null;
		});
		return win;
	}

	function show() {
		const w = ensureWindow();
		const anchor = anchorFor(tray?.getBounds(), screen.getCursorScreenPoint());
		const display = screen.getDisplayNearestPoint({ x: anchor.x, y: anchor.y });
		w.setBounds(placePanel(anchor, { width: PANEL_WIDTH, height: PANEL_HEIGHT }, display.workArea));
		w.show();
		w.focus();
		send('panel:show', snapshot());
		sync();
		schedule();
	}

	function hide() {
		if (win && !win.isDestroyed() && win.isVisible()) win.hide();
		schedule();
	}

	function toggle() {
		if (win && !win.isDestroyed() && win.isVisible()) return hide();
		if (!shouldOpenOnClick(lastBlurHideAt, Date.now())) return undefined;
		return show();
	}

	// ── IPC ─────────────────────────────────────────────────────────────────

	function handle(channel, fn) {
		ipcMain.handle(channel, async (event, ...args) => {
			if (!win || win.isDestroyed() || event.sender !== win.webContents) return { ok: false, error: { message: 'Not allowed from this window', code: 'forbidden' } };
			try {
				return { ok: true, data: await fn(...args) };
			} catch (err) {
				return { ok: false, error: { message: err?.message || String(err), code: err?.code || null } };
			}
		});
	}

	function register() {
		handle('panel:state', () => snapshot());
		handle('panel:refresh', async () => {
			await sync();
			return snapshot();
		});
		handle('panel:select', async (agentId) => {
			if (!agents.some((a) => a.id === String(agentId))) throw new Error('That agent is not in your account');
			writeSettings({ panelAgent: String(agentId) });
			wallet = null;
			walletFor = null;
			await sync();
			return snapshot();
		});
		handle('panel:setAgentRunning', async (agentId, running) => {
			const updated = await api.setAgentStatus(String(agentId), Boolean(running));
			agents = agents.map((a) => (a.id === updated.id ? { ...a, ...updated } : a));
			push();
			return snapshot();
		});
		handle('panel:toggleLocal', () => {
			const { action } = localSummary(runtime.listAgents());
			for (const a of runtime.listAgents()) {
				if (a.status === 'killed') continue;
				if (action === 'resume' && a.status === 'paused') runtime.resume(a.id);
				if (action === 'pause' && a.status !== 'paused') runtime.pause(a.id);
			}
			push();
			return snapshot();
		});
		handle('panel:review', async (approvalId) => {
			// The native dialog is modal over the whole app; the panel hides first
			// so it is not left floating behind it.
			hide();
			const result = await companionReview(String(approvalId));
			push();
			return result;
		});
		handle('panel:ask', (message) => {
			const text = String(message || '').trim().slice(0, 2000);
			const agent = selectedAgent();
			if (!text) throw new Error('Type a message first.');
			if (!agent) throw new Error('Pick an agent first.');
			const requestId = randomUUID();
			const controller = new AbortController();
			asks.set(requestId, controller);
			api.sendChat({ agentId: agent.id, message: text, history: [], signal: controller.signal }, (evt) => send('panel:chat', { requestId, ...evt }))
				.catch((err) => {
					if (controller.signal.aborted) send('panel:chat', { requestId, type: 'aborted' });
					else send('panel:chat', { requestId, type: 'error', message: err.message, code: err.code || null });
				})
				.finally(() => {
					asks.delete(requestId);
					send('panel:chat', { requestId, type: 'end' });
				});
			return { requestId };
		});
		handle('panel:abortAsk', (requestId) => {
			asks.get(String(requestId))?.abort();
			return true;
		});
		handle('panel:setCompanion', (enabled) => {
			setCompanionMode(Boolean(enabled));
			push();
			return snapshot();
		});
		handle('panel:open', (view) => {
			hide();
			openConsole(view ? String(view) : undefined);
			return true;
		});
		handle('panel:openExternal', (url) => openExternal(url));
		handle('panel:hide', () => {
			hide();
			return true;
		});
	}

	let companionReview = async () => ({ status: 'unavailable' });

	return {
		register,
		attachTray(t) {
			tray = t;
		},
		setReview(fn) {
			companionReview = fn;
		},
		toggle,
		show,
		hide,
		/** Cheap: called whenever a cache elsewhere changed. */
		touch: push,
		sync,
		stop() {
			clearTimeout(timer);
			for (const c of asks.values()) c.abort();
			asks.clear();
			if (win && !win.isDestroyed()) win.destroy();
		},
		pendingCount: () => runtime.listApprovals({ status: 'pending' }).length,
	};
}
