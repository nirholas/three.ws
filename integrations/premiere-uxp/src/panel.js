'use strict';

/**
 * Panel controller. `mount(doc, deps)` wires the DOM in index.html to the capture client.
 * Inside Premiere Pro `deps` come from the host adapters (see hostDeps); under Node tests they are injected.
 */

const { createClient } = require('./core/client');
const { runSend, deliver, inspectInput } = require('./core/session');
const { CancelToken } = require('./core/retry');
const { normalise, ApiError, MESSAGES } = require('./core/errors');
const { QUALITIES, baseName } = require('./core/detect');
const { formatBytes, formatDuration, formatWhen } = require('./core/format');
const { resultFolder } = require('./core/results');

const KEY_PAGE = 'https://three.ws/dashboard/api';

function mount(doc, deps) {
	const $ = (id) => doc.getElementById(id);
	const el = {
		banner: $('banner'),
		bannerText: $('banner-text'),
		bannerDismiss: $('banner-dismiss'),
		keyForm: $('key-form'),
		keySaved: $('key-saved'),
		keyInput: $('key-input'),
		keySave: $('key-save'),
		keyChange: $('key-change'),
		keyRemove: $('key-remove'),
		keyGet: $('key-get'),
		empty: $('empty'),
		chosen: $('chosen'),
		chosenName: $('chosen-name'),
		chosenDetail: $('chosen-detail'),
		confirm360: $('confirm-360'),
		trimRow: $('trim-row'),
		useTrim: $('use-trim'),
		trimDetail: $('trim-detail'),
		qualityRow: $('quality-row'),
		quality: $('quality'),
		useSelected: $('use-selected'),
		chooseFile: $('choose-file'),
		send: $('send'),
		cancel: $('cancel'),
		progressCard: $('progress-card'),
		progressLabel: $('progress-label'),
		progressBar: $('progress-bar'),
		progressDetail: $('progress-detail'),
		resultCard: $('result-card'),
		resultDetail: $('result-detail'),
		insertPreview: $('insert-preview'),
		openViewer: $('open-viewer'),
		viewerUrl: $('viewer-url'),
		resultFolder: $('result-folder'),
		mineRefresh: $('mine-refresh'),
		mineLoading: $('mine-loading'),
		mineEmpty: $('mine-empty'),
		mineError: $('mine-error'),
		mineErrorText: $('mine-error-text'),
		mineList: $('mine-list'),
	};

	const state = { hasKey: false, input: null, clip: null, busy: false, token: null, lastOutcome: null };
	const client = createClient({
		origin: deps.origin,
		getKey: deps.storage.getApiKey,
		fetchImpl: deps.fetchImpl,
		sleep: deps.sleep,
	});

	const show = (node, visible) => {
		node.hidden = !visible;
	};
	const disable = (node, off) => {
		if (off) node.setAttribute('disabled', '');
		else node.removeAttribute('disabled');
	};

	function showMessage(text, kind) {
		el.bannerText.textContent = text;
		el.banner.className = kind === 'info' ? 'banner info' : 'banner';
		show(el.banner, true);
	}
	const clearMessage = () => show(el.banner, false);
	function showError(raw) {
		const err = normalise(raw);
		if (err.code === 'cancelled') showMessage(MESSAGES.cancelled, 'info');
		else showMessage(err.message);
		return err;
	}

	function setBusy(busy) {
		state.busy = busy;
		disable(el.send, busy || !state.input || state.input.error || !state.hasKey);
		disable(el.useSelected, busy);
		disable(el.chooseFile, busy);
		show(el.cancel, busy);
		if (busy) show(el.send, false);
		else show(el.send, true);
	}

	function setProgress({ progress, label, detail }) {
		show(el.progressCard, true);
		el.progressLabel.textContent = label || '';
		el.progressBar.setAttribute('value', String(Math.round((progress || 0) * 100)));
		el.progressDetail.textContent = detail || '';
	}

	async function refreshKeyState() {
		const key = await deps.storage.getApiKey();
		state.hasKey = Boolean(key);
		show(el.keyForm, !state.hasKey);
		show(el.keySaved, state.hasKey);
		setBusy(state.busy);
		return state.hasKey;
	}

	function describeInput(info) {
		const parts = [];
		if (info.size) parts.push(formatBytes(info.size));
		if (info.width && info.height) parts.push(`${info.width} x ${info.height}`);
		if (info.durationSeconds) parts.push(formatDuration(info.durationSeconds));
		parts.push(info.lane === 'scene' ? 'goes to a 3D photo scene' : 'goes to a Gaussian splat scene');
		return parts.join(' - ');
	}

	function renderInput() {
		const info = state.input;
		show(el.empty, !info);
		show(el.chosen, Boolean(info));
		if (!info) {
			setBusy(false);
			return;
		}
		el.chosenName.textContent = info.name;
		if (info.error) {
			el.chosenDetail.textContent = info.error.message;
			show(el.confirm360, false);
			show(el.trimRow, false);
			show(el.qualityRow, false);
			setBusy(false);
			return;
		}
		el.chosenDetail.textContent = describeInput(info);
		const needsConfirm = info.is360 !== true;
		show(el.confirm360, needsConfirm);
		if (needsConfirm) {
			el.confirm360.checked = false;
			el.confirm360.textContent = info.lane === 'scene' ? 'This is a 360 photo (2:1)' : 'This is a stitched 360 video (2:1)';
		}
		show(el.trimRow, Boolean(info.trim));
		if (info.trim) {
			el.trimDetail.textContent = `Sends ${formatDuration(info.trim.start_s)} to ${formatDuration(info.trim.end_s)} of the clip.`;
			el.useTrim.checked = true;
		}
		show(el.qualityRow, info.lane !== 'scene');
		setBusy(false);
	}

	async function chooseInput(path, clip) {
		clearMessage();
		try {
			state.clip = clip || null;
			state.input = await inspectInput({ host: deps.host, path, clip });
			if (state.input.error) showMessage(state.input.error.message);
		} catch (err) {
			state.input = null;
			showError(err);
		}
		renderInput();
	}

	async function useSelected() {
		let clip = null;
		try {
			clip = await deps.premiere.selectedClip();
		} catch {
			clip = null;
		}
		if (!clip) {
			showMessage(MESSAGES.no_selection, 'info');
			return;
		}
		await chooseInput(clip.path, clip);
	}

	async function pickFile() {
		try {
			const path = await deps.files.pickFile();
			if (path) await chooseInput(path, null);
		} catch (err) {
			showError(err);
		}
	}

	function qualityId() {
		const index = Number(el.quality.selectedIndex);
		return QUALITIES[Number.isInteger(index) && index >= 0 && index < QUALITIES.length ? index : 1].id;
	}

	async function hostForRun() {
		const project = await deps.premiere.projectInfo();
		let sink = null;
		const target = async (jobId) => {
			if (sink && sink.jobId === jobId) return sink;
			const folder = resultFolder(project.path, jobId);
			if (folder) {
				const dir = await deps.files.ensureFolder(folder.dir, folder.levels, folder.sep);
				sink = { jobId, folder: dir, sep: folder.sep, savedNextToProject: true };
			} else {
				const fallback = await deps.files.dataFolderTarget(jobId);
				sink = { jobId, ...fallback, savedNextToProject: false };
			}
			return sink;
		};
		return {
			openFile: deps.files.openLocalFile,
			expandSplitPair: deps.files.expandSplitPair,
			resumeStore: deps.resumeStore,
			fetchStream: (url) => deps.files.fetchStream(url),
			async resultTarget(jobId, fileName) {
				const s = await target(jobId);
				return { path: `${s.folder}${s.sep}${fileName}`, sink: deps.files.fileSink };
			},
			importFiles: (paths) => deps.premiere.importIntoBin(paths),
			folderFor: (jobId) => (sink && sink.jobId === jobId ? { path: sink.folder, nextToProject: sink.savedNextToProject } : ''),
		};
	}

	function onEvent(e) {
		const detail =
			e.phase === 'upload' && e.totalBytes ? `${formatBytes(e.sentBytes)} of ${formatBytes(e.totalBytes)}` : e.jobId ? `Job ${e.jobId}` : '';
		const base = { upload: 0, process: 0.1, download: 0.9, import: 0.97, done: 1 };
		const span = { upload: 0.1, process: 0.8, download: 0.07, import: 0.03, done: 0 };
		const overall = e.phase in base ? base[e.phase] + (e.progress || 0) * span[e.phase] : (e.progress || 0) * 0.02;
		if (e.phase === 'done') {
			show(el.progressCard, false);
			renderOutcome(e.outcome);
			return;
		}
		setProgress({ progress: overall, label: e.label, detail });
	}

	function renderOutcome(outcome) {
		state.lastOutcome = outcome;
		show(el.resultCard, true);
		const bits = [];
		if (outcome.imported) bits.push(`${outcome.imported} files added to the "three.ws captures" bin.`);
		if (outcome.importError) bits.push(outcome.importError.message);
		if (outcome.missing.length) bits.push(`Not produced for this capture: ${outcome.missing.join(', ')}.`);
		el.resultDetail.textContent = bits.join(' ');
		show(el.insertPreview, Boolean(outcome.previewPath) && !outcome.importError);
		disable(el.insertPreview, false);
		show(el.openViewer, Boolean(outcome.viewerUrl));
		el.viewerUrl.textContent = outcome.viewerUrl || '';
		const folder = outcome.folder;
		el.resultFolder.textContent = folder
			? `Saved to ${folder.path}${folder.nextToProject ? '' : ' (save the project to keep results next to it)'}`
			: '';
	}

	async function send() {
		if (state.busy || !state.input || state.input.error) return;
		clearMessage();
		show(el.resultCard, false);
		state.token = new CancelToken();
		setBusy(true);
		setProgress({ progress: 0, label: 'Starting' });
		try {
			const host = await hostForRun();
			await runSend({
				client,
				host,
				token: state.token,
				sleep: deps.sleep,
				uploadFetch: deps.fetchImpl,
				onEvent,
				input: {
					path: state.input.path,
					clip: state.clip,
					confirm360: Boolean(el.confirm360.checked) || state.input.is360 === true,
					useTrim: Boolean(el.useTrim.checked),
					quality: qualityId(),
				},
			});
			loadMine();
		} catch (err) {
			show(el.progressCard, false);
			showError(err);
		} finally {
			state.token = null;
			setBusy(false);
		}
	}

	function cancel() {
		if (state.token) state.token.cancel();
	}

	async function insertPreview() {
		const o = state.lastOutcome;
		if (!o || !o.previewPath) return;
		disable(el.insertPreview, true);
		try {
			if (!(await deps.premiere.hasActiveSequence())) throw new ApiError('no_sequence', MESSAGES.no_sequence);
			await deps.premiere.insertAtPlayhead(o.previewPath);
			showMessage('Preview inserted at the playhead.', 'info');
		} catch (err) {
			showError(err);
		} finally {
			disable(el.insertPreview, false);
		}
	}

	function openUrl(url) {
		if (!url) return;
		try {
			deps.openExternal(url);
		} catch (err) {
			showError(err);
		}
	}

	/* ---- Your captures ---- */

	function mineRow(capture) {
		const li = doc.createElement('li');
		li.className = 'mine-row';
		const thumb = doc.createElement('img');
		thumb.className = 'mine-thumb';
		thumb.setAttribute('alt', '');
		if (capture.poster_url) thumb.setAttribute('src', capture.poster_url);
		const meta = doc.createElement('div');
		meta.className = 'mine-meta';
		const title = doc.createElement('sp-body');
		title.setAttribute('size', 'S');
		title.textContent = capture.status === 'succeeded' ? 'Gaussian splat scene' : `Capture ${capture.status}`;
		const when = doc.createElement('sp-body');
		when.setAttribute('size', 'XS');
		when.className = 'muted';
		when.textContent = [formatWhen(capture.created_at), capture.source_kind].filter(Boolean).join(' - ');
		meta.appendChild(title);
		meta.appendChild(when);
		li.appendChild(thumb);
		li.appendChild(meta);
		if (capture.status === 'succeeded') {
			const importBtn = doc.createElement('sp-action-button');
			importBtn.setAttribute('size', 's');
			importBtn.setAttribute('aria-label', 'Import this capture into the project');
			importBtn.textContent = 'Import';
			importBtn.addEventListener('click', () => importCapture(capture, importBtn));
			li.appendChild(importBtn);
			if (capture.viewer_url) {
				const openBtn = doc.createElement('sp-action-button');
				openBtn.setAttribute('size', 's');
				openBtn.setAttribute('quiet', '');
				openBtn.setAttribute('aria-label', 'Open this capture on three.ws');
				openBtn.textContent = 'Open';
				openBtn.addEventListener('click', () => openUrl(client.absolute(capture.viewer_url)));
				li.appendChild(openBtn);
			}
		}
		return li;
	}

	async function importCapture(capture, button) {
		if (state.busy) return;
		clearMessage();
		button.setAttribute('disabled', '');
		state.token = new CancelToken();
		setBusy(true);
		try {
			const detail = await client.getCapture(capture.job_id);
			const host = await hostForRun();
			await deliver({ client, host, lane: 'capture', jobId: capture.job_id, result: detail.result, token: state.token, sleep: deps.sleep, onEvent });
		} catch (err) {
			show(el.progressCard, false);
			showError(err);
		} finally {
			state.token = null;
			setBusy(false);
			button.removeAttribute('disabled');
		}
	}

	async function loadMine() {
		show(el.mineEmpty, false);
		show(el.mineError, false);
		if (!(await deps.storage.getApiKey())) {
			el.mineList.textContent = '';
			show(el.mineLoading, false);
			show(el.mineEmpty, true);
			return;
		}
		show(el.mineLoading, true);
		try {
			const out = await client.listCaptures();
			const captures = Array.isArray(out.captures) ? out.captures : [];
			el.mineList.textContent = '';
			for (const c of captures) el.mineList.appendChild(mineRow(c));
			show(el.mineEmpty, captures.length === 0);
		} catch (raw) {
			const err = normalise(raw);
			el.mineList.textContent = '';
			el.mineErrorText.textContent = err.message;
			show(el.mineError, true);
		} finally {
			show(el.mineLoading, false);
		}
	}

	/* ---- wiring ---- */

	el.bannerDismiss.addEventListener('click', clearMessage);
	el.keySave.addEventListener('click', async () => {
		const value = String(el.keyInput.value || '').trim();
		if (!value) {
			showMessage(MESSAGES.missing_key, 'info');
			return;
		}
		try {
			await deps.storage.setApiKey(value);
			el.keyInput.value = '';
			clearMessage();
			await refreshKeyState();
			await loadMine();
		} catch (err) {
			showError(err);
		}
	});
	el.keyChange.addEventListener('click', () => {
		show(el.keyForm, true);
		show(el.keySaved, false);
	});
	el.keyRemove.addEventListener('click', async () => {
		await deps.storage.clearApiKey();
		await refreshKeyState();
		await loadMine();
	});
	el.keyGet.addEventListener('click', (ev) => {
		if (ev && ev.preventDefault) ev.preventDefault();
		openUrl(KEY_PAGE);
	});
	el.useSelected.addEventListener('click', useSelected);
	el.chooseFile.addEventListener('click', pickFile);
	el.send.addEventListener('click', send);
	el.cancel.addEventListener('click', cancel);
	el.insertPreview.addEventListener('click', insertPreview);
	el.openViewer.addEventListener('click', () => openUrl(state.lastOutcome && state.lastOutcome.viewerUrl));
	el.mineRefresh.addEventListener('click', loadMine);
	if (deps.win && deps.win.addEventListener) {
		deps.win.addEventListener('offline', () => showMessage(MESSAGES.offline));
		deps.win.addEventListener('online', clearMessage);
	}

	async function refresh() {
		await refreshKeyState();
		await loadMine();
		if (!state.input && !state.busy) {
			try {
				const clip = await deps.premiere.selectedClip();
				if (clip) await chooseInput(clip.path, clip);
			} catch {
				/* no selection yet: the empty state explains what to do */
			}
		}
	}

	renderInput();
	return { refresh, state, el, send, loadMine, useSelected, chooseInput };
}

/** Deps for the real host: UXP storage, the filesystem, Premiere Pro and the system browser. */
function hostDeps() {
	const uxp = require('uxp');
	const storage = require('./host/storage');
	const files = require('./host/files');
	const premiere = require('./host/premiere');
	return {
		origin: 'https://three.ws',
		storage,
		files,
		premiere,
		resumeStore: storage.createResumeStore(),
		host: { openFile: files.openLocalFile, expandSplitPair: files.expandSplitPair },
		openExternal: (url) => uxp.shell.openExternal(url, 'Open this page on three.ws'),
		win: typeof window !== 'undefined' ? window : null,
	};
}

if (typeof module !== 'undefined') module.exports = { mount, hostDeps, baseName };

(function register() {
	let uxp;
	try {
		uxp = require('uxp');
	} catch {
		return;
	}
	let panel = null;
	uxp.entrypoints.setup({
		panels: {
			'three-ws-capture': {
				create() {
					panel = mount(document, hostDeps());
				},
				show() {
					if (panel) panel.refresh();
				},
			},
		},
	});
})();
