/**
 * The Forge photo gate: run the on-device check on one picked photo, show the
 * visitor the original next to the prepared image with any warnings, and hand
 * back the file to upload. Nothing leaves the device until they confirm.
 *
 *   const outcome = await reviewPhoto(file, { viewLabel: 'Front', onProgress });
 *   // { action: 'use', file, prepared }   upload `file`
 *   // { action: 'retake' }                 clear the slot, open the picker again
 *   // { action: 'cancel' }                 clear the slot
 *   // { action: 'fallback', file, note }   device cannot run the check: upload
 *   //                                      the original as before, show `note`
 *
 * Photos are checked one at a time: the worker holds one ONNX session, and one
 * dialog at a time is what a visitor can answer anyway.
 */

import './review.css';
import { photoPrepSupport, preparePhoto, DEFAULT_UPLOAD } from './client.js';

/** Inputs above this are not decoded on the device (a phone can run out of memory). */
export const MAX_PREP_INPUT_BYTES = 40 * 1024 * 1024;

let queue = Promise.resolve();

export function reviewPhoto(file, opts = {}) {
	const run = queue.then(() => gate(file, opts));
	queue = run.catch(() => {});
	return run;
}

async function gate(file, { viewLabel = 'Photo', onProgress = () => {} }) {
	const support = await photoPrepSupport();
	if (!support.run) {
		return { action: 'fallback', file, note: `${support.reason} Your photo uploads as before, without the on-device check.` };
	}
	if (file.size > MAX_PREP_INPUT_BYTES) {
		return { action: 'fallback', file, note: 'This photo is too large to check on the device, so it uploads as before.' };
	}
	let result;
	try {
		result = await preparePhoto(file, { provider: support.provider, onProgress });
	} catch (err) {
		console.warn('[forge] on-device photo check failed, uploading the original:', err);
		return { action: 'fallback', file, note: 'The photo check could not run on this device, so your photo uploads as before.' };
	}
	onProgress({ stage: 'review' });
	return openDialog(file, result, viewLabel);
}

function formatBytes(n) {
	if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	return `${Math.max(1, Math.round(n / 1024))} KB`;
}

function preparedName(name, type) {
	const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1];
	return `${(name || 'photo').replace(/\.[^.]+$/, '')}-prepared.${ext}`;
}

const PROVIDER_LABEL = { webgpu: 'WebGPU', wasm: 'WebAssembly' };

function openDialog(file, result, viewLabel) {
	const upload = DEFAULT_UPLOAD === 'cutout' ? result.cutout : result.prepared;
	const hasPrepared = Boolean(upload);
	const warnings = result.warnings || [];
	const urls = [];
	const url = (blob) => {
		const u = URL.createObjectURL(blob);
		urls.push(u);
		return u;
	};

	const dialog = document.createElement('dialog');
	dialog.className = 'pp-dialog';
	dialog.setAttribute('aria-labelledby', 'pp-title');
	dialog.setAttribute('aria-describedby', 'pp-sub');
	dialog.dataset.noI18n = '';
	const seconds = (result.timings.totalMs / 1000).toFixed(1);
	const side = result.plan ? result.plan.outSize : 0;

	dialog.innerHTML = `
		<form method="dialog" class="pp-body">
			<header class="pp-head">
				<h2 id="pp-title">Check your ${escapeHtml(viewLabel.toLowerCase())} photo</h2>
				<p id="pp-sub" class="pp-sub">Checked on this device. Nothing has been uploaded yet.</p>
			</header>
			<div class="pp-compare" data-send="${hasPrepared ? 'prepared' : 'original'}">
				<figure class="pp-fig" data-variant="original">
					<div class="pp-frame"><img alt="Your original photo" /></div>
					<figcaption>
						<strong>Original</strong>
						<span>${result.width} x ${result.height} · ${formatBytes(file.size)}</span>
					</figcaption>
				</figure>
				${
					hasPrepared
						? `<figure class="pp-fig" data-variant="prepared">
					<div class="pp-frame pp-checker"><img alt="The prepared photo: cropped square around the subject" /></div>
					<figcaption>
						<strong>Prepared</strong>
						<span>${side} x ${side} · ${formatBytes(upload.size)}</span>
						<span class="pp-seg" role="group" aria-label="Prepared preview">
							<button type="button" class="pp-seg-btn" data-show="photo" aria-pressed="true">Photo</button>
							<button type="button" class="pp-seg-btn" data-show="cutout" aria-pressed="false">Cutout</button>
						</span>
					</figcaption>
				</figure>`
						: ''
				}
			</div>
			${
				warnings.length
					? `<ul class="pp-warnings" aria-label="What the check found">${warnings
							.map((w) => `<li data-code="${w.code}">${escapeHtml(w.message)}</li>`)
							.join('')}</ul>`
					: '<p class="pp-ok">Looks good: one clear subject, sharp and well lit.</p>'
			}
			${
				hasPrepared
					? `<label class="pp-toggle"><input type="checkbox" name="original" /> <span>Send the original photo instead</span></label>`
					: ''
			}
			<footer class="pp-foot">
				<span class="pp-meta">${PROVIDER_LABEL[result.provider] || result.provider} · ${seconds} s</span>
				<button type="submit" value="retake" class="pp-btn">Retake</button>
				<button type="submit" value="use" class="pp-btn pp-primary" autofocus>${warnings.length ? 'Use anyway' : 'Use this photo'}</button>
			</footer>
		</form>`;

	const compare = dialog.querySelector('.pp-compare');
	dialog.querySelector('[data-variant="original"] img').src = url(file);
	const prepImg = dialog.querySelector('[data-variant="prepared"] img');
	if (prepImg) {
		const photoUrl = url(upload);
		const cutoutUrl = result.cutout ? url(result.cutout) : photoUrl;
		prepImg.src = photoUrl;
		for (const btn of dialog.querySelectorAll('.pp-seg-btn')) {
			btn.addEventListener('click', () => {
				const cutout = btn.dataset.show === 'cutout';
				prepImg.src = cutout ? cutoutUrl : photoUrl;
				for (const b of dialog.querySelectorAll('.pp-seg-btn')) b.setAttribute('aria-pressed', String(b === btn));
			});
		}
	}
	const toggle = dialog.querySelector('input[name="original"]');
	toggle?.addEventListener('change', () => {
		compare.dataset.send = toggle.checked ? 'original' : 'prepared';
	});

	document.body.appendChild(dialog);
	return new Promise((resolve) => {
		let settled = false;
		const finish = (outcome) => {
			if (settled) return;
			settled = true;
			dialog.close();
			dialog.remove();
			for (const u of urls) URL.revokeObjectURL(u);
			resolve(outcome);
		};
		dialog.addEventListener('cancel', (e) => {
			e.preventDefault();
			finish({ action: 'cancel' });
		});
		dialog.querySelector('form').addEventListener('submit', (e) => {
			e.preventDefault();
			const choice = e.submitter?.value;
			if (choice === 'retake') return finish({ action: 'retake' });
			if (!hasPrepared || toggle?.checked) return finish({ action: 'use', file, prepared: false });
			finish({ action: 'use', file: new File([upload], preparedName(file.name, upload.type), { type: upload.type }), prepared: true });
		});
		dialog.showModal();
	});
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
