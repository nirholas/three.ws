// Brain Ownership — the surface where a user truly owns their agent's mind.
//
// Renders a human-readable "brain passport": authorship verification at a
// glance, storage mode, IPFS pin status + CIDs, on-chain anchor with a real
// explorer link, and export/import of a portable, signed `.brain` bundle.
//
// Everything here is wired to the real endpoints under /api/agents/:id/brain
// (see api/agents/_id/brain.js). The encrypt-to-owner flow derives an AES-GCM
// key from the owner's wallet signature (src/memory/crypto.js → the same
// primitive the encrypted-ipfs memory mode uses) entirely client-side, pins the
// ciphertext via /memory/pin, and records the CID — the platform never sees the
// plaintext or the key.
//
// Mounted lazily by the agent editor's "Ownership" tab; emits on the shared
// agent bus so the rest of the platform can react (e.g. a HUD chip on anchor).

import { apiFetch } from './api.js';
import { agentBus } from './agents/agent-bus.js';
import { shortAddress } from './shared/address.js';

const API = '/api';

function escapeHtml(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

function shortHash(h, n = 8) {
	if (!h) return '—';
	return h.length > n * 2 + 1 ? `${h.slice(0, n)}…${h.slice(-n)}` : h;
}

function shortAddr(a) { return shortAddress(a, 6, 4, { empty: '\u2014' }); }

function fmtBytes(n) {
	if (!n) return '0 B';
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtDate(v) {
	if (!v) return '—';
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

const STORAGE_LABELS = {
	local: 'Local only — stays in your browser + our DB, never pinned',
	ipfs: 'IPFS — pinned publicly, content-addressed, anyone can fetch',
	'encrypted-ipfs': 'Encrypted IPFS — pinned but encrypted to your wallet; we can’t read it',
	none: 'None — ephemeral, nothing persisted off-session',
};

/**
 * Mount the Brain Ownership surface into a container.
 * @param {HTMLElement} host
 * @param {{ agentId: string, agent?: object }} opts
 */
export async function mountBrainOwnership(host, { agentId, agent } = {}) {
	if (!host || !agentId) return;
	host.innerHTML = skeleton();

	let passport;
	try {
		passport = await fetchPassport(agentId);
	} catch (err) {
		host.innerHTML = errorState(err.message, () => mountBrainOwnership(host, { agentId, agent }));
		wireRetry(host, () => mountBrainOwnership(host, { agentId, agent }));
		return;
	}

	render(host, agentId, passport, agent);
}

async function fetchPassport(agentId) {
	const r = await apiFetch(`${API}/agents/${agentId}/brain`, { credentials: 'include' });
	if (!r.ok) {
		const j = await r.json().catch(() => ({}));
		throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
	}
	return r.json();
}

// ── Rendering ──────────────────────────────────────────────────────────────

function render(host, agentId, p, agent) {
	const m = p.memories || {};
	const verifyPct = m.signed ? Math.round((m.verified / m.signed) * 100) : 0;
	const allVerified = m.signed > 0 && m.verified === m.signed;
	const integrity =
		m.total === 0
			? { cls: 'empty', label: 'No memories yet' }
			: allVerified
				? { cls: 'ok', label: 'Authorship verified' }
				: m.signed === 0
					? { cls: 'warn', label: 'Unsigned (no agent wallet)' }
					: { cls: 'warn', label: `${m.verified}/${m.signed} verified` };

	const anchored = Boolean(p.anchor && p.anchor.status === 'anchored');
	const anchorDrift = anchored && !p.anchor_in_sync;

	host.innerHTML = `
		<div class="brain-own">
			<header class="brain-own__hero">
				<div class="brain-own__hero-main">
					<div class="bo-passport-badge bo-passport-badge--${integrity.cls}" role="img"
						 aria-label="Brain integrity: ${escapeHtml(integrity.label)}">
						${integrity.cls === 'ok' ? '✓' : integrity.cls === 'warn' ? '!' : '○'}
					</div>
					<div>
						<h3 class="bo-title">Brain passport</h3>
						<p class="bo-sub">${escapeHtml(integrity.label)} · ${m.total || 0} ${
							m.total === 1 ? 'memory' : 'memories'
						}</p>
					</div>
				</div>
				<div class="bo-fingerprint" title="Content-addressed hash of this agent's curated mind">
					<span class="bo-fingerprint__label">brain hash</span>
					<code>${escapeHtml(shortHash(p.current_brain_hash))}</code>
					<button class="bo-copy" data-copy="${escapeHtml(p.current_brain_hash || '')}"
							aria-label="Copy full brain hash" title="Copy full hash">⧉</button>
				</div>
			</header>

			<div class="bo-stats" role="list">
				${stat('Signed', `${m.signed || 0}/${m.total || 0}`, 'Memories authored by the agent wallet')}
				${stat('Verified', m.signed ? `${verifyPct}%` : '—', 'Signatures that re-verify right now')}
				${stat('Public', `${m.public || 0}`, 'Shareable in an exported brain')}
				${stat('Encrypted pins', `${m.encrypted_pinned || 0}`, 'Private memories pinned encrypted to your wallet')}
			</div>

			${section(
				'Storage',
				`
				<p class="bo-hint">How this agent's new memories are stored by default. Encrypted-IPFS encrypts to your wallet — we can't read it; you can move it.</p>
				<div class="bo-field">
					<label class="bo-field__label" for="bo-storage-mode">Default storage mode</label>
					<select class="bo-select" id="bo-storage-mode" aria-describedby="bo-storage-desc">
						${Object.keys(STORAGE_LABELS)
							.map(
								(mode) =>
									`<option value="${mode}" ${p.storage_mode === mode ? 'selected' : ''}>${
										mode === 'encrypted-ipfs' ? 'Encrypted IPFS' : mode[0].toUpperCase() + mode.slice(1)
									}</option>`,
							)
							.join('')}
					</select>
				</div>
				<p class="bo-storage-desc" id="bo-storage-desc">${escapeHtml(STORAGE_LABELS[p.storage_mode] || '')}</p>
				<span class="bo-status" id="bo-storage-status" role="status" aria-live="polite"></span>
			`,
			)}

			${section(
				'On-chain anchor',
				anchorSection(p),
			)}

			${section('IPFS pins', pinsSection(p.pins || []))}

			${section(
				'Provenance',
				p.provenance
					? `<div class="bo-prov">
							<p>Forked from <strong>${escapeHtml(p.provenance.source_agent_name || p.provenance.source_agent_id)}</strong></p>
							<p class="bo-hint">Imported ${p.provenance.imported_count ?? '?'} ${
								p.provenance.imported_count === 1 ? 'memory' : 'memories'
							} · ${escapeHtml(fmtDate(p.provenance.imported_at))} · brain hash <code>${escapeHtml(
								shortHash(p.provenance.source_brain_hash),
							)}</code></p>
						</div>`
					: `<p class="bo-hint">This mind is original — not imported from another agent.</p>`,
			)}

			${section(
				'Export / Import',
				`
				<p class="bo-hint">A <code>.brain</code> file is a schema-versioned, signed snapshot of this mind. Public memories travel in the clear; private ones stay encrypted. Back it up, move it, or fork it.</p>
				<div class="bo-actions">
					<button class="bo-btn bo-btn--primary" id="bo-export" type="button">Export brain (public)</button>
					<button class="bo-btn" id="bo-export-private" type="button">Export with private data…</button>
					<label class="bo-btn bo-btn--ghost" for="bo-import-file" tabindex="0" role="button">Import a .brain…</label>
					<input type="file" id="bo-import-file" accept=".brain,.json,application/json" hidden />
				</div>
				<span class="bo-status" id="bo-export-status" role="status" aria-live="polite"></span>
			`,
			)}
		</div>
	`;

	wireCopy(host);
	wireStorage(host, agentId, p);
	wireAnchor(host, agentId);
	wireExportImport(host, agentId, agent);
}

function stat(label, value, title) {
	return `<div class="bo-stat" role="listitem" title="${escapeHtml(title)}">
		<span class="bo-stat__value">${escapeHtml(String(value))}</span>
		<span class="bo-stat__label">${escapeHtml(label)}</span>
	</div>`;
}

function section(title, inner) {
	return `<section class="bo-section">
		<h4 class="bo-section__title">${escapeHtml(title)}</h4>
		${inner}
	</section>`;
}

function anchorSection(p) {
	const a = p.anchor;
	if (!p.agent?.registered_onchain) {
		return `<p class="bo-hint">Anchoring records a tamper-proof fingerprint of this brain on the ERC-8004 registry.
			Register this agent on-chain first to enable it.</p>
			<button class="bo-btn" id="bo-anchor" type="button" disabled aria-disabled="true">Anchor on-chain</button>`;
	}
	if (a && a.status === 'anchored') {
		const drift = !p.anchor_in_sync;
		return `
			<div class="bo-anchor ${drift ? 'bo-anchor--drift' : 'bo-anchor--synced'}">
				<div class="bo-anchor__row">
					<span class="bo-chip ${drift ? 'bo-chip--warn' : 'bo-chip--ok'}">
						${drift ? 'Brain changed since last anchor' : 'On-chain & in sync'}
					</span>
					${a.explorer_url ? `<a class="bo-link" href="${escapeHtml(a.explorer_url)}" target="_blank" rel="noopener">View transaction ↗</a>` : ''}
				</div>
				<dl class="bo-kv">
					<dt>Anchored hash</dt><dd><code>${escapeHtml(shortHash(a.brain_hash))}</code></dd>
					<dt>When</dt><dd>${escapeHtml(fmtDate(a.anchored_at))}</dd>
					${a.proof_uri ? `<dt>Passport</dt><dd><a class="bo-link" href="${escapeHtml(a.proof_uri)}" target="_blank" rel="noopener">proof ↗</a></dd>` : ''}
				</dl>
				${drift ? '<button class="bo-btn bo-btn--primary" id="bo-anchor" type="button">Re-anchor current brain</button>' : ''}
			</div>`;
	}
	return `<p class="bo-hint">Record a tamper-proof fingerprint of this brain on the ERC-8004 registry — verifiable proof of what your agent knew and when.</p>
		<button class="bo-btn bo-btn--primary" id="bo-anchor" type="button">Anchor on-chain</button>
		<span class="bo-status" id="bo-anchor-status" role="status" aria-live="polite"></span>`;
}

function pinsSection(pins) {
	if (!pins.length) {
		return `<p class="bo-hint">No memories are pinned to IPFS yet. Set storage to IPFS or Encrypted IPFS, then encrypt &amp; pin a memory to make it portable.</p>`;
	}
	return `<ul class="bo-pins">
		${pins
			.slice(0, 50)
			.map(
				(pin) => `<li class="bo-pin">
				<a class="bo-pin__cid bo-link" href="${escapeHtml(pin.gateway_url)}" target="_blank" rel="noopener" title="${escapeHtml(pin.cid)}">
					${escapeHtml(pin.filename)} <code>${escapeHtml(shortHash(pin.cid, 6))}</code> ↗
				</a>
				<span class="bo-pin__meta">${escapeHtml(fmtBytes(pin.bytes))} · ${escapeHtml(fmtDate(pin.created_at))}</span>
			</li>`,
			)
			.join('')}
	</ul>`;
}

// ── Wiring ───────────────────────────────────────────────────────────────────

function wireCopy(host) {
	host.querySelectorAll('.bo-copy').forEach((btn) => {
		btn.addEventListener('click', async () => {
			const val = btn.dataset.copy;
			if (!val) return;
			try {
				await navigator.clipboard.writeText(val);
				const prev = btn.textContent;
				btn.textContent = '✓';
				setTimeout(() => (btn.textContent = prev), 1200);
			} catch {
				/* clipboard unavailable — non-fatal */
			}
		});
	});
}

function wireStorage(host, agentId, p) {
	const sel = host.querySelector('#bo-storage-mode');
	const desc = host.querySelector('#bo-storage-desc');
	const status = host.querySelector('#bo-storage-status');
	if (!sel) return;
	sel.addEventListener('change', async () => {
		const mode = sel.value;
		if (desc) desc.textContent = STORAGE_LABELS[mode] || '';
		setStatus(status, 'Saving…', '');
		try {
			const r = await apiFetch(`${API}/agents/${agentId}/brain/storage`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ defaultMode: mode }),
			});
			if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error_description || `HTTP ${r.status}`);
			setStatus(status, 'Saved', 'ok');
			agentBus.emit('brain:updated', { agentId, storageMode: mode, ts: Date.now() });
		} catch (err) {
			sel.value = p.storage_mode;
			if (desc) desc.textContent = STORAGE_LABELS[p.storage_mode] || '';
			setStatus(status, `Could not save: ${err.message}`, 'err');
		}
	});
}

