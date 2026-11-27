// The Forge page's seed field: lock a generation to a seed you choose, or leave
// it empty and every Generate mints a fresh one.
//
// The page and the API share one contract (api/_lib/forge-seed.js): a whole
// number from 0 to 4294967295. The field checks it before a request goes out,
// so junk never reaches the server, and the value survives a reload. After a run
// starts, the field's note shows the exact seed that run sent, with a button to
// lock it in, so the seed you see is always the seed that was used.

import { parseSeed, SEED_MAX, SEED_RANGE_MESSAGE } from '../api/_lib/forge-seed.js';

export const SEED_STORAGE_KEY = 'forge:seed';

// Digits copied from elsewhere often carry grouping ("1,234,567", "1 234 567",
// "1_234_567"). Strip separators that sit between digits, and nothing else, so
// "12a3" or "-5" are still refused.
const GROUPED = /^\d{1,3}([ ,_  ]\d{3})+$/;

/**
 * Parse what the user typed or pasted into the seed field.
 *
 * @param {string} text
 * @returns {{ seed: number | null, error?: string }}
 *   `{ seed: null }` for an empty field (random seed per run), `{ seed }` for a
 *   valid one, `{ seed: null, error }` for anything else.
 */
export function parseSeedInput(text) {
	const s = String(text ?? '').trim();
	if (!s) return { seed: null };
	const compact = GROUPED.test(s) ? s.replace(/[^\d]/g, '') : s;
	const parsed = parseSeed(compact);
	if (parsed.error) return { seed: null, error: humanSeedError(s) };
	return parsed;
}

function humanSeedError(s) {
	if (/^-/.test(s)) return `Seeds can't be negative. Use a whole number from 0 to ${SEED_MAX}.`;
	if (/^\d+[.,]\d+$/.test(s)) return `Seeds are whole numbers. Use a whole number from 0 to ${SEED_MAX}.`;
	if (/^\d+$/.test(s)) return `That seed is too large. The largest is ${SEED_MAX}.`;
	return `${SEED_RANGE_MESSAGE.charAt(0).toUpperCase()}${SEED_RANGE_MESSAGE.slice(1)} Clear the field for a random seed.`;
}

function safeStorage(storage) {
	return {
		get() {
			try {
				return storage?.getItem(SEED_STORAGE_KEY) ?? '';
			} catch {
				return '';
			}
		},
		set(value) {
			try {
				if (value) storage?.setItem(SEED_STORAGE_KEY, value);
				else storage?.removeItem(SEED_STORAGE_KEY);
			} catch {
				// Private mode or a full quota: the field still works for this visit.
			}
		},
	};
}

/**
 * Wire the seed field.
 *
 * @param {{
 *   input: HTMLInputElement,
 *   msg: HTMLElement,
 *   storage?: Storage,
 * }} els
 * @returns {{
 *   seedForSubmit: (mint: () => number) => number | null,
 *   noteUsed: (seed: number | null | undefined) => void,
 *   setDisabled: (reason: string) => void,
 * }}
 */
export function mountSeedField({ input, msg, storage = globalThis.localStorage }) {
	// A page without the field keeps the old behavior: a fresh seed every run.
	if (!input || !msg) return { seedForSubmit: (mint) => mint(), noteUsed() {}, setDisabled() {} };
	const store = safeStorage(storage);
	let lastUsed = null;
	// Set while the selected engine takes no seed: the field is disabled and its
	// note says why, and no seed is checked or sent.
	let disabledReason = '';

	function showError(text) {
		input.setAttribute('aria-invalid', 'true');
		msg.dataset.state = 'error';
		msg.replaceChildren(text);
	}

	function showIdle() {
		input.removeAttribute('aria-invalid');
		if (disabledReason) {
			msg.dataset.state = 'off';
			msg.replaceChildren(disabledReason);
			return;
		}
		const locked = parseSeedInput(input.value).seed;
		if (locked !== null) {
			msg.dataset.state = 'locked';
			msg.replaceChildren(`Every run uses seed ${locked}, so the same prompt and settings give the same model. Clear it for a random seed.`);
			return;
		}
		if (lastUsed !== null) {
			msg.dataset.state = 'used';
			const reuse = document.createElement('button');
			reuse.type = 'button';
			reuse.className = 'seed-reuse';
			reuse.textContent = 'Use this seed';
			reuse.addEventListener('click', () => {
				input.value = String(lastUsed);
				store.set(input.value);
				showIdle();
				input.focus();
			});
			msg.replaceChildren('Last run used seed ', strong(String(lastUsed)), '. ', reuse);
			return;
		}
		msg.dataset.state = 'idle';
		msg.replaceChildren('Empty means a new random seed every run. Enter one to repeat a result.');
	}

	function validate() {
		const parsed = parseSeedInput(input.value);
		if (parsed.error) {
			showError(parsed.error);
			return parsed;
		}
		// Normalize a pasted "1,234,567" to the digits the API receives.
		if (parsed.seed !== null && input.value !== String(parsed.seed)) input.value = String(parsed.seed);
		store.set(parsed.seed === null ? '' : input.value);
		showIdle();
		return parsed;
	}

	input.value = store.get();
	// A stored value that no longer parses (edited by hand, older format) is
	// shown with its error rather than silently dropped.
	if (input.value) validate();
	else showIdle();

	input.addEventListener('input', (e) => {
		// A paste or drop is a finished value: check it now. Typing only clears a
		// stale error at once; its full check runs on change (blur or Enter).
		if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop') {
			validate();
			return;
		}
		if (input.getAttribute('aria-invalid') === 'true' && !parseSeedInput(input.value).error) showIdle();
		if (!input.value.trim()) {
			store.set('');
			showIdle();
		}
	});
	input.addEventListener('change', validate);
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && input.value) {
			input.value = '';
			store.set('');
			showIdle();
		}
	});

	return {
		seedForSubmit(mint) {
			// The engine takes no seed, so the request leaves it out
			// (src/forge-control-state.js); a typed value is kept for the next engine.
			if (disabledReason) return mint();
			const parsed = validate();
			if (parsed.error) {
				input.focus();
				return null;
			}
			return parsed.seed ?? mint();
		},
		noteUsed(seed) {
			lastUsed = Number.isInteger(seed) ? seed : null;
			if (input.getAttribute('aria-invalid') !== 'true') showIdle();
		},
		setDisabled(reason) {
			const next = reason || '';
			if (next === disabledReason) return;
			disabledReason = next;
			input.disabled = Boolean(next);
			if (next) showIdle();
			else if (input.value) validate();
			else showIdle();
		},
	};
}

function strong(text) {
	const el = document.createElement('strong');
	el.textContent = text;
	return el;
}
