// Desktop entry: boot, lock, then either walk in as an avatar or land on the
// desktop. Every boot line settles on a real request; the lock screen waits
// for the visitor's gesture (which is also what unlocks the chime); deep links
// and `?view=desktop` skip the world so a shared `/?app=forge` still opens Forge.

import './theme.css';
import './desktop.css';
import './styles.css';
import './boot.css';
import { createShell } from './shell.js';
import { APPS, ALL_APPS } from './apps.js';
import { deepLinkApp, initialsOf, sanitizePrefs } from './layout.js';
import { runBootSteps, entryMode, showBoot, gpuName } from './boot-logic.js';
import { createBootScreen, playChime } from './boot.js';
import { isWebGLAvailable } from '../webgl-support.js';
import { anonId } from './world/mine.js';

const PREFS_KEY = 'tws:prefs';
const AVATAR_GLB = '/avatars/default.glb';
const CLIP_MANIFEST = '/animations/manifest.json';

const reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function readPrefs() {
	try {
		return sanitizePrefs(localStorage.getItem(PREFS_KEY), []);
	} catch {
		return sanitizePrefs(null, []);
	}
}

async function json(url, init) {
	const r = await fetch(url, { credentials: 'include', ...init });
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return r.json();
}

function fmtUsd(n) {
	if (!Number.isFinite(n)) return '';
	return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toPrecision(3)}`;
}
function fmtPct(n) {
	if (!Number.isFinite(n)) return '';
	return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;
}
function fmtBytes(n) {
	return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;
}

/** The boot checks. Each resolves to the detail string shown on its line. */
function bootSteps(root, webgl) {
	return [
		{
			id: 'graphics',
			label: 'Graphics',
			task: async () => {
				if (!webgl) throw new Error('WebGL unavailable, 3D campus disabled');
				const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
				const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
				const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'WebGL';
				gl?.getExtension('WEBGL_lose_context')?.loseContext();
				return gpuName(name);
			},
		},
		{
			id: 'catalog',
			label: 'Site catalog',
			task: async () => {
				const r = await fetch('/nav-data.js');
				if (!r.ok) throw new Error(`HTTP ${r.status}`);
				const text = await r.text();
				const n = (text.match(/href:\s*'/g) || []).length;
				return n ? `${n} pages` : 'loaded';
			},
		},
		{
			id: 'account',
			label: 'Account',
			task: async () => {
				const data = await json('/api/auth/me');
				const u = data && data.user;
				if (!u) return { skip: 'signed out' };
				const name = u.display_name || u.username || '';
				return { name, detail: name ? `signed in as ${name}` : 'signed in' };
			},
		},
		{
			id: 'fonts',
			label: 'Fonts',
			task: async () => {
				if (!document.fonts) return { skip: 'system fonts' };
				await document.fonts.ready;
				return `${document.fonts.size} faces`;
			},
		},
		{
			id: 'avatar',
			label: 'Avatar',
			task: async () => {
				if (!webgl) return { skip: 'no 3D' };
				const [glb, manifest] = await Promise.all([fetch(AVATAR_GLB), fetch(CLIP_MANIFEST)]);
				if (!glb.ok) throw new Error(`body HTTP ${glb.status}`);
				const bytes = (await glb.arrayBuffer()).byteLength;
				const clips = manifest.ok ? (await manifest.json()).length : 0;
				return `${fmtBytes(bytes)} body, ${clips} clips`;
			},
		},
		{
			id: 'market',
			label: '$THREE feed',
			task: async () => {
				const data = await json('/api/three-token/stats', { credentials: 'omit' });
				const t = data && data.token;
				if (!t || !Number.isFinite(Number(t.price_usd))) throw new Error('no price');
				const price = Number(t.price_usd);
				const change = Number(t.price_change_24h);
				return { price, change, detail: `${fmtUsd(price)} ${fmtPct(change)}`.trim() };
			},
		},
		{
			id: 'gems',
			label: 'Gem ledger',
			task: async () => {
				const data = await json(`/api/world/gems?anonId=${encodeURIComponent(anonId())}`);
				const points = Number(data.points) || 0;
				const total = Number(data.total) || 0;
				return { points, total, detail: total ? `${total} gems, ${points} pts` : 'empty ledger' };
			},
		},
		{
			id: 'shell',
			label: 'Desktop',
			task: async () => {
				const shell = await createShell(root);
				return { shell, detail: 'session restored' };
			},
		},
	];
}

function stepValue(snap, id) {
	return snap.steps.find((s) => s.id === id)?.value;
}

async function main() {
	const root = document.getElementById('os');
	if (!root) return;
	const webgl = isWebGLAvailable();
	const prefs = readPrefs();
	const wanted = deepLinkApp(location.search, location.hash);
	const mode = entryMode({ search: location.search, hash: location.hash, prefs, webgl, deepLink: wanted, mobile: coarse && innerWidth < 760 });
	const boot = showBoot(location.search) ? createBootScreen({ reducedMotion }) : null;

	const steps = bootSteps(root, webgl);
	const snap = await runBootSteps(steps, (s) => boot?.update(s));
	const shell = stepValue(snap, 'shell')?.shell;
	if (!shell) throw new Error(snap.steps.find((s) => s.id === 'shell')?.detail || 'shell failed');
	document.documentElement.classList.add('os-ready');

	const account = stepValue(snap, 'account');
	const name = account?.name || shell.prefs.name || '';
	const market = stepValue(snap, 'market');
	const gems = stepValue(snap, 'gems');
	const chips = [];
	if (market) chips.push({ label: '$THREE', value: `${fmtUsd(market.price)} ${fmtPct(market.change)}`.trim() });
	if (gems) chips.push({ label: 'Gems', value: gems.total ? `${gems.total} mined, ${gems.points} pts` : 'none yet, visit the mine' });
	chips.push({ label: 'Account', value: account?.name ? account.name : 'Guest' });

	let choice = mode;
	if (boot) {
		const labels = Object.fromEntries(steps.map((s) => [s.id, s.label]));
		choice = await boot.toLock({
			name,
			returning: !!shell.store.get(shell.KEY.welcomed),
			mode,
			snap,
			labels,
			chips,
			clock24: shell.prefs.clock24,
			hue: shell.prefs.avatarHue,
			initials: initialsOf(name),
		});
		if (choice === 'classic') {
			shell.store.set(shell.KEY.view, 'classic');
			location.assign('/classic');
			return;
		}
		if (shell.prefs.sound) playChime();
		if (choice === 'world' && !webgl) {
			choice = 'desktop';
			shell.toast('This browser has no WebGL, so the campus is unavailable. Opening the desktop.');
		}
	}

	const restored = shell.restore();
	const landOnDesktop = () => {
		if (wanted && shell.hasApp(wanted)) shell.launchId(wanted);
		else if (!restored) shell.welcomeIfFirst();
	};

	let world = null;
	let grid = null;
	let lastPlace = null;
	const wantsGrid = webgl && new URLSearchParams(location.search).get('world') === 'grid';
	/** The Grid loads on first use: it brings its own scene, so the desktop boot stays light. */
	async function enterGrid() {
		if (!grid) {
			const { createGrid } = await import('./grid/index.js');
			grid = createGrid({
				apps: APPS.filter((a) => a.dock),
				directory: ALL_APPS.filter((a) => a.desktop && a.id !== 'welcome'),
				reducedMotion,
				onLeave({ app, to }) {
					if (to === 'campus' && world) return world.enter();
					if (app && shell.hasApp(app)) shell.launchId(app);
					else landOnDesktop();
				},
			});
		}
		grid.enter();
	}
	if (webgl) {
		const { createWorld } = await import('./world/index.js');
		world = createWorld({
			shell,
			apps: APPS.filter((a) => a.dock),
			reducedMotion,
			onGrid: true,
			onDesktop({ app, place, grid: toGrid }) {
				document.documentElement.classList.remove('in-world');
				if (toGrid) return enterGrid();
				lastPlace = place || null;
				if (app && shell.hasApp(app)) shell.launchId(app);
				else landOnDesktop();
			},
		});
		shell.onWorld = () => world.enter({ at: lastPlace && lastPlace !== 'office' ? lastPlace : null });
	}

	// The world mounts under the boot screen (its fade is already black), so
	// the boot dissolves straight into the campus with no desktop flash.
	if (wantsGrid) {
		await boot?.dismiss();
		await enterGrid();
	} else if (choice === 'world' && world) await Promise.all([world.enter(), boot?.dismiss()]);
	else {
		if (boot) await boot.dismiss();
		landOnDesktop();
	}

	// `?app=` and `?world=` are one-shots: drop them so a reload restores the saved layout.
	if (wanted || /[?&](world|boot)=/.test(location.search)) history.replaceState(null, '', location.pathname);

	addEventListener('storage', (e) => {
		if (e.key === shell.KEY.view && e.newValue === 'classic') location.assign('/classic');
	});
}

main().catch((err) => {
	console.error('[desktop] boot failed', err);
	document.querySelector('.os-boot')?.remove();
	const root = document.getElementById('os');
	if (root) root.innerHTML = '<p style="padding:24px;color:#fff;font:15px system-ui">The desktop could not start. <a style="color:#4cc2ff" href="/classic">Open the classic site</a>.</p>';
});
