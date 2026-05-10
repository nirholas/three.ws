/**
 * ValidationPage — orchestrator for /validation.
 *
 * Three tabs share one input source (file/URL/sample):
 *   1. Validate  → official Khronos glTF-Validator (gltf-validator npm)
 *   2. Inspect   → glTF-Transform stats + optimization suggestions
 *   3. Records   → existing on-chain attestation browser/submitter
 *
 * The Validate tab can hand its report straight to the Records submit flow
 * via "Pin & sign on-chain" — no copy/paste round-trip.
 */

import { Validator } from './validator.js';
import { ValidatorReport } from './components/validator-report.jsx';
import { InspectReport } from './components/inspect-report.jsx';
import { inspectModel, suggestOptimizations } from './gltf-inspect.js';
import { hashReport } from './erc8004/validation-recorder.js';

// Khronos-curated sample assets, served from jsdelivr (CORS-friendly CDN over
// the official KhronosGroup/glTF-Sample-Assets repo). All are GLB-Binary so
// textures and buffers are self-contained — no external resource resolution.
const SAMPLE_BASE =
	'https://cdn.jsdelivr.net/gh/KhronosGroup/glTF-Sample-Assets@main/Models';
const SAMPLES = [
	{ name: 'Box', file: `${SAMPLE_BASE}/Box/glTF-Binary/Box.glb` },
	{ name: 'Duck', file: `${SAMPLE_BASE}/Duck/glTF-Binary/Duck.glb` },
	{ name: 'BoomBox', file: `${SAMPLE_BASE}/BoomBox/glTF-Binary/BoomBox.glb` },
	{ name: 'DamagedHelmet', file: `${SAMPLE_BASE}/DamagedHelmet/glTF-Binary/DamagedHelmet.glb` },
	{ name: 'Avocado', file: `${SAMPLE_BASE}/Avocado/glTF-Binary/Avocado.glb` },
];

export class ValidationPage {
	constructor(els, dashboard) {
		this.els = els;
		this.dashboard = dashboard;
		this.activeTab = 'validate';
		this.currentBytes = null;
		this.currentName = null;
		this.currentReport = null;
		this.currentInspect = null;
		this.currentSuggestions = null;

		this._renderSamples();
		this._bindEvents();
		this._restoreFromHash();
	}

	// ── Tabs ────────────────────────────────────────────────────────────────

	switchTab(name) {
		this.activeTab = name;
		this.els.tabs.forEach((btn) => {
			btn.classList.toggle('active', btn.dataset.tab === name);
			btn.setAttribute('aria-selected', btn.dataset.tab === name ? 'true' : 'false');
		});
		this.els.panels.forEach((p) => {
			p.classList.toggle('active', p.dataset.tab === name);
		});
		const url = new URL(location.href);
		url.hash = name;
		history.replaceState(null, '', url);
	}

	_restoreFromHash() {
		const h = (location.hash || '').replace(/^#/, '');
		if (h === 'validate' || h === 'inspect' || h === 'records') {
			this.switchTab(h);
		}
	}

	// ── Input wiring ────────────────────────────────────────────────────────

	_bindEvents() {
		this.els.tabs.forEach((btn) => {
			btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
		});

		this.els.fileInput.addEventListener('change', (e) => {
			const f = e.target.files?.[0];
			if (f) this.loadFile(f);
		});

		this.els.dropZone.addEventListener('dragover', (e) => {
			e.preventDefault();
			this.els.dropZone.classList.add('drag');
		});
		this.els.dropZone.addEventListener('dragleave', () => {
			this.els.dropZone.classList.remove('drag');
		});
		this.els.dropZone.addEventListener('drop', (e) => {
			e.preventDefault();
			this.els.dropZone.classList.remove('drag');
			const f = e.dataTransfer?.files?.[0];
			if (f) this.loadFile(f);
		});

		this.els.urlBtn.addEventListener('click', () => {
			const url = this.els.urlInput.value.trim();
			if (url) this.loadUrl(url);
		});
		this.els.urlInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') this.els.urlBtn.click();
		});

