// /settings/memory: the owner surface for the agent learning loop.
// Talks to /api/memory/* (api/memory/[action].js). Deletes are optimistic with
// an undo window: the DELETE is sent only when the window closes, so Undo is a
// real undo and not a re-create.

import { apiFetch } from './api.js';

const UNDO_MS = 6000;
const KINDS = [
	{ id: '', label: 'All' },
	{ id: 'fact', label: 'Facts' },
	{ id: 'preference', label: 'Preferences' },
	{ id: 'procedure', label: 'Procedures' },
];

const $ = (id) => document.getElementById(id);
const state = {
	settings: null,
	model: null,
	memories: [],
	counts: { fact: 0, preference: 0, procedure: 0 },
	hasMore: false,
	nextBefore: null,
	kind: '',
	q: '',
	agents: [],
	agentId: '',
	skills: [],
	versionsOpen: new Map(),
};
const pending = new Set();

function el(tag, attrs = {}, ...kids) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === false || v == null) continue;
		if (k === 'class') node.className = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else if (k === 'text') node.textContent = v;
		else node.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of kids.flat()) if (kid != null) node.append(kid.nodeType ? kid : document.createTextNode(kid));
	return node;
}
const skeleton = (n = 3) => Array.from({ length: n }, () => el('div', { class: 'mm-skel' }));
const when = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');

