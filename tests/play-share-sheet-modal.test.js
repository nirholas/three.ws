// The build share sheet is a modal dialog, so it joins the shared modal
// contract (src/game/a11y.js): Escape closes the top overlay only, Tab stays
// inside, focus returns to the opener. It used to bind its own document-level
// Escape handler instead of the shared overlay stack.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ui = readFileSync(join(ROOT, 'src/game/coincommunities-ui.js'), 'utf8');

describe('share sheet joins the shared modal contract', () => {
	const start = ui.indexOf('openShareSheet({');
	const open = ui.slice(start, ui.indexOf('// ----', start));

	it('opens through openModal, not a private keydown listener', () => {
		expect(ui).toMatch(/import \{[^}]*\bopenModal\b[^}]*\} from '\.\/a11y\.js'/);
		expect(open).toContain('openModal(');
		expect(open).not.toContain("document.addEventListener('keydown'");
		expect(ui).not.toContain('_shareKeydown');
	});

	it('releases the modal when the sheet closes', () => {
		const close = ui.slice(ui.indexOf('closeShareSheet() {'));
		expect(close.slice(0, 400)).toContain('_shareRelease');
	});
});
