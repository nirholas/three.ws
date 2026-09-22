// Companion mode: a transparent, click-through strip along the bottom of the
// screen with a 3D character living in it. The character walks across the
// desktop, and when something arrives that clears your bar (a message from a
// saved contact, a meeting about to start, a one-time code, an agent that
// decided you need to know), it walks over, turns to you, and says it aloud.
//
// Three details make it feel like part of the machine rather than a browser:
//
//   1. The window ignores the mouse everywhere except the character and its
//      speech bubble. `setIgnoreMouseEvents(true, { forward: true })` still
//      delivers move events to the renderer, so the renderer tells us the
//      moment the pointer is over something clickable and we hand input back.
//   2. It is visible on every workspace, including over full-screen apps
//      (macOS panel level), so it is a companion rather than another window.
//   3. Its credential is the bridge token the companion CLI uses
//      (packages/companion-sdk/src/config.js), so `companion login` on the
//      command line signs this mode in too, and rotating the token at
//      three.ws/companion revokes every device at once.

import { BrowserWindow, ipcMain, screen, shell, Notification } from 'electron';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createCompanionClient } from '@three-ws/companion';
import { resolveCredentials, writeConfig, configPath } from '@three-ws/companion/config';

// How tall a strip of the screen the companion lives in. A full-screen
// transparent window over every display costs compositor work for nothing.
const STAGE_HEIGHT = 420;

