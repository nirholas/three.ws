// Forge Workflows: the inspector panel and the shared param form.
//
// The form renderer is used by both the inspector (desktop) and the phone
// layout, so a prompt or photo is edited the same way everywhere.

import { findPort, inputPorts, outputPorts, incomingEdges } from './graph.js';
import { paramOptions, visibleParams } from './node-types.js';
import { uploadImage, uploadGlb } from './executors.js';
import { h, icon, ICONS, toast, MOD, formatSeconds } from './ui.js';
import { summarizeNode } from './runner.js';

let fieldSeq = 0;
const fid = (p) => `fw-f-${p}-${++fieldSeq}`;

/**
 * Render the editable params of one node.
 *
 * @param {object} node
 * @param {object} def
 * @param {object} ctx                     live catalog / Modly / sign-in context
 * @param {(paramId:string, value:any, opts:{rerender:boolean, coalesce:boolean}) => void} onChange
 * @param {object} [opts]
 * @param {string[]} [opts.only]           restrict to these param ids
 * @param {boolean} [opts.disabled]
 */
export function paramForm(node, def, ctx, onChange, { only, disabled = false } = {}) {
	const params = node.params || {};
	const fields = visibleParams(def, params).filter((p) => !only || only.includes(p.id));
	return h(
		'div',
		{ class: 'fw-form' },
		fields.map((p) => field(node, p, params, ctx, onChange, disabled)),
	);
}

function field(node, p, params, ctx, onChange, disabled) {
	const id = fid(p.id);
	const value = params[p.id];
	const hint = p.hint ? h('div', { class: 'fw-hint', id: `${id}-hint` }, p.hint) : null;
	const described = p.hint ? `${id}-hint` : null;
	let control;

	if (p.kind === 'select') {
		const options = paramOptions(p, ctx, params);
		const known = options.some((o) => String(o.value) === String(value));
		control = h(
			'select',
			{
				id,
				class: 'fw-input',
				disabled,
				'aria-describedby': described,
				dataset: { param: p.id },
				on: {
					change: (e) => {
						const opt = options.find((o) => String(o.value) === e.target.value);
						onChange(p.id, opt ? opt.value : e.target.value, { rerender: true });
					},
				},
			},
			!known && value !== '' && value != null ? h('option', { value: String(value) }, `${value} (unavailable)`) : null,
			!known && (value === '' || value == null) ? h('option', { value: '' }, options.length ? 'Choose one' : 'Nothing to choose yet') : null,
			options.map((o) => h('option', { value: String(o.value), selected: String(o.value) === String(value) }, o.label)),
		);
		control.value = String(value ?? '');
	} else if (p.kind === 'textarea') {
		control = h('textarea', {
			id,
			class: 'fw-input',
			rows: p.id === 'prompts' ? 6 : 4,
			maxlength: p.maxLength || null,
			disabled,
			'aria-describedby': described,
			dataset: { param: p.id },
			value: value ?? '',
			on: { input: (e) => onChange(p.id, e.target.value, { coalesce: true }) },
		});
	} else if (p.kind === 'number') {
		control = h('input', {
			id,
			type: 'number',
			class: 'fw-input',
			min: p.min,
			max: p.max,
			step: p.step || 1,
			inputmode: 'numeric',
			disabled,
			'aria-describedby': described,
			dataset: { param: p.id },
			value: value ?? '',
			on: {
				change: (e) => {
					let n = Number(e.target.value);
					if (!Number.isFinite(n)) n = p.default;
					n = Math.min(p.max ?? n, Math.max(p.min ?? n, Math.round(n)));
					e.target.value = String(n);
					onChange(p.id, n, {});
				},
			},
		});
	} else if (p.kind === 'checkbox') {
		return h(
			'label',
			{ class: 'fw-check' },
			h('input', { type: 'checkbox', checked: value !== false, disabled, dataset: { param: p.id }, on: { change: (e) => onChange(p.id, e.target.checked, {}) } }),
			h('span', {}, p.label),
		);
	} else if (p.kind === 'images') {
		control = imagesField(id, p, value, onChange, disabled);
	} else if (p.kind === 'mesh-url') {
		control = meshField(id, p, params, onChange, disabled);
	} else {
		control = h('input', {
			id,
			type: 'text',
			class: 'fw-input',
			maxlength: p.maxLength || null,
			disabled,
			'aria-describedby': described,
			dataset: { param: p.id },
			value: value ?? '',
			on: { input: (e) => onChange(p.id, e.target.value, { coalesce: true }) },
		});
	}
	return h('div', { class: 'fw-field' }, h('label', { class: 'fw-label', for: id }, p.label), control, hint);
}

