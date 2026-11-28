// Testing entry for `block run --testing` (block.json "frontendTestingEntry"). It renders
// the real extension inside Airtable's TestDriver with the fixture catalog base, so the
// bundle the Blocks CLI builds can be driven in an ordinary browser without an Airtable
// account (see scripts/airtable-extension-browser-check.mjs). Query parameters:
//   configured=1  start with the catalog mapping already saved
//   base=<url>    Forge origin for API calls (the check script's same-origin pass-through)
//   prompt=<text> replace the teapot record's prompt, to force an uncached generation
// Nothing here ships in the released extension (block.json points only at frontend/).
import TestDriver from '@airtable/blocks-testing';
import React from 'react';
import ReactDOM from 'react-dom';
import baseFixture from './fixtures/base.js';
import ForgeApp from '../frontend/ForgeApp.jsx';
import { STYLES } from '../frontend/styles.js';

const style = document.createElement('style');
style.textContent = STYLES;
document.head.appendChild(style);

const params = new URLSearchParams(window.location.search);
const fixture = structuredClone(baseFixture);
if (params.get('prompt')) {
	const teapot = fixture.base.tables[0].records.find((record) => record.id === 'recTeapot');
	teapot.cellValuesByFieldId.fldPrompt = params.get('prompt');
}

window.testDriver = new TestDriver(fixture);
window.testDriver.watch('mutation', (mutation) => {
	window.forgeMutations = [...(window.forgeMutations || []), mutation];
});

if (params.get('configured') === '1') {
	window.testDriver.globalConfig.setPathsAsync(
		Object.entries({
			tableId: 'tblProducts',
			viewId: 'viwAll',
			promptFieldId: 'fldPrompt',
			modelFieldId: 'fldModel',
			linkFieldId: 'fldPage',
			statusFieldId: 'fldStatus',
			tier: 'draft',
		}).map(([key, value]) => ({ path: [key], value })),
	);
}

ReactDOM.render(
	<window.testDriver.Container>
		<ForgeApp clientOptions={params.get('base') ? { baseUrl: params.get('base') } : null} />
	</window.testDriver.Container>,
	document.body.appendChild(document.createElement('main')),
);
