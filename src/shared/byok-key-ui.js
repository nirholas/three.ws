// The "bring your own provider key" field, shared by every Forge surface that
// has one (the Forge page, Forge Studio, the home composer), so the promise the
// page makes about the key is the same everywhere and matches what the server
// does with it.
//
// What actually happens to a key typed here: it is held in this tab's memory,
// sent in the x-forge-provider-key header of each generation and status request
// over HTTPS, and the server forwards it only to the provider's own API host.
// The browser never writes it to storage. A saved key is a different thing: it
// lives encrypted on the account (Account, AI Provider Keys) and is removed
// there.

/** One sentence the hint line and the field's description both use. */
export function byokUseNote(providerLabel) {
	return `Sent with each request over HTTPS, only to ${providerLabel}. Held in this tab's memory, never stored by three.ws, and gone when you reload.`;
}

const STYLE_ID = 'byok-clear-style';
const CLEAR_CSS = `
.byok-clear{flex:none;margin-left:auto;background:transparent;border:1px solid var(--stroke,rgba(255,255,255,.18));border-radius:var(--radius-md,8px);color:var(--ink-dim,#a8a8b3);font:inherit;font-size:var(--text-xs,.75rem);padding:.45rem .7rem;cursor:pointer;transition:border-color .15s,color .15s,background .15s}
.byok-clear[hidden]{display:none}
.byok-clear:hover{border-color:var(--stroke-strong,rgba(255,255,255,.35));color:var(--ink,#fff)}
.byok-clear:active{background:var(--surface-2,rgba(255,255,255,.06))}
.byok-clear:focus-visible{outline:2px solid var(--accent,#7c9cff);outline-offset:2px}
`;

function ensureClearStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CLEAR_CSS;
	document.head.appendChild(style);
}

/**
 * Prepare a key input: no browser autofill or password-manager save prompt for
 * a key that is not a login, and a Clear button that empties it on demand.
 * Idempotent; returns a function that refreshes the Clear button's visibility
 * (call it after the value changes, and it also runs on input).
 *
 * @param {HTMLInputElement | null} input
 * @returns {() => void}
 */
export function mountByokKeyField(input) {
	if (!input) return () => {};
	ensureClearStyle();
	input.setAttribute('autocomplete', 'new-password');
	input.setAttribute('data-1p-ignore', '');
	input.setAttribute('data-lpignore', 'true');
	let clear = input.parentElement?.querySelector('.byok-clear');
	if (!clear && input.parentElement) {
		clear = document.createElement('button');
		clear.type = 'button';
		clear.className = 'byok-clear';
		clear.textContent = 'Clear';
		clear.setAttribute('aria-label', 'Clear the API key from this page');
		clear.hidden = true;
		input.insertAdjacentElement('afterend', clear);
		clear.addEventListener('click', () => {
			input.value = '';
			input.removeAttribute('aria-invalid');
			input.dispatchEvent(new Event('input', { bubbles: true }));
			input.focus();
		});
	}
	const refresh = () => {
		if (clear) clear.hidden = !input.value;
	};
	input.addEventListener('input', refresh);
	refresh();
	return refresh;
}
