/**
 * NichAgent — Voice + Chat Interface
 * ------------------------------------
 * The conversational surface of the 3D agent.
 * Now protocol-aware: responses go through the AgentProtocol bus,
 * which drives the avatar's Empathy Layer and action timeline.
 *
 * Skills-aware: routes recognised intents to AgentSkills.perform()
 * so the avatar performs them visibly, not just textually.
 */

import { ACTION_TYPES } from './agent-protocol.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export class NichAgent {
	/**
	 * @param {HTMLElement}                                        containerEl
	 * @param {import('./agent-protocol.js').AgentProtocol}        [protocol]
	 * @param {import('./agent-skills.js').AgentSkills}            [skills]
	 * @param {import('./agent-identity.js').AgentIdentity}        [identity]
	 * @param {import('./runtime/index.js').Runtime}               [runtime]
	 */
	constructor(containerEl, protocol = null, skills = null, identity = null, runtime = null) {
		this.container  = containerEl;
		this.protocol   = protocol;
		this.skills     = skills;
		this.identity   = identity;
		this.runtime    = runtime;
		this.isSpeaking = false;
		this.isListening = false;
		this.recognition = null;
		this.synth      = window.speechSynthesis;
		this.messages   = [];
		this.onFirstOpen = null;
		this._hasOpened  = false;

		this._buildUI();
		this._initSpeechRecognition();

		// Listen for SPEAK actions to render them in the chat
		if (this.protocol) {
			this.protocol.on(ACTION_TYPES.SPEAK, (action) => {
				const text = action.payload?.text;
				if (text) {
					this._addMessage('agent', text);
					this._speak(text);
				}
			});

			// Show skill status in chat
			this.protocol.on(ACTION_TYPES.PERFORM_SKILL, (action) => {
				const skill = action.payload?.skill;
				if (skill && skill !== 'greet') {
					this._addMessage('agent', `[performing: ${skill}]`, 'status');
				}
			});
		}
	}

	// ── Speech Recognition ────────────────────────────────────────────────────

	_initSpeechRecognition() {
		if (!SpeechRecognition) return;

		this.recognition = new SpeechRecognition();
		this.recognition.continuous      = false;
		this.recognition.interimResults  = false;
		this.recognition.lang            = 'en-US';

		this.recognition.onresult = (event) => {
			const text = event.results[0][0].transcript;
			this._addMessage('user', text);
			this._handleInput(text);
		};

		this.recognition.onend = () => {
			this.isListening = false;
			this.panel.querySelector('.nich-mic').classList.remove('active');
		};

		this.recognition.onerror = () => {
			this.isListening = false;
			this.panel.querySelector('.nich-mic').classList.remove('active');
		};
	}

	// ── UI ────────────────────────────────────────────────────────────────────

	_buildUI() {
		this.panel = document.createElement('div');
		this.panel.className  = 'nich-panel';
		this.panel.innerHTML  = `
			<div class="nich-header">
				<span class="nich-title">${this.identity?.name || 'Agent'}</span>
				<div class="nich-header-right">
					<span class="nich-emotion-dot" id="nich-emotion-dot" title="Agent emotional state"></span>
					<button class="nich-close" aria-label="Close">&times;</button>
				</div>
			</div>
			<div class="nich-messages" id="agent-messages">
				<div class="nich-message agent">I'm here. Drop a model, ask me anything, or say "help".</div>
			</div>
			<div class="nich-controls">
				<input type="text" class="nich-input" placeholder="Ask the agent…" autocomplete="off" />
				<button class="nich-send" aria-label="Send">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
				</button>
			</div>
			<div class="nich-mic-row">
				<button class="nich-mic" aria-label="Toggle microphone">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
				</button>
				<span class="nich-mic-hint">or press mic to speak</span>
			</div>
		`;
		this.panel.style.display = 'none';
		this.container.appendChild(this.panel);

		this.toggleBtn = document.createElement('button');
		this.toggleBtn.className = 'nich-toggle';
		this.toggleBtn.setAttribute('aria-label', 'Talk to 3D Agent');
		this.toggleBtn.title = 'Talk to Agent';
		this.toggleBtn.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
				<path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/>
				<path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/>
			</svg>
			<span class="nich-toggle-label">Agent</span>
		`;
		this.container.appendChild(this.toggleBtn);

		this.toggleBtn.addEventListener('click',  () => this._togglePanel());
		this.panel.querySelector('.nich-close').addEventListener('click', () => this._togglePanel());
		this.panel.querySelector('.nich-send').addEventListener('click',  () => this._send());
		this.panel.querySelector('.nich-input').addEventListener('keydown', (e) => {
			if (e.key === 'Enter') this._send();
		});
		this.panel.querySelector('.nich-mic').addEventListener('click', () => this._toggleMic());
	}

	// ── Panel Toggle ──────────────────────────────────────────────────────────

	_togglePanel() {
		const visible = this.panel.style.display !== 'none';
		this.panel.style.display = visible ? 'none' : 'flex';
		this.toggleBtn.classList.toggle('active', !visible);
		if (!visible) {
			this.panel.querySelector('.nich-input').focus();
			// First open triggers a greeting skill
			if (!this._hasOpened) {
				this._hasOpened = true;
				if (this.onFirstOpen) this.onFirstOpen();
				else if (this.skills) {
					this.skills.perform('greet', {}, { identity: this.identity });
				}
			}
		}
	}

	// ── Input Handling ────────────────────────────────────────────────────────

	_send() {
		const input = this.panel.querySelector('.nich-input');
		const text  = input.value.trim();
		if (!text) return;
		input.value = '';
		this._addMessage('user', text);
		this._handleInput(text);
	}

	async _handleInput(text) {
		const lower = text.toLowerCase();

		// Route to skills first (high-precision pattern matching)
		if (this.skills) {
			const skillName = this._matchSkill(lower);
			if (skillName) {
				await this.skills.perform(skillName, { query: text }, { identity: this.identity });
				return;
			}
		}

		// Try Runtime LLM when a real provider is configured (not NullProvider)
		if (this.runtime) {
			try {
				const { text: reply } = await this.runtime.send(text);
				if (reply) {
					this._addMessage('agent', reply);
					this._speak(reply);
					// Runtime events are bridged to protocol in app.js — no double emit
					return;
				}
			} catch (err) {
				console.warn('[NichAgent] Runtime error, falling back:', err.message);
			}
		}

		// Fallback: pattern-match response (no LLM needed)
		const response = this._generateResponse(text);
		this._addMessage('agent', response);
		this._speak(response);

		if (this.protocol) {
			this.protocol.emit({
				type:    ACTION_TYPES.SPEAK,
				payload: { text: response, sentiment: 0 },
				agentId: this.identity?.id || 'default',
			});
		}
	}

	/**
	 * Map user input to a skill name.
	 * Returns null if no skill matches.
	 */
	_matchSkill(lower) {
		if (lower.match(/\b(present|describe|tell me about|what.*model|show me)\b/)) return 'present-model';
		if (lower.match(/\b(validate|check|errors|warnings|valid)\b/))              return 'validate-model';
		if (lower.match(/\b(remember|save|store|note|don't forget)\b/))              return 'remember';
		if (lower.match(/\b(sign|signature|wallet|verify|prove)\b/))                 return 'sign-action';
		if (lower.match(/\b(think|recall|what do you know|context)\b/))              return 'think';
		if (lower.match(/\b(help|what can you|commands|skills|abilities)\b/))        return 'help';
		return null;
	}

	// ── Response Generation (fallback) ────────────────────────────────────────

	_generateResponse(input) {
		const lower  = input.toLowerCase();
		const viewer = window.VIEWER?.app?.viewer;

		if (lower.match(/\b(hello|hi|hey|sup|yo)\b/)) {
			return 'Hey! Drop a 3D model in or ask me about the controls.';
		}
		if (lower.match(/\b(how|what).*(upload|load|open|import)\b/)) {
			return 'Drag and drop any glTF or GLB file onto the viewer, or click the upload button. The model loads instantly in your browser.';
		}
		if (lower.match(/\b(rotate|spin|orbit)\b/)) {
			return 'Click and drag to orbit. Enable auto-rotate in the Display controls panel on the right.';
		}
		if (lower.match(/\b(zoom)\b/)) {
			return 'Scroll wheel to zoom. On mobile, pinch.';
		}
		if (lower.match(/\b(pan|move)\b/)) {
			return 'Right-click and drag to pan. Two fingers on mobile.';
		}
		if (lower.match(/\b(wireframe)\b/)) {
			return 'Toggle wireframe in the Display controls panel — shows mesh topology.';
		}
		if (lower.match(/\b(light|lighting|dark|bright|exposure)\b/)) {
			return 'Open the Lighting folder in the controls panel. Change the environment map, adjust exposure, toggle punctual lights.';
		}
		if (lower.match(/\b(animation|animate|play|clip)\b/)) {
			return viewer?.clips?.length
				? `This model has ${viewer.clips.length} animation clip${viewer.clips.length !== 1 ? 's' : ''}. Find them in the Animation folder.`
				: 'No animations on this model, or load a model first.';
		}
		if (lower.match(/\b(background|bg|color)\b/)) {
			return 'Change the background colour in the Display controls using the bgColor picker.';
		}
		if (lower.match(/\b(format|gltf|glb|supported|file)\b/)) {
			return 'Supports glTF 2.0 (.gltf) and GLB (.glb). Convert other formats with Blender.';
		}
		if (lower.match(/\b(skeleton|bones|rig)\b/)) {
			return 'Enable skeleton helper in the Display panel to visualise bone structure.';
		}
		if (lower.match(/\b(screenshot|capture|photo)\b/)) {
			return 'Press P to take a screenshot. It downloads as a PNG automatically.';
		}
		if (lower.match(/\b(performance|fps|stats)\b/)) {
			return 'Open the Performance folder in the controls panel for live FPS/MS/MB stats.';
		}
		if (lower.match(/\b(who|what).*(you|this|agent)\b/)) {
			return `I'm ${this.identity?.name || '3D Agent'} — present, embodied, and here to help with your 3D work.`;
		}
		if (lower.match(/\b(memory|remember|memories)\b/)) {
			const stats = this.identity?.memory?.stats;
			if (stats?.total) {
				return `I have ${stats.total} memories: ${stats.user || 0} about you, ${stats.project || 0} project notes, ${stats.feedback || 0} feedback entries.`;
			}
			return 'No memories yet. Tell me something worth remembering.';
		}

		return "Try asking me to present or validate the loaded model, or drop a glTF/GLB file to get started.";
	}

	// ── Speech Synthesis ─────────────────────────────────────────────────────

	_speak(text) {
		if (!this.synth) return;
		this.synth.cancel();

		const utterance    = new SpeechSynthesisUtterance(text);
		utterance.rate     = 1.0;
		utterance.pitch    = 1.0;
		utterance.volume   = 0.8;
		utterance.onstart  = () => { this.isSpeaking = true; };
		utterance.onend    = () => { this.isSpeaking = false; };

		this.synth.speak(utterance);
	}

	// ── Mic Toggle ────────────────────────────────────────────────────────────

	_toggleMic() {
		if (!this.recognition) {
			this._addMessage('agent', 'Speech recognition not supported here. Try Chrome or Edge.');
			return;
		}
		if (this.isListening) {
			this.recognition.stop();
			this.isListening = false;
			this.panel.querySelector('.nich-mic').classList.remove('active');
		} else {
			this.recognition.start();
			this.isListening = true;
			this.panel.querySelector('.nich-mic').classList.add('active');
		}
	}

	// ── Message Rendering ────────────────────────────────────────────────────

	_addMessage(role, text, type = '') {
		if (role !== 'status') {
			this.messages.push({ role, text });
		}
		const messagesEl = this.panel.querySelector('#agent-messages');
		const msgEl      = document.createElement('div');
		msgEl.className  = `nich-message ${role}${type ? ' ' + type : ''}`;
		msgEl.textContent = text;
		messagesEl.appendChild(msgEl);
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	// ── Dispose ───────────────────────────────────────────────────────────────

	dispose() {
		if (this.recognition) this.recognition.stop();
		this.synth.cancel();
		this.panel.remove();
		this.toggleBtn.remove();
	}
}
