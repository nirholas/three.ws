/**
 * @three-ws/sdk — Avatar embed helper.
 *
 * Drops a real, animated three.ws avatar onto any page. Works on any framework
 * (or none) because under the hood it loads the published `<agent-3d>` custom
 * element from the three.ws CDN.
 *
 *   import { loadAvatar } from '@three-ws/sdk';
 *
 *   const handle = await loadAvatar({
 *     agentId: 'agt_abc123',
 *     container: document.getElementById('hero'),
 *     controls: 'orbit',
 *   });
 *
 *   // Later:
 *   handle.playAnimation('wave');
 *   handle.dispose();
 *
 * The script tag is injected at most once per page; subsequent calls reuse it.
 * If your CSP blocks the default CDN you can pass `cdnUrl` to a self-hosted
 * mirror — the script must define the `agent-3d` custom element.
 */

const DEFAULT_CDN = 'https://three.ws/agent-3d/latest/agent-3d.js';
const CHANNEL_TO_INTEGRITY = new Map(); // cdnUrl -> Promise<void>

/**
 * @typedef {Object} LoadAvatarOptions
 * @property {string}        agentId     three.ws agent id (required)
 * @property {HTMLElement}   container   where to mount the element (required)
 * @property {'orbit'|'none'} [controls] 'orbit' (default) or 'none'
 * @property {string}        [cdnUrl]    override the agent-3d CDN URL
 * @property {string}        [integrity] optional SRI hash for the script tag
 * @property {string}        [width]     CSS width  (default: '100%')
 * @property {string}        [height]    CSS height (default: '100%')
 * @property {Object<string,string>} [attrs] extra attributes to forward to <agent-3d>
 */

/**
 * Load the three.ws avatar component and mount it for a given agent.
 *
 * @param {LoadAvatarOptions} opts
 * @returns {Promise<{ element: HTMLElement, playAnimation: (hint: string) => void, dispose: () => void }>}
 */
export async function loadAvatar(opts) {
	if (!opts || typeof opts !== 'object') {
		throw new TypeError('loadAvatar: options object required');
	}
	const { agentId, container } = opts;
	if (!agentId) throw new TypeError('loadAvatar: agentId is required');
	if (!container || !(container instanceof Element)) {
		throw new TypeError('loadAvatar: container must be a DOM element');
	}

	const cdnUrl = opts.cdnUrl || DEFAULT_CDN;
	await ensureAgent3DScript(cdnUrl, opts.integrity);

	const el = document.createElement('agent-3d');
	el.setAttribute('agent-id', agentId);
	el.setAttribute('controls', opts.controls || 'orbit');
	el.style.width = opts.width || '100%';
	el.style.height = opts.height || '100%';
	el.style.display = 'block';

	if (opts.attrs && typeof opts.attrs === 'object') {
		for (const [k, v] of Object.entries(opts.attrs)) {
			if (v != null) el.setAttribute(k, String(v));
		}
	}

	container.appendChild(el);

	return {
		element: el,
		playAnimation(hint) {
			if (typeof el.playAnimation === 'function') return el.playAnimation(hint);
			if (typeof el.playAnimationByHint === 'function') return el.playAnimationByHint(hint);
			return false;
		},
		dispose() {
			el.remove();
		},
	};
}

function ensureAgent3DScript(cdnUrl, integrity) {
	if (typeof customElements !== 'undefined' && customElements.get('agent-3d')) {
		return Promise.resolve();
	}
	if (CHANNEL_TO_INTEGRITY.has(cdnUrl)) return CHANNEL_TO_INTEGRITY.get(cdnUrl);

	const p = new Promise((resolve, reject) => {
		const existing = document.querySelector(`script[data-three-ws-agent3d="${cssEscape(cdnUrl)}"]`);
		if (existing) {
			if (customElements.get('agent-3d')) return resolve();
			existing.addEventListener('load', () => resolve(), { once: true });
			existing.addEventListener('error', () => reject(new Error(`Failed to load ${cdnUrl}`)), { once: true });
			return;
		}
		const s = document.createElement('script');
		s.type = 'module';
		s.src = cdnUrl;
		s.async = true;
		s.crossOrigin = 'anonymous';
		s.dataset.threeWsAgent3d = cdnUrl;
		if (integrity) s.integrity = integrity;
		s.addEventListener('load', () => {
			if (typeof customElements?.whenDefined === 'function') {
				customElements.whenDefined('agent-3d').then(() => resolve(), reject);
			} else {
				resolve();
			}
		});
		s.addEventListener('error', () => reject(new Error(`Failed to load ${cdnUrl}`)));
		document.head.appendChild(s);
	});

	CHANNEL_TO_INTEGRITY.set(cdnUrl, p);
	return p;
}

function cssEscape(s) {
	return String(s).replace(/["\\]/g, '\\$&');
}
