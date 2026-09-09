/**
 * The panel that renders HomeVoiceLoop's twelve states.
 *
 * Split from the loop deliberately: the loop is the machine and this is the
 * face, so /home/:id, a wall display and the demo surface can all mount the same
 * loop and dress it differently. Everything user-facing about an always-on
 * microphone lives here, which is why it is the file to read when asking "can
 * this thing be listening without me knowing".
 *
 * Four things it guarantees, and they are the four that make always-on listening
 * defensible at all:
 *
 *  - Off by default. The first thing a new user sees is the explanation and a
 *    button, not a live microphone.
 *  - A permanent indicator whenever a track is live. It is not a setting, there
 *    is no way to hide it, and it reads the MediaStreamTrack rather than a flag.
 *  - One tap to mute, which really stops capture. The button reports the track
 *    state back to the user in plain words.
 *  - The pending action is spoken AND shown before it can be confirmed, with the
 *    entity ids visible, because agreeing to something you cannot see is not
 *    agreement.
 */

import { t } from '../home/i18n-home.js';
import { STATES } from './home-voice.js';
import { WAKE_WORDS } from './wake-words.js';

/**
 * Everything the panel says, in one place, so the copy can be read as copy.
 *
 * Each field is a catalog key plus its English source, resolved at render time
 * rather than at module load: this object is evaluated once when the bundle
 * parses, which is before /i18n.js has a catalog, so baking the strings in here
 * would pin the panel to English for the whole session no matter what language
 * the visitor picked.
 */
const COPY = {
	[STATES.OFF]: {
		badge: ['home_voice.off_badge', 'Off'],
		title: ['home_voice.off_title', 'Hands-free is off'],
		body: ['home_voice.off_body', 'Turn it on and you can talk to your house without finding a phone. It stays off until you say so.'],
	},
	[STATES.PERMISSION_PENDING]: {
		badge: ['home_voice.permission_pending_badge', 'Waiting'],
		title: ['home_voice.permission_pending_title', 'Your browser is asking'],
		body: ['home_voice.permission_pending_body', 'Choose Allow in the microphone prompt. Nothing is captured until you do.'],
	},
	[STATES.PERMISSION_DENIED]: {
		badge: ['home_voice.permission_denied_badge', 'Blocked'],
		title: ['home_voice.permission_denied_title', 'The microphone is blocked'],
		body: ['home_voice.permission_denied_body', 'Hands-free needs the mic. You can keep using the agent by typing in the meantime.'],
	},
	[STATES.IDLE]: {
		badge: ['home_voice.idle_badge', 'Listening for the wake word'],
		title: ['home_voice.idle_title', 'Say the wake word'],
		body: ['home_voice.idle_body', 'Everything is being matched on this device. Nothing is sent anywhere until you say it.'],
	},
	[STATES.CAPTURING]: {
		badge: ['home_voice.capturing_badge', 'Listening'],
		title: ['home_voice.capturing_title', 'Go ahead'],
		body: ['home_voice.capturing_body', 'This part of what you say is sent for transcription, and nothing else is.'],
	},
	[STATES.THINKING]: {
		badge: ['home_voice.thinking_badge', 'Thinking'],
		title: ['home_voice.thinking_title', 'Working on it'],
		body: ['home_voice.thinking_body', 'Reading the house and deciding what to do.'],
	},
	[STATES.SPEAKING]: {
		badge: ['home_voice.speaking_badge', 'Speaking'],
		title: ['home_voice.speaking_title', 'Answering'],
		body: ['home_voice.speaking_body', 'Talk over it any time and it will stop.'],
	},
	[STATES.BARGED_IN]: {
		badge: ['home_voice.barged_in_badge', 'Interrupted'],
		title: ['home_voice.barged_in_title', 'Stopped'],
		body: ['home_voice.barged_in_body', 'Listening to you instead.'],
	},
	[STATES.CONFIRM_PENDING]: {
		badge: ['home_voice.confirm_pending_badge', 'Waiting for you'],
		title: ['home_voice.confirm_pending_title', 'This one needs a yes'],
		body: ['home_voice.confirm_pending_body', 'Say the word confirm, or press the button. Nothing else counts.'],
	},
	[STATES.UNAVAILABLE]: {
		badge: ['home_voice.unavailable_badge', 'Unavailable'],
		title: ['home_voice.unavailable_title', 'Voice is not available here'],
		body: ['home_voice.unavailable_body', 'Speech recognition is not configured in this deployment, so the microphone stays off.'],
	},
	[STATES.MUTED]: {
		badge: ['home_voice.muted_badge', 'Muted'],
		title: ['home_voice.muted_title', 'The microphone is stopped'],
		body: ['home_voice.muted_body', 'Capture is stopped at the device, not hidden behind a setting.'],
	},
	[STATES.ERROR]: {
		badge: ['home_voice.error_badge', 'Problem'],
		title: ['home_voice.error_title', 'Something went wrong'],
		body: ['home_voice.error_body', ''],
	},
};

