import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The app build compiles vhtml JSX through vite.config.js. The Vite 8 transform
// ignores the string-literal `jsxFragment`, so a `<>` fragment compiles to
// React.Fragment and throws "React is not defined" at render time (this broke
// the Inspect tab on /validation). vhtml components must not use fragments.
const dir = join(import.meta.dirname, '..', 'src', 'components');
const vhtmlFiles = readdirSync(dir)
	.filter((f) => f.endsWith('.jsx'))
	.filter((f) => /@jsx vhtml/.test(readFileSync(join(dir, f), 'utf8')));

describe('vhtml JSX components', () => {
	it('finds the validation report components', () => {
		expect(vhtmlFiles).toContain('inspect-report.jsx');
		expect(vhtmlFiles).toContain('validator-report.jsx');
	});

	it.each(vhtmlFiles)('%s uses no <> fragments', (file) => {
		const src = readFileSync(join(dir, file), 'utf8');
		expect(src).not.toMatch(/<>|<\/>|<React\.Fragment/);
	});
});
