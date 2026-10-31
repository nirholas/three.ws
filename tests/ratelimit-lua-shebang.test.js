// @upstash/ratelimit >= 2.1.0 prefixes its Lua scripts with
// `#!lua flags=allow-key-locking`, an Upstash-hosted-only extension. The
// production Redis backend rejects it ("Unexpected flag in script shebang"),
// which opens the limiter's circuit and forces every bucket onto the Postgres
// fallback (see api/_lib/rate-limit.js isRedisShebangIncompatibilityError).
// Keep the dependency on a release whose scripts the backend accepts.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve('@upstash/ratelimit/package.json'));

describe('@upstash/ratelimit Lua scripts', () => {
	it('carry no script-shebang flags the production Redis rejects', () => {
		const dist = join(pkgDir, 'dist');
		const source = readdirSync(dist)
			.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'))
			.map((f) => readFileSync(join(dist, f), 'utf8'))
			.join('\n');
		expect(source).not.toMatch(/flags=allow-key-locking/);
	});
});