const CONSENT_POINTS = [
	['home_voice.consent_1', 'The wake word is matched here, in this tab, by a model downloaded to your device. That audio never leaves.'],
	['home_voice.consent_2', 'Only what you say after the wake word is uploaded, and only to transcribe it.'],
	['home_voice.consent_3', 'Nothing is kept. The audio is not stored on our servers once the request is answered.'],
	['home_voice.consent_4', 'While the microphone is live there is an indicator on this page that cannot be turned off.'],
	['home_voice.consent_5', 'One tap on Mute stops the microphone at the device. You can turn hands-free off completely at any time.'],
];

export class HomeVoicePanel {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.mount
	 * @param {import('./home-voice.js').HomeVoiceLoop} opts.loop
	 */
	constructor({ mount, loop }) {
		if (!mount) throw new Error('HomeVoicePanel requires a mount element');
		if (!loop) throw new Error('HomeVoicePanel requires a HomeVoiceLoop');
		this.mount = mount;
		this.loop = loop;
		this.transcript = [];
		this._indicatorTimer = 0;
		this._wakeScore = 0;

		this.mount.classList.add('hv');
		this._build();

		loop.onState = (state, detail) => this._render(state, detail);
		const priorEvent = loop.onEvent;
		loop.onEvent = (event) => {
			priorEvent?.(event);
			this._onEvent(event);
		};
		this._render(loop.state, loop.stateDetail);
		// The indicator reads the live track, not the state machine, so a stuck
		// state can never leave a live microphone unlabelled.
		this._indicatorTimer = setInterval(() => this._syncIndicator(), 250);
	}

	destroy() {
		clearInterval(this._indicatorTimer);
		this.mount.replaceChildren();
		this.mount.classList.remove('hv');
	}

