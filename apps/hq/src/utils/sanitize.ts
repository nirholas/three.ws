const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(str: string): string {
  if (!str) return '';
  return String(str).replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] || char);
}

export function sanitizeUrl(url: string): string {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (!trimmed) return '';

  const isAllowedProtocol = (protocol: string) => protocol === 'http:' || protocol === 'https:';

  try {
    const parsed = new URL(trimmed);
    if (isAllowedProtocol(parsed.protocol)) {
      return escapeAttr(parsed.toString());
    }
  } catch {
    // Not an absolute URL, continue and validate as relative.
  }

  if (!/^(\/|\.\/|\.\.\/|\?|#)/.test(trimmed)) {
    return '';
  }

  try {
    const base = typeof window !== 'undefined' ? window.location.origin : 'https://example.com';
    const resolved = new URL(trimmed, base);
    if (!isAllowedProtocol(resolved.protocol)) {
      return '';
    }
    return escapeAttr(trimmed);
  } catch {
    return '';
  }
}

export function escapeAttr(str: string): string {
  return escapeHtml(str);
}
