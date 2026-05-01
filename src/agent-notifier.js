import { ACTION_TYPES } from './agent-protocol.js';

export class AgentNotifier {
	/**
	 * @param {HTMLElement} hostEl — the <agent-3d> element
	 * @param {import('./agent-protocol.js').AgentProtocol} protocol
	 */
	constructor(hostEl, protocol) {
		this._host = hostEl;
		this._protocol = protocol;
		this._queue = [];
		this._busy = false;
		this._originalStyles = null;
		this._onNotifyBound = this._onNotify.bind(this);
	}

	attach() {
		this._protocol.on(ACTION_TYPES.NOTIFY, this._onNotifyBound);
		_ensureDocStyle();
	}

	detach() {
		this._protocol.off(ACTION_TYPES.NOTIFY, this._onNotifyBound);
		this._queue = [];
		if (this._busy) {
			this._busy = false;
			this._host.classList.remove('notifying');
			if (this._originalStyles) {
				Object.assign(this._host.style, this._originalStyles);
				this._host.style.transition = '';
				this._originalStyles = null;
			}
		}
	}

	_onNotify(action) {
		this._queue.push(action.payload);
		if (!this._busy) this._processNext();
	}

	async _processNext() {
		if (!this._queue.length) { this._busy = false; return; }
		this._busy = true;
		const { message, duration = 6000 } = this._queue.shift();
		await this._enterFrame();
		if (!this._busy) return;
		this._protocol.emit({ type: ACTION_TYPES.SPEAK, payload: { text: message } });
		await this._wait(duration);
		if (!this._busy) return;
		await this._exitFrame();
		this._processNext();
	}

	async _enterFrame() {
		this._originalStyles = {
			transform: this._host.style.transform,
			opacity: this._host.style.opacity,
			visibility: this._host.style.visibility,
			position: this._host.style.position,
			bottom: this._host.style.bottom,
			right: this._host.style.right,
			width: this._host.style.width,
			height: this._host.style.height,
			zIndex: this._host.style.zIndex,
		};

		this._host.classList.add('notifying');

		// Snap to off-screen start position without transition
		this._host.style.transition = 'none';
		this._host.style.transform = 'translateX(120%)';
		this._host.style.visibility = 'visible';
		this._host.style.opacity = '0';

		// Force reflow so the snap position is committed before the transition starts
		void this._host.offsetWidth;

		// Slide in
		this._host.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.3s ease';
		this._host.style.transform = 'translateX(0)';
		this._host.style.opacity = '1';

		await this._wait(450);
	}

	async _exitFrame() {
		this._host.style.transition = 'transform 0.35s ease-in, opacity 0.25s ease';
		this._host.style.transform = 'translateX(120%)';
		this._host.style.opacity = '0';
		await this._wait(380);

		this._host.classList.remove('notifying');
		Object.assign(this._host.style, this._originalStyles);
		this._host.style.transition = '';
		this._originalStyles = null;
	}

	_wait(ms) {
		return new Promise(r => setTimeout(r, ms));
	}
}

function _ensureDocStyle() {
	if (document.getElementById('agent-notifier-style')) return;
	const style = document.createElement('style');
	style.id = 'agent-notifier-style';
	style.textContent = `
agent-3d.notifying {
	position: fixed !important;
	bottom: 24px !important;
	right: 24px !important;
	width: 200px !important;
	height: 300px !important;
	z-index: 9999 !important;
}`;
	document.head.appendChild(style);
}
