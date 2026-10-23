// Every alerts-mcp tool file must load. create_alert_rule once shipped an
// unescaped apostrophe inside a single-quoted description, which made the whole
// module (and the golden-contract audit that parses it) a SyntaxError.
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = fileURLToPath(new URL('../packages/alerts-mcp/src/tools/', import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'index.js');

describe('alerts-mcp tool sources', () => {
	it.each(files)('%s loads and declares a described tool', async (file) => {
		const mod = await import(`${dir}${file}`);
		expect(mod.def?.name).toMatch(/^[a-z][a-z0-9_]+$/);
		expect(mod.def.description.length).toBeGreaterThan(40);
	});
});
