// Facial-emotion controls for an Audio2Face-3D page.
//
// Mounts an intent picker, an on/off switch, a strength slider and live meters
// for the emotion Audio2Face is applying, and turns the choice into the
// /api/a2f request fields ({ emotion, emotionStrength }). The same choice is
// applied live to the A2FPlayer (setEmotionOptions), so the switch and the
// slider also change the line that is already playing; the intent applies from
// the next spoken line. URL params preset it: ?emotion=auto|off|<intent> and
// ?emotionStrength=0..1.
//
// Self-contained (markup plus scoped styles), so any page that owns an
// A2FPlayer hosts it with mountEmotionPanel(container, { player }), hands
// panel.requestFields as the `emotion` getter of createDigitalHumanClient,
// calls panel.noteIntent with each 'intent' SSE event's emotion, and calls
// panel.paint with player.currentEmotion() every animation frame.

export const EMOTION_INTENTS = [
	['auto', 'Auto: read it from the words'],
	['neutral', 'Neutral: let the voice decide'],
	['joy', 'Joy'],
	['celebration', 'Celebration'],
	['curiosity', 'Curiosity'],
	['surprised', 'Surprised'],
	['concern', 'Concern'],
	['empathy', 'Empathy'],
	['sad', 'Sad'],
	['angry', 'Angry'],
];

/** The A2F channels worth a meter (outofbreath and pain stay near zero in speech). */
export const EMOTION_METERS = ['joy', 'amazement', 'cheekiness', 'sadness', 'grief', 'anger', 'fear', 'disgust'];

const DEFAULT_STRENGTH = 60;

/**
 * Read the initial choice from URL params.
 * @returns {{ enabled:boolean, intent:string, strength:number }} strength 0..100
 */
export function emotionChoiceFromParams(params) {
	const out = { enabled: true, intent: 'auto', strength: DEFAULT_STRENGTH };
	const want = String(params?.get?.('emotion') || '').trim().toLowerCase();
	if (want === 'off') out.enabled = false;
	else if (EMOTION_INTENTS.some(([v]) => v === want)) out.intent = want;
	const raw = params?.get?.('emotionStrength');
	if (raw != null && raw !== '') {
		const n = Number(raw);
		if (Number.isFinite(n)) out.strength = Math.round(Math.max(0, Math.min(1, n)) * 100);
	}
	if (out.strength === 0) out.enabled = false;
	return out;
}

/** The /api/a2f fields for a choice. */
export function emotionRequestFields({ enabled, intent, strength }) {
	if (!enabled || !(strength > 0)) return { emotion: 'off' };
	return { emotion: intent || 'auto', emotionStrength: Math.round(strength) / 100 };
}

/** One line describing what the face did with a line's emotion. */
export function describeEmotion(intent, appliedDominant) {
	if (!intent) return '';
	if (intent.label === 'off') return 'emotion off: neutral face';
	const from = intent.source === 'text' ? ' (read from the words)' : intent.source === 'audio' ? ' (from the voice)' : '';
	const applied = appliedDominant ? `, face shows ${appliedDominant}` : '';
	return `intent ${intent.label}${from}${applied}`;
}

