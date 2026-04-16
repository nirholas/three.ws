// Agent persona editor — /agent/:id/edit
// Native DOM, no framework.

const agentId = location.pathname.split('/').filter(Boolean)[1];

const DEFAULT_PERSONA = {
	name: '',
	bio: '',
	systemPrompt: '',
	catchphrases: [],
	sentimentBias: 0,
	voiceProvider: 'web',
	voiceId: null,
	doNotSay: [],
};

let agent = null;
let templates = [];
let _saveDebounce = null;

// ── Bootstrap ──────────────────────────────────────────────────────────────

async function main() {
	if (!agentId) return showForbidden();

	// Auth check
	const me = await apiFetch('/api/auth/me').catch(() => null);
	if (!me?.user) {
		location.href = `/login?return=${encodeURIComponent(location.pathname)}`;
		return;
	}

	// Fetch agent
	const data = await apiFetch(`/api/agents/${encodeURIComponent(agentId)}`).catch(() => null);
	if (!data?.agent) return showForbidden();
	agent = data.agent;

	// Ownership check (user_id only present for owner)
	if (!agent.user_id || agent.user_id !== me.user.id) return showForbidden();

	// Load templates
	templates = await apiFetch('/agent-edit/templates.json').catch(() => []);

	// Render
	document.getElementById('loading-screen').style.display = 'none';
	document.getElementById('layout').style.display = '';
	document.getElementById('header-title').textContent = `Edit — ${agent.name}`;
	const viewLink = document.getElementById('view-link');
	viewLink.href = `/agent/${agentId}`;

	loadPreview();
	renderTemplates();
	renderForm(agent.meta?.persona || DEFAULT_PERSONA);
	bindEvents();
	document.getElementById('save-btn').disabled = false;
}

function showForbidden() {
	document.getElementById('loading-screen').style.display = 'none';
	document.getElementById('forbidden-screen').style.display = '';
}

// ── Preview iframe ─────────────────────────────────────────────────────────

function loadPreview() {
	const frame = document.getElementById('preview-frame');
	const loading = document.getElementById('preview-loading');
	frame.src = `/agent/${agentId}/embed`;
	frame.addEventListener(
		'load',
		() => {
			loading.style.display = 'none';
			frame.style.display = 'block';
		},
		{ once: true },
	);
}

function reloadPreview() {
	const frame = document.getElementById('preview-frame');
	const loading = document.getElementById('preview-loading');
	frame.style.display = 'none';
	loading.style.display = 'grid';
	frame.src = `/agent/${agentId}/embed?_t=${Date.now()}`;
	frame.addEventListener(
		'load',
		() => {
			loading.style.display = 'none';
			frame.style.display = 'block';
		},
		{ once: true },
	);
}

// ── Templates ──────────────────────────────────────────────────────────────

function renderTemplates() {
	const row = document.getElementById('templates-row');
	row.innerHTML = '';
	for (const tpl of templates) {
		const btn = document.createElement('button');
		btn.className = 'template-btn';
		btn.textContent = tpl.label;
		btn.title = tpl.description;
		btn.addEventListener('click', () => applyTemplate(tpl));
		row.appendChild(btn);
	}
}

function applyTemplate(tpl) {
	renderForm({ ...DEFAULT_PERSONA, ...tpl.persona });
	toast('Template applied — review and save.');
}

// ── Form rendering ─────────────────────────────────────────────────────────

function renderForm(persona) {
	const p = { ...DEFAULT_PERSONA, ...persona };

	setVal('f-name', p.name);
	setVal('f-bio', p.bio);
	setVal('f-system-prompt', p.systemPrompt);

	const biasInput = document.getElementById('f-sentiment-bias');
	biasInput.value = p.sentimentBias;
	document.getElementById('bias-value').textContent = Number(p.sentimentBias).toFixed(2);

	document.querySelectorAll('input[name="voice-provider"]').forEach((r) => {
		r.checked = r.value === p.voiceProvider;
	});
	setVal('f-voice-id', p.voiceId || '');
	updateVoiceIdVisibility(p.voiceProvider);

	renderCatchphrases(p.catchphrases || []);
	renderChips(p.doNotSay || []);
	updateCharCounts();
}

