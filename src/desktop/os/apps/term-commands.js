// Terminal command language: tokenizer, pipeline executor and the command table.
// Pure of the DOM. Everything the commands touch arrives through an injected
// environment, so the same code runs against the real virtual file system in
// the browser and against an in-memory one in tests.
//
// env = {
//   fs,                     // ../fs.js API (stat, list, read, readText, write, mkdir, move, copy, remove, walk, normalize, join, nameOf, parentOf, kindOf)
//   fetch,                  // fetch-compatible
//   now: () => Date,        // clock
//   cwd: '/',               // mutated by cd
//   vars: {},               // environment variables
//   history: [],            // command history (for `history`)
//   host: {                 // optional bridges into the desktop
//     openPath, launchId, apps: [{id,title}], windows: () => [], closeWindow,
//     setTheme(mode), clear(), userName(), sysinfo(): object, uptimeMs(): number,
//   },
// }

export const COMMAND_NAMES = [];

/** Split a command line into pipeline stages of { argv, redirect }. Throws on a syntax error. */
export function parseLine(line) {
	const stages = [];
	let argv = [];
	let redirect = null;
	let cur = '';
	let has = false;
	let quote = null;
	let pendingRedirect = null;
	let trailingPipe = false;
	const pushWord = () => {
		if (!has) return;
		if (pendingRedirect) {
			redirect = { mode: pendingRedirect, target: cur };
			pendingRedirect = null;
		} else argv.push(cur);
		cur = '';
		has = false;
	};
	const endStage = () => {
		pushWord();
		if (pendingRedirect) throw new Error('syntax error: expected a file name after the redirect');
		if (!argv.length) throw new Error('syntax error: empty command in pipeline');
		trailingPipe = false;
		stages.push({ argv, redirect });
		argv = [];
		redirect = null;
	};
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quote) {
			if (c === quote) quote = null;
			else if (c === '\\' && quote === '"' && i + 1 < line.length && '"\\$'.includes(line[i + 1])) cur += line[++i];
			else cur += c;
			continue;
		}
		if (c === '"' || c === "'") {
			quote = c;
			has = true;
		} else if (c === '\\' && i + 1 < line.length) {
			cur += line[++i];
			has = true;
		} else if (/\s/.test(c)) pushWord();
		else if (c === '|') {
			endStage();
			trailingPipe = true;
			continue;
		}
		else if (c === '>') {
			pushWord();
			if (line[i + 1] === '>') {
				pendingRedirect = 'append';
				i++;
			} else pendingRedirect = 'write';
		} else {
			cur += c;
			has = true;
		}
	}
	if (quote) throw new Error('syntax error: unterminated quote');
	if (has || argv.length || pendingRedirect) endStage();
	if (trailingPipe) throw new Error('syntax error: empty command in pipeline');
	return stages;
}

/** Levenshtein distance. */
export function editDistance(a, b) {
	const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) dp[0][j] = j;
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++)
			dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	return dp[a.length][b.length];
}

/** Closest command name within a small distance, or null. */
export function suggest(name, names = COMMAND_NAMES) {
	let best = null;
	let bestD = Infinity;
	for (const n of names) {
		const d = editDistance(name.toLowerCase(), n);
		if (d < bestD) {
			bestD = d;
			best = n;
		}
	}
	return best && bestD <= Math.max(2, Math.floor(name.length / 3)) ? best : null;
}

