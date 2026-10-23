// The zero-configuration entry point: importing this file registers <ar-studio>
// and, if the page has no <ar-studio> element at all, mounts one full-screen.
//
//   <script type="module" src="https://unpkg.com/3d-ar-studio/dist/ar-studio.js"></script>
//
// That single line is a working AR studio. Anything more deliberate should
// import `createArStudio` instead.

import { defineArStudio } from './element.js';
import { createArStudio } from './index.js';

defineArStudio();

function autoMount() {
	if (document.querySelector('ar-studio')) return;
	const target = document.querySelector('[data-ar-studio]');
	if (target) createArStudio(target, readOptions(target));
	else if (document.documentElement.hasAttribute('data-ar-studio-auto')) createArStudio(document.body);
}

function readOptions(node) {
	const assets = node.getAttribute('data-assets');
	return assets ? { assets } : {};
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', autoMount, { once: true });
else autoMount();

export * from './index.js';
export { defineArStudio, ArStudioElement } from './element.js';
