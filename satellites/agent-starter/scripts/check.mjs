import { access, readFile } from 'node:fs/promises';

const required = [
	'index.html',
	'app.js',
	'styles.css',
	'README.md',
	'LEARN.md',
	'CONTRIBUTING.md',
	'.devcontainer/devcontainer.json',
];

await Promise.all(required.map((file) => access(new URL(`../${file}`, import.meta.url))));

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const devcontainer = JSON.parse(await readFile(new URL('../.devcontainer/devcontainer.json', import.meta.url), 'utf8'));

for (const expected of ['<agent-3d', 'https://three.ws/agent-3d/latest/agent-3d.js', 'data-action="wave"']) {
	if (!html.includes(expected)) throw new Error(`index.html is missing ${expected}`);
}
if (!app.includes('customElements.whenDefined')) throw new Error('app.js does not wait for the component');
if (!devcontainer.forwardPorts?.includes(4173)) throw new Error('the dev container does not forward port 4173');
if (!String(devcontainer.postStartCommand).includes('npm run dev')) throw new Error('the dev container does not start the demo');

console.log(`agent starter: ${required.length} required files and the live component wiring are valid`);