function imagesField(id, p, value, onChange, disabled) {
	const list = Array.isArray(value) ? value : [];
	const max = p.max || 1;
	const wrap = h('div', { class: 'fw-images' });
	const pending = h('div', { class: 'fw-images-pending', 'aria-live': 'polite' });

	const thumbs = h(
		'div',
		{ class: 'fw-images-grid' },
		list.map((img, i) =>
			h(
				'figure',
				{ class: 'fw-image' },
				h('img', { src: img.url, alt: img.name || `Photo ${i + 1}`, loading: 'lazy' }),
				h(
					'button',
					{
						type: 'button',
						class: 'fw-image-remove',
						disabled,
						'aria-label': `Remove ${img.name || `photo ${i + 1}`}`,
						on: { click: () => onChange(p.id, list.filter((_, j) => j !== i), { rerender: true }) },
					},
					icon(ICONS.x, 12),
				),
			),
		),
	);

	async function take(files) {
		const room = max - list.length;
		const picked = [...files].filter((f) => f.type.startsWith('image/'));
		if (!picked.length) {
			toast('Drop a PNG, JPEG or WebP photo.', { tone: 'error' });
			return;
		}
		const batch = max === 1 ? picked.slice(0, 1) : picked.slice(0, Math.max(0, room));
		if (!batch.length) {
			toast(`This node holds up to ${max} photos. Remove one first.`, { tone: 'error' });
			return;
		}
		pending.textContent = `Uploading ${batch.length} photo${batch.length === 1 ? '' : 's'}…`;
		wrap.classList.add('is-uploading');
		const done = [];
		for (const f of batch) {
			try {
				done.push(await uploadImage(f));
			} catch (err) {
				toast(err?.message || 'The photo upload failed. Try again.', { tone: 'error', timeout: 6000 });
			}
		}
		wrap.classList.remove('is-uploading');
		pending.textContent = '';
		if (done.length) onChange(p.id, max === 1 ? done.slice(0, 1) : [...list, ...done].slice(0, max), { rerender: true });
	}

	const input = h('input', {
		id,
		type: 'file',
		accept: 'image/png,image/jpeg,image/webp',
		multiple: max > 1,
		class: 'fw-sr-only',
		disabled,
		on: {
			change: (e) => {
				take(e.target.files);
				e.target.value = '';
			},
		},
	});
	const drop = h(
		'label',
		{ class: 'fw-drop', for: id },
		icon(ICONS.upload, 16),
		h('span', {}, list.length && max === 1 ? 'Replace photo' : max > 1 ? `Add photos (${list.length}/${max})` : 'Choose a photo'),
		h('span', { class: 'fw-drop-sub' }, 'or drop it here'),
	);
	drop.addEventListener('dragover', (e) => {
		e.preventDefault();
		drop.classList.add('is-over');
	});
	drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
	drop.addEventListener('drop', (e) => {
		e.preventDefault();
		drop.classList.remove('is-over');
		if (!disabled && e.dataTransfer?.files?.length) take(e.dataTransfer.files);
	});
	wrap.append(thumbs, input, drop, pending);
	return wrap;
}