	_build() {
		this.mount.replaceChildren();
		this.mount.innerHTML = `
			<div class="hv-indicator" data-live="false" role="status" aria-live="polite">
				<span class="hv-dot" aria-hidden="true"></span>
				<span class="hv-indicator-text" data-i18n="home_voice.mic_off">Microphone off</span>
			</div>
			<div class="hv-head">
				<div>
					<span class="hv-badge" data-state="off" data-i18n="home_voice.off_badge">Off</span>
					<h2 class="hv-title" data-i18n="home_voice.off_title">Hands-free is off</h2>
					<p class="hv-body"></p>
				</div>
				<div class="hv-actions"></div>
			</div>
			<div class="hv-consent" hidden>
				<h3 data-i18n="home_voice.consent_heading">Before you turn this on</h3>
				<ul class="hv-consent-list"></ul>
				<div class="hv-consent-actions">
					<button type="button" class="hv-btn hv-btn-primary" data-act="consent" data-i18n="home_voice.act_consent">Turn on hands-free</button>
					<button type="button" class="hv-btn" data-act="cancel-consent" data-i18n="home_voice.act_not_now">Not now</button>
				</div>
			</div>
			<div class="hv-recovery" hidden></div>
			<div class="hv-confirm" hidden>
				<p class="hv-confirm-sentence"></p>
				<ul class="hv-confirm-entities"></ul>
				<p class="hv-confirm-hint" data-i18n-html="home_voice.confirm_hint">Say <strong>confirm</strong> to continue. A general yes does not count.</p>
				<div class="hv-confirm-actions">
					<button type="button" class="hv-btn hv-btn-primary" data-act="confirm" data-i18n="home_voice.act_confirm">Confirm</button>
					<button type="button" class="hv-btn" data-act="cancel-confirm" data-i18n="home_voice.act_cancel">Cancel</button>
				</div>
				<div class="hv-confirm-timer"><span></span></div>
			</div>
			<div class="hv-meter" hidden aria-hidden="true"><span class="hv-meter-fill"></span></div>
			<ol class="hv-transcript" aria-label="Conversation" data-i18n-attr="aria-label:home_voice.transcript_aria"></ol>
			<div class="hv-settings">
				<label class="hv-field">
					<span data-i18n="home_voice.wake_word">Wake word</span>
					<select class="hv-wake" aria-label="Wake word" data-i18n-attr="aria-label:home_voice.wake_word"></select>
				</label>
				<p class="hv-wake-hint"></p>
			</div>
			<dl class="hv-latency" aria-label="Measured latency" data-i18n-attr="aria-label:home_voice.latency_aria"></dl>
		`;

		this.el = {
			indicator: this.mount.querySelector('.hv-indicator'),
			indicatorText: this.mount.querySelector('.hv-indicator-text'),
			badge: this.mount.querySelector('.hv-badge'),
			title: this.mount.querySelector('.hv-title'),
			body: this.mount.querySelector('.hv-body'),
			actions: this.mount.querySelector('.hv-actions'),
			consent: this.mount.querySelector('.hv-consent'),
			consentList: this.mount.querySelector('.hv-consent-list'),
			recovery: this.mount.querySelector('.hv-recovery'),
			confirm: this.mount.querySelector('.hv-confirm'),
			confirmSentence: this.mount.querySelector('.hv-confirm-sentence'),
			confirmEntities: this.mount.querySelector('.hv-confirm-entities'),
			confirmTimer: this.mount.querySelector('.hv-confirm-timer span'),
			meter: this.mount.querySelector('.hv-meter'),
			meterFill: this.mount.querySelector('.hv-meter-fill'),
			transcript: this.mount.querySelector('.hv-transcript'),
			wake: this.mount.querySelector('.hv-wake'),
			wakeHint: this.mount.querySelector('.hv-wake-hint'),
			latency: this.mount.querySelector('.hv-latency'),
		};

		for (const [key, source] of CONSENT_POINTS) {
			const li = document.createElement('li');
			li.textContent = t(key, source);
			this.el.consentList.appendChild(li);
		}

		for (const w of WAKE_WORDS) {
			const option = document.createElement('option');
			option.value = w.id;
			option.textContent = w.phrase;
			this.el.wake.appendChild(option);
		}
		this.el.wake.value = this.loop.settings.wakeWord;
		this._renderWakeHint();
		this.el.wake.addEventListener('change', () => {
			this.loop.saveSettings({ wakeWord: this.el.wake.value });
			this._renderWakeHint();
		});

		this.mount.addEventListener('click', (event) => this._onClick(event));
	}

	_renderWakeHint() {
		const def = WAKE_WORDS.find((w) => w.id === this.el.wake.value);
		this.el.wakeHint.textContent = def ? def.hint : '';
	}

	async _onClick(event) {
		const act = event.target.closest('[data-act]')?.dataset.act;
		if (!act) return;
		switch (act) {
			case 'ask-consent':
				this.el.consent.hidden = false;
				this.el.consent.querySelector('[data-act="consent"]')?.focus();
				break;
			case 'cancel-consent':
				this.el.consent.hidden = true;
				break;
			case 'consent':
				this.el.consent.hidden = true;
				this.loop.grantConsent();
				await this.loop.enable();
				break;
			case 'mute':
				await this.loop.mute();
				break;
			case 'unmute':
				await this.loop.unmute();
				break;
			case 'off':
				await this.loop.revokeConsent();
				break;
			case 'retry':
				await this.loop.enable();
				break;
			case 'confirm':
				await this.loop.confirmPending();
				break;
			case 'cancel-confirm':
				this.loop.cancelConfirmation();
				break;
			default:
				break;
		}
	}

