// Documents an agent learns from: the owner drops Word, PowerPoint, Excel, PDF
// or Outlook files here, workers/markitdown converts them, and the chunks feed
// the agent's chat answers (api/_lib/agent-knowledge.js). PDFs are read page
// by page instead (api/_lib/knowledge-pdf-jobs.js): the upload answers with a
// job, this panel steps it and shows "page X of N" plus each table as it is
// extracted. A job left running by a closed tab is picked up again on load
// (and by a cron on the server). This panel also lists sources with their
// chunk counts, previews the tables pulled out of a PDF, deletes sources, and
// lets the owner ask a test question to see which chunks the agent would use,
// and the real reply that cites them.
//
// Mounted by src/agent-edit.js into #knowledge-docs-host when the Knowledge
// tab opens. User guide: docs/agent-knowledge.md.

import { apiFetch, consumeCsrfToken } from './api.js';
import './agent-knowledge-docs.css';

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const KIND_LABEL = { docx: 'Word', pptx: 'PowerPoint', xlsx: 'Excel', pdf: 'PDF', msg: 'Outlook' };
// The worker reports how many slides, sheets or pages a file had.
const UNIT_KEY = { pptx: 'slides', xlsx: 'sheets', pdf: 'pages' };

function fmtBytes(n) {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
	const mb = n / (1024 * 1024);
	return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

function fmtDate(iso) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '';
	return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// The extractor's tables arrive as markdown (`| a | b |`, header first, `\|`
// for a literal pipe). Parse them back into rows for an HTML preview.
export function parseMarkdownTable(markdown) {
	const rows = [];
	for (const raw of String(markdown || '').split('\n')) {
		const line = raw.trim();
		if (!line.startsWith('|')) continue;
		if (/^\|(\s*:?-{3,}:?\s*\|)+$/.test(line)) continue;
		const cells = [];
		let cur = '';
		for (let i = 1; i < line.length; i++) {
			const ch = line[i];
			if (ch === '\\' && line[i + 1] === '|') {
				cur += '|';
				i++;
			} else if (ch === '|') {
				cells.push(cur.trim());
				cur = '';
			} else cur += ch;
		}
		if (cur.trim()) cells.push(cur.trim());
		rows.push(cells);
	}
	return rows;
}

function tableHtml(markdown) {
	const rows = parseMarkdownTable(markdown);
	if (!rows.length) return `<pre class="kd-tbl-raw">${esc(markdown)}</pre>`;
	const [head, ...body] = rows;
	return `<div class="kd-tbl-scroll" tabindex="0"><table class="kd-tbl">
		<thead><tr>${head.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead>
		<tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
	</table></div>`;
}

function errorText(body, status) {
	if (status === 429) {
		const wait = Number(body?.retry_after);
		return `Too many requests in a short time. Try again in ${wait > 0 ? `${wait} second${wait === 1 ? '' : 's'}` : 'a moment'}.`;
	}
	return body?.error_description || body?.error || `Request failed (HTTP ${status}).`;
}

/**
 * @param {HTMLElement} host
 * @param {{ agentId: string }} opts
 */
export function mountKnowledgeDocs(host, { agentId }) {
	const base = `/api/agents/${encodeURIComponent(agentId)}/knowledge`;
	const state = { docs: [], formats: [], limits: null, loaded: false, uploads: new Map(), seq: 0, openTables: new Set(), tableCache: new Map(), dismissedJobs: new Set() };

	host.innerHTML = `
		<div class="kd">
			<div class="kd-head">
				<div>
					<div class="kd-title">Documents</div>
					<p class="hint kd-sub">Files your agent reads and answers from, citing the document by name. Only the extracted text is kept; the original file is deleted as soon as it has been read.</p>
				</div>
				<span class="kd-count" data-kd="count" hidden></span>
			</div>

			<div class="kd-drop" data-kd="drop" tabindex="0" role="button" aria-describedby="kd-drop-help">
				<input type="file" data-kd="input" multiple hidden />
				<svg class="kd-drop-icon" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/></svg>
				<div class="kd-drop-main">Drop files here or <span class="kd-link">browse</span></div>
				<div class="kd-drop-help" id="kd-drop-help" data-kd="help">Word, PowerPoint, Excel, PDF and Outlook files</div>
			</div>

			<ul class="kd-uploads" data-kd="uploads" aria-live="polite"></ul>

			<div class="kd-list" data-kd="list" aria-busy="true">
				<div class="kd-skel"></div><div class="kd-skel"></div>
			</div>

			<form class="kd-test" data-kd="test" hidden>
				<label class="form-label" for="kd-q">Ask a question to test</label>
				<p class="hint">See which passages your agent pulls from these documents, then the answer it gives with them.</p>
				<div class="kd-test-row">
					<input class="form-input" id="kd-q" data-kd="q" type="text" maxlength="400" placeholder="What is the returns window?" autocomplete="off" />
					<button class="btn-primary" type="submit" data-kd="ask">Ask</button>
				</div>
				<div class="kd-test-out" data-kd="out" aria-live="polite"></div>
			</form>
		</div>`;

	const $ = (k) => host.querySelector(`[data-kd="${k}"]`);
	const drop = $('drop');
	const input = $('input');

	// ── Listing ───────────────────────────────────────────────────────────────

	async function load() {
		const list = $('list');
		try {
			const r = await apiFetch(base, { credentials: 'include' });
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(errorText(j, r.status));
			applyListing(j.data);
		} catch (err) {
			list.setAttribute('aria-busy', 'false');
			list.innerHTML = `
				<div class="kd-error" role="alert">
					<div><strong>Could not load documents.</strong> ${esc(err.message)}</div>
					<button class="btn-ghost" type="button" data-kd="retry">Try again</button>
				</div>`;
			list.querySelector('[data-kd="retry"]').addEventListener('click', () => {
				list.setAttribute('aria-busy', 'true');
				list.innerHTML = '<div class="kd-skel"></div><div class="kd-skel"></div>';
				load();
			});
		}
	}

	function applyListing(data) {
		if (Array.isArray(data?.jobs)) adoptJobs(data.jobs);
		state.docs = data?.docs || [];
		state.formats = data?.formats || state.formats;
		state.limits = data?.limits || state.limits;
		state.loaded = true;
		if (state.formats.length) {
			input.accept = state.formats.map((f) => f.extension).join(',');
			$('help').textContent = `${state.formats.map((f) => `${f.label} (${f.extension})`).join(', ')}. Up to ${fmtBytes(state.limits?.max_bytes || 0)} each.`;
		}
		render();
	}

	function render() {
		const list = $('list');
		list.setAttribute('aria-busy', 'false');
		const count = $('count');
		const max = state.limits?.max_docs;
		count.hidden = !state.docs.length;
		count.textContent = max ? `${state.docs.length} of ${max}` : String(state.docs.length);
		$('test').hidden = !state.docs.length;

		if (!state.docs.length) {
			const kinds = state.formats.length
				? state.formats
				: Object.entries(KIND_LABEL).map(([k, label]) => ({ extension: `.${k}`, label }));
			list.innerHTML = `
				<div class="kd-empty">
					<div class="kd-empty-title">No documents yet</div>
					<p>Upload the files you want this agent to know: a handbook, a price list, a pitch deck, a policy PDF, an email thread. It will answer from them and say which file it used.</p>
					<ul class="kd-formats">${kinds.map((f) => `<li><span class="kd-badge kd-${esc(f.extension.slice(1))}">${esc(f.extension)}</span>${esc(f.label)}</li>`).join('')}</ul>
				</div>`;
			return;
		}

		list.innerHTML = state.docs
			.map((d) => {
				const unitKey = UNIT_KEY[d.kind];
				const units = unitKey ? Number(d.meta?.[unitKey]) : 0;
				const unitText = units > 0 ? ` from ${units} ${units === 1 ? unitKey.slice(0, -1) : unitKey}` : '';
				const tables = d.meta?.extractor === 'nemotron' ? Number(d.meta?.tables) || 0 : 0;
				const charts = d.meta?.extractor === 'nemotron' ? Number(d.meta?.charts) || 0 : 0;
				const layoutText = d.meta?.extractor === 'nemotron'
					? ` · ${tables} ${tables === 1 ? 'table' : 'tables'}, ${charts} ${charts === 1 ? 'chart' : 'charts'}`
					: '';
				const open = state.openTables.has(d.id);
				return `
				<div class="kd-doc-wrap" data-id="${esc(d.id)}">
					<div class="kd-doc">
						<span class="kd-badge kd-${esc(d.kind)}" title="${esc(KIND_LABEL[d.kind] || d.kind)}">${esc(d.kind)}</span>
						<div class="kd-doc-body">
							<div class="kd-doc-name" title="${esc(d.name)}">${esc(d.name)}</div>
							<div class="kd-doc-meta">${d.chunk_count} ${d.chunk_count === 1 ? 'chunk' : 'chunks'}${esc(unitText)}${esc(layoutText)} · ${esc(fmtBytes(d.byte_size))} · ${esc(fmtDate(d.created_at))}</div>
							${d.meta?.fallback_reason ? `<div class="kd-doc-note" title="${esc(d.meta.fallback_reason)}">Read as plain text: the page reader was unavailable for this file.</div>` : ''}
						</div>
						${tables ? `<button class="btn-ghost kd-tables-btn" type="button" data-tables="${esc(d.id)}" aria-expanded="${open}" aria-controls="kd-t-${esc(d.id)}">${open ? 'Hide tables' : 'View tables'}</button>` : ''}
						<button class="btn-ghost danger kd-del" type="button" data-del="${esc(d.id)}" aria-label="Delete ${esc(d.name)}">Delete</button>
					</div>
					<div class="kd-tables" id="kd-t-${esc(d.id)}" data-tables-panel="${esc(d.id)}" ${open ? '' : 'hidden'}></div>
				</div>`;
			})
			.join('');
		list.querySelectorAll('[data-del]').forEach((btn) => btn.addEventListener('click', () => confirmDelete(btn)));
		list.querySelectorAll('[data-tables]').forEach((btn) => btn.addEventListener('click', () => toggleTables(btn)));
		for (const id of state.openTables) loadTables(id);
	}

	// ── Extracted tables (PDF) ────────────────────────────────────────────────

	function toggleTables(btn) {
		const id = btn.dataset.tables;
		const panel = host.querySelector(`[data-tables-panel="${CSS.escape(id)}"]`);
		if (!panel) return;
		const open = !state.openTables.has(id);
		if (open) state.openTables.add(id);
		else state.openTables.delete(id);
		btn.setAttribute('aria-expanded', String(open));
		btn.textContent = open ? 'Hide tables' : 'View tables';
		panel.hidden = !open;
		if (open) loadTables(id);
	}

	// A document's chunks never change after indexing, so one fetch per doc.
	async function loadTables(id) {
		const panel = host.querySelector(`[data-tables-panel="${CSS.escape(id)}"]`);
		if (!panel) return;
		panel.setAttribute('aria-busy', 'true');
		if (!state.tableCache.has(id)) panel.innerHTML = '<div class="kd-skel"></div><div class="kd-skel short"></div>';
		try {
			let tables = state.tableCache.get(id);
			if (!tables) {
				const r = await apiFetch(`${base}/${encodeURIComponent(id)}/tables`, { credentials: 'include' });
				const j = await r.json().catch(() => ({}));
				if (!r.ok) throw new Error(errorText(j, r.status));
				tables = j.data?.tables || [];
				state.tableCache.set(id, tables);
			}
			panel.innerHTML = tables.length
				? tables
					.map(
						(t) => `
					<figure class="kd-tbl-fig">
						<figcaption><span class="kd-page">p.${esc(t.page ?? '?')}</span> ${esc(captionOf(t))}${t.parts > 1 ? ` <span class="kd-part">part ${esc(t.part)} of ${esc(t.parts)}</span>` : ''}</figcaption>
						${tableHtml(t.content)}
					</figure>`,
					)
					.join('')
				: '<div class="kd-empty kd-empty-sm">No tables were found in this document. Its text and charts are still indexed.</div>';
		} catch (err) {
			panel.innerHTML = `<div class="kd-error" role="alert"><div><strong>Could not load the tables.</strong> ${esc(err.message)}</div><button class="btn-ghost" type="button" data-retry-tables>Try again</button></div>`;
			panel.querySelector('[data-retry-tables]').addEventListener('click', () => loadTables(id));
		} finally {
			panel.setAttribute('aria-busy', 'false');
		}
	}

	// A table chunk is "<caption>\n\n| ... |"; the heading is "Page N · caption".
	function captionOf(t) {
		const h = String(t.heading || '').replace(/^Page \d+\s*·\s*/, '');
		return h || 'Table';
	}

	// Two-step delete: the first click arms the button, the second removes the
	// document and every chunk it produced.
	function confirmDelete(btn) {
		if (btn.dataset.armed !== '1') {
			btn.dataset.armed = '1';
			btn.textContent = 'Confirm delete';
			btn.classList.add('armed');
			setTimeout(() => {
				if (!btn.isConnected || btn.disabled) return;
				btn.dataset.armed = '';
				btn.textContent = 'Delete';
				btn.classList.remove('armed');
			}, 4000);
			return;
		}
		deleteDoc(btn);
	}

	async function deleteDoc(btn) {
		const id = btn.dataset.del;
		btn.disabled = true;
		btn.textContent = 'Deleting…';
		try {
			const r = await apiFetch(`${base}/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' });
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(errorText(j, r.status));
			applyListing(j.data);
		} catch (err) {
			btn.disabled = false;
			btn.dataset.armed = '';
			btn.classList.remove('armed');
			btn.textContent = 'Delete';
			const row = btn.closest('.kd-doc');
			row?.querySelector('.kd-doc-err')?.remove();
			row?.querySelector('.kd-doc-body')?.insertAdjacentHTML('beforeend', `<div class="kd-doc-err" role="alert">Delete failed: ${esc(err.message)}</div>`);
		}
	}

	// ── Uploading ─────────────────────────────────────────────────────────────

	function formatFor(name) {
		const lower = name.toLowerCase();
		return state.formats.find((f) => lower.endsWith(f.extension)) || null;
	}

	function addFiles(fileList) {
		for (const file of Array.from(fileList || [])) enqueue(file);
		input.value = '';
	}

	function enqueue(file) {
		const id = `u${++state.seq}`;
		const item = { id, file, status: 'queued', pct: 0, message: '' };
		state.uploads.set(id, item);
		const fmt = formatFor(file.name);
		const max = state.limits?.max_bytes || Infinity;
		if (state.formats.length && !fmt) {
			finish(item, 'error', `Not a supported file type. Use ${state.formats.map((f) => f.extension).join(', ')}.`);
			return;
		}
		if (file.size > max) {
			finish(item, 'error', `This file is ${fmtBytes(file.size)}; the limit is ${fmtBytes(max)}.`);
			return;
		}
		if (!file.size) {
			finish(item, 'error', 'The file is empty.');
			return;
		}
		renderUpload(item);
		upload(item, fmt);
	}

	async function upload(item, fmt) {
		item.status = 'uploading';
		renderUpload(item);
		let token = null;
		try {
			token = await consumeCsrfToken();
		} catch {
			token = null;
		}
		const xhr = new XMLHttpRequest();
		xhr.open('POST', base);
		xhr.withCredentials = true;
		xhr.responseType = 'json';
		// The real MIME type matters: the server reads raw Office/PDF bodies
		// itself, under its own size limit.
		xhr.setRequestHeader('Content-Type', fmt?.mime || item.file.type || 'application/octet-stream');
		xhr.setRequestHeader('X-File-Name', encodeURIComponent(item.file.name));
		if (token) xhr.setRequestHeader('x-csrf-token', token);
		xhr.upload.onprogress = (e) => {
			if (!e.lengthComputable) return;
			item.pct = Math.round((e.loaded / e.total) * 100);
			renderUpload(item);
		};
		// Every byte is on the server: what remains is conversion, chunking and
		// embedding, which report no progress of their own.
		xhr.upload.onload = () => {
			item.status = 'processing';
			item.pct = 100;
			renderUpload(item);
		};
		xhr.onerror = () => finish(item, 'error', 'The upload was interrupted. Check your connection and try again.');
		xhr.onload = () => {
			const body = xhr.response || {};
			if (body.data?.job) {
				attachJob(item, body.data.job);
				return;
			}
			if (xhr.status === 200 || xhr.status === 201) {
				const doc = body.data?.doc;
				finish(
					item,
					'done',
					body.data?.duplicate
						? 'Already in this agent\'s knowledge.'
						: `${doc?.chunk_count ?? 0} ${doc?.chunk_count === 1 ? 'chunk' : 'chunks'} indexed.`,
				);
				load();
				return;
			}
			if (xhr.status === 401) {
				finish(item, 'error', 'Your session expired. Sign in again, then retry.');
				return;
			}
			finish(item, 'error', errorText(body, xhr.status));
		};
		xhr.send(item.file);
	}

	// ── PDF jobs ──────────────────────────────────────────────────────────────

	// Jobs from the listing: resume the ones still running (a reload or a second
	// tab), and show today's failures so the owner learns what went wrong.
	function adoptJobs(jobs) {
		const tracked = new Set([...state.uploads.values()].map((u) => u.job?.id).filter(Boolean));
		for (const job of jobs) {
			if (tracked.has(job.id) || state.dismissedJobs.has(job.id)) continue;
			const item = { id: `u${++state.seq}`, name: job.name, status: 'queued', pct: 0, message: '' };
			state.uploads.set(item.id, item);
			attachJob(item, job);
		}
	}

	function attachJob(item, job) {
		item.job = job;
		applyJob(item, job);
		if (item.status === 'reading' && !item.stepping) runJob(item);
	}

	function applyJob(item, job) {
		item.job = job;
		item.pct = job.page_count ? Math.round((job.pages_done / job.page_count) * 100) : 0;
		if (job.status === 'done') {
			const doc = job.doc;
			const parts = [`${doc?.chunk_count ?? 0} ${doc?.chunk_count === 1 ? 'chunk' : 'chunks'} indexed from ${job.page_count} ${job.page_count === 1 ? 'page' : 'pages'}`];
			if (job.extractor === 'nemotron') {
				const t = Number(job.stats?.tables) || 0;
				const c = Number(job.stats?.charts) || 0;
				parts.push(`${t} ${t === 1 ? 'table' : 'tables'}, ${c} ${c === 1 ? 'chart' : 'charts'}`);
			} else if (job.fallback_reason) parts.push('read as plain text');
			finish(item, 'done', `${parts.join(', ')}.`);
			load();
			return;
		}
		if (job.status === 'failed') {
			finish(item, 'error', job.error?.message || 'Reading the PDF failed.');
			return;
		}
		item.status = 'reading';
		renderUpload(item);
	}

	// Step the job until it settles. Each call reads pages for ~20 s on the
	// server. When another stepper holds the job (the cron, another tab) the
	// call returns at once with unchanged progress, so wait before asking again.
	async function runJob(item) {
		item.stepping = true;
		let failures = 0;
		while (item.status === 'reading' && host.isConnected) {
			const before = item.job.pages_done;
			try {
				const r = await apiFetch(`${base}/jobs/${encodeURIComponent(item.job.id)}/step`, {
					method: 'POST',
					credentials: 'include',
					timeoutMs: 150_000,
				});
				const j = await r.json().catch(() => ({}));
				if (r.status === 401) {
					item.paused = 'Your session expired. The file keeps processing on the server; sign in again to see it finish.';
					renderUpload(item);
					break;
				}
				if (!r.ok) throw new Error(errorText(j, r.status));
				failures = 0;
				item.paused = null;
				applyJob(item, j.data.job);
				if (item.status === 'reading' && item.job.pages_done === before) await pause(3000);
			} catch (err) {
				failures++;
				item.paused = `Connection trouble (${err.message}). Retrying; the server keeps reading the file meanwhile.`;
				renderUpload(item);
				await pause(Math.min(30_000, 2000 * 2 ** failures));
			}
		}
		item.stepping = false;
	}

	function pause(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	function finish(item, status, message) {
		item.status = status;
		item.message = message;
		renderUpload(item);
		if (status === 'done' && !item.job?.tables?.length) {
			setTimeout(() => {
				state.uploads.delete(item.id);
				host.querySelector(`[data-up="${item.id}"]`)?.remove();
			}, 5000);
		}
	}

	function renderUpload(item) {
		const ul = $('uploads');
		let li = ul.querySelector(`[data-up="${item.id}"]`);
		if (!li) {
			li = document.createElement('li');
			li.className = 'kd-up';
			li.dataset.up = item.id;
			ul.prepend(li);
		}
		li.dataset.status = item.status;
		const name = item.file?.name || item.name || 'Document';
		const job = item.job;
		const readingText = !job
			? 'Reading…'
			: job.status === 'indexing'
				? `Indexing ${job.page_count} ${job.page_count === 1 ? 'page' : 'pages'}…`
				: job.pages_done
					? `Read page ${job.pages_done} of ${job.page_count}`
					: `Reading page 1 of ${job.page_count}…`;
		const statusText = {
			queued: 'Waiting…',
			uploading: `Uploading ${item.pct}%`,
			processing: 'Reading and indexing…',
			reading: readingText,
			done: item.message,
			error: item.message,
		}[item.status];
		// Indeterminate while there is no page count to measure against: the
		// server-side conversion, and a PDF job's final indexing pass.
		const indeterminate = item.status === 'processing' || (item.status === 'reading' && job?.status === 'indexing');
		const tables = job?.tables || [];
		const showTables = tables.length && item.status !== 'error';
		li.innerHTML = `
			<div class="kd-up-top">
				<span class="kd-up-name" title="${esc(name)}">${esc(name)}</span>
				<span class="kd-up-status">${esc(statusText)}</span>
				${item.status === 'error' || (item.status === 'done' && tables.length) ? '<button class="kd-up-x" type="button" aria-label="Dismiss">×</button>' : ''}
			</div>
			<div class="kd-bar${indeterminate ? ' indeterminate' : ''}" role="progressbar" aria-label="${esc(name)}" aria-valuemin="0" aria-valuemax="100" ${indeterminate ? '' : `aria-valuenow="${item.pct}"`}><span style="width:${item.status === 'error' ? 100 : item.pct}%"></span></div>
			${item.paused && item.status === 'reading' ? `<div class="kd-up-note" role="status">${esc(item.paused)}</div>` : ''}
			${showTables
				? `<button class="kd-up-tables" type="button" data-preview-toggle aria-expanded="${!!item.previewOpen}">${tables.length} ${tables.length === 1 ? 'table' : 'tables'} found${item.status === 'reading' ? ' so far' : ''} · ${item.previewOpen ? 'hide' : 'preview'}</button>
				${item.previewOpen
					? `<div class="kd-up-preview">${tables
						.map(
							(t) => `<figure class="kd-tbl-fig"><figcaption><span class="kd-page">p.${esc(t.page)}</span> ${esc(t.caption || 'Table')}</figcaption>${tableHtml(t.markdown)}${t.truncated ? '<div class="kd-up-note">Preview shortened; the whole table is indexed.</div>' : ''}</figure>`,
						)
						.join('')}</div>`
					: ''}`
				: ''}`;
		li.querySelector('.kd-up-x')?.addEventListener('click', () => {
			state.uploads.delete(item.id);
			if (item.job) state.dismissedJobs.add(item.job.id);
			li.remove();
		});
		li.querySelector('[data-preview-toggle]')?.addEventListener('click', (e) => {
			item.previewOpen = !item.previewOpen;
			e.currentTarget.setAttribute('aria-expanded', String(item.previewOpen));
			renderUpload(item);
		});
	}

	drop.addEventListener('click', () => input.click());
	drop.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			input.click();
		}
	});
	input.addEventListener('change', () => addFiles(input.files));
	drop.addEventListener('dragover', (e) => {
		e.preventDefault();
		drop.classList.add('over');
	});
	drop.addEventListener('dragleave', (e) => {
		if (!drop.contains(e.relatedTarget)) drop.classList.remove('over');
	});
	drop.addEventListener('drop', (e) => {
		e.preventDefault();
		drop.classList.remove('over');
		addFiles(e.dataTransfer?.files);
	});

	// ── Test question ─────────────────────────────────────────────────────────

	let askController = null;

	$('test').addEventListener('submit', async (e) => {
		e.preventDefault();
		const q = $('q').value.trim();
		const out = $('out');
		if (q.length < 2) {
			out.innerHTML = '<div class="kd-doc-err">Type a question first.</div>';
			return;
		}
		askController?.abort();
		askController = new AbortController();
		const signal = askController.signal;
		const ask = $('ask');
		ask.disabled = true;
		out.innerHTML = '<div class="kd-skel"></div><div class="kd-skel short"></div>';
		try {
			const r = await apiFetch(`${base}/search`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ query: q, top_k: 5 }),
				signal,
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(errorText(j, r.status));
			renderMatches(out, j.data);
			await streamAnswer(out, q, signal);
		} catch (err) {
			if (signal.aborted) return;
			out.innerHTML = `<div class="kd-error" role="alert"><div><strong>Could not run the test.</strong> ${esc(err.message)}</div></div>`;
		} finally {
			if (!signal.aborted) ask.disabled = false;
		}
	});

	function renderMatches(out, data) {
		const results = data?.results || [];
		if (data?.needs_reembed) {
			out.innerHTML = '<div class="kd-error" role="alert"><div>These documents were indexed with an embedding model this server no longer runs. Delete and upload them again to search them.</div></div>';
			return;
		}
		if (!results.length) {
			out.innerHTML = '<div class="kd-empty kd-empty-sm">No passage in your documents matches this question. The agent will answer without them.</div>';
			return;
		}
		out.innerHTML = `
			<div class="kd-out-label">Passages used (${results.length} of ${data.chunks_searched} searched${data.reranked ? ', reranked' : ''})</div>
			<ol class="kd-matches">${results
				.map(
					(m) => `
				<li class="kd-match">
					<div class="kd-match-top">
						<span class="kd-match-src">${esc(m.name)}${m.heading ? ` <span class="kd-match-h">› ${esc(m.heading)}</span>` : ''}</span>
						<span class="kd-score" title="Relevance">${Math.round(m.score * 100)}%</span>
					</div>
					<div class="kd-match-text">${esc(m.excerpt)}</div>
				</li>`,
				)
				.join('')}</ol>
			<div class="kd-out-label">Agent answer</div>
			<div class="kd-answer" data-kd="answer"><span class="kd-typing" aria-label="Agent is answering"><i></i><i></i><i></i></span></div>`;
	}

	// The real chat endpoint, so the answer below is exactly what a visitor
	// would get, grounded in the same retrieval and citing its sources.
	async function streamAnswer(out, message, signal) {
		const answer = out.querySelector('[data-kd="answer"]');
		if (!answer) return;
		const res = await apiFetch('/api/chat', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({ agentId, message, history: [] }),
			signal,
			timeoutMs: 0,
		});
		if (!res.ok || !res.body) {
			const j = await res.json().catch(() => ({}));
			answer.innerHTML = `<span class="kd-doc-err">The agent could not answer: ${esc(errorText(j, res.status))}</span>`;
			return;
		}
		const reader = res.body.getReader();
		const decoder = new TextDecoder();
		let buf = '';
		let text = '';
		let cited = null;
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			buf += decoder.decode(value, { stream: true });
			const lines = buf.split('\n');
			buf = lines.pop();
			for (const line of lines) {
				if (!line.startsWith('data: ')) continue;
				let evt;
				try {
					evt = JSON.parse(line.slice(6));
				} catch {
					continue;
				}
				if (evt.type === 'chunk' && evt.text) {
					text += evt.text;
					answer.textContent = text;
				} else if (evt.type === 'done') {
					cited = evt.knowledge || [];
				} else if (evt.type === 'error') {
					answer.innerHTML = `<span class="kd-doc-err">${esc(evt.message || evt.error || 'The agent hit an error.')}</span>`;
					return;
				}
			}
		}
		if (!text) answer.textContent = 'The agent returned an empty reply.';
		if (cited?.length) {
			const names = [...new Set(cited.map((c) => c.name))];
			answer.insertAdjacentHTML('afterend', `<div class="kd-cited">Grounded in ${names.map((n) => `<span>${esc(n)}</span>`).join(' ')}</div>`);
		}
	}

	load();
}