function meshField(id, p, params, onChange, disabled) {
	const url = h('input', {
		id,
		type: 'url',
		class: 'fw-input',
		placeholder: 'https://…/model.glb',
		disabled,
		dataset: { param: p.id },
		value: params[p.id] || '',
		on: { change: (e) => onChange(p.id, e.target.value.trim(), { rerender: false }) },
	});
	const status = h('div', { class: 'fw-hint', 'aria-live': 'polite' });
	const file = h('input', {
		type: 'file',
		accept: '.glb,model/gltf-binary',
		class: 'fw-sr-only',
		id: `${id}-file`,
		disabled,
		on: {
			change: async (e) => {
				const f = e.target.files?.[0];
				e.target.value = '';
				if (!f) return;
				status.textContent = `Uploading ${f.name}…`;
				try {
					const publicUrl = await uploadGlb(f);
					status.textContent = '';
					onChange('name', f.name.replace(/\.glb$/i, ''), {});
					onChange(p.id, publicUrl, { rerender: true });
				} catch (err) {
					status.textContent = err?.message || 'The upload failed. Try again.';
				}
			},
		},
	});
	return h(
		'div',
		{ class: 'fw-mesh-field' },
		url,
		h('label', { class: 'fw-btn is-sm is-ghost', for: `${id}-file` }, icon(ICONS.upload, 13), 'Upload a GLB'),
		file,
		status,
	);
}

/**
 * The inspector panel.
 */
