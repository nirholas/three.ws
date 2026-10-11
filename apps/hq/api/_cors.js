const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/(.*\.)?defis\.tech$/,
  /^https:\/\/defistech\.vercel\.app$/,
  /^https:\/\/defis-[a-z0-9-]+-elie-habib-projects\.vercel\.app$/,
  /^https:\/\/defis-[a-z0-9-]+\.vercel\.app$/,
  /^https:\/\/hq-[a-z0-9-]+\.vercel\.app$/,
  // three.ws production domains
  /^https:\/\/(.*\.)?three\.ws$/,
  /^https:\/\/hq-[a-z0-9-]+\.vercel\.app$/,
  // Local / Tauri
  /^https?:\/\/localhost(:\d+)?$/,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
  /^https:\/\/tauri\.localhost(:\d+)?$/,
  /^https:\/\/[a-z0-9-]+\.tauri\.localhost(:\d+)?$/i,
  /^tauri:\/\/localhost$/,
  /^asset:\/\/localhost$/,
];

export function isAllowedOrigin(origin) {
  return Boolean(origin) && ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
}

export function getCorsHeaders(req, methods = 'GET, OPTIONS') {
  const origin = req.headers.get('origin') || '';
  const allowOrigin = isAllowedOrigin(origin) ? origin : 'https://defis.tech';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

export function isDisallowedOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin) return false;
  return !isAllowedOrigin(origin);
}
