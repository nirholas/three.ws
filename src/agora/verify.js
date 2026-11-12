// Agora — the deliverable verifier. This is the honest core of the trust
// surface: completion bound `proofHash = sha256(deliverable bytes)` on-chain, so
// ANYONE can re-fetch the deliverable, re-hash it in their own browser, and
// confirm it matches — no trust in three.ws required.
//
// The crypto + compare below is pure (no DOM, no three) and unit-tested against
// real `crypto.subtle`. The inline GLB viewer is lazy-loaded only when a verified
// model needs rendering, so the pure path stays light and importable anywhere.
//
// Guardrail (CLAUDE.md): the result must be COMPUTED. If the deliverable can't be
// fetched or hashed, we say "could not verify" and show why — never a green check
// we didn't actually derive.

import { h, copyChip, copyText } from './panel.js';
import { normalizeHex, formatBytes, shortId } from './format.js';

// Default ceiling on what we'll download to verify. A deliverable larger than
// this is reported honestly ("too large to verify in-browser") rather than
// silently truncated — a truncated hash would never match and would read as a
// false ✗. 96 MB comfortably covers forge GLBs while bounding memory.
export const DEFAULT_MAX_BYTES = 96 * 1024 * 1024;

// SHA-256 a byte buffer → lowercase hex. Uses Web Crypto, present in browsers and
// Node ≥ 16 (globalThis.crypto.subtle). The on-chain proofHash is this exact
// digest of the deliverable bytes.
export async function sha256Hex(bytes) {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	// digest wants an ArrayBuffer view; slice to the exact range so a pooled
	// buffer (e.g. from a stream) never hashes trailing garbage.
	const buf = view.byteOffset === 0 && view.byteLength === view.buffer.byteLength
		? view.buffer
		: view.slice().buffer;
	const digest = await crypto.subtle.digest('SHA-256', buf);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compare a freshly-computed hash against the on-chain proofHash. Both are
// normalized to bare lowercase hex first so 0x-prefixing or case never causes a
// spurious mismatch. Returns the decision plus both normalized hashes for display.
export function compareHash(computedHex, proofHash) {
	const computed = normalizeHex(computedHex);
	const expected = normalizeHex(proofHash);
	const haveExpected = expected.length > 0;
	return {
		match: haveExpected && computed.length > 0 && computed === expected,
		haveExpected,
		computed,
		expected,
	};
}

// Typed verification error so the UI can phrase each failure honestly.
export class VerifyError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'VerifyError';
		this.code = code; // 'fetch' | 'cors' | 'too_large' | 'empty' | 'hash'
	}
}

// Fetch a deliverable and hash it, streaming with a hard size cap so a hostile or
// huge URL can't exhaust memory. Returns { bytes, hashHex, size, contentType }.
// Throws VerifyError with a code the UI maps to an honest message.
export async function fetchAndHash(url, { maxBytes = DEFAULT_MAX_BYTES, signal, onProgress } = {}) {
	let res;
	try {
		res = await fetch(url, { signal, redirect: 'follow', mode: 'cors' });
	} catch (err) {
		// A CORS rejection and a network failure both surface as TypeError here;
		// we can't tell them apart, so we name both and offer the direct link.
		throw new VerifyError('cors', `Couldn't fetch the deliverable (network or CORS blocked): ${err?.message || 'failed'}`);
	}
	if (!res.ok) {
		throw new VerifyError('fetch', `The deliverable URL returned HTTP ${res.status} ${res.statusText || ''}`.trim());
	}

	const contentType = res.headers.get('content-type') || '';
	const declared = Number(res.headers.get('content-length')) || 0;
	if (declared && declared > maxBytes) {
		throw new VerifyError('too_large', `Deliverable is ${formatBytes(declared)} — over the ${formatBytes(maxBytes)} in-browser verify cap.`);
	}

	// Stream so we can enforce the cap mid-download and report progress.
	const chunks = [];
	let received = 0;
	if (res.body && typeof res.body.getReader === 'function') {
		const reader = res.body.getReader();
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			if (received > maxBytes) {
				try { await reader.cancel(); } catch { /* already closed */ }
				throw new VerifyError('too_large', `Deliverable exceeds the ${formatBytes(maxBytes)} in-browser verify cap.`);
			}
			chunks.push(value);
			if (onProgress) onProgress(received, declared);
		}
	} else {
		const ab = await res.arrayBuffer();
		if (ab.byteLength > maxBytes) throw new VerifyError('too_large', `Deliverable exceeds the ${formatBytes(maxBytes)} in-browser verify cap.`);
		chunks.push(new Uint8Array(ab));
		received = ab.byteLength;
	}

	if (received === 0) throw new VerifyError('empty', 'The deliverable was empty (0 bytes) — nothing to hash.');

	const bytes = new Uint8Array(received);
	let off = 0;
	for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }

	let hashHex;
	try {
		hashHex = await sha256Hex(bytes);
	} catch (err) {
		throw new VerifyError('hash', `Failed to hash the deliverable: ${err?.message || 'digest error'}`);
	}
	return { bytes, hashHex, size: received, contentType };
}