export function createInspector(root, app) {
	const { types } = app;

	function nodeLabel(n) {
		return types[n.type]?.label || n.type;
	}

	function onParam(nodeId) {
		return (paramId, value, { rerender = false, coalesce = false } = {}) => {
			app.updateParam(nodeId, paramId, value, { coalesce });
			if (rerender) {
				const active = document.activeElement?.dataset?.param;
				render();
				if (active) root.querySelector(`[data-param="${CSS.escape(active)}"]`)?.focus();
			}
		};
	}

	function connectionsSection(node) {
		const wf = app.getWorkflow();
		const ins = inputPorts(types[node.type], node.params);
		if (!ins.length) return null;
		return h(
			'section',
			{ class: 'fw-section' },
			h('h3', { class: 'fw-section-title' }, 'Inputs'),
			ins.map((port) => {
				const id = fid(`in-${port.id}`);
				const current = incomingEdges(wf, node.id).find((e) => e.to.port === port.id);
				const choices = [];
				for (const other of wf.nodes) {
					if (other.id === node.id) continue;
					for (const out of outputPorts(types[other.type], other.params)) {
						if (out.type !== port.type) continue;
						const ok = app.canLink({ node: other.id, port: out.id }, { node: node.id, port: port.id });
						if (!ok && !(current && current.from.node === other.id && current.from.port === out.id)) continue;
						choices.push({ value: `${other.id}::${out.id}`, label: `${nodeLabel(other)} · ${out.label || out.id}` });
					}
				}
				const sel = h(
					'select',
					{
						id,
						class: 'fw-input',
						on: {
							change: (e) => {
								const v = e.target.value;
								if (!v) app.unlinkInput(node.id, port.id);
								else {
									const [fromNode, fromPort] = v.split('::');
									app.linkInput({ node: fromNode, port: fromPort }, { node: node.id, port: port.id });
								}
								render();
							},
						},
					},
					h('option', { value: '' }, port.optional ? 'Not connected (optional)' : 'Not connected'),
					choices.map((c) => h('option', { value: c.value }, c.label)),
				);
				sel.value = current ? `${current.from.node}::${current.from.port}` : '';
				return h('div', { class: 'fw-field' }, h('label', { class: 'fw-label', for: id }, port.label || port.id), sel);
			}),
		);
	}

	function modlySection(node) {
		if (node.type !== 'generate' || node.params.engine !== 'modly') return null;
		const m = app.modly;
		const status = h('div', { class: 'fw-modly-status', 'aria-live': 'polite' });
		const btn = h(
			'button',
			{
				type: 'button',
				class: 'fw-btn is-sm',
				on: {
					click: async () => {
						btn.disabled = true;
						status.textContent = 'Looking for Modly on this computer…';
						const res = await app.connectModly();
						btn.disabled = false;
						if (res.status === 'connected') {
							render();
							return;
						}
						status.textContent = '';
						status.append(modlyExplain(res));
					},
				},
			},
			icon(ICONS.chip, 13),
			m ? 'Refresh models' : 'Connect Modly',
		);
		if (m) {
			const ready = m.models.filter((x) => x.downloaded).length;
			status.textContent = `Connected at ${m.origin}. ${ready} of ${m.models.length} model${m.models.length === 1 ? '' : 's'} downloaded.`;
		}
		return h(
			'section',
			{ class: 'fw-section fw-modly' },
			h('h3', { class: 'fw-section-title' }, 'Your GPU'),
			h('p', { class: 'fw-hint' }, 'Modly is a free desktop app that runs open image-to-3D models on your own graphics card. The browser may ask to let three.ws reach apps on this computer.'),
			h('div', { class: 'fw-row' }, btn, h('a', { class: 'fw-btn is-sm is-ghost', href: app.modlyInstallUrl, target: '_blank', rel: 'noopener' }, 'Get Modly')),
			status,
		);
	}

	function stepsSection(node) {
		const steps = app.stepsFor(node.id);
		if (!steps.length) return null;
		const sum = summarizeNode(steps);
		const running = app.isRunning();
		const rows = steps.map((s) =>
			h(
				'li',
				{ class: `fw-step is-${s.status}` },
				h('span', { class: 'fw-step-dot', 'aria-hidden': 'true' }),
				h('span', { class: 'fw-step-name' }, s.iter != null ? `Item ${s.iter + 1}` : 'This step'),
				h('span', { class: 'fw-step-state' }, stepWord(s)),
				s.error ? h('div', { class: 'fw-step-error' }, s.error.message) : null,
			),
		);
		return h(
			'section',
			{ class: 'fw-section' },
			h('h3', { class: 'fw-section-title' }, sum.total > 1 ? `Last run · ${sum.done}/${sum.total} items done` : 'Last run'),
			h('ul', { class: 'fw-steps' }, rows),
			sum.failed && !running
				? h('button', { type: 'button', class: 'fw-btn is-sm', on: { click: () => app.retryFailed() } }, icon(ICONS.retry, 13), 'Retry failed steps')
				: null,
		);
	}

	function nodeView(node) {
		const def = types[node.type];
		const running = app.isRunning();
		return [
			h(
				'header',
				{ class: 'fw-insp-head' },
				h('span', { class: `fw-cat cat-${def.category}` }, def.category),
				h('h2', { class: 'fw-insp-title' }, def.label),
				h('p', { class: 'fw-insp-blurb' }, def.blurb),
			),
			def.params?.length ? h('section', { class: 'fw-section' }, h('h3', { class: 'fw-section-title' }, 'Settings'), paramForm(node, def, app.getContext(), onParam(node.id), { disabled: running })) : null,
			modlySection(node),
			connectionsSection(node),
			issuesFor(node.id),
			stepsSection(node),
			h(
				'section',
				{ class: 'fw-section fw-insp-actions' },
				h(
					'button',
					{ type: 'button', class: 'fw-btn is-sm', disabled: running || app.hasBlocking(), title: app.hasBlocking() ? 'Fix the problems listed first' : null, on: { click: () => app.runFrom(node.id) } },
					icon(ICONS.play, 13),
					'Re-run from here',
				),
				h('button', { type: 'button', class: 'fw-btn is-sm is-ghost', disabled: running, on: { click: () => app.duplicate([node.id]) } }, 'Duplicate', h('kbd', {}, `${MOD}+D`)),
				h('button', { type: 'button', class: 'fw-btn is-sm is-danger', disabled: running, on: { click: () => app.deleteSelection() } }, icon(ICONS.trash, 13), 'Delete', h('kbd', {}, 'Del')),
			),
		];
	}

	function issuesFor(nodeId) {
		const list = app.issues().filter((i) => i.nodeId === nodeId);
		if (!list.length) return null;
		return h(
			'section',
			{ class: 'fw-section' },
			h(
				'ul',
				{ class: 'fw-issues-inline' },
				list.map((i) => h('li', { class: `is-${i.level}` }, icon(ICONS.alert, 13), h('span', {}, i.message))),
			),
		);
	}

	function edgeView(edgeId) {
		const wf = app.getWorkflow();
		const e = wf.edges.find((x) => x.id === edgeId);
		if (!e) return [];
		const a = wf.nodes.find((n) => n.id === e.from.node);
		const b = wf.nodes.find((n) => n.id === e.to.node);
		const out = findPort(types, a, e.from.port, 'out');
		const inp = findPort(types, b, e.to.port, 'in');
		return [
			h('header', { class: 'fw-insp-head' }, h('span', { class: 'fw-cat' }, 'link'), h('h2', { class: 'fw-insp-title' }, 'Link')),
			h('p', { class: 'fw-insp-blurb' }, `${nodeLabel(a)} ${out?.label || ''} feeds ${nodeLabel(b)} ${inp?.label || ''}.`),
			h('section', { class: 'fw-section fw-insp-actions' }, h('button', { type: 'button', class: 'fw-btn is-sm is-danger', disabled: app.isRunning(), on: { click: () => app.deleteSelection() } }, icon(ICONS.trash, 13), 'Delete link', h('kbd', {}, 'Del'))),
		];
	}

	function multiView(ids) {
		return [
			h('header', { class: 'fw-insp-head' }, h('h2', { class: 'fw-insp-title' }, `${ids.length} nodes selected`), h('p', { class: 'fw-insp-blurb' }, 'Drag any of them to move the group, or use the arrow keys.')),
			h(
				'section',
				{ class: 'fw-section fw-insp-actions' },
				h('button', { type: 'button', class: 'fw-btn is-sm is-ghost', disabled: app.isRunning(), on: { click: () => app.duplicate(ids) } }, 'Duplicate', h('kbd', {}, `${MOD}+D`)),
				h('button', { type: 'button', class: 'fw-btn is-sm is-danger', disabled: app.isRunning(), on: { click: () => app.deleteSelection() } }, icon(ICONS.trash, 13), 'Delete', h('kbd', {}, 'Del')),
			),
		];
	}

	function workflowView() {
		const wf = app.getWorkflow();
		const run = app.runState();
		const nameId = fid('wf-name');
		return [
			h('header', { class: 'fw-insp-head' }, h('span', { class: 'fw-cat' }, 'workflow'), h('h2', { class: 'fw-insp-title' }, 'Workflow')),
			h(
				'section',
				{ class: 'fw-section' },
				h(
					'div',
					{ class: 'fw-field' },
					h('label', { class: 'fw-label', for: nameId }, 'Name'),
					h('input', { id: nameId, class: 'fw-input', type: 'text', maxlength: 120, value: wf.name || '', on: { input: (e) => app.rename(e.target.value) } }),
				),
				h('p', { class: 'fw-hint' }, `${wf.nodes.length} node${wf.nodes.length === 1 ? '' : 's'}, ${wf.edges.length} link${wf.edges.length === 1 ? '' : 's'}. Saved in this browser as you edit; use Export to keep a file.`),
			),
			runSummary(run),
			h(
				'section',
				{ class: 'fw-section' },
				h('h3', { class: 'fw-section-title' }, 'Shortcuts'),
				h(
					'dl',
					{ class: 'fw-keys' },
					[
						[`${MOD}+Enter`, 'Run the workflow'],
						['Delete', 'Remove the selection'],
						[`${MOD}+Z`, 'Undo'],
						[`${MOD}+Shift+Z`, 'Redo'],
						[`${MOD}+D`, 'Duplicate'],
						['Arrow keys', 'Nudge (Shift for bigger steps)'],
						['Esc', 'Cancel a run or clear the selection'],
						[`${MOD}+scroll`, 'Zoom at the pointer'],
					].map(([k, d]) => [h('dt', {}, h('kbd', {}, k)), h('dd', {}, d)]),
				),
			),
		];
	}

	function runSummary(run) {
		if (!run || run.status === 'idle') {
			return h('section', { class: 'fw-section' }, h('h3', { class: 'fw-section-title' }, 'Runs'), h('p', { class: 'fw-hint' }, `Nothing has run yet. Press Run or ${MOD}+Enter. Unchanged steps are reused on the next run, so trying a new setting only redoes what it affects.`));
		}
		const steps = [...run.steps.values()];
		const count = (s) => steps.filter((x) => x.status === s).length;
		const secs = ((run.finishedAt || Date.now()) - run.startedAt) / 1000;
		const word = { running: 'Running', done: 'Finished', failed: 'Finished with failures', cancelled: 'Cancelled' }[run.status] || run.status;
		const failedNodes = [...new Set(steps.filter((s) => s.status === 'failed').map((s) => s.nodeId))];
		return h(
			'section',
			{ class: 'fw-section' },
			h('h3', { class: 'fw-section-title' }, 'Last run'),
			h('p', { class: `fw-run-word is-${run.status}` }, `${word} · ${formatSeconds(secs)}`),
			h('p', { class: 'fw-hint' }, `${count('done')} done, ${count('failed')} failed, ${count('skipped')} skipped, ${count('cancelled')} cancelled of ${steps.length} steps.`),
			failedNodes.length
				? h(
						'ul',
						{ class: 'fw-failed-list' },
						failedNodes.map((id) => {
							const n = app.getWorkflow().nodes.find((x) => x.id === id);
							return n ? h('li', {}, h('button', { type: 'button', class: 'fw-link', on: { click: () => app.focusNode(id) } }, nodeLabel(n))) : null;
						}),
					)
				: null,
			failedNodes.length && run.status !== 'running' ? h('button', { type: 'button', class: 'fw-btn is-sm', on: { click: () => app.retryFailed() } }, icon(ICONS.retry, 13), 'Retry failed steps') : null,
		);
	}

	function render() {
		const sel = app.selection();
		const wf = app.getWorkflow();
		let content;
		if (sel.edge) content = edgeView(sel.edge);
		else if (sel.nodes.length > 1) content = multiView(sel.nodes);
		else if (sel.nodes.length === 1) {
			const node = wf.nodes.find((n) => n.id === sel.nodes[0]);
			content = node ? nodeView(node) : workflowView();
		} else content = workflowView();
		root.textContent = '';
		root.append(...content.flat().filter(Boolean));
	}

	/** Refresh only the run-driven parts, without touching a field being typed in. */
	function refreshRun() {
		const active = document.activeElement;
		if (active && root.contains(active) && active.matches('input[type="text"], input[type="url"], input[type="number"], textarea')) return;
		render();
	}

	return { render, refreshRun };
}

function stepWord(s) {
	if (s.status === 'done') return s.reused ? 'Reused' : 'Done';
	return { pending: 'Waiting', running: 'Running', failed: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped (an earlier step failed)' }[s.status] || s.status;
}

export function modlyExplain(res) {
	if (res.status === 'blocked' && res.reason === 'lna-denied') {
		return h('span', {}, 'Your browser blocked three.ws from reaching apps on this computer. Allow "Local network access" for three.ws in the site settings (the icon left of the address bar), then press Connect again.');
	}
	if (res.status === 'blocked') {
		return h('span', {}, 'This browser does not let an https page reach http://localhost. Open this page in Chrome or Edge, then press Connect again.');
	}
	return h('span', {}, 'Modly is not running on this computer. Open Modly (it listens on port 8765), then press Connect again.');
}

