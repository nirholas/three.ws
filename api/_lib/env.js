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

	get R2_ACCOUNT_ID()           { return req('R2_ACCOUNT_ID'); },
	get R2_ACCESS_KEY_ID()        { return req('R2_ACCESS_KEY_ID'); },
	get R2_SECRET_ACCESS_KEY()    { return req('R2_SECRET_ACCESS_KEY'); },
	get R2_BUCKET()               { return req('R2_BUCKET'); },
	get R2_PUBLIC_BASE()          { return trimSlash(req('R2_PUBLIC_BASE')); },

	get UPSTASH_REDIS_REST_URL()  { return opt('UPSTASH_REDIS_REST_URL'); },
	get UPSTASH_REDIS_REST_TOKEN(){ return opt('UPSTASH_REDIS_REST_TOKEN'); },

	get JWT_SECRET()              { return req('JWT_SECRET'); },
	get JWT_KID()                 { return opt('JWT_KID', 'k1'); },

	get PASSWORD_ROUNDS()         { return parseInt(opt('PASSWORD_ROUNDS', '11'), 10); },

	get ISSUER()       { return this.APP_ORIGIN; },
	get MCP_RESOURCE() { return `${this.APP_ORIGIN}/api/mcp`; },
};