async function call(path, { method = 'GET', body } = {}) {
	const res = await apiFetch(path, {
		method,
		headers: body === undefined ? { accept: 'application/json' } : { accept: 'application/json', 'content-type': 'application/json' },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		const err = new Error(data.error_description || data.error || `request failed (${res.status})`);
		err.status = res.status;
		throw err;
	}
	return data;
}

// ── toasts and dialog ────────────────────────────────────────────────────────
function toast(message, { undo, error = false, ms = 4500 } = {}) {
	const node = el('div', { class: `mm-toast${error ? ' err' : ''}` }, el('span', { text: message }));
	const close = () => node.remove();
	if (undo) {
		node.append(
			el('button', { type: 'button', class: 'mm-btn', onclick: () => { undo(); close(); } }, 'Undo'),
		);
	}
	$('toasts').append(node);
	return { close, timer: setTimeout(close, ms) };
}

function confirmDialog(title, text, okLabel) {
	const dlg = $('dialog');
	$('dialog-title').textContent = title;
	$('dialog-text').textContent = text;
	$('dialog-ok').textContent = okLabel;
	return new Promise((resolve) => {
		const done = (v) => {
			dlg.close();
			$('dialog-ok').onclick = $('dialog-cancel').onclick = null;
			dlg.onclose = null;
			resolve(v);
		};
		$('dialog-ok').onclick = () => done(true);
		$('dialog-cancel').onclick = () => done(false);
		dlg.onclose = () => resolve(false);
		dlg.showModal();
		$('dialog-cancel').focus();
	});
}

function showPageError(message, retry) {
	const host = $('page-error');
	host.replaceChildren();
	if (!message) return;
	host.append(
		el('div', { class: 'mm-error' }, el('span', { text: message }), retry ? el('button', { type: 'button', class: 'mm-btn', onclick: retry }, 'Retry') : null),
	);
}

function sectionError(host, message, retry) {
	host.replaceChildren(el('div', { class: 'mm-error' }, el('span', { text: message }), el('button', { type: 'button', class: 'mm-btn', onclick: retry }, 'Retry')));
}

// ── optimistic delete with undo ──────────────────────────────────────────────
function deferDelete({ node, label, commit, restore }) {
	node.classList.add('leaving');
	let undone = false;
	const job = { flush: null };
	const run = async () => {
		pending.delete(job);
		if (undone) return;
		try {
			await commit();
			node.remove();
		} catch (err) {
			restore();
			toast(`Could not delete: ${err.message}`, { error: true });
		}
	};
	job.flush = run;
	pending.add(job);
	const t = toast(label, {
		ms: UNDO_MS,
		undo: () => {
			undone = true;
			pending.delete(job);
			clearTimeout(timer);
			node.classList.remove('leaving');
			restore();
		},
	});
	const timer = setTimeout(run, UNDO_MS);
	return t;
}

window.addEventListener('beforeunload', (e) => {
	if (pending.size) {
		for (const job of [...pending]) job.flush();
		e.preventDefault();
		e.returnValue = '';
	}
});

// ── settings ─────────────────────────────────────────────────────────────────
async function patchSettings(patch) {
	const out = await call('/api/memory/settings', { method: 'PATCH', body: patch });
	state.settings = out.settings;
	renderSettings();
	return out.settings;
}

function renderSettings() {
	const s = state.settings;
	const host = $('settings-body');
	const master = el('input', { type: 'checkbox', id: 'sw-enabled', role: 'switch', checked: s.enabled });
	master.checked = s.enabled;
	master.addEventListener('change', async () => {
		const next = master.checked;
		master.checked = !next;
		if (!next) {
			const ok = await confirmDialog(
				'Turn learning off?',
				'Your agents will stop saving memories, updating your profile and drafting skills. What they already saved stays until you delete it below.',
				'Turn off',
			);
			if (!ok) return;
		}
		try {
			await patchSettings({ enabled: next });
			toast(next ? 'Learning is on.' : 'Learning is off. Saved memories stay until you delete them.');
		} catch (err) {
			toast(`Could not save: ${err.message}`, { error: true });
			renderSettings();
		}
	});

	const drafts = el('input', { type: 'checkbox', id: 'sw-drafts', role: 'switch' });
	drafts.checked = s.skill_drafts_enabled;
	drafts.disabled = !s.enabled;
	drafts.addEventListener('change', async () => {
		try {
			await patchSettings({ skill_drafts_enabled: drafts.checked });
		} catch (err) {
			toast(`Could not save: ${err.message}`, { error: true });
			renderSettings();
		}
	});

	const out = el('output', { for: 'nudge', text: String(s.nudge_every_turns) });
	const nudge = el('input', { type: 'range', id: 'nudge', min: '2', max: '50', step: '1', value: String(s.nudge_every_turns), 'aria-describedby': 'nudge-help' });
	nudge.disabled = !s.enabled;
	nudge.addEventListener('input', () => { out.textContent = nudge.value; });
	nudge.addEventListener('change', async () => {
		try {
			await patchSettings({ nudge_every_turns: Number(nudge.value) });
		} catch (err) {
			toast(`Could not save: ${err.message}`, { error: true });
			renderSettings();
		}
	});

	host.replaceChildren(
		el('div', { class: 'mm-row' },
			el('div', {}, el('strong', { text: 'Let my agents learn' }), el('span', { class: 'mm-sub', text: 'Save memories, build your profile and draft skills.' })),
			el('label', { class: 'mm-switch' }, master, el('span', { class: 'mm-track' }), el('span', { text: s.enabled ? 'On' : 'Off' })),
		),
		el('div', { class: 'mm-row' },
			el('div', {}, el('strong', { text: 'Draft skills from experience' }), el('span', { class: 'mm-sub', text: 'After a run that used several tools, write a disabled draft for your review.' })),
			el('label', { class: 'mm-switch' }, drafts, el('span', { class: 'mm-track' }), el('span', { text: drafts.checked ? 'On' : 'Off' })),
		),
		el('div', { class: 'mm-row' },
			el('div', {}, el('strong', { text: 'Review cadence' }), el('span', { class: 'mm-sub', id: 'nudge-help', text: 'Every how many turns an agent stops to decide what is worth remembering. Lower is more thorough, higher is quieter.' })),
			el('div', { class: 'mm-range' }, nudge, out, el('span', { class: 'mm-sub', text: 'turns' })),
		),
		...(s.enabled ? [] : [el('div', { class: 'mm-off', role: 'note', text: 'Learning is off. Existing memories are still shown below and can be edited or deleted. They are not added to prompts while it is off.' })]),
	);
}

// ── user model ───────────────────────────────────────────────────────────────
function renderModel() {
	const host = $('model-body');
	const doc = state.model;
	$('model-clear').hidden = doc.count === 0;
	const groups = doc.sections.map((sec) => {
		const list = el('ul', { class: 'mm-list' }, sec.entries.map((e) => modelItem(e, sec)));
		const add = el('form', { class: 'mm-add' });
		const input = el('input', { class: 'mm-input', type: 'text', maxlength: String(600), placeholder: `Add to ${sec.label.toLowerCase()}`, 'aria-label': `Add a line to ${sec.label}` });
		const btn = el('button', { type: 'submit', class: 'mm-btn' }, 'Add');
		add.append(input, btn);
		add.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			const content = input.value.trim();
			if (!content) return;
			btn.disabled = true;
			try {
				await call('/api/memory/user-model', { method: 'POST', body: { section: sec.id, content } });
				await loadModel(true);
			} catch (err) {
				toast(err.message, { error: true });
			} finally {
				btn.disabled = false;
			}
		});
		return el('div', { class: 'mm-group' }, el('h3', { text: sec.label }), el('p', { class: 'mm-hint', text: sec.hint }), list, add);
	});
	// replaceChildren() stringifies null, so the optional banner is spread in.
	host.replaceChildren(
		...(doc.count === 0
			? [el('div', { class: 'mm-empty' }, el('strong', { text: 'Your agent has not saved anything about you yet.' }), 'Tell it a preference in chat, like "keep answers short", or add a line below.')]
			: []),
		...groups,
	);
}