// Heuristic: is this deliverable a GLB/GLTF we should try to render inline?
function looksLikeGlb(url, contentType, bytes) {
	const u = String(url || '').toLowerCase();
	if (u.endsWith('.glb') || u.endsWith('.gltf')) return true;
	if (/model\/gltf|gltf-binary|octet-stream/.test(contentType || '') && bytes) {
		// GLB magic: 'glTF' (0x46546C67) little-endian at byte 0.
		return bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
	}
	return false;
}

// A Cartographer deliverable is `agora.diorama.v1` JSON: the composed plan, and
// (when sharing was available) the saved permalink. Returns null for anything
// else, so a hostile or unrelated deliverable never reaches the map card.
export function parseDioramaDeliverable(bytes) {
	let doc;
	try {
		doc = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return null;
	}
	if (!doc || doc.kind !== 'agora.diorama.v1' || !doc.diorama || !Array.isArray(doc.diorama.objects)) return null;
	const objects = doc.diorama.objects
		.filter((o) => o && Array.isArray(o.position) && o.position.length === 3 && o.position.every((n) => Number.isFinite(n)))
		.map((o) => ({ label: String(o.label || o.prompt || '').slice(0, 40), x: o.position[0], z: o.position[2] }));
	if (!objects.length) return null;
	let permalink = null;
	try {
		const u = new URL(String(doc.permalink || ''));
		if (/^https?:$/.test(u.protocol) && u.pathname === '/diorama' && /^[0-9a-f-]{36}$/i.test(u.searchParams.get('id') || '')) permalink = u.toString();
	} catch {
		permalink = null;
	}
	return { title: String(doc.diorama.title || doc.prompt || 'Untitled map').slice(0, 80), mood: doc.diorama.mood || null, prompt: String(doc.prompt || ''), objects, permalink };
}

// Top-down map thumbnail drawn from the plan's real placed positions.
function renderMapCard(map) {
	const NS = 'http://www.w3.org/2000/svg';
	const size = 240;
	const pad = 24;
	const xs = map.objects.map((o) => o.x);
	const zs = map.objects.map((o) => o.z);
	const min = Math.min(...xs, ...zs, -1);
	const max = Math.max(...xs, ...zs, 1);
	const span = max - min || 1;
	const at = (v) => pad + ((v - min) / span) * (size - pad * 2);
	const svg = document.createElementNS(NS, 'svg');
	svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
	svg.setAttribute('class', 'agora-map-thumb');
	svg.setAttribute('role', 'img');
	svg.setAttribute('aria-label', `Top-down map of ${map.title} with ${map.objects.length} placed objects`);
	for (const o of map.objects) {
		const dot = document.createElementNS(NS, 'circle');
		dot.setAttribute('cx', at(o.x).toFixed(1));
		dot.setAttribute('cy', at(o.z).toFixed(1));
		dot.setAttribute('r', '5');
		const title = document.createElementNS(NS, 'title');
		title.textContent = o.label;
		dot.appendChild(title);
		svg.appendChild(dot);
	}
	const link = map.permalink
		? h('a', { class: 'agora-map-link', href: map.permalink, target: '_blank', rel: 'noopener noreferrer' }, ['Open the saved world'])
		: h('span', { class: 'agora-muted' }, ['This map was not saved as a shareable world.']);
	return h('div', { class: 'agora-map-card' }, [
		svg,
		h('div', { class: 'agora-map-meta' }, [
			h('strong', {}, [map.title]),
			h('span', { class: 'agora-muted' }, [`${map.objects.length} placed objects${map.mood ? ` · ${map.mood}` : ''}`]),
			link,
		]),
	]);
}

// ── DOM: the verifier widget ───────────────────────────────────────────────────

