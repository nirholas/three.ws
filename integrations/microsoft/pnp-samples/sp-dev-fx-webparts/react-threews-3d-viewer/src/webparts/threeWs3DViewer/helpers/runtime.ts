/**
 * Loads the three.ws <agent-3d> web component once per page.
 *
 * The script is an immutable, versioned release served from three.ws and
 * pinned with Subresource Integrity, so a page only ever runs the exact bytes
 * this sample was tested against. SharePoint Online enforces a Content
 * Security Policy on modern pages, so a SharePoint administrator adds
 * RUNTIME_TRUSTED_SOURCE under SharePoint admin center > Advanced > Script
 * sources once. Without that entry the browser refuses the script and the
 * load rejects with RuntimeBlockedError, which the web part turns into a
 * message that names the exact value to add.
 */

export const RUNTIME_VERSION = '1.5.2';
export const RUNTIME_URL = `https://three.ws/agent-3d/${RUNTIME_VERSION}/agent-3d.js`;
export const RUNTIME_INTEGRITY = 'sha384-KdAiFRsdcCbQMu4O5rkoL8hOEYLkmrdpf9ELd7jro+9NTNipWis3oqqFLll7v20Q';
/** The exact value a SharePoint administrator enters under Trusted script sources. */
export const RUNTIME_TRUSTED_SOURCE = `https://three.ws/agent-3d/${RUNTIME_VERSION}/`;

const SCRIPT_MARKER = 'data-three-ws-runtime';

export class RuntimeBlockedError extends Error {
  public constructor() {
    super(`The three.ws 3D component was blocked by the page's Content Security Policy.`);
    this.name = 'RuntimeBlockedError';
  }
}

let pending: Promise<void> | undefined;

function isDefined(win: Window): boolean {
  return !!win.customElements && !!win.customElements.get('agent-3d');
}

/**
 * Resolves when <agent-3d> is defined. Several web parts on one page share one
 * script tag and one promise. A failed load clears the cache, so a retry after
 * the administrator adds the trusted source works without a page reload.
 */
export function loadAgentRuntime(doc: Document = document): Promise<void> {
  const win = doc.defaultView as Window;
  if (isDefined(win)) return Promise.resolve();
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
