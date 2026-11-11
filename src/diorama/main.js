// Diorama — the create-flow controller.
//
// This is the page's only script entry: it imports the renderer, the composer,
// the gallery, and the share sheet, then wires the DOM contract documented in
// pages/diorama.html to all of them. It drives three journeys:
//
//   • Compose  — a sentence → a live plan → meshes forged progressively, each
//                object materializing into the scene as it arrives.
//   • Deep link — ?id=<uuid> loads a saved world read-only and offers a remix.
//   • Save & share — persists a finished world, opens the share sheet, refreshes
//                the gallery, and rewrites the URL to the new permalink.
//
// Every state in the DOM contract (idle / loading / forging / ready / empty /
// error) is designed and reachable; the controller never leaves the UI stuck.

import { createDioramaRenderer } from './renderer.js';
import { mountGallery } from './gallery.js';
import { openShare } from './share.js';
import { composeWorld, composeWorldFromPhoto, forgeObject, CLIENT_ID } from './compose.js';
import {
	forgeProgress,
	isComplete,
	MAX_PROMPT_LEN,
	MOODS,
} from './schema.js';
import { shortAddress } from '../shared/address.js';
import { playability } from './game-rules.js';

const MOOD_LABEL = { dawn: 'Dawn', day: 'Daytime', dusk: 'Dusk', night: 'Night' };

document.addEventListener('DOMContentLoaded', init);

