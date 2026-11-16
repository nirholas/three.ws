// Brain Studio — sculpt your agent's mind and feel the change land on the live
// avatar within a second.
//
// You don't write a system prompt here; you direct a character. Trait sliders,
// tone chips, and characteristic vocabulary compile (deterministically, via the
// shared compiler in src/agents/persona-compile.js) into a real persona prompt.
// Every change re-runs a REAL /api/chat against that candidate prompt (owner-only
// persona_override) and the avatar re-greets in the new register, in the agent's
// real voice. A/B compare runs real dual inference; promoting a side writes a
// real agent_versions entry and emits `brain:updated` so the Companion re-greets
// everywhere.
//
// Mounted lazily by src/agent-edit.js when the Brain tab opens.

import { apiFetch } from './api.js';
import {
	PERSONA_TRAITS,
	defaultTraitValues,
	clampTraits,
	describeTrait,
	compilePersona,
	registerSummary,
} from './agents/persona-compile.js';
import { agentBus, EVENTS } from './agents/agent-bus.js';

const esc = (s) =>
	String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const PROBES = [
	{ id: 'greet', label: 'Greet me', prompt: 'Greet me in one or two sentences, in character.' },
	{ id: 'explain', label: 'What do you do?', prompt: 'In two sentences, tell me what you can help me with — in character.' },
	{ id: 'take', label: 'Honest take', prompt: 'Give me your honest, in-character take on whether I should ship a feature that is 90% done today or polish it for one more week.' },
];