	_onEvent(event) {
		switch (event.type) {
			case 'wake-score':
				this._wakeScore = event.score;
				this.el.meterFill.style.transform = `scaleX(${Math.min(1, Math.max(0, event.score))})`;
				break;
			case 'transcript':
				this._appendLine('you', event.text);
				break;
			case 'wake':
				// The wake phrase is a setting the user chose, interpolated rather
				// than folded into the sentence.
				this._appendLine('system', t('home_voice.line_woke', 'Woke on "{{phrase}}" ({{score}}).', { phrase: wakePhrase(event.wakeWord), score: event.score.toFixed(2) }));
				break;
			case 'barge-in':
				this._appendLine('system', t('home_voice.line_barge_in', 'You interrupted, so it stopped talking.'));
				break;
			case 'guarded-refused':
				this._appendLine('system', t('home_voice.line_guarded_refused', 'Refused: a guarded action cannot be confirmed by voice on a screenless device.'));
				break;
			case 'confirmation-not-token':
				this._appendLine('system', t('home_voice.line_not_token', 'That was not the word confirm, so nothing was unlocked.'));
				break;
			case 'confirmation-executed':
				this._appendLine('system', t('home_voice.line_confirmed', 'Confirmed and carried out.'));
				break;
			case 'confirmation-closed':
				if (event.reason === 'expired') this._appendLine('system', t('home_voice.line_expired', 'The confirmation expired. Nothing changed.'));
				if (event.reason === 'cancelled') this._appendLine('system', t('home_voice.line_cancelled', 'Cancelled. Nothing changed.'));
				break;
			case 'tts-failed':
				this._appendLine('agent', event.text);
				break;
			case 'latency':
				this._renderLatency();
				break;
			default:
				break;
		}
	}

	_appendLine(who, text) {
		const li = document.createElement('li');
		li.className = `hv-line hv-line-${who}`;
		li.textContent = text;
		this.el.transcript.appendChild(li);
		while (this.el.transcript.children.length > 40) this.el.transcript.firstElementChild.remove();
		this.el.transcript.scrollTop = this.el.transcript.scrollHeight;
	}

	_syncIndicator() {
		const live = this.loop.micLive;
		this.el.indicator.dataset.live = String(live);
		this.el.indicatorText.setAttribute('data-i18n-owned', '1');
		this.el.indicatorText.textContent = live
			? this.loop.state === STATES.CAPTURING
				? t('home_voice.mic_live_sending', 'Microphone live, and this is being sent for transcription')
				: t('home_voice.mic_live_local', 'Microphone live, matching the wake word on this device')
			: this.loop.muted
				? t('home_voice.mic_stopped', 'Microphone stopped')
				: t('home_voice.mic_off', 'Microphone off');
	}

	_render(state, detail) {
		const copy = COPY[state] || COPY[STATES.ERROR];
		// The template ships the OFF strings with data-i18n on them, and from the
		// first render onwards this script owns those three nodes: without the
		// marker the catalog pass would put "Hands-free is off" back over a live
		// "Listening" the moment the locale finished loading.
		for (const node of [this.el.badge, this.el.title, this.el.body]) node.setAttribute('data-i18n-owned', '1');
		this.el.badge.textContent = t(...copy.badge);
		this.el.badge.dataset.state = state;
		this.el.title.textContent = t(...copy.title);
		this.el.body.textContent = detail?.message || detail?.reason || detail?.note || t(...copy.body);
		this.mount.dataset.state = state;
		this._syncIndicator();

		this.el.meter.hidden = state !== STATES.IDLE;
		this.el.recovery.hidden = true;
		this.el.confirm.hidden = state !== STATES.CONFIRM_PENDING;

		if (state === STATES.PERMISSION_DENIED && detail?.recovery) {
			this.el.recovery.hidden = false;
			this.el.recovery.textContent = detail.recovery;
		}

		if (state === STATES.CONFIRM_PENDING && detail?.confirmation) {
			this._renderConfirmation(detail.confirmation);
		}

		if (state === STATES.SPEAKING && detail?.text) this._appendLine('agent', detail.text);

		this._renderActions(state);
	}

