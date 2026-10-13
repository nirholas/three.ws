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

import { onchainBadgeHTML } from './shared/onchain-badge.js';
import { coinChipHTML } from './shared/agent-coin.js';
import { walletChipHTML, wireWalletChips } from './shared/agent-wallet-chip.js';
import { agentAvatarGlb, hasCustomAvatar, seeInWorldHref } from './shared/agent-3d.js';
import { log } from './shared/log.js';
import { resolveDevR2Url } from './shared/dev-r2-proxy.js';
import { hydrateAvatarWallet } from './shared/wallet-aura.js';
import { mountNameplate } from './shared/living-avatar.js';

// The detail stage's wallet aura — torn down before each remount so its live
// poll + rAF never leak across agents.
let detailStageAura = null;
let detailStagePlate = null;

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

// Loads a thumbnail into an element's background only once the image has
// actually decoded. Object storage (R2) can 403/502 behind a URL that still
// looks valid, and a raw `background-image: url(...)` on a dead asset just
// renders a blank box with no signal to the user, so this probes with a
// detached Image() first and leaves the initial-letter fallback in place on
// failure instead of swapping to it.
function loadThumbnailBackground(el, url) {
	const fallback = el.querySelector('.d-avatar-fallback');
	const probe = new Image();
	probe.onload = () => {
		el.classList.add('has-img');
		el.style.backgroundImage = `url('${url}')`;
		if (fallback) fallback.style.display = 'none';
	};
	probe.onerror = () => {
		// Object storage is unreachable for this asset: keep showing the
		// initial-letter fallback rather than a blank image box.
	};
	probe.src = url;
}

// Same probe-before-swap treatment for a grid of small thumbnail cards (the
// creator modal's agents/avatars grids): each `.thumb` renders its
// fallback letter up front, and only gets a background image once that
// image has actually decoded.
function wireThumbGrid(container) {
	container.querySelectorAll('.thumb[data-thumb-url]').forEach((el) => {
		const url = el.dataset.thumbUrl;
		if (!url) return;
		const probe = new Image();
		probe.onload = () => {
			el.style.backgroundImage = `url('${url}')`;
			el.querySelector('.thumb-fallback-text')?.remove();
		};
		probe.onerror = () => {
			// Leave the fallback letter/glyph showing.
		};
		probe.src = url;
	});
}

export function renderDetailAvatar(a) {
	const el = $('d-avatar');
	if (!el) return;
	el.classList.remove('has-img', 'has-3d');
	el.style.backgroundImage = '';
	const fallback = el.querySelector('.d-avatar-fallback');
	const existingMv = el.querySelector('model-viewer');
	if (existingMv) existingMv.remove();
	if (fallback) {
		fallback.textContent = initial(a.name);
		fallback.style.display = 'flex';
	}

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
		mv.addEventListener(
			'error',
			() => {
				mv.remove();
				el.classList.remove('has-3d');
				if (a.thumbnail_url) loadThumbnailBackground(el, a.thumbnail_url);
			},
			{ once: true },
		);
		el.appendChild(mv);
	} else if (a.thumbnail_url) {
		loadThumbnailBackground(el, a.thumbnail_url);
	}
}

// ── Detail 3D model stage ───────────────────────────────────────────────
//
// A full-width interactive viewer at the top of the Overview tab: orbit +
// zoom camera controls, load progress, fullscreen, "open in world", and a
// GLB download when the agent ships its own model. Agents without a custom
// GLB stand on the base mannequin (see shared/agent-3d.js) so the stage is
// never a dead hole — the hint copy says exactly which one you're looking at.

let stageVisibilityObserver = null;
let stageFullscreenBound = false;