let STYLE_INJECTED = false;
function injectStyle() {
	if (STYLE_INJECTED) return;
	STYLE_INJECTED = true;
	const css = `
.brain-studio{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:24px;align-items:start}
@media (max-width:900px){.brain-studio{grid-template-columns:1fr}}
.bs-col{min-width:0}
.bs-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 0 4px}
.bs-head h2{font-size:1.05rem;margin:0;font-weight:650}
.bs-sub{font-size:.78rem;color:rgba(255,255,255,.5);margin:0 0 18px}
.bs-dna{font-variant:small-caps;letter-spacing:.02em;color:#a4f0bc}
.bs-trait{margin:0 0 16px}
.bs-trait-top{display:flex;justify-content:space-between;align-items:baseline;font-size:.78rem;margin-bottom:5px}
.bs-trait-label{font-weight:600;color:rgba(255,255,255,.92)}
.bs-trait-val{color:#7aa2ff;font-weight:600;font-variant:small-caps}
.bs-trait-poles{display:flex;justify-content:space-between;font-size:.66rem;color:rgba(255,255,255,.38);margin-top:3px}
.bs-range{-webkit-appearance:none;appearance:none;width:100%;height:6px;border-radius:999px;background:linear-gradient(90deg,#1c2030,#2a3350);outline:none;cursor:pointer}
.bs-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;border-radius:50%;background:#7aa2ff;border:2px solid #0b0d14;box-shadow:0 1px 4px rgba(0,0,0,.5);transition:transform .1s}
.bs-range::-moz-range-thumb{width:18px;height:18px;border-radius:50%;background:#7aa2ff;border:2px solid #0b0d14;cursor:pointer}
.bs-range:hover::-webkit-slider-thumb,.bs-range:focus::-webkit-slider-thumb{transform:scale(1.12)}
.bs-range:focus-visible{box-shadow:0 0 0 3px rgba(122,162,255,.4)}
.bs-section-title{font-size:.7rem;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.45);margin:22px 0 8px;font-weight:600}
.bs-chips{display:flex;flex-wrap:wrap;gap:7px}
.bs-chip{display:inline-flex;align-items:center;gap:6px;background:rgba(122,162,255,.14);border:1px solid rgba(122,162,255,.3);color:#cdd9ff;border-radius:999px;padding:4px 6px 4px 11px;font-size:.74rem;font-weight:500}
.bs-chip button{background:none;border:0;color:inherit;cursor:pointer;font-size:14px;line-height:1;opacity:.6;padding:0 2px;border-radius:50%}
.bs-chip button:hover{opacity:1;color:#fff}
.bs-chip-add{display:inline-flex;gap:6px}
.bs-input{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:8px;padding:6px 10px;font-size:.78rem;min-width:0;width:100%}
.bs-input:focus{outline:none;border-color:#7aa2ff;box-shadow:0 0 0 3px rgba(122,162,255,.18)}
.bs-vocab{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.bs-vocab li{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:6px 8px 6px 12px;font-size:.76rem;color:rgba(255,255,255,.86)}
.bs-vocab li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bs-vocab li button{background:none;border:0;color:rgba(255,255,255,.5);cursor:pointer;font-size:15px;line-height:1}
.bs-vocab li button:hover{color:#fff}
.bs-stage{position:relative;background:radial-gradient(120% 100% at 50% 0%,#161a28 0%,#0b0d14 70%);border:1px solid rgba(255,255,255,.09);border-radius:16px;overflow:hidden;aspect-ratio:1/1;max-height:360px}
.bs-stage agent-3d{width:100%;height:100%;display:block}
.bs-bubble{position:absolute;left:14px;right:14px;bottom:14px;min-height:46px;background:rgba(12,14,20,.82);backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:11px 13px;font-size:.82rem;line-height:1.45;color:#eef1f8;transition:opacity .2s;max-height:46%;overflow:auto}
.bs-bubble.thinking{color:rgba(255,255,255,.5)}
.bs-bubble .bs-caret{display:inline-block;width:7px;height:1.05em;background:#7aa2ff;margin-left:1px;vertical-align:-2px;animation:bs-blink 1s steps(2) infinite}
@keyframes bs-blink{50%{opacity:0}}
.bs-dots span{display:inline-block;width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.5);margin-right:4px;animation:bs-bounce 1.2s infinite}
.bs-dots span:nth-child(2){animation-delay:.15s}.bs-dots span:nth-child(3){animation-delay:.3s}
@keyframes bs-bounce{0%,60%,100%{transform:translateY(0);opacity:.5}30%{transform:translateY(-4px);opacity:1}}
.bs-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:12px}
.bs-probes{display:flex;gap:6px;flex-wrap:wrap}
.bs-probe{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.8);border-radius:999px;padding:5px 11px;font-size:.72rem;font-weight:600;cursor:pointer;transition:all .12s}
.bs-probe[aria-pressed="true"]{background:rgba(122,162,255,.22);border-color:rgba(122,162,255,.5);color:#fff}
.bs-probe:hover{border-color:rgba(122,162,255,.5)}
.bs-iconbtn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);color:rgba(255,255,255,.85);border-radius:8px;padding:6px 10px;font-size:.74rem;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all .12s}
.bs-iconbtn:hover{border-color:rgba(122,162,255,.5);color:#fff}
.bs-iconbtn[aria-pressed="true"]{background:rgba(164,240,188,.18);border-color:rgba(164,240,188,.45);color:#cdeed5}
.bs-iconbtn:disabled{opacity:.45;cursor:not-allowed}
.bs-savebar{display:flex;gap:10px;align-items:center;margin-top:18px;flex-wrap:wrap}
.bs-save{background:#7aa2ff;color:#0b0d14;border:0;border-radius:9px;padding:9px 18px;font-size:.82rem;font-weight:700;cursor:pointer;transition:filter .12s}
.bs-save:hover{filter:brightness(1.08)}
.bs-save:disabled{opacity:.5;cursor:not-allowed}
.bs-status{font-size:.76rem}.bs-status.ok{color:#a4f0bc}.bs-status.err{color:#fca5a5}
.bs-dirty{font-size:.72rem;color:#fcd34d}
.bs-disclosure{margin-top:18px;border-top:1px solid rgba(255,255,255,.08);padding-top:14px}
.bs-disclosure>summary{cursor:pointer;font-size:.78rem;font-weight:600;color:rgba(255,255,255,.78);list-style:none;display:flex;align-items:center;gap:8px}
.bs-disclosure>summary::-webkit-details-marker{display:none}
.bs-disclosure>summary::before{content:'▸';color:#7aa2ff;transition:transform .15s}
.bs-disclosure[open]>summary::before{transform:rotate(90deg)}
.bs-diff{font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;word-break:break-word;background:#0a0c12;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:12px;margin-top:10px;max-height:280px;overflow:auto}
.bs-diff .add{background:rgba(34,197,94,.16);color:#bbf7d0;display:block}
.bs-diff .del{background:rgba(239,68,68,.14);color:#fecaca;text-decoration:line-through;display:block;opacity:.8}
.bs-diff .ctx{color:rgba(255,255,255,.6);display:block}
.bs-versions{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:6px}
.bs-versions li{display:flex;align-items:center;gap:10px;font-size:.76rem;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:7px 10px}
.bs-versions .v{color:#7aa2ff;font-weight:700;font-variant:tabular-nums}
.bs-versions .note{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:rgba(255,255,255,.78)}
.bs-versions .when{color:rgba(255,255,255,.4);font-size:.7rem}
.bs-versions button{background:none;border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.8);border-radius:6px;padding:3px 9px;font-size:.7rem;cursor:pointer}
.bs-versions button:hover{border-color:#7aa2ff;color:#fff}
.bs-ab{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.bs-ab-side{display:flex;flex-direction:column;gap:8px}
.bs-ab-side h3{margin:0;font-size:.74rem;text-transform:uppercase;letter-spacing:.06em;color:rgba(255,255,255,.55)}
.bs-ab-side .bs-stage{max-height:240px}
.bs-promote{background:rgba(164,240,188,.16);border:1px solid rgba(164,240,188,.4);color:#cdeed5;border-radius:8px;padding:7px;font-size:.74rem;font-weight:700;cursor:pointer}
.bs-promote:hover{filter:brightness(1.1)}
.bs-empty{text-align:center;color:rgba(255,255,255,.5);font-size:.8rem;padding:18px}
.bs-error{background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);color:#fecaca;border-radius:10px;padding:12px 14px;font-size:.8rem}
.bs-error button{margin-top:8px}
@media (prefers-reduced-motion:reduce){.bs-caret,.bs-dots span{animation:none}}
`;
	const tag = document.createElement('style');
	tag.id = 'brain-studio-style';
	tag.textContent = css;
	document.head.appendChild(tag);
}

// ── agent-3d loader (mirrors agent-edit.js) ─────────────────────────────────
async function ensureAgent3DLib() {
	if (customElements.get('agent-3d')) return true;
	for (const url of [
		'https://three.ws/agent-3d/latest/agent-3d.js',
		'/agent-3d/latest/agent-3d.js',
		'/dist-lib/agent-3d.js',
	]) {
		try {
			await import(/* @vite-ignore */ url);
			if (customElements.get('agent-3d')) return true;
		} catch {
			/* next */
		}
	}
	return false;
}

