/**
 * AgentPanel — floating chat panel with voice I/O.
 *
 * Drop-in UI for any ERC-8004 agent. Bring your own response logic
 * via the onMessage callback.
 *
 * Usage:
 *   const panel = new AgentPanel({
 *     title: 'My Agent',
 *     welcome: 'Hi! How can I help?',
 *     onMessage: async (text) => 'your response here',
 *   });
 *   panel.mount(document.body);
 */

const SpeechRecognition =
	typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);

export class AgentPanel {
	/**
	 * @param {object} opts
	 * @param {string}   [opts.title]      Panel header title
	 * @param {string}   [opts.welcome]    First message shown in the panel
	 * @param {string}   [opts.placeholder] Input placeholder text
	 * @param {Function} [opts.onMessage]  async (text: string) => string — your response handler
	 * @param {boolean}  [opts.voice]      Enable text-to-speech on agent responses (default: true)
	 */
	constructor({
		title = 'Agent',
		welcome = 'Hi! How can I help?',
		placeholder = 'Ask anything...',
		onMessage,
		voice = true,
	} = {}) {
		this.title = title;
		this.welcome = welcome;
		this.placeholder = placeholder;
		this.onMessage = onMessage || (() => "I'm not sure how to answer that.");
		this.voice = voice;

		this.synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
		this.recognition = null;
		this.isListening = false;
		this.panel = null;
		this.toggleBtn = null;
	}

	// ---------------------------------------------------------------------------
	// Public API
	// ---------------------------------------------------------------------------

	/**
	 * Attach the panel to a DOM element.
	 * @param {HTMLElement} container
	 * @returns {AgentPanel} this (chainable)
	 */
	mount(container) {
		this._buildUI(container);
		this._initSpeech();
		return this;
	}

	/** Show the panel. */
	open() {
		if (this.panel) {
			this.panel.style.display = 'flex';
			this.toggleBtn?.classList.add('ak-active');
			this.panel.querySelector('.ak-input')?.focus();
		}
	}

	/** Hide the panel. */
	close() {
		if (this.panel) {
			this.panel.style.display = 'none';
			this.toggleBtn?.classList.remove('ak-active');
		}
	}

	/** Add a message programmatically. */
	addMessage(role, text) {
		this._addMessage(role, text);
	}

	/** Remove the panel and toggle button from the DOM. */
	dispose() {
		if (this.recognition) this.recognition.stop();
		this.synth?.cancel();
		this.panel?.remove();
		this.toggleBtn?.remove();
	}

	// ---------------------------------------------------------------------------
	// Internal
	// ---------------------------------------------------------------------------

	_buildUI(container) {
		this.panel = document.createElement('div');
		this.panel.className = 'ak-panel';
		this.panel.style.display = 'none';
		this.panel.innerHTML = `
			<div class="ak-header">
				<span class="ak-title">${this.title}</span>
				<button class="ak-close" aria-label="Close">&times;</button>
			</div>
			<div class="ak-messages">
				<div class="ak-message ak-agent">${this.welcome}</div>
			</div>
			<div class="ak-controls">
				<input type="text" class="ak-input" placeholder="${this.placeholder}" autocomplete="off" />
				<button class="ak-send" aria-label="Send">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
				</button>
			</div>
			<div class="ak-mic-row">
				<button class="ak-mic" aria-label="Toggle microphone">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
				</button>
			</div>
		`;
		container.appendChild(this.panel);

		this.toggleBtn = document.createElement('button');
		this.toggleBtn.className = 'ak-toggle';
		this.toggleBtn.setAttribute('aria-label', `Open ${this.title}`);
		this.toggleBtn.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>
		`;
		container.appendChild(this.toggleBtn);

		this.toggleBtn.addEventListener('click', () => this._toggle());
		this.panel.querySelector('.ak-close').addEventListener('click', () => this.close());
		this.panel.querySelector('.ak-send').addEventListener('click', () => this._send());
		this.panel.querySelector('.ak-input').addEventListener('keydown', (e) => {
			if (e.key === 'Enter') this._send();
		});
		this.panel.querySelector('.ak-mic').addEventListener('click', () => this._toggleMic());
	}

	_initSpeech() {
		if (!SpeechRecognition) return;

		this.recognition = new SpeechRecognition();
		this.recognition.continuous = false;
		this.recognition.interimResults = false;
		this.recognition.lang = 'en-US';

		this.recognition.onresult = (event) => {
			const text = event.results[0][0].transcript;
			this._addMessage('ak-user', text);
			this._respond(text);
		};

		this.recognition.onend = () => this._setListening(false);
		this.recognition.onerror = () => this._setListening(false);
	}

	_toggle() {
		const visible = this.panel.style.display !== 'none';
		visible ? this.close() : this.open();
	}

	_send() {
		const input = this.panel.querySelector('.ak-input');
		const text = input.value.trim();
		if (!text) return;
		input.value = '';
		this._addMessage('ak-user', text);
		this._respond(text);
	}

	async _respond(text) {
		const thinking = this._addMessage('ak-agent', '...');
		try {
			const reply = await Promise.resolve(this.onMessage(text));
			thinking.textContent = reply;
			if (this.voice) this._speak(reply);
		} catch (err) {
			thinking.textContent = 'Something went wrong. Please try again.';
		}
		const msgs = this.panel.querySelector('.ak-messages');
		msgs.scrollTop = msgs.scrollHeight;
	}

	_addMessage(role, text) {
		const msgs = this.panel.querySelector('.ak-messages');
		const el = document.createElement('div');
		el.className = `ak-message ${role}`;
		el.textContent = text;
		msgs.appendChild(el);
		msgs.scrollTop = msgs.scrollHeight;
		return el;
	}

	_speak(text) {
		if (!this.synth || !this.voice) return;
		this.synth.cancel();
		const u = new SpeechSynthesisUtterance(text);
		u.rate = 1.0;
		u.pitch = 1.0;
		u.volume = 0.8;
		this.synth.speak(u);
	}

	_toggleMic() {
		if (!this.recognition) {
			this._addMessage('ak-agent', 'Speech recognition is not supported in this browser.');
			return;
		}
		if (this.isListening) {
			this.recognition.stop();
		} else {
			this.recognition.start();
			this._setListening(true);
		}
	}

	_setListening(val) {
		this.isListening = val;
		this.panel.querySelector('.ak-mic')?.classList.toggle('ak-active', val);
	}
}