function modelItem(entry, sec) {
	const li = el('li', { class: 'mm-item', 'data-id': entry.id });
	const show = () => {
		li.replaceChildren(
			el('div', { class: 'body' }, entry.content, el('span', { class: 'meta', text: `${entry.source === 'owner' ? 'Added by you' : 'Learned'}${entry.updated_at ? ` · ${when(entry.updated_at)}` : ''}` })),
			el('div', { class: 'actions' },
				el('button', { type: 'button', class: 'mm-btn mm-ico', 'aria-label': `Edit: ${entry.content.slice(0, 60)}`, title: 'Edit', onclick: edit }, '✎'),
				el('button', { type: 'button', class: 'mm-btn mm-ico danger', 'aria-label': `Delete: ${entry.content.slice(0, 60)}`, title: 'Delete', onclick: remove }, '✕'),
			),
		);
	};
	const edit = () => {
		const text = el('textarea', { class: 'mm-input', maxlength: '600', 'aria-label': 'Edit line' });
		text.value = entry.content;
		const section = el('select', { class: 'mm-input', 'aria-label': 'Section' }, state.model.sections.map((s) => el('option', { value: s.id, text: s.label })));
		section.value = sec.id;
		const form = el('form', {}, text, el('div', { class: 'row' }, section,
			el('button', { type: 'submit', class: 'mm-btn primary' }, 'Save'),
			el('button', { type: 'button', class: 'mm-btn', onclick: show }, 'Cancel')));
		form.addEventListener('submit', async (ev) => {
			ev.preventDefault();
			try {
				await call(`/api/memory/user-model/${entry.id}`, { method: 'PATCH', body: { content: text.value, section: section.value } });
				await loadModel(true);
			} catch (err) {
				toast(err.message, { error: true });
			}
		});
		form.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') show(); });
		li.replaceChildren(form);
		text.focus();
	};
	const remove = () =>
		deferDelete({
			node: li,
			label: 'Line deleted.',
			commit: async () => { await call(`/api/memory/user-model/${entry.id}`, { method: 'DELETE' }); state.model.count -= 1; $('model-clear').hidden = state.model.count === 0; },
			restore: () => li.classList.remove('leaving'),
		});
	show();
	return li;
}

async function loadModel(quiet = false) {
	if (!quiet) $('model-body').replaceChildren(...skeleton(3));
	try {
		state.model = await call('/api/memory/user-model');
		renderModel();
	} catch (err) {
		sectionError($('model-body'), `Could not load your profile: ${err.message}`, () => loadModel());
	}
}

