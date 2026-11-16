/** Helpers for the model URL a page author enters in the property pane. */

export const THREEWS_ORIGIN = 'https://three.ws';

/** The free three.ws catalog, where authors copy a ready-made model URL. */
export const CATALOG_URL = `${THREEWS_ORIGIN}/objects`;

export type DisplayMode = 'viewer' | 'component';

/** Returns the URL when it is an https link, otherwise undefined. */
export function parseModelUrl(value: string | undefined): URL | undefined {
  const trimmed = (value || '').trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Accepts a GLB/glTF link or a three.ws viewer link (/viewer?src=..., or the
 * catalog's /app#model=... preview link) and returns the model file URL.
 */
export function resolveModelUrl(value: string | undefined): string | undefined {
  const url = parseModelUrl(value);
  if (!url) return undefined;
  if (url.hostname === 'three.ws') {
    const params = url.pathname === '/app' ? new URLSearchParams(url.hash.slice(1)) : url.searchParams;
    const inner = parseModelUrl(params.get('src') || params.get('model') || undefined);
    if (inner) return inner.toString();
  }
  return url.toString();
}

/** Property pane validation: an empty string means the value is valid. */
export function validateModelUrl(value: string): string {
  if (!value.trim()) return 'Paste the https link to a .glb or .gltf model, or a three.ws viewer link.';
  return resolveModelUrl(value) ? '' : 'The model link must start with https://';
}

/** The hosted three.ws viewer page for a model. It allows framing from any site. */
export function viewerUrl(modelUrl: string, title: string): string {
  const url = new URL('/viewer', THREEWS_ORIGIN);
  url.searchParams.set('src', modelUrl);
  if (title) url.searchParams.set('title', title);
  return url.toString();
}

export function clampHeight(value: number | undefined): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 480;
  return Math.min(900, Math.max(240, Math.round(n)));
}
