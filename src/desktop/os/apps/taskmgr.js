// Task Manager: running desktop windows, live performance from real browser
// sources, and page/resource details. Anything the browser cannot measure is
// labelled as such; no number is invented.
import './taskmgr.css';
import {
	RingBuffer, formatBytes, formatMs, formatPct, fpsFromFrames, mainThreadLoad, shareTotal, windowWeight,
	summarizeResources, shortUrl, sortRows, pageTiming,
} from './perf-logic.js';

const NA = 'Not supported by this browser';
const N = 60;

function gpuName() {
	try {
		const gl = document.createElement('canvas').getContext('webgl');
		const ext = gl?.getExtension('WEBGL_debug_renderer_info');
		return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
	} catch {
		return null;
	}
}

export function mount(host, ctx) {
	const { h, esc } = ctx;
	const root = h('div', 'tmg');
	root.innerHTML = `
		<div class="tmg-tabs" role="tablist">
			<button role="tab" data-tab="proc" aria-selected="true">Processes</button>
			<button role="tab" data-tab="perf" aria-selected="false">Performance</button>
			<button role="tab" data-tab="det" aria-selected="false">Details</button>
		</div>
		<section class="tmg-pane" data-pane="proc"></section>
		<section class="tmg-pane" data-pane="perf" hidden></section>
		<section class="tmg-pane" data-pane="det" hidden></section>
		<div class="tmg-menu" hidden role="menu"></div>`;
	host.append(root);
	const pane = (n) => root.querySelector(`[data-pane="${n}"]`);
	const menu = root.querySelector('.tmg-menu');
	const procPane = pane('proc');

	let tab = 'proc';
	let sort = { key: 'name', dir: 1 };
	let selected = null;
	let heapTotal = null;
	let heapExact = false;
	const disposers = [];
	let disposed = false;

	/* ---------------- sampling ---------------- */
	const buf = { cpu: new RingBuffer(N), fps: new RingBuffer(N), mem: new RingBuffer(N), rtt: new RingBuffer(N) };
	const frames = [];
	let rafId = 0;
	let tasks = [];
	let lastTick = performance.now();
	let lateSum = 0;
	let probeAt = performance.now();
	let probeTimer = 0;
	let tickTimer = 0;
	let po = null;
	const live = { battery: null, storage: null, rttNow: null, gpu: gpuName(), cpuNow: null, fpsNow: null };
	let battery = null;

	if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
		try {
			po = new PerformanceObserver((list) => {
				tasks.push(...list.getEntries().map((e) => ({ startTime: e.startTime, duration: e.duration })));
			});
			po.observe({ type: 'longtask', buffered: false });
		} catch {
			po = null;
		}
	}
	navigator.getBattery?.().then((b) => {
		battery = b;
	}).catch(() => {});

	const active = () => document.visibilityState === 'visible' && host.offsetParent !== null && !disposed;

	function rafLoop(t) {
		frames.push(t);
		if (frames.length > 400) frames.splice(0, frames.length - 400);
		rafId = requestAnimationFrame(rafLoop);
	}
	function startRaf() {
		if (!rafId) rafId = requestAnimationFrame(rafLoop);
	}
	function stopRaf() {
		cancelAnimationFrame(rafId);
		rafId = 0;
		frames.length = 0;
	}

	// Timer drift probe: a 100ms timer that arrives late shows main-thread contention.
	function probe() {
		const now = performance.now();
		if (active()) lateSum += Math.max(0, now - probeAt - 100);
		probeAt = now;
		probeTimer = setTimeout(probe, 100);
	}

	async function rttProbe() {
		const t0 = performance.now();
		try {
			await fetch(location.pathname, { method: 'HEAD', cache: 'no-store' });
			live.rttNow = performance.now() - t0;
		} catch {
			live.rttNow = null;
		}
	}

	async function readMemory() {
		if (performance.measureUserAgentSpecificMemory && self.crossOriginIsolated) {
			try {
				const m = await performance.measureUserAgentSpecificMemory();
				heapTotal = m.bytes;
				heapExact = true;
				return;
			} catch {
				/* fall through to the heap counter */
			}
		}
		heapExact = false;
		heapTotal = performance.memory?.usedJSHeapSize ?? null;
	}

	let ticks = 0;
	async function tick() {
		const now = performance.now();
		if (!active()) {
			stopRaf();
			tasks = [];
			lateSum = 0;
			lastTick = now;
			return;
		}
		startRaf();
		const elapsed = now - lastTick;
		const cut = tasks;
		tasks = [];
		const cpu = frames.length > 2 || ticks > 0 ? mainThreadLoad({ tasks: cut, t0: lastTick, t1: now, expectedMs: elapsed, actualMs: elapsed + lateSum }) : null;
		lateSum = 0;
		lastTick = now;
		ticks++;
		live.cpuNow = cpu;
		buf.cpu.push(cpu);
		live.fpsNow = fpsFromFrames(frames, now);
		buf.fps.push(live.fpsNow);
		await readMemory();
		buf.mem.push(heapTotal);
		if (ticks % 5 === 1) rttProbe().then(() => buf.rtt.push(live.rttNow));
		if (ticks % 10 === 1 && navigator.storage?.estimate) navigator.storage.estimate().then((e) => (live.storage = e)).catch(() => {});
		render();
	}

	/* ---------------- Processes ---------------- */
	function procRows() {
		const wins = ctx.windows();
		const shares = shareTotal(heapTotal, wins.map((w) => windowWeight(w.rect)));
		return wins.map((w, i) => ({
			id: w.id, app: w.app, name: w.title, status: w.minimized ? 'Minimized' : 'Running',
			mem: heapTotal == null ? null : shares[i],
			size: w.rect ? w.rect.w * w.rect.h : null, rect: w.rect,
		}));
	}
	let procSig = '';
	const memText = () => (heapTotal == null ? 'Memory is not reported by this browser.' : `Page ${heapExact ? 'memory measured at' : 'JS heap is'} ${formatBytes(heapTotal)}; per-window values are shares by window area (estimated).`);
	function renderProc() {
		const focusId = procPane.contains(document.activeElement) ? document.activeElement.closest('[data-id]')?.dataset.id : null;
		const rows = sortRows(procRows(), sort.key, sort.dir);
		if (selected && !rows.some((r) => r.id === selected)) selected = null;
		const p = pane('proc');
		const sig = JSON.stringify([rows.map((r) => [r.id, r.name, r.status, r.rect && [Math.round(r.rect.w), Math.round(r.rect.h)]]), sort, selected, heapTotal == null, heapExact]);
		if (sig === procSig) {
			rows.forEach((r) => {
				const c = p.querySelector(`[data-id="${CSS.escape(r.id)}"] [data-mem]`);
				if (c) c.textContent = r.mem == null ? 'n/a' : formatBytes(r.mem);
			});
			const note = p.querySelector('.tmg-note');
			if (note) note.textContent = memText();
			return;
		}
		procSig = sig;
		const arrow = (k) => (sort.key === k ? (sort.dir > 0 ? ' ▲' : ' ▼') : '');
		p.innerHTML = `
			<div class="tmg-bar"><span><b>${rows.length}</b> app${rows.length === 1 ? '' : 's'} running</span>
				<button class="tmg-btn" data-act="end" ${selected ? '' : 'disabled'}>End task</button></div>
			<div class="tmg-table" role="table">
				<div class="tmg-tr tmg-th" role="row">
					<button data-sort="name" role="columnheader">Name${arrow('name')}</button>
					<button data-sort="status" role="columnheader">Status${arrow('status')}</button>
					<button data-sort="size" role="columnheader" class="r">Window${arrow('size')}</button>
					<button data-sort="mem" role="columnheader" class="r">Memory (est.)${arrow('mem')}</button>
				</div>
				${rows.length ? rows.map((r) => `
					<div class="tmg-tr tmg-row${r.id === selected ? ' sel' : ''}" role="row" tabindex="0" data-id="${esc(r.id)}">
						<span class="tmg-name">${ctx.tile(r.app, 'sm', 16)}<span>${esc(r.name)}</span></span>
						<span class="${r.status === 'Minimized' ? 'dim' : ''}">${r.status}</span>
						<span class="r dim">${r.rect ? `${Math.round(r.rect.w)} x ${Math.round(r.rect.h)}` : 'n/a'}</span>
						<span class="r" data-mem>${r.mem == null ? 'n/a' : formatBytes(r.mem)}</span>
					</div>`).join('') : '<div class="tmg-empty">No apps are open.</div>'}
			</div>
			<p class="tmg-note">${esc(memText())}</p>`;
		if (focusId) p.querySelector(`[data-id="${CSS.escape(focusId)}"]`)?.focus();
	}

	/* ---------------- Performance ---------------- */
	let perfSel = 'cpu';
	const conn = () => navigator.connection;
	function metrics() {
		const c = conn();
		const heapLabel = heapExact ? 'Page memory' : 'JS heap';
		return [
			{ id: 'cpu', name: 'Main thread', buf: buf.cpu, max: 1, value: formatPct(live.cpuNow), sub: 'Estimated from long tasks and timer drift', fmt: formatPct, ok: true },
			{ id: 'fps', name: 'Frame rate', buf: buf.fps, max: 120, value: live.fpsNow == null ? 'n/a' : `${Math.round(live.fpsNow)} fps`, sub: 'requestAnimationFrame cadence', fmt: (v) => `${Math.round(v)} fps`, ok: true },
			{ id: 'mem', name: heapLabel, buf: buf.mem, max: null, value: heapTotal == null ? NA : formatBytes(heapTotal), sub: heapExact ? 'measureUserAgentSpecificMemory' : 'performance.memory (Chromium)', fmt: formatBytes, ok: heapTotal != null },
			{ id: 'net', name: 'Network', buf: buf.rtt, max: null, value: live.rttNow == null ? 'n/a' : formatMs(live.rttNow), sub: c ? `${c.effectiveType || '?'}  ${c.downlink ?? '?'} Mbps  rtt ${c.rtt ?? '?'} ms (browser estimate)` : 'Round trip to this site (measured)', fmt: formatMs, ok: true },
		];
	}
	function facts() {
		const st = live.storage;
		const c = conn();
		return [
			['Logical cores', navigator.hardwareConcurrency ? String(navigator.hardwareConcurrency) : NA],
			['Device memory', navigator.deviceMemory ? `${navigator.deviceMemory} GB (rounded, capped by the browser)` : NA],
			['GPU', live.gpu || 'Unavailable'],
			['Connection', c ? `${c.effectiveType || 'unknown'}, ${c.downlink ?? '?'} Mbps down, ${c.rtt ?? '?'} ms rtt${c.saveData ? ', data saver on' : ''}` : NA],
			['Battery', battery ? `${Math.round(battery.level * 100)}%${battery.charging ? ', charging' : ''}` : navigator.getBattery ? 'Reading...' : NA],
			['Storage', st ? `${formatBytes(st.usage)} used of ${formatBytes(st.quota)} quota` : navigator.storage?.estimate ? 'Reading...' : NA],
			['Cross-origin isolated', self.crossOriginIsolated ? 'Yes (exact page memory available)' : 'No (page memory is the JS heap)'],
		];
	}
	function renderPerf() {
		const p = pane('perf');
		const ms = metrics();
		if (!p.firstElementChild) {
			p.innerHTML = '<div class="tmg-side"></div><div class="tmg-main"><div class="tmg-head"></div><canvas class="tmg-graph"></canvas><div class="tmg-facts"></div></div>';
			p.querySelector('.tmg-side').addEventListener('click', (e) => {
				const b = e.target.closest('[data-m]');
				if (b) {
					perfSel = b.dataset.m;
					renderPerf();
				}
			});
		}
		p.querySelector('.tmg-side').innerHTML = ms.map((m) => `
			<button class="tmg-m${m.id === perfSel ? ' sel' : ''}" data-m="${m.id}">
				<canvas width="96" height="40" data-spark="${m.id}"></canvas>
				<span><b>${esc(m.name)}</b><small>${esc(m.value)}</small></span>
			</button>`).join('');
		const cur = ms.find((m) => m.id === perfSel) || ms[0];
		p.querySelector('.tmg-head').innerHTML = `<h3>${esc(cur.name)}</h3><div class="big">${esc(cur.value)}</div><small>${esc(cur.sub)}</small>`;
		p.querySelector('.tmg-facts').innerHTML = facts().map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
		const accent = getComputedStyle(root).getPropertyValue('--accent').trim() || '#4cc2ff';
		for (const m of ms) {
			const cv = p.querySelector(`[data-spark="${m.id}"]`);
			if (cv) drawGraph(cv, m, accent, false);
		}
		const big = p.querySelector('.tmg-graph');
		if (!cur.ok) {
			const ctx2 = big.getContext('2d');
			big.width = big.clientWidth;
			big.height = big.clientHeight;
			ctx2.clearRect(0, 0, big.width, big.height);
			ctx2.fillStyle = '#8a8f99';
			ctx2.font = '13px system-ui';
			ctx2.fillText(NA, 12, 24);
		} else drawGraph(big, cur, accent, true);
	}
	function drawGraph(cv, m, color, big) {
		const dpr = window.devicePixelRatio || 1;
		const w = big ? cv.clientWidth : 96;
		const hgt = big ? cv.clientHeight : 40;
		if (!w || !hgt) return;
		if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(hgt * dpr)) {
			cv.width = Math.round(w * dpr);
			cv.height = Math.round(hgt * dpr);
		}
		const g = cv.getContext('2d');
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, w, hgt);
		const data = m.buf.toArray();
		const max = m.max ?? Math.max(m.buf.max() * 1.15, 1);
		if (big) {
			g.strokeStyle = 'rgba(128,128,140,0.25)';
			g.lineWidth = 1;
			for (let i = 1; i < 4; i++) {
				g.beginPath();
				g.moveTo(0, (hgt * i) / 4);
				g.lineTo(w, (hgt * i) / 4);
				g.stroke();
			}
			g.fillStyle = '#8a8f99';
			g.font = '11px system-ui';
			g.fillText(m.fmt(max), 6, 12);
		}
		const step = w / (N - 1);
		const x = (i) => w - (data.length - 1 - i) * step;
		const y = (v) => hgt - 2 - Math.min(1, v / max) * (hgt - 4);
		g.beginPath();
		let started = false;
		let firstX = 0;
		let lastX = 0;
		data.forEach((v, i) => {
			if (v == null) return;
			if (!started) {
				g.moveTo(x(i), y(v));
				firstX = x(i);
				started = true;
			} else g.lineTo(x(i), y(v));
			lastX = x(i);
		});
		if (!started) return;
		g.strokeStyle = color;
		g.lineWidth = big ? 2 : 1.5;
		g.stroke();
		g.lineTo(lastX, hgt);
		g.lineTo(firstX, hgt);
		g.closePath();
		g.globalAlpha = 0.18;
		g.fillStyle = color;
		g.fill();
		g.globalAlpha = 1;
	}

	/* ---------------- Details ---------------- */
	function renderDet() {
		const p = pane('det');
		const nav = performance.getEntriesByType('navigation')[0];
		const t = pageTiming(nav);
		const sum = summarizeResources(performance.getEntriesByType('resource'));
		const row = (k, v) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
		p.innerHTML = `
			<div class="tmg-cols">
				<div class="tmg-card"><h4>Page timing</h4>
					${t ? [['DNS lookup', formatMs(t.dns)], ['Connect', formatMs(t.connect)], ['First byte', formatMs(t.ttfb)], ['DOM interactive', formatMs(t.domInteractive)], ['DOM content loaded', formatMs(t.domContentLoaded)], ['Load event', formatMs(t.load)], ['Document transfer', formatBytes(t.transferSize)]].map((r) => row(...r)).join('') : `<p class="dim">${NA}</p>`}
				</div>
				<div class="tmg-card"><h4>Resources</h4>
					${row('Requests', String(sum.total))}${row('Transferred', formatBytes(sum.transfer))}
					${sum.byType.map((b) => row(b.type, `${b.count}  ${formatBytes(b.bytes)}`)).join('')}
				</div>
			</div>
			<div class="tmg-card wide"><h4>Slowest resources</h4>
				${sum.slowest.length ? sum.slowest.map((s) => `<div class="tmg-res"><span title="${esc(s.name)}">${esc(shortUrl(s.name))}</span><span class="dim">${esc(s.type)}</span><b>${formatMs(s.duration)}</b><span class="dim r">${s.bytes ? formatBytes(s.bytes) : 'cached or cross-origin'}</span></div>`).join('') : '<p class="dim">No resource timings recorded yet.</p>'}
			</div>`;
	}

	function render() {
		if (tab === 'proc') renderProc();
		else if (tab === 'perf') renderPerf();
		else if (tab === 'det' && ticks % 3 === 1) renderDet();
	}

	/* ---------------- events ---------------- */
	function setTab(t) {
		tab = t;
		root.querySelectorAll('.tmg-tabs [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
		root.querySelectorAll('.tmg-pane').forEach((s) => (s.hidden = s.dataset.pane !== t));
		hideMenu();
		if (t === 'det') renderDet();
		else if (t === 'perf') renderPerf();
		else renderProc();
	}
	root.querySelector('.tmg-tabs').addEventListener('click', (e) => {
		const b = e.target.closest('[data-tab]');
		if (b) setTab(b.dataset.tab);
	});

	function endTask(id) {
		if (!id) return;
		if (id === 'taskmgr') ctx.toast('Closing Task Manager');
		ctx.closeWindow(id);
		if (selected === id) selected = null;
		setTimeout(() => !disposed && render(), 0);
	}
	function hideMenu() {
		menu.hidden = true;
	}
	function showMenu(e, id) {
		selected = id;
		menu.innerHTML = `<button role="menuitem" data-a="switch">Switch to</button><button role="menuitem" data-a="end">End task</button>`;
		menu.dataset.id = id;
		const r = root.getBoundingClientRect();
		menu.style.left = `${Math.min(e.clientX - r.left, r.width - 150)}px`;
		menu.style.top = `${Math.min(e.clientY - r.top, r.height - 80)}px`;
		menu.hidden = false;
		menu.querySelector('button').focus();
		renderProc();
	}
	procPane.addEventListener('click', (e) => {
		const s = e.target.closest('[data-sort]');
		if (s) {
			sort = { key: s.dataset.sort, dir: sort.key === s.dataset.sort ? -sort.dir : 1 };
			return renderProc();
		}
		if (e.target.closest('[data-act=end]')) return endTask(selected);
		const r = e.target.closest('[data-id]');
		if (r) {
			selected = r.dataset.id;
			renderProc();
		}
	});
	procPane.addEventListener('dblclick', (e) => {
		const r = e.target.closest('[data-id]');
		if (r) ctx.focusWindow(r.dataset.id);
	});
	procPane.addEventListener('contextmenu', (e) => {
		const r = e.target.closest('[data-id]');
		if (!r) return;
		e.preventDefault();
		showMenu(e, r.dataset.id);
	});
	procPane.addEventListener('keydown', (e) => {
		const r = e.target.closest('[data-id]');
		if (!r) return;
		if (e.key === 'Delete') endTask(r.dataset.id);
		else if (e.key === 'Enter') ctx.focusWindow(r.dataset.id);
		else if (e.key === ' ') {
			e.preventDefault();
			selected = r.dataset.id;
			renderProc();
		}
	});
	menu.addEventListener('click', (e) => {
		const a = e.target.closest('[data-a]')?.dataset.a;
		const id = menu.dataset.id;
		hideMenu();
		if (a === 'switch') ctx.focusWindow(id);
		else if (a === 'end') endTask(id);
	});
	const away = (e) => {
		if (!menu.hidden && !menu.contains(e.target)) hideMenu();
	};
	document.addEventListener('pointerdown', away, true);
	disposers.push(() => document.removeEventListener('pointerdown', away, true));
	root.addEventListener('keydown', (e) => e.key === 'Escape' && hideMenu());

	const ro = new ResizeObserver(() => tab === 'perf' && renderPerf());
	ro.observe(root);
	disposers.push(() => ro.disconnect());

	const onVis = () => {
		if (document.visibilityState === 'visible') tick();
	};
	document.addEventListener('visibilitychange', onVis);
	disposers.push(() => document.removeEventListener('visibilitychange', onVis));

	renderProc();
	probe();
	tickTimer = setInterval(tick, 1000);
	startRaf();
	readMemory().then(() => !disposed && render());

	return () => {
		disposed = true;
		clearInterval(tickTimer);
		clearTimeout(probeTimer);
		stopRaf();
		po?.disconnect();
		disposers.forEach((d) => d());
	};
}
