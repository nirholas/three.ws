// How a sandbox tool step reads on an agent run page: the program that ran, what
// it printed, how it ended, and the files it wrote, shown inline instead of as a
// JSON blob behind a Details fold. Pure string building (no DOM) so it is unit
// tested; everything a program prints is untrusted, so every value is escaped
// and file links are accepted only when they point at the owner file route.

export const SANDBOX_STEP_TOOLS = Object.freeze(['execute_code', 'terminal', 'read_file', 'write_file']);

const FILE_ROUTE = '/api/sandbox/file';

const STATUS_LABEL = {
	succeeded: 'Succeeded',
	failed: 'Failed',
	timeout: 'Timed out',
	killed: 'Stopped',
};

function bytes(n) {
	const v = Number(n);
	if (!Number.isFinite(v) || v < 0) return '';
	if (v < 1024) return `${v} B`;
	if (v < 1048576) return `${(v / 1024).toFixed(1)} KB`;
	return `${(v / 1048576).toFixed(1)} MB`;
}

function duration(ms) {
	const v = Number(ms);
	if (!Number.isFinite(v) || v < 0) return '';
	return v < 1000 ? `${Math.round(v)} ms` : `${(v / 1000).toFixed(v < 10000 ? 2 : 1)} s`;
}

/** A same-origin href for a workspace file URL, or null when it is anything else. */
export function fileHref(url) {
	if (typeof url !== 'string' || !url) return null;
	let u;
	try {
		u = new URL(url, 'https://three.ws');
	} catch {
		return null;
	}
	if (u.pathname !== FILE_ROUTE) return null;
	return `${u.pathname}${u.search}`;
}

/** The program a sandbox tool call asked to run, or null when the step is not one. */
export function sandboxProgram(step) {
	if (!step || step.kind !== 'tool_call' || !SANDBOX_STEP_TOOLS.includes(step.tool)) return null;
	const i = step.input && typeof step.input === 'object' ? step.input : {};
	if (step.tool === 'execute_code') return { label: String(i.language || 'code'), source: String(i.code ?? '') };
	if (step.tool === 'terminal') return { label: 'bash', source: String(i.command ?? '') };
	if (step.tool === 'write_file') return { label: `write ${String(i.path ?? '')}`, source: String(i.content ?? '') };
	return { label: `read ${String(i.path ?? 'workspace')}`, source: '' };
}

function streamBlock(esc, name, text, truncated) {
	if (!text) return '';
	return `<div class="rr-sb-stream"><strong>${name}</strong><pre class="rr-sb-${name}">${esc(text)}</pre>${truncated ? `<p class="rr-note">${name} was cut at the output cap.</p>` : ''}</div>`;
}

/**
 * Inline HTML for a sandbox step, or '' when the step is not a sandbox call or
 * result. `esc` is the page's HTML escaper.
 */
export function sandboxStepHTML(step, esc) {
	const program = sandboxProgram(step);
	if (program) {
		const source = program.source ? `<pre class="rr-sb-code">${esc(program.source)}</pre>` : '';
		return `<div class="rr-sb"><p class="rr-sb-label">${esc(program.label)}</p>${source}</div>`;
	}
	if (!step || step.kind !== 'tool_result' || !SANDBOX_STEP_TOOLS.includes(step.tool)) return '';
	const o = step.output && typeof step.output === 'object' ? step.output : null;
	if (!o) return '';
	if (typeof o.error === 'string' && o.exit_code === undefined && o.status === undefined) {
		return `<div class="rr-sb"><p class="rr-sb-label rr-sb-bad">${esc(o.error)}</p></div>`;
	}
	if (o.status === undefined && o.exit_code === undefined) return '';
	const facts = [
		STATUS_LABEL[o.status] || o.status,
		o.exit_code != null ? `exit ${o.exit_code}` : '',
		duration(o.wall_ms),
		Number(o.cost_usd) > 0 ? `$${Number(o.cost_usd).toFixed(4)}` : '',
	].filter(Boolean);
	const tone = o.status === 'succeeded' ? 'rr-sb-ok' : 'rr-sb-bad';
	const files = (Array.isArray(o.files_changed) ? o.files_changed : [])
		.map((f) => {
			const name = esc(f?.path ?? '');
			const href = fileHref(f?.url);
			const size = bytes(f?.size);
			return `<li>${href ? `<a class="rr-sb-file" href="${esc(href)}" download>${name}</a>` : `<span class="rr-sb-file">${name}</span>`}${size ? ` <span class="rr-note">${esc(size)}</span>` : ''}</li>`;
		})
		.join('');
	return `<div class="rr-sb">
		<p class="rr-sb-label ${tone}">${esc(facts.join(' | '))}</p>
		${streamBlock(esc, 'stdout', o.stdout, o.stdout_truncated)}
		${streamBlock(esc, 'stderr', o.stderr, o.stderr_truncated)}
		${files ? `<div class="rr-sb-files"><strong>Files</strong><ul>${files}</ul></div>` : ''}
		${o.error ? `<p class="rr-sb-label rr-sb-bad">${esc(o.error)}</p>` : ''}
	</div>`;
}
