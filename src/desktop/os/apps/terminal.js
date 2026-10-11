// Terminal: a real command line over the virtual file system and the live
// three.ws APIs. Parsing and commands live in term-commands.js.
import './terminal.css';
import { createEnv, runLine, complete, commonPrefix } from './term-commands.js';

const HIST_KEY = 'tws:term:history';
const MAX_LINES = 3000;
const T0 = performance.now();

function gpuName() {
	try {
		const gl = document.createElement('canvas').getContext('webgl');
		const ext = gl?.getExtension('WEBGL_debug_renderer_info');
		return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
	} catch {
		return null;
	}
}

function browserName(ua) {
	const m = ua.match(/(Edg|OPR|Firefox|Chrome|Safari)\/([\d.]+)/);
	if (!m) return ua;
	const n = { Edg: 'Edge', OPR: 'Opera' }[m[1]] || m[1];
	return `${n} ${m[2].split('.')[0]}`;
}

export async function mount(host, ctx) {
	const { h } = ctx;
	let appList = [];
	try {
		appList = (await import('../registry.js')).OS_APPS.map((a) => ({ id: a.id, title: a.title }));
	} catch {
		appList = [];
	}
	let history = [];
	try {
		history = JSON.parse(ctx.store.get(HIST_KEY) || '[]').filter((x) => typeof x === 'string').slice(-200);
	} catch {
		history = [];
	}

	const root = h('div', 'napp-terminal-root');
	const screen = h('div', 'tm-screen');
	screen.tabIndex = -1;
	const promptRow = h('div', 'tm-row tm-prompt-row');
	const promptEl = h('span', 'tm-prompt');
	const input = h('input', 'tm-input');
	input.type = 'text';
	input.spellcheck = false;
	input.autocomplete = 'off';
	input.autocapitalize = 'off';
	input.setAttribute('aria-label', 'Terminal command line');
	promptRow.append(promptEl, input);
	screen.append(promptRow);
	root.append(screen);
	host.append(root);

	const host_ = {
		openPath: (p) => ctx.openPath(p),
		launchId: (id, o) => ctx.launchId(id, o),
		apps: appList,
		windows: () => ctx.windows().map((w) => ({ id: w.id, title: w.title })),
		closeWindow: (id) => ctx.closeWindow(id),
		userName: () => String(ctx.prefs?.name || 'guest').replace(/\s+/g, '_'),
		uptimeMs: () => performance.now() - T0,
		clear: () => clearScreen(),
		setTheme(mode) {
			ctx.setPrefs({ mode });
		},
		sysinfo() {
			const nav = navigator;
			return {
				platform: nav.userAgentData?.platform || nav.platform,
				userAgent: nav.userAgent,
				browser: browserName(nav.userAgent),
				cores: nav.hardwareConcurrency,
				deviceMemory: nav.deviceMemory,
				gpu: gpuName(),
				screen: `${screen_.width}x${screen_.height} @${devicePixelRatio}x`,
				language: nav.language,
				theme: document.documentElement.getAttribute('data-theme'),
			};
		},
	};
	const screen_ = window.screen;
	const env = createEnv({
		fs: ctx.fs,
		fetch: (...a) => window.fetch(...a),
		host: host_,
		baseUrl: location.origin + '/',
		history,
	});

	const promptText = () => `${host_.userName()}@three.ws:${env.cwd === '/' ? '~' : env.cwd}$`;
	const refreshPrompt = () => {
		promptEl.textContent = promptText();
	};

	function addLine(segs, extraCls = '') {
		const row = h('div', `tm-row ${extraCls}`);
		for (const s of segs) {
			const span = document.createElement('span');
			if (s.c) span.className = `tm-${s.c}`;
			span.textContent = s.t;
			row.append(span);
		}
		screen.insertBefore(row, promptRow);
		while (screen.children.length > MAX_LINES) screen.firstElementChild.remove();
		return row;
	}
	function print(segs) {
		// split segments on newlines so each visual line is its own row
		let cur = [];
		const flush = () => {
			addLine(cur.length ? cur : [{ t: ' ', c: '' }]);
			cur = [];
		};
		for (const s of segs) {
			const parts = s.t.split('\n');
			parts.forEach((p, i) => {
				if (i > 0) flush();
				if (p) cur.push({ t: p, c: s.c });
			});
		}
		if (cur.length) flush();
	}
	function clearScreen() {
		[...screen.children].forEach((c) => c !== promptRow && c.remove());
	}
	const scrollEnd = () => {
		screen.scrollTop = screen.scrollHeight;
	};

	print([{ t: 'three.ws terminal', c: 'acc' }]);
	print([{ t: 'Type help for commands. Tab completes, Up and Down browse history, Ctrl+C cancels.', c: 'dim' }]);
	refreshPrompt();

	let running = null;
	let hi = history.length;
	let draft = '';
	let lastTab = '';

	async function exec(line) {
		addLine([{ t: promptText(), c: 'ok' }, { t: ` ${line}`, c: '' }]);
		if (line.trim()) {
			if (history[history.length - 1] !== line) history.push(line);
			history.length > 200 && history.splice(0, history.length - 200);
			ctx.store.set(HIST_KEY, JSON.stringify(history));
		}
		hi = history.length;
		draft = '';
		const ac = new AbortController();
		running = ac;
		promptRow.hidden = true;
		const r = await runLine(line, env, { signal: ac.signal });
		running = null;
		if (!ac.signal.aborted && !r.cleared) print(r.out.segs);
		else if (r.cleared) clearScreen();
		promptRow.hidden = false;
		refreshPrompt();
		input.focus();
		scrollEnd();
	}

	input.addEventListener('keydown', async (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			const v = input.value;
			input.value = '';
			lastTab = '';
			exec(v);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			if (hi === history.length) draft = input.value;
			if (hi > 0) input.value = history[--hi];
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			if (hi < history.length) {
				hi++;
				input.value = hi === history.length ? draft : history[hi];
			}
		} else if (e.key === 'Tab') {
			e.preventDefault();
			const before = input.value.slice(0, input.selectionStart);
			const after = input.value.slice(input.selectionStart);
			const { start, matches } = await complete(before, env);
			if (!matches.length) return;
			const pre = commonPrefix(matches);
			if (matches.length === 1) {
				const full = matches[0] + (matches[0].endsWith('/') ? '' : ' ');
				input.value = before.slice(0, start) + full + after;
				const pos = start + full.length;
				input.setSelectionRange(pos, pos);
			} else {
				if (pre.length > before.length - start) {
					input.value = before.slice(0, start) + pre + after;
					const pos = start + pre.length;
					input.setSelectionRange(pos, pos);
				} else if (lastTab === before) {
					addLine([{ t: promptText(), c: 'ok' }, { t: ` ${input.value}`, c: '' }]);
					print([{ t: matches.map((m) => m.split('/').filter(Boolean).pop() + (m.endsWith('/') ? '/' : '')).join('  '), c: 'dim' }]);
					scrollEnd();
				}
				lastTab = before;
				return;
			}
			lastTab = '';
		} else if (e.ctrlKey && e.key.toLowerCase() === 'l') {
			e.preventDefault();
			clearScreen();
		} else if (e.ctrlKey && e.key.toLowerCase() === 'c' && input.selectionStart === input.selectionEnd) {
			e.preventDefault();
			addLine([{ t: promptText(), c: 'ok' }, { t: ` ${input.value}^C`, c: '' }]);
			input.value = '';
		} else if (e.ctrlKey && e.key.toLowerCase() === 'u') {
			e.preventDefault();
			input.value = input.value.slice(input.selectionStart);
		}
		if (e.key !== 'Tab') lastTab = '';
	});

	// Ctrl+C while a command runs: the input is hidden, so listen on the root.
	root.addEventListener('keydown', (e) => {
		if (running && e.ctrlKey && e.key.toLowerCase() === 'c' && !String(getSelection())) {
			e.preventDefault();
			running.abort();
			addLine([{ t: '^C', c: 'err' }]);
		}
	});
	root.tabIndex = -1;

	// Clicking the output focuses the prompt unless the user is selecting text.
	screen.addEventListener('mouseup', () => {
		if (!String(getSelection())) input.focus();
	});

	const first = ctx.arg;
	const run = (a) => typeof a === 'string' && a.trim() && exec(a);
	ctx.onArg?.((a) => run(a));
	if (typeof first === 'string') run(first);
	requestAnimationFrame(() => input.focus());

	return () => {
		running?.abort();
	};
}