$('model-clear').addEventListener('click', async () => {
	const ok = await confirmDialog('Clear your whole profile?', `This permanently deletes all ${state.model.count} lines your agents know about you. It cannot be undone.`, 'Delete everything');
	if (!ok) return;
	try {
		const out = await call('/api/memory/user-model?confirm=true', { method: 'DELETE' });
		toast(`Removed ${out.cleared} lines.`);
		await loadModel(true);
	} catch (err) {
		toast(err.message, { error: true });
	}
});

// ── memories ─────────────────────────────────────────────────────────────────
function renderKinds() {
	const host = $('mem-kinds');
	host.replaceChildren(
		...KINDS.map((k) => {
			const n = k.id ? state.counts[k.id] : Object.values(state.counts).reduce((a, b) => a + b, 0);
			const chip = el('button', { type: 'button', class: 'mm-chip', 'aria-pressed': String(state.kind === k.id) }, k.label, el('small', { text: String(n) }));
			chip.addEventListener('click', () => { state.kind = k.id; loadMemories(); });
			return chip;
		}),
	);
}

function memoryItem(m) {
	const li = el('li', { class: 'mm-item', 'data-id': m.id });
	li.append(
		el('div', { class: 'body' }, el('span', { class: 'mm-tag', text: m.kind || 'fact' }), m.content, el('span', { class: 'meta', text: when(m.created_at) })),
		el('div', { class: 'actions' },
			el('button', {
				type: 'button', class: 'mm-btn mm-ico danger', title: 'Forget', 'aria-label': `Forget: ${m.content.slice(0, 60)}`,
				onclick: () =>
					deferDelete({
						node: li,
						label: 'Memory forgotten.',
						commit: async () => {
							await call(`/api/memory/items/${m.id}`, { method: 'DELETE' });
							const k = m.kind || 'fact';
							state.counts[k] = Math.max(0, (state.counts[k] || 0) - 1);
							state.memories = state.memories.filter((x) => x.id !== m.id);
							renderKinds();
							if (!state.memories.length) renderMemories();
						},
						restore: () => li.classList.remove('leaving'),
					}),
			}, '✕'),
		),
	);
	return li;
}

function renderMemories() {
	const host = $('mem-body');
	if (!state.memories.length) {
		const filtered = state.kind || state.q;
		host.replaceChildren(
			filtered
				? el('div', { class: 'mm-empty' }, el('strong', { text: 'No memories match.' }), 'Try another kind or a different search.')
				: el('div', { class: 'mm-empty' }, el('strong', { text: 'Your agent has not saved anything yet.' }), 'Tell it a preference in chat, like "always give me prices in SOL", and it will appear here.'),
		);
		return;
	}
	const kids = [el('ul', { class: 'mm-list' }, state.memories.map(memoryItem))];
	if (state.hasMore) {
		kids.push(el('div', { class: 'mm-add' }, el('button', { type: 'button', class: 'mm-btn', onclick: loadMore }, 'Load older memories')));
	}
	host.replaceChildren(...kids);
}

function memoryQuery(before) {
	const p = new URLSearchParams({ limit: '30' });
	if (state.kind) p.set('kind', state.kind);
	if (state.q) p.set('q', state.q);
	if (before) p.set('before', before);
	return `/api/memory/items?${p}`;
}

async function loadMemories() {
	$('mem-body').replaceChildren(...skeleton(3));
	try {
		const out = await call(memoryQuery());
		state.memories = out.memories;
		state.hasMore = out.has_more;
		state.nextBefore = out.next_before;
		if (out.counts) state.counts = out.counts;
		renderKinds();
		renderMemories();
	} catch (err) {
		sectionError($('mem-body'), `Could not load memories: ${err.message}`, loadMemories);
	}
}

async function loadMore() {
	try {
		const out = await call(memoryQuery(state.nextBefore));
		state.memories = state.memories.concat(out.memories);
		state.hasMore = out.has_more;
		state.nextBefore = out.next_before;
		renderMemories();
	} catch (err) {
		toast(err.message, { error: true });
	}
}