// Mount the verifier into `container`. Renders the Verify button (or an honest
// "can't verify" note when there's no proofHash / URL), runs the re-hash on
// click, and shows ✓/✗ with both hashes. For a verified GLB it renders the model
// inline from the very bytes that were hashed — proof you can see and orbit.
//
// When a `worker` context is supplied ({ agentPda, name?, taskPda? } — the
// citizen who produced the deliverable, from the task's lifecycle), a matching
// verdict surfaces a one-click **vouch** affordance: verifying is the honest
// prerequisite to attesting, so the Verify → vouch loop (Task 08 DoD) lives right
// here. It stays dependency-light — no auth/action imports — by dispatching the
// decoupled `agora:vouch-prompt` window event that the human HUD (me-hud.js)
// owns; the HUD carries the session + CSRF + spend policy and runs the real
// on-chain attestation.
//
//   mountVerifier(el, { deliverableUrl, proofHash, worker })
export function mountVerifier(container, { deliverableUrl, proofHash, worker = null } = {}) {
	container.classList.add('agora-verify');
	const hasUrl = !!deliverableUrl;
	const hasProof = !!normalizeHex(proofHash);

	const status = h('div', { class: 'agora-verify-status', 'aria-live': 'polite' });
	const actions = h('div', { class: 'agora-verify-actions' });
	const detail = h('div', { class: 'agora-verify-detail' });

	if (!hasUrl || !hasProof) {
		// Honest: we cannot offer a verification we can't perform.
		status.appendChild(h('div', { class: 'agora-verify-note' }, [
			!hasProof
				? 'No on-chain proofHash recorded for this task — there is nothing to verify against.'
				: 'No deliverable URL recorded — there are no bytes to re-hash.',
		]));
		container.replaceChildren(status, detail);
		return;
	}

	const onChainRow = h('div', { class: 'agora-hash-row' }, [
		h('span', { class: 'agora-hash-label' }, ['on-chain proofHash']),
		h('code', { class: 'agora-hash' }, [shortId(normalizeHex(proofHash), 10, 10)]),
		copyChip(normalizeHex(proofHash), 'proofHash'),
	]);

	const verifyBtn = h('button', { class: 'agora-btn agora-btn-primary', type: 'button' }, [
		h('span', { class: 'agora-btn-icon', 'aria-hidden': 'true' }, ['⎙']),
		'Verify deliverable',
	]);
	const openLink = h('a', {
		class: 'agora-btn agora-btn-ghost',
		href: deliverableUrl,
		target: '_blank',
		rel: 'noopener noreferrer',
	}, ['Open deliverable ↗']);

	actions.append(verifyBtn, openLink);
	container.replaceChildren(onChainRow, actions, status, detail);

	let abort = null;
	verifyBtn.addEventListener('click', async () => {
		if (abort) abort.abort();
		abort = new AbortController();
		verifyBtn.disabled = true;
		verifyBtn.classList.add('is-busy');
		detail.replaceChildren();
		status.replaceChildren(h('div', { class: 'agora-verify-progress' }, [
			h('span', { class: 'agora-skel agora-skel-line' }),
			h('span', { class: 'agora-verify-progress-label' }, ['Fetching & hashing in your browser…']),
		]));
		const progressLabel = status.querySelector('.agora-verify-progress-label');

		try {
			const result = await fetchAndHash(deliverableUrl, {
				signal: abort.signal,
				onProgress: (received, total) => {
					if (!progressLabel) return;
					progressLabel.textContent = total
						? `Hashing ${formatBytes(received)} / ${formatBytes(total)}…`
						: `Hashing ${formatBytes(received)}…`;
				},
			});
			const cmp = compareHash(result.hashHex, proofHash);
			renderResult(status, detail, { cmp, result, deliverableUrl, worker, proofHash });
		} catch (err) {
			renderFailure(status, detail, err, deliverableUrl);
		} finally {
			verifyBtn.disabled = false;
			verifyBtn.classList.remove('is-busy');
			abort = null;
		}
	});
}

function renderResult(status, detail, { cmp, result, deliverableUrl, worker = null, proofHash = null }) {
	const ok = cmp.match;
	status.replaceChildren(h('div', { class: `agora-verdict ${ok ? 'is-match' : 'is-mismatch'}`, role: ok ? 'status' : 'alert' }, [
		h('span', { class: 'agora-verdict-icon', 'aria-hidden': 'true' }, [ok ? '✓' : '✗']),
		h('div', { class: 'agora-verdict-text' }, [
			h('strong', {}, [ok ? 'Verified — hashes match' : 'Mismatch — does NOT match the chain']),
			h('span', { class: 'agora-verdict-sub' }, [
				ok
					? 'The deliverable you just downloaded hashes to exactly the proofHash recorded on-chain.'
					: 'The bytes at this URL do not hash to the on-chain proofHash. The deliverable was changed, replaced, or tampered with.',
			]),
		]),
	]));

	// One-click vouch (Task 08): a match is the honest prerequisite to attesting.
	// Only offered when we know who produced this deliverable; dispatches the
	// decoupled prompt the human HUD turns into a real on-chain attestation.
	if (ok && worker?.agentPda) {
		status.appendChild(renderVouchCta(worker, { deliverableUrl, proofHash }));
	}

	const rows = [
		hashCompareRow('computed (your browser)', cmp.computed, ok),
		hashCompareRow('on-chain proofHash', cmp.expected, ok),
		h('div', { class: 'agora-kv' }, [
			h('span', { class: 'agora-kv-key' }, ['size']),
			h('span', { class: 'agora-kv-val' }, [formatBytes(result.size)]),
		]),
		result.contentType ? h('div', { class: 'agora-kv' }, [
			h('span', { class: 'agora-kv-key' }, ['type']),
			h('span', { class: 'agora-kv-val' }, [result.contentType]),
		]) : null,
	].filter(Boolean);
	detail.replaceChildren(h('div', { class: 'agora-verify-hashes' }, rows));

	// A verified Cartographer map shows its thumbnail and saved-world link.
	if (ok && result.bytes) {
		const map = parseDioramaDeliverable(result.bytes);
		if (map) detail.appendChild(renderMapCard(map));
	}

	// A verified GLB renders inline from the exact bytes we hashed.
	if (ok && looksLikeGlb(deliverableUrl, result.contentType, result.bytes)) {
		const viewer = h('div', { class: 'agora-glb-viewer', 'aria-label': 'Verified 3D model — drag to orbit' });
		const caption = h('div', { class: 'agora-glb-caption' }, ['Verified model — drag to orbit · scroll to zoom']);
		detail.append(viewer, caption);
		renderGlbInline(viewer, result.bytes).catch((err) => {
			viewer.replaceChildren(h('div', { class: 'agora-glb-fail' }, [`Could not render the model: ${err?.message || 'unknown error'}`]));
		});
	}
}

