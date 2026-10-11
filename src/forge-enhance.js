// Forge prompt enhancer — the one AI-powered authoring aid in the text composer.
//
// "Surprise me" and the prompt coach (src/forge-prompt-studio.js) are curated,
// client-side helpers. This is the opposite: it takes whatever the user actually
// typed and rewrites it with a real model into a sharper, single-subject prompt
// shaped for the FLUX → TRELLIS pipeline (material, lighting and background cues
// the reconstructor reads cleanly). It runs on the site's free-first LLM chain
// via POST /api/forge-enhance, so it costs the visitor nothing and needs no key.
//
// Self-contained on purpose: it injects its own button into the existing
// #prompt-tools toolbar and owns its styles, so it composes with the rest of the
// composer without the page wiring it explicitly — the same pattern as
// forge-stylize.js and forge-optimize.js.

const prompt = document.getElementById('prompt');
const tools = document.getElementById('prompt-tools');
const anchor = document.getElementById('surprise'); // insert right after "Surprise me"

// No text composer on this render (page markup changed, or module loaded on the
// wrong page) — degrade to nothing rather than throw.
if (prompt && tools) {
	injectStyles();

	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'ptool ptool--ai';
	btn.id = 'enhance';
	btn.setAttribute('aria-label', 'Enhance: rewrite your prompt into a sharper, model-ready description');
	btn.title = 'Rewrite your prompt into a sharper, model-ready description';
	btn.innerHTML = `
		<svg class="enhance-spark" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M12 2.5l1.9 5 5 1.9-5 1.9-1.9 5-1.9-5-5-1.9 5-1.9 1.9-5zM19 14l.85 2.15L22 17l-2.15.85L19 20l-.85-2.15L16 17l2.15-.85L19 14zM5.5 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z"/>
		</svg>
		<span class="enhance-label">Enhance</span>`;

	const undo = document.createElement('button');
	undo.type = 'button';
	undo.className = 'ptool ptool--undo is-hidden';
	undo.id = 'enhance-undo';
	undo.textContent = 'Undo';
	undo.title = 'Restore the prompt you wrote';

	const note = document.createElement('p');
	note.className = 'enhance-note is-hidden';
	note.id = 'enhance-note';
	note.setAttribute('role', 'status');
	note.setAttribute('aria-live', 'polite');

	// Order: Surprise me → Enhance → Undo, then the rest of the toolbar.
	if (anchor && anchor.parentNode === tools) {
		anchor.after(btn, undo);
	} else {
		tools.prepend(undo);
		tools.prepend(btn);
	}
	tools.after(note);

	let prevPrompt = null; // the user's words before the last enhance, for Undo
	let busy = false;
	let selfEdit = false; // true while WE write to the textarea, so the input
	// listener below doesn't mistake our programmatic write for the user editing
	let noteTimer = null;

	function showNote(msg, kind = 'tip') {
		note.textContent = msg;
		note.dataset.kind = kind;
		note.classList.remove('is-hidden');
		clearTimeout(noteTimer);
		// Keep errors up a touch longer than neutral tips; never permanent.
		noteTimer = setTimeout(() => note.classList.add('is-hidden'), kind === 'error' ? 5200 : 3600);
	}

	function hideNote() {
		clearTimeout(noteTimer);
		note.classList.add('is-hidden');
	}

	// Write into the textarea and let the rest of the composer (coach + counter in
	// forge-prompt-studio.js, the submit guard in forge.js) react as if the user
	// typed it — one input event keeps every dependent feature in sync.
	function setPrompt(value, { flash = false } = {}) {
		selfEdit = true;
		prompt.value = value;
		prompt.dispatchEvent(new Event('input', { bubbles: true }));
		selfEdit = false;
		prompt.focus();
		try {
			prompt.setSelectionRange(value.length, value.length);
		} catch {
			/* setSelectionRange throws on some inputs — caret position is cosmetic */
		}
		if (flash) {
			prompt.classList.remove('enhance-flash');
			void prompt.offsetWidth; // restart the animation
			prompt.classList.add('enhance-flash');
		}
	}

	function setBusy(on) {
		busy = on;
		btn.disabled = on;
		btn.classList.toggle('is-working', on);
		btn.querySelector('.enhance-label').textContent = on ? 'Enhancing…' : 'Enhance';
		prompt.classList.toggle('is-enhancing', on);
		prompt.setAttribute('aria-busy', String(on));
	}

	async function enhance() {
		if (busy) return;
		const raw = prompt.value.trim();
		if (raw.length < 3) {
			prompt.focus();
			showNote('Describe the object in a few words first, then enhance it.', 'tip');
			return;
		}

		setBusy(true);
		hideNote();
		try {
			const res = await fetch('/api/forge-enhance', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ prompt: raw }),
			});

			if (res.status === 429) {
				const data = await res.json().catch(() => ({}));
				const secs = Number(data.retry_after);
				showNote(
					Number.isFinite(secs) && secs > 0
						? `Easy — try enhancing again in ${secs}s.`
						: 'Slow down a moment, then try again.',
					'error',
				);
				return;
			}
			if (res.status === 503) {
				showNote('The enhancer is offline right now — your prompt is unchanged.', 'error');
				return;
			}
			if (!res.ok) {
				showNote("Couldn't enhance that one. Try again, or tweak the wording.", 'error');
				return;
			}

			const data = await res.json();
			const next = typeof data.prompt === 'string' ? data.prompt.trim() : '';
			if (!next || next.toLowerCase() === raw.toLowerCase()) {
				showNote('That prompt is already in good shape.', 'tip');
				return;
			}

			prevPrompt = raw;
			setPrompt(next, { flash: true });
			undo.classList.remove('is-hidden');
			showNote('Rewritten for sharper geometry. Edit freely, or Undo.', 'strong');
		} catch {
			showNote('Network hiccup — your prompt is unchanged. Try again.', 'error');
		} finally {
			setBusy(false);
		}
	}

	btn.addEventListener('click', enhance);

	undo.addEventListener('click', () => {
		if (prevPrompt == null) return;
		setPrompt(prevPrompt);
		prevPrompt = null;
		undo.classList.add('is-hidden');
		hideNote();
	});

	// Once the user edits the prompt by hand, the previous-words snapshot is stale
	// — retire Undo so it can never restore something they didn't mean.
	prompt.addEventListener('input', () => {
		if (selfEdit) return;
		if (prevPrompt != null) {
			prevPrompt = null;
			undo.classList.add('is-hidden');
		}
	});

	// ⌘/Ctrl+E enhances without leaving the keyboard — pairs with the existing
	// ⌘/Ctrl+Enter to generate.
	prompt.addEventListener('keydown', (e) => {
		if ((e.metaKey || e.ctrlKey) && (e.key === 'e' || e.key === 'E')) {
			e.preventDefault();
			enhance();
		}
	});
}

