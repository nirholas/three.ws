// Settings: account, companion mode, updates, startup and security.

import { html, raw, mount, onAction, skeletonLines, errorState } from '../lib/dom.js';

export function updateLine(u) {
	if (!u) return '';
	switch (u.status) {
		case 'unpackaged': return 'Updates apply to installed builds. This is a development run.';
		case 'checking': return 'Checking for updates…';
		case 'current': return 'You are on the latest version.';
		case 'downloading': return `Downloading ${u.available || 'the update'}${u.progress != null ? ` (${u.progress}%)` : ''}…`;
		case 'ready': return `Version ${u.available} is ready. Restart to install it.`;
		case 'error': return `The last check failed: ${u.error}`;
		default: return 'Updates are checked at launch and every four hours.';
	}
}

export function mountSettings(root, ctx) {
	const { bridge, toast } = ctx;
	let info = null;
	let error = null;

	function render() {
		const s = ctx.session();
		if (!info) {
			mount(root, html`<div class="view">${error ? errorState(error) : html`<div class="card">${skeletonLines(8)}</div>`}</div>`);
			return;
		}
		const u = info.update;
		const c = info.companion;
		mount(root, html`<div class="view">
			<header class="head"><div><h1>Settings</h1><p>three.ws Desktop ${info.version}</p></div></header>

			<h2>Account</h2>
			<div class="card">
				<div class="setting"><div class="meta"><b>${s?.user?.name || 'Signed in'}</b><p>${s?.user?.username ? `@${s.user.username} on ` : ''}${s?.apiBase}</p></div>
					<div style="display:flex;gap:8px"><button type="button" class="btn btn-sm" data-action="connections">Manage connections</button><button type="button" class="btn btn-sm btn-danger" data-action="signout">Sign out</button></div></div>
				<div class="setting"><div class="meta"><b>Session storage</b><p>${info.encryptedStore ? 'Encrypted with your system keychain.' : 'This system has no keychain, so the session file is readable only by your user account.'}</p></div>
					<span class="chip ${info.encryptedStore ? 'chip-ok' : 'chip-warn'}">${info.encryptedStore ? 'Encrypted' : 'File only'}</span></div>
			</div>

			<h2>Companion mode</h2>
			<div class="card">
				<div class="setting"><div class="meta"><b>Show the companion on the desktop</b><p>A 3D character walks along the bottom of your screen and delivers what clears your bar, out loud.</p></div>
					<input type="checkbox" class="toggle" data-action="companion" aria-label="Companion mode" ${c.enabled ? raw('checked') : ''} /></div>
				<div class="setting"><div class="meta"><b>Bridge token</b><p>${c.signedIn ? `Connected to ${c.apiBase}` : 'Companion deliveries need the bridge token from three.ws/companion.'}</p></div>
					<button type="button" class="btn btn-sm" data-action="companion-token">${c.signedIn ? 'Change token' : 'Connect'}</button></div>
			</div>

			<h2>Updates</h2>
			<div class="card">
				<div class="setting"><div class="meta"><b>Version ${info.version}</b><p>${updateLine(u)}</p>
					${u.status === 'downloading' && u.progress != null ? html`<div class="progress" role="progressbar" aria-valuenow="${u.progress}" aria-valuemin="0" aria-valuemax="100"><span style="width:${u.progress}%"></span></div>` : ''}</div>
					${u.status === 'ready'
						? html`<button type="button" class="btn btn-sm btn-go" data-action="install">Restart and update</button>`
						: html`<button type="button" class="btn btn-sm" data-action="check" ${!info.packaged || ['checking', 'downloading'].includes(u.status) ? raw('disabled') : ''}>Check now</button>`}</div>
				<div class="setting"><div class="meta"><b>What is new</b><p>Every release is on the public changelog.</p></div>
					<button type="button" class="btn btn-sm btn-ghost" data-action="changelog">Changelog</button></div>
			</div>

			<h2>System</h2>
			<div class="card">
				<div class="setting"><div class="meta"><b>Start at login</b><p>Opens quietly in the ${info.platform === 'darwin' ? 'menu bar' : 'system tray'} so notifications keep arriving.</p></div>
					<input type="checkbox" class="toggle" data-action="login" aria-label="Start at login" ${info.launchAtLogin ? raw('checked') : ''} /></div>
				<div class="setting"><div class="meta"><b>Help</b><p>Guides for the console, companion mode and connecting editors.</p></div>
					<button type="button" class="btn btn-sm btn-ghost" data-action="docs">Desktop docs</button></div>
			</div>
		</div>`);
	}

	async function load() {
		try {
			info = await bridge.app.info();
			error = null;
		} catch (err) {
			error = err;
		}
		render();
	}

	const offUpdate = bridge.app.onUpdate((u) => {
		if (!info) return;
		info.update = u;
		render();
	});
	const offCompanion = bridge.app.onCompanion((c) => {
		if (!info) return;
		info.companion = c;
		render();
	});

	const offActions = onAction(root, {
		retry: load,
		signout: async (el) => {
			el.disabled = true;
			await bridge.session.signOut().catch((err) => toast(err.message, 'bad'));
		},
		connections: () => bridge.app.openExternal('/dashboard/settings#connected-apps'),
		companion: async (el) => {
			try {
				info.companion = await bridge.app.setCompanion(el.checked);
			} catch (err) {
				toast(err.message, 'bad');
			}
			render();
		},
		'companion-token': () => bridge.app.companionSignIn(),
		check: () => bridge.app.checkUpdates().catch((err) => toast(err.message, 'bad')),
		install: () => bridge.app.installUpdate(),
		changelog: () => bridge.app.openExternal('/changelog'),
		login: async (el) => {
			try {
				info.launchAtLogin = await bridge.app.setLaunchAtLogin(el.checked);
			} catch (err) {
				toast(err.message, 'bad');
			}
			render();
		},
		docs: () => bridge.app.openExternal('/docs/desktop'),
	});

	load();
	return () => {
		offUpdate();
		offCompanion();
		offActions();
	};
}
