const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

export class NichAgent {
	constructor(containerEl) {
		this.container = containerEl;
		this.isReady = true;
		this.isSpeaking = false;
		this.isListening = false;
		this.recognition = null;
		this.synth = window.speechSynthesis;
		this.messages = [];

		this._buildUI();
		this._initSpeechRecognition();
	}

	_initSpeechRecognition() {
		if (!SpeechRecognition) return;

		this.recognition = new SpeechRecognition();
		this.recognition.continuous = false;
		this.recognition.interimResults = false;
		this.recognition.lang = 'en-US';

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

	_buildUI() {
		this.panel = document.createElement('div');
		this.panel.className = 'nich-panel';
		this.panel.innerHTML = `
			<div class="nich-header">
				<span class="nich-title">SperaxOS</span>
				<button class="nich-close" aria-label="Close">&times;</button>
			</div>
			<div class="nich-messages" id="agent-messages">
				<div class="nich-message agent">Hi! I'm your 3D Agent. Ask me about 3D models, controls, or drop a file to get started.</div>
			</div>
			<div class="nich-controls">
				<input type="text" class="nich-input" placeholder="Ask the agent..." />
				<button class="nich-send" aria-label="Send">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
				</button>
			</div>
			<div class="nich-mic-row">
				<button class="nich-mic" aria-label="Toggle microphone">
					<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>
				</button>
			</div>
		`;
		this.panel.style.display = 'none';
		this.container.appendChild(this.panel);

		this.toggleBtn = document.createElement('button');
		this.toggleBtn.className = 'nich-toggle';
		this.toggleBtn.innerHTML = `
			<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/><path d="M7 9h2v2H7zm4 0h2v2h-2zm4 0h2v2h-2z"/></svg>
		`;
		this.toggleBtn.title = 'Talk to 3D Agent';
		this.container.appendChild(this.toggleBtn);

		this.toggleBtn.addEventListener('click', () => this._togglePanel());
		this.panel.querySelector('.nich-close').addEventListener('click', () => this._togglePanel());
		this.panel.querySelector('.nich-send').addEventListener('click', () => this._send());
		this.panel.querySelector('.nich-input').addEventListener('keydown', (e) => {
			if (e.key === 'Enter') this._send();
		});
		this.panel.querySelector('.nich-mic').addEventListener('click', () => this._toggleMic());
	}

	_togglePanel() {
		const visible = this.panel.style.display !== 'none';
		this.panel.style.display = visible ? 'none' : 'flex';
		this.toggleBtn.classList.toggle('active', !visible);
		if (!visible) {
			this.panel.querySelector('.nich-input').focus();
		}
	}

	_send() {
		const input = this.panel.querySelector('.nich-input');
		const text = input.value.trim();
		if (!text) return;
		input.value = '';

		this._addMessage('user', text);
		this._handleInput(text);
	}

	_handleInput(text) {
		const response = this._generateResponse(text);
		this._addMessage('agent', response);
		this._speak(response);
	}

	_generateResponse(input) {
		const lower = input.toLowerCase();

		// Viewer info from window.VIEWER if available
		const viewer = window.VIEWER?.app?.viewer;

		if (lower.match(/\b(hello|hi|hey|sup)\b/)) {
			return 'Hey! Drop a 3D model into the viewer, or ask me about the controls.';
		}

		if (lower.match(/\b(how|what).*(upload|load|open|import)\b/)) {
			return 'You can drag and drop any glTF or GLB file onto the viewer, or click the upload button at the bottom. The model will load instantly in your browser.';
		}

		if (lower.match(/\b(rotate|spin|orbit)\b/)) {
			return 'Click and drag to orbit the camera around the model. You can enable auto-rotate in the Display controls panel on the right.';
		}

		if (lower.match(/\b(zoom)\b/)) {
			return 'Use the scroll wheel to zoom in and out. On mobile, pinch to zoom.';
		}

		if (lower.match(/\b(pan|move)\b/)) {
			return 'Right-click and drag to pan the camera. On mobile, use two fingers to pan. You can toggle screen-space panning in the Display panel.';
		}

		if (lower.match(/\b(wireframe)\b/)) {
			return 'Toggle wireframe mode from the Display controls panel on the right. It shows the mesh topology of your model.';
		}

		if (lower.match(/\b(light|lighting|dark|bright)\b/)) {
			return 'Open the Lighting folder in the controls panel. You can change the environment map, adjust exposure, toggle punctual lights, and modify ambient and direct light intensity and color.';
		}

		if (lower.match(/\b(animation|animate|play)\b/)) {
			return 'If your model has animations, they\'ll appear in the Animation folder. You can adjust playback speed or use "playAll" to play all clips at once.';
		}

		if (lower.match(/\b(background|bg|color)\b/)) {
			return 'You can change the background color in the Display controls using the bgColor picker. Or toggle "background" to use the environment map as the background.';
		}

		if (lower.match(/\b(format|gltf|glb|supported|file)\b/)) {
			return 'This viewer supports glTF 2.0 (.gltf) and GLB (.glb) files. These are the standard formats for 3D on the web. You can convert other formats using tools like Blender.';
		}

		if (lower.match(/\b(skeleton|bones|rig)\b/)) {
			return 'Enable the skeleton helper in the Display panel to visualize the bone structure of rigged models.';
		}

		if (lower.match(/\b(grid)\b/)) {
			return 'Toggle the grid in the Display panel. It helps you understand the scale and orientation of your model.';
		}

		if (lower.match(/\b(performance|fps|stats)\b/)) {
			return 'Open the Performance folder in the controls panel to see an FPS counter and rendering stats.';
		}

		if (lower.match(/\b(validation|error|warning|report)\b/)) {
			if (viewer) {
				return 'After loading a model, the validator runs automatically and shows any issues at the bottom of the screen. Click the warning bar to see the full report.';
			}
			return 'Load a model first, then the validator will check it automatically and display any warnings or errors.';
		}

		if (lower.match(/\b(what|who).*(you|this|3d agent)\b/)) {
			return 'I\'m 3D Agent — your assistant for previewing and understanding 3D models. I can help you navigate controls, understand file formats, and troubleshoot issues.';
		}

		if (lower.match(/\b(help|commands|can you)\b/)) {
			return 'I can help with: loading models, camera controls (rotate, zoom, pan), lighting setup, animations, wireframe/skeleton views, validation reports, and format questions. Just ask!';
		}

		return 'I can help with model viewing, controls, lighting, animations, and file formats. Try asking about a specific feature, or drop a glTF/GLB file to get started!';
	}

	_speak(text) {
		if (!this.synth) return;
		this.synth.cancel();

		const utterance = new SpeechSynthesisUtterance(text);
		utterance.rate = 1.0;
		utterance.pitch = 1.0;
		utterance.volume = 0.8;

		utterance.onstart = () => {
			this.isSpeaking = true;
		};
		utterance.onend = () => {
			this.isSpeaking = false;
		};

		this.synth.speak(utterance);
	}

	_toggleMic() {
		if (!this.recognition) {
			this._addMessage('agent', 'Speech recognition is not supported in this browser. Try Chrome or Edge.');
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

	_addMessage(role, text) {
		this.messages.push({ role, text });
		const messagesEl = this.panel.querySelector('#agent-messages');
		const msgEl = document.createElement('div');
		msgEl.className = `nich-message ${role}`;
		msgEl.textContent = text;
		messagesEl.appendChild(msgEl);
		messagesEl.scrollTop = messagesEl.scrollHeight;
	}

	dispose() {
		if (this.recognition) this.recognition.stop();
		this.synth.cancel();
		this.panel.remove();
		this.toggleBtn.remove();
	}
}