export function renderDetailModelStage(a) {
	const card = $('d-model-card');
	const stage = $('d-model-stage');
	if (!card || !stage) return;

	const glbUrl = agentAvatarGlb(a);
	const custom = hasCustomAvatar(a);

	if (stageVisibilityObserver) {
		stageVisibilityObserver.disconnect();
		stageVisibilityObserver = null;
	}
	detailStageAura?.destroy?.();
	detailStageAura = null;
	detailStagePlate?.destroy?.();
	detailStagePlate = null;
	stage.innerHTML = '';

	const hint = $('d-model-hint');
	if (hint) {
		hint.textContent = custom
			? 'Drag to orbit · scroll to zoom'
			: 'Base avatar — fork this agent to attach a custom model';
	}

	const mv = document.createElement('model-viewer');
	mv.setAttribute('src', resolveDevR2Url(glbUrl));
	mv.setAttribute('alt', `${a.name || 'Agent'} — 3D model`);
	mv.setAttribute('camera-controls', '');
	mv.setAttribute('auto-rotate', '');
	mv.setAttribute('rotation-per-second', '18deg');
	mv.setAttribute('interaction-prompt', 'when-focused');
	mv.setAttribute('autoplay', '');
	mv.setAttribute('exposure', '1.05');
	mv.setAttribute('shadow-intensity', '0.7');
	mv.setAttribute('tone-mapping', 'aces');
	if (custom && a.thumbnail_url) mv.setAttribute('poster', a.thumbnail_url);
	mv.style.cssText = 'opacity:0;transition:opacity .3s ease;';
	stage.appendChild(mv);

	const progressEl = Object.assign(document.createElement('div'), {
		className: 'modal-load-progress',
	});
	progressEl.innerHTML =
		'<div class="modal-load-bar-wrap"><div class="modal-load-bar"></div></div><span class="modal-load-label">Loading 3D…</span>';
	stage.insertBefore(progressEl, mv);
	const bar = progressEl.querySelector('.modal-load-bar');
	mv.addEventListener('progress', (e) => {
		if (bar) bar.style.width = Math.round((e.detail?.totalProgress || 0) * 100) + '%';
	});
	const loadTimeout = setTimeout(() => {
		const label = progressEl.querySelector('.modal-load-label');
		if (label) label.textContent = 'Still loading — large model or slow connection.';
	}, 15_000);
	mv.addEventListener(
		'load',
		() => {
			clearTimeout(loadTimeout);
			progressEl.remove();
			mv.style.opacity = '1';
		},
		{ once: true },
	);

	// Net-Worth-Reactive Avatar: the model wears its real wallet here exactly as on
	// its profile and in the galaxy. Mounted as an independent sibling layer right
	// away (not gated on the GLB load) so it's robust to a slow or failed model.
	hydrateAvatarWallet(stage, a, { lod: 'full', live: true, network: 'mainnet' })
		.then((c) => { detailStageAura = c; })
		.catch(() => { /* dormant baseline already shown */ });
	// The nameplate — name + vanity-highlighted address + tier glyph anchored to the
	// model. Ownership is reconciled from the server read (upgrades to the owner view
	// only on a confirmed owner), so a visitor never sees an owner control.
	detailStagePlate = mountNameplate(stage, a, { network: 'mainnet', live: true, position: 'bottom' });
	mv.addEventListener(
		'error',
		() => {
			clearTimeout(loadTimeout);
			const label = progressEl.querySelector('.modal-load-label');
			if (label) label.textContent = "Couldn't load the 3D model.";
			const wrap = progressEl.querySelector('.modal-load-bar-wrap');
			if (wrap) wrap.remove();
		},
		{ once: true },
	);

	// Suspend auto-rotate while the stage is off-screen so model-viewer halts
	// its rAF loop (same trick the marketplace grid cards use).
	if ('IntersectionObserver' in window) {
		stageVisibilityObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) mv.setAttribute('auto-rotate', '');
					else mv.removeAttribute('auto-rotate');
				}
			},
			{ rootMargin: '100px' },
		);
		stageVisibilityObserver.observe(stage);
	}

	// Actions.
	const world = $('d-model-world');
	if (world) world.href = seeInWorldHref(a);

	const dl = $('d-model-download');
	if (dl) {
		if (custom) {
			dl.href = glbUrl;
			dl.download = `${(a.name || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent'}.glb`;
			dl.hidden = false;
		} else {
			dl.hidden = true;
		}
	}

	// Fullscreen the whole card (not just the stage) so the action row — and
	// the exit button — stays on screen.
	const fsBtn = $('d-model-fullscreen');
	if (fsBtn) {
		if (!card.requestFullscreen) {
			// iOS Safari has no element fullscreen — hide rather than dead-end.
			fsBtn.hidden = true;
		} else {
			fsBtn.hidden = false;
			fsBtn.onclick = () => {
				if (document.fullscreenElement === card) document.exitFullscreen();
				else card.requestFullscreen().catch(() => {});
			};
			if (!stageFullscreenBound) {
				stageFullscreenBound = true;
				document.addEventListener('fullscreenchange', () => {
					const on = document.fullscreenElement === $('d-model-card');
					const btn = $('d-model-fullscreen');
					if (btn) {
						btn.textContent = on ? '✕ Exit fullscreen' : '⛶ Fullscreen';
						btn.setAttribute(
							'aria-label',
							on ? 'Exit fullscreen' : 'View 3D model fullscreen',
						);
					}
				});
			}
		}
	}

	// The small header avatar doubles as a shortcut to the stage.
	const headAvatar = $('d-avatar');
	if (headAvatar && headAvatar.dataset.stageWired !== '1') {
		headAvatar.dataset.stageWired = '1';
		headAvatar.setAttribute('role', 'button');
		headAvatar.setAttribute('tabindex', '0');
		headAvatar.setAttribute('aria-label', 'Jump to 3D model viewer');
		headAvatar.title = 'View 3D model';
		const jump = () => {
			const target = $('d-model-card');
			if (!target) return;
			// The stage lives on the Overview tab — switch to it if needed.
			document.querySelector('.market-tabs [data-tab="overview"]')?.click();
			target.scrollIntoView({ behavior: 'smooth', block: 'center' });
			target.classList.remove('flash');
			requestAnimationFrame(() => target.classList.add('flash'));
		};
		headAvatar.addEventListener('click', jump);
		headAvatar.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				jump();
			}
		});
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
		log.error('[marketplace] preview', err);
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
		log.error('[marketplace] creator', err);
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
			// Fallback letter renders immediately; wireThumbGrid() below swaps in
			// the background image only once it has actually decoded, so a dead
			// R2 asset shows the letter instead of a blank box.
			const thumb = `<div class="thumb" data-thumb-url="${a.thumbnail_url ? escapeHtml(a.thumbnail_url) : ''}"><span class="thumb-fallback-text">${escapeHtml(initial(a.name))}</span></div>`;
			// Non-link badge: the whole card is clickable (navigates to the agent),
			// so a nested explorer anchor would double-fire. The explorer link lives
			// on the agent detail page this card opens.
			const onchain = onchainBadgeHTML(a, { link: false, size: 'sm' });
			const coin = coinChipHTML(a, { link: false, size: 'sm' });
			// Non-interactive (link:false) vanity-aware wallet badge — the card itself
			// navigates, and the explorer/copy controls live on the agent's own page.
			const wallet = walletChipHTML(a, { isOwner: false, showPending: false, link: false });
			return `<div class="creator-mini-card" data-agent-id="${escapeHtml(a.id)}">
				${thumb}
				<div class="name">${escapeHtml(a.name)}</div>
				${onchain || coin || wallet ? `<div class="meta">${onchain}${coin}${wallet}</div>` : ''}
				<div class="meta">⊙ ${fmtNumber(a.views_count)} · ⑂ ${fmtNumber(a.forks_count)}</div>
			</div>`;
		}).join('');
		wireWalletChips(agentsGrid);
		wireThumbGrid(agentsGrid);
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
			const thumb = `<div class="thumb" data-thumb-url="${avt.thumbnail_url ? escapeHtml(avt.thumbnail_url) : ''}"><span class="thumb-fallback-text">◉</span></div>`;
			const wallet = walletChipHTML(avt, { isOwner: false, showPending: false, link: false });
			return `<div class="creator-mini-card" data-avatar-id="${escapeHtml(avt.id)}">
				${thumb}
				<div class="name">${escapeHtml(avt.name || 'Untitled')}</div>
				${wallet ? `<div class="meta">${wallet}</div>` : ''}
				<div class="meta">${escapeHtml(formatDate(avt.created_at))}</div>
			</div>`;
		}).join('');
		wireWalletChips(avatarsGrid);
		wireThumbGrid(avatarsGrid);
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
