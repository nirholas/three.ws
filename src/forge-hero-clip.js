// Forge result card: "Hero clip". Opens the shared hero clip panel
// (src/hero-clip-panel.js) for the model on screen, so a creator can turn the
// mesh they just forged into a short shareable video made from real renders of
// it (docs/hero-clips.md). The panel code loads on first open only.
//
// The live model arrives on `forge:model-ready` (src/forge.js). A stored forge
// creation is addressed by its id (from the event, or the id in its storage
// URL); anything else with a public https GLB goes by URL.

import { creationIdFromGlbUrl } from './slicer-handoff.js';
import './hero-clip.css';

const resultPanel = document.getElementById('state-result');
const triggerBtn = document.getElementById('forge-heroclip-btn');

if (resultPanel && triggerBtn) {
	const panel = document.createElement('section');
	panel.id = 'forge-heroclip-panel';
	panel.className = 'hc-forge';
	panel.hidden = true;
	panel.setAttribute('aria-labelledby', 'forge-heroclip-title');
	panel.innerHTML = `
		<div class="hc-forge-head">
			<h3 id="forge-heroclip-title">Hero clip</h3>
			<button type="button" class="hc-forge-close" aria-label="Close hero clip">×</button>
		</div>
		<div class="hc-forge-body"></div>`;
	resultPanel.appendChild(panel);
	triggerBtn.setAttribute('aria-controls', panel.id);

	const body = panel.querySelector('.hc-forge-body');
	let model = null;
	let mounted = null;
	let loading = null;

	function clientHeaders() {
		try {
			const id = localStorage.getItem('forge:cid');
			return id ? { 'x-forge-client': id } : {};
		} catch {
			return {};
		}
	}

	function currentSource() {
		const creationId = model?.creationId || creationIdFromGlbUrl(model?.glbUrl);
		return {
			modelId: creationId || undefined,
			glbUrl: creationId ? undefined : model?.glbUrl,
			title: model?.label || '',
			sourcePage: creationId ? `/m/${creationId}` : '',
			headers: clientHeaders(),
		};
	}

	async function ensureMounted() {
		if (mounted) return mounted.setSource(currentSource());
		if (loading) return loading;
		loading = import('./hero-clip-panel.js')
			.then(({ mountHeroClip }) => {
				mounted = mountHeroClip(body, currentSource());
			})
			.catch((err) => {
				console.error('[forge-hero-clip] panel failed to load', err);
				body.innerHTML = `<div class="hc-callout hc-callout--error" role="alert"><p><strong>The hero clip panel could not load.</strong> Check your connection, then close and reopen it.</p></div>`;
			})
			.finally(() => {
				loading = null;
			});
		return loading;
	}

	function setOpen(open) {
		panel.hidden = !open;
		triggerBtn.setAttribute('aria-expanded', String(open));
		if (!open) return;
		ensureMounted();
		panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	}

	triggerBtn.addEventListener('click', () => setOpen(panel.hidden));
	panel.querySelector('.hc-forge-close').addEventListener('click', () => {
		setOpen(false);
		triggerBtn.focus();
	});

	document.addEventListener('forge:model-ready', (e) => {
		if (!e.detail?.glbUrl) return;
		model = { glbUrl: e.detail.glbUrl, label: e.detail.label || '', creationId: e.detail.creationId || null };
		if (mounted) mounted.setSource(currentSource());
		setOpen(false);
	});
}
