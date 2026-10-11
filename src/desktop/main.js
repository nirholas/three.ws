// Desktop entry: boot the shell, restore the last session, honour deep links.

import './theme.css';
import './desktop.css';
import { createShell } from './shell.js';
import { deepLinkApp } from './layout.js';

async function main() {
	const root = document.getElementById('os');
	if (!root) return;
	const shell = await createShell(root);
	document.documentElement.classList.add('os-ready');

	const restored = shell.restore();
	const wanted = deepLinkApp(location.search, location.hash);
	if (wanted && shell.hasApp(wanted)) shell.launchId(wanted);
	else if (!restored) shell.welcomeIfFirst();

	// `?app=` is a one-shot: drop it so a reload restores the saved layout.
	if (wanted) history.replaceState(null, '', location.pathname);

	addEventListener('storage', (e) => {
		if (e.key === shell.KEY.view && e.newValue === 'classic') location.assign('/classic');
	});
}

main().catch((err) => {
	console.error('[desktop] boot failed', err);
	const root = document.getElementById('os');
	if (root) root.innerHTML = '<p style="padding:24px;color:#fff;font:15px system-ui">The desktop could not start. <a style="color:#4cc2ff" href="/classic">Open the classic site</a>.</p>';
});
