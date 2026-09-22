// Auto-update over the release feed that apps/desktop/cloudbuild.yaml publishes
// to the release bucket behind the three.ws CDN (https://three.ws/releases/desktop/).
// electron-builder bakes that feed into the installed app as app-update.yml
// (the `publish` block in electron-builder.config.cjs), so a packaged build
// needs no configuration here. THREE_WS_UPDATE_FEED points a build at another
// generic feed, which is how a second build is proven to update the first.

import electronUpdater from 'electron-updater';

const { autoUpdater } = electronUpdater;
const CHECK_EVERY_MS = 4 * 60 * 60 * 1000;

export function createUpdater({ app, onState }) {
	let state = { status: app.isPackaged ? 'idle' : 'unpackaged', version: app.getVersion(), available: null, progress: null, error: null };
	let interval = null;

	const set = (patch) => {
		state = { ...state, ...patch };
		onState(state);
	};

	if (app.isPackaged) {
		autoUpdater.autoDownload = true;
		autoUpdater.autoInstallOnAppQuit = true;
		autoUpdater.allowDowngrade = false;
		if (process.env.THREE_WS_UPDATE_FEED) {
			autoUpdater.setFeedURL({ provider: 'generic', url: process.env.THREE_WS_UPDATE_FEED });
		}
		autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
		autoUpdater.on('update-not-available', () => set({ status: 'current', available: null, progress: null }));
		autoUpdater.on('update-available', (info) => set({ status: 'downloading', available: info?.version || null, progress: 0 }));
		autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p?.percent || 0) }));
		autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', available: info?.version || state.available, progress: 100 }));
		autoUpdater.on('error', (err) => set({ status: 'error', error: err?.message || String(err) }));
	}

	async function check() {
		if (!app.isPackaged) return state;
		try {
			await autoUpdater.checkForUpdates();
		} catch (err) {
			set({ status: 'error', error: err?.message || String(err) });
		}
		return state;
	}

	function start() {
		if (!app.isPackaged || interval) return;
		check();
		interval = setInterval(check, CHECK_EVERY_MS);
	}

	function installNow() {
		if (state.status !== 'ready') return false;
		// isSilent=false shows the installer UI on Windows; forceRunAfter reopens the app.
		setImmediate(() => autoUpdater.quitAndInstall(false, true));
		return true;
	}

	return { start, check, installNow, state: () => state };
}