function setVal(id, val) {
	const el = document.getElementById(id);
	if (el) el.value = val || '';
}

function renderCatchphrases(list) {
	const container = document.getElementById('catchphrase-list');
	const addBtn = document.getElementById('add-catchphrase-btn');
	container.innerHTML = '';
	list.forEach((text, i) => addCatchphraseRow(text, i));
	addBtn.style.display = list.length < 5 ? '' : 'none';
}

function addCatchphraseRow(text = '', _index) {
	const container = document.getElementById('catchphrase-list');
	const addBtn = document.getElementById('add-catchphrase-btn');
	const row = document.createElement('div');
	row.className = 'catchphrase-row';

	const input = document.createElement('input');
	input.type = 'text';
	input.maxLength = 80;
	input.value = text;
	input.placeholder = 'e.g. "Let\'s figure this out"';
	input.addEventListener('input', scheduleSave);

	const removeBtn = document.createElement('button');
	removeBtn.textContent = '×';
	removeBtn.title = 'Remove';
	removeBtn.addEventListener('click', () => {
		row.remove();
		const count = container.querySelectorAll('.catchphrase-row').length;
		addBtn.style.display = count < 5 ? '' : 'none';
		scheduleSave();
	});

	row.appendChild(input);
	row.appendChild(removeBtn);
	container.appendChild(row);

	const count = container.querySelectorAll('.catchphrase-row').length;
	addBtn.style.display = count < 5 ? '' : 'none';
}

// ── Chip input (do-not-say) ────────────────────────────────────────────────

let _doNotSay = [];

function renderChips(list) {
	_doNotSay = [...list];
	rebuildChipDom();
}

function rebuildChipDom() {
	const wrap = document.getElementById('dns-wrap');
	const textInput = document.getElementById('dns-input');
	// Remove existing chips (not the text input)
	wrap.querySelectorAll('.chip').forEach((c) => c.remove());
	_doNotSay.forEach((word, i) => {
		const chip = document.createElement('span');
		chip.className = 'chip';
		chip.textContent = word;
		const del = document.createElement('button');
		del.textContent = '×';
		del.title = `Remove "${word}"`;
		del.addEventListener('click', () => {
			_doNotSay.splice(i, 1);
			rebuildChipDom();
			scheduleSave();
		});
		chip.appendChild(del);
		wrap.insertBefore(chip, textInput);
	});
}

// ── Char counters ──────────────────────────────────────────────────────────

function updateCharCounts() {
	updateCount('f-name', 'cnt-name', 40);
	updateCount('f-bio', 'cnt-bio', 280);
	updateCount('f-system-prompt', 'cnt-system-prompt', 2000);
}

function updateCount(fieldId, countId, max) {
	const field = document.getElementById(fieldId);
	const counter = document.getElementById(countId);
	if (field && counter) {
		const len = field.value.length;
		counter.textContent = `${len}/${max}`;
		counter.style.color = len > max * 0.9 ? '#ff9a3c' : '#555';
	}
}

function updateVoiceIdVisibility(provider) {
	document.getElementById('voice-id-group').style.display = provider === 'eleven' ? '' : 'none';
}

// ── Read form → persona object ─────────────────────────────────────────────

function readForm() {
	const catchphrases = [...document.querySelectorAll('#catchphrase-list .catchphrase-row input')]
		.map((i) => i.value.trim())
		.filter(Boolean);

	const voiceProvider =
		document.querySelector('input[name="voice-provider"]:checked')?.value || 'web';
	const voiceId = document.getElementById('f-voice-id').value.trim() || null;

	return {
		name: document.getElementById('f-name').value.trim(),
		bio: document.getElementById('f-bio').value.trim(),
		systemPrompt: document.getElementById('f-system-prompt').value.trim(),
		catchphrases,
		sentimentBias: parseFloat(document.getElementById('f-sentiment-bias').value),
		voiceProvider,
		voiceId,
		doNotSay: [..._doNotSay],
	};
}

