// Smoke test for /validation. Loads the page in a headless browser, clicks
// the Box sample chip, waits for the Khronos validator + glTF-Transform
// inspector to finish, and asserts that both reports rendered.

import { chromium } from 'playwright';

const URL = process.env.URL || 'http://localhost:3003/validation/';
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
	if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

await page.goto(URL, { waitUntil: 'networkidle' });

// Tabs visible?
await page.waitForSelector('.tab[data-tab="validate"]');
await page.waitForSelector('.sample-chip');

// Click the first sample (Box).
await page.click('.sample-chip[data-name="Box"]');

// Wait for the Validate panel to render the report banner OR an error.
await page.waitForFunction(
	() => {
		const out = document.getElementById('validate-output');
		return out && (out.querySelector('.report-banner') || out.querySelector('.err'));
	},
	{ timeout: 30000 },
);

const validateText = await page.locator('#validate-output').innerText();
const inspectText = await page.locator('#inspect-output').innerText();

// Switch to inspect tab and check it rendered too.
await page.click('.tab[data-tab="inspect"]');
await page.waitForFunction(
	() => {
		const out = document.getElementById('inspect-output');
		return out && (out.querySelector('.inspect-grid') || out.querySelector('.err'));
	},
	{ timeout: 15000 },
);
const inspectVisibleText = await page.locator('#inspect-output').innerText();
const inspectCardCount = await page.locator('.inspect-card').count();

// On-chain bridge — Sign button should now be enabled. Clicking it must
// switch to Records tab AND open the submit modal pre-filled.
await page.click('.tab[data-tab="validate"]');
const signEnabled = !(await page.locator('#sign-btn').isDisabled());
await page.click('#sign-btn');
const modalOpen = await page.locator('#submit-modal.open').count() > 0;
const modalReportHash = await page.locator('#report-hash').inputValue();
await page.locator('button.sec', { hasText: 'Cancel' }).click();

// Records tab → ensure the existing dashboard still mounts.
await page.click('.tab[data-tab="records"]');
const recordsToolbar = await page.locator('.records-toolbar').isVisible();

const status = await page.locator('#status').innerText();

console.log('— Status:', status.trim());
console.log('— Validate panel preview:', validateText.slice(0, 200).replace(/\s+/g, ' '));
console.log('— Inspect panel preview:', inspectVisibleText.slice(0, 200).replace(/\s+/g, ' '));
console.log('— Inspect card count:', inspectCardCount);
console.log('— Sign button enabled after run:', signEnabled);
console.log('— Modal opened on bridge click:', modalOpen);
console.log('— Modal report hash:', modalReportHash.slice(0, 18) + (modalReportHash ? '…' : ''));
console.log('— Records toolbar visible:', recordsToolbar);
console.log('— Console errors:', consoleErrors.length);
if (consoleErrors.length) {
	console.log(consoleErrors.map((e) => '  · ' + e).join('\n'));
}

const failures = [];
if (!validateText.includes('Validation report') && !validateText.includes('All clear') && !validateText.includes('Found')) {
	failures.push('Validate output does not contain expected report banner');
}
if (!inspectVisibleText.includes('Performance inspector')) {
	failures.push('Inspect output does not contain "Performance inspector"');
}
if (inspectCardCount < 6) {
	failures.push(`Expected ≥6 inspect cards, got ${inspectCardCount}`);
}
if (!signEnabled) {
	failures.push('Sign & pin button did not enable after a successful validation');
}
if (!modalOpen) {
	failures.push('On-chain bridge did not open the submit modal');
}
if (!/^0x[0-9a-f]{64}$/i.test(modalReportHash)) {
	failures.push(`Bridge did not pre-fill a valid keccak256 hash (got "${modalReportHash}")`);
}
if (!recordsToolbar) {
	failures.push('Records tab toolbar is not visible');
}
// Filter out network-noise console errors that are unrelated (devtools-ws, etc.)
const realErrors = consoleErrors.filter(
	(e) => !/Failed to load resource: net::ERR_FAILED/i.test(e) && !/favicon/i.test(e),
);
if (realErrors.length) failures.push(`Page console errors: ${realErrors.length}`);

await browser.close();

if (failures.length) {
	console.error('\nFAIL:\n' + failures.map((f) => '  ✗ ' + f).join('\n'));
	process.exit(1);
}
console.log('\nOK — validate + inspect + records tabs all functional.');
