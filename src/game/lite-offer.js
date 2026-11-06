// The "switch to lite" card the 3D /play world shows when the device can't keep
// up. The frame watchdog has already dropped the render tier to its floor by the
// time this appears, so the honest next step is the 2D lite client in the same
// live room (same people, chat, dance-off and wall), not another quality knob.
// It stays until the player chooses: a toast that fades on its own would vanish
// before someone on a struggling phone could tap it.

import { liteUrlFrom, LITE_PREF_KEY } from './play-lite-core.js';

const DISMISS_KEY = 'cc-lite-offer-dismissed';

/** Show the offer once per tab session. Returns false when it was skipped. */
export function showLiteOffer({ search = location.search } = {}) {
	if (document.getElementById('cc-lite-offer')) return false;
	try { if (sessionStorage.getItem(DISMISS_KEY) === '1') return false; } catch { /* storage blocked: still offer */ }
	if (new URLSearchParams(search).get('director') === '1') return false;

	const card = document.createElement('aside');
	card.id = 'cc-lite-offer';
	card.className = 'cc-lite-offer';
	card.setAttribute('role', 'status');
	card.setAttribute('aria-label', 'Switch to the lite world');

	const text = document.createElement('p');
	text.className = 'cc-lite-offer-text';
	const strong = document.createElement('strong');
	strong.textContent = 'Running slow on this device?';
	text.append(strong, ' The lite world is the same room, people and chat, drawn as a fast live map.');

	const actions = document.createElement('div');
	actions.className = 'cc-lite-offer-actions';

	const go = document.createElement('a');
	go.className = 'cc-lite-offer-go';
	go.href = liteUrlFrom(search);
	go.textContent = 'Switch to lite';

	const remember = document.createElement('label');
	remember.className = 'cc-lite-offer-remember';
	const box = document.createElement('input');
	box.type = 'checkbox';
	remember.append(box, ' Always on this device');
	go.addEventListener('click', () => {
		if (!box.checked) return;
		try { localStorage.setItem(LITE_PREF_KEY, '1'); } catch { /* storage blocked: this visit still switches */ }
	});

	const keep = document.createElement('button');
	keep.type = 'button';
	keep.className = 'cc-lite-offer-keep';
	keep.textContent = 'Keep 3D';
	keep.addEventListener('click', () => {
		try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage blocked: dismiss for this page only */ }
		card.remove();
	});

	actions.append(go, keep, remember);
	card.append(text, actions);
	document.body.appendChild(card);
	return true;
}
