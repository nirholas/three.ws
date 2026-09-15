#!/usr/bin/env node

import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const DEFAULT_OUT = join(REPO, 'dist', 'growth-satellites');
const argv = process.argv.slice(2);
const valueAfter = (flag) => {
	const index = argv.indexOf(flag);
	return index === -1 ? null : argv[index + 1];
};
const OUT = resolve(valueAfter('--out') || DEFAULT_OUT);
const OFFLINE = argv.includes('--offline');
const ONLY = valueAfter('--target');

const TARGETS = [
	{
		name: 'agent-starter',
		source: 'satellites/agent-starter',
		repository: 'https://github.com/nirholas/threews-agent-starter.git',
		build: false,
	},
	{
		name: 'glb-quality-gate',
		source: 'satellites/glb-quality-gate',
		repository: 'https://github.com/nirholas/glb-quality-gate.git',
		build: true,
	},
];

function assertSafeOutput(path) {
	const relativePath = relative(REPO, path);
	if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
		throw new Error(`refusing to replace output outside the repository: ${path}`);
	}
	if (!relativePath.startsWith(`dist${process.platform === 'win32' ? '\\' : '/'}`)) {
		throw new Error(`output must stay under dist/: ${path}`);
	}
}

function run(command, args, cwd) {
	execFileSync(command, args, { cwd, stdio: 'inherit' });
}

function copyProject(target) {
	const source = join(REPO, target.source);
	const destination = join(OUT, target.name);
	cpSync(source, destination, {
		recursive: true,
		filter: (path) => !['node_modules', '.git'].includes(path.split('/').at(-1)),
	});
	for (const legal of ['LICENSE', 'NOTICE']) {
		const sourceFile = join(REPO, legal);
		if (existsSync(sourceFile)) cpSync(sourceFile, join(destination, legal));
	}
	const packageJson = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'));
	if (!packageJson.license) throw new Error(`${target.name} package.json has no license`);
	if (!existsSync(join(destination, 'README.md'))) throw new Error(`${target.name} has no README.md`);
	if (!existsSync(join(destination, '.gitignore'))) throw new Error(`${target.name} has no .gitignore`);
	return destination;
}

function verifyProject(target, destination) {
	if (OFFLINE) return;
	run('npm', ['ci', '--ignore-scripts'], destination);
	run('npm', ['test'], destination);
	if (target.build) {
		run('npm', ['run', 'build'], destination);
		if (!existsSync(join(destination, 'dist', 'index.js'))) {
			throw new Error(`${target.name} build did not produce dist/index.js`);
		}
	}
}

function initHistory(target, destination) {
	run('git', ['init', '-b', 'main'], destination);
	run('git', ['add', '--all'], destination);
	run(
		'git',
		[
			'-c',
			'user.name=three.ws release builder',
			'-c',
			'user.email=support@three.ws',
			'commit',
			'-m',
			`feat: publish ${target.name}`,
		],
		destination,
	);
}

function countFiles(path) {
	let count = 0;
	for (const entry of readdirSync(path, { withFileTypes: true })) {
		if (entry.name === '.git' || entry.name === 'node_modules') continue;
		const child = join(path, entry.name);
		count += entry.isDirectory() ? countFiles(child) : statSync(child).isFile() ? 1 : 0;
	}
	return count;
}

const selected = ONLY ? TARGETS.filter((target) => target.name === ONLY) : TARGETS;
if (!selected.length) throw new Error(`unknown target: ${ONLY}`);
assertSafeOutput(OUT);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const manifest = [];
for (const target of selected) {
	const destination = copyProject(target);
	verifyProject(target, destination);
	initHistory(target, destination);
	manifest.push({
		name: target.name,
		repository: target.repository.replace(/\.git$/, ''),
		commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: destination, encoding: 'utf8' }).trim(),
		files: countFiles(destination),
	});
}

writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), targets: manifest }, null, 2)}\n`);

console.log('\nPublishable satellite trees:');
for (const item of manifest) {
	const target = TARGETS.find((entry) => entry.name === item.name);
	console.log(`\n${item.name}: ${item.files} files, commit ${item.commit.slice(0, 12)}`);
	console.log(`git -C ${join(OUT, item.name)} remote add origin ${target.repository}`);
	console.log(`git -C ${join(OUT, item.name)} push -u origin main`);
}
