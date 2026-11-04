/**
 * Origins allowed to embed HQ and drive it over postMessage.
 * Must stay aligned with the frame-ancestors header in apps/hq/vercel.json.
 */
export const ALLOWED_ORIGINS: readonly string[] = [
  'https://three.ws',
  'https://www.three.ws',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3210',
];

/**
 * Exact matches against ALLOWED_ORIGINS, plus https subdomains of three.ws
 * (the same set frame-ancestors grants). No third-party preview host is trusted.
 */
export function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith('.three.ws') && url.origin === origin;
  } catch {
    return false;
  }
}