let stylesInjected = false;
function injectStyles(doc) {
	if (stylesInjected) return;
	stylesInjected = true;
	const style = doc.createElement('style');
	style.dataset.emotionPanel = '';
	style.textContent = `
.emo-panel { display: flex; flex-direction: column; gap: 9px; border-top: 1px solid #161c17; padding-top: 12px; }
.emo-panel .emo-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.emo-panel .emo-title { font-size: 12px; color: #8a8d98; text-transform: uppercase; letter-spacing: 0.08em; }
.emo-panel .emo-switch { position: relative; display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-size: 12px; color: #cfeede; }
.emo-panel .emo-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; }
.emo-panel .emo-track { width: 34px; height: 20px; border-radius: 999px; background: #1c241d; border: 1px solid #2a382c; position: relative; transition: background var(--duration-fast, 120ms) var(--ease-standard, ease), border-color var(--duration-fast, 120ms) var(--ease-standard, ease); }
.emo-panel .emo-track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: #8a8d98; transition: transform var(--duration-fast, 120ms) var(--ease-standard, ease), background var(--duration-fast, 120ms) var(--ease-standard, ease); }
.emo-panel .emo-switch input:checked + .emo-track { background: #1f4a31; border-color: #2c6b46; }
.emo-panel .emo-switch input:checked + .emo-track::after { transform: translateX(14px); background: #76e0a1; }
.emo-panel .emo-switch:hover .emo-track { border-color: #3d8a5e; }
.emo-panel .emo-switch:active .emo-track::after { width: 17px; }
.emo-panel .emo-switch input:focus-visible + .emo-track { outline: 2px solid #fff; outline-offset: 2px; }
.emo-panel select { width: 100%; background: #070807; border: 1px solid #1c241d; color: #eee; padding: 9px 10px; border-radius: 9px; font: inherit; cursor: pointer; transition: border-color var(--duration-fast, 120ms) var(--ease-standard, ease); }
.emo-panel select:hover:not(:disabled) { border-color: #2c6b46; }
.emo-panel select:focus-visible { outline: 2px solid #2c6b46; outline-offset: 1px; }
.emo-panel .emo-strength { display: grid; grid-template-columns: 1fr 44px; gap: 10px; align-items: center; }
.emo-panel input[type=range] { width: 100%; accent-color: #76e0a1; cursor: pointer; }
.emo-panel input[type=range]:hover:not(:disabled) { filter: brightness(1.12); }
.emo-panel input[type=range]:active:not(:disabled) { cursor: grabbing; }
.emo-panel input[type=range]:focus-visible { outline: 2px solid #fff; outline-offset: 3px; border-radius: 4px; }
.emo-panel select:disabled, .emo-panel input[type=range]:disabled { opacity: 0.45; cursor: not-allowed; }
.emo-panel output { font: 12px ui-monospace, monospace; color: #cfeede; text-align: right; }
.emo-panel .emo-meters { display: flex; flex-direction: column; gap: 5px; }
.emo-panel .emo-row { display: grid; grid-template-columns: 96px 1fr; gap: 8px; align-items: center; font: 11.5px ui-monospace, monospace; color: #8a8d98; }
.emo-panel .emo-bar { height: 7px; border-radius: 4px; background: rgba(143, 183, 255, 0.12); overflow: hidden; }
.emo-panel .emo-bar > span { display: block; height: 100%; width: 0%; border-radius: 4px; background: linear-gradient(90deg, #4a7bd1, #8fb7ff); transition: width var(--duration-instant, 60ms) var(--ease-standard, ease); }
.emo-panel .emo-note { font-size: 12px; color: #8a8d98; line-height: 1.45; min-height: 1.45em; }
`;
	doc.head.appendChild(style);
}

/**
 * @param {HTMLElement} container
 * @param {{ player?:{ setEmotionOptions?:Function }, params?:URLSearchParams, idPrefix?:string,
 *   onChange?:(choice:object)=>void }} opts
 */
