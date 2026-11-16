/**
 * Loads the three.ws <agent-3d> runtime once per page.
 *
 * The script is an immutable, versioned release served from three.ws and
 * pinned with Subresource Integrity, so a SharePoint page only ever runs the
 * exact bytes this package was tested against. SharePoint Online enforces a
 * Content Security Policy on modern pages; the tenant admin adds
 * RUNTIME_TRUSTED_SOURCE to SharePoint admin center > Advanced > Script
 * sources once (see docs/microsoft-sharepoint.md). When that entry is missing
 * the browser refuses the script and the load rejects with RuntimeBlockedError
 * so the web part can tell the site owner exactly what to ask for.
 */

export const RUNTIME_VERSION = '1.5.2';
export const RUNTIME_URL = `https://three.ws/agent-3d/${RUNTIME_VERSION}/agent-3d.js`;
export const RUNTIME_INTEGRITY = 'sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q';
/** The exact value a tenant admin enters under Trusted script sources. */
export const RUNTIME_TRUSTED_SOURCE = `https://three.ws/agent-3d/${RUNTIME_VERSION}/`;

const SCRIPT_MARKER = 'data-three-ws-runtime';

export class RuntimeBlockedError extends Error {
	public constructor() {
		super(
			`The three.ws 3D runtime was blocked. A SharePoint administrator needs to add ${RUNTIME_TRUSTED_SOURCE} to Trusted script sources (SharePoint admin center > Advanced > Script sources).`,
		);
		Object.setPrototypeOf(this, RuntimeBlockedError.prototype);
		this.name = 'RuntimeBlockedError';
	}
}

let pending: Promise<void> | undefined;

function defined(win: Window): boolean {
	return !!win.customElements && !!win.customElements.get('agent-3d');
}

/**
 * Resolves when <agent-3d> is defined. Concurrent callers (several web parts
 * on one page) share one script tag and one promise; a failed load clears the
 * cache so a retry after the admin fixes the CSP entry works without a reload.
 */
export function loadAgentRuntime(doc: Document = document): Promise<void> {
	const win = doc.defaultView as Window;
	if (defined(win)) return Promise.resolve();
	if (pending) return pending;
	pending = new Promise<void>((resolve, reject) => {
		const stale = doc.querySelector(`script[${SCRIPT_MARKER}]`);
		if (stale) stale.remove();
		const script = doc.createElement('script');
		script.type = 'module';
		script.src = RUNTIME_URL;
		script.integrity = RUNTIME_INTEGRITY;
		script.crossOrigin = 'anonymous';
		script.setAttribute(SCRIPT_MARKER, RUNTIME_VERSION);
		script.addEventListener('error', () => {
			pending = undefined;
			reject(new RuntimeBlockedError());
		});
		script.addEventListener('load', () => {
			win.customElements.whenDefined('agent-3d').then(() => resolve(), reject);
		});
		doc.head.appendChild(script);
	});
	return pending;
}