// ── Real voice synthesis in the agent's configured voice ────────────────────
function createVoice(agentId) {
	let cfg = null;
	let cfgLoaded = false;
	let enabled = false;
	let audio = null;
	let objectUrl = null;
	let controller = null;

	async function loadCfg() {
		if (cfgLoaded) return cfg;
		cfgLoaded = true;
		try {
			const r = await apiFetch(`/api/agents/${agentId}/voice`, { credentials: 'include' });
			if (r.ok) cfg = await r.json();
		} catch {
			cfg = null;
		}
		return cfg;
	}

	function cancel() {
		if (controller) {
			controller.abort();
			controller = null;
		}
		if (audio) {
			audio.pause();
			audio.onended = audio.onerror = null;
			audio = null;
		}
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
	}

	// Fetch a clip in the agent's real voice and play it. Returns true if audio
	// began. Never throws; degrades silently to the on-screen text bubble.
	async function speak(text) {
		cancel();
		if (!enabled || !text) return false;
		await loadCfg();
		controller = new AbortController();
		let blob;
		try {
			const isEleven = cfg?.voice_provider === 'elevenlabs' && cfg?.voice_id;
			const res = isEleven
				? await apiFetch('/api/tts/eleven', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						credentials: 'include',
						body: JSON.stringify({ voiceId: cfg.voice_id, text: text.slice(0, 600) }),
						signal: controller.signal,
					})
				: await apiFetch('/api/tts/speak', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						credentials: 'include',
						body: JSON.stringify({ text: text.slice(0, 600), voice: cfg?.voice_id || 'nova', format: 'mp3' }),
						signal: controller.signal,
					});
			if (!res.ok) return false;
			blob = await res.blob();
		} catch {
			return false;
		}
		if (!blob || blob.size === 0) return false;
		objectUrl = URL.createObjectURL(blob);
		audio = new Audio(objectUrl);
		try {
			await audio.play();
			return true;
		} catch {
			cancel();
			return false;
		}
	}

	return {
		speak,
		cancel,
		setEnabled(v) {
			enabled = v;
			if (!v) cancel();
		},
		isEnabled: () => enabled,
		loadCfg,
	};
}

// ── Real streamed /api/chat against a candidate persona ─────────────────────
// onChunk(text) per token; resolves with the full reply. Honours abort.
async function streamPersona({ agentId, personaOverride, message, signal, onChunk }) {
	const res = await apiFetch('/api/chat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({ agentId, persona_override: personaOverride, message, history: [] }),
		signal,
	});
	if (!res.ok || !res.body) {
		const j = await res.json().catch(() => ({}));
		throw new Error(j.error_description || j.error || `chat failed (${res.status})`);
	}
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = '';
	let full = '';
	for (;;) {
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
			try {
				evt = JSON.parse(raw);
			} catch {
				continue;
			}
			if (evt.type === 'chunk' && evt.text) {
				full += evt.text;
				onChunk?.(evt.text, full);
			} else if (evt.type === 'guard' && evt.action === 'replace' && typeof evt.text === 'string') {
				// An output guardrail on this agent replaced the reply.
				full = evt.text;
				onChunk?.('', full);
			} else if (evt.type === 'error') {
				throw new Error(evt.message || 'stream error');
			}
		}
	}
	return full.trim();
}

// ── Minimal line diff (LCS) for the prompt-change view ──────────────────────
function lineDiff(a, b) {
	const A = (a || '').split('\n');
	const B = (b || '').split('\n');
	const n = A.length;
	const m = B.length;
	const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
	for (let i = n - 1; i >= 0; i--)
		for (let j = m - 1; j >= 0; j--)
			dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
	const out = [];
	let i = 0;
	let j = 0;
	while (i < n && j < m) {
		if (A[i] === B[j]) {
			out.push({ t: 'ctx', line: A[i] });
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			out.push({ t: 'del', line: A[i] });
			i++;
		} else {
			out.push({ t: 'add', line: B[j] });
			j++;
		}
	}
	while (i < n) out.push({ t: 'del', line: A[i++] });
	while (j < m) out.push({ t: 'add', line: B[j++] });
	return out;
}

