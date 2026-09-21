// The "Making this for" chip row shared by /forge and /forge-studio.
//
// Asked once, in the result panel, where the maker is already judging the model.
// The answer is remembered per browser and rides along on every later generation
// request, so one tap labels all of a maker's future output. It is also written
// straight onto the model on screen through the page's own feedback sender.
//
// The chips are static markup in each page (so the i18n pass localizes them like
// every other control); this module only owns their behavior. Storage can be
// unavailable (private mode, blocked site data): the chips still work for the
// current model, the answer just is not remembered.

import { validForgeDestination } from './forge-destinations.js';

const STORAGE_KEY = 'forge:destination';
const SAVED_NOTE_MS = 2600;

/** The remembered destination id, or null. Safe to call before any picker exists. */
export function storedForgeDestination() {
	try {
		return validForgeDestination(localStorage.getItem(STORAGE_KEY));
	} catch {
		return null;
	}
}

/**
 * Wire a destination chip row.
 * @param {{
 *   picker: HTMLElement|null,
 *   status?: HTMLElement|null,
 *   onChoose: (id: string) => void,
 * }} opts `onChoose` records the answer on the model currently on screen.
 * @returns {{ show: () => void, hide: () => void }}
 */
export function initForgeDestinationPicker({ picker, status = null, onChoose }) {
	if (!picker) return { show() {}, hide() {} };

	const chips = () => picker.querySelectorAll('.forge-cat-btn[data-dest]');

	function paint(id) {
		for (const b of chips()) {
			const on = b.dataset.dest === id;
			b.classList.toggle('active', on);
			b.setAttribute('aria-pressed', on ? 'true' : 'false');
		}
	}

	let noteTimer = 0;
	function flashSaved() {
		if (!status) return;
		// The localized sentence lives on the element (data-i18n-attr), so a locale
		// switch is honored without this module importing the catalog.
		status.textContent = status.dataset.saved || '';
		status.classList.add('is-visible');
		clearTimeout(noteTimer);
		noteTimer = setTimeout(() => status.classList.remove('is-visible'), SAVED_NOTE_MS);
	}

	picker.addEventListener('click', (e) => {
		const btn = e.target.closest('.forge-cat-btn[data-dest]');
		const id = validForgeDestination(btn?.dataset.dest);
		if (!id) return;
		try {
			localStorage.setItem(STORAGE_KEY, id);
		} catch {
			/* storage unavailable: the answer still lands on this model below */
		}
		paint(id);
		onChoose(id);
		flashSaved();
	});

	return {
		show() {
			paint(storedForgeDestination());
			picker.hidden = false;
		},
		hide() {
			picker.hidden = true;
		},
	};
}
