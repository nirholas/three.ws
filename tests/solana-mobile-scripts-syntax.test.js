// Every release script must at least parse: a syntax slip in build-apk.sh or
// publish.sh is otherwise discovered on the release machine, mid-release.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const dir = join(__dirname, '..', 'solana-mobile', 'scripts');
const scripts = readdirSync(dir).filter((f) => f.endsWith('.sh'));

describe('solana-mobile shell scripts', () => {
	it('finds the release scripts', () => {
		expect(scripts).toEqual(expect.arrayContaining(['build-apk.sh', 'publish.sh', 'setup-android-sdk.sh']));
	});
	for (const name of scripts) {
		it(`${name} parses with bash -n`, () => {
			expect(() => execFileSync('bash', ['-n', join(dir, name)], { stdio: 'pipe' })).not.toThrow();
		});
	}
});