// ════════════════════════════════════════════════════════════════════════════
export async function mountBrainStudio(host, { agentId, agent }) {
	injectStyle();

	// ── State ────────────────────────────────────────────────────────────────
	const state = {
		name: agent?.name || 'Agent',
		description: agent?.description || '',
		traits: defaultTraitValues(),
		toneTags: [],
		vocabulary: [],
		base: '',
		// Last-saved baseline — for dirty detection, diff, and the A side.
		saved: { traits: defaultTraitValues(), toneTags: [], vocabulary: [], base: '', prompt: '' },
		probe: 'greet',
		abMode: false,
		loaded: false,
	};

	const voice = createVoice(agentId);
	let previewTimer = null;
	let previewAbort = null;
	let avatarEl = null; // main preview avatar
	let abAvatars = { a: null, b: null };
	let abAborts = { a: null, b: null };

	host.innerHTML = `<div class="bs-empty"><span class="bs-dots"><span></span><span></span><span></span></span> Loading the Brain Studio…</div>`;

	// ── Load real persona ──────────────────────────────────────────────────────
	let data;
	try {
		const r = await apiFetch(`/api/agents/${agentId}/persona`, { credentials: 'include' });
		if (!r.ok) throw new Error(`HTTP ${r.status}`);
		data = await r.json();
	} catch (err) {
		host.innerHTML = `<div class="bs-error">Couldn't load this agent's persona: ${esc(err.message)}.
			<div><button class="bs-iconbtn" id="bs-retry">Try again</button></div></div>`;
		host.querySelector('#bs-retry')?.addEventListener('click', () => mountBrainStudio(host, { agentId, agent }));
		return;
	}

	state.name = data.name || state.name;
	state.description = data.description || state.description;
	state.traits = clampTraits(data.traits || {});
	state.toneTags = Array.isArray(data.tone_tags) ? data.tone_tags.slice(0, 12) : [];
	state.vocabulary = Array.isArray(data.vocabulary) ? data.vocabulary.slice(0, 10) : [];
	state.base = data.base || '';
	state.saved = {
		traits: { ...state.traits },
		toneTags: [...state.toneTags],
		vocabulary: [...state.vocabulary],
		base: state.base,
		prompt: data.persona_prompt || '',
	};
	state.loaded = true;

	// ── Build DOM ──────────────────────────────────────────────────────────────
	host.innerHTML = '';
	const root = document.createElement('div');
	root.className = 'brain-studio';
	root.innerHTML = template();
	host.appendChild(root);

	const $ = (sel) => root.querySelector(sel);

	function template() {
		return `
		<div class="bs-col bs-editor">
			<div class="bs-head"><h2>Brain Studio</h2></div>
			<p class="bs-sub" id="bs-dna">${esc(registerSummary(state.traits))}</p>

			<div id="bs-traits">${PERSONA_TRAITS.map(traitRow).join('')}</div>

			<div class="bs-section-title">Tone</div>
			<div class="bs-chips" id="bs-tone"></div>
			<div class="bs-chip-add" style="margin-top:8px">
				<input class="bs-input" id="bs-tone-input" placeholder="Add a tone word, e.g. candid" maxlength="40" aria-label="Add tone word">
			</div>

			<div class="bs-section-title">Characteristic phrasing</div>
			<ul class="bs-vocab" id="bs-vocab"></ul>
			<div class="bs-chip-add" style="margin-top:8px">
				<input class="bs-input" id="bs-vocab-input" placeholder="Add a phrase it naturally uses" maxlength="120" aria-label="Add characteristic phrase">
			</div>

			<div class="bs-savebar">
				<input class="bs-input" id="bs-changelog" placeholder="What changed? (optional note for this version)" maxlength="280" style="flex:1;min-width:140px" aria-label="Version note">
				<button class="bs-save" id="bs-save">Save persona</button>
				<span class="bs-dirty" id="bs-dirty" hidden>● unsaved</span>
				<span class="bs-status" id="bs-status" role="status" aria-live="polite"></span>
			</div>

			<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
				<button class="bs-iconbtn" id="bs-rerun">🎙 Re-run interview</button>
				<button class="bs-iconbtn" id="bs-ab-toggle" aria-pressed="false">⚖ Compare A/B</button>
				<button class="bs-iconbtn" id="bs-dna-copy">🧬 Copy DNA</button>
				<button class="bs-iconbtn" id="bs-reset" title="Revert to last saved">↺ Revert</button>
			</div>

			<details class="bs-disclosure" id="bs-diff-wrap">
				<summary>How this rewrote the underlying prompt</summary>
				<div class="bs-diff" id="bs-diff"></div>
			</details>

			<details class="bs-disclosure" id="bs-hist-wrap">
				<summary>Version history</summary>
				<ul class="bs-versions" id="bs-versions"><li class="bs-empty">Loading…</li></ul>
			</details>
		</div>

		<div class="bs-col bs-preview">
			<div id="bs-single">
				<div class="bs-stage" id="bs-stage"><div class="bs-bubble thinking" id="bs-bubble">Adjust a trait — your agent re-greets in the new character.</div></div>
				<div class="bs-controls">
					<div class="bs-probes" id="bs-probes">${PROBES.map((p) => `<button class="bs-probe" data-probe="${p.id}" aria-pressed="${p.id === state.probe}">${esc(p.label)}</button>`).join('')}</div>
				</div>
				<div class="bs-controls">
					<button class="bs-iconbtn" id="bs-regen">↻ Re-greet</button>
					<button class="bs-iconbtn" id="bs-voice" aria-pressed="false">🔊 Voice off</button>
				</div>
			</div>
			<div id="bs-ab" hidden></div>
		</div>`;
	}

	function traitRow(t) {
		const v = state.traits[t.key];
		return `
		<div class="bs-trait" data-trait="${t.key}">
			<div class="bs-trait-top">
				<span class="bs-trait-label">${esc(t.label)}</span>
				<span class="bs-trait-val" data-val="${t.key}">${esc(describeTrait(t.key, v))}</span>
			</div>
			<input class="bs-range" type="range" min="0" max="100" value="${Math.round(v * 100)}"
				data-trait-input="${t.key}" aria-label="${esc(t.label)}: ${esc(t.hint)}"
				aria-valuetext="${esc(describeTrait(t.key, v))}">
			<div class="bs-trait-poles"><span>${esc(t.low)}</span><span>${esc(t.high)}</span></div>
		</div>`;
	}

	// ── Candidate persona compilation (client side; identical to server) ────────
	function candidatePrompt(traits = state.traits, toneTags = state.toneTags, vocabulary = state.vocabulary, base = state.base) {
		return compilePersona({ name: state.name, description: state.description, base, traits, toneTags, vocabulary });
	}

	function isDirty() {
		const s = state.saved;
		if (s.base !== state.base) return true;
		if (s.toneTags.join('|') !== state.toneTags.join('|')) return true;
		if (s.vocabulary.join('|') !== state.vocabulary.join('|')) return true;
		return PERSONA_TRAITS.some((t) => Math.round(s.traits[t.key] * 100) !== Math.round(state.traits[t.key] * 100));
	}

	function refreshMeta() {
		$('#bs-dna').textContent = registerSummary(state.traits);
		$('#bs-dirty').hidden = !isDirty();
		renderDiff();
	}

	function renderTone() {
		$('#bs-tone').innerHTML = state.toneTags.length
			? state.toneTags
					.map((t, i) => `<span class="bs-chip">${esc(t)}<button data-tone-rm="${i}" aria-label="Remove ${esc(t)}">×</button></span>`)
					.join('')
			: `<span style="font-size:.74rem;color:rgba(255,255,255,.4)">No tone words yet — add a few.</span>`;
		$('#bs-tone')
			.querySelectorAll('[data-tone-rm]')
			.forEach((b) =>
				b.addEventListener('click', () => {
					state.toneTags.splice(Number(b.dataset.toneRm), 1);
					renderTone();
					onEdit();
				}),
			);
	}

	function renderVocab() {
		$('#bs-vocab').innerHTML = state.vocabulary.length
			? state.vocabulary
					.map((v, i) => `<li><span title="${esc(v)}">${esc(v)}</span><button data-vocab-rm="${i}" aria-label="Remove phrase">×</button></li>`)
					.join('')
			: `<li class="bs-empty" style="padding:8px">No signature phrases yet.</li>`;
		$('#bs-vocab')
			.querySelectorAll('[data-vocab-rm]')
			.forEach((b) =>
				b.addEventListener('click', () => {
					state.vocabulary.splice(Number(b.dataset.vocabRm), 1);
					renderVocab();
					onEdit();
				}),
			);
	}

	function renderDiff() {
		const wrap = $('#bs-diff-wrap');
		if (!wrap || !wrap.open) return;
		const diff = lineDiff(state.saved.prompt, candidatePrompt());
		$('#bs-diff').innerHTML = diff
			.map((d) => `<span class="${d.t}">${d.t === 'add' ? '+ ' : d.t === 'del' ? '- ' : '  '}${esc(d.line) || '&nbsp;'}</span>`)
			.join('');
	}

	// ── Live preview ────────────────────────────────────────────────────────────
	function setBubble(html, { thinking = false } = {}) {
		const b = $('#bs-bubble');
		if (!b) return;
		b.classList.toggle('thinking', thinking);
		b.innerHTML = html;
	}

	function schedulePreview() {
		if (!avatarEl) return; // single preview not mounted (A/B mode)
		clearTimeout(previewTimer);
		setBubble(`<span class="bs-dots"><span></span><span></span><span></span></span>`, { thinking: true });
		previewTimer = setTimeout(runPreview, 600);
	}

	async function runPreview() {
		if (previewAbort) previewAbort.abort();
		previewAbort = new AbortController();
		const probe = PROBES.find((p) => p.id === state.probe) || PROBES[0];
		const prompt = candidatePrompt();
		try {
			avatarEl?.playGesture?.('think', { hold: 0.6 });
			let any = false;
			const reply = await streamPersona({
				agentId,
				personaOverride: prompt,
				message: probe.prompt,
				signal: previewAbort.signal,
				onChunk: (_t, full) => {
					any = true;
					setBubble(`${esc(full)}<span class="bs-caret"></span>`);
				},
			});
			if (!reply && !any) {
				setBubble('No reply came back — try again.', { thinking: true });
				return;
			}
			setBubble(esc(reply));
			avatarEl?.speak?.(reply);
			voice.speak(reply);
		} catch (err) {
			if (err.name === 'AbortError') return;
			setBubble(`Preview failed: ${esc(err.message)}. <button class="bs-iconbtn" id="bs-prev-retry" style="margin-top:6px">Retry</button>`, { thinking: true });
			$('#bs-prev-retry')?.addEventListener('click', runPreview);
		}
	}

	// Any edit: update derived UI, mark dirty, re-run preview.
	function onEdit() {
		refreshMeta();
		schedulePreview();
	}

	// ── Wire trait sliders ──────────────────────────────────────────────────────
	root.querySelectorAll('[data-trait-input]').forEach((inp) => {
		inp.addEventListener('input', () => {
			const key = inp.dataset.traitInput;
			state.traits[key] = Number(inp.value) / 100;
			const word = describeTrait(key, state.traits[key]);
			const valEl = root.querySelector(`[data-val="${key}"]`);
			if (valEl) valEl.textContent = word;
			inp.setAttribute('aria-valuetext', word);
			// Cheap UI updates immediately; the network preview is debounced.
			refreshMeta();
			schedulePreview();
		});
	});

	// Tone + vocab inputs (Enter to add)
	$('#bs-tone-input').addEventListener('keydown', (e) => {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		const v = e.target.value.trim().slice(0, 40);
		if (v && !state.toneTags.some((t) => t.toLowerCase() === v.toLowerCase()) && state.toneTags.length < 12) {
			state.toneTags.push(v);
			renderTone();
			onEdit();
		}
		e.target.value = '';
	});
	$('#bs-vocab-input').addEventListener('keydown', (e) => {
		if (e.key !== 'Enter') return;
		e.preventDefault();
		const v = e.target.value.trim().slice(0, 120);
		if (v && !state.vocabulary.some((p) => p.toLowerCase() === v.toLowerCase()) && state.vocabulary.length < 10) {
			state.vocabulary.push(v);
			renderVocab();
			onEdit();
		}
		e.target.value = '';
	});

	// Probe selector
	$('#bs-probes').addEventListener('click', (e) => {
		const btn = e.target.closest('[data-probe]');
		if (!btn) return;
		state.probe = btn.dataset.probe;
		$('#bs-probes')
			.querySelectorAll('[data-probe]')
			.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
		if (state.abMode) runAB();
		else runPreview();
	});

	$('#bs-regen').addEventListener('click', () => (state.abMode ? runAB() : runPreview()));

	$('#bs-voice').addEventListener('click', (e) => {
		const on = !voice.isEnabled();
		voice.setEnabled(on);
		e.currentTarget.setAttribute('aria-pressed', String(on));
		e.currentTarget.textContent = on ? '🔊 Voice on' : '🔊 Voice off';
	});

	$('#bs-diff-wrap').addEventListener('toggle', renderDiff);
	$('#bs-hist-wrap').addEventListener('toggle', (e) => {
		if (e.target.open) loadVersions();
	});

	$('#bs-reset').addEventListener('click', () => {
		state.traits = { ...state.saved.traits };
		state.toneTags = [...state.saved.toneTags];
		state.vocabulary = [...state.saved.vocabulary];
		state.base = state.saved.base;
		syncControls();
		onEdit();
	});

	$('#bs-dna-copy').addEventListener('click', async (e) => {
		const dna = personalityDNA();
		try {
			await navigator.clipboard.writeText(dna);
			e.currentTarget.textContent = '🧬 Copied!';
			setTimeout(() => (e.currentTarget.textContent = '🧬 Copy DNA'), 1500);
		} catch {
			setStatus('Clipboard unavailable', 'err');
		}
	});

	$('#bs-save').addEventListener('click', save);
	$('#bs-rerun').addEventListener('click', openInterview);
	$('#bs-ab-toggle').addEventListener('click', toggleAB);

	// Cmd/Ctrl+S saves while focus is inside the studio.
	root.addEventListener('keydown', (e) => {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
			e.preventDefault();
			save();
		}
	});

	function syncControls() {
		root.querySelectorAll('[data-trait-input]').forEach((inp) => {
			const key = inp.dataset.traitInput;
			inp.value = Math.round(state.traits[key] * 100);
			const word = describeTrait(key, state.traits[key]);
			const valEl = root.querySelector(`[data-val="${key}"]`);
			if (valEl) valEl.textContent = word;
			inp.setAttribute('aria-valuetext', word);
		});
		renderTone();
		renderVocab();
	}

	function personalityDNA() {
		const traitLine = PERSONA_TRAITS.map((t) => `${t.label} ${Math.round(state.traits[t.key] * 100)}`).join(' · ');
		return [
			`🧬 ${state.name} — personality DNA`,
			registerSummary(state.traits),
			traitLine,
			state.toneTags.length ? `Tone: ${state.toneTags.join(', ')}` : '',
			'Sculpted in the three.ws Brain Studio',
		]
			.filter(Boolean)
			.join('\n');
	}

	function setStatus(msg, kind = '') {
		const el = $('#bs-status');
		el.textContent = msg;
		el.className = `bs-status ${kind}`;
		if (kind === 'ok') setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 3000);
	}

	// ── Save ─────────────────────────────────────────────────────────────────
	async function save() {
		if (!isDirty()) {
			setStatus('Nothing to save.', 'ok');
			return;
		}
		const btn = $('#bs-save');
		btn.disabled = true;
		setStatus('Saving…');
		try {
			const r = await apiFetch(`/api/agents/${agentId}/persona/save`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					traits: state.traits,
					tone_tags: state.toneTags,
					vocabulary: state.vocabulary,
					base: state.base,
					changelog: $('#bs-changelog').value.trim() || undefined,
				}),
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
			state.saved = {
				traits: { ...state.traits },
				toneTags: [...state.toneTags],
				vocabulary: [...state.vocabulary],
				base: state.base,
				prompt: j.persona_prompt || candidatePrompt(),
			};
			$('#bs-changelog').value = '';
			refreshMeta();
			setStatus(`Saved as v${j.version}.`, 'ok');
			// Bus: the Companion + every surface re-greet in the new character.
			agentBus.emit(EVENTS.BRAIN_UPDATED, {
				agentId,
				personaPrompt: j.persona_prompt,
				toneTags: j.tone_tags,
				change: j.changelog,
				ts: j.updated_at || undefined,
			});
			if ($('#bs-hist-wrap').open) loadVersions();
		} catch (err) {
			setStatus(`Error: ${err.message}`, 'err');
		} finally {
			btn.disabled = false;
		}
	}

	// ── Version history + restore ───────────────────────────────────────────
	async function loadVersions() {
		const ul = $('#bs-versions');
		ul.innerHTML = `<li class="bs-empty">Loading…</li>`;
		try {
			const r = await apiFetch(`/api/agents/${agentId}/persona/versions`, { credentials: 'include' });
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j.error_description || `HTTP ${r.status}`);
			const versions = j.versions || [];
			if (!versions.length) {
				ul.innerHTML = `<li class="bs-empty" style="padding:12px">No saved versions yet. Your next save is v1 of this persona.</li>`;
				return;
			}
			ul.innerHTML = versions
				.map(
					(v) => `<li>
						<span class="v">v${v.version}</span>
						<span class="note" title="${esc(v.changelog || '')}">${esc(v.changelog || 'Persona updated')}</span>
						<span class="when">${esc(new Date(v.created_at).toLocaleDateString())}</span>
						<button data-restore="${v.version}">Restore</button>
					</li>`,
				)
				.join('');
			ul.querySelectorAll('[data-restore]').forEach((b) =>
				b.addEventListener('click', () => restore(Number(b.dataset.restore))),
			);
		} catch (err) {
			ul.innerHTML = `<li class="bs-error">Couldn't load history: ${esc(err.message)}</li>`;
		}
	}

	async function restore(version) {
		setStatus(`Restoring v${version}…`);
		try {
			const r = await apiFetch(`/api/agents/${agentId}/persona/restore`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ version }),
			});
			const j = await r.json().catch(() => ({}));
			if (!r.ok) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
			state.traits = clampTraits(j.traits);
			state.toneTags = j.tone_tags || [];
			state.vocabulary = j.vocabulary || [];
			state.base = j.base || '';
			state.saved = {
				traits: { ...state.traits },
				toneTags: [...state.toneTags],
				vocabulary: [...state.vocabulary],
				base: state.base,
				prompt: j.persona_prompt || candidatePrompt(),
			};
			syncControls();
			refreshMeta();
			setStatus(`Restored v${j.restored_from} as v${j.version}.`, 'ok');
			agentBus.emit(EVENTS.BRAIN_UPDATED, {
				agentId,
				personaPrompt: j.persona_prompt,
				toneTags: j.tone_tags,
				change: j.changelog,
			});
			loadVersions();
			schedulePreview();
		} catch (err) {
			setStatus(`Error: ${err.message}`, 'err');
		}
	}

	// ── A/B compare (real dual inference) ───────────────────────────────────
	async function toggleAB() {
		state.abMode = !state.abMode;
		$('#bs-ab-toggle').setAttribute('aria-pressed', String(state.abMode));
		const single = $('#bs-single');
		const abWrap = $('#bs-ab');
		if (state.abMode) {
			// Free the single-preview context before opening two more.
			disposeAvatar();
			single.hidden = true;
			abWrap.hidden = false;
			abWrap.innerHTML = `
				<div class="bs-section-title" style="margin-top:0">A — last saved &nbsp;·&nbsp; B — your edits · same prompt to both</div>
				<div class="bs-ab">
					<div class="bs-ab-side"><h3>A · Saved</h3><div class="bs-stage"><div class="bs-bubble thinking" id="bs-ab-bubble-a">…</div></div><button class="bs-promote" data-promote="a">Keep A (saved)</button></div>
					<div class="bs-ab-side"><h3>B · Your edits</h3><div class="bs-stage"><div class="bs-bubble thinking" id="bs-ab-bubble-b">…</div></div><button class="bs-promote" data-promote="b">Promote B →</button></div>
				</div>`;
			abWrap.querySelector('[data-promote="a"]').addEventListener('click', () => promote('a'));
			abWrap.querySelector('[data-promote="b"]').addEventListener('click', () => promote('b'));
			await ensureAgent3DLib();
			const stages = abWrap.querySelectorAll('.bs-stage');
			abAvatars.a = makeAvatar();
			abAvatars.b = makeAvatar();
			stages[0].insertBefore(abAvatars.a, stages[0].firstChild);
			stages[1].insertBefore(abAvatars.b, stages[1].firstChild);
			runAB();
		} else {
			disposeAB();
			abWrap.hidden = true;
			abWrap.innerHTML = '';
			single.hidden = false;
			await mountAvatar();
			schedulePreview();
		}
	}

	async function runAB() {
		const probe = PROBES.find((p) => p.id === state.probe) || PROBES[0];
		const sides = [
			{ key: 'a', prompt: compilePersona({ name: state.name, description: state.description, base: state.saved.base, traits: state.saved.traits, toneTags: state.saved.toneTags, vocabulary: state.saved.vocabulary }), el: abAvatars.a, bubble: '#bs-ab-bubble-a' },
			{ key: 'b', prompt: candidatePrompt(), el: abAvatars.b, bubble: '#bs-ab-bubble-b' },
		];
		await Promise.all(
			sides.map(async (s) => {
				if (abAborts[s.key]) abAborts[s.key].abort();
				abAborts[s.key] = new AbortController();
				const bub = $(s.bubble);
				if (bub) {
					bub.classList.add('thinking');
					bub.innerHTML = `<span class="bs-dots"><span></span><span></span><span></span></span>`;
				}
				try {
					const reply = await streamPersona({
						agentId,
						personaOverride: s.prompt,
						message: probe.prompt,
						signal: abAborts[s.key].signal,
						onChunk: (_t, full) => {
							if (bub) {
								bub.classList.remove('thinking');
								bub.innerHTML = `${esc(full)}<span class="bs-caret"></span>`;
							}
						},
					});
					if (bub) bub.innerHTML = esc(reply);
					s.el?.speak?.(reply);
				} catch (err) {
					if (err.name === 'AbortError') return;
					if (bub) {
						bub.classList.add('thinking');
						bub.textContent = `Failed: ${err.message}`;
					}
				}
			}),
		);
	}

	async function promote(side) {
		if (side === 'a') {
			// Keep A — revert working edits to the saved baseline.
			state.traits = { ...state.saved.traits };
			state.toneTags = [...state.saved.toneTags];
			state.vocabulary = [...state.saved.vocabulary];
			state.base = state.saved.base;
			syncControls();
			refreshMeta();
			await toggleAB(); // exit compare
			setStatus('Kept the saved persona (A).', 'ok');
			return;
		}
		// Promote B — exit compare, then save the current edits as the winner.
		await toggleAB();
		await save();
	}

	// ── Avatar lifecycle ───────────────────────────────────────────────────────
	function makeAvatar() {
		const el = document.createElement('agent-3d');
		el.setAttribute('agent-id', agentId);
		el.setAttribute('chat', 'off');
		el.setAttribute('mode', 'section');
		el.style.cssText = 'width:100%;height:100%;display:block';
		return el;
	}

	async function mountAvatar() {
		const ok = await ensureAgent3DLib();
		const stage = $('#bs-stage');
		if (!ok || !stage) return;
		avatarEl = makeAvatar();
		stage.insertBefore(avatarEl, stage.firstChild);
	}

	function disposeAvatar() {
		if (previewAbort) previewAbort.abort();
		clearTimeout(previewTimer);
		avatarEl?.remove();
		avatarEl = null;
	}

	function disposeAB() {
		for (const k of ['a', 'b']) {
			abAborts[k]?.abort();
			abAborts[k] = null;
			abAvatars[k]?.remove();
			abAvatars[k] = null;
		}
	}

	// ── Re-run interview modal ──────────────────────────────────────────────
	function openInterview() {
		const QUESTIONS = [
			'How would a close colleague describe the way you communicate?',
			'When you explain something complex, what is your style?',
			'What words, phrases, or metaphors do you reach for often?',
			'How do you handle disagreement or bad news?',
			'What should this agent never sound like?',
		];
		const overlay = document.createElement('div');
		overlay.style.cssText =
			'position:fixed;inset:0;z-index:9999;background:rgba(6,8,12,.72);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:20px';
		overlay.innerHTML = `
			<div role="dialog" aria-modal="true" aria-label="Re-run persona interview" style="background:#11141d;border:1px solid rgba(255,255,255,.12);border-radius:16px;max-width:560px;width:100%;max-height:88vh;overflow:auto;padding:24px">
				<h2 style="margin:0 0 4px;font-size:1.05rem">Re-run the persona interview</h2>
				<p style="margin:0 0 16px;color:rgba(255,255,255,.5);font-size:.8rem">Five answers become a fresh base persona (your trait sliders still apply on top). Limited to 5 runs a day.</p>
				<form id="bs-int-form">
					${QUESTIONS.map((q, i) => `<label style="display:block;margin-bottom:12px"><span style="display:block;font-size:.78rem;font-weight:600;margin-bottom:5px">${i + 1}. ${esc(q)}</span><textarea required minlength="5" maxlength="1000" rows="2" class="bs-input" data-q="${i}" style="resize:vertical"></textarea></label>`).join('')}
					<div style="display:flex;gap:10px;align-items:center;margin-top:8px">
						<button type="submit" class="bs-save">Extract persona</button>
						<button type="button" class="bs-iconbtn" id="bs-int-cancel">Cancel</button>
						<span class="bs-status" id="bs-int-status" role="status" aria-live="polite"></span>
					</div>
				</form>
			</div>`;
		document.body.appendChild(overlay);
		const close = () => overlay.remove();
		overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
		overlay.querySelector('#bs-int-cancel').addEventListener('click', close);
		const firstField = overlay.querySelector('textarea');
		firstField?.focus();
		const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
		document.addEventListener('keydown', escHandler);

		overlay.querySelector('#bs-int-form').addEventListener('submit', async (e) => {
			e.preventDefault();
			const answers = [...overlay.querySelectorAll('[data-q]')].map((t) => t.value.trim());
			const stat = overlay.querySelector('#bs-int-status');
			stat.textContent = 'Extracting…';
			stat.className = 'bs-status';
			try {
				const r = await apiFetch(`/api/agents/${agentId}/persona/extract`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					credentials: 'include',
					body: JSON.stringify({ answers }),
				});
				const j = await r.json().catch(() => ({}));
				if (r.status === 429) throw new Error('Daily limit reached (5 per day). Try again tomorrow.');
				if (!r.ok) throw new Error(j.error_description || j.error || `HTTP ${r.status}`);
				state.base = j.base || '';
				state.toneTags = j.tone_tags || state.toneTags;
				state.vocabulary = j.vocabulary || state.vocabulary;
				if (j.traits) state.traits = clampTraits(j.traits);
				state.saved = {
					traits: { ...state.traits },
					toneTags: [...state.toneTags],
					vocabulary: [...state.vocabulary],
					base: state.base,
					prompt: j.system_prompt || candidatePrompt(),
				};
				syncControls();
				refreshMeta();
				close();
				document.removeEventListener('keydown', escHandler);
				setStatus('New base persona extracted & saved.', 'ok');
				agentBus.emit(EVENTS.BRAIN_UPDATED, { agentId, personaPrompt: j.system_prompt, toneTags: j.tone_tags, change: 'Re-ran persona interview', ts: j.extracted_at || undefined });
				schedulePreview();
			} catch (err) {
				stat.textContent = err.message;
				stat.className = 'bs-status err';
			}
		});
	}

	// ── First paint ────────────────────────────────────────────────────────────
	renderTone();
	renderVocab();
	refreshMeta();
	await mountAvatar();
	// Kick off the first live greeting so the stage isn't a dead body.
	schedulePreview();

	// Hand back a disposer so the host can tear down WebGL contexts on unmount.
	return {
		dispose() {
			disposeAvatar();
			disposeAB();
			voice.cancel();
		},
	};
}
