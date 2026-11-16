// Owner guardrails for this agent's chat: NVIDIA NemoGuard jailbreak
// detection, content safety on the visitor's message and on the reply, and
// topic control with a polite redirect. All off by default; the owner turns
// each one on here. Enforcement: api/_lib/chat-guardrails.js. Endpoint:
// api/agents/[id]/guardrails.js. Guide: docs/agent-guardrails.md.
//
// Mounted by src/agent-edit.js into #guardrails-host.

import { apiFetch } from './api.js';
import { LIMITS, topicRedirect } from '../api/_lib/guardrail-copy.js';
import './agent-guardrails.css';

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CHECK_LABEL = {
	jailbreak: 'Jailbreak attempts',
	input_safety: 'Unsafe messages',
	topic: 'Off-topic redirects',
	output_safety: 'Unsafe replies stopped',
};

function errorText(body, status) {
	if (status === 429) return 'Too many saves in a short time. Wait a moment and try again.';
	if (status === 401) return 'Your session ended. Sign in again to change guardrails.';
	if (status === 403) return 'Only the agent owner can change guardrails.';
	return body?.error_description || body?.error || `Request failed (HTTP ${status}).`;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {HTMLElement} host
 * @param {{ agentId: string }} opts
 */
export function mountGuardrails(host, { agentId }) {
	const base = `/api/agents/${encodeURIComponent(agentId)}/guardrails`;
	const state = { saved: null, draft: null, stats: null, available: true, budgetMs: 2000, saving: false };

	host.innerHTML = `
		<div class="gr" aria-busy="true">
			<div class="gr-skel" style="height:64px"></div>
			<div class="gr-skel" style="height:64px"></div>
			<div class="gr-skel" style="height:64px"></div>
		</div>`;

	async function load() {
		host.querySelector('.gr')?.setAttribute('aria-busy', 'true');
		try {
			const r = await apiFetch(base, { credentials: 'include' });
			const body = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(errorText(body, r.status));
			apply(body.data);
			render();
		} catch (err) {
			host.innerHTML = `
				<div class="gr gr-error" role="alert">
					<p>Could not load guardrails: ${esc(err.message)}</p>
					<button type="button" class="btn-ghost gr-retry">Try again</button>
				</div>`;
			host.querySelector('.gr-retry').addEventListener('click', load);
		}
	}

	function apply(data) {
		state.saved = data.settings;
		state.draft = structuredClone(data.settings);
		state.stats = data.stats;
		state.available = data.available;
		state.budgetMs = data.budget_ms || 2000;
	}

	function render() {
		const d = state.draft;
		const secs = (state.budgetMs / 1000).toFixed(state.budgetMs % 1000 ? 1 : 0);
		host.innerHTML = `
			<div class="gr">
				<p class="hint gr-sub">Optional checks on this agent's chat, run on NVIDIA NemoGuard models. Everything here is off until you turn it on. A visitor's message waits at most ${secs}s for the checks, and if a guard model cannot answer the message goes through rather than breaking your agent.</p>
				${state.available ? '' : '<div class="gr-warn" role="status">Guard models are not configured on this server, so turned-on checks are recorded as unchecked and nothing is blocked.</div>'}

				${toggle('jailbreak', 'Block jailbreak attempts', 'Stops messages that try to make the agent ignore its instructions or persona.', d.jailbreak)}
				${toggle('safety', 'Content safety', 'Screens each visitor message and the agent’s reply for harmful content. Replies still stream; a reply that turns unsafe is stopped and replaced.', d.safety)}
				${toggle('topics', 'Keep conversations on topic', 'Off-topic questions get a polite redirect instead of an answer.', d.topics.enabled)}

				<div class="gr-topics" ${d.topics.enabled || d.topics.allowed.length ? '' : 'hidden'} data-gr="topics-box">
					<label class="form-label" for="gr-topic-input">Allowed topics <span class="gr-count">${d.topics.allowed.length}/${LIMITS.topics}</span></label>
					<ul class="gr-chips" data-gr="chips">${d.topics.allowed
						.map(
							(t, i) =>
								`<li class="gr-chip"><span>${esc(t)}</span><button type="button" class="gr-chip-x" data-remove="${i}" aria-label="Remove topic ${esc(t)}">×</button></li>`,
						)
						.join('')}</ul>
					${d.topics.allowed.length ? '' : '<p class="gr-empty">Add the subjects this agent should talk about, for example "our product and pricing" or "booking appointments". Topic control turns on once there is at least one.</p>'}
					<div class="gr-add">
						<input class="form-input" id="gr-topic-input" maxlength="${LIMITS.topicChars}" placeholder="Add a topic and press Enter" ${d.topics.allowed.length >= LIMITS.topics ? 'disabled' : ''} />
						<button type="button" class="btn-ghost" data-gr="add" ${d.topics.allowed.length >= LIMITS.topics ? 'disabled' : ''}>Add</button>
					</div>
					<label class="form-label" for="gr-redirect">Redirect message <span class="gr-count" data-gr="redirect-count">${d.topics.redirect.length}/${LIMITS.redirectChars}</span></label>
					<textarea class="form-textarea" id="gr-redirect" rows="2" maxlength="${LIMITS.redirectChars}" placeholder="${esc(topicRedirect({ topics: { ...d.topics, redirect: '' } }))}">${esc(d.topics.redirect)}</textarea>
					<p class="hint">Leave it empty to use the default shown in the box, built from your topics.</p>
				</div>

				<div class="form-actions">
					<button type="button" class="btn-primary" data-gr="save" ${same(state.draft, state.saved) || state.saving ? 'disabled' : ''}>${state.saving ? 'Saving…' : 'Save guardrails'}</button>
					<span class="form-status" data-gr="status" role="status" aria-live="polite"></span>
				</div>

				${statsHtml()}
			</div>`;
		wire();
	}

	function toggle(key, title, help, on) {
		return `
			<label class="gr-row">
				<span class="gr-row-text"><span class="gr-row-title">${esc(title)}</span><span class="gr-row-help">${esc(help)}</span></span>
				<input type="checkbox" class="gr-switch" data-toggle="${key}" ${on ? 'checked' : ''} />
			</label>`;
	}

	function statsHtml() {
		const s = state.stats;
		if (!s || !s.turns) {
			return `<div class="gr-stats gr-stats-empty"><div class="gr-stats-title">Last ${s?.days || 30} days</div><p>No guarded conversations yet. Once a check is on, block counts show up here. Only counts are kept, never message text.</p></div>`;
		}
		const cells = Object.entries(CHECK_LABEL)
			.map(([id, label]) => `<div class="gr-stat"><span class="gr-stat-n">${s.blocked[id] || 0}</span><span class="gr-stat-l">${esc(label)}</span></div>`)
			.join('');
		return `
			<div class="gr-stats">
				<div class="gr-stats-title">Last ${s.days} days · ${s.turns} guarded turn${s.turns === 1 ? '' : 's'}</div>
				<div class="gr-stat-grid">${cells}</div>
				${s.unchecked ? `<p class="hint">${s.unchecked} turn${s.unchecked === 1 ? '' : 's'} went through unchecked because a guard model did not answer in time.</p>` : ''}
				<p class="hint">Counts only. Message text is never stored.</p>
			</div>`;
	}

	function setStatus(text, kind = '') {
		const el = host.querySelector('[data-gr="status"]');
		if (!el) return;
		el.textContent = text;
		el.dataset.kind = kind;
	}

	function refreshSave() {
		const btn = host.querySelector('[data-gr="save"]');
		if (btn) btn.disabled = same(state.draft, state.saved) || state.saving;
	}

	function addTopic() {
		const input = host.querySelector('#gr-topic-input');
		const value = input.value.trim().slice(0, LIMITS.topicChars);
		if (!value) return;
		const exists = state.draft.topics.allowed.some((t) => t.toLowerCase() === value.toLowerCase());
		if (!exists && state.draft.topics.allowed.length < LIMITS.topics) state.draft.topics.allowed.push(value);
		render();
		host.querySelector('#gr-topic-input')?.focus();
	}

	function wire() {
		host.querySelectorAll('[data-toggle]').forEach((el) =>
			el.addEventListener('change', () => {
				const key = el.dataset.toggle;
				if (key === 'topics') state.draft.topics.enabled = el.checked;
				else state.draft[key] = el.checked;
				if (key === 'topics') render();
				else refreshSave();
			}),
		);
		host.querySelector('[data-gr="add"]')?.addEventListener('click', addTopic);
		host.querySelector('#gr-topic-input')?.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				addTopic();
			}
		});
		host.querySelectorAll('[data-remove]').forEach((el) =>
			el.addEventListener('click', () => {
				state.draft.topics.allowed.splice(Number(el.dataset.remove), 1);
				render();
			}),
		);
		const redirect = host.querySelector('#gr-redirect');
		redirect?.addEventListener('input', () => {
			state.draft.topics.redirect = redirect.value;
			host.querySelector('[data-gr="redirect-count"]').textContent = `${redirect.value.length}/${LIMITS.redirectChars}`;
			refreshSave();
		});
		host.querySelector('[data-gr="save"]')?.addEventListener('click', save);
	}

	async function save() {
		if (state.draft.topics.enabled && !state.draft.topics.allowed.length) {
			setStatus('Add at least one topic before turning topic control on.', 'error');
			host.querySelector('#gr-topic-input')?.focus();
			return;
		}
		state.saving = true;
		refreshSave();
		setStatus('Saving…');
		try {
			const r = await apiFetch(base, {
				method: 'PUT',
				credentials: 'include',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...state.draft, topics: { ...state.draft.topics, redirect: state.draft.topics.redirect.trim() } }),
			});
			const body = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(errorText(body, r.status));
			apply(body.data);
			state.saving = false;
			render();
			setStatus('Saved. New conversations use these settings now.', 'ok');
		} catch (err) {
			state.saving = false;
			refreshSave();
			setStatus(err.message, 'error');
		}
	}

	load();
}