function injectStyles() {
	if (document.getElementById('forge-enhance-styles')) return;
	const style = document.createElement('style');
	style.id = 'forge-enhance-styles';
	style.textContent = `
		.ptool--ai {
			color: var(--accent);
			border-color: color-mix(in srgb, var(--accent) 45%, var(--stroke));
			background: color-mix(in srgb, var(--accent) 8%, transparent);
		}
		.ptool--ai:hover {
			color: var(--accent);
			border-color: var(--accent);
			background: var(--accent-soft);
		}
		.ptool--ai .enhance-spark { width: 14px; height: 14px; }
		.ptool--ai.is-working { cursor: progress; }
		.ptool--ai.is-working .enhance-spark { animation: enhance-spin 0.9s linear infinite; transform-origin: 50% 50%; }
		.ptool--undo { color: var(--ink-dim); }
		.enhance-note {
			margin: var(--space-xs) 0 0;
			font-size: var(--text-xs);
			line-height: 1.45;
			color: var(--ink-dim);
			display: flex;
			align-items: center;
			gap: 0.45rem;
		}
		.enhance-note::before {
			content: '';
			width: 6px; height: 6px; border-radius: 50%;
			background: var(--accent); flex: none;
		}
		.enhance-note[data-kind='strong'] { color: var(--success); }
		.enhance-note[data-kind='strong']::before { background: var(--success); box-shadow: 0 0 8px var(--success); }
		.enhance-note[data-kind='error'] { color: var(--danger); }
		.enhance-note[data-kind='error']::before { background: var(--danger); }
		.enhance-note.is-hidden { display: none; }
		#prompt.is-enhancing {
			background-image: linear-gradient(
				100deg,
				transparent 30%,
				color-mix(in srgb, var(--accent) 14%, transparent) 50%,
				transparent 70%
			);
			background-size: 220% 100%;
			background-repeat: no-repeat;
			animation: enhance-sheen 1.15s linear infinite;
			border-radius: var(--radius-sm);
		}
		#prompt.enhance-flash { animation: enhance-flash 0.7s ease; }
		@keyframes enhance-spin { to { transform: rotate(360deg); } }
		@keyframes enhance-sheen { to { background-position: -220% 0; } }
		@keyframes enhance-flash {
			0% { box-shadow: 0 0 0 0 var(--accent-soft); }
			40% { box-shadow: 0 0 0 4px var(--accent-soft); }
			100% { box-shadow: 0 0 0 0 transparent; }
		}
		@media (prefers-reduced-motion: reduce) {
			.ptool--ai.is-working .enhance-spark,
			#prompt.is-enhancing,
			#prompt.enhance-flash { animation: none; }
		}
	`;
	document.head.appendChild(style);
}
