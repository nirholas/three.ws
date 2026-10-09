#!/usr/bin/env node
// Run every ```bash block of one Markdown doc, in order, in a single shell
// session (so a variable one sample sets is there for the next), and print each
// sample beside its output, exit status and duration. This is how a doc's
// "every sample runs against production as written" claim is checked.
//
//   node scripts/run-doc-samples.mjs docs/grok-bot.md
//   node scripts/run-doc-samples.mjs docs/grok-bot.md --base http://localhost:3108 --skip 10
//
// --base swaps the `https://three.ws/api/` prefix for another origin, to run the
// same samples against a local server built from this tree. --skip takes
// 1-based sample numbers to leave out. The samples run exactly as written, so
// only point this at a doc whose samples are safe to execute (free reads and
// free generation); it never decides that for you. Exits non-zero when any
// sample exits non-zero.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

function parseArgs(argv) {
	const out = { file: null, base: null, skip: new Set() };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--base') out.base = String(argv[++i] || '').replace(/\/+$/, '');
		else if (a === '--skip') for (const n of String(argv[++i] || '').split(',')) out.skip.add(Number(n));
		else if (!out.file) out.file = a;
		else throw new Error(`unknown argument ${a}`);
	}
	if (!out.file) throw new Error('usage: node scripts/run-doc-samples.mjs <doc.md> [--base <origin>] [--skip 1,2]');
	return out;
}

export function bashSamples(markdown) {
	return [...markdown.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1].trim());
}

// One script: each sample is echoed, run, and followed by a status line that
// the summary counts. `set -o pipefail` makes a failing curl in a pipe count.
export function sessionScript(samples, { base, skip }) {
	const lines = ['set -o pipefail', 'FAILED=0'];
	samples.forEach((src, i) => {
		const n = i + 1;
		const cmd = base ? src.replaceAll('https://three.ws/api/', `${base}/api/`) : src;
		lines.push(`printf '\\n===== sample ${n} =====\\n'`, `cat <<'__SAMPLE_${n}__'`, src, `__SAMPLE_${n}__`);
		if (skip.has(n)) {
			lines.push(`echo '----- skipped'`);
			return;
		}
		lines.push(
			`echo '----- output'`,
			'T0=$(date +%s)',
			cmd,
			'RC=$?',
			`echo "----- exit $RC, $(( $(date +%s) - T0 )) s"`,
			'[ "$RC" -ne 0 ] && FAILED=$((FAILED + 1))',
		);
	});
	lines.push(`printf '\\n%s of ${samples.length} samples failed\\n' "$FAILED"`, 'exit $(( FAILED > 0 ))');
	return lines.join('\n');
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const samples = bashSamples(readFileSync(args.file, 'utf8'));
	if (!samples.length) throw new Error(`${args.file} has no bash samples`);
	console.log(`${samples.length} samples in ${args.file}, against ${args.base || 'https://three.ws'}`);
	const dir = mkdtempSync(path.join(tmpdir(), 'doc-samples-'));
	const file = path.join(dir, 'samples.sh');
	try {
		writeFileSync(file, sessionScript(samples, args));
		const r = spawnSync('bash', [file], { stdio: 'inherit', env: process.env });
		process.exitCode = r.status ?? 1;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	try {
		main();
	} catch (err) {
		console.error(err?.message || err);
		process.exitCode = 1;
	}
}