let searchTimer;
$('mem-search').addEventListener('input', (e) => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => { state.q = e.target.value.trim(); loadMemories(); }, 250);
});

// ── learned skills ───────────────────────────────────────────────────────────
function lineDiff(before, after) {
	const a = before.split('\n');
	const b = after.split('\n');
	const inB = new Set(b);
	const inA = new Set(a);
	const pre = el('pre', { class: 'mm-diff' });
	for (const line of a) if (!inB.has(line)) pre.append(el('span', { class: 'del', text: `- ${line}` }));
	for (const line of b) if (!inA.has(line)) pre.append(el('span', { class: 'add', text: `+ ${line}` }));
	return pre;
}

function skillCard(skill) {
	const card = el('article', { class: 'mm-skill', 'data-id': skill.id });
	const reviewed = !!skill.reviewed_at;
	const status = skill.enabled ? el('span', { class: 'mm-tag on', text: 'enabled' }) : el('span', { class: reviewed ? 'mm-tag' : 'mm-tag draft', text: reviewed ? 'disabled' : 'draft, needs review' });
	const versions = el('div', { class: 'mm-versions', hidden: true });

	const toggle = el('button', {
		type: 'button', class: skill.enabled ? 'mm-btn' : 'mm-btn primary',
		onclick: async (ev) => {
			ev.currentTarget.disabled = true;
			try {
				await call(`/api/memory/skills/${skill.id}/review`, { method: 'POST', body: { agent_id: state.agentId, enable: !skill.enabled } });
				toast(skill.enabled ? 'Skill disabled.' : 'Skill enabled. Your agent can use it now.');
				await loadSkills(true);
			} catch (err) {
				toast(err.message, { error: true });
				ev.currentTarget.disabled = false;
			}
		},
	}, skill.enabled ? 'Disable' : 'Enable');

	const history = el('button', {
		type: 'button', class: 'mm-btn', 'aria-expanded': 'false',
		onclick: async (ev) => {
			const btn = ev.currentTarget;
			const open = btn.getAttribute('aria-expanded') === 'true';
			btn.setAttribute('aria-expanded', String(!open));
			versions.hidden = open;
			if (open) return;
			versions.replaceChildren(...skeleton(2));
			try {
				const out = await call(`/api/memory/skills/${skill.id}/versions?agent_id=${state.agentId}`);
				versions.replaceChildren(...out.versions.map((v) => versionRow(skill, v, out.skill)));
			} catch (err) {
				sectionError(versions, err.message, () => btn.click());
			}
		},
	}, `History (${skill.version_count})`);

	const editBtn = el('button', { type: 'button', class: 'mm-btn', onclick: () => editSkill(card, skill) }, 'Edit');

	card.append(
		el('div', {}, status, el('h3', { text: skill.name })),
		skill.description ? el('p', { class: 'mm-sub', text: skill.description }) : null,
		el('pre', { text: skill.content }),
		el('p', { class: 'mm-sub', text: `Version ${skill.version} · drafted ${when(skill.installed_at)}` }),
		el('div', { class: 'acts' }, toggle, editBtn, history),
		versions,
	);
	return card;
}

function versionRow(skill, v, live) {
	const isLive = v.content === live.content;
	const row = el('div', { class: 'mm-ver' },
		el('span', { text: `v${v.version_no} · ${v.author}${v.note ? ` · ${v.note}` : ''} · ${when(v.created_at)}${isLive ? ' · live' : ''}` }),
	);
	if (!isLive) {
		const diff = el('div', { hidden: true }, lineDiff(v.content, live.content));
		row.append(
			el('span', { class: 'acts' },
				el('button', { type: 'button', class: 'mm-btn', onclick: () => { diff.hidden = !diff.hidden; } }, 'Compare to live'),
				el('button', {
					type: 'button', class: 'mm-btn',
					onclick: async () => {
						const ok = await confirmDialog(`Restore version ${v.version_no}?`, 'The live text is replaced and recorded as a new version, so this can be rolled back too.', 'Restore');
						if (!ok) return;
						try {
							await call(`/api/memory/skills/${skill.id}/rollback`, { method: 'POST', body: { agent_id: state.agentId, version: v.version_no } });
							toast(`Restored version ${v.version_no}.`);
							await loadSkills(true);
						} catch (err) {
							toast(err.message, { error: true });
						}
					},
				}, 'Restore'),
			),
			diff,
		);
	}
	return row;
}