// The Verify → vouch bridge. Renders a small "vouch for this work" affordance
// under a matching verdict. It never calls the vouch API itself (verify.js stays
// pure of auth/actions) — it dispatches `agora:vouch-prompt`, which me-hud.js
// resolves to the worker's citizen, opens the "You" drawer, and runs the real
// on-chain attestation (signed-out visitors get routed to sign in there).
function renderVouchCta(worker, { deliverableUrl, proofHash }) {
	const who = worker.name ? `for ${worker.name}` : 'for this citizen';
	const btn = h('button', { class: 'agora-btn agora-btn-primary agora-verify-vouch-btn', type: 'button' }, [
		h('span', { class: 'agora-btn-icon', 'aria-hidden': 'true' }, ['✍']),
		`Vouch ${who}`,
	]);
	btn.addEventListener('click', () => {
		window.dispatchEvent(new CustomEvent('agora:vouch-prompt', {
			detail: {
				agentPda: worker.agentPda,
				citizenId: worker.citizenId || null,
				name: worker.name || null,
				taskPda: worker.taskPda || null,
				cluster: worker.cluster || null,
				proofHash: proofHash || null,
				deliverableUrl: deliverableUrl || null,
				verified: true,
			},
		}));
	});
	return h('div', { class: 'agora-verify-vouch' }, [
		h('span', { class: 'agora-verify-vouch-hint' }, ['Confirmed the work? Leave a real on-chain vouch.']),
		btn,
	]);
}

function hashCompareRow(label, hex, ok) {
	return h('div', { class: 'agora-hash-row' }, [
		h('span', { class: 'agora-hash-label' }, [label]),
		h('code', { class: `agora-hash ${ok ? 'is-ok' : 'is-bad'}` }, [hex || '—']),
		hex ? copyChip(hex, label) : null,
	].filter(Boolean));
}

function renderFailure(status, detail, err, deliverableUrl) {
	const code = err instanceof VerifyError ? err.code : 'fetch';
	status.replaceChildren(h('div', { class: 'agora-verdict is-error', role: 'alert' }, [
		h('span', { class: 'agora-verdict-icon', 'aria-hidden': 'true' }, ['⚠']),
		h('div', { class: 'agora-verdict-text' }, [
			h('strong', {}, ['Could not verify']),
			h('span', { class: 'agora-verdict-sub' }, [err?.message || 'The deliverable could not be fetched or hashed.']),
		]),
	]));
	// CORS is the common honest failure: the bytes exist but the host won't let a
	// browser read them cross-origin. Offer the direct link so the user can fetch
	// and hash out-of-band rather than see a check we never computed.
	if (code === 'cors' || code === 'fetch') {
		detail.replaceChildren(h('p', { class: 'agora-verify-note' }, [
			'Open the deliverable directly and hash it yourself (',
			h('code', { class: 'agora-hash-inline' }, ['sha256']),
			') to compare against the on-chain proofHash above — ',
			h('a', { href: deliverableUrl, target: '_blank', rel: 'noopener noreferrer' }, ['open deliverable ↗']),
			'.',
		]));
	} else {
		detail.replaceChildren();
	}
}

// Lazy-load a tiny self-contained GLB orbit viewer for the verified bytes. Kept
// out of the module top so the pure verify core never pulls three/addons.
async function renderGlbInline(container, bytes) {
	const [{ default: makeViewer }] = await Promise.all([import('./glb-viewer.js')]);
	await makeViewer(container, bytes);
}

export { copyText };