function init() {
	const el = collectElements();
	if (!el.stage) return;

	const renderer = createDioramaRenderer(el.stage, {});

	/** Live controller state for the world currently on the stage. */
	const state = {
		diorama: null, // the active diorama (plan → populated)
		controller: null, // AbortController for the in-flight compose
		busy: false, // compose/forge in progress
		readOnly: false, // a deep-linked saved world (no live forging)
	};

	// Play mode loads lazily: it pulls in the walk avatar stack, which a visitor
	// who only wants to look at the world never needs.
	let playController = null;
	async function openPlay() {
		const btn = actBtn('play');
		if (btn) btn.setAttribute('aria-busy', 'true');
		try {
			if (!playController) {
				const { createPlay } = await import('./play.js');
				playController = createPlay({
					stage: el.stage,
					renderer,
					getDiorama: () => state.diorama,
					onExit: () => {
						renderer.startAutoOrbit(true);
						btn?.focus({ preventScroll: true });
					},
				});
			}
			await playController.start();
		} catch (err) {
			showShareNote(
				err instanceof TypeError
					? 'Could not load play mode. Check your connection and try again.'
					: 'Play mode failed to start. Try again in a moment.',
				true,
			);
		} finally {
			btn?.removeAttribute('aria-busy');
		}
	}

	// The Play button appears only for worlds that have a goal. It stays disabled
	// (with the reason as its title) until the goal objects are forged.
	function syncPlayButton() {
		const btn = actBtn('play');
		if (!btn) return;
		const d = state.diorama;
		if (!d || !d.game) {
			hide(btn);
			return;
		}
		const verdict = playability(d);
		show(btn);
		btn.disabled = !verdict.ok;
		btn.title = verdict.ok ? '' : verdict.reason;
	}

	const gallery = mountGallery({
		listEl: el.galleryList,
		emptyEl: el.emptyState,
		onOpen: (id) => openSavedWorld(id, { scroll: true }),
	});
	gallery.reload();

	// ── DOM helpers ──────────────────────────────────────────────────────────

	const show = (node) => node && (node.hidden = false);
	const hide = (node) => node && (node.hidden = true);

	function fadeOutLoader() {
		const loader = el.stageLoader;
		if (!loader || loader.hidden) return;
		loader.classList.add('is-leaving');
		const done = () => {
			loader.hidden = true;
			loader.classList.remove('is-leaving');
		};
		// Honor the CSS transition if there is one; always settle regardless.
		loader.addEventListener('transitionend', done, { once: true });
		setTimeout(done, 600);
	}

	function setHud(diorama) {
		if (!el.hud) return;
		const mood = MOODS.includes(diorama.mood) ? diorama.mood : 'day';
		if (el.hudTitle) el.hudTitle.textContent = diorama.title || 'A little world';
		if (el.hudMeta) {
			const moodLabel = MOOD_LABEL[mood] || mood;
			// A registered creator (diorama.creatorUsername, set server-side only
			// when the world was saved while signed in) gets a real link to their
			// public portfolio. Anonymous saves fall back to the plain-text handle
			// or wallet the composer captured — never a fabricated link.
			if (diorama.creatorUsername) {
				const escUser = String(diorama.creatorUsername).replace(/[&<>"']/g, (c) =>
					({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
				);
				el.hudMeta.textContent = '';
				el.hudMeta.append(document.createTextNode(`${moodLabel} · `));
				const link = document.createElement('a');
				link.href = `/u/${escUser}`;
				link.className = 'hud-author-link';
				link.textContent = `@${escUser}`;
				el.hudMeta.append(link);
			} else {
				const author = diorama.author?.handle
					? `@${diorama.author.handle.replace(/^@/, '')}`
					: diorama.author?.wallet
						? shortWallet(diorama.author.wallet)
						: '';
				el.hudMeta.textContent = [moodLabel, author].filter(Boolean).join(' · ');
			}
		}
		show(el.hud);
	}

	// Build the per-object status chips into #world-objects.
	function renderObjectChips(diorama) {
		if (!el.worldObjects) return;
		el.worldObjects.replaceChildren();
		for (const obj of diorama.objects) {
			el.worldObjects.append(buildChip(obj));
		}
	}

	function buildChip(obj) {
		const li = document.createElement('li');
		li.className = 'dio-object';
		li.dataset.id = obj.id;
		li.dataset.status = obj.status || 'pending';

		const dot = document.createElement('span');
		dot.className = 'dio-object__dot';
		dot.setAttribute('aria-hidden', 'true');

		const label = document.createElement('span');
		label.className = 'dio-object__label';
		label.textContent = obj.label || obj.prompt;

		li.append(dot, label);
		li.setAttribute('role', 'listitem');
		if (obj.forgeFrom) li.dataset.from = obj.forgeFrom;
		li.setAttribute('aria-label', chipLabel(obj, obj.status));
		setChipTitle(li, obj);
		if (obj.box) {
			// Photo objects light up their box on the source photo.
			li.tabIndex = 0;
			const on = () => setHot(obj.id, true);
			const off = () => setHot(obj.id, false);
			li.addEventListener('pointerenter', on);
			li.addEventListener('pointerleave', off);
			li.addEventListener('focus', on);
			li.addEventListener('blur', off);
		}
		return li;
	}

	function chipLabel(obj, status) {
		const from = obj?.forgeFrom === 'photo' ? ', from its crop of your photo' : '';
		return `${obj?.label || obj?.prompt || 'object'}: ${statusWord(status)}${from}`;
	}

	// Hover hint saying where a photo object's mesh came from.
	function setChipTitle(chip, obj) {
		if (obj?.forgeFrom === 'photo') chip.title = 'Forged from its crop of your photo';
		else if (obj?.forgeFrom === 'text') chip.title = 'Forged from its description (its crop could not be used)';
		else chip.removeAttribute('title');
	}

	function chipFor(id) {
		return el.worldObjects?.querySelector(`.dio-object[data-id="${cssEscape(id)}"]`) || null;
	}

	function setChipStatus(id, status) {
		const chip = chipFor(id);
		if (!chip) return;
		chip.dataset.status = status;
		const obj = state.diorama?.objects.find((o) => o.id === id);
		if (obj?.forgeFrom) chip.dataset.from = obj.forgeFrom;
		chip.setAttribute('aria-label', chipLabel(obj, status));
		setChipTitle(chip, obj);
		setBoxStatus(id, status);
		// Failed objects get an in-place retry affordance; clear it otherwise.
		const existing = chip.querySelector('.dio-object__retry');
		if (status === 'failed') {
			if (!existing) chip.append(buildRetry(id));
		} else if (existing) {
			existing.remove();
		}
	}

	function buildRetry(id) {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'dio-object__retry';
		btn.textContent = 'Retry';
		btn.setAttribute('aria-label', 'Retry forging this object');
		btn.addEventListener('click', () => retryObject(id));
		return btn;
	}

	// ── Photo inset: the source photo with a live box per object ──────────────

	const SVG_NS = 'http://www.w3.org/2000/svg';
	let photoObjectUrl = null;

	function showPhotoInset(src, diorama) {
		if (!el.photoInset || !el.photoImg || !el.photoBoxes) return;
		if (photoObjectUrl && photoObjectUrl !== src) URL.revokeObjectURL(photoObjectUrl);
		photoObjectUrl = src.startsWith('blob:') ? src : null;
		el.photoImg.src = src;
		el.photoBoxes.replaceChildren();
		for (const obj of diorama.objects) {
			if (!obj.box) continue;
			const [x0, y0, x1, y1] = obj.box;
			const rect = document.createElementNS(SVG_NS, 'rect');
			rect.setAttribute('class', 'dio-photo__box');
			rect.setAttribute('x', String(x0));
			rect.setAttribute('y', String(y0));
			rect.setAttribute('width', String(x1 - x0));
			rect.setAttribute('height', String(y1 - y0));
			rect.dataset.id = obj.id;
			rect.dataset.status = obj.status || 'pending';
			el.photoBoxes.append(rect);
		}
		setPhotoExpanded(true);
		show(el.photoInset);
	}

	function hidePhotoInset() {
		hide(el.photoInset);
		el.photoBoxes?.replaceChildren();
		el.photoImg?.removeAttribute('src');
		if (photoObjectUrl) URL.revokeObjectURL(photoObjectUrl);
		photoObjectUrl = null;
	}

	function setPhotoExpanded(open) {
		el.photoToggle?.setAttribute('aria-expanded', open ? 'true' : 'false');
		if (el.photoFrame) el.photoFrame.hidden = !open;
	}

	function boxFor(id) {
		return el.photoBoxes?.querySelector(`.dio-photo__box[data-id="${cssEscape(id)}"]`) || null;
	}

	function setBoxStatus(id, status) {
		const rect = boxFor(id);
		if (rect) rect.dataset.status = status;
	}

	function setHot(id, on) {
		boxFor(id)?.classList.toggle('is-hot', on);
		chipFor(id)?.classList.toggle('is-hot', on);
	}

	// Live progress bar + "n / total" count, driven by schema's forgeProgress.
	function updateProgress() {
		const d = state.diorama;
		if (!d) return;
		const total = d.objects.length;
		const ready = d.objects.filter((o) => o.status === 'ready').length;
		const settled = d.objects.filter((o) => o.status === 'ready' || o.status === 'failed').length;
		const pct = Math.round(forgeProgress(d) * 100);

		if (el.worldProgress) el.worldProgress.style.width = `${pct}%`;
		if (el.progressBar) el.progressBar.setAttribute('aria-valuenow', String(pct));
		if (el.worldCount) el.worldCount.textContent = `${ready} / ${total}`;

		if (el.statusLabel) {
			if (settled < total) {
				el.statusLabel.textContent = 'Forging your world…';
			} else if (ready === 0) {
				el.statusLabel.textContent = 'Nothing would forge this time. Try remixing.';
			} else if (ready < total) {
				el.statusLabel.textContent = `Your world is ready (${ready} of ${total} pieces).`;
			} else {
				el.statusLabel.textContent = 'Your world is ready ✨';
			}
		}
	}

	// ── Compose flow ──────────────────────────────────────────────────────────

	async function startCompose(rawPrompt) {
		const prompt = String(rawPrompt ?? '').slice(0, MAX_PROMPT_LEN).trim();
		if (!prompt) {
			el.input?.focus();
			return;
		}

		// Abort any compose already in flight (the user resubmitted).
		state.controller?.abort();
		const controller = new AbortController();
		state.controller = controller;
		state.busy = true;
		state.readOnly = false;
		state.lastPrompt = prompt;
		state.lastPhoto = null;
		hidePhotoInset();

		setComposeBusy(true);
		hide(el.errorState);
		hide(el.sharePanel);
		hide(el.worldActions);
		clearShareNote();
		show(el.worldStatus);
		if (el.statusLabel) el.statusLabel.textContent = 'Composing your world…';
		if (el.worldProgress) el.worldProgress.style.width = '0%';
		if (el.worldCount) el.worldCount.textContent = '';
		if (el.input) el.input.value = prompt;

		try {
			const diorama = await composeWorld(prompt, {
				signal: controller.signal,
				onPlan: (plan) => {
					if (controller.signal.aborted) return;
					state.diorama = plan;
					renderer.setDiorama(plan);
					fadeOutLoader();
					renderObjectChips(plan);
					setHud(plan);
					updateProgress();
				},
				onObject: (id, patch) => {
					if (controller.signal.aborted) return;
					handleObjectPatch(id, patch);
				},
			});
			if (controller.signal.aborted) return;
			state.diorama = diorama;
			finishWorld();
		} catch (err) {
			if (controller.signal.aborted || err?.name === 'AbortError') return;
			showError(err);
		} finally {
			if (state.controller === controller) {
				state.controller = null;
				state.busy = false;
				setComposeBusy(false);
			}
		}
	}

	const PHOTO_STAGE_LABEL = {
		reading: 'Opening your photo…',
		uploading: 'Uploading your photo…',
		analyzing: 'Reading the scene…',
		forging: 'Forging your world…',
	};

	// Rebuild a photo (a File, or the stored URL of a saved photo world).
	async function startPhotoCompose(source) {
		if (!source) return;
		state.controller?.abort();
		const controller = new AbortController();
		state.controller = controller;
		state.busy = true;
		state.readOnly = false;
		state.lastPhoto = source;

		setComposeBusy(true);
		hide(el.errorState);
		hide(el.sharePanel);
		hide(el.worldActions);
		clearShareNote();
		hidePhotoInset();
		show(el.worldStatus);
		if (el.statusLabel) el.statusLabel.textContent = PHOTO_STAGE_LABEL.reading;
		if (el.worldProgress) el.worldProgress.style.width = '0%';
		if (el.worldCount) el.worldCount.textContent = '';
		el.worldObjects?.replaceChildren();
		el.stage.scrollIntoView({ behavior: 'smooth', block: 'center' });

		try {
			const diorama = await composeWorldFromPhoto(source, {
				signal: controller.signal,
				onStage: (stage) => {
					if (controller.signal.aborted || !el.statusLabel) return;
					if (stage !== 'forging') el.statusLabel.textContent = PHOTO_STAGE_LABEL[stage] || '';
				},
				onPlan: (plan, photo) => {
					if (controller.signal.aborted) return;
					state.diorama = plan;
					state.lastPrompt = plan.prompt;
					if (el.input) el.input.value = '';
					renderer.setDiorama(plan);
					fadeOutLoader();
					renderObjectChips(plan);
					showPhotoInset(photo.src, plan);
					setHud(plan);
					updateProgress();
				},
				onObject: (id, patch) => {
					if (controller.signal.aborted) return;
					handleObjectPatch(id, patch);
				},
			});
			if (controller.signal.aborted) return;
			state.diorama = diorama;
			finishWorld();
		} catch (err) {
			if (controller.signal.aborted || err?.name === 'AbortError') return;
			showError(err);
		} finally {
			if (state.controller === controller) {
				state.controller = null;
				state.busy = false;
				setComposeBusy(false);
			}
		}
	}

	// Apply a per-object patch from the composer: forging / ready / failed.
	async function handleObjectPatch(id, patch) {
		const obj = state.diorama?.objects.find((o) => o.id === id);
		if (!obj) return;

		// The crop this object will forge from was stored: keep it on the world.
		if (patch.refImage && !patch.status) {
			obj.refImage = patch.refImage;
			return;
		}
		if (patch.forgeFrom) obj.forgeFrom = patch.forgeFrom;

		if (patch.status === 'forging') {
			obj.status = 'forging';
			setChipStatus(id, 'forging');
			return;
		}
		if (patch.status === 'ready' && patch.glbUrl) {
			obj.glbUrl = patch.glbUrl;
			queueMicrotask(syncPlayButton);
			// Materialize the mesh into the scene, then flip the chip to ready.
			try {
				await renderer.materializeObject(id, patch.glbUrl);
				obj.status = 'ready';
				setChipStatus(id, 'ready');
			} catch {
				// The mesh forged but couldn't be placed — surface as failed so the
				// user can retry, and keep the renderer's own seed/failure state honest.
				obj.status = 'failed';
				renderer.markFailed(id);
				setChipStatus(id, 'failed');
			}
			updateProgress();
			return;
		}
		// failed (or ready without a url — treat as failed).
		obj.status = 'failed';
		obj.glbUrl = null;
		renderer.markFailed(id);
		setChipStatus(id, 'failed');
		updateProgress();
	}

	// Retry a single failed object in place on the live world.
	async function retryObject(id) {
		const obj = state.diorama?.objects.find((o) => o.id === id);
		if (!obj || state.readOnly) return;
		const chip = chipFor(id);
		const retryBtn = chip?.querySelector('.dio-object__retry');
		if (retryBtn) retryBtn.disabled = true;
		try {
			const result = await forgeObject(obj, {
				onObject: (objId, patch) => handleObjectPatch(objId, patch),
			});
			obj.status = result.status;
			obj.glbUrl = result.glbUrl;
		} catch {
			// AbortError only — the world was torn down; nothing to do.
		} finally {
			finishWorld();
		}
	}

	// Settle the world: final progress, reveal actions, start the auto-orbit.
	/** A world rebuilt from a photo: its objects carry their box in the photo. */
	function isPhotoWorld(d) {
		return Boolean(d?.sourceImage) || Boolean(d?.objects?.some((o) => Array.isArray(o.box)));
	}

	function finishWorld() {
		const d = state.diorama;
		if (!d) return;
		updateProgress();

		const anyReady = d.objects.some((o) => o.status === 'ready' && o.glbUrl);
		const allSettled = d.objects.every((o) => o.status === 'ready' || o.status === 'failed');

		if (anyReady) {
			show(el.worldActions);
			// A photo world is one tight cluster; frame its pieces, not the island.
			if (isPhotoWorld(d)) renderer.frame({ focus: 'objects' });
			renderer.startAutoOrbit(true);
			wireWorldActions();
			syncPlayButton();
		}
		if (allSettled && isComplete(d) && el.statusLabel) {
			el.statusLabel.textContent = 'Your world is ready ✨';
		}
	}

	// ── World actions: remix / save / AR / download ────────────────────────────

	function wireWorldActions() {
		const ar = actBtn('ar');
		const dl = actBtn('download');
		const glbUrls = activeGlbUrls();

		// AR + download only make sense once there is at least one real mesh.
		if (glbUrls.length) {
			show(dl);
			if (arSupported()) show(ar);
			else hide(ar);
		} else {
			hide(dl);
			hide(ar);
		}
	}

	function activeGlbUrls() {
		try {
			const urls = renderer.getActiveGlbUrls?.();
			if (Array.isArray(urls) && urls.length) return urls;
		} catch {
			/* fall through to the diorama's own record */
		}
		return (state.diorama?.objects || [])
			.filter((o) => o.status === 'ready' && o.glbUrl)
			.map((o) => o.glbUrl);
	}

	function actBtn(name) {
		return el.worldActions?.querySelector(`[data-act="${name}"]`) || null;
	}

	function onActions(ev) {
		const btn = ev.target.closest('[data-act]');
		if (!btn || !el.worldActions?.contains(btn)) return;
		const act = btn.dataset.act;
		if (act === 'remix') remixWorld();
		else if (act === 'save') saveWorld(btn);
		else if (act === 'ar') openInRoom();
		else if (act === 'download') downloadWorld();
		else if (act === 'play') openPlay();
	}

	// A photo world remixes by reading its photo again (a fresh read and fresh
	// forges); a sentence world, or a photo world whose photo is not stored,
	// recomposes from its prompt.
	function remixWorld() {
		const photo = state.lastPhoto || state.diorama?.sourceImage;
		if (photo) {
			startPhotoCompose(photo);
			return;
		}
		const prompt = state.diorama?.prompt || state.lastPrompt || el.input?.value;
		if (prompt) startCompose(prompt);
	}

	function downloadWorld() {
		const url = activeGlbUrls()[0];
		if (!url) return;
		const a = document.createElement('a');
		a.href = url;
		a.download = `${slug(state.diorama?.title || 'diorama')}.glb`;
		a.rel = 'noopener';
		document.body.append(a);
		a.click();
		a.remove();
	}

	// "View in your room": hand the first active mesh to a hidden <model-viewer>
	// with AR enabled (model-viewer is already loaded on the page), then trigger
	// its native AR session — mirrors the /forge AR handoff.
	function openInRoom() {
		const url = activeGlbUrls()[0];
		if (!url || !arSupported()) return;
		const mv = ensureArViewer();
		const launch = () => {
			try {
				mv.activateAR?.();
			} catch {
				/* the device declined the AR session; nothing to recover */
			}
		};
		if (mv.getAttribute('src') === url && mv.loaded) {
			launch();
			return;
		}
		mv.setAttribute('src', url);
		mv.setAttribute('alt', `3D model: ${state.diorama?.title || 'your world'}`);
		mv.addEventListener('load', launch, { once: true });
	}

	// ── Save & share ───────────────────────────────────────────────────────────

	async function saveWorld(btn) {
		const d = state.diorama;
		if (!d) return;
		btn.setAttribute('aria-busy', 'true');
		btn.disabled = true;
		clearShareNote();
		try {
			const res = await fetch('/api/diorama', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'save', diorama: d, clientKey: CLIENT_ID }),
			});
			const data = await res.json().catch(() => ({}));

			if (res.status === 503 && data.error === 'sharing_unavailable') {
				showShareNote(
					data.message || 'Sharing is not enabled on this deployment, but your world is fully yours to explore and download.',
				);
				return;
			}
			if (!res.ok || !data.id || !data.url) {
				showShareNote(data.message || 'Could not save this world. Try again in a moment.', true);
				return;
			}

			d.id = data.id;
			d.createdAt = data.createdAt || d.createdAt;
			openShare({ diorama: d, url: data.url, playable: Boolean(d.game) });
			show(el.sharePanel);
			try {
				history.replaceState(null, '', `?id=${encodeURIComponent(data.id)}`);
			} catch {
				/* replaceState can throw in sandboxed frames — non-fatal */
			}
			gallery.reload();
		} catch (err) {
			const offline = err instanceof TypeError;
			showShareNote(
				offline
					? 'Could not reach the server to save. Check your connection and try again.'
					: 'Could not save this world. Try again in a moment.',
				true,
			);
		} finally {
			btn.removeAttribute('aria-busy');
			btn.disabled = false;
		}
	}

	// An inline note in the share region for the "sharing off" / save-error states
	// — keeps the world fully usable while explaining what happened.
	function showShareNote(message, isError = false) {
		clearShareNote();
		const note = document.createElement('p');
		note.className = 'dio-share__note';
		if (isError) note.dataset.error = 'true';
		note.setAttribute('role', 'status');
		note.textContent = message;
		note.dataset.dioNote = 'true';
		(el.sharePanel?.parentElement || el.worldActions?.parentElement || el.stage).append(note);
		show(el.sharePanel?.parentElement ? el.sharePanel : note);
	}

	function clearShareNote() {
		for (const n of document.querySelectorAll('[data-dio-note="true"]')) n.remove();
	}

	// ── Deep link: load a saved world read-only ───────────────────────────────

	async function openSavedWorld(id, { scroll = false } = {}) {
		if (!id) return;
		state.controller?.abort();
		state.busy = true;
		state.readOnly = true;
		hide(el.errorState);
		hide(el.worldActions);
		hide(el.sharePanel);
		clearShareNote();
		hidePhotoInset();
		state.lastPhoto = null;
		show(el.worldStatus);
		if (el.statusLabel) el.statusLabel.textContent = 'Loading this world…';
		if (scroll) el.stage.scrollIntoView({ behavior: 'smooth', block: 'center' });

		try {
			const res = await fetch(`/api/diorama?id=${encodeURIComponent(id)}`);
			const data = await res.json().catch(() => ({}));
			if (res.status === 404) {
				showError(
					Object.assign(new Error('That world has wandered off. It may have been removed.'), {
						code: 'not_found',
						deadLink: true,
					}),
				);
				return;
			}
			if (!res.ok || !data.diorama) {
				showError(new Error(data.message || 'Could not load that world. Try again.'));
				return;
			}

			const diorama = data.diorama;
			state.diorama = diorama;
			renderer.setDiorama(diorama);
			fadeOutLoader();
			renderObjectChips(diorama);
			if (diorama.sourceImage) showPhotoInset(diorama.sourceImage, diorama);
			setHud(diorama);

			// Materialize every already-forged object; mark the rest failed.
			for (const obj of diorama.objects) {
				if (obj.status === 'ready' && obj.glbUrl) {
					setChipStatus(obj.id, 'forging');
					try {
						await renderer.materializeObject(obj.id, obj.glbUrl);
						setChipStatus(obj.id, 'ready');
					} catch {
						obj.status = 'failed';
						renderer.markFailed(obj.id);
						setChipStatus(obj.id, 'failed');
					}
				} else {
					setChipStatus(obj.id, 'failed');
				}
			}
			updateProgress();
			if (el.statusLabel) {
				el.statusLabel.textContent = isPhotoWorld(diorama)
					? `“${diorama.title}”, rebuilt from a photo`
					: `“${diorama.title}”, spoken into being`;
			}

			if (isPhotoWorld(diorama)) renderer.frame({ focus: 'objects' });
			renderer.startAutoOrbit(true);
			showRemixAffordance(diorama);
			syncPlayButton();
			gallery.reload();
			if (autoPlay && diorama.game && playability(diorama).ok) {
				autoPlay = false;
				openPlay();
			}
		} catch (err) {
			showError(
				err instanceof TypeError
					? new Error('Could not reach the server. Check your connection and try again.')
					: err,
			);
		} finally {
			state.busy = false;
			state.readOnly = true;
		}
	}

	// A saved world is read-only; surface a "Remix this world" action that prefills
	// the composer with its prompt and lets the visitor spin their own version.
	function showRemixAffordance(diorama) {
		show(el.worldActions);
		// In read-only mode, only remix / AR / download apply; hide save.
		hide(actBtn('save'));
		const glbUrls = activeGlbUrls();
		const dl = actBtn('download');
		const ar = actBtn('ar');
		if (glbUrls.length) {
			show(dl);
			if (arSupported()) show(ar);
			else hide(ar);
		} else {
			hide(dl);
			hide(ar);
		}
		const remix = actBtn('remix');
		if (remix) {
			remix.textContent = '↻ Remix this world';
			if (el.input) el.input.value = diorama.sourceImage ? '' : diorama.prompt || '';
			state.lastPrompt = diorama.prompt || '';
		}
	}

	// ── Error state ────────────────────────────────────────────────────────────

	function showError(err) {
		hide(el.worldStatus);
		hide(el.worldActions);
		if (el.errorBody) {
			el.errorBody.textContent =
				err?.message || 'Something went wrong building that world. Try again.';
		}
		// Dead deep links get a "back to Diorama" path; everything else retries.
		if (el.retryBtn) {
			if (err?.deadLink) {
				el.retryBtn.textContent = 'Start a new world';
			} else {
				el.retryBtn.textContent = 'Try again';
			}
		}
		show(el.errorState);
		el.errorState.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function onRetry() {
		hide(el.errorState);
		// A dead deep link clears the URL and returns to a clean composer.
		if (el.retryBtn?.textContent?.startsWith('Start')) {
			try {
				history.replaceState(null, '', location.pathname);
			} catch {
				/* non-fatal */
			}
			el.input?.focus();
			return;
		}
		if (state.lastPhoto) {
			startPhotoCompose(state.lastPhoto);
			return;
		}
		const prompt = state.lastPrompt || el.input?.value;
		if (prompt) startCompose(prompt);
		else el.input?.focus();
	}

	// ── AR support / hidden viewer ─────────────────────────────────────────────

	function arSupported() {
		// model-viewer reports per-device AR capability via canActivateAR once the
		// custom element is defined; before then, allow it on mobile so the button
		// is offered where AR is most likely. Desktops simply won't activate.
		const mv = arViewer;
		if (mv && typeof mv.canActivateAR === 'boolean') return mv.canActivateAR;
		return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
	}

	let arViewer = null;
	function ensureArViewer() {
		if (arViewer) return arViewer;
		const mv = document.createElement('model-viewer');
		mv.setAttribute('ar', '');
		mv.setAttribute('ar-modes', 'webxr scene-viewer quick-look');
		mv.setAttribute('camera-controls', '');
		mv.setAttribute('reveal', 'manual');
		mv.style.position = 'fixed';
		mv.style.width = '1px';
		mv.style.height = '1px';
		mv.style.left = '-9999px';
		mv.style.opacity = '0';
		mv.style.pointerEvents = 'none';
		document.body.append(mv);
		arViewer = mv;
		return mv;
	}

	// ── Compose form / examples wiring ─────────────────────────────────────────

	function setComposeBusy(busy) {
		if (!el.submit) return;
		el.submit.setAttribute('aria-busy', busy ? 'true' : 'false');
		el.submit.disabled = busy;
		if (el.input) el.input.toggleAttribute('aria-busy', busy);
		if (el.photoBtn) {
			el.photoBtn.setAttribute('aria-busy', busy ? 'true' : 'false');
			el.photoBtn.disabled = busy;
		}
	}

	el.form?.addEventListener('submit', (ev) => {
		ev.preventDefault();
		startCompose(el.input?.value);
	});

	el.examples?.addEventListener('click', (ev) => {
		const btn = ev.target.closest('button[data-prompt]');
		if (!btn) return;
		const prompt = btn.dataset.prompt || '';
		if (el.input) el.input.value = prompt;
		startCompose(prompt);
	});

	el.worldActions?.addEventListener('click', onActions);
	el.retryBtn?.addEventListener('click', onRetry);

	// ── Photo input: button, drag and drop, paste ─────────────────────────────

	el.photoBtn?.addEventListener('click', () => el.photoInput?.click());
	el.photoInput?.addEventListener('change', () => {
		const file = el.photoInput.files?.[0];
		el.photoInput.value = '';
		if (file) startPhotoCompose(file);
	});
	el.photoToggle?.addEventListener('click', () => {
		setPhotoExpanded(el.photoToggle.getAttribute('aria-expanded') !== 'true');
	});

	const imageFileFrom = (list) => Array.from(list || []).find((f) => f && /^image\//.test(f.type)) || null;
	const draggingFiles = (ev) => Array.from(ev.dataTransfer?.types || []).includes('Files');
	let dragDepth = 0;
	document.addEventListener('dragenter', (ev) => {
		if (!draggingFiles(ev)) return;
		dragDepth += 1;
		show(el.drop);
	});
	document.addEventListener('dragleave', (ev) => {
		if (!draggingFiles(ev)) return;
		dragDepth = Math.max(0, dragDepth - 1);
		if (!dragDepth) hide(el.drop);
	});
	document.addEventListener('dragover', (ev) => {
		if (!draggingFiles(ev)) return;
		ev.preventDefault();
		ev.dataTransfer.dropEffect = 'copy';
	});
	document.addEventListener('drop', (ev) => {
		if (!draggingFiles(ev)) return;
		ev.preventDefault();
		dragDepth = 0;
		hide(el.drop);
		const file = imageFileFrom(ev.dataTransfer.files);
		if (file) startPhotoCompose(file);
		else showError(Object.assign(new Error('That file is not a photo. Drop a JPEG, PNG or WebP image.'), { code: 'photo_type' }));
	});
	// Paste an image (a screenshot, a copied photo) anywhere on the page.
	document.addEventListener('paste', (ev) => {
		const file = imageFileFrom(ev.clipboardData?.files);
		if (!file) return;
		ev.preventDefault();
		startPhotoCompose(file);
	});

	// ── Resize + lifecycle ─────────────────────────────────────────────────────

	const onResize = debounce(() => renderer.resize(), 150);
	window.addEventListener('resize', onResize);

	window.addEventListener(
		'pagehide',
		() => {
			state.controller?.abort();
			window.removeEventListener('resize', onResize);
			renderer.dispose();
		},
		{ once: true },
	);

	// ── Boot: deep link or idle composer ───────────────────────────────────────

	const deepParams = new URLSearchParams(location.search);
	const deepId = deepParams.get('id');
	let autoPlay = deepParams.get('play') === '1';
	if (deepId) {
		openSavedWorld(deepId, { scroll: false });
	} else {
		// Idle: the stage loader stands, the composer waits, the gallery loads.
		el.input?.focus({ preventScroll: true });
	}
}

// ── Element lookup ────────────────────────────────────────────────────────────

function collectElements() {
	const $ = (id) => document.getElementById(id);
	const stage = $('diorama-stage');
	const hud = $('stage-hud');
	const worldStatus = $('world-status');
	const worldActions = $('world-actions');
	const errorState = $('error-state');
	return {
		stage,
		stageLoader: $('stage-loader'),
		hud,
		hudTitle: hud?.querySelector('.dio-hud__title') || null,
		hudMeta: hud?.querySelector('.dio-hud__meta') || null,
		form: $('compose-form'),
		input: $('compose-input'),
		submit: $('compose-submit'),
		examples: $('compose-examples'),
		photoBtn: $('compose-photo'),
		photoInput: $('compose-photo-input'),
		photoInset: $('stage-photo'),
		photoToggle: $('stage-photo')?.querySelector('.dio-photo__toggle') || null,
		photoFrame: $('stage-photo-frame'),
		photoImg: $('stage-photo')?.querySelector('.dio-photo__img') || null,
		photoBoxes: $('stage-photo')?.querySelector('.dio-photo__boxes') || null,
		drop: $('stage-drop'),
		worldStatus,
		statusLabel: worldStatus?.querySelector('.dio-status__label') || null,
		worldProgress: $('world-progress'),
		progressBar: worldStatus?.querySelector('.dio-progress') || null,
		worldCount: worldStatus?.querySelector('[data-count]') || null,
		worldObjects: $('world-objects'),
		worldActions,
		sharePanel: $('share-panel'),
		errorState,
		errorBody: errorState?.querySelector('.dio-error__body') || null,
		retryBtn: errorState?.querySelector('[data-act="retry"]') || null,
		galleryList: $('gallery-list'),
		emptyState: $('empty-state'),
	};
}

// ── Small utilities ────────────────────────────────────────────────────────────

function statusWord(status) {
	switch (status) {
		case 'ready':
			return 'forged';
		case 'forging':
			return 'forging';
		case 'failed':
			return 'failed to forge';
		default:
			return 'waiting';
	}
}

function shortWallet(w) { return shortAddress(w, 4, 4, { empty: 'null' }); }

function slug(s) {
	return (
		String(s)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'diorama'
	);
}

function cssEscape(value) {
	if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
	return String(value).replace(/["\\]/g, '\\$&');
}

function debounce(fn, ms) {
	let t;
	return (...args) => {
		clearTimeout(t);
		t = setTimeout(() => fn(...args), ms);
	};
}