export function createCompanion({ srcDir, onChange }) {
	const state = {
		enabled: false,
		window: null,
		client: null,
		stopStream: null,
		paused: false,
		lastDelivery: null,
		connected: false,
		signInWindow: null,
	};

	const credentials = () => resolveCredentials();
	const changed = () => onChange(status());

	function status() {
		const { token, apiBase } = credentials();
		return {
			enabled: state.enabled,
			signedIn: Boolean(token),
			apiBase,
			paused: state.paused,
			connected: state.connected,
			hasLastDelivery: Boolean(state.lastDelivery),
			configPath: configPath(),
		};
	}

	function stageBounds() {
		const area = screen.getPrimaryDisplay().workArea;
		return {
			x: area.x,
			y: area.y + Math.max(0, area.height - STAGE_HEIGHT),
			width: area.width,
			height: Math.min(STAGE_HEIGHT, area.height),
		};
	}

	function reposition() {
		if (state.window && !state.window.isDestroyed()) state.window.setBounds(stageBounds());
	}

	function createStageWindow() {
		const win = new BrowserWindow({
			...stageBounds(),
			transparent: true,
			frame: false,
			resizable: false,
			movable: false,
			minimizable: false,
			maximizable: false,
			fullscreenable: false,
			skipTaskbar: true,
			hasShadow: false,
			focusable: false,
			show: false,
			// 'panel' floats above full-screen apps on macOS; the other platforms
			// take the plain always-on-top path.
			...(process.platform === 'darwin' ? { type: 'panel' } : {}),
			webPreferences: {
				preload: join(srcDir, 'preload.cjs'),
				contextIsolation: true,
				nodeIntegration: false,
				// The renderer embeds three.ws/walk-embed in an iframe; that is the
				// only remote content it loads.
				sandbox: false,
			},
		});
		win.setAlwaysOnTop(true, 'screen-saver');
		win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
		// Click-through by default; the renderer hands input back when the
		// pointer is genuinely over the character or its bubble.
		win.setIgnoreMouseEvents(true, { forward: true });
		win.loadFile(join(srcDir, 'renderer', 'index.html'));
		win.once('ready-to-show', () => win.showInactive());
		if (process.argv.includes('--dev')) win.webContents.openDevTools({ mode: 'detach' });
		return win;
	}

	function send(channel, payload) {
		if (state.window && !state.window.isDestroyed()) state.window.webContents.send(channel, payload);
	}

	function connect() {
		state.stopStream?.();
		state.stopStream = null;
		state.connected = false;

		const { token, apiBase } = credentials();
		if (!token) {
			send('companion:status', { signedIn: false, apiBase });
			changed();
			return;
		}

		state.client = createCompanionClient({ token, apiBase });
		send('companion:status', { signedIn: true, apiBase, paused: state.paused });

		state.stopStream = state.client.stream({
			onOpen: (hello) => {
				state.connected = true;
				changed();
				send('companion:connected', { ...hello, apiBase });
			},
			onDelivery: (delivery) => {
				state.lastDelivery = delivery;
				changed();
				if (state.paused) return;
				send('companion:delivery', delivery);
				// The stage says it; the OS notification is the fallback for a
				// machine whose GPU refused the renderer.
				if (!state.window || state.window.isDestroyed()) notifyNatively(delivery);
				state.client.markDelivered(delivery.id).catch(() => {});
			},
			onError: () => {
				state.connected = false;
				changed();
			},
		});
		changed();
	}

	function notifyNatively(delivery) {
		if (!Notification.isSupported()) return;
		new Notification({
			title: delivery.speaker || 'Your companion',
			body: delivery.spoken_line || delivery.title || '',
			silent: false,
		}).show();
	}

	function openSignIn() {
		if (state.signInWindow && !state.signInWindow.isDestroyed()) {
			state.signInWindow.focus();
			return;
		}
		state.signInWindow = new BrowserWindow({
			width: 460,
			height: 400,
			resizable: false,
			title: 'Connect companion mode',
			webPreferences: {
				preload: join(srcDir, 'preload.cjs'),
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		state.signInWindow.loadFile(join(srcDir, 'renderer', 'sign-in.html'));
		state.signInWindow.on('closed', () => {
			state.signInWindow = null;
		});
	}

	function enable() {
		if (state.enabled) return status();
		state.enabled = true;
		state.window = createStageWindow();
		screen.on('display-metrics-changed', reposition);
		screen.on('display-added', reposition);
		screen.on('display-removed', reposition);
		connect();
		if (!credentials().token) openSignIn();
		changed();
		return status();
	}

	function disable() {
		if (!state.enabled) return status();
		state.enabled = false;
		state.stopStream?.();
		state.stopStream = null;
		state.connected = false;
		screen.removeListener('display-metrics-changed', reposition);
		screen.removeListener('display-added', reposition);
		screen.removeListener('display-removed', reposition);
		if (state.window && !state.window.isDestroyed()) state.window.destroy();
		state.window = null;
		changed();
		return status();
	}

	function togglePause() {
		state.paused = !state.paused;
		send('companion:status', { signedIn: Boolean(credentials().token), paused: state.paused });
		changed();
		return status();
	}

	function replayLast() {
		if (state.lastDelivery) send('companion:delivery', state.lastDelivery);
	}

	// ── IPC for the stage and its bridge-token window ────────────────────────
	ipcMain.handle('companion:credentials', () => {
		const { token, apiBase } = credentials();
		return { signedIn: Boolean(token), apiBase, paused: state.paused, configPath: configPath() };
	});

	ipcMain.handle('companion:save-token', async (_event, { token, apiBase }) => {
		const trimmed = String(token || '').trim();
		if (!trimmed) return { ok: false, error: 'Paste the bridge token from three.ws/companion.' };
		const base = String(apiBase || credentials().apiBase);
		try {
			// Prove it before storing it: a bad token should fail here, in a window
			// the person is looking at, not silently at 3am.
			await createCompanionClient({ token: trimmed, apiBase: base }).list({ limit: 1 });
		} catch (err) {
			return { ok: false, error: `That token was refused: ${err.message}` };
		}
		writeConfig({ token: trimmed, apiBase: base });
		if (state.enabled) connect();
		changed();
		return { ok: true };
	});

	ipcMain.handle('companion:open-external', (_event, url) => {
		const target = String(url || '');
		if (!/^https?:\/\//i.test(target)) return false;
		shell.openExternal(target);
		return true;
	});

	// The renderer owns hit-testing: it knows where the character and bubble are.
	ipcMain.on('companion:set-interactive', (_event, interactive) => {
		if (!state.window || state.window.isDestroyed()) return;
		state.window.setIgnoreMouseEvents(!interactive, { forward: true });
	});

	// macOS ships a real speech synthesiser; used when the hosted voice lanes and
	// the renderer's own speech synthesis both come up empty.
	ipcMain.on('companion:say-native', (_event, text) => {
		if (process.platform !== 'darwin') return;
		try {
			spawn('say', [String(text).slice(0, 500)], { stdio: 'ignore', detached: true }).unref();
		} catch {
			// No `say` binary: the bubble already carries the line.
		}
	});

	ipcMain.on('companion:notify-native', (_event, delivery) => notifyNatively(delivery || {}));

	return { enable, disable, status, togglePause, replayLast, openSignIn, stop: () => state.stopStream?.() };
}
