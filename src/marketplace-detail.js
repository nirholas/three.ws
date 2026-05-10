/**
 * Marketplace v2 detail-view extensions:
 *   - 3D avatar rendering in detail header (replaces emoji placeholder)
 *   - Live "try before you fork" chat preview (SSE streaming)
 *   - Creator profile modal (lists author's agents + avatars)
 *   - Mobile hamburger sidebar
 *
 * Loaded as a sibling module from marketplace.js. Exports plain functions
 * that the main controller calls; all DOM access is via document.getElementById
 * so the module is self-contained.
 */

const API = '/api';
const $ = (id) => document.getElementById(id);

function escapeHtml(s) {
	return String(s ?? '').replace(
		/[&<>"']/g,
		(ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
	);
}
function initial(name) {
	const s = String(name || '?').trim();
	return s ? s[0].toUpperCase() : '?';
}
function formatDate(iso) {
	if (!iso) return '';
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtNumber(n) {
	const v = Number(n) || 0;
	if (v >= 1e6) return (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
	if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
	return String(v);
}

// ── Detail header avatar ────────────────────────────────────────────────

export function renderDetailAvatar(a) {
	const el = $('d-avatar');
	if (!el) return;
	el.classList.remove('has-img', 'has-3d');
	el.style.backgroundImage = '';
	const fallback = el.querySelector('.d-avatar-fallback');
	const existingMv = el.querySelector('model-viewer');
	if (existingMv) existingMv.remove();

	if (a.avatar_glb_url) {
		el.classList.add('has-3d');
		const mv = document.createElement('model-viewer');
		mv.setAttribute('src', a.avatar_glb_url);
		mv.setAttribute('alt', a.name || 'Agent avatar');
		mv.setAttribute('auto-rotate', '');
		mv.setAttribute('rotation-per-second', '20deg');
		mv.setAttribute('interaction-prompt', 'none');
		mv.setAttribute('disable-zoom', '');
		mv.setAttribute('disable-pan', '');
		mv.setAttribute('disable-tap', '');
		mv.setAttribute('exposure', '1');
		mv.setAttribute('shadow-intensity', '0.4');
		mv.setAttribute('tone-mapping', 'aces');
		mv.setAttribute('loading', 'eager');
		el.appendChild(mv);
		if (fallback) fallback.style.display = 'none';
	} else if (a.thumbnail_url) {
		el.classList.add('has-img');
		el.style.backgroundImage = `url('${a.thumbnail_url}')`;
		if (fallback) fallback.style.display = 'none';
	} else if (fallback) {
		fallback.textContent = initial(a.name);
		fallback.style.display = 'flex';
	}
}

// ── Live chat preview on detail page ────────────────────────────────────

const previewState = {
	agentId: null,
	history: [],
	streaming: false,
	abortCtrl: null,
};

export function startPreviewSession(a) {
	previewState.agentId = a.id;
	previewState.history = [];
	previewState.streaming = false;
	if (previewState.abortCtrl) {
		try { previewState.abortCtrl.abort(); } catch {}
		previewState.abortCtrl = null;
	}
	const thread = $('d-preview-thread');
	if (thread) thread.innerHTML = '';
	const footer = $('d-preview-footer');
	if (footer) {
		footer.textContent = '';
		footer.classList.remove('err');
	}
	const input = $('d-preview-input');
	if (input) {
		input.disabled = false;
		input.value = '';
		input.placeholder = `Ask ${a.name || 'this agent'}…`;
	}
	const send = $('d-preview-send');
	if (send) send.disabled = false;
	if (a.greeting) appendPreviewBubble('assistant', a.greeting, false);
}

function appendPreviewBubble(role, text, streaming = false) {
	const thread = $('d-preview-thread');
	if (!thread) return null;
	const wrap = document.createElement('div');
	wrap.className = `market-preview-msg ${role}`;
	const bubble = document.createElement('div');
	bubble.className = 'market-preview-bubble' + (streaming ? ' streaming' : '');
	bubble.textContent = text;
	wrap.appendChild(bubble);
	thread.appendChild(wrap);
	thread.scrollTop = thread.scrollHeight;
	return bubble;
}

export async function submitPreviewMessage(e) {
	e?.preventDefault?.();
	if (previewState.streaming || !previewState.agentId) return;
	const input = $('d-preview-input');
	const send = $('d-preview-send');
	const footer = $('d-preview-footer');
	const message = (input?.value || '').trim();
	if (!message) return;

	appendPreviewBubble('user', message);
	input.value = '';
	input.disabled = true;
	send.disabled = true;
	footer.classList.remove('err');
	footer.textContent = 'Thinking…';

	const assistantBubble = appendPreviewBubble('assistant', '', true);
	let assistantText = '';
	previewState.streaming = true;
	previewState.abortCtrl = new AbortController();

	try {
		const r = await fetch(`${API}/marketplace/agents/${previewState.agentId}/preview`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			signal: previewState.abortCtrl.signal,
			body: JSON.stringify({
				message,
				history: previewState.history.slice(-8),
			}),
		});
		if (!r.ok) {
			const j = await r.json().catch(() => ({}));
			throw new Error(j?.error_description || j?.error || `Server returned ${r.status}`);
		}
		const reader = r.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		let modelLabel = '';
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			const lines = buf.split('\n');
			buf = lines.pop();
			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				const raw = line.slice(6).trim();
				if (!raw) continue;
				let evt;
				try { evt = JSON.parse(raw); } catch { continue; }
				if (evt.type === 'open') {
					modelLabel = evt.model || '';
				} else if (evt.type === 'chunk' && evt.text) {
					assistantText += evt.text;
					if (assistantBubble) assistantBubble.textContent = assistantText;
					$('d-preview-thread').scrollTop = $('d-preview-thread').scrollHeight;
				} else if (evt.type === 'done') {
					if (evt.reply) {
						assistantText = evt.reply;
						if (assistantBubble) assistantBubble.textContent = assistantText;
					}
					modelLabel = evt.model || modelLabel;
				} else if (evt.type === 'error') {
					throw new Error(evt.message || 'stream error');
				}
			}
		}
		previewState.history.push(
			{ role: 'user', content: message },
			{ role: 'assistant', content: assistantText },
		);
		footer.classList.remove('err');
		footer.textContent = modelLabel ? `via ${modelLabel}` : '';
	} catch (err) {
		if (err.name === 'AbortError') return;
		console.error('[marketplace] preview', err);
		if (assistantBubble) {
			assistantBubble.classList.remove('streaming');
			if (!assistantText) assistantText = '— preview failed';
			assistantBubble.textContent = assistantText;
		}
		footer.classList.add('err');
		footer.textContent = err.message || 'Preview failed';
	} finally {
		previewState.streaming = false;
		previewState.abortCtrl = null;
		if (assistantBubble) assistantBubble.classList.remove('streaming');
		input.disabled = false;
		send.disabled = false;
		input.focus();
	}
}

// ── Creator profile modal ────────────────────────────────────────────────

let activeCreator = null;

export async function openCreatorModal(creatorId, deps = {}) {
	if (!creatorId) return;
	const overlay = $('creator-modal-overlay');
	if (!overlay) return;
	overlay.hidden = false;
	requestAnimationFrame(() => overlay.classList.add('show'));

	$('creator-modal-title').textContent = 'Loading…';
	$('creator-modal-handle').textContent = '';
	$('creator-modal-stats').innerHTML = '';
	$('creator-modal-avatar').textContent = '';
	$('creator-modal-avatar').style.backgroundImage = '';
	$('creator-agents-grid').innerHTML = '<div class="market-empty">Loading…</div>';
	$('creator-avatars-grid').innerHTML = '<div class="market-empty">Loading…</div>';
	$('creator-agents-count').textContent = '';
	$('creator-avatars-count').textContent = '';

	try {
		const r = await fetch(`${API}/creators/${creatorId}`);
		if (!r.ok) {
			const j = await r.json().catch(() => ({}));
			throw new Error(j?.error_description || `Server returned ${r.status}`);
		}
		const j = await r.json();
		activeCreator = j?.data;
		renderCreatorModal(activeCreator, deps);
	} catch (err) {
		console.error('[marketplace] creator', err);
		$('creator-modal-title').textContent = 'Could not load creator';
		$('creator-agents-grid').innerHTML = `<div class="market-empty">${escapeHtml(err.message || 'Failed')}</div>`;
		$('creator-avatars-grid').innerHTML = '';
	}
}

export function closeCreatorModal() {
	const overlay = $('creator-modal-overlay');
	if (!overlay) return;
	overlay.classList.remove('show');
	setTimeout(() => { overlay.hidden = true; activeCreator = null; }, 200);
}

function renderCreatorModal(payload, deps) {
	const c = payload?.creator;
	if (!c) return;
	$('creator-modal-title').textContent = c.display_name || 'Creator';
	$('creator-modal-handle').textContent = c.username ? `@${c.username}` : `Joined ${formatDate(c.joined)}`;

	const av = $('creator-modal-avatar');
	if (c.avatar_url) {
		av.style.backgroundImage = `url('${c.avatar_url}')`;
		av.textContent = '';
	} else {
		av.style.backgroundImage = '';
		av.textContent = initial(c.display_name);
	}

	const t = c.totals || {};
	$('creator-modal-stats').innerHTML = [
		`<span><strong>${fmtNumber(t.agents)}</strong>agents</span>`,
		`<span><strong>${fmtNumber(t.avatars)}</strong>avatars</span>`,
		`<span><strong>${fmtNumber(t.forks)}</strong>forks</span>`,
		`<span><strong>${fmtNumber(t.views)}</strong>views</span>`,
	].join('');

	const agents = payload.agents || [];
	const avatars = payload.avatars || [];
	$('creator-agents-count').textContent = agents.length ? `${agents.length}` : '';
	$('creator-avatars-count').textContent = avatars.length ? `${avatars.length}` : '';

	const agentsGrid = $('creator-agents-grid');
	if (!agents.length) {
		agentsGrid.innerHTML = '<div class="market-empty">No published agents yet.</div>';
	} else {
		agentsGrid.innerHTML = agents.map((a) => {
			const thumb = a.thumbnail_url
				? `<div class="thumb" style="background-image:url('${escapeHtml(a.thumbnail_url)}')"></div>`
				: `<div class="thumb">${escapeHtml(initial(a.name))}</div>`;
			return `<div class="creator-mini-card" data-agent-id="${escapeHtml(a.id)}">
				${thumb}
				<div class="name">${escapeHtml(a.name)}</div>
				<div class="meta">⊙ ${fmtNumber(a.views_count)} · ⑂ ${fmtNumber(a.forks_count)}</div>
			</div>`;
		}).join('');
		agentsGrid.querySelectorAll('[data-agent-id]').forEach((card) => {
			card.addEventListener('click', () => {
				closeCreatorModal();
				if (deps?.navTo) deps.navTo(`/marketplace/agents/${card.dataset.agentId}`);
				else location.href = `/marketplace/agents/${card.dataset.agentId}`;
			});
		});
	}

	const avatarsGrid = $('creator-avatars-grid');
	if (!avatars.length) {
		avatarsGrid.innerHTML = '<div class="market-empty">No public avatars yet.</div>';
	} else {
		avatarsGrid.innerHTML = avatars.map((avt) => {
			const thumb = avt.thumbnail_url
				? `<div class="thumb" style="background-image:url('${escapeHtml(avt.thumbnail_url)}')"></div>`
				: `<div class="thumb">◉</div>`;
			return `<div class="creator-mini-card" data-avatar-id="${escapeHtml(avt.id)}">
				${thumb}
				<div class="name">${escapeHtml(avt.name || 'Untitled')}</div>
				<div class="meta">${escapeHtml(formatDate(avt.created_at))}</div>
			</div>`;
		}).join('');
		avatarsGrid.querySelectorAll('[data-avatar-id]').forEach((card) => {
			card.addEventListener('click', () => {
				const avt = avatars.find((x) => x.id === card.dataset.avatarId);
				if (!avt) return;
				closeCreatorModal();
				if (deps?.openAvatarModal) {
					deps.openAvatarModal({
						avatarId: avt.id,
						name: avt.name,
						description: avt.description,
						glbUrl: avt.glb_url,
						image: avt.thumbnail_url,
						tags: avt.tags,
						createdAt: avt.created_at,
						slug: avt.slug,
					});
				}
			});
		});
	}
}

// ── Mobile sidebar toggle ───────────────────────────────────────────────

export function bindMobileSidebar() {
	const toggle = $('market-sidebar-toggle');
	const backdrop = $('market-sidebar-backdrop');
	if (!toggle) return;
	const close = () => document.body.classList.remove('market-sidebar-open');
	toggle.addEventListener('click', () => {
		document.body.classList.add('market-sidebar-open');
	});
	backdrop?.addEventListener('click', close);
	document.querySelectorAll('.market-sidebar a, .market-sidebar button').forEach((el) => {
		el.addEventListener('click', () => {
			if (window.matchMedia('(max-width: 880px)').matches) close();
		});
	});
	const apply = () => {
		toggle.hidden = !window.matchMedia('(max-width: 880px)').matches;
	};
	apply();
	window.addEventListener('resize', apply);
}

// ── Detail event wiring ─────────────────────────────────────────────────

export function bindDetailExtras(deps = {}) {
	$('d-preview-form')?.addEventListener('submit', submitPreviewMessage);

	$('d-author')?.addEventListener('click', (e) => {
		const id = e.currentTarget.dataset.creatorId;
		if (id) openCreatorModal(id, deps);
	});

	$('creator-modal-close')?.addEventListener('click', closeCreatorModal);
	$('creator-modal-overlay')?.addEventListener('click', (e) => {
		if (e.target.id === 'creator-modal-overlay') closeCreatorModal();
	});

	document.addEventListener('keydown', (e) => {
		if (e.key !== 'Escape') return;
		const cm = $('creator-modal-overlay');
		if (cm && !cm.hidden) closeCreatorModal();
	});

	bindMobileSidebar();
}