	_renderConfirmation(confirmation) {
		this.el.confirmSentence.textContent = confirmation.sentence;
		this.el.confirmEntities.replaceChildren();
		// The friendly name is what a person recognises and the entity id is what
		// actually moves, so both are shown. textContent, always: both strings come
		// from a device or another household member and are rendered as data.
		const named = new Map((confirmation.entities || []).map((e) => [e.entityId, e.name]));
		for (const id of confirmation.entityIds) {
			const li = document.createElement('li');
			const name = named.get(id);
			li.textContent = name ? `${name} (${id})` : id;
			this.el.confirmEntities.appendChild(li);
		}
		const started = Date.now();
		const total = confirmation.expiresInMs;
		const tick = () => {
			if (this.loop.pendingConfirmation !== confirmation) return;
			const left = Math.max(0, total - (Date.now() - started));
			this.el.confirmTimer.style.transform = `scaleX(${left / total})`;
			if (left > 0) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	}

	_renderActions(state) {
		const buttons = [];
		if (state === STATES.OFF) {
			buttons.push(['ask-consent', t('home_voice.act_consent', 'Turn on hands-free'), true]);
		} else if (state === STATES.PERMISSION_DENIED || state === STATES.ERROR) {
			buttons.push(['retry', t('home_voice.act_retry', 'Try again'), true]);
			buttons.push(['off', t('home_voice.act_off', 'Turn hands-free off'), false]);
		} else if (state === STATES.MUTED) {
			buttons.push(['unmute', t('home_voice.act_unmute', 'Unmute'), true]);
			buttons.push(['off', t('home_voice.act_off', 'Turn hands-free off'), false]);
		} else if (state !== STATES.UNAVAILABLE && state !== STATES.PERMISSION_PENDING) {
			buttons.push(['mute', t('home_voice.act_mute', 'Mute'), false]);
			buttons.push(['off', t('home_voice.act_off', 'Turn hands-free off'), false]);
		}
		this.el.actions.replaceChildren();
		for (const [act, label, primary] of buttons) {
			const btn = document.createElement('button');
			btn.type = 'button';
			btn.className = `hv-btn${primary ? ' hv-btn-primary' : ''}`;
			btn.dataset.act = act;
			btn.textContent = label;
			this.el.actions.appendChild(btn);
		}
	}

	_renderLatency() {
		const summary = this.loop.latencySummary();
		const budgets = {
			wake: 200,
			endpoint: 400,
			asr: 900,
			turn: 1200,
			toolCall: 1200,
			action: 700,
			firstAudio: 1800,
		};
		const labels = {
			wake: t('home_voice.wake_word', 'Wake word'),
			endpoint: t('home_voice.leg_endpoint', 'End of speech'),
			asr: t('home_voice.leg_asr', 'Transcription'),
			turn: t('home_voice.leg_turn', 'Agent turn'),
			toolCall: t('home_voice.leg_tool_call', 'First tool call'),
			action: t('home_voice.leg_action', 'Action to device'),
			firstAudio: t('home_voice.leg_first_audio', 'First audible reply'),
			tts: t('home_voice.leg_tts', 'Speech synthesis'),
		};
		this.el.latency.replaceChildren();
		for (const [leg, stats] of Object.entries(summary)) {
			// Each pair is wrapped so the label and its number stay together when the
			// grid wraps. A bare dt/dd sequence in an auto-fit grid splits them across
			// rows, which reads as the wrong number against the wrong leg.
			const pair = document.createElement('div');
			pair.className = 'hv-leg';
			const dt = document.createElement('dt');
			dt.textContent = labels[leg] || leg;
			const dd = document.createElement('dd');
			dd.textContent = t('home_voice.ms', '{{n}} ms', { n: stats.median });
			const budget = budgets[leg];
			if (budget) {
				dd.dataset.over = String(stats.median > budget);
				dd.title = t('home_voice.budget', 'Budget {{budget}} ms, worst {{worst}} ms over {{count}}', { budget, worst: stats.worst, count: stats.count });
			}
			pair.append(dt, dd);
			this.el.latency.appendChild(pair);
		}
	}
}

function wakePhrase(id) {
	return WAKE_WORDS.find((w) => w.id === id)?.phrase || id;
}