export function mountEmotionPanel(container, { player = null, params = null, idPrefix = 'emo', onChange } = {}) {
	const doc = container.ownerDocument;
	injectStyles(doc);
	const choice = emotionChoiceFromParams(params || new URLSearchParams(doc.defaultView?.location?.search || ''));
	const id = (s) => `${idPrefix}-${s}`;

	const root = doc.createElement('section');
	root.className = 'emo-panel';
	root.setAttribute('aria-labelledby', id('title'));

	const head = doc.createElement('div');
	head.className = 'emo-head';
	const title = doc.createElement('label');
	title.className = 'emo-title';
	title.id = id('title');
	title.htmlFor = id('intent');
	title.textContent = 'Facial emotion';
	const sw = doc.createElement('label');
	sw.className = 'emo-switch';
	sw.title = 'Off asks Audio2Face for a neutral face';
	const toggle = doc.createElement('input');
	toggle.type = 'checkbox';
	toggle.id = id('on');
	toggle.setAttribute('role', 'switch');
	const track = doc.createElement('span');
	track.className = 'emo-track';
	track.setAttribute('aria-hidden', 'true');
	const swText = doc.createElement('span');
	sw.append(toggle, track, swText);
	head.append(title, sw);

	const select = doc.createElement('select');
	select.id = id('intent');
	for (const [value, label] of EMOTION_INTENTS) select.add(new Option(label, value));

	const strengthRow = doc.createElement('div');
	strengthRow.className = 'emo-strength';
	const slider = doc.createElement('input');
	slider.type = 'range';
	slider.min = '0';
	slider.max = '100';
	slider.step = '5';
	slider.id = id('strength');
	slider.setAttribute('aria-label', 'Emotion strength');
	const out = doc.createElement('output');
	out.htmlFor = id('strength');
	strengthRow.append(slider, out);

	const meters = doc.createElement('div');
	meters.className = 'emo-meters';
	meters.setAttribute('aria-hidden', 'true');
	const bars = new Map();
	for (const key of EMOTION_METERS) {
		const row = doc.createElement('div');
		row.className = 'emo-row';
		const name = doc.createElement('span');
		name.textContent = key;
		const bar = doc.createElement('span');
		bar.className = 'emo-bar';
		const fill = doc.createElement('span');
		bar.appendChild(fill);
		row.append(name, bar);
		meters.appendChild(row);
		bars.set(key, fill);
	}

	const note = doc.createElement('div');
	note.className = 'emo-note';
	note.setAttribute('role', 'status');
	note.textContent = 'Brows, eyes, cheeks and the head follow the feeling of each line. Auto reads it from the words.';

	root.append(head, select, strengthRow, meters, note);
	container.appendChild(root);

	function sync() {
		choice.enabled = toggle.checked && Number(slider.value) > 0;
		choice.intent = select.value;
		choice.strength = Number(slider.value);
		swText.textContent = toggle.checked ? 'On' : 'Off';
		select.disabled = !toggle.checked;
		slider.disabled = !toggle.checked;
		out.textContent = toggle.checked ? `${slider.value}%` : 'off';
		player?.setEmotionOptions?.({ enabled: choice.enabled, strength: choice.strength / 100 });
		onChange?.({ ...choice });
	}

	toggle.checked = choice.enabled;
	select.value = choice.intent;
	slider.value = String(choice.strength || DEFAULT_STRENGTH);
	toggle.addEventListener('change', sync);
	select.addEventListener('change', sync);
	slider.addEventListener('input', sync);
	sync();

	let lastIntent = null;
	let peakName = null;
	let peakValue = 0;

	return {
		element: root,
		/** Current choice: { enabled, intent, strength (0..100) }. */
		choice: () => ({ ...choice }),
		/** Fields for an /api/a2f request body. */
		requestFields: () => emotionRequestFields(choice),
		/** Point the live options at another A2FPlayer (after a rig swap). */
		setPlayer(p) {
			player = p;
			sync();
		},
		/** Record the intent the server resolved for the line now being voiced. */
		noteIntent(intent) {
			if (!intent) return;
			lastIntent = intent;
			peakName = null;
			peakValue = 0;
			this.renderNote();
		},
		renderNote() {
			if (!lastIntent) return;
			note.textContent = describeEmotion(lastIntent, peakName);
		},
		/** Paint the meters from player.currentEmotion() (null clears them). */
		paint(frame) {
			let changed = false;
			for (const key of EMOTION_METERS) {
				const v = Math.max(0, Math.min(1, Number(frame?.[key]) || 0));
				bars.get(key).style.width = `${(v * 100).toFixed(0)}%`;
				if (v > 0.08 && v > peakValue) {
					if (peakName !== key) changed = true;
					peakValue = v;
					peakName = key;
				}
			}
			if (changed) this.renderNote();
		},
	};
}
