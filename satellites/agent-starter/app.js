const agent = document.querySelector('#agent');
const controls = [...document.querySelectorAll('[data-action]')];
const copyButton = document.querySelector('[data-copy]');
const copyStatus = document.querySelector('#copy-status');
const command = document.querySelector('#create-command');

function report(message) {
	copyStatus.textContent = message;
}

async function copyCommand() {
	try {
		await navigator.clipboard.writeText(command.textContent);
		copyButton.textContent = 'Copied';
		report('Copied. Paste it into the terminal to create your own rigged character.');
	} catch {
		const selection = window.getSelection();
		const range = document.createRange();
		range.selectNodeContents(command);
		selection.removeAllRanges();
		selection.addRange(range);
		report('The command is selected. Copy it, then paste it into the terminal.');
	}
}

async function findWaveClip() {
	const response = await fetch('https://three.ws/animations/manifest.json');
	if (!response.ok) throw new Error(`animation catalog answered ${response.status}`);
	const clips = await response.json();
	return clips.find((clip) => /wave/i.test(clip.name))?.name || null;
}

async function wave() {
	const clip = await findWaveClip();
	if (clip) await agent.playClip(clip, { userInitiated: true });
	else agent.speak('Hello from three dot w s!');
}

customElements.whenDefined('agent-3d').then(() => {
	for (const control of controls) control.disabled = false;
	report('The live component is ready. Try a control or make your own character.');
});

copyButton.addEventListener('click', copyCommand);

document.querySelector('[data-action="wave"]').addEventListener('click', async () => {
	try {
		await wave();
		report('That motion came from the live three.ws animation catalog.');
	} catch (error) {
		report(`The animation could not load: ${error.message}. Try again.`);
	}
});

document.querySelector('[data-action="speak"]').addEventListener('click', () => {
	agent.speak('Hi, I am Nova. Replace my model URL with the character you create.');
	report('The avatar is speaking with its built-in talking gesture.');
});
