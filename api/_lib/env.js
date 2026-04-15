// Centralized, validated env access. Fail loud at cold start, not mid-request.

function required(name) {
	const v = process.env[name];
	if (!v) throw new Error(`Missing required env var: ${name}`);
	return v;
}

function optional(name, fallback = undefined) {
	return process.env[name] ?? fallback;
}

export const env = {
	APP_ORIGIN: optional('PUBLIC_APP_ORIGIN', 'https://3dagent.vercel.app').replace(/\/$/, ''),

	DATABASE_URL: required('DATABASE_URL'),

	R2_ACCOUNT_ID: required('R2_ACCOUNT_ID'),
	R2_ACCESS_KEY_ID: required('R2_ACCESS_KEY_ID'),
	R2_SECRET_ACCESS_KEY: required('R2_SECRET_ACCESS_KEY'),
	R2_BUCKET: required('R2_BUCKET'),
	R2_PUBLIC_BASE: required('R2_PUBLIC_BASE').replace(/\/$/, ''),

	UPSTASH_REDIS_REST_URL: optional('UPSTASH_REDIS_REST_URL'),
	UPSTASH_REDIS_REST_TOKEN: optional('UPSTASH_REDIS_REST_TOKEN'),

	JWT_SECRET: required('JWT_SECRET'),
	JWT_KID: optional('JWT_KID', 'k1'),

	PASSWORD_ROUNDS: parseInt(optional('PASSWORD_ROUNDS', '11'), 10),

	get ISSUER() {
		return this.APP_ORIGIN;
	},
	get MCP_RESOURCE() {
		return `${this.APP_ORIGIN}/api/mcp`;
	},
};