		this.els.signBtn.addEventListener('click', () => this._handOffToDashboard());
	}

	_renderSamples() {
		this.els.samples.innerHTML = SAMPLES.map(
			(s) =>
				`<button class="sample-chip" data-url="${s.file}" data-name="${s.name}">${s.name}</button>`,
		).join('');
		this.els.samples.querySelectorAll('.sample-chip').forEach((btn) => {
			btn.addEventListener('click', () => {
				this.loadUrl(btn.dataset.url, btn.dataset.name);
			});
		});
	}

	// ── Load + run ──────────────────────────────────────────────────────────

	async loadFile(file) {
		this._setStatus(`Reading ${file.name} (${(file.size / 1024).toFixed(1)} KB)…`);
		try {
			const buffer = await file.arrayBuffer();
			await this._run(new Uint8Array(buffer), file.name);
		} catch (e) {
			this._setError(`Could not read file: ${e.message}`);
		}
	}

	async loadUrl(url, displayName) {
		const name = displayName || url.split('/').pop() || 'remote';
		this._setStatus(`Fetching ${name}…`);
		try {
			const res = await fetch(url);
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			const buffer = await res.arrayBuffer();
			await this._run(new Uint8Array(buffer), name);
		} catch (e) {
			this._setError(`Could not fetch ${name}: ${e.message}`);
		}
	}

	async _run(bytes, name) {
		this.currentBytes = bytes;
		this.currentName = name;
		this.currentReport = null;
		this.currentInspect = null;
		this.currentSuggestions = null;
		this.els.signBtn.disabled = true;

		this._setStatus(`Running validator + inspector on ${name}…`);
		this.els.validateOut.innerHTML = '<div class="loading">Validating…</div>';
		this.els.inspectOut.innerHTML = '<div class="loading">Inspecting…</div>';

		const validator = new Validator(null);
		const validatePromise = validator
			.validateBuffer(bytes)
			.then((report) => {
				this.currentReport = report;
				this._renderValidate(report);
			})
			.catch((e) => {
				this.els.validateOut.innerHTML = `<div class="err">Validator failed: ${escapeHtml(
					e.message,
				)}</div>`;
			});

		const inspectPromise = inspectModel(bytes, { fileSize: bytes.byteLength })
			.then((inspect) => {
				const suggestions = suggestOptimizations(inspect);
				this.currentInspect = inspect;
				this.currentSuggestions = suggestions;
				this._renderInspect(inspect, suggestions);
			})
			.catch((e) => {
				this.els.inspectOut.innerHTML = `<div class="err">Inspector failed: ${escapeHtml(
					e.message,
				)}</div>`;
			});

		await Promise.allSettled([validatePromise, inspectPromise]);
		this._setStatus(
			`Loaded ${name} · ${(bytes.byteLength / 1024).toFixed(1)} KB · validated`,
			true,
		);
		if (this.currentReport) this.els.signBtn.disabled = false;
	}

	_renderValidate(report) {
		const reportJSON = buildDownloadHref(report);
		this.els.validateOut.innerHTML = ValidatorReport({
			...report,
			location,
			reportJSON,
		});
	}

	_renderInspect(inspect, suggestions) {
		const reportJSON = buildDownloadHref({ inspect, suggestions });
		this.els.inspectOut.innerHTML = InspectReport({ inspect, suggestions, reportJSON });
	}

	// ── Status display ──────────────────────────────────────────────────────

	_setStatus(msg, ok = false) {
		this.els.statusEl.textContent = msg;
		this.els.statusEl.className = `status${ok ? ' ok' : ''}`;
	}

	_setError(msg) {
		this.els.statusEl.textContent = msg;
		this.els.statusEl.className = 'status err';
		this.els.validateOut.innerHTML = '';
		this.els.inspectOut.innerHTML = '';
	}

	// ── Bridge to on-chain submit ───────────────────────────────────────────

	_handOffToDashboard() {
		if (!this.currentReport) {
			this.dashboard.showToast('Run a validation first', true);
			return;
		}
		// Switch to the Records tab and pre-load the modal with the in-memory
		// report, skipping the JSON file picker entirely.
		this.switchTab('records');
		this.dashboard.openModal();
		const report = this.currentReport;
		const hash = hashReport(report);
		this.dashboard.currentReport = report;
		this.dashboard.currentReportHash = hash;
		this.dashboard.els.fileStatus.textContent = `✓ In-memory report from ${this.currentName}`;
		this.dashboard.els.fileStatus.style.color = '#76d776';
		this.dashboard.els.previewJson.textContent = JSON.stringify(report, null, 2);
		this.dashboard.els.previewSection.style.display = 'block';
		this.dashboard.els.previewError.style.display = 'none';
		this.dashboard.els.reportHash.value = hash;
		this.dashboard.els.hashSection.style.display = 'block';
		this.dashboard.els.submitReportBtn.disabled = false;
	}
}

function buildDownloadHref(payload) {
	try {
		const json = JSON.stringify(payload, null, 2);
		return 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
	} catch {
		return '';
	}
}

function escapeHtml(str) {
	return String(str).replace(/[&<>"']/g, (c) => ({
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#039;',
	})[c]);
}
