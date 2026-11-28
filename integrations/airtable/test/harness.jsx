// Testing entry for `block run --testing` (block.json "frontendTestingEntry"). It renders
// the real extension inside Airtable's TestDriver with the fixture catalog base, so the
// bundle the Blocks CLI builds can be driven in an ordinary browser without an Airtable
// account. Forge calls go to the real API (window.FORGE_BASE_URL, default three.ws) with
// the key typed into the extension; nothing here is shipped in the released extension.
import TestDriver from '@airtable/blocks-testing';
import React from 'react';
import ReactDOM from 'react-dom';
import baseFixture from './fixtures/base.js';
import ForgeApp from '../frontend/ForgeApp.jsx';
import { STYLES } from '../frontend/styles.js';

const style = document.createElement('style');
style.textContent = STYLES;
document.head.appendChild(style);

window.testDriver = new TestDriver(baseFixture);
window.testDriver.watch('mutation', (mutation) => {
	window.forgeMutations = [...(window.forgeMutations || []), mutation];
});

const params = new URLSearchParams(window.location.search);
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