function wireAnchor(host, agentId) {
	const btn = host.querySelector('#bo-anchor');
	if (!btn || btn.disabled) return;
	btn.addEventListener('click', async () => {
		const status = host.querySelector('#bo-anchor-status');
		const confirmed = window.confirm(
			'Anchor this brain on-chain?\n\nThis writes a tamper-proof fingerprint of the current memory set to the ERC-8004 registry. It costs a small amount of gas and is permanent.',
		);
		if (!confirmed) return;
		btn.disabled = true;
		const orig = btn.textContent;
		btn.textContent = 'Anchoring…';
		setStatus(status, 'Submitting transaction… this can take a moment.', '');
		try {
			const r = await apiFetch(`${API}/agents/${agentId}/brain/anchor`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({}),
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
			agentBus.emit('brain:updated', { agentId, anchored: true, txHash: j.tx_hash, ts: Date.now() });
			// Re-render with the fresh anchor state.
			const fresh = await fetchPassport(agentId);
			render(host, agentId, fresh);
		} catch (err) {
			btn.disabled = false;
			btn.textContent = orig;
			setStatus(status, anchorError(err.message), 'err');
		}
	});
}

// Map the backend's machine-readable anchor error codes to actionable copy.
function anchorError(msg) {
	if (/not_registered/i.test(msg)) return 'Register this agent on-chain first, then anchor.';
	if (/validator_key_not_configured|registry_not_deployed/i.test(msg))
		return 'On-chain anchoring is not available on this deployment yet.';
	if (/validator_not_allowlisted/i.test(msg)) return 'The platform validator is not yet allow-listed on this chain.';
	return `Could not anchor: ${msg}`;
}

function wireExportImport(host, agentId, agent) {
	const status = host.querySelector('#bo-export-status');

	const doExport = async (includePrivate) => {
		setStatus(status, 'Building bundle…', '');
		try {
			const url = `${API}/agents/${agentId}/brain/export${includePrivate ? '?includePrivate=true' : ''}`;
			const r = await apiFetch(url, { credentials: 'include' });
			if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error_description || `HTTP ${r.status}`);
			const bundle = await r.json();
			downloadJson(bundle, `${(agent?.name || 'agent').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.brain.json`);
			setStatus(
				status,
				`Exported ${bundle.manifest?.memory_count ?? 0} memories${
					bundle.signature ? ' (signed)' : ''
				}.`,
				'ok',
			);
		} catch (err) {
			setStatus(status, `Export failed: ${err.message}`, 'err');
		}
	};

	host.querySelector('#bo-export')?.addEventListener('click', () => doExport(false));
	host.querySelector('#bo-export-private')?.addEventListener('click', () => {
		const ok = window.confirm(
			'Export WITH private data?\n\nThis includes the plaintext of your agent\'s private memories in the downloaded file. Anyone who opens the file can read them. Keep it safe.',
		);
		if (ok) doExport(true);
	});

	const fileInput = host.querySelector('#bo-import-file');
	const fileLabel = host.querySelector('label[for="bo-import-file"]');
	fileLabel?.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			fileInput?.click();
		}
	});
	fileInput?.addEventListener('change', async () => {
		const file = fileInput.files?.[0];
		if (!file) return;
		setStatus(status, 'Reading bundle…', '');
		let bundle;
		try {
			bundle = JSON.parse(await file.text());
		} catch {
			setStatus(status, 'That file is not a valid .brain bundle (could not parse JSON).', 'err');
			fileInput.value = '';
			return;
		}
		const count = bundle?.manifest?.memory_count ?? bundle?.memories?.length ?? 0;
		const src = bundle?.agent?.name || bundle?.agent?.id || 'another agent';
		const ok = window.confirm(
			`Import ${count} memories from "${src}" into this agent?\n\nProvenance is preserved and duplicates are skipped. Existing memories are kept (merge).`,
		);
		if (!ok) {
			fileInput.value = '';
			return;
		}
		setStatus(status, 'Verifying signatures & importing…', '');
		try {
			const r = await apiFetch(`${API}/agents/${agentId}/brain/import`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ bundle, strategy: 'merge', importPersona: false }),
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
			setStatus(
				status,
				`Imported ${j.imported} memories (${j.duplicates} duplicate${j.duplicates === 1 ? '' : 's'} skipped${
					j.skipped_encrypted ? `, ${j.skipped_encrypted} encrypted skipped` : ''
				}).`,
				'ok',
			);
			agentBus.emit('memory:added', { agentId, imported: j.imported, ts: Date.now() });
			// Refresh the passport to reflect the merged mind.
			const fresh = await fetchPassport(agentId);
			render(host, agentId, fresh, agent);
		} catch (err) {
			setStatus(status, importError(err.message), 'err');
		} finally {
			fileInput.value = '';
		}
	});
}