// ── Save ───────────────────────────────────────────────────────────────────

function scheduleSave() {
	// Not auto-saving — just mark that the form is dirty so user knows to save.
	// (debounced auto-save is intentionally not used per task spec)
}

async function save() {
	const btn = document.getElementById('save-btn');
	btn.disabled = true;
	btn.textContent = 'Saving…';
	try {
		const persona = readForm();
		if (!persona.name) {
			toast('Name is required.', true);
			return;
		}
		await apiFetch(`/api/agents/${encodeURIComponent(agentId)}`, {
			method: 'PATCH',
			body: JSON.stringify({ persona }),
		});
		toast('Saved!');
		reloadPreview();
	} catch (err) {
		toast(err.message || 'Save failed.', true);
	} finally {
		btn.disabled = false;
		btn.textContent = 'Save';
	}
}

// ── Events ─────────────────────────────────────────────────────────────────

function bindEvents() {
	document.getElementById('save-btn').addEventListener('click', save);

	// Char counts
	['f-name', 'f-bio', 'f-system-prompt'].forEach((id) => {
		document.getElementById(id)?.addEventListener('input', updateCharCounts);
	});

	// Sentiment bias label
	document.getElementById('f-sentiment-bias').addEventListener('input', (e) => {
		document.getElementById('bias-value').textContent = Number(e.target.value).toFixed(2);
	});

	// Voice provider radio
	document.querySelectorAll('input[name="voice-provider"]').forEach((r) => {
		r.addEventListener('change', (e) => updateVoiceIdVisibility(e.target.value));
	});

	// Add catchphrase
	document.getElementById('add-catchphrase-btn').addEventListener('click', () => {
		const count = document.querySelectorAll('#catchphrase-list .catchphrase-row').length;
		if (count < 5) addCatchphraseRow();
	});

	// Do-not-say chip input: Enter or comma adds chip
	document.getElementById('dns-input').addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			const word = e.target.value.trim().replace(/,$/, '');
			if (word && !_doNotSay.includes(word)) {
				_doNotSay.push(word);
				rebuildChipDom();
			}
			e.target.value = '';
		} else if (e.key === 'Backspace' && !e.target.value && _doNotSay.length) {
			_doNotSay.pop();
			rebuildChipDom();
		}
	});

	// Reset prompt to template
	document.getElementById('reset-prompt-btn').addEventListener('click', () => {
		const existing = agent?.meta?.persona;
		if (existing?.systemPrompt) {
			document.getElementById('f-system-prompt').value = existing.systemPrompt;
			updateCharCounts();
			toast('Reset to last saved prompt.');
		} else {
			toast('No saved prompt to reset to.', false);
		}
	});
}

// ── Utilities ──────────────────────────────────────────────────────────────

async function apiFetch(path, opts = {}) {
	const res = await fetch(path, {
		...opts,
		credentials: 'include',
		headers: {
			...(opts.body ? { 'content-type': 'application/json' } : {}),
			...opts.headers,
		},
	});
	const data = res.headers.get('content-type')?.includes('application/json')
		? await res.json()
		: await res.json().catch(() => null);
	if (!res.ok) {
		const msg = data?.error_description || data?.error || res.statusText;
		throw new Error(msg);
	}
	return data;
}

let _toastTimer = null;
function toast(msg, isError = false) {
	const el = document.getElementById('toast');
	el.textContent = msg;
	el.className = 'toast show' + (isError ? ' err' : '');
	clearTimeout(_toastTimer);
	_toastTimer = setTimeout(() => {
		el.className = 'toast';
	}, 3200);
}

// ── Boot ───────────────────────────────────────────────────────────────────

main().catch((err) => {
	document.getElementById('loading-screen').textContent = `Error: ${err.message}`;
});