function editSkill(card, skill) {
	const name = el('input', { class: 'mm-input', value: skill.name, 'aria-label': 'Skill name', maxlength: '80' });
	const desc = el('input', { class: 'mm-input', value: skill.description || '', 'aria-label': 'Skill description', maxlength: '400' });
	const body = el('textarea', { class: 'mm-input', 'aria-label': 'Skill instructions', rows: '12' });
	body.value = skill.content;
	const form = el('form', { class: 'mm-skill' }, name, desc, body,
		el('div', { class: 'acts' },
			el('button', { type: 'submit', class: 'mm-btn primary' }, 'Save as new version'),
			el('button', { type: 'button', class: 'mm-btn', onclick: () => loadSkills(true) }, 'Cancel')));
	form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		try {
			await call(`/api/memory/skills/${skill.id}`, { method: 'PATCH', body: { agent_id: state.agentId, name: name.value, description: desc.value, content: body.value } });
			toast('Saved as a new version.');
			await loadSkills(true);
		} catch (err) {
			toast(err.status === 409 ? 'Nothing changed.' : err.message, { error: true });
		}
	});
	card.replaceChildren(form);
	body.focus();
}

function renderSkills() {
	const host = $('skills-body');
	if (!state.skills.length) {
		host.replaceChildren(el('div', { class: 'mm-empty' }, el('strong', { text: 'No learned skills yet.' }), 'After this agent finishes a run that used several tools, it can draft a reusable skill here for you to review.'));
		return;
	}
	host.replaceChildren(el('div', { class: 'mm-list' }, state.skills.map(skillCard)));
}

async function loadSkills(quiet = false) {
	const host = $('skills-body');
	if (!state.agentId) {
		host.replaceChildren(el('div', { class: 'mm-empty' }, el('strong', { text: 'Create an agent first.' }), el('a', { class: 'mm-link', href: '/create-agent', text: 'Create an agent' }), ' and it can start learning skills.'));
		return;
	}
	if (!quiet) host.replaceChildren(...skeleton(2));
	try {
		state.skills = (await call(`/api/memory/skills?agent_id=${state.agentId}`)).skills;
		renderSkills();
	} catch (err) {
		sectionError(host, `Could not load skills: ${err.message}`, () => loadSkills());
	}
}

async function loadAgents() {
	const out = await call('/api/agents');
	state.agents = out.agents || [];
	const want = new URLSearchParams(location.search).get('agent');
	state.agentId = state.agents.find((a) => a.id === want)?.id || state.agents[0]?.id || '';
	const sel = $('skill-agent');
	sel.replaceChildren(...state.agents.map((a) => el('option', { value: a.id, text: a.name || a.id.slice(0, 8) })));
	sel.value = state.agentId;
	sel.hidden = state.agents.length < 2;
	sel.addEventListener('change', () => { state.agentId = sel.value; loadSkills(); });
}

// ── boot ─────────────────────────────────────────────────────────────────────
async function boot() {
	showPageError('');
	try {
		state.settings = (await call('/api/memory/settings')).settings;
	} catch (err) {
		if (err.redirected) return;
		showPageError(`Could not load your memory settings: ${err.message}`, boot);
		sectionError($('settings-body'), err.message, boot);
		return;
	}
	renderSettings();
	await Promise.all([
		loadModel(),
		loadMemories(),
		loadAgents().then(() => loadSkills()).catch((err) => sectionError($('skills-body'), `Could not load your agents: ${err.message}`, boot)),
	]);
}

boot();