function importError(msg) {
	if (/integrity_failed/i.test(msg)) return `Import rejected — the bundle failed verification: ${msg}`;
	if (/invalid_bundle/i.test(msg)) return `That file is not a valid brain bundle: ${msg}`;
	return `Import failed: ${msg}`;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function setStatus(el, msg, cls) {
	if (!el) return;
	el.textContent = msg;
	el.className = `bo-status${cls ? ` bo-status--${cls}` : ''}`;
}

function downloadJson(obj, filename) {
	const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function skeleton() {
	return `<div class="brain-own brain-own--loading" aria-busy="true">
		<div class="bo-skel bo-skel--hero"></div>
		<div class="bo-skel-row">
			<div class="bo-skel bo-skel--stat"></div><div class="bo-skel bo-skel--stat"></div>
			<div class="bo-skel bo-skel--stat"></div><div class="bo-skel bo-skel--stat"></div>
		</div>
		<div class="bo-skel bo-skel--block"></div>
		<div class="bo-skel bo-skel--block"></div>
	</div>`;
}

function errorState(message, _retry) {
	return `<div class="brain-own"><div class="bo-error">
		<p>Could not load brain ownership: ${escapeHtml(message)}</p>
		<button class="bo-btn" id="bo-retry" type="button">Retry</button>
	</div></div>`;
}

function wireRetry(host, retry) {
	host.querySelector('#bo-retry')?.addEventListener('click', retry);
}

export default { mountBrainOwnership };