export function formatBytes(n) {
	if (!Number.isFinite(n)) return '-';
	if (n < 1024) return `${n} B`;
	const u = ['KB', 'MB', 'GB', 'TB'];
	let i = -1;
	do {
		n /= 1024;
		i++;
	} while (n >= 1024 && i < u.length - 1);
	return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

export function formatUptime(ms) {
	const s = Math.floor(ms / 1000);
	const parts = [];
	if (s >= 3600) parts.push(`${Math.floor(s / 3600)}h`);
	if (s >= 60) parts.push(`${Math.floor((s % 3600) / 60)}m`);
	parts.push(`${s % 60}s`);
	return parts.join(' ');
}

/** Output buffer of styled segments. cls: 'dir' | 'err' | 'ok' | 'warn' | 'dim' | 'acc' | ''. */
export class Out {
	constructor() {
		this.segs = [];
	}
	write(text, cls = '') {
		if (text !== '') this.segs.push({ t: String(text), c: cls });
	}
	line(text = '', cls = '') {
		this.write(`${text}\n`, cls);
	}
	text() {
		return this.segs.map((s) => s.t).join('');
	}
}

const usageErr = (io, msg) => {
	io.out.line(msg, 'err');
	return 1;
};

const resolvePath = (env, p) => {
	const { normalize } = env.fs;
	if (p === '~' || p === '') return '/';
	if (p.startsWith('~/')) return normalize(p.slice(1));
	return p.startsWith('/') ? normalize(p) : normalize(`${env.cwd}/${p}`);
};

/** Split `-l -r` style flags from operands. */
function flags(args) {
	const f = new Set();
	const rest = [];
	let done = false;
	for (const a of args) {
		if (!done && a === '--') done = true;
		else if (!done && /^-[a-zA-Z]+$/.test(a)) for (const ch of a.slice(1)) f.add(ch);
		else rest.push(a);
	}
	return { f, rest };
}

async function readInput(env, io, files) {
	if (!files.length) return io.stdin ?? '';
	const parts = [];
	for (const file of files) {
		const p = resolvePath(env, file);
		const st = await env.fs.stat(p);
		if (!st) throw new Error(`${file}: no such file`);
		if (st.type === 'dir') throw new Error(`${file}: is a directory`);
		parts.push(await env.fs.readText(p));
	}
	return parts.join('');
}

const lines = (s) => {
	const l = s.split('\n');
	if (l.length && l[l.length - 1] === '') l.pop();
	return l;
};

const fmtDate = (ms) => {
	const d = new Date(ms);
	const p = (n) => String(n).padStart(2, '0');
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

async function jsonFetch(env, url, init) {
	const r = await env.fetch(url, init);
	if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
	return r.json();
}

const money = (n) => {
	if (n == null || !Number.isFinite(Number(n))) return 'n/a';
	n = Number(n);
	return `$${n >= 1 ? n.toLocaleString('en-US', { maximumFractionDigits: 2 }) : n.toPrecision(4)}`;
};

const WMO = {
	0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
	51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain',
	71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers', 82: 'Violent showers',
	85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm, hail', 99: 'Thunderstorm, heavy hail',
};
export const weatherLabel = (code) => WMO[code] || `Code ${code}`;

const HELP = [
	['help', 'Show this list'],
	['ls [-l] [path]', 'List a folder'],
	['cd, pwd', 'Change or print the working folder'],
	['cat, head, tail, wc, grep', 'Read and filter text (work in pipes)'],
	['echo [text] [> file]', 'Print text, or write it to a file (>> appends)'],
	['mkdir, touch, rm [-r], mv, cp', 'Manage files (rm moves to the Trash)'],
	['open <path|app>', 'Open a file or launch an app'],
	['edit <file>', 'Edit a file in Notepad'],
	['find <name>', 'Search file names'],
	['apps, kill <id>', 'List apps, close a window'],
	['theme dark|light|auto', 'Switch the desktop theme'],
	['date, whoami, uname, env, history, neofetch', 'System information'],
	['curl <url>', 'Fetch a URL (same origin or CORS enabled)'],
	['ping [host]', 'Measure a real round trip'],
	['weather <city>', 'Live forecast from Open-Meteo'],
	['three price|agents [n]|launches', 'Live three.ws data'],
	['clear', 'Clear the screen (Ctrl+L)'],
];

export const COMMANDS = {
	help(args, env, io) {
		io.out.line('three.ws terminal. Pipes (|) and redirects (> >>) work with the text commands.', 'dim');
		io.out.line('');
		const w = Math.max(...HELP.map((h) => h[0].length)) + 2;
		for (const [c, d] of HELP) {
			io.out.write(c.padEnd(w), 'acc');
			io.out.line(d);
		}
		io.out.line('');
		io.out.line('Tab completes commands and paths. Up and Down walk your history. Ctrl+C cancels, Ctrl+L clears.', 'dim');
		return 0;
	},

	clear(args, env, io) {
		env.host?.clear?.();
		io.cleared = true;
		return 0;
	},

	pwd(args, env, io) {
		io.out.line(env.cwd);
		return 0;
	},

	async cd(args, env, io) {
		const target = resolvePath(env, args[0] ?? '~');
		const st = await env.fs.stat(target);
		if (!st) return usageErr(io, `cd: ${args[0]}: no such folder`);
		if (st.type !== 'dir') return usageErr(io, `cd: ${args[0]}: not a folder`);
		env.cwd = target;
		return 0;
	},

	async ls(args, env, io) {
		const { f, rest } = flags(args);
		const targets = rest.length ? rest : ['.'];
		let code = 0;
		for (const t of targets) {
			const p = resolvePath(env, t);
			const st = await env.fs.stat(p);
			if (!st) {
				io.out.line(`ls: ${t}: no such file or folder`, 'err');
				code = 1;
				continue;
			}
			if (targets.length > 1) io.out.line(`${t}:`, 'dim');
			const items = st.type === 'dir' ? await env.fs.list(p) : [st];
			if (!items.length) io.out.line('(empty)', 'dim');
			else if (f.has('l')) {
				for (const n of items) {
					io.out.write(`${n.type === 'dir' ? 'd' : '-'}  ${(n.type === 'dir' ? '-' : formatBytes(n.size)).padStart(8)}  ${fmtDate(n.mtime)}  `, 'dim');
					io.out.line(n.type === 'dir' ? `${n.name}/` : n.name, n.type === 'dir' ? 'dir' : '');
				}
			} else {
				items.forEach((n, i) => {
					io.out.write(n.type === 'dir' ? `${n.name}/` : n.name, n.type === 'dir' ? 'dir' : '');
					io.out.write(i === items.length - 1 ? '\n' : '  ');
				});
			}
		}
		return code;
	},

	async cat(args, env, io) {
		try {
			io.out.write(await readInput(env, io, args));
			return 0;
		} catch (e) {
			return usageErr(io, `cat: ${e.message}`);
		}
	},

	echo(args, env, io) {
		io.out.line(args.join(' '));
		return 0;
	},

	async mkdir(args, env, io) {
		const { f, rest } = flags(args);
		if (!rest.length) return usageErr(io, 'usage: mkdir [-p] <folder>...');
		let code = 0;
		for (const a of rest) {
			try {
				const p = resolvePath(env, a);
				if (f.has('p')) {
					let acc = '';
					for (const seg of p.split('/').filter(Boolean)) {
						acc += `/${seg}`;
						if (!(await env.fs.stat(acc))) await env.fs.mkdir(acc);
					}
				} else await env.fs.mkdir(p);
			} catch (e) {
				io.out.line(`mkdir: ${a}: ${e.message}`, 'err');
				code = 1;
			}
		}
		return code;
	},

	async touch(args, env, io) {
		if (!args.length) return usageErr(io, 'usage: touch <file>...');
		let code = 0;
		for (const a of args) {
			try {
				const p = resolvePath(env, a);
				const st = await env.fs.stat(p);
				if (!st) await env.fs.write(p, '');
				else if (st.type === 'file') await env.fs.write(p, (await env.fs.read(p)).blob);
			} catch (e) {
				io.out.line(`touch: ${a}: ${e.message}`, 'err');
				code = 1;
			}
		}
		return code;
	},

	async rm(args, env, io) {
		const { f, rest } = flags(args);
		if (!rest.length) return usageErr(io, 'usage: rm [-r] <path>...');
		let code = 0;
		for (const a of rest) {
			try {
				const p = resolvePath(env, a);
				const st = await env.fs.stat(p);
				if (!st) throw new Error('no such file or folder');
				if (st.type === 'dir' && !f.has('r') && !f.has('R')) throw new Error('is a folder (use rm -r)');
				await env.fs.remove(p);
				io.out.line(`${a} moved to the Trash`, 'dim');
			} catch (e) {
				io.out.line(`rm: ${a}: ${e.message}`, 'err');
				code = 1;
			}
		}
		return code;
	},

	async mv(args, env, io) {
		if (args.length !== 2) return usageErr(io, 'usage: mv <from> <to>');
		try {
			const from = resolvePath(env, args[0]);
			let to = resolvePath(env, args[1]);
			const dst = await env.fs.stat(to);
			if (dst?.type === 'dir') to = env.fs.join(to, env.fs.nameOf(from));
			await env.fs.move(from, to);
			return 0;
		} catch (e) {
			return usageErr(io, `mv: ${e.message}`);
		}
	},

	async cp(args, env, io) {
		if (args.length !== 2) return usageErr(io, 'usage: cp <from> <to>');
		try {
			const from = resolvePath(env, args[0]);
			let to = resolvePath(env, args[1]);
			const dst = await env.fs.stat(to);
			if (dst?.type === 'dir') to = env.fs.join(to, env.fs.nameOf(from));
			await env.fs.copy(from, to);
			return 0;
		} catch (e) {
			return usageErr(io, `cp: ${e.message}`);
		}
	},

	async open(args, env, io) {
		if (!args.length) return usageErr(io, 'usage: open <path|app>');
		const host = env.host;
		if (!host?.openPath) return usageErr(io, 'open: not available here');
		const p = resolvePath(env, args[0]);
		const st = await env.fs.stat(p);
		if (st) {
			await host.openPath(p);
			return 0;
		}
		const app = (host.apps || []).find((a) => a.id === args[0].toLowerCase() || a.title.toLowerCase() === args.join(' ').toLowerCase());
		if (app) {
			host.launchId(app.id);
			return 0;
		}
		return usageErr(io, `open: ${args[0]}: no such file, folder or app`);
	},

	async edit(args, env, io) {
		if (!args.length) return usageErr(io, 'usage: edit <file>');
		const p = resolvePath(env, args[0]);
		let st = await env.fs.stat(p);
		if (!st) {
			try {
				await env.fs.write(p, '');
			} catch (e) {
				return usageErr(io, `edit: ${e.message}`);
			}
			st = await env.fs.stat(p);
		}
		if (st.type === 'dir') return usageErr(io, 'edit: is a folder');
		env.host?.launchId?.('notepad', { arg: p });
		return 0;
	},

	async find(args, env, io) {
		if (!args.length) return usageErr(io, 'usage: find <name> [folder]');
		const needle = args[0].toLowerCase();
		const root = resolvePath(env, args[1] ?? '.');
		const hits = (await env.fs.walk(root)).filter((n) => n.name.toLowerCase().includes(needle) && !n.path.startsWith('/Trash/'));
		if (!hits.length) io.out.line('No matches.', 'dim');
		for (const n of hits) io.out.line(n.path, n.type === 'dir' ? 'dir' : '');
		return hits.length ? 0 : 1;
	},

	async grep(args, env, io) {
		const { f, rest } = flags(args);
		if (!rest.length) return usageErr(io, 'usage: grep [-i] [-n] [-v] <pattern> [file]');
		const [pattern, ...files] = rest;
		let re;
		try {
			re = new RegExp(pattern, f.has('i') ? 'i' : '');
		} catch {
			re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), f.has('i') ? 'i' : '');
		}
		let text;
		try {
			text = await readInput(env, io, files);
		} catch (e) {
			return usageErr(io, `grep: ${e.message}`);
		}
		let n = 0;
		lines(text).forEach((l, i) => {
			if (re.test(l) === !!f.has('v')) return;
			n++;
			if (f.has('n')) io.out.write(`${i + 1}:`, 'dim');
			io.out.line(l);
		});
		return n ? 0 : 1;
	},

	async wc(args, env, io) {
		const { f, rest } = flags(args);
		let text;
		try {
			text = await readInput(env, io, rest);
		} catch (e) {
			return usageErr(io, `wc: ${e.message}`);
		}
		const l = (text.match(/\n/g) || []).length;
		const w = (text.trim() ? text.trim().split(/\s+/) : []).length;
		const c = new TextEncoder().encode(text).length;
		const parts = [];
		if (f.has('l')) parts.push(l);
		if (f.has('w')) parts.push(w);
		if (f.has('c')) parts.push(c);
		io.out.line((parts.length ? parts : [l, w, c]).join('  '));
		return 0;
	},

	async head(args, env, io) {
		return headTail(args, env, io, true);
	},
	async tail(args, env, io) {
		return headTail(args, env, io, false);
	},

	date(args, env, io) {
		io.out.line(env.now().toString());
		return 0;
	},

	whoami(args, env, io) {
		io.out.line(env.host?.userName?.() || 'guest');
		return 0;
	},

	uname(args, env, io) {
		const si = env.host?.sysinfo?.() || {};
		io.out.line(args.includes('-a') ? `three.ws-desktop web ${si.platform || ''} ${si.userAgent || ''}`.trim() : 'three.ws-desktop');
		return 0;
	},

	env(args, env, io) {
		for (const [k, v] of Object.entries(env.vars)) io.out.line(`${k}=${v}`);
		return 0;
	},

	history(args, env, io) {
		env.history.forEach((h, i) => io.out.line(`${String(i + 1).padStart(4)}  ${h}`));
		return 0;
	},

	theme(args, env, io) {
		const m = (args[0] || '').toLowerCase();
		if (!['dark', 'light', 'auto'].includes(m)) return usageErr(io, 'usage: theme dark|light|auto');
		env.host?.setTheme?.(m);
		io.out.line(`Theme set to ${m}.`, 'ok');
		return 0;
	},

	apps(args, env, io) {
		const list = env.host?.apps || [];
		if (!list.length) io.out.line('No apps registered.', 'dim');
		for (const a of list) {
			io.out.write(a.id.padEnd(14), 'acc');
			io.out.line(a.title);
		}
		return 0;
	},

	kill(args, env, io) {
		const wins = env.host?.windows?.() || [];
		if (!args.length) {
			if (!wins.length) io.out.line('No open windows.', 'dim');
			for (const w of wins) {
				io.out.write(String(w.id).padEnd(14), 'acc');
				io.out.line(w.title);
			}
			return 0;
		}
		const w = wins.find((x) => x.id === args[0]);
		if (!w) return usageErr(io, `kill: ${args[0]}: no such window (run kill with no arguments to list them)`);
		env.host.closeWindow(w.id);
		io.out.line(`Closed ${w.title}.`, 'ok');
		return 0;
	},

	async curl(args, env, io) {
		const { f, rest } = flags(args);
		if (!rest.length) return usageErr(io, 'usage: curl [-I] <url>');
		let url;
		try {
			url = new URL(rest[0], env.baseUrl || 'https://three.ws/').href;
		} catch {
			return usageErr(io, `curl: invalid URL: ${rest[0]}`);
		}
		const t0 = env.perfNow();
		try {
			const r = await env.fetch(url, { method: f.has('I') ? 'HEAD' : 'GET' });
			io.out.write(`HTTP ${r.status} ${r.statusText || ''}`.trim(), r.ok ? 'ok' : 'err');
			io.out.line(`  ${Math.round(env.perfNow() - t0)} ms`, 'dim');
			const ct = r.headers?.get?.('content-type');
			if (ct) io.out.line(`content-type: ${ct}`, 'dim');
			if (!f.has('I')) {
				const body = await r.text();
				const cap = 20000;
				io.out.write(body.slice(0, cap));
				if (!body.endsWith('\n')) io.out.write('\n');
				if (body.length > cap) io.out.line(`... truncated ${formatBytes(body.length - cap)}`, 'dim');
			}
			return r.ok ? 0 : 22;
		} catch (e) {
			io.out.line(`curl: request failed: ${e.message}. Cross-origin URLs need CORS enabled by the server.`, 'err');
			return 7;
		}
	},

	async ping(args, env, io) {
		const base = env.baseUrl || 'https://three.ws/';
		let url;
		try {
			url = args[0] ? new URL(/^https?:\/\//.test(args[0]) ? args[0] : `https://${args[0]}/`).href : new URL('/api/health', base).href;
		} catch {
			return usageErr(io, `ping: invalid host: ${args[0]}`);
		}
		const times = [];
		for (let i = 0; i < 4; i++) {
			if (io.signal?.aborted) break;
			const t0 = env.perfNow();
			try {
				const r = await env.fetch(url, { method: 'GET', cache: 'no-store', mode: args[0] ? 'no-cors' : 'cors', signal: io.signal });
				const ms = env.perfNow() - t0;
				times.push(ms);
				io.out.line(`reply from ${url}: ${r.status || 'opaque'} time=${ms.toFixed(1)} ms`);
			} catch (e) {
				if (io.signal?.aborted) break;
				io.out.line(`request to ${url} failed: ${e.message}`, 'err');
			}
		}
		if (times.length) {
			const avg = times.reduce((a, b) => a + b, 0) / times.length;
			io.out.line(`${times.length} replies, min ${Math.min(...times).toFixed(1)} ms, avg ${avg.toFixed(1)} ms, max ${Math.max(...times).toFixed(1)} ms`, 'ok');
			return 0;
		}
		return 1;
	},

	async weather(args, env, io) {
		const city = args.join(' ').trim();
		if (!city) return usageErr(io, 'usage: weather <city>');
		try {
			const g = await jsonFetch(env, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`);
			const place = g.results?.[0];
			if (!place) return usageErr(io, `weather: no place found for "${city}"`);
			const w = await jsonFetch(
				env,
				`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,weather_code&forecast_days=3&timezone=auto`,
			);
			const c = w.current;
			io.out.line(`${place.name}${place.admin1 ? `, ${place.admin1}` : ''}, ${place.country || ''}`, 'acc');
			io.out.line(`${weatherLabel(c.weather_code)}  ${c.temperature_2m}${w.current_units.temperature_2m} (feels ${c.apparent_temperature}${w.current_units.temperature_2m})`);
			io.out.line(`Humidity ${c.relative_humidity_2m}%  Wind ${c.wind_speed_10m} ${w.current_units.wind_speed_10m}`, 'dim');
			w.daily.time.forEach((d, i) => io.out.line(`${d}  ${String(w.daily.temperature_2m_min[i]).padStart(5)} / ${String(w.daily.temperature_2m_max[i]).padEnd(5)}  ${weatherLabel(w.daily.weather_code[i])}`));
			return 0;
		} catch (e) {
			return usageErr(io, `weather: ${e.message}`);
		}
	},

	async three(args, env, io) {
		const sub = (args[0] || '').toLowerCase();
		try {
			if (sub === 'price') {
				const s = await jsonFetch(env, new URL('/api/three-token/stats', env.baseUrl || 'https://three.ws/').href);
				const t = s.token || {};
				io.out.write('$THREE  ', 'acc');
				io.out.write(money(t.price_usd));
				const ch = t.price_change_24h;
				if (ch != null) io.out.write(`  ${ch >= 0 ? '+' : ''}${Number(ch).toFixed(2)}% 24h`, ch >= 0 ? 'ok' : 'err');
				io.out.write('\n');
				io.out.line(`market cap ${money(t.market_cap)}  volume 24h ${money(t.volume_24h)}  holders ${t.holders ?? 'n/a'}`, 'dim');
				return 0;
			}
			if (sub === 'agents') {
				const n = Math.min(Math.max(parseInt(args[1], 10) || 10, 1), 48);
				const d = await jsonFetch(env, new URL(`/api/agents/public?limit=${n}`, env.baseUrl || 'https://three.ws/').href);
				const list = d.agents || [];
				if (!list.length) io.out.line('No public agents yet.', 'dim');
				for (const a of list) {
					io.out.write(String(a.name || 'Unnamed').padEnd(26), 'acc');
					io.out.line(String(a.description || '').replace(/\s+/g, ' ').slice(0, 60), 'dim');
				}
				return 0;
			}
			if (sub === 'launches') {
				const d = await jsonFetch(env, new URL('/api/pump/launches?limit=10', env.baseUrl || 'https://three.ws/').href);
				const list = d.data?.launches || [];
				if (!list.length) io.out.line('No launches yet.', 'dim');
				for (const l of list) {
					io.out.write(String(l.symbol || '?').padEnd(10), 'acc');
					io.out.write(String(l.name || '').slice(0, 28).padEnd(30));
					io.out.line(l.mint ? `${l.mint.slice(0, 6)}...${l.mint.slice(-4)}` : '', 'dim');
				}
				return 0;
			}
		} catch (e) {
			return usageErr(io, `three ${sub}: ${e.message}`);
		}
		return usageErr(io, 'usage: three price | three agents [n] | three launches');
	},

	async neofetch(args, env, io) {
		const si = env.host?.sysinfo?.() || {};
		const wins = env.host?.windows?.() || [];
		const rows = [
			['OS', 'three.ws Desktop'],
			['Host', si.platform || 'unknown'],
			['Browser', si.browser || si.userAgent || 'unknown'],
			['Uptime', formatUptime(env.host?.uptimeMs?.() ?? 0)],
			['CPU', si.cores ? `${si.cores} logical cores` : 'unknown'],
			['Memory', si.deviceMemory ? `${si.deviceMemory} GB (reported, capped by the browser)` : 'not reported by this browser'],
			['GPU', si.gpu || 'unavailable'],
			['Screen', si.screen || 'unknown'],
			['Language', si.language || 'unknown'],
			['Windows', String(wins.length)],
			['Theme', si.theme || 'unknown'],
		];
		const art = ['  _   _                  ', ' | |_| |_ _ _ ___ ___   ', ' |  _| \' \\ \'_/ -_) -_)  ', '  \\__|_||_|_| \\___\\___|  ', '                         ', '   three.ws desktop      '];
		rows.forEach((r, i) => {
			io.out.write((art[i] ?? ' '.repeat(26)).padEnd(28), 'acc');
			io.out.write(`${r[0].padEnd(10)}`, 'ok');
			io.out.line(r[1]);
		});
		return 0;
	},
};

async function headTail(args, env, io, head) {
	const name = head ? 'head' : 'tail';
	let n = 10;
	const files = [];
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '-n' && args[i + 1]) n = parseInt(args[++i], 10);
		else if (/^-\d+$/.test(args[i])) n = parseInt(args[i].slice(1), 10);
		else files.push(args[i]);
	}
	if (!Number.isFinite(n) || n < 0) return usageErr(io, `${name}: invalid line count`);
	try {
		const l = lines(await readInput(env, io, files));
		for (const x of head ? l.slice(0, n) : l.slice(Math.max(0, l.length - n))) io.out.line(x);
		return 0;
	} catch (e) {
		return usageErr(io, `${name}: ${e.message}`);
	}
}

COMMAND_NAMES.push(...Object.keys(COMMANDS));

/** Build the default environment from injected parts. */
export function createEnv({ fs, fetch, now = () => new Date(), perfNow = () => performance.now(), host = {}, baseUrl = 'https://three.ws/', vars = {}, history = [] }) {
	return {
		fs, fetch, now, perfNow, host, baseUrl, history,
		cwd: '/',
		vars: { USER: host.userName?.() || 'guest', HOME: '/', SHELL: 'tws-sh', TERM: 'xterm-256color', ...vars },
	};
}

/**
 * Run one command line. Returns { out: Out, code, cleared }.
 * `signal` aborts long commands (Ctrl+C).
 */
export async function runLine(line, env, { signal } = {}) {
	const out = new Out();
	const result = { out, code: 0, cleared: false };
	const trimmed = line.trim();
	if (!trimmed) return result;
	let stages;
	try {
		stages = parseLine(trimmed);
	} catch (e) {
		out.line(e.message, 'err');
		result.code = 2;
		return result;
	}
	let stdin = null;
	for (let i = 0; i < stages.length; i++) {
		const { argv, redirect } = stages[i];
		const [name, ...args] = argv;
		const fn = COMMANDS[name];
		const last = i === stages.length - 1;
		const stageOut = new Out();
		const io = { out: stageOut, stdin, signal, cleared: false };
		if (!fn) {
			const s = suggest(name);
			out.line(`${name}: command not found${s ? `. Did you mean "${s}"?` : '. Type help for the list of commands.'}`, 'err');
			result.code = 127;
			return result;
		}
		try {
			result.code = (await fn(args, env, io)) ?? 0;
		} catch (e) {
			stageOut.line(`${name}: ${e?.message || e}`, 'err');
			result.code = 1;
		}
		if (io.cleared) result.cleared = true;
		if (redirect) {
			const p = resolvePath(env, redirect.target);
			try {
				let text = stageOut.text();
				if (redirect.mode === 'append') {
					const prev = (await env.fs.stat(p)) ? await env.fs.readText(p) : '';
					text = prev + text;
				}
				await env.fs.write(p, text);
				stdin = '';
			} catch (e) {
				out.line(`${redirect.target}: ${e.message}`, 'err');
				result.code = 1;
				return result;
			}
			if (last) break;
		} else if (last) out.segs.push(...stageOut.segs);
		else stdin = stageOut.text();
		if (result.code === 127) break;
	}
	return result;
}

/**
 * Tab completion. Returns { start, matches } where `start` is the index in
 * `line` where the completed word begins and `matches` are full replacement
 * words (folders end with "/").
 */
export async function complete(line, env) {
	const m = line.match(/(?:^|[\s|>])([^\s|>]*)$/);
	const word = m ? m[1] : '';
	const start = line.length - word.length;
	const before = line.slice(0, start);
	const isCommand = !/\S/.test(before.replace(/^.*\|/, '')) && !before.trimEnd().endsWith('>');
	if (isCommand) return { start, matches: COMMAND_NAMES.filter((c) => c.startsWith(word)).sort() };
	const slash = word.lastIndexOf('/');
	const dirPart = slash >= 0 ? word.slice(0, slash + 1) : '';
	const base = slash >= 0 ? word.slice(slash + 1) : word;
	let items = [];
	try {
		const dir = resolvePath(env, dirPart || '.');
		items = await env.fs.list(dir);
	} catch {
		items = [];
	}
	const matches = items.filter((n) => n.name.toLowerCase().startsWith(base.toLowerCase())).map((n) => dirPart + n.name + (n.type === 'dir' ? '/' : ''));
	return { start, matches };
}

export function commonPrefix(list) {
	if (!list.length) return '';
	let p = list[0];
	for (const s of list) while (!s.startsWith(p)) p = p.slice(0, -1);
	return p;
}
