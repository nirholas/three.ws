// Centralized env access. Lazy by design: missing env vars fail at first use,
// not at module import, so unrelated endpoints (e.g. OAuth discovery) still
// respond when the deployment is partially configured.

function req(name) {
	const v = process.env[name];
	if (!v) throw new Error(`Missing required env var: ${name}`);
	return v;
}

function opt(name, fallback = undefined) {
	return process.env[name] ?? fallback;
}

function trimSlash(s) {
	return s ? s.replace(/\/$/, '') : s;
}

export const env = {
	get APP_ORIGIN()              { return trimSlash(opt('PUBLIC_APP_ORIGIN', 'https://3dagent.vercel.app')); },

	get DATABASE_URL()            { return req('DATABASE_URL'); },

	get S3_ENDPOINT()             { return trimSlash(req('S3_ENDPOINT')); },
	get S3_ACCESS_KEY_ID()        { return req('S3_ACCESS_KEY_ID'); },
	get S3_SECRET_ACCESS_KEY()    { return req('S3_SECRET_ACCESS_KEY'); },
	get S3_BUCKET()               { return req('S3_BUCKET'); },
	get S3_PUBLIC_DOMAIN()        { return trimSlash(req('S3_PUBLIC_DOMAIN')); },

	get UPSTASH_REDIS_REST_URL()  { return opt('UPSTASH_REDIS_REST_URL'); },
	get UPSTASH_REDIS_REST_TOKEN(){ return opt('UPSTASH_REDIS_REST_TOKEN'); },

	get JWT_SECRET()              { return req('JWT_SECRET'); },
	get JWT_KID()                 { return opt('JWT_KID', 'k1'); },

	get PASSWORD_ROUNDS()         { return parseInt(opt('PASSWORD_ROUNDS', '11'), 10); },

	get ISSUER()       { return this.APP_ORIGIN; },
	get MCP_RESOURCE() { return `${this.APP_ORIGIN}/api/mcp`; },

	// Avaturn — photo-to-avatar pipeline. Only read when /api/onboarding/avaturn-session
	// is hit; keeping these optional so unrelated endpoints still respond when unset.
	get AVATURN_API_KEY() { return opt('AVATURN_API_KEY'); },
	get AVATURN_API_URL() { return trimSlash(opt('AVATURN_API_URL', 'https://api.avaturn.me')); },
};
